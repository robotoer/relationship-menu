import { renderHook } from "@testing-library/react";
import {
  BrowserInfo,
  HOME_SCREEN_HINT_AFTER_SAVE_KEY,
  PERSIST_REQUESTED_KEY,
  appleMobileDevice,
  dismissHomeScreenHint,
  homeScreenDevice,
  homeScreenHintDismissed,
  requestPersistentStorage,
  takeHomeScreenHintAfterSave,
  useAfterSave,
} from "./persistence";

/** User agents seen in the wild. */
const UA = {
  iPhoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iPadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // iPadOS asks for desktop sites by default, so it looks like a Mac...
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  iPhoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  iPhoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15",
  iPhoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.0.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
};

const browser = (userAgent: string, more: Partial<BrowserInfo> = {}): BrowserInfo => ({
  userAgent,
  maxTouchPoints: /iPhone|iPad|Android/.test(userAgent) ? 5 : 0,
  displayModeStandalone: false,
  ...more,
});

const gtag = () => {
  const fn = vi.fn();
  (window as unknown as { gtag: unknown }).gtag = fn;
  return fn;
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  delete (window as unknown as { gtag?: unknown }).gtag;
});

describe("SV-11: asking the browser to keep saved menus", () => {
  it("asks once per browser, and reports only whether it was granted", async () => {
    const sent = gtag();
    const persist = vi.fn().mockResolvedValue(true);
    expect(await requestPersistentStorage({ persist })).toBe("granted");
    expect(await requestPersistentStorage({ persist })).toBe("already-asked");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PERSIST_REQUESTED_KEY)).toBe("1");
    expect(sent).toHaveBeenCalledWith("event", "persistent_storage_granted", {});
  });

  it("reports a refusal, and doesn't ask again", async () => {
    const sent = gtag();
    const persist = vi.fn().mockResolvedValue(false);
    expect(await requestPersistentStorage({ persist })).toBe("denied");
    expect(await requestPersistentStorage({ persist })).toBe("already-asked");
    expect(sent).toHaveBeenCalledWith("event", "persistent_storage_denied", {});
  });

  it("never throws: a missing API or a failing request is just skipped", async () => {
    expect(await requestPersistentStorage(undefined)).toBe("unsupported");
    expect(localStorage.getItem(PERSIST_REQUESTED_KEY)).toBeNull();
    const persist = vi.fn().mockRejectedValue(new Error("nope"));
    expect(await requestPersistentStorage({ persist })).toBe("failed");
    // Remembered before asking, so a failing browser isn't asked on every save.
    expect(await requestPersistentStorage({ persist })).toBe("already-asked");
  });

  describe("from the editor (useAfterSave)", () => {
    const realStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
    let persist: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      // A request that never settles: saving must not wait for it.
      persist = vi.fn(() => new Promise<boolean>(() => {}));
      Object.defineProperty(navigator, "storage", { configurable: true, value: { persist } });
    });
    afterEach(() => {
      if (realStorage) Object.defineProperty(navigator, "storage", realStorage);
      else delete (navigator as { storage?: unknown }).storage;
    });

    // The editor's save status as a save goes through (see src/autosave.ts).
    const renderEditor = () =>
      renderHook(({ status }) => useAfterSave(status), {
        initialProps: { status: "idle" as string | undefined },
      });

    it("asks once the first save succeeded, not before, and only once per browser", () => {
      const editor = renderEditor();
      editor.rerender({ status: "pending" });
      editor.rerender({ status: "saving" });
      expect(persist).not.toHaveBeenCalled();
      editor.rerender({ status: "saved" });
      expect(persist).toHaveBeenCalledTimes(1);
      // Later saves, here or in another editor, don't ask again (even though the first
      // request never got an answer).
      editor.rerender({ status: "pending" });
      editor.rerender({ status: "saved" });
      renderEditor().rerender({ status: "saved" });
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it("doesn't ask when the save failed, or for a title another menu has", () => {
      const editor = renderEditor();
      editor.rerender({ status: "error" });
      editor.rerender({ status: "title-taken" });
      expect(persist).not.toHaveBeenCalled();
    });

    it("SV-12: never shows the Home Screen tip outside iPhone/iPad Safari", () => {
      const editor = renderEditor();
      editor.rerender({ status: "saved" });
      expect(editor.result.current.showHomeScreenHint).toBe(false);
    });

    it("SV-12: in iPhone Safari, shows the tip after the first save only, once per browser", () => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue(UA.iPhoneSafari);
      const editor = renderEditor();
      expect(editor.result.current.showHomeScreenHint).toBe(false);
      editor.rerender({ status: "saved" });
      expect(editor.result.current.showHomeScreenHint).toBe(true);
      // It stays up in this editor through later saves...
      editor.rerender({ status: "pending" });
      editor.rerender({ status: "saved" });
      expect(editor.result.current.showHomeScreenHint).toBe(true);
      // ...but the next editor doesn't show it again.
      const next = renderEditor();
      next.rerender({ status: "saved" });
      expect(next.result.current.showHomeScreenHint).toBe(false);
      vi.restoreAllMocks();
    });
  });
});

describe("SV-12: where the Home Screen tip applies", () => {
  it("only Safari on iPhone and iPad, iPads asking for desktop sites included", () => {
    expect(homeScreenDevice(browser(UA.iPhoneSafari))).toBe("iPhone");
    expect(homeScreenDevice(browser(UA.iPadSafari))).toBe("iPad");
    expect(homeScreenDevice(browser(UA.macSafari, { maxTouchPoints: 5 }))).toBe("iPad");
    expect(homeScreenDevice(browser(UA.macSafari))).toBeNull();
    expect(homeScreenDevice(browser(UA.iPhoneChrome))).toBeNull();
    expect(homeScreenDevice(browser(UA.iPhoneFirefox))).toBeNull();
    expect(homeScreenDevice(browser(UA.iPhoneInstagram))).toBeNull();
    expect(homeScreenDevice(browser(UA.androidChrome))).toBeNull();
  });

  it("never in a Home Screen app", () => {
    expect(homeScreenDevice(browser(UA.iPhoneSafari, { standalone: true }))).toBeNull();
    expect(homeScreenDevice(browser(UA.iPadSafari, { displayModeStandalone: true }))).toBeNull();
    // Still an iPhone, for choosing how to export (SV-13).
    expect(appleMobileDevice(browser(UA.iPhoneSafari, { standalone: true }))).toBe("iPhone");
    expect(appleMobileDevice(browser(UA.iPhoneChrome))).toBe("iPhone");
    expect(appleMobileDevice(browser(UA.androidChrome))).toBeNull();
  });

  it("dismissing it is remembered in this browser", () => {
    expect(homeScreenHintDismissed()).toBe(false);
    dismissHomeScreenHint();
    expect(homeScreenHintDismissed()).toBe(true);
  });

  it("the editor shows it after a save at most once per browser, and not once dismissed", () => {
    const iPhone = browser(UA.iPhoneSafari);
    expect(takeHomeScreenHintAfterSave(browser(UA.androidChrome))).toBe(false);
    expect(localStorage.getItem(HOME_SCREEN_HINT_AFTER_SAVE_KEY)).toBeNull();
    expect(takeHomeScreenHintAfterSave(iPhone)).toBe(true);
    expect(takeHomeScreenHintAfterSave(iPhone)).toBe(false);

    localStorage.clear();
    dismissHomeScreenHint();
    expect(takeHomeScreenHintAfterSave(iPhone)).toBe(false);
  });
});
