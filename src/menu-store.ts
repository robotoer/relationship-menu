/**
 * Menus in browser storage, keyed by menu id (spec SY-20, SY-21, SY-90).
 *
 * Each menu is one entry, `menu-v2:<id>` → JSON `{ title, encoded, person?,
 * createdAt?, updatedAt?, savedAt, legacyTitle? }`. The `menu-v2:` prefix can't
 * collide with the older `menu:<title>` entries, whatever the title.
 *
 * Older entries (`menu:<title>`, IPFS-era `menu:<CID>` / `menu:pending:<title>`)
 * are migrated once: each title's latest copy gets a random id and is written as
 * an id-keyed entry *before* its old entries are removed, so stopping at any
 * point loses nothing. `legacyTitle` remembers where a menu came from, so a
 * re-run (or a save from an old tab still running the previous version) updates
 * the same menu instead of making a duplicate.
 */

import { sanitizePerson } from "./person";
import { MENU_ID_PATTERN } from "./menu-id";
import { RelationshipMenuDocument } from "./model/menu";
import { LocalMenuEntry, latestByTitle, parseLocalMenuEntry } from "./legacy-menu-entries";

/** The parts of `window.localStorage` this module uses (tests pass a fake). */
export type KeyValueStore = {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const MENU_KEY_PREFIX = "menu-v2:";
export const menuKey = (id: string) => `${MENU_KEY_PREFIX}${id}`;

/** A saved menu: a document plus its id. */
export type SavedMenu = RelationshipMenuDocument & { id: string };

export type StoredMenu = {
  doc: SavedMenu;
  /** When this entry was last written (ms since epoch); 0 if unknown. */
  savedAt: number;
  /** The title it was stored under before ids existed, if it was migrated. */
  legacyTitle?: string;
};

/** Every key, read up front so entries can be added and removed while looping. */
const keysOf = (kv: KeyValueStore): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < kv.length; i++) {
    const key = kv.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
};

export const parseStoredMenu = (key: string, value: string | null): StoredMenu | null => {
  if (!key.startsWith(MENU_KEY_PREFIX) || value === null) return null;
  const id = key.slice(MENU_KEY_PREFIX.length);
  if (!MENU_ID_PATTERN.test(id)) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.title !== "string" || typeof parsed.encoded !== "string") return null;
    const doc: SavedMenu = { id, title: parsed.title, encoded: parsed.encoded };
    if (typeof parsed.createdAt === "number") doc.createdAt = parsed.createdAt;
    if (typeof parsed.updatedAt === "number") doc.updatedAt = parsed.updatedAt;
    const person = sanitizePerson(parsed.person);
    if (person) doc.person = person;
    const menu: StoredMenu = { doc, savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0 };
    if (typeof parsed.legacyTitle === "string") menu.legacyTitle = parsed.legacyTitle;
    return menu;
  } catch {
    return null;
  }
};

export const readStoredMenus = (kv: KeyValueStore): StoredMenu[] =>
  keysOf(kv).flatMap((key) => parseStoredMenu(key, kv.getItem(key)) ?? []);

export const writeStoredMenu = (kv: KeyValueStore, { doc, savedAt, legacyTitle }: StoredMenu) => {
  const { id, ...fields } = doc;
  kv.setItem(menuKey(id), JSON.stringify({ ...fields, savedAt, ...(legacyTitle !== undefined ? { legacyTitle } : {}) }));
};

/** A fresh id not already used by a stored menu (ids are random; this is belt and braces). */
const unusedId = (kv: KeyValueStore, newId: () => string): string => {
  for (;;) {
    const id = newId();
    if (kv.getItem(menuKey(id)) === null) return id;
  }
};

/** Entries saved by versions before menu ids. */
export const readLegacyEntries = (kv: KeyValueStore): LocalMenuEntry[] =>
  keysOf(kv).flatMap((key) => parseLocalMenuEntry(key, kv.getItem(key)) ?? []);

/**
 * SY-90: gives each older menu (one per title, the latest copy, SV-6) a random id.
 * The id-keyed entry is written before that title's old entries are removed. If a
 * menu with that `legacyTitle` already exists (an interrupted run, or an old tab
 * that saved again), it's updated in place when the old copy is newer, and the
 * old entries are simply removed. Returns how many id-keyed entries it wrote.
 */
export const migrateLegacyMenus = (kv: KeyValueStore, newId: () => string): number => {
  const entries = readLegacyEntries(kv);
  if (entries.length === 0) return 0;
  const latest = latestByTitle(entries);
  // No prototype: titles are user text (e.g. "__proto__").
  const byLegacyTitle: { [title: string]: StoredMenu } = Object.create(null);
  for (const menu of readStoredMenus(kv)) {
    if (menu.legacyTitle !== undefined && !(menu.legacyTitle in byLegacyTitle)) {
      byLegacyTitle[menu.legacyTitle] = menu;
    }
  }
  let written = 0;
  for (const [title, entry] of Object.entries(latest)) {
    const existing = byLegacyTitle[title];
    if (!existing || entry.savedAt > existing.savedAt) {
      const doc: SavedMenu = { ...entry.doc, id: existing?.doc.id ?? unusedId(kv, newId) };
      if (doc.createdAt === undefined && existing?.doc.createdAt !== undefined) doc.createdAt = existing.doc.createdAt;
      writeStoredMenu(kv, { doc, savedAt: entry.savedAt, legacyTitle: title });
      written++;
    }
    // Only after the id-keyed copy exists: remove every old entry for this title.
    for (const old of entries) {
      if (old.doc.title === title) kv.removeItem(old.key);
    }
  }
  return written;
};
