import i18n, { type i18n as I18nInstance, type InitOptions } from "i18next";
import { LOCALE_REGISTRY, loadLocaleMessages, type LanguageCode } from "./registry";
import { SUPPORTED_LANGUAGE_CODES } from "./languages";
import enMessages from "./locales/en.json";

// Only the English fallback ships inline; every other locale is loaded on
// demand by ensureLocaleResources() so the initial bundle stays small.
const resources = {
  en: { translation: enMessages },
};

// Safe as a boolean guard because init is synchronous (initImmediate: false).
// If async init is ever needed, replace with a promise-based singleton.
let initialized = false;
let startupReady: Promise<void> = Promise.resolve();

export function whenI18nReady(): Promise<void> { return startupReady; }

/**
 * Keep `<html lang>` in step with the active locale.
 *
 * The document is authored as `lang="en"`, and nothing used to update it, so a
 * Simplified Chinese UI still announced itself as English: a screen reader picks
 * its pronunciation rules from this attribute, so every Chinese sentence was
 * read with English phonetics (WCAG 3.1.1). Owning it here means every browser
 * host — Electron, WebUI, Viewer — inherits the fix from one place.
 *
 * This module also runs in the main process, where `document` does not exist and
 * i18n still runs to generate titles, so the DOM is reached through a guarded
 * lookup rather than a global type: the shared package does not include the DOM
 * lib, and pulling it in would let Node-only files reference browser APIs.
 */
function syncDocumentLanguage(language: string): void {
  const root = (globalThis as { document?: { documentElement?: { lang: string } } }).document?.documentElement
  if (!root) return;
  const resolved = (i18n.resolvedLanguage || language || "en").replace("_", "-");
  if (root.lang !== resolved) root.lang = resolved;
}

/**
 * Initialize i18next with the bundled English fallback.
 * Call once at app startup. Pass `plugins` to add framework integrations
 * (e.g. initReactI18next for React apps, LanguageDetector for browser apps).
 */
export function setupI18n(
  plugins: any[] = [],
): I18nInstance {
  if (initialized) return i18n;

  let instance = i18n;
  for (const plugin of plugins) {
    instance = instance.use(plugin);
  }

  instance.init({
    resources,
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    interpolation: { escapeValue: false },
    initImmediate: false, // synchronous init — English is bundled inline
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  } as InitOptions);

  initialized = true;

  // `lang` follows every later switch, including the detected-locale re-emit below.
  i18n.on("languageChanged", syncDocumentLanguage);
  syncDocumentLanguage(i18n.resolvedLanguage || i18n.language || "en");

  // Browser language detectors may resolve to a non-English locale during
  // init even though only English is bundled. Load that locale and re-emit
  // languageChanged once its resources are present.
  const detected = i18n.language;
  if (detected && detected !== "en") {
    startupReady = ensureLocaleResources(detected).then(async () => {
      if (i18n.language === detected) await i18n.changeLanguage(detected);
    });
    // Callers may await readiness; retain the rejection without an unhandled promise.
    void startupReady.catch(() => undefined);
  }

  return i18n;
}

/** Load one locale into i18next on demand (idempotent). */
export async function ensureLocaleResources(code: string): Promise<void> {
  if (!(code in LOCALE_REGISTRY)) return;
  if (i18n.hasResourceBundle(code, "translation")) return;
  const messages = await loadLocaleMessages(code as LanguageCode);
  i18n.addResourceBundle(code, "translation", messages, true, true);
}

/** Switch language after ensuring the requested translations are loaded. */
export async function changeAppLanguage(code: string): Promise<void> {
  await ensureLocaleResources(code);
  await i18n.changeLanguage(code);
  syncDocumentLanguage(code);
}

export { i18n };
