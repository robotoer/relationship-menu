/**
 * Where the app is running, and the few things that differ there. On the website
 * everything uses the browser; a host that embeds this app (for example a native
 * shell) replaces parts with `setPlatform` before calling `startApp`.
 *
 * Nothing here sends anything anywhere.
 */

/**
 * Push notifications from the host's own system (the store apps: FCM, spec
 * docs/spec/notifications.md §7c), used instead of web push when present.
 */
export type NativePush = {
  /** Asks for permission (from the tap) and returns this device's token, or null if refused. */
  register(): Promise<{ token: string; platform: "android" | "ios" } | null>;
  /** Stops notifications on this device (when no conversation uses them any more). */
  unregister(): Promise<void>;
};

/** How a saved file was handed over. */
export type SaveOutcome = "downloaded" | "shared" | "cancelled";

export type Platform = {
  /** "web" for the website; anything else names the host. */
  kind: string;
  /** The web address put in links people share and export (`https://…`, no slash). */
  publicOrigin: string;
  /** Copies text. Rejects if it couldn't. */
  copyText(text: string): Promise<void>;
  /** The share sheet for a message, or null where there isn't one. Resolves false if cancelled. */
  shareText: ((share: { title?: string; text: string }) => Promise<boolean>) | null;
  /** Saves a file (a download, or the host's own way). Call it straight from a click. */
  saveFile(file: File): Promise<SaveOutcome>;
  /** Whether to show the Support page and links to it. */
  support: boolean;
  /** Whether to show the "Prepare with AI (coming soon)" teaser. */
  aiTeaser: boolean;
  /** Whether to show the "Add to Home Screen" tip (Safari on iPhone and iPad). */
  homeScreenHint: boolean;
  /** The host's own push notifications, or null to use web push. */
  nativePush: NativePush | null;
};

/** Starts a download of `file` (a link to a local blob; nothing leaves the browser). */
export const downloadFile = (file: File) => {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the blob goes away.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const webPlatform = (): Platform => ({
  kind: "web",
  publicOrigin: typeof window !== "undefined" ? window.location.origin : "",
  copyText: (text) => navigator.clipboard.writeText(text),
  shareText:
    typeof navigator !== "undefined" && typeof navigator.share === "function"
      ? (share) =>
          navigator.share(share).then(
            () => true,
            (e) => {
              if ((e as Error)?.name === "AbortError") return false;
              throw e;
            }
          )
      : null,
  saveFile: async (file) => {
    downloadFile(file);
    return "downloaded";
  },
  support: true,
  aiTeaser: true,
  homeScreenHint: true,
  nativePush: null,
});

let current: Platform | null = null;

/** The current platform (the website's, unless a host replaced parts of it). */
export const platform = (): Platform => current ?? webPlatform();

/** Replaces parts of the platform. Call before `startApp`. */
export const setPlatform = (changes: Partial<Platform>) => {
  current = { ...platform(), ...changes };
};

/** Back to the website's platform (for tests). */
export const resetPlatform = () => {
  current = null;
};
