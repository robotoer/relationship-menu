/**
 * The part of supporter sync every page needs at once, kept small: recording
 * saves and deletions for sync (SY-24, SY-30), and reading sync's state from
 * browser storage, so the heart shows without waiting (SY-71). It never touches
 * the network or keys. The rest (runtime.ts) loads later (lazy.ts).
 */

import type { KeyValueStore, SavedMenu } from "../menu-store";
import { readStoredMenus } from "../menu-store";
import type { SyncAccount, SyncNotice, SyncState } from "./context";
import {
  readAccount,
  readLocal,
  readReport,
  readSkipped,
  readState,
  readStates,
  syncIsOn,
  writeLocal,
  writeSkipped,
} from "./local-store";
import { Local, MergeContext, applyLocalDelete, applyLocalSave, mergeRecords } from "./merge";

export type MovedMenu = { from: string; to: string };

/** What storage tells sync about a save or deletion (src/storage.ts). Synchronous and never throws. */
export type SyncHooks = {
  /** A menu was just written. `previous` is what was stored before. Returns its new revision (SY-24), or null with sync off. */
  saved(doc: SavedMenu, startedFrom: number | null, previous: SavedMenu | undefined): number | null;
  /** A menu was just removed; `previous` is what was stored. */
  deleted(id: string, previous: SavedMenu | undefined): void;
  /** The menu's current revision, or null with sync off. */
  revisionOf(id: string): number | null;
  /**
   * Calls `listener` when sync (in this tab) added, replaced or removed stored
   * menus. `moved` lists menus that now live under a new id (merge.ts
   * `applyUnknownCreate`, SY-27): an editor showing `from` carries on as `to`.
   */
  onMenusChanged(listener: (ids: string[], moved: MovedMenu[]) => void): () => void;
};

/** The hooks, plus what the network part (runtime.ts) shares with them. */
export type LocalSync = {
  hooks: SyncHooks;
  /** Menus and their sync states as the merge sees them; menus without a state get one (to be pushed, SY-13). */
  currentLocal(): Local;
  /** Tells `onMenusChanged` listeners. */
  emitMenus(ids: string[], moved?: MovedMenu[]): void;
  /** Calls `listener` after every save or deletion recorded here. */
  onLocalChange(listener: () => void): () => void;
};

/** `local` with `id` as it was before the save or deletion that was just written. */
const withPrevious = (local: Local, id: string, previous: SavedMenu | undefined): Local => {
  const menus = Object.assign(Object.create(null), local.menus);
  if (previous) menus[id] = previous;
  else delete menus[id];
  return { menus, sync: local.sync };
};

export const createLocalSync = ({ kv, now, ctx }: { kv: KeyValueStore; now: () => number; ctx: MergeContext }): LocalSync => {
  const menuListeners = new Set<(ids: string[], moved: MovedMenu[]) => void>();
  const localListeners = new Set<() => void>();

  const currentLocal = (): Local => {
    const merged = mergeRecords(readLocal(kv, readSkipped(kv)), [], ctx);
    return { menus: merged.menus, sync: merged.sync };
  };

  const emitMenus = (ids: string[], moved: MovedMenu[] = []) => {
    if (ids.length === 0 && moved.length === 0) return;
    for (const listener of menuListeners) listener(ids, moved);
  };

  const changedHere = () => {
    for (const listener of localListeners) listener();
  };

  const hooks: SyncHooks = {
    saved: (doc, startedFrom, previous) => {
      if (!syncIsOn(kv)) return null;
      try {
        const skip = readSkipped(kv);
        if (skip.delete(doc.id)) writeSkipped(kv, skip); // it changed: try syncing it again (SY-26)
        const stored = currentLocal();
        const result = applyLocalSave(withPrevious(stored, doc.id, previous), doc, startedFrom, ctx);
        const changed = writeLocal(kv, stored, { menus: result.menus, sync: result.sync }, now());
        // A conflict copy (SY-35) is a menu the page doesn't know about yet.
        emitMenus(changed.filter((id) => id !== doc.id));
        changedHere();
        return result.revision;
      } catch {
        // Sync never fails a save (SY-30); the next round picks the menu up.
        try {
          return readState(kv, doc.id)?.revision ?? null;
        } catch {
          return null;
        }
      }
    },

    deleted: (id, previous) => {
      if (!syncIsOn(kv)) return;
      try {
        const stored = currentLocal();
        writeLocal(kv, stored, applyLocalDelete(withPrevious(stored, id, previous), id, ctx), now());
        changedHere();
      } catch {
        // As above.
      }
    },

    revisionOf: (id) => (syncIsOn(kv) ? (readState(kv, id)?.revision ?? 0) : null),

    onMenusChanged: (listener) => {
      menuListeners.add(listener);
      return () => menuListeners.delete(listener);
    },
  };

  return {
    hooks,
    currentLocal,
    emitMenus,
    onLocalChange: (listener) => {
      localListeners.add(listener);
      return () => localListeners.delete(listener);
    },
  };
};

const accountNotices = (account: SyncAccount | null): SyncNotice[] => {
  if (!account) return [];
  if (account.status === "none") return ["not_supporter"];
  if (account.status === "lapsed" || account.readOnly) return ["read_only"];
  return [];
};

/** Menus to upload: changed here, never synced (no state yet), or deleted and not yet pushed. */
export const pendingMenus = (kv: KeyValueStore): number => {
  const states = readStates(kv);
  const skip = readSkipped(kv);
  const ids = new Set(
    readStoredMenus(kv)
      .map((m) => m.doc.id)
      .filter((id) => !skip.has(id))
  );
  let n = 0;
  for (const id of ids) if (!states[id] || states[id].dirty) n++;
  for (const [id, state] of Object.entries(states)) if (state.dirty && !ids.has(id)) n++;
  return n;
};

/** Sync's state as browser storage records it ("off", or "on" with what the syncing tab last saw). */
export const readSyncState = (kv: KeyValueStore): SyncState => {
  if (!syncIsOn(kv)) return { kind: "off" };
  const report = readReport(kv);
  const account = readAccount(kv);
  const notices = [...new Set([...report.notices, ...accountNotices(account)])];
  // A replaced code also reads as "no supporter status": say only the first.
  const shown = notices.includes("code_replaced") ? notices.filter((n) => n !== "not_supporter") : notices;
  return {
    kind: "on",
    account,
    pending: pendingMenus(kv),
    lastSyncedAt: report.lastSyncedAt,
    notices: shown,
    unreadable: report.unreadable,
  };
};
