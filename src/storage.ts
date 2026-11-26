import { RelationshipMenuDocument } from "./model/menu";
import { recoverIpfsMenus } from "./ipfs-recovery";
import { newMenuId } from "./menu-id";
import { menuKey, migrateLegacyMenus, readLegacyEntries, readStoredMenus, writeStoredMenu } from "./menu-store";
import type { LocalMenuEntry } from "./legacy-menu-entries";

export { latestByTitle, parseLocalMenuEntry } from "./legacy-menu-entries";
export type { LocalMenuEntry } from "./legacy-menu-entries";

/**
 * Where menus are saved. Menus are keyed by their random id (spec SY-20, SY-21):
 * renaming a menu is an ordinary save, and two menus may share a title.
 */
export type Storage = {
  /** Saved menus by id; with an `id`, only that one (if it exists). */
  getDocuments(id?: string): Promise<{ [id: string]: RelationshipMenuDocument & { id: string } }>;
  /**
   * Saves menus (each under its `id`; one is made up if missing). Resolves to their
   * ids, or to an empty list if saving failed.
   */
  saveDocuments(...docs: RelationshipMenuDocument[]): Promise<string[]>;
  /** Removes the menu with this id. */
  deleteDocument(id: string): Promise<void>;
};

/** Every menu entry saved by versions before menu ids (legacy formats). */
export const readLocalMenuEntries = (): LocalMenuEntry[] => readLegacyEntries(localStorage);

/**
 * Creates the browser's menu storage (localStorage).
 *
 * Before each read it brings older menus up to date: first menus only the IPFS
 * version kept (SY-91), then giving every title-keyed menu an id (SY-90). Both are
 * safe to repeat and never lose a menu if interrupted.
 */
export const createLocalStorage = (): Storage => {
  // IndexedDB recovery runs once; if IndexedDB is unavailable those menus just stay hidden.
  let recovery: Promise<unknown> | null = null;
  const upToDate = async () => {
    await (recovery ??= recoverIpfsMenus().catch(() => 0));
    // Cheap and idempotent; also picks up saves from a tab still running an old version.
    migrateLegacyMenus(localStorage, newMenuId);
  };
  return {
    getDocuments: async (id?: string) => {
      await upToDate();
      // No prototype: ids are random, but keep lookups by user-supplied strings safe.
      const documents: { [id: string]: RelationshipMenuDocument & { id: string } } = Object.create(null);
      for (const { doc } of readStoredMenus(localStorage)) {
        if (id === undefined || id === doc.id) documents[doc.id] = doc;
      }
      return documents;
    },
    saveDocuments: async (...docs) => {
      const ids: string[] = [];
      for (const doc of docs) {
        const id = doc.id ?? newMenuId();
        // Keep where it came from (legacyTitle), so a later old-format copy updates it.
        const existing = readStoredMenus(localStorage).find((m) => m.doc.id === id);
        // Synchronous localStorage write: leaving the page right after can't lose it (SV-10).
        writeStoredMenu(localStorage, {
          doc: { ...doc, id },
          savedAt: Date.now(),
          ...(existing?.legacyTitle !== undefined ? { legacyTitle: existing.legacyTitle } : {}),
        });
        ids.push(id);
      }
      return ids;
    },
    deleteDocument: async (id: string) => {
      localStorage.removeItem(menuKey(id));
    },
  };
};
