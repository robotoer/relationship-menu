import { RelationshipMenuDocument } from "./model/menu";
import { recoverIpfsMenus } from "./ipfs-recovery";
import { newMenuId } from "./menu-id";
import {
  MENU_KEY_PREFIX,
  SavedMenu,
  menuKey,
  migrateLegacyMenus,
  parseStoredMenu,
  readLegacyEntries,
  readStoredMenus,
  writeStoredMenu,
} from "./menu-store";
import type { LocalMenuEntry } from "./legacy-menu-entries";
import type { SyncHooks } from "./sync/hooks";
import { decodeData } from "./data-encoder";
import { sanitizePerson } from "./compare-slug";

export { latestByTitle, parseLocalMenuEntry } from "./legacy-menu-entries";
export type { LocalMenuEntry } from "./legacy-menu-entries";

/** Menus that changed outside this page's own saves: by sync, or in another tab. */
export type StorageChange = {
  ids: string[];
  /** Menus that now live under a new id (sync); an editor showing `from` carries on as `to`. */
  moved: { from: string; to: string }[];
};

/**
 * Where menus are saved. Menus are keyed by their random id (spec SY-20, SY-21):
 * renaming a menu is an ordinary save, and two menus may share a title.
 */
export type Storage = {
  /**
   * Saved menus by id; with an `id`, only that one (if it exists). With sync on,
   * each carries its `revision` (SY-24).
   */
  getDocuments(id?: string): Promise<{ [id: string]: RelationshipMenuDocument & { id: string } }>;
  /**
   * Saves menus (each under its `id`; one is made up if missing). Resolves to their
   * ids, or to an empty list if saving failed.
   */
  saveDocuments(...docs: RelationshipMenuDocument[]): Promise<string[]>;
  /**
   * Saves the editor's menu. `startedFrom` is the revision it was opened or last
   * saved at (SY-24): if sync changed the menu since, both versions are kept
   * (SY-35). Saving what's already stored writes nothing. Resolves to the menu's
   * revision now (null with sync off); rejects if it couldn't be saved.
   */
  saveMenu(doc: RelationshipMenuDocument & { id: string }, startedFrom: number | null): Promise<number | null>;
  /** Removes the menu with this id. */
  deleteDocument(id: string): Promise<void>;
  /** Calls `listener` when menus change other than by this page's saves. */
  subscribe(listener: (change: StorageChange) => void): () => void;
};

/** Every menu entry saved by versions before menu ids (legacy formats). */
export const readLocalMenuEntries = (): LocalMenuEntry[] => readLegacyEntries(localStorage);

const storedMenu = (id: string) => parseStoredMenu(menuKey(id), localStorage.getItem(menuKey(id)));

/** JSON with object keys sorted, so the same data in another field order compares equal. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  );

/** The same groups in the same order (order is part of a menu), with the same items and answers. */
const sameGroups = (a: unknown, b: unknown): boolean => {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return canonical(a) === canonical(b);
  const [ga, gb] = [Object.keys(a), Object.keys(b)];
  return (
    ga.length === gb.length &&
    ga.every((group, i) => group === gb[i]) &&
    ga.every((group) => canonical((a as Record<string, unknown>)[group]) === canonical((b as Record<string, unknown>)[group]))
  );
};

/**
 * Whether two saves hold the same menu (SY-28): title, person, and groups (in
 * order), items (in order) and answers, decoded, so a re-encoding of the same
 * menu with an item's fields in another order counts as the same. Save times
 * don't count.
 */
export const sameMenuContent = (a: RelationshipMenuDocument, b: RelationshipMenuDocument): boolean => {
  if (a.title !== b.title || canonical(sanitizePerson(a.person) ?? null) !== canonical(sanitizePerson(b.person) ?? null)) return false;
  if (a.encoded === b.encoded) return true;
  try {
    return sameGroups(decodeData(a.encoded), decodeData(b.encoded));
  } catch {
    return false;
  }
};

/** The document as stored: no `revision` (that lives in sync state). */
const asStored = ({ revision: _revision, ...doc }: RelationshipMenuDocument & { id: string }): SavedMenu => doc;

/**
 * Creates the browser's menu storage (localStorage).
 *
 * Before each read it brings older menus up to date: first menus only the IPFS
 * version kept (SY-91), then giving every title-keyed menu an id (SY-90). Both are
 * safe to repeat and never lose a menu if interrupted.
 *
 * With `sync`, every save and deletion is written first (SV-10, SY-30) and then
 * told to sync, which never fails or delays it.
 */
export const createLocalStorage = ({ sync }: { sync?: SyncHooks } = {}): Storage => {
  // IndexedDB recovery runs once; if IndexedDB is unavailable those menus just stay hidden.
  let recovery: Promise<unknown> | null = null;
  const upToDate = async () => {
    await (recovery ??= recoverIpfsMenus().catch(() => 0));
    // Cheap and idempotent; also picks up saves from a tab still running an old version.
    migrateLegacyMenus(localStorage, newMenuId);
  };

  /**
   * Writes one menu (synchronous: leaving the page right after can't lose it,
   * SV-10). With sync on, sync does the write, so that a conflict copy (SY-35) is
   * stored before the version it keeps is replaced.
   */
  const write = (doc: SavedMenu, startedFrom: number | null | undefined): number | null => {
    const existing = storedMenu(doc.id);
    const writeDoc = () =>
      // Keep where it came from (legacyTitle), so a later old-format copy updates it.
      writeStoredMenu(localStorage, {
        doc,
        savedAt: Date.now(),
        ...(existing?.legacyTitle !== undefined ? { legacyTitle: existing.legacyTitle } : {}),
      });
    if (!sync) {
      writeDoc();
      return null;
    }
    return sync.saved(doc, startedFrom === undefined ? sync.revisionOf(doc.id) : startedFrom, existing?.doc, writeDoc);
  };

  return {
    getDocuments: async (id?: string) => {
      await upToDate();
      // No prototype: ids are random, but keep lookups by user-supplied strings safe.
      const documents: { [id: string]: RelationshipMenuDocument & { id: string } } = Object.create(null);
      for (const { doc } of readStoredMenus(localStorage)) {
        if (id !== undefined && id !== doc.id) continue;
        const revision = sync?.revisionOf(doc.id) ?? null;
        documents[doc.id] = revision === null ? doc : { ...doc, revision };
      }
      return documents;
    },

    saveDocuments: async (...docs) => {
      const ids: string[] = [];
      for (const doc of docs) {
        const id = doc.id ?? newMenuId();
        write(asStored({ ...doc, id }), doc.revision);
        ids.push(id);
      }
      return ids;
    },

    saveMenu: async (doc, startedFrom) => {
      const existing = storedMenu(doc.id);
      // Nothing new (say, a synced change the editor just showed): don't make it a new edit.
      if (existing && sameMenuContent(existing.doc, doc)) {
        return sync?.revisionOf(doc.id) ?? null;
      }
      return write(asStored(doc), startedFrom);
    },

    deleteDocument: async (id: string) => {
      const existing = storedMenu(id);
      localStorage.removeItem(menuKey(id));
      sync?.deleted(id, existing?.doc);
    },

    subscribe: (listener) => {
      const offSync = sync?.onMenusChanged((ids, moved) => listener({ ids, moved }));
      // Other tabs' saves (and their sync) arrive as storage events.
      const onStorage = (event: StorageEvent) => {
        if (event.key === null) listener({ ids: [], moved: [] });
        else if (event.key.startsWith(MENU_KEY_PREFIX)) listener({ ids: [event.key.slice(MENU_KEY_PREFIX.length)], moved: [] });
      };
      window.addEventListener("storage", onStorage);
      return () => {
        offSync?.();
        window.removeEventListener("storage", onStorage);
      };
    },
  };
};
