/**
 * Helpers for turning whatever a user puts into a compare input (a raw menu slug,
 * or a full "Share Menu Link" URL) into a decoded menu.
 */

import { decodeData, encodeData } from "./data-encoder";
import { Person, RelationshipMenu, RelationshipMenuItemValue } from "./model/menu";

export type DecodedCompareSlug = {
  title: string;
  menu: RelationshipMenu;
  person?: Person;
};

const PERSON_LIMITS: Record<keyof Person, number> = { name: 60, pronouns: 30, note: 280 };

/** Keeps only short string fields of a person; returns undefined if nothing is left. */
export const sanitizePerson = (value: unknown): Person | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const person: Person = {};
  for (const key of Object.keys(PERSON_LIMITS) as (keyof Person)[]) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === "string" && field.trim()) {
      person[key] = field.trim().slice(0, PERSON_LIMITS[key]);
    }
  }
  return Object.keys(person).length ? person : undefined;
};

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
  const parts = normalizeCompareEntry(raw).split(":");
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
