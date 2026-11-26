/**
 * Supporter sync's state on this device (spec §5), in browser storage beside the
 * menus themselves:
 *
 *   sync:code         the sync secret (the 24 words' bits), base64url
 *   sync:device       a random device id (records carry it, SY-35)
 *   sync:cursor       highest seq pulled
 *   sync:menu:<id>    { baseVersion, seenVersion, dirty, editId, revision }
 *   sync:status       the last account status the server reported (so the heart doesn't flicker)
 *   sync:runtime      what the syncing tab last saw: { lastSyncedAt, notices, unreadable, failing }
 *   sync:skip         ids of menus too large to sync (SY-26), set aside until they change
 *   sync:next-code    a new code being made (SY-8), kept until the server's answer is known
 *
 * Every tab reads and writes these directly, so a save in any tab is recorded at
 * once (SY-30), whichever tab is doing the network part.
 */

import type { SyncAccount, SyncNotice } from "./context";
import type { Local, MenuSyncState, SyncStates } from "./merge";
import { Bytes, fromBase64Url, toBase64Url } from "./bytes";
import { parseAccount } from "./api";
import { KeyValueStore, SavedMenu, menuKey, readStoredMenus, writeStoredMenu } from "../menu-store";

export const SYNC_KEY = {
  code: "sync:code",
  device: "sync:device",
  cursor: "sync:cursor",
  status: "sync:status",
  runtime: "sync:runtime",
  skip: "sync:skip",
  nextCode: "sync:next-code",
} as const;
export const SYNC_MENU_PREFIX = "sync:menu:";
const syncMenuKey = (id: string) => `${SYNC_MENU_PREFIX}${id}`;

/** Plain objects without a prototype, as merge.ts uses. */
const table = <T>(): { [id: string]: T } => Object.create(null);

const parseJson = (text: string | null): unknown => {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const keysWithPrefix = (kv: KeyValueStore, prefix: string): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < kv.length; i++) {
    const key = kv.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
};

// ---- the code and device --------------------------------------------------------

export const readSecret = (kv: KeyValueStore): Bytes | null => {
  const bytes = fromBase64Url(kv.getItem(SYNC_KEY.code) ?? "");
  return bytes?.length === 32 ? bytes : null;
};

export const writeSecret = (kv: KeyValueStore, secret: Uint8Array) => kv.setItem(SYNC_KEY.code, toBase64Url(secret));

/**
 * A new code whose rotation (SY-8) the server may or may not have applied: its
 * answer was lost. Kept until a check settles it, so the account is never left
 * under a code this device has forgotten.
 */
export const readNextSecret = (kv: KeyValueStore): { secret: Bytes; at: number } | null => {
  const parsed = parseJson(kv.getItem(SYNC_KEY.nextCode)) as { code?: unknown; at?: unknown } | undefined;
  const secret = typeof parsed?.code === "string" ? fromBase64Url(parsed.code) : null;
  if (secret?.length !== 32) return null;
  return { secret, at: typeof parsed?.at === "number" ? parsed.at : 0 };
};
/** `at`: when the replacement started (another tab waits a while before checking it itself). */
export const writeNextSecret = (kv: KeyValueStore, secret: Uint8Array, at: number) =>
  kv.setItem(SYNC_KEY.nextCode, JSON.stringify({ code: toBase64Url(secret), at }));
export const clearNextSecret = (kv: KeyValueStore) => kv.removeItem(SYNC_KEY.nextCode);

/** Whether sync is on in this browser (a cheap, synchronous check). */
export const syncIsOn = (kv: KeyValueStore) => readSecret(kv) !== null;

export const readDeviceId = (kv: KeyValueStore, newId: () => string): string => {
  const existing = kv.getItem(SYNC_KEY.device);
  if (existing && /^[A-Za-z0-9_-]{1,64}$/.test(existing)) return existing;
  const id = newId();
  kv.setItem(SYNC_KEY.device, id);
  return id;
};

// ---- cursor, status, runtime ----------------------------------------------------

export const readCursor = (kv: KeyValueStore): number => {
  const n = Number(kv.getItem(SYNC_KEY.cursor));
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};
export const writeCursor = (kv: KeyValueStore, cursor: number) => kv.setItem(SYNC_KEY.cursor, String(cursor));

export const readAccount = (kv: KeyValueStore): SyncAccount | null => {
  const parsed = parseJson(kv.getItem(SYNC_KEY.status));
  return parsed === undefined ? null : parseAccount(parsed);
};
export const writeAccount = (kv: KeyValueStore, account: SyncAccount) => kv.setItem(SYNC_KEY.status, JSON.stringify(account));

/** What the tab doing the network part reports to every tab. */
export type RuntimeReport = { lastSyncedAt: number | null; notices: SyncNotice[]; unreadable: number };

const NOTICES: readonly SyncNotice[] = ["offline", "not_supporter", "read_only", "storage_full", "menu_too_large", "unreadable", "code_replaced"];

export const readReport = (kv: KeyValueStore): RuntimeReport => {
  const parsed = parseJson(kv.getItem(SYNC_KEY.runtime));
  const v = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  return {
    lastSyncedAt: typeof v.lastSyncedAt === "number" ? v.lastSyncedAt : null,
    notices: Array.isArray(v.notices) ? NOTICES.filter((n) => (v.notices as unknown[]).includes(n)) : [],
    unreadable: typeof v.unreadable === "number" && v.unreadable >= 0 ? v.unreadable : 0,
  };
};

export const writeReport = (kv: KeyValueStore, report: RuntimeReport) => {
  const text = JSON.stringify(report);
  if (kv.getItem(SYNC_KEY.runtime) !== text) kv.setItem(SYNC_KEY.runtime, text);
};

// ---- menus too large to sync ----------------------------------------------------

export const readSkipped = (kv: KeyValueStore): Set<string> => {
  const parsed = parseJson(kv.getItem(SYNC_KEY.skip));
  return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
};

export const writeSkipped = (kv: KeyValueStore, ids: Set<string>) => {
  if (ids.size === 0) kv.removeItem(SYNC_KEY.skip);
  else kv.setItem(SYNC_KEY.skip, JSON.stringify([...ids].sort()));
};

// ---- per-menu state -------------------------------------------------------------

const parseState = (value: unknown): MenuSyncState | null => {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const int = (x: unknown) => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : null);
  const baseVersion = int(v.baseVersion);
  const seenVersion = int(v.seenVersion);
  const revision = int(v.revision);
  if (baseVersion === null || seenVersion === null || revision === null) return null;
  if (typeof v.dirty !== "boolean" || typeof v.editId !== "string") return null;
  return { baseVersion, seenVersion, dirty: v.dirty, editId: v.editId, revision };
};

export const readState = (kv: KeyValueStore, id: string): MenuSyncState | null =>
  parseState(parseJson(kv.getItem(syncMenuKey(id))));

export const readStates = (kv: KeyValueStore): SyncStates => {
  const states: SyncStates = table();
  for (const key of keysWithPrefix(kv, SYNC_MENU_PREFIX)) {
    const state = parseState(parseJson(kv.getItem(key)));
    if (state) states[key.slice(SYNC_MENU_PREFIX.length)] = state;
  }
  return states;
};

/**
 * This device's menus and their sync states, as the merge sees them. Menus set
 * aside as too large (SY-26) are included: they aren't pushed (the engine's
 * `held`), but pulls must still merge against them, so a change from another
 * device never overwrites them unseen.
 */
export const readLocal = (kv: KeyValueStore): Local => {
  const menus: { [id: string]: SavedMenu } = table();
  for (const { doc } of readStoredMenus(kv)) menus[doc.id] = doc;
  return { menus, sync: readStates(kv) };
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Writes what changed between `before` (as read) and `after`: menus first, then
 * their sync states. All or nothing: if browser storage refuses any write (it's
 * full, say), every key already written is put back as it was and the error is
 * thrown, so a menu and its revision never get out of step (SY-24, SY-33) and
 * the caller can simply try the whole thing again. Returns the ids whose stored
 * menu changed.
 */
export const writeLocal = (
  kv: KeyValueStore,
  before: Local,
  after: Local,
  now: number,
  /** More keys to write in the same all-or-nothing step (the pull cursor, say). */
  also: [string, string][] = []
): string[] => {
  /** Each key written: its value before, and the value written. */
  const undo: [string, string | null, string | null][] = [];
  // The same store, remembering each key's old value before it's written.
  const recording: KeyValueStore = {
    get length() {
      return kv.length;
    },
    key: (i) => kv.key(i),
    getItem: (key) => kv.getItem(key),
    setItem: (key, value) => {
      undo.push([key, kv.getItem(key), value]);
      kv.setItem(key, value);
    },
    removeItem: (key) => {
      undo.push([key, kv.getItem(key), null]);
      kv.removeItem(key);
    },
  };
  try {
    const changed = writeChanges(recording, before, after, now);
    for (const [key, value] of also) if (kv.getItem(key) !== value) recording.setItem(key, value);
    return changed;
  } catch (error) {
    for (const [key, value, written] of undo.reverse()) {
      // Only a key that still holds what this write put there: never undo a change
      // made since by someone else.
      if (kv.getItem(key) !== written) continue;
      try {
        if (value === null) kv.removeItem(key);
        else kv.setItem(key, value);
      } catch {
        // Putting back an older, never larger, value: nothing more to do if even that fails.
      }
    }
    throw error;
  }
};

const writeChanges = (kv: KeyValueStore, before: Local, after: Local, now: number): string[] => {
  const changed: string[] = [];
  const menuIds = new Set([...Object.keys(before.menus), ...Object.keys(after.menus)]);
  for (const id of menuIds) {
    const next = after.menus[id];
    if (same(before.menus[id], next)) continue;
    changed.push(id);
    if (next === undefined) {
      kv.removeItem(menuKey(id));
    } else {
      // Keep where an old menu came from (menu-store's legacyTitle), as saves do.
      const legacyTitle = (parseJson(kv.getItem(menuKey(id))) as { legacyTitle?: unknown } | undefined)?.legacyTitle;
      writeStoredMenu(kv, { doc: next, savedAt: now, ...(typeof legacyTitle === "string" ? { legacyTitle } : {}) });
    }
  }
  const stateIds = new Set([...Object.keys(before.sync), ...Object.keys(after.sync)]);
  for (const id of stateIds) {
    const next = after.sync[id];
    if (same(before.sync[id], next)) continue;
    if (next === undefined) kv.removeItem(syncMenuKey(id));
    else kv.setItem(syncMenuKey(id), JSON.stringify(next));
  }
  return changed.sort();
};

/** Menus changed here and not yet pushed. */
export const pendingCount = (local: Local) => Object.values(local.sync).filter((s) => s.dirty).length;

/** SY-9: removes the code and every bit of sync state from this device. Menus stay. */
export const clearSyncState = (kv: KeyValueStore) => {
  for (const key of keysWithPrefix(kv, "sync:")) kv.removeItem(key);
};

/** Forgets per-menu state and the cursor (a new account): every menu is pushed as new. */
export const resetMenuStates = (kv: KeyValueStore) => {
  for (const key of keysWithPrefix(kv, SYNC_MENU_PREFIX)) kv.removeItem(key);
  kv.removeItem(SYNC_KEY.cursor);
  kv.removeItem(SYNC_KEY.skip);
};
