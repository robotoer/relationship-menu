/**
 * The hand-off page's logic, on the old address (spec HO-3, HO-4, HO-6).
 *
 * Each visit: if this browser has saved menus here that the new address hasn't
 * confirmed yet, send the next part of them to the new address's /import. The
 * importer saves them and replies with this page's address plus `#handoff-reply`,
 * and the page carries on: the next part, or, when everything is across, the page
 * the visit asked for, on the new address. With nothing to send, it goes there
 * straight away.
 *
 * Nothing here is ever deleted or changed (HO-6), except two bookkeeping entries:
 * - localStorage `handoff:sent`: fingerprints of the menus the new address has
 *   confirmed, so a later visit sends only what's new or changed since (an old tab
 *   left open can still save). Not `menu:…`: older versions read that as a menu.
 * - sessionStorage `handoff:visit`: this tab's hand-off in progress (where it's
 *   going, and the part in flight), which lasts across the round trips.
 * Recovering IPFS-only menus (SY-91) rewrites their pointer entries in place, as
 * the app itself did; the menu is kept under the same key.
 */

import { recoverIpfsMenus } from "../ipfs-recovery";
import { newMenuId } from "../menu-id";
import { KeyValueStore, migrateLegacyMenus, readStoredMenus } from "../menu-store";
import { HandoffMenu, MAX_PART_LENGTH, encodeHandoffRequest, parseHandoffReply } from "./format";

export const SENT_KEY = "handoff:sent";
export const VISIT_KEY = "handoff:visit";
/** Parts sent in one visit at most (3 MB of menus); the rest go next visit. */
export const MAX_PARTS = 100;

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type Visit = {
  id: string;
  /** Path, query and fragment the visit asked for (HO-3). */
  dest: string;
  /** Fingerprints of the menus in the part in flight. */
  pending: string[];
  parts: number;
};

/** A read-only copy, so migrating older entries (SY-90) can't touch the real ones. */
const snapshot = (kv: KeyValueStore): KeyValueStore => {
  const entries = new Map<string, string>();
  for (let i = 0; i < kv.length; i++) {
    const key = kv.key(i);
    const value = key === null ? null : kv.getItem(key);
    if (key !== null && value !== null) entries.set(key, value);
  }
  return {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
};

/**
 * Every menu saved here, in any format: id-keyed (`menu-v2:`), older title-keyed
 * ones (`menu:`), and menus only the IPFS version kept (SY-91), one per menu as
 * the app would list them, most recently changed first.
 */
export const collectMenus = async (
  kv: KeyValueStore,
  recover: () => Promise<unknown> = () => recoverIpfsMenus()
): Promise<HandoffMenu[]> => {
  try {
    await recover();
  } catch {
    // Those menus just stay behind, still saved here.
  }
  const copy = snapshot(kv);
  migrateLegacyMenus(copy, newMenuId);
  return readStoredMenus(copy)
    .sort((a, b) => (b.doc.updatedAt ?? b.savedAt) - (a.doc.updatedAt ?? a.savedAt))
    .map(({ doc: { title, encoded, person, createdAt, updatedAt } }) => ({
      title,
      encoded,
      ...(person ? { person } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
    }));
};

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A menu's fingerprint: its title, items, answers and person, not its dates. */
export const menuFingerprint = async ({ title, encoded, person }: HandoffMenu): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([title, encoded, person ?? null])));
  return toBase64Url(new Uint8Array(digest).slice(0, 16));
};

/** The request URL for the first menus of `menus` that fit in `maxLength` (always at least one). */
export const nextPart = (
  menus: HandoffMenu[],
  id: string,
  newOrigin: string,
  maxLength = MAX_PART_LENGTH
): { count: number; url: string } => {
  const url = (count: number) => `${newOrigin}/import#${encodeHandoffRequest({ id, menus: menus.slice(0, count) })}`;
  let count = 1;
  while (count < menus.length && url(count + 1).length <= maxLength) count++;
  return { count, url: url(count) };
};

const readJson = (store: { getItem(key: string): string | null }, key: string): unknown => {
  try {
    return JSON.parse(store.getItem(key) ?? "null");
  } catch {
    return null;
  }
};

/** Writes, and says whether it worked (storage can be full or blocked). */
const write = (store: { setItem(key: string, value: string): void }, key: string, value: unknown): boolean => {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const readSent = (kv: KeyValueStore): string[] => {
  const sent = readJson(kv, SENT_KEY);
  return Array.isArray(sent) ? sent.filter((h): h is string => typeof h === "string") : [];
};

const readVisit = (session: SessionStore): Visit | null => {
  const visit = readJson(session, VISIT_KEY) as Partial<Visit> | null;
  return visit &&
    typeof visit.id === "string" &&
    typeof visit.dest === "string" &&
    visit.dest.startsWith("/") &&
    Array.isArray(visit.pending) &&
    typeof visit.parts === "number"
    ? { id: visit.id, dest: visit.dest, pending: visit.pending.filter((h) => typeof h === "string"), parts: visit.parts }
    : null;
};

const endVisit = (session: SessionStore) => {
  try {
    session.removeItem(VISIT_KEY);
  } catch {
    // Harmless: a stale visit is ignored unless a reply names it.
  }
};

export type HandoffOptions = {
  location: Pick<Location, "pathname" | "search" | "hash">;
  local: KeyValueStore;
  session: SessionStore;
  newOrigin: string;
  /** Recovers IPFS-only menus first (SY-91); tests pass their own. */
  recover?: () => Promise<unknown>;
  maxLength?: number;
};

/**
 * Decides where this visit goes next: the new address's /import with the next part
 * of unsent menus, or the page the visit asked for on the new address (HO-3).
 */
export const runHandoff = async ({ location, local, session, newOrigin, recover, maxLength }: HandoffOptions): Promise<string> => {
  const reply = parseHandoffReply(location.hash);
  let visit: Visit;
  if (reply) {
    const current = readVisit(session);
    // Not this tab's hand-off (an old or made-up reply): start nothing.
    if (!current || current.id !== reply.id) return `${newOrigin}/`;
    visit = current;
    // Not saved over there: go on without them; the next visit sends them again.
    if (!reply.ok) {
      endVisit(session);
      return newOrigin + visit.dest;
    }
    // Saved: remember them, so they aren't sent again (HO-6).
    if (!write(local, SENT_KEY, [...new Set([...readSent(local), ...visit.pending])])) {
      endVisit(session);
      return newOrigin + visit.dest;
    }
  } else {
    visit = { id: newMenuId(), dest: location.pathname + location.search + location.hash, pending: [], parts: 0 };
  }

  const menus = await collectMenus(local, recover);
  const fingerprints = await Promise.all(menus.map(menuFingerprint));
  const sent = new Set(readSent(local));
  const unsent: HandoffMenu[] = [];
  const unsentPrints: string[] = [];
  menus.forEach((menu, i) => {
    const print = fingerprints[i]!;
    if (!sent.has(print) && !unsentPrints.includes(print)) {
      unsent.push(menu);
      unsentPrints.push(print);
    }
  });

  if (unsent.length === 0 || visit.parts >= MAX_PARTS) {
    // Forget menus no longer saved here, so the list can't grow without end.
    const current = new Set(fingerprints);
    const kept = [...sent].filter((print) => current.has(print));
    if (kept.length !== sent.size) write(local, SENT_KEY, kept);
    endVisit(session);
    return newOrigin + visit.dest;
  }

  const part = nextPart(unsent, visit.id, newOrigin, maxLength);
  const next: Visit = { ...visit, pending: unsentPrints.slice(0, part.count), parts: visit.parts + 1 };
  // Without a record of this visit the reply couldn't be matched: don't start.
  if (!write(session, VISIT_KEY, next)) return newOrigin + visit.dest;
  return part.url;
};

/** Where to go if anything goes wrong: the same page on the new address. */
export const fallbackUrl = (location: Pick<Location, "pathname" | "search" | "hash">, newOrigin: string): string =>
  parseHandoffReply(location.hash) ? `${newOrigin}/` : newOrigin + location.pathname + location.search + location.hash;
