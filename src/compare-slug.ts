/**
 * Helpers for turning whatever a user puts into a compare input (a raw menu slug,
 * or a full "Share Menu Link" URL) into a decoded menu.
 */

import { decodeData } from "./data-encoder";
import { RelationshipMenu } from "./model/menu";

export type DecodedCompareSlug = {
  title: string;
  menu: RelationshipMenu;
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
  let value = raw.trim();
  const queryIndex = value.indexOf("?");
  if (queryIndex !== -1 && value.includes("encoded=")) {
    const fromLink = new URLSearchParams(value.slice(queryIndex + 1)).get(
      "encoded"
    );
    if (fromLink) {
      value = fromLink.trim();
    }
  }
  return value.replace(/ /g, "+");
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
    const menu = decodeData(slug.slice(colonIndex + 1));
    if (
      typeof title !== "string" ||
      !menu ||
      typeof menu !== "object" ||
      Array.isArray(menu) ||
      !Object.values(menu).every(Array.isArray)
    ) {
      return null;
    }
    return { title, menu: menu as RelationshipMenu };
  } catch {
    return null;
  }
};
