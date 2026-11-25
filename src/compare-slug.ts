/**
 * Helpers for turning whatever a user puts into a compare input (a raw menu slug,
 * or a full "Share Menu Link" URL) into a decoded menu.
 */

import { decodeData } from "./data-encoder";
import { RelationshipMenu, RelationshipMenuItemValue } from "./model/menu";

export type DecodedCompareSlug = {
  title: string;
  menu: RelationshipMenu;
};

/** Returns every `encoded` query parameter in a share/compare link, or null if it isn't one. */
const slugsFromLink = (value: string): string[] | null => {
  const queryIndex = value.indexOf("?");
  if (queryIndex === -1 || !value.includes("encoded=")) {
    return null;
  }
  const query = value.slice(queryIndex + 1).split("#")[0];
  const slugs = new URLSearchParams(query)
    .getAll("encoded")
    .map((slug) => slug.trim())
    .filter(Boolean);
  return slugs.length > 0 ? slugs : null;
};

/**
 * Normalizes a compare entry into a bare "titleEncoded:menuEncoded" slug.
 *
 * - Accepts share links (anything containing an `encoded=` query parameter).
 * - Trims surrounding whitespace.
 * - Restores "+" characters that were turned into spaces by an unencoded query
 *   string (base64 never contains spaces).
 */
export const normalizeCompareEntry = (raw: string): string => {
  const value = slugsFromLink(raw.trim())?.[0] ?? raw.trim();
  return value.replace(/ /g, "+");
};

/**
 * Expands one pasted entry into one entry per menu: a compare link holding several
 * menus becomes several entries; anything else is returned unchanged.
 */
export const expandCompareEntry = (raw: string): string[] => {
  const slugs = slugsFromLink(raw.trim());
  return slugs && slugs.length > 1 ? slugs : [raw];
};

const PREFERENCES: ReadonlySet<string> = new Set<RelationshipMenuItemValue>([
  "must-have",
  "like-to-have",
  "maybe",
  "off-limits",
]);

/**
 * Keeps only well-formed groups and items from untrusted decoded data, dropping
 * preference values the app doesn't know. Returns null if the menu isn't an object
 * of arrays.
 */
const sanitizeMenu = (menu: unknown): RelationshipMenu | null => {
  if (!menu || typeof menu !== "object" || Array.isArray(menu)) {
    return null;
  }
  const result: RelationshipMenu = {};
  for (const [group, items] of Object.entries(menu)) {
    if (!Array.isArray(items)) {
      return null;
    }
    result[group] = items
      .filter((item) => item && typeof item.item === "string")
      .map((item) => ({
        item: item.item,
        value: PREFERENCES.has(item.value) ? item.value : undefined,
      }));
  }
  return result;
};

/**
 * Decodes a compare entry into its title and menu.
 *
 * @returns The decoded title and menu, or null if the entry is not a valid slug.
 */
export const decodeCompareSlug = (raw: string): DecodedCompareSlug | null => {
  const slug = normalizeCompareEntry(raw);
  const colonIndex = slug.indexOf(":");
  if (colonIndex === -1) {
    return null;
  }
  try {
    const title = decodeData(slug.slice(0, colonIndex));
    const menu = sanitizeMenu(decodeData(slug.slice(colonIndex + 1)));
    if (typeof title !== "string" || !menu) {
      return null;
    }
    return { title, menu };
  } catch {
    return null;
  }
};
