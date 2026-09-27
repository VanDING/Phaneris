// windowframe.dll -- the Phaneris installer's window frame and progress overlay.
//
// WHAT THIS IS
//
//   A 32-bit NSIS plugin that owns exactly two things: the shape of the
//   installer's one top-level window, and the branded surface that covers the
//   stock InstFiles page while files are being written. It does not create pages.
//
//   That last sentence is the whole architecture, and it is worth stating why.
//   NSIS's wizard is a fixed dialog, and an earlier version of this plugin
//   "replaced" it by creating its own child window per page -- a welcome window,
//   a progress window, a finish window. Those windows had no relationship to the
//   pages they were covering, so nothing tied their lifetime to a page's: after
//   an install completed, the progress window was still there, still visible,
//   still painting "cleaning temporary files" over a finish page that had
//   already been built underneath it. Welcome and finish are ordinary NSIS pages
//   now, built from native controls by nsDialogs in installer-pages.nsh; a page
//   that is a real page cannot be left behind by the page after it. Only the
//   progress overlay is a window of ours, because it exists to hide one, and
//   NSIS tears it down on the next line of the script that created it.
//
//   NSIS drives this through `System::Call`, which is the real C ABI -- so the
//   exports below are ordinary __cdecl C functions with __declspec(dllexport),
//   and their names must stay undecorated for `windowframe::Name` to resolve.
//   The installer is Unicode, so every string parameter is a wide pointer.
//
// THE THREE NON-OBVIOUS TRICKS
//
//   1. HIDING THE STOCK PAGE. NSIS shows its page *after* MUI's SHOW callback
//      returns (see `ShowWindow(m_curwnd, SW_SHOWNA)` in the NSIS runtime), so a
//      ShowWindow(SW_HIDE) from inside that callback is undone a moment later.
//      Subclassing the page with HiddenPageProc and stripping SWP_SHOWWINDOW out
//      of every WM_WINDOWPOSCHANGING (adding SWP_HIDEWINDOW instead) is what
//      actually keeps it off screen, no matter who asks for it to be shown.
//
//   2. REAL PROGRESS WITH NO EXTRACTOR REWRITE. The stock electron-builder
//      install section drives NSIS's own progress bar, and NSIS hands this
//      plugin that very control (`$mui.InstFilesPage.ProgressBar`). Instead of
//      replacing the extractor, the 16 ms timer reads the control with
//      PBM_GETRANGE/PBM_GETPOS -- after checking the class is really
//      "msctls_progress32" -- and feeds the number to ProgressModel. Nothing
//      about the install engine changes and the bar still tells the truth.
//
//   3. PAINTING ONLY WHEN THE NUMBER MOVES. The overlay is a 600x600 GDI+
//      surface repainted from a timer, and the first version of this file
//      invalidated it on every tick: 0.47 of a core, measured, for a frame that
//      was byte-identical to the last one. The tick therefore formats the
//      caption, compares it with what is on screen, and invalidates only when
//      the rendered percent or the caption stage actually differs.
//
// WHY THE MODULE IS PINNED
//
//   NSIS may release its reference to this DLL between calls, and the overlay's
//   window procedure is still executing when that happens. Pinning the module
//   makes it impossible for a window procedure to run from freed code; the
//   subclass procedures on NSIS's own windows depend on it too.
//
// Exported ABI (see the note on names below):
//
//   HRESULT InstallerApplyFrame(HWND window);
//   HWND    InstallerShowProgress(HWND parent, HWND source, BOOL dark, UINT dpi, LPCWSTR brand,
//                                 LPCWSTR preparing, LPCWSTR extracting, LPCWSTR copying,
//                                 LPCWSTR registering, LPCWSTR cleaning);
//   BOOL    InstallerFinishProgress(HWND window);
//   BOOL    InstallerPresentWelcome(HWND window);
//   int     InstallerFindProcess(LPCWSTR executable);

// The build already passes /DUNICODE /D_UNICODE /DWIN32_LEAN_AND_MEAN /DNOMINMAX;
// the guards are here so the file still compiles when someone opens it in an IDE
// without those switches, and so cl does not warn C4005 about the redefinition.
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>
#include <commctrl.h>
#include <dwmapi.h>
#include <tlhelp32.h>
// objidl.h is not optional: the GDI+ headers define IImageBytes, which derives
// from IUnknown, and gdiplus.h does not pull the COM interfaces in itself.
#include <objidl.h>
#include <gdiplus.h>
#include <new>

#include "progress.h"

using namespace Gdiplus;
using namespace phaneris;

// ---------------------------------------------------------------------------
// Exported names
// ---------------------------------------------------------------------------
//
// `System::Call 'windowframe::InstallerApplyFrame(...)'` resolves the symbol by
// exact name. On x86 a __cdecl C function's *symbol* is `_InstallerApplyFrame`,
// but __declspec(dllexport) publishes the C name undecorated, which is what NSIS
// looks up -- so no .def file and no /EXPORT pragmas are needed here, and adding
// one would put a second, duplicate entry in the export table. Verified with
// `dumpbin /exports`. The signatures below are the ABI the NSIS side is written
// against; changing an argument count or width breaks it silently.

namespace {

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Registered once per process; a second RegisterClassW returns 0 with
// ERROR_CLASS_ALREADY_EXISTS, which is not an error here.
constexpr wchar_t kProgressClass[] = L"PhanerisInstallerProgress";

// The 16 ms repaint cadence, and the subclass ids for windows this plugin does
// not own. Ids only have to be unique per window, not per process.
constexpr UINT_PTR kProgressTimer = 1;
constexpr UINT_PTR kFrameSubclass = 1;
constexpr UINT_PTR kHiddenPageSubclass = 1;

// Plugin-private markers. `SetWindowSubclass` with an id that is already
// installed is not a reliable success -- comctl32's behaviour there depends on
// the version -- and a repeat call to InstallerApplyFrame must not fail on it.
// The property is the record of "this window is already ours", checked before
// anything is subclassed a second time.
constexpr wchar_t kPropFramed[] = L"Phaneris.Internal.Framed";
constexpr wchar_t kPropPageHidden[] = L"Phaneris.Internal.PageHidden";
// Which step of InstallerApplyFrame gave up, for the script to print. Three
// distinct failures all leave the frame property unset, and "the frame did not
// happen" is not a diagnosis: 1 = the handle was not a window, 2 = the module
// could not be pinned, 3 = SetWindowSubclass was refused.
constexpr wchar_t kPropFrameError[] = L"Phaneris.Internal.FrameError";

// The product's UI faces. Segoe UI for Latin copy; Microsoft YaHei UI as soon as
// a string contains anything past Latin-1, because the installer ships English
// and Simplified Chinese and a CJK caption must not depend on GDI+ font linking
// to render at all. The chosen family is verified before use, with the other as
// the fallback.
constexpr wchar_t kUiFace[] = L"Segoe UI";
constexpr wchar_t kCaptionFace[] = L"Microsoft YaHei UI";

// Stock chrome hidden by InstallerApplyFrame: 1/2/3 are the outer dialog's
// Next/Cancel/Back buttons, 1256 is its branding text, and the rest are MUI's
// page furniture (header text and bitmap, divider, details button, and the
// button strips the page dialogs keep for themselves). Hiding them is belt and
// braces now that the pages are ours -- our nsDialogs dialog covers the whole
// client area -- but a control that can never be shown is cheaper than a
// z-order that has to be argued about.
//
// 1046 is the one that got away, and the harness caught it: MUI's header bitmap
// static, an empty SS_BITMAP at (1647,32)-(1797,85) that reported vis=True in
// every state of every run. It never *drew* anything -- an SS_BITMAP static with
// no bitmap fills itself with the dialog brush, which is why it survived four
// rounds of looking at screenshots -- but it is a live control on a page that is
// supposed to be entirely ours, sitting exactly where a future MUI version, a
// theme change or a stray STM_SETIMAGE would put pixels. It is hidden here by id
// and checked by the harness by id.
//
// There is no icon control to add to this list, which was worth checking rather
// than assuming when a grey block turned up in the top-left corner. NSIS's
// installer template carries no SS_ICON static at all -- the icon it shows is
// the window's own, drawn by DefWindowProc inside a caption band this window
// does not have -- and a live enumeration of the running dialog confirms it: the
// only children are the ids above, our own 1200-series controls, and three
// etched-line statics (1035/1036/1045) that are MUI dividers. The corner block
// was the rounded corner, and it is fixed above, in the DWM attributes.
constexpr int kStockControlIds[] = {1,    2,    3,    1028, 1256, 1034,
                                    1035, 1036, 1037, 1038, 1039, 1046};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// NSIS may release its reference to this DLL before one of our windows receives
// WM_NCDESTROY (it frees plugins between calls). Pinning the module makes that
// impossible, so a window procedure can never run from freed code.
void PinModule() {
    static bool pinned = false;
    if (pinned) return;
    HMODULE module = nullptr;
    if (GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_PIN | GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
                           reinterpret_cast<LPCWSTR>(&PinModule), &module)) {
        pinned = true;
    }
}

void SetIntProp(HWND window, const wchar_t* name, int value) {
    if (!window) return;
    // SetPropW with a null handle removes the property, which is also what "not
    // set" reads as, so the two states do not need distinguishing.
    if (value == 0) RemovePropW(window, name);
    else SetPropW(window, name, reinterpret_cast<HANDLE>(static_cast<INT_PTR>(value)));
}

int IntProp(HWND window, const wchar_t* name) {
    if (!window) return 0;
    return static_cast<int>(reinterpret_cast<INT_PTR>(GetPropW(window, name)));
}

// NSIS passes the DPI it measured; a zero or absurd value would make every
// coordinate meaningless, so it is checked rather than trusted.
UINT ResolveDpi(UINT dpi) {
    if (dpi >= 72 && dpi <= 480) return dpi;
    return 96;
}

int DesignPixels(int design, UINT dpi) {
    return MulDiv(design, static_cast<int>(dpi), 96);
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

RectF BoxRect(const Box& box) {
    return RectF(box.left, box.top, box.width, box.height);
}

// True once the string needs a face with CJK coverage. Latin-1 is the whole
// range Segoe UI can be trusted to cover for this installer's copy.
bool NeedsCjkFace(const wchar_t* text) {
    for (const wchar_t* cursor = text; cursor && *cursor; ++cursor) {
        if (static_cast<unsigned>(*cursor) > 0x00FFu) return true;
    }
    return false;
}

const wchar_t* FaceFor(const wchar_t* text) {
    return NeedsCjkFace(text) ? kCaptionFace : kUiFace;
}

// The two candidate faces for one text run. Both are constructed because
// FontFamily cannot be copied safely; the one GDI+ could not create holds no
// resource at all, so letting both destructors run is harmless.
struct Face {
    FontFamily ui;
    FontFamily cjk;
    const wchar_t* wanted;

    explicit Face(const wchar_t* text) : ui(kUiFace), cjk(kCaptionFace), wanted(FaceFor(text)) {}

    FontFamily* Usable() {
        FontFamily* first = (wanted == kUiFace) ? &ui : &cjk;
        if (first->GetLastStatus() == Ok) return first;
        FontFamily* second = (first == &ui) ? &cjk : &ui;
        return second->GetLastStatus() == Ok ? second : nullptr;
    }
};

void DrawRun(Graphics& graphics, const wchar_t* text, REAL pixels, INT style, const RectF& rect,
             const StringFormat& format, const Brush& brush) {
    if (!text || !*text) return;
    Face face(text);
    FontFamily* family = face.Usable();
    if (!family) return;
    Font font(family, pixels, style, UnitPixel);
    if (font.GetLastStatus() != Ok) return;
    graphics.DrawString(text, -1, &font, rect, &format, &brush);
}

// The default constructor is public; every flag that matters is set explicitly
// here, including the no-wrap these single-line runs need.
void MakeCentered(StringFormat& format) {
    format.SetAlignment(StringAlignmentCenter);
    format.SetLineAlignment(StringAlignmentCenter);
    format.SetFormatFlags(StringFormatFlagsNoWrap);
    format.SetTrimming(StringTrimmingEllipsisCharacter);
}

// The progress bar, built from the visual specification's four arcs verbatim
// (4x4 arc boxes around a 6-unit-tall bar) rather than through a generic rounded
// rectangle, because this geometry is part of the design and not a corner
// radius. The numbers come from kTrackBox/kTrackCorner, so they live in exactly
// one place.
void FillProgress(Graphics& graphics, Brush& brush, REAL width) {
    if (width <= 0) return;
    const REAL left = kTrackBox.left;
    const REAL top = kTrackBox.top;
    const REAL height = kTrackBox.height;
    const REAL corner = kTrackCorner;
    if (width < corner) {
        graphics.FillRectangle(&brush, left, top, width, height);
        return;
    }
    GraphicsPath path;
    path.AddArc(left, top, corner, corner, 180.0f, 90.0f);
    path.AddArc(left + width - corner, top, corner, corner, 270.0f, 90.0f);
    path.AddArc(left + width - corner, top + height - corner, corner, corner, 0.0f, 90.0f);
    path.AddArc(left, top + height - corner, corner, corner, 90.0f, 90.0f);
    path.CloseFigure();
    graphics.FillPath(&brush, &path);
}

// The caption band is chrome; below it the page is content.
bool InCaptionBand(int y) {
    return y < static_cast<int>(kCaptionBandHeight);
}

// Everything in the caption band that is identical on every surface: the
// minimise button and the drag. Close is not here -- closing the installer
// cancels an install that is still running, which is a decision the caller has
// to make rather than something this helper may do on its behalf.
void RunCaptionAction(HWND parent, int x, int y) {
    if (!InCaptionBand(y)) return;
    if (x >= static_cast<int>(kMinimizeBox.left) && x < static_cast<int>(kMinimizeBox.left + kMinimizeBox.width)) {
        ShowWindow(parent, SW_MINIMIZE);
        return;
    }
    if (x < static_cast<int>(kCloseBox.left)) {
        // The move loop has to run on the top-level window: sending
        // WM_NCLBUTTONDOWN to a child window does nothing.
        HWND target = parent ? GetAncestor(parent, GA_ROOT) : nullptr;
        if (!target) target = parent;
        ReleaseCapture();
        SendMessageW(target, WM_NCLBUTTONDOWN, HTCAPTION, 0);
    }
}

// ---------------------------------------------------------------------------
// Stock-page plumbing
// ---------------------------------------------------------------------------

// Read the stock progress bar's class rather than trusting the control id: if
// NSIS ever renumbers its template, PBM_* messages sent to whatever now holds
// that id would be meaningless, and a malformed PBRANGE read is worse than that.
bool IsProgressBar(HWND window) {
    if (!window) return false;
    WCHAR name[64] = {};
    if (GetClassNameW(window, name, ARRAYSIZE(name)) <= 0) return false;
    return _wcsicmp(name, kStockProgressClass) == 0;
}

// The page dialog is the progress bar's parent. The check that it is a child
// window is the important half: the outer NSIS dialog is top-level, and hiding
// *it* would hide the entire installer.
HWND StockPageFor(HWND source, HWND outer) {
    HWND page = source ? GetParent(source) : nullptr;
    if (!page || page == outer) return nullptr;
    return (GetWindowLongW(page, GWL_STYLE) & WS_CHILD) ? page : nullptr;
}

// NSIS shows its page after MUI's SHOW callback returns; keep its controls off
// screen by refusing every request to show the page, whenever it arrives.
LRESULT CALLBACK HiddenPageProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam,
                                UINT_PTR id, DWORD_PTR) {
    if (message == WM_WINDOWPOSCHANGING) {
        auto* position = reinterpret_cast<WINDOWPOS*>(lparam);
        if (position) position->flags = (position->flags & ~SWP_SHOWWINDOW) | SWP_HIDEWINDOW;
    }
    if (message == WM_NCDESTROY) RemoveWindowSubclass(window, HiddenPageProc, id);
    return DefSubclassProc(window, message, wparam, lparam);
}

// ---------------------------------------------------------------------------
// The frame: no non-client area, and nothing drawn inside it
// ---------------------------------------------------------------------------
//
// WM_NCCALCSIZE returning 0 gives the client area the whole window rect, which
// is what lets a 600x600 page exist inside a dialog whose template is smaller.
// The rest of this procedure, and the DWM calls in InstallerApplyFrame, exist to
// make sure the frame that a window with WS_THICKFRAME implies is never drawn
// INTO that client area. Three things used to be:
//
//   * DwmExtendFrameIntoClientArea({1,1,1,1}) -- the real defect. Extending the
//     frame puts the DWM's frame band on top of pixels the page had already
//     painted: a light grey strip down every edge of the branded surface.
//   * the Windows 11 corner preference was requested as ROUND (2), which cut an
//     8 px arc out of each corner. That is the "grey block" in the top-left:
//     outside the rounded corner there is no window, so the shadow and the
//     desktop behind it showed through.
//   * the 1 px border Windows 11 draws around a framed window, which is a
//     separate attribute from the frame band and has to be turned off by name.
//
// WS_THICKFRAME itself is kept deliberately, and NOT for the shadow: with the
// frame no longer extended, a BitBlt of the desktop just outside the window edge
// shows no shadow gradient at all on this build of Windows (measured, not
// assumed -- see the note in InstallerApplyFrame). It is kept because it is what
// makes DefWindowProc start a move loop for the HTCAPTION the script sends for
// the caption drag; dropping it would cost the only way to move a window that has
// no caption bar. The frame it implies is neutralised here and by the DWM
// attributes below, and the hit test turns every resize edge into client area, so
// the thick frame is never an invitation to resize a window whose layout is
// fixed. A visible frame is the defect; the shadow was only ever a nicety.
LRESULT CALLBACK FrameProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam,
                           UINT_PTR id, DWORD_PTR) {
    if (message == WM_NCCALCSIZE && wparam) return 0;
    if (message == WM_NCHITTEST) {
        const LRESULT hit = DefSubclassProc(window, message, wparam, lparam);
        // WS_THICKFRAME is set for the DWM shadow, not to make the installer
        // resizable; the overlay provides the drag area and the size is fixed.
        return hit >= HTLEFT && hit <= HTBOTTOMRIGHT ? HTCLIENT : hit;
    }
    if (message == WM_NCDESTROY) {
        RemoveWindowSubclass(window, FrameProc, id);
        RemovePropW(window, kPropFramed);
    }
    return DefSubclassProc(window, message, wparam, lparam);
}

// ---------------------------------------------------------------------------
// Progress overlay
// ---------------------------------------------------------------------------

struct ProgressPage {
    ProgressPage(HWND owner, HWND bar)
        : progress(GetTickCount64()), parent(owner), source(bar), dark(false), dpi(96),
          gdiplus(0), brand(nullptr), paintedPercent(-1), paintedCaption(-1) {
        caption[0] = L'\0';
    }

    ProgressModel progress;
    HWND parent;    // the NSIS dialog: the only top-level window in this installer
    HWND source;    // the stock progress bar the script handed over, possibly unusable
    bool dark;
    UINT dpi;
    ULONG_PTR gdiplus;
    Image* brand;
    int paintedPercent;   // what the last painted frame says; -1 until the first tick
    int paintedCaption;
    WCHAR caption[192];   // formatted once per change, drawn and published from here
    WCHAR captions[kStageCount][128];
};

// The captions arrive as printf formats and go through wsprintfW with the
// percentage. A caption carrying any other conversion (a translator's typo, a
// stray %s) would read a garbage argument off the stack, so everything that is
// not %d or %% is escaped to a literal before the format is stored.
void CopyCaption(WCHAR (&target)[128], LPCWSTR source) {
    int out = 0;
    for (int index = 0; source && source[index] && out < 126; ++index) {
        if (source[index] == L'%' && source[index + 1] != L'd' && source[index + 1] != L'%') {
            target[out++] = L'%';
            if (out < 126) target[out++] = L'%';
            continue;
        }
        target[out++] = source[index];
    }
    target[out] = L'\0';
}

// The real progress source: NSIS's own bar. Returns kNoReading when the control
// is not a progress bar, has been destroyed, or has an empty range. What it
// returns when the bar exists and is simply never driven is a constant 0, and
// the model treats that as "no progress news" rather than as progress -- see the
// measured note in Advance() in progress.h. Nothing here invents a number.
double ReadStockPercent(const ProgressPage* page) {
    HWND bar = page->source;
    if (!IsProgressBar(bar)) return kNoReading;
    PBRANGE range = {};
    SendMessageW(bar, PBM_GETRANGE, FALSE, reinterpret_cast<LPARAM>(&range));
    const int span = range.iHigh - range.iLow;
    if (span <= 0) return kNoReading;
    const int position = static_cast<int>(SendMessageW(bar, PBM_GETPOS, 0, 0));
    double percent = (position - range.iLow) * 100.0 / span;
    if (percent < 0.0) percent = 0.0;
    if (percent > 100.0) percent = 100.0;
    return percent;
}

// One tick: sample, advance, and repaint only if the frame would differ.
void TickProgress(HWND window, ProgressPage* page) {
    if (!page) return;
    // Phaneris.Stage is published only by customInstall (4, once the files are
    // down). 0 is also what GetPropW reports for "absent", so it is treated as
    // absent and the caption is derived from the percentage instead of sitting on
    // one stage for the whole section -- which is what it used to do, and what
    // made the copy read "extracting" through the shortcut and registry work.
    const int stage = IntProp(page->parent, kPropStage);
    page->progress.Advance(stage > 0 ? stage : kStageUnset, ReadStockPercent(page), GetTickCount64());

    const int percent = page->progress.Percent();
    const int captionStage = page->progress.CaptionStage();
    if (percent == page->paintedPercent && captionStage == page->paintedCaption) return;
    page->paintedPercent = percent;
    page->paintedCaption = captionStage;
    wsprintfW(page->caption, page->captions[captionStage], percent);
    // Kept current even while the surface is occluded or minimised, when no
    // WM_PAINT arrives; it is also what the window's accessible name reads.
    SetWindowTextW(window, page->caption);
    InvalidateRect(window, nullptr, FALSE);
}

void PaintProgress(HWND window, ProgressPage* page, HDC dc) {
    const int size = DesignPixels(kDesignSize, page->dpi);
    const Palette palette = PaletteFor(page->dark);

    Bitmap buffer(size, size, PixelFormat32bppPARGB);
    Graphics graphics(&buffer);
    graphics.ScaleTransform(page->dpi / 96.0f, page->dpi / 96.0f);
    graphics.Clear(Color(palette.background));
    graphics.SetSmoothingMode(SmoothingModeAntiAlias);
    graphics.SetInterpolationMode(InterpolationModeHighQualityBicubic);
    graphics.SetPixelOffsetMode(PixelOffsetModeHalf);

    if (page->brand) graphics.DrawImage(page->brand, BoxRect(kBrandBox));

    SolidBrush track{Color(palette.track)};
    SolidBrush ink{Color(palette.ink)};
    FillProgress(graphics, track, kTrackBox.width);
    FillProgress(graphics, ink, kTrackBox.width * static_cast<REAL>(page->progress.Value()) / 100.0f);

    StringFormat centered;
    MakeCentered(centered);
    DrawRun(graphics, page->caption, kStatusPixels, FontStyleRegular, BoxRect(kStatusBox), centered, ink);
    DrawRun(graphics, L"\x2212", kGlyphPixels, FontStyleRegular, BoxRect(kMinimizeBox), centered, ink);
    DrawRun(graphics, L"\x00d7", kGlyphPixels, FontStyleRegular, BoxRect(kCloseBox), centered, ink);

    Graphics screen(dc);
    screen.DrawImage(&buffer, 0, 0);
}

LRESULT CALLBACK ProgressProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    auto* page = reinterpret_cast<ProgressPage*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    switch (message) {
    case WM_CREATE:
        page = static_cast<ProgressPage*>(reinterpret_cast<CREATESTRUCTW*>(lparam)->lpCreateParams);
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(page));
        SetTimer(window, kProgressTimer, 16, nullptr);
        // One tick before the first paint, so the bar never shows an empty
        // caption and the timer's change test starts from a known frame.
        TickProgress(window, page);
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_TIMER:
        if (wparam == kProgressTimer) {
            TickProgress(window, page);
            return 0;
        }
        break;
    case WM_LBUTTONDOWN:
        if (page) {
            const int x = LOWORD(lparam) * 96 / static_cast<int>(page->dpi);
            const int y = HIWORD(lparam) * 96 / static_cast<int>(page->dpi);
            // Nothing on the progress page reacts to a press except the caption
            // band, and closing it cancels the install NSIS is still running.
            if (InCaptionBand(y) && x >= static_cast<int>(kCloseBox.left)) {
                PostMessageW(page->parent, WM_CLOSE, 0, 0);
            } else {
                RunCaptionAction(page->parent, x, y);
            }
            return 0;
        }
        break;
    case WM_PAINT: {
        PAINTSTRUCT paint = {};
        HDC dc = BeginPaint(window, &paint);
        if (page) PaintProgress(window, page, dc);
        EndPaint(window, &paint);
        return 0;
    }
    case WM_NCDESTROY:
        if (page) {
            KillTimer(window, kProgressTimer);
            SetWindowLongPtrW(window, GWLP_USERDATA, 0);
            delete page->brand;
            if (page->gdiplus) GdiplusShutdown(page->gdiplus);
            delete page;
        }
        break;
    default:
        break;
    }
    return DefWindowProcW(window, message, wparam, lparam);
}

}  // namespace

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// Called exactly once, from the script's MUI_CUSTOMFUNCTION_GUIINIT hook: the
// pages it dresses do not exist yet, and re-dressing them would be a second
// window procedure on the same window. A repeat call is therefore a no-op that
// still reports success -- an earlier version returned E_FAIL from the second
// call and skipped the stock-control sweep with it, which is how MUI's finish
// chrome ended up on screen over the branded page.
extern "C" __declspec(dllexport) HRESULT __cdecl InstallerApplyFrame(HWND window) {
    if (!window || !IsWindow(window)) {
        SetIntProp(window, kPropFrameError, 1);
        return E_INVALIDARG;
    }

    // NSIS may release its DLL reference before the window receives
    // WM_NCDESTROY, and the subclass procedure below runs after that. Pinning is
    // the belt to that braces; the script also loads this module by full path
    // before any page exists, and a module with a live reference of its own
    // cannot be unloaded by NSIS either. So a refused pin is recorded and the
    // dressing continues: refusing outright would take a whole installer down
    // over a lifetime guarantee that is already covered twice.
    HMODULE module = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_PIN | GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
                            reinterpret_cast<LPCWSTR>(&FrameProc), &module)) {
        SetIntProp(window, kPropFrameError, 2);
    }
    PinModule();

    if (!GetPropW(window, kPropFramed)) {
        if (!SetWindowSubclass(window, FrameProc, kFrameSubclass, 0)) {
            SetIntProp(window, kPropFrameError, 3);
            return E_FAIL;
        }
        SetIntProp(window, kPropFramed, 1);
    }

    for (int id : kStockControlIds) {
        HWND child = GetDlgItem(window, id);
        if (!child) continue;
        if (!GetPropW(child, kPropPageHidden)) {
            SetWindowSubclass(child, HiddenPageProc, kHiddenPageSubclass, 0);
            SetIntProp(child, kPropPageHidden, 1);
        }
        ShowWindow(child, SW_HIDE);
    }

    // The window keeps a thick frame so the caption drag keeps working, and the
    // frame it implies is then switched off piece by piece: the DWM renders the
    // non-client area (the default, kept so this stays a composited window), the
    // corners are asked to stay square, the Windows 11 border is set to none, and
    // -- the one that matters most -- the frame is NOT extended into the client
    // area. Extending it is what put a grey strip down every edge of the branded
    // page, and the requested ROUND corners are what put a grey wedge in the
    // corner, where the desktop showed through the arc cut out of the window.
    //
    // No shadow comes back from this, and that was measured rather than assumed:
    // a screen capture of a rect padded 40 px around the window shows the desktop
    // immediately outside the edge with no gradient at all. An installer with no
    // shadow and no frame is the trade this file deliberately makes -- a frame
    // drawn over the page is a defect a user sees, a missing shadow is not.
    //
    // Idempotent: styles and attributes are set, not toggled, so the second call
    // from the InstFiles page's SHOW callback is harmless.
    SetWindowLongW(window, GWL_STYLE, GetWindowLongW(window, GWL_STYLE) | WS_THICKFRAME);
    const DWMNCRENDERINGPOLICY policy = DWMNCRP_ENABLED;
    DwmSetWindowAttribute(window, DWMWA_NCRENDERING_POLICY, &policy, sizeof(policy));
    // Both Windows 11 attributes are best effort and deliberately unchecked:
    // neither exists before build 22000, where the call fails with E_INVALIDARG
    // and square, borderless geometry is already the right answer. They must not
    // be able to fail InstallerApplyFrame, because the script reads success from
    // its own marker property and a returned failure here would be a whole
    // installer refusing to start over a corner radius.
    const DWORD corners = DWMWCP_DONOTROUND;
    DwmSetWindowAttribute(window, DWMWA_WINDOW_CORNER_PREFERENCE, &corners, sizeof(corners));
    const COLORREF noBorder = DWMWA_COLOR_NONE;
    DwmSetWindowAttribute(window, DWMWA_BORDER_COLOR, &noBorder, sizeof(noBorder));
    // Deliberately absent: DwmExtendFrameIntoClientArea. The comment above says
    // why. Nothing here may draw inside a client area the pages own completely.
    SetWindowPos(window, nullptr, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    return S_OK;
}

// Runs on the NSIS UI thread, from the InstFiles page's SHOW callback, while the
// stock installation section is still ahead of it on NSIS's worker thread.
extern "C" __declspec(dllexport) HWND __cdecl InstallerShowProgress(
    HWND parent, HWND source, BOOL dark, UINT dpi, LPCWSTR brand, LPCWSTR preparing,
    LPCWSTR extracting, LPCWSTR copying, LPCWSTR registering, LPCWSTR cleaning) {
    try {
        if (!parent || !IsWindow(parent)) return nullptr;
        PinModule();

        WNDCLASSW type = {};
        type.lpfnWndProc = ProgressProc;
        type.hInstance = GetModuleHandleW(nullptr);
        type.lpszClassName = kProgressClass;
        type.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        RegisterClassW(&type);

        auto* surface = new (std::nothrow) ProgressPage(parent, source);
        if (!surface) return nullptr;

        GdiplusStartupInput startup;
        if (GdiplusStartup(&surface->gdiplus, &startup, nullptr) != Ok) {
            delete surface;
            return nullptr;
        }
        surface->dark = dark != FALSE;
        surface->dpi = ResolveDpi(dpi);
        const WCHAR* captions[kStageCount] = {preparing, extracting, copying, registering, cleaning};
        for (int index = 0; index < kStageCount; ++index) CopyCaption(surface->captions[index], captions[index]);
        if (brand && *brand) surface->brand = new Image(brand);
        if (surface->brand && surface->brand->GetLastStatus() != Ok) {
            delete surface->brand;
            surface->brand = nullptr;
        }

        // The stock page is what has to disappear. The overlay lives on the
        // outer dialog, so hiding the page cannot hide the overlay as well.
        HWND stockPage = StockPageFor(source, parent);
        if (stockPage) {
            if (!GetPropW(stockPage, kPropPageHidden)) {
                SetWindowSubclass(stockPage, HiddenPageProc, kHiddenPageSubclass, 0);
                SetIntProp(stockPage, kPropPageHidden, 1);
            }
            ShowWindow(stockPage, SW_HIDE);
        }

        const int size = DesignPixels(kDesignSize, surface->dpi);
        HWND window = CreateWindowExW(0, kProgressClass, L"", WS_CHILD | WS_VISIBLE, 0, 0, size, size,
                                      parent, nullptr, GetModuleHandleW(nullptr), surface);
        if (!window) {
            delete surface->brand;
            GdiplusShutdown(surface->gdiplus);
            delete surface;
            return nullptr;
        }
        // Top of the child z-order: the overlay exists to cover the page below
        // it, and it must not be covered by anything NSIS creates later.
        SetWindowPos(window, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        return window;
    } catch (const std::bad_alloc&) {
        return nullptr;
    }
}

// NSIS has already reported success. Pump the UI for the bounded final
// animation, including a painted 100% frame, before the script destroys this
// window and builds the interactive finish page in its place.
//
// The 1000 ms budget is 250 ms longer than the reference's 750, and the reason
// is the frame at the end of it: with kCompleteMillis at 420 the bar sits at
// exactly 100 % for ~580 ms instead of ~270. A completed bar that flashes past
// in a quarter of a second reads as a glitch rather than as "done" -- and it is
// also what the harness samples, 150 ms at a time, to prove the success path is
// the only thing that ever paints 100.
extern "C" __declspec(dllexport) BOOL __cdecl InstallerFinishProgress(HWND window) {
    auto* page = reinterpret_cast<ProgressPage*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (!page) return FALSE;
    const ULONGLONG started = GetTickCount64();
    page->progress.Complete(started);
    while (IsWindow(window) && GetTickCount64() - started < 1000) {
        MSG message = {};
        if (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
            if (message.message == WM_QUIT) {
                PostQuitMessage(static_cast<int>(message.wParam));
                return FALSE;
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        } else {
            MsgWaitForMultipleObjectsEx(0, nullptr, 16, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        }
        TickProgress(window, page);
    }
    if (!IsWindow(window)) return FALSE;
    // One synchronous frame, so the 100 % state is on screen before this returns
    // even if the window was never repainted during the pump.
    InvalidateRect(window, nullptr, FALSE);
    UpdateWindow(window);
    return TRUE;
}

// Present the first interactive page after resource preparation without keeping
// the installer topmost.
extern "C" __declspec(dllexport) BOOL __cdecl InstallerPresentWelcome(HWND window) {
    if (!window || !IsWindowVisible(window)) return FALSE;
    if (!SetWindowPos(window, HWND_TOP, 0, 0, 0, 0,
                      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)) {
        return FALSE;
    }
    if (GetForegroundWindow() != window) {
        FLASHWINFO flash = {};
        flash.cbSize = sizeof(flash);
        flash.hwnd = window;
        flash.dwFlags = FLASHW_TRAY | FLASHW_TIMERNOFG;
        FlashWindowEx(&flash);
    }
    return TRUE;
}

// Returns a Win32 error code; no cleanup request may traverse a linked root or
// touch the protected root. Match the affected executable, not another user's or
// directory's same-named application. Returns 0 while running, 1 when absent,
// and -1 if the process list cannot be read.
extern "C" __declspec(dllexport) int __cdecl InstallerFindProcess(LPCWSTR executable) {
    if (!executable) return -1;
    WCHAR target[32768];
    DWORD length = GetLongPathNameW(executable, target, ARRAYSIZE(target));
    LPCWSTR expected = length > 0 && length < ARRAYSIZE(target) ? target : executable;
    LPCWSTR filename = wcsrchr(expected, L'\\');
    filename = filename ? filename + 1 : expected;
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return -1;
    PROCESSENTRY32W entry = {};
    entry.dwSize = sizeof(entry);
    int result = 1;
    BOOL present = Process32FirstW(snapshot, &entry);
    while (present) {
        if (_wcsicmp(entry.szExeFile, filename) == 0) {
            HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, entry.th32ProcessID);
            if (process) {
                WCHAR path[32768];
                DWORD count = ARRAYSIZE(path);
                if (QueryFullProcessImageNameW(process, 0, path, &count) && _wcsicmp(path, expected) == 0) result = 0;
                CloseHandle(process);
                if (result == 0) break;
            }
        }
        present = Process32NextW(snapshot, &entry);
    }
    if (!present && GetLastError() != ERROR_NO_MORE_FILES) result = -1;
    CloseHandle(snapshot);
    return result;
}
