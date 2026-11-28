/**
 * Helpers for turning whatever a user puts into a compare input (a raw menu slug,
 * or a full "Share Menu Link" URL) into a decoded menu.
 */

import { decodeData, encodeData } from "./data-encoder";
import { sanitizePerson } from "./person";
import { ITEM_NOTE_LIMIT, Person, RelationshipMenu, RelationshipMenuItemValue } from "./model/menu";

export type DecodedCompareSlug = {
  title: string;
  menu: RelationshipMenu;
  person?: Person;
};

export { sanitizePerson };

/**
 * Builds a menu slug: `title:menu`, plus `:about` when person info is included.
 * Base64 never contains ":", so the parts can be split unambiguously, and links
 * without the third part (older links, templates) still decode.
 *
 * @param menu - The menu, or its already-encoded form.
 */
export const encodeMenuSlug = (
  title: string,
  menu: RelationshipMenu | string,
  person?: Person
): string => {
  const menuPart = typeof menu === "string" ? menu : encodeData(menu);
  const about = sanitizePerson(person);
  return `${encodeData(title)}:${menuPart}${about ? `:${encodeData(about)}` : ""}`;
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
    // An unencoded "+" arrives as a space; restore it before trimming (base64 has no
    // spaces), or a slug ending in "+" would lose its last character.
    .map((slug) => slug.replace(/ /g, "+").trim())
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
  "soft-no",
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
  // No prototype: group names are user text (e.g. "__proto__").
  const result: RelationshipMenu = Object.create(null);
  for (const [group, items] of Object.entries(menu)) {
    if (!Array.isArray(items)) {
      return null;
    }
    result[group] = items
      .filter((item) => item && typeof item.item === "string")
      .map((item) => {
        const clean: RelationshipMenu[string][number] = {
          item: item.item,
          value: PREFERENCES.has(item.value) ? item.value : undefined,
        };
        const note = typeof item.note === "string" ? item.note.trim() : "";
        // Trim again after cutting, so reading the result again changes nothing.
        if (note) clean.note = note.slice(0, ITEM_NOTE_LIMIT).trimEnd();
        return clean;
      });
  }
  return result;
};

/**
 * Decodes a compare entry into its title and menu.
 *
 * @returns The decoded title and menu, or null if the entry is not a valid slug.
 */
export const decodeCompareSlug = (raw: string): DecodedCompareSlug | null => {
  // Each part is padded base64 (a multiple of 4 characters). A part that falls short
  // lost one or more trailing "+"s (they arrived as spaces and were trimmed): put
  // them back.
  const parts = normalizeCompareEntry(raw)
    .split(":")
    .map((part) => part + "+".repeat((4 - (part.length % 4)) % 4));
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  try {
    const title = decodeData(parts[0]);
    const menu = sanitizeMenu(decodeData(parts[1]));
    if (typeof title !== "string" || !menu) {
      return null;
    }
    let person: Person | undefined;
    if (parts[2]) {
      try {
        person = sanitizePerson(decodeData(parts[2]));
      } catch {
        // Unreadable person info shouldn't stop the menu from opening.
      }
    }
    return person ? { title, menu, person } : { title, menu };
  } catch {
    return null;
  }
};
