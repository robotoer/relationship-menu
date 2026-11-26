/**
 * Keeping saved menus from being cleared by the browser (spec SV-11, SV-12).
 *
 * Menus live only in this browser's localStorage. Browsers may clear that storage on
 * their own: Safari on iPhone and iPad deletes everything a site saved once you've
 * used Safari for 7 days without opening that site (Home Screen web apps are exempt,
 * but keep storage of their own, separate from Safari's). So:
 * - after the first save, ask the browser to keep this site's storage (SV-11);
 * - on iPhone/iPad Safari, suggest adding the site to the Home Screen (SV-12).
 *
 * Both start from the editor's save status (`useAfterSave`), so saving itself
 * (src/storage.ts, the storage provider, the autosave) knows nothing about them.
 * Nothing here reads or sends menu content. Everything is best effort and never
 * throws: none of it may get in the way of saving.
 *
 * The flags below live in localStorage under keys that don't start with "menu:", so
 * the menu storage (src/storage.ts) never mistakes them for menus.
 */

import { useEffect, useState } from "react";
import { track } from "./analytics";
import { platform } from "./platform";

/** Set once `navigator.storage.persist()` has been asked for in this browser. */
export const PERSIST_REQUESTED_KEY = "storage-persist-requested";
/** Set when the Home Screen tip is dismissed. */
export const HOME_SCREEN_HINT_DISMISSED_KEY = "home-screen-hint-dismissed";
/** Set once the editor has shown the Home Screen tip after a save. */
export const HOME_SCREEN_HINT_AFTER_SAVE_KEY = "home-screen-hint-after-save-shown";

const getFlag = (key: string): boolean => {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
};

const setFlag = (key: string) => {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Storage full or blocked: at worst we ask again next time.
  }
};

// ---- SV-11: persistent storage ----

export type PersistOutcome = "granted" | "denied" | "already-asked" | "unsupported" | "failed";

/**
 * Asks the browser to keep this site's storage (`navigator.storage.persist()`), at
 * most once per browser. Called once a save has succeeded, and never awaited, so
 * saving never waits for it. Browsers decide on their own (Chrome grants it to installed,
 * bookmarked or often-used sites; Safari 17+ by its own rules; Firefox may ask), so
 * the outcome is only reported to analytics, never shown.
 */
export const requestPersistentStorage = async (
  storageManager: Pick<StorageManager, "persist"> | undefined = typeof navigator !== "undefined"
    ? navigator.storage
    : undefined
): Promise<PersistOutcome> => {
  try {
    if (getFlag(PERSIST_REQUESTED_KEY)) return "already-asked";
    if (typeof storageManager?.persist !== "function") return "unsupported";
    // Remember first, so a request that never settles still isn't repeated.
    setFlag(PERSIST_REQUESTED_KEY);
    const granted = await storageManager.persist();
    track(granted ? "persistent_storage_granted" : "persistent_storage_denied");
    return granted ? "granted" : "denied";
  } catch {
    return "failed";
  }
};

// ---- SV-12: the Home Screen tip ----

/** What the Home Screen tip needs to know about the browser. */
export type BrowserInfo = {
  userAgent: string;
  maxTouchPoints: number;
  /** `navigator.standalone` (Safari only): opened from the Home Screen. */
  standalone?: boolean;
  /** Whether `(display-mode: standalone)` matches. */
  displayModeStandalone: boolean;
};

/** The current browser, read safely. */
export const currentBrowser = (): BrowserInfo => {
  if (typeof navigator === "undefined") {
    return { userAgent: "", maxTouchPoints: 0, displayModeStandalone: false };
  }
  let displayModeStandalone = false;
  try {
    displayModeStandalone =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    // No matchMedia: not standalone.
  }
  return {
    userAgent: navigator.userAgent ?? "",
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    displayModeStandalone,
  };
};

/**
 * "iPhone" or "iPad" on Apple's phones and tablets (any browser, Home Screen apps
 * included), else null. iPads asking for desktop sites report a Mac user agent, but
 * unlike Macs they have a touch screen.
 */
export const appleMobileDevice = (browser: BrowserInfo): "iPhone" | "iPad" | null => {
  const ua = browser.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/Macintosh/.test(ua) && browser.maxTouchPoints > 1) return "iPad";
  return null;
};

/**
 * Which device to name in the Home Screen tip, if this is Safari on an iPhone or iPad
 * and not a Home Screen app; otherwise null (no tip). Other iOS browsers and in-app
 * browsers (no "Safari" in their user agent, or their own token like CriOS) are left
 * out: the tip's steps are Safari's.
 */
export const homeScreenDevice = (browser: BrowserInfo): "iPhone" | "iPad" | null => {
  if (!platform().homeScreenHint) return null;
  const ua = browser.userAgent;
  if (browser.standalone === true || browser.displayModeStandalone) return null;
  if (!/Safari\//.test(ua) || /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|GSA\//.test(ua)) return null;
  return appleMobileDevice(browser);
};

/** Whether the Home Screen tip was dismissed in this browser. */
export const homeScreenHintDismissed = () => getFlag(HOME_SCREEN_HINT_DISMISSED_KEY);

/** Hides the Home Screen tip for good in this browser. */
export const dismissHomeScreenHint = () => setFlag(HOME_SCREEN_HINT_DISMISSED_KEY);

/**
 * Whether the editor should show the tip now that a save succeeded: true at most once
 * per browser, and only where the tip applies and hasn't been dismissed.
 */
export const takeHomeScreenHintAfterSave = (browser: BrowserInfo = currentBrowser()): boolean => {
  if (!homeScreenDevice(browser) || homeScreenHintDismissed()) return false;
  if (getFlag(HOME_SCREEN_HINT_AFTER_SAVE_KEY)) return false;
  setFlag(HOME_SCREEN_HINT_AFTER_SAVE_KEY);
  return true;
};

// ---- Both, from the editor ----

/**
 * For the editor: each time its save status reaches "saved", asks the browser to keep
 * storage (SV-11; really asks only the first time) and says whether to show the
 * Home Screen tip (SV-12; true from the first save that may show it, once per
 * browser). Runs after the save finished, so it can't delay it.
 */
export const useAfterSave = (status: string | undefined): { showHomeScreenHint: boolean } => {
  const [showHomeScreenHint, setShowHomeScreenHint] = useState(false);
  useEffect(() => {
    if (status !== "saved") return;
    void requestPersistentStorage();
    if (takeHomeScreenHintAfterSave()) setShowHomeScreenHint(true);
  }, [status]);
  return { showHomeScreenHint };
};
