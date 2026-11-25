/**
 * Summaries shown on Library tiles: counts, progress and friendly dates.
 */

import { decodeData } from "./data-encoder";
import { RelationshipMenuDocument } from "./model/menu";

export type MenuStats = { groups: number; items: number; answered: number };

/** Group/item/answered counts for a stored (encoded) menu. Unreadable menus count as empty. */
export const menuStats = (encoded: string): MenuStats => {
  try {
    const menu = decodeData(encoded);
    let items = 0;
    let answered = 0;
    let groups = 0;
    for (const group of Object.values(menu ?? {})) {
      if (!Array.isArray(group)) continue;
      groups++;
      for (const item of group) {
        if (!item || typeof item.item !== "string" || !item.item.trim()) continue;
        items++;
        if (item.value) answered++;
      }
    }
    return { groups, items, answered };
  } catch {
    return { groups: 0, items: 0, answered: 0 };
  }
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600 * 1000],
  ["month", 30 * 24 * 3600 * 1000],
  ["week", 7 * 24 * 3600 * 1000],
  ["day", 24 * 3600 * 1000],
  ["hour", 3600 * 1000],
  ["minute", 60 * 1000],
];

/** "3 days ago", "just now", ... */
export const relativeTime = (timestamp: number, now = Date.now()): string => {
  const diff = timestamp - now;
  if (Math.abs(diff) < 60 * 1000) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
};

/** "Mar 2, 2026" */
export const shortDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export type LibrarySort = "edited" | "created" | "title";

export const sortMenus = <T extends RelationshipMenuDocument>(
  menus: T[],
  sort: LibrarySort
): T[] => {
  const copy = [...menus];
  if (sort === "title") {
    return copy.sort((a, b) =>
      (a.title || "Untitled menu").localeCompare(b.title || "Untitled menu", undefined, {
        sensitivity: "base",
      })
    );
  }
  const key = sort === "created" ? "createdAt" : "updatedAt";
  // Newest first; menus saved before dates were recorded go last.
  return copy.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
};

/** Whether a menu matches a search across its title, person and item text. */
export const matchesSearch = (menu: RelationshipMenuDocument, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [menu.title, menu.person?.name, menu.person?.pronouns, menu.person?.note]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (haystack.includes(q)) return true;
  // Search group names, item text and notes only (not JSON keys or answer values,
  // which would make "item" or "must" match every menu).
  try {
    const decoded = decodeData(menu.encoded);
    if (!decoded || typeof decoded !== "object") return false;
    return Object.entries(decoded).some(
      ([group, items]) =>
        group.toLowerCase().includes(q) ||
        (Array.isArray(items) &&
          items.some(
            (item) =>
              (typeof item?.item === "string" && item.item.toLowerCase().includes(q)) ||
              (typeof item?.note === "string" && item.note.toLowerCase().includes(q))
          ))
    );
  } catch {
    return false;
  }
};
