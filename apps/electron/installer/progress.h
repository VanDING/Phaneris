// progress.h — the progress overlay's state model and layout, shared by
// `window-frame.cpp` (the plugin) and, through comments only, `installer-pages.nsh`.
//
// WHY THIS FILE EXISTS
//
//   The installer's surface is authored in two languages that cannot include
//   each other: NSIS owns the flow and the copy, the plugin owns every pixel of
//   the one window it draws. Everything the two must agree on — the stage
//   numbering, the window property the script publishes it through, the 96-dpi
//   layout grid and the palette — lives here so the two sides cannot drift apart
//   silently.
//
//   Since the rewrite the plugin owns exactly one surface: the progress overlay
//   that covers the stock InstFiles page. The welcome and finish pages are
//   ordinary NSIS pages built with nsDialogs, so none of their layout belongs
//   here any more, and neither do the action codes and path-rejection codes the
//   deleted custom windows used to exchange with the script.
//
//   It is header-only on purpose: the plugin is two translation units and there
//   is no project file to register a third. `scripts/build-installer-plugin.cjs`
//   compiles window-frame.cpp alone.
//
// WHAT IS IN HERE
//
//   1. The stage numbering and the one window property that crosses the boundary.
//   2. The 96-dpi layout grid, as plain boxes so this header stays free of GDI+.
//   3. The palette, light and dark, as 0xAARRGGBB.
//   4. ProgressModel, the bar's state machine.
//
// No GDI+, no STL, no allocation: everything here is constexpr or a small inline
// class, so it is safe to include anywhere in the plugin.

#ifndef PHANERIS_INSTALLER_PROGRESS_H
#define PHANERIS_INSTALLER_PROGRESS_H

#include <algorithm>
#include <cmath>

namespace phaneris {

// ---------------------------------------------------------------------------
// 1. The script/plugin contract
// ---------------------------------------------------------------------------
//
// One property can cross the boundary, and it is written by NSIS:
//
//   Phaneris.Stage   int  NSIS -> plugin, 4 once the files are down and the
//                         leftovers are being cleaned up.
//
// It is now optional and deliberately unused for the first four bands: the
// caption follows the value (see DeriveStage), because an install section that
// publishes one stage for its whole duration can only ever pin the caption. A
// published stage can still move the caption forward, and customInstall uses it
// for the one thing the script knows better than the percentage does.
//
// The name is frozen: `System::Call 'user32::SetPropW(...)'` in
// installer-pages.nsh writes it by literal string, and a rename here would
// silently drop the only stage the script publishes instead of failing to
// compile.
//
// Everything else the old design exchanged through window properties is gone
// with the custom windows. Real progress is not a property at all: the script
// hands the plugin the stock InstFiles progress bar, and the plugin asks that
// control directly -- see the measured limits of that source in section 4.
constexpr wchar_t kPropStage[] = L"Phaneris.Stage";

// Caption index 0..4. kStageUnset is what the plugin passes when the script has
// published nothing, so the caption can follow the percentage instead of
// sitting on "preparing" for the whole install.
constexpr int kStagePreparing = 0;
constexpr int kStageExtracting = 1;
constexpr int kStageCopying = 2;
constexpr int kStageRegistering = 3;
constexpr int kStageCleaning = 4;
constexpr int kStageCount = 5;
constexpr int kStageUnset = -1;

// The stock control the overlay reads. 1004 is the InstFiles page's own
// progress bar (`$mui.InstFilesPage.ProgressBar`); the plugin still verifies the
// window class before sending it PBM_* messages, because a renumbered template
// would otherwise turn a malformed PBRANGE read into a garbage percentage.
constexpr wchar_t kStockProgressClass[] = L"msctls_progress32";

// ---------------------------------------------------------------------------
// 2. Layout grid — 96 dpi design units
// ---------------------------------------------------------------------------
//
// Every number below is a literal from the visual specification, in the 600x600
// client area. The plugin scales the whole canvas with
// `graphics.ScaleTransform(dpi / 96.0f, dpi / 96.0f)` and makes the window's
// client area exactly MulDiv(600, dpi, 96) square, so these stay readable and
// nothing is pre-multiplied by hand.

constexpr int kDesignSize = 600;

// A plain box, converted to Gdiplus::RectF at the drawing site. Kept separate
// from RectF so this header does not have to pull in GDI+.
struct Box {
    float left;
    float top;
    float width;
    float height;
};

// The brand lockup. The committed asset is 600x176 (and a 1200x352 @2x variant);
// DrawImage scales either into this box.
constexpr Box kBrandBox = {0.0f, 148.0f, 600.0f, 176.0f};

constexpr Box kTrackBox = {144.0f, 452.0f, 312.0f, 4.0f};
constexpr float kTrackCorner = 4.0f;               // px of rounded end on the track
constexpr Box kStatusBox = {144.0f, 420.0f, 252.0f, 22.0f};
constexpr Box kPercentBox = {404.0f, 420.0f, 52.0f, 22.0f};
constexpr float kStatusPixels = 15.0f;

// Caption buttons: glyphs, not bitmaps, centred in their boxes.
constexpr Box kMinimizeBox = {504.0f, 8.0f, 40.0f, 32.0f};
constexpr Box kCloseBox = {548.0f, 8.0f, 40.0f, 32.0f};
constexpr float kGlyphPixels = 16.0f;
constexpr float kCaptionBandHeight = 48.0f;        // y < 48 is chrome; below is content

// Is a design-unit point inside a design-unit box? Used for every hit test, so
// the hit region cannot drift from the painted one.
inline bool Hit(const Box& box, int x, int y) {
    return x >= static_cast<int>(box.left) && x < static_cast<int>(box.left + box.width) &&
           y >= static_cast<int>(box.top) && y < static_cast<int>(box.top + box.height);
}

// ---------------------------------------------------------------------------
// 3. Palette
// ---------------------------------------------------------------------------
//
// ARGB, ready for `Gdiplus::Color(argb)`. The values are the brand's own (the
// icon artwork's violet and the app theme's neutrals); `surface` is the only
// derived one. The NSIS side repeats the light/dark choice in
// `InstallerResolveTheme` because SetCtlColors only takes compile-time colours,
// so a change here has to be mirrored there.

constexpr unsigned Argb(unsigned char a, unsigned char r, unsigned char g, unsigned char b) {
    return (static_cast<unsigned>(a) << 24) | (static_cast<unsigned>(r) << 16) |
           (static_cast<unsigned>(g) << 8) | static_cast<unsigned>(b);
}

constexpr unsigned kBackgroundLight = Argb(255, 0xFF, 0xFF, 0xFF);  // #FFFFFF
constexpr unsigned kBackgroundDark = Argb(255, 0x15, 0x15, 0x17);   // #151517
constexpr unsigned kInkLight = Argb(255, 0x0F, 0x11, 0x15);         // #0F1115
constexpr unsigned kInkDark = Argb(255, 0xFF, 0xFF, 0xFF);          // #FFFFFF
constexpr unsigned kTrackLight = Argb(255, 0xE9, 0xEC, 0xF2);       // #E9ECF2
constexpr unsigned kTrackDark = Argb(255, 0x33, 0x33, 0x3B);       // #33333B
constexpr unsigned kMutedLight = Argb(255, 0x64, 0x65, 0x70);      // #646570
constexpr unsigned kMutedDark = Argb(255, 0xA5, 0xA5, 0xB0);       // #A5A5B0
constexpr unsigned kAccentLight = Argb(255, 0x73, 0x3D, 0xF4);     // #733DF4
constexpr unsigned kAccentDark = Argb(255, 0x98, 0x73, 0xFF);       // #9873FF

// Everything the drawing code needs, resolved once per surface from `dark`.
struct Palette {
    unsigned background;
    unsigned ink;
    unsigned track;
    unsigned muted;
    unsigned accent;
};

inline Palette PaletteFor(bool dark) {
    Palette palette;
    palette.background = dark ? kBackgroundDark : kBackgroundLight;
    palette.ink = dark ? kInkDark : kInkLight;
    palette.track = dark ? kTrackDark : kTrackLight;
    palette.muted = dark ? kMutedDark : kMutedLight;
    palette.accent = dark ? kAccentDark : kAccentLight;
    return palette;
}

// ---------------------------------------------------------------------------
// 4. ProgressModel
// ---------------------------------------------------------------------------
//
// THE HONEST PROBLEM, MEASURED
//
//   The intent was that the stock InstFiles progress bar is the real number and
//   the elapsed-time term only fills the gaps. That is not what the artifact
//   does, and three runs of `verify-windows-installer.ps1` say so: the bar read
//   0 % in every one of ~250 samples across a 49-second install section, and the
//   overlay peaked at 39 %, then sat at 32 % for 33 seconds.
//
//   The reason is structural, not a bug in one line: electron-builder extracts
//   the app with the nsis7z plugin, which never drives NSIS's own bar. Nothing
//   in the stock install section publishes an extraction fraction at all. The
//   reference installer does not have this problem because it owns extraction --
//   window-frame.dll there runs its own 7za and publishes the fraction -- and
//   taking extraction over is the real fix. This model is the honest fallback
//   for not having done that: a TIME-BOUNDED ESTIMATE, capped by the band the
//   bar is in, that is only ever *raised* by a reading that is really moving.
//
// THE TWO SOURCES
//
//   1. the stock bar, accepted only while it is MOVING (see Advance below);
//   2. otherwise, elapsed time in the current band, approaching that band's
//      ceiling with an exponential half-life.
//
//   Source 1 is a floor, source 2 is the driver, and the value is monotone:
//   it never decreases, never exceeds the ceiling of the band it is in, and
//   never reaches 100 except through Complete(). 100 % while files are still
//   being written is a lie the user notices, and it makes the closing animation
//   meaningless, so the only frame that reads 100 is the one Complete()
//   authorises.

constexpr double kNoReading = -1.0;

// Per band: how far the time model may creep, and how fast. Extraction is the
// long, uneven one, so it owns the widest band and the slowest approach.
constexpr double kStageCeiling[kStageCount] = {8.0, 74.0, 92.0, 98.0, 99.0};

// The value at which the caption -- and with it the ceiling -- moves on to the
// next band. Strictly BELOW that band's own ceiling, and that is load-bearing
// rather than tidy: an exponential approach never reaches its ceiling, so a
// stage test written against kStageCeiling itself can never fire. That is
// exactly the shape of the measured 32 %-for-33-seconds stall.
constexpr double kStageAdvance[kStageCount - 1] = {7.0, 66.0, 84.0, 95.0};

// Seconds to cover half of the remaining distance to the band's ceiling. Tuned
// against the one duration this artifact actually has -- a 49-second install
// section on the reference machine, measured, from a 150 ms sampler -- so that
// the captions walk 准备 -> 解压 -> 安装 -> 完成 -> 清理 across it (measured at
// 1.8 s, 20 s, 29 s, 38 s) and the bar is still moving at 49 s instead of
// parking at 99 % after twenty seconds. A faster machine simply finishes earlier
// in the walk; a much slower one parks near 99 % with the caption on 清理, which
// is the best this estimate can honestly claim without an extraction fraction.
constexpr double kStageHalfLife[kStageCount] = {0.6, 6.0, 5.0, 4.0, 5.0}; // seconds

constexpr unsigned long long kStallMillis = 2000;  // no movement for this long = not a progress source
constexpr double kReadingStep = 0.05;              // a larger reading than this is movement, not jitter
constexpr double kReadingReset = 1.0;              // a drop this large is the source restarting, not progress
constexpr double kCompleteMillis = 420.0;          // length of the final run to 100 %
constexpr double kAutoCeiling = 99.0;              // the highest value anything but Complete() may paint

// Which caption belongs to a value. The bands above are the authority, so the
// caption and the ceiling can never disagree about where a value belongs.
inline int DeriveStage(double value) {
    int stage = 0;
    while (stage < kStageCount - 1 && value >= kStageAdvance[stage]) ++stage;
    return stage;
}

class ProgressModel {
public:
    explicit ProgressModel(unsigned long long now)
        : value_(0.0), estimate_(0.0), reading_(kNoReading), stage_(kStagePreparing), tick_(now),
          readingAt_(now), completeAt_(0), completeFrom_(0.0), completing_(false),
          haveReading_(false), moving_(false) {}

    // One 16 ms tick. `stage` is 0..4 from Phaneris.Stage, or kStageUnset when
    // the script has not written one; `reading` is the stock bar's percentage, or
    // kNoReading when the control could not produce one.
    void Advance(int stage, double reading, unsigned long long now) {
        if (completing_) {
            const double elapsed = static_cast<double>(now - completeAt_);
            const double t = elapsed >= kCompleteMillis ? 1.0 : elapsed / kCompleteMillis;
            // Cubic ease-out: fast off the mark, gentle into the end, and it
            // lands exactly on 100 so the final frame is a filled bar.
            const double eased = 1.0 - std::pow(1.0 - t, 3.0);
            value_ = t >= 1.0 ? 100.0 : completeFrom_ + (100.0 - completeFrom_) * eased;
            tick_ = now;
            return;
        }

        const double dt = now > tick_ ? static_cast<double>(now - tick_) / 1000.0 : 0.0;
        tick_ = now;

        // A reading counts only while the source is MOVING, and the first value
        // is a baseline rather than progress. Both halves of that rule come from
        // measurement:
        //
        //   * the bar still holds a pre-section value when the InstFiles page is
        //     created -- measured at 24 % at WM_CREATE on a run whose section
        //     then read 0 % for 49 seconds -- and a rule that accepted it as a
        //     floor pinned the overlay at 32 % for the rest of the install;
        //   * a source that jumps backwards has restarted, and NSIS's InstFiles
        //     bar does exactly that between phases: measured pos=15283 at 5 s,
        //     pos=5640 at 20 s, pos=19302 at 35 s on a 0..30000 range. The value
        //     it was holding was that phase's progress, not the install's, so the
        //     next increase is what re-arms it.
        if (reading >= 0.0) {
            const double measured = reading > 100.0 ? 100.0 : reading;
            if (!haveReading_) {
                haveReading_ = true;
                reading_ = measured;
                readingAt_ = now;
            } else if (measured > reading_ + kReadingStep) {
                reading_ = measured;
                readingAt_ = now;
                moving_ = true;
            } else if (measured < reading_ - kReadingReset) {
                reading_ = measured;
                readingAt_ = now;
                moving_ = false;
            }
        }
        const bool live = moving_ && reading_ > 0.0 && now - readingAt_ < kStallMillis;

        // The caption is the band the painted value is in, and a stage the script
        // published may only move it FORWARD. It used to be able to pin it:
        // the script published stage 1 for the whole section, the caption said
        // "extracting" through the shortcut and registry work, and the stage's
        // 74 % ceiling capped the bar there as well.
        //
        // It is derived from the value BELOW, after the value has moved, not from
        // the value this tick started with. Deriving it first left one 16 ms
        // frame per band change saying the old band's caption over the new band's
        // number -- and the frame a screen capture is most likely to catch is
        // exactly the one where the number jumped.
        const int published = stage >= 0 ? (stage < kStageCount ? stage : kStageCount - 1)
                                         : kStageUnset;

        // The ESTIMATE has its own clock, and it is not allowed to be pushed
        // along by a reading. It was, in the first version of this model: the
        // bar's 23 % pre-section value and its 51 % phase jump lifted the value,
        // the value chose the band, and the band raised the estimate's ceiling --
        // so a 49-second install reached 99 % at 33 seconds and sat there. The
        // estimate's band comes from the estimate.
        const int estimateStage = published > DeriveStage(estimate_)
                                      ? published
                                      : DeriveStage(estimate_);
        double ceiling = kStageCeiling[estimateStage];
        if (ceiling < estimate_) ceiling = estimate_;
        const double approach = 1.0 - std::pow(0.5, dt / kStageHalfLife[estimateStage]);
        estimate_ += (ceiling - estimate_) * approach;

        // ... and a moving measurement is the truth, so it is a FLOOR on what is
        // displayed, never a ceiling and never a fence. There is deliberately no
        // "how far ahead of the bar may the estimate run" clamp any more: the
        // old one let a stalled or dead source hold the whole bar down to
        // `reading + 10`, which is where a permanent 0 % reading put it, and the
        // bar's own phase resets make any such bound meaningless.
        double next = estimate_;
        if (live) next = (std::max)(next, reading_);

        value_ = (std::min)((std::max)(next, value_), kAutoCeiling);
        stage_ = published > DeriveStage(value_) ? published : DeriveStage(value_);
    }

    // NSIS reported success. Everything else stops mattering: the bar runs to
    // 100 % on its own clock so the caller can pump messages for a fixed budget.
    void Complete(unsigned long long now) {
        if (completing_) return;
        completing_ = true;
        completeAt_ = now;
        completeFrom_ = value_ > 100.0 ? 100.0 : value_;
    }

    double Value() const { return value_; }

    // Truncated, never rounded: 99.6 % still reads 99, so the only frame that
    // says 100 is one that actually is.
    int Percent() const { return value_ >= 100.0 ? 100 : static_cast<int>(value_); }

    int CaptionStage() const { return stage_; }

    bool Completing() const { return completing_; }

private:
    double value_;       // what is painted: the estimate, lifted by a moving reading
    double estimate_;    // the time-bounded ramp, with a clock of its own
    double reading_;
    int stage_;
    unsigned long long tick_;
    unsigned long long readingAt_;
    unsigned long long completeAt_;
    double completeFrom_;
    bool completing_;
    bool haveReading_;   // the first value is a baseline, not progress
    bool moving_;        // ... and only a later increase makes it a floor
};

} // namespace phaneris

#endif // PHANERIS_INSTALLER_PROGRESS_H
