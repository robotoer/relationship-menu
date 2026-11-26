/**
 * What travels between the old address and the new one during the hand-off (spec
 * HO-4, HO-5). Both directions use the URL fragment, which browsers never send to
 * a server.
 *
 *   request, old → new /import:  #handoff=1&id=<id>&count=<n>&menus=<JSON array>
 *   reply,   new → old /:        #handoff-reply=<id>&ok=1   (ok=0: not saved)
 *
 * The request is untrusted input on the new address: anyone can make a link to
 * /import. Parsing never throws and keeps only well-formed menus; the importer
 * then decodes and sanitizes each one like any opened link (src/import-menus.ts).
 * No dependencies, so the hand-off page stays tiny.
 */

/** One menu as it travels. Ids stay behind: the new address gives each its own (SY-20). */
export type HandoffMenu = {
  title: string;
  encoded: string;
  person?: { name?: string; pronouns?: string; note?: string };
  createdAt?: number;
  updatedAt?: number;
};

export type HandoffRequest = { id: string; menus: HandoffMenu[] };

/**
 * A parsed request. `complete` is false when the list of menus didn't arrive whole
 * (for example a URL cut short): the importer then replies "not saved", so the old
 * address sends them again next time. A malformed menu inside a whole list is just
 * left out, so one unreadable old entry can't hold up the rest.
 */
export type ParsedHandoffRequest = HandoffRequest & { complete: boolean };

export type HandoffReply = { id: string; ok: boolean };

/** HO-4: the longest request URL sent in one go. A single larger menu travels alone. */
export const MAX_PART_LENGTH = 32 * 1024;

/** Same shape as menu ids: 128 random bits, base64url. */
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
/** Bounds that no real menu comes near; they only keep junk out. */
const LIMITS = { fragment: 4 * 1024 * 1024, menus: 2000, title: 10_000, encoded: 2 * 1024 * 1024, person: 1000 };
const PERSON_FIELDS = ["name", "pronouns", "note"] as const;

export const encodeHandoffRequest = ({ id, menus }: HandoffRequest): string =>
  new URLSearchParams([
    ["handoff", "1"],
    ["id", id],
    ["count", String(menus.length)],
    // Last, so a URL cut short loses menus rather than the id (and the importer can say so).
    ["menus", JSON.stringify(menus)],
  ]).toString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const timestamp = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? value : undefined;

/** One well-formed menu, or null. */
const parseMenu = (value: unknown): HandoffMenu | null => {
  if (!isRecord(value)) return null;
  const { title, encoded, person, createdAt, updatedAt } = value;
  if (typeof title !== "string" || title.length > LIMITS.title) return null;
  if (typeof encoded !== "string" || encoded.length > LIMITS.encoded || !BASE64_PATTERN.test(encoded)) return null;
  const menu: HandoffMenu = { title, encoded };
  if (isRecord(person)) {
    const kept: NonNullable<HandoffMenu["person"]> = {};
    for (const field of PERSON_FIELDS) {
      const text = person[field];
      if (typeof text === "string" && text.length <= LIMITS.person) kept[field] = text;
    }
    if (Object.keys(kept).length > 0) menu.person = kept;
  }
  const created = timestamp(createdAt);
  if (created !== undefined) menu.createdAt = created;
  const updated = timestamp(updatedAt);
  if (updated !== undefined) menu.updatedAt = updated;
  return menu;
};

const params = (fragment: string | null | undefined): URLSearchParams | null => {
  if (typeof fragment !== "string" || fragment.length > LIMITS.fragment) return null;
  try {
    return new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment);
  } catch {
    return null;
  }
};

/** Reads a request from a URL fragment, or null if it isn't one. Never throws. */
export const parseHandoffRequest = (fragment: string | null | undefined): ParsedHandoffRequest | null => {
  const query = params(fragment);
  const id = query?.get("id");
  if (!query || query.get("handoff") !== "1" || !id || !ID_PATTERN.test(id)) return null;
  const count = query.get("count");
  let parsed: unknown;
  try {
    parsed = JSON.parse(query.get("menus") ?? "");
  } catch {
    return { id, menus: [], complete: false };
  }
  if (!Array.isArray(parsed) || parsed.length > LIMITS.menus) return { id, menus: [], complete: false };
  const menus = parsed.flatMap((value) => parseMenu(value) ?? []);
  return { id, menus, complete: count === String(parsed.length) && /^\d+$/.test(count) };
};

export const encodeHandoffReply = ({ id, ok }: HandoffReply): string =>
  new URLSearchParams([
    ["handoff-reply", id],
    ["ok", ok ? "1" : "0"],
  ]).toString();

/** Reads a reply from a URL fragment, or null if it isn't one. Never throws. */
export const parseHandoffReply = (fragment: string | null | undefined): HandoffReply | null => {
  const query = params(fragment);
  const id = query?.get("handoff-reply");
  const ok = query?.get("ok");
  if (!id || !ID_PATTERN.test(id) || (ok !== "1" && ok !== "0")) return null;
  return { id, ok: ok === "1" };
};
