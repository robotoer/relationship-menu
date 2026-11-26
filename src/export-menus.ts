/**
 * "Export all menus" in the Library (spec SV-13): one plain-text file, made in the
 * browser, with every saved menu's title and menu link. Opening a link brings that
 * menu back (as a copy if the title is taken, LK-6). Nothing is uploaded: the file is
 * downloaded, or on iPhone and iPad handed to the share sheet ("Save to Files"),
 * where the person picks where it goes.
 */

import { RelationshipMenuDocument } from "./model/menu";
import { encodeMenuSlug } from "./compare-slug";
import { sortMenus } from "./library-info";
import { appleMobileDevice, currentBrowser } from "./persistence";
import { platform, SaveOutcome } from "./platform";

/** The menu link for a saved menu, the same as the Share dialog's. */
export const menuLink = (origin: string, doc: RelationshipMenuDocument) =>
  `${origin}/menu?encoded=${encodeURIComponent(encodeMenuSlug(doc.title, doc.encoded, doc.person))}`;

/** The date `now` as YYYY-MM-DD in local time. */
const localDate = (now: number) => {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The export's file name, like `wants-and-wonts-menus-2026-11-25.txt`. */
export const exportFileName = (now = Date.now()) => `wants-and-wonts-menus-${localDate(now)}.txt`;

/** The export's text: a short header, then each menu's title and link, by title. */
export const exportText = (
  menus: RelationshipMenuDocument[],
  origin: string,
  now = Date.now()
): string => {
  const count = `${menus.length} menu${menus.length === 1 ? "" : "s"}`;
  const lines = [
    `Wants & Won'ts: ${count} saved in this browser, exported ${localDate(now)}.`,
    "Open a link to bring that menu back. Each link holds the whole menu, answers,",
    "notes and name included, so keep this file private.",
  ];
  sortMenus(menus, "title").forEach((menu, i) => {
    lines.push("", `${i + 1}. ${menu.title || "Untitled menu"}`, menuLink(origin, menu));
  });
  return lines.join("\n") + "\n";
};

export type ExportOutcome = SaveOutcome;

/**
 * Saves every menu to one file. Call it straight from a click (the share sheet needs
 * one). On iPhone and iPad the share sheet is used when it takes files, since
 * downloads are awkward there (especially in a Home Screen app); everywhere else, and
 * if sharing fails, the file is downloaded. A host app saves it its own way.
 */
export const exportMenus = async (
  menus: RelationshipMenuDocument[],
  {
    origin = platform().publicOrigin,
    now = Date.now(),
    nav = navigator,
    browser = currentBrowser(),
  }: { origin?: string; now?: number; nav?: Navigator; browser?: ReturnType<typeof currentBrowser> } = {}
): Promise<ExportOutcome> => {
  const file = new File([exportText(menus, origin, now)], exportFileName(now), {
    type: "text/plain",
  });
  if (platform().kind === "web" && appleMobileDevice(browser) && nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file] });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
      // Sharing failed for another reason: download instead.
    }
  }
  return platform().saveFile(file);
};
