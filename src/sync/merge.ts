/**
 * Supporter sync: the merge (spec §6, SY-17…SY-19, SY-24, SY-32, SY-34…SY-37).
 *
 * Pure functions over plain data: no storage, network or crypto. They work on
 * records that the records layer has already decrypted and checked, and they
 * never change their inputs. Ids for conflict copies and edit ids come from the
 * caller (`MergeContext`), so tests can make runs repeatable.
 *
 * Each menu this device syncs has a `MenuSyncState`. The merge table in §6 is
 * `mergeRecords`; `applyLocalSave` and `applyLocalDelete` are the local side;
 * `pushesFor`, `applyPushed`, `applyRejected` and `applyUnknownCreate` are the
 * push side the engine (`engine.ts`) drives; `applyResync` and
 * `dropUnsentDeletes` finish a pull. `docs/spec/formal/tla/Sync.tla` models the
 * same rules.
 */

import type { SavedMenu } from "../menu-store";
import type { Person, RelationshipMenuDocument } from "../model/menu";
import { uniqueTitle } from "../unique-title";

/** Per-menu sync state, kept in `sync:menu:<id>` (spec §5). */
export type MenuSyncState = {
  /**
   * The server version this device's copy is based on: the `If-Match` of its next
   * push. 0 means the server has never had it from here (`If-None-Match: *`).
   */
  baseVersion: number;
  /** The highest server version seen for this menu, readable or not (SY-18). */
  seenVersion: number;
  /** Changed here (edited or deleted) since the server last had this device's copy. */
  dirty: boolean;
  /**
   * Names this device's unpushed changes. A new one is made when a clean menu is
   * first changed, and every push until it is clean again carries it. A record
   * with this edit id is this device's own write, even if its reply was lost (SY-37).
   */
  editId: string;
  /** Local revision: goes up whenever the stored menu changes, here or by sync (SY-24). */
  revision: number;
};

export type Menus = { [id: string]: SavedMenu };
export type SyncStates = { [id: string]: MenuSyncState };
/** This device's menus and their sync states. */
export type Local = { menus: Menus; sync: SyncStates };

/** A menu document as it travels in a record (its id is the record's id). */
export type MenuContent = Omit<RelationshipMenuDocument, "id">;

/**
 * What a record says once decrypted and checked (SY-15, SY-16). `deviceId` is
 * the writer's device id, SY-35's tie-break after the edit time; records that
 * don't carry it fall back to the edit id.
 */
export type RecordBody =
  | { deleted: false; editId: string; deviceId?: string; doc: MenuContent }
  /** An encrypted tombstone (SY-19). */
  | { deleted: true; editId: string; deviceId?: string };

/** One server record, after the records layer tried to decrypt it. */
export type RemoteRecord =
  | { id: string; version: number; readable: true; body: RecordBody }
  /**
   * Failed to decrypt or check (SY-17). `claimsDeleted` is the server's bare
   * `deleted` flag, which counts for nothing (SY-19).
   */
  | { id: string; version: number; readable: false; claimsDeleted?: boolean };

export type MergeContext = {
  /** This device's id (`sync:device`), the tie-break after edit time (SY-35). */
  deviceId: string;
  /** A fresh random menu id (SY-20), for conflict copies. */
  newMenuId: () => string;
  /** A fresh random edit id. */
  newEditId: () => string;
};

/** A menu made by a conflict: the side that didn't keep the menu id (SY-35). */
export type ConflictCopy = { id: string; from: string; title: string };
/** A menu moved to a fresh id because the server forgot its old one (SY-23, SY-32). */
export type MovedMenu = { from: string; to: string };

export type MergeResult = Local & {
  copies: ConflictCopy[];
  moved: MovedMenu[];
  /** Ids whose stored menu was added, replaced or removed by sync (for SY-33). */
  changed: string[];
  /** Records skipped because they couldn't be read (SY-17). */
  unreadable: number;
};

/** A request to make for one dirty menu. `revision` is the local revision it carries. */
export type Push =
  | { kind: "put"; id: string; ifMatch: number | null; revision: number; body: RecordBody & { deleted: false } }
  | { kind: "delete"; id: string; ifMatch: number; revision: number; body: RecordBody & { deleted: true } };

// ---- helpers ---------------------------------------------------------------------

/** Plain objects without a prototype, so ids can't collide with `__proto__` and friends. */
const table = <T>(from?: { [id: string]: T }): { [id: string]: T } => Object.assign(Object.create(null), from);

const has = (o: object, id: string) => Object.prototype.hasOwnProperty.call(o, id);

const samePerson = (a: Person | undefined, b: Person | undefined) =>
  (a?.name ?? "") === (b?.name ?? "") && (a?.pronouns ?? "") === (b?.pronouns ?? "") && (a?.note ?? "") === (b?.note ?? "");

/** Same title, items, answers and person. Save times don't count. */
export const sameContent = (a: MenuContent, b: MenuContent) =>
  a.title === b.title && a.encoded === b.encoded && samePerson(a.person, b.person);

/** The document part of a stored menu, as a record carries it. */
export const contentOf = ({ id: _id, ...content }: SavedMenu): MenuContent => content;

/** "Title (from another device)", or "… (2)" and so on if that is taken (SY-35). */
export const conflictTitle = (title: string, taken: Set<string>) => {
  const base = `${title || "Untitled"} (from another device)`;
  return taken.has(base) ? uniqueTitle(base, taken) : base;
};

/** When a menu's latest edit was made: its save time (SY-35). */
const editTime = (doc: MenuContent) => doc.updatedAt ?? 0;

/**
 * Whether this device's dirty copy is the newer edit: later save time, then the
 * higher device id, then (same device, e.g. after turning sync off and on) the
 * higher edit id, so every device decides the same way.
 */
const localIsNewer = (
  local: MenuContent,
  localEdit: string,
  remote: { doc: MenuContent; editId: string; deviceId?: string },
  ctx: MergeContext
) => {
  const [a, b] = [editTime(local), editTime(remote.doc)];
  if (a !== b) return a > b;
  if (remote.deviceId !== undefined && ctx.deviceId !== remote.deviceId) return ctx.deviceId > remote.deviceId;
  return localEdit > remote.editId;
};

/** A working copy of `Local` that the functions below change and then return. */
class Draft {
  menus: Menus;
  sync: SyncStates;
  copies: ConflictCopy[] = [];
  moved: MovedMenu[] = [];
  changed: string[] = [];
  unreadable = 0;

  constructor(local: Local, readonly ctx: MergeContext) {
    this.menus = table(local.menus);
    this.sync = table(local.sync);
  }

  result(): MergeResult {
    return {
      menus: this.menus,
      sync: this.sync,
      copies: this.copies,
      moved: this.moved,
      changed: this.changed,
      unreadable: this.unreadable,
    };
  }

  freshId() {
    for (;;) {
      const id = this.ctx.newMenuId();
      if (!has(this.menus, id) && !has(this.sync, id)) return id;
    }
  }

  titles() {
    return new Set(Object.values(this.menus).map((m) => m.title));
  }

  noteChanged(id: string) {
    if (!this.changed.includes(id)) this.changed.push(id);
  }

  /** SY-13: a menu that was here before sync knew about it is new to the server. */
  adoptUnsynced() {
    for (const id of Object.keys(this.menus)) {
      if (!has(this.sync, id)) {
        this.sync[id] = { baseVersion: 0, seenVersion: 0, dirty: true, editId: this.ctx.newEditId(), revision: 0 };
      }
    }
  }

  /** Stores `doc` (or removes the menu, for null) as the server's version `version`, clean. */
  take(id: string, version: number, editId: string, doc: MenuContent | null) {
    const before = this.menus[id];
    const changed = doc === null ? before !== undefined : before === undefined || !sameContent(contentOf(before), doc);
    if (doc === null) delete this.menus[id];
    else this.menus[id] = { ...doc, id };
    const revision = (this.sync[id]?.revision ?? 0) + (changed ? 1 : 0);
    this.sync[id] = { baseVersion: version, seenVersion: version, dirty: false, editId, revision };
    if (changed) this.noteChanged(id);
  }

  /** Keeps `doc` as a new, unsynced menu (a conflict copy), titled so it can be told apart. */
  keepAsCopy(from: string, doc: MenuContent) {
    const id = this.freshId();
    const title = conflictTitle(doc.title, this.titles());
    this.menus[id] = { ...doc, id, title };
    this.sync[id] = { baseVersion: 0, seenVersion: 0, dirty: true, editId: this.ctx.newEditId(), revision: 1 };
    this.copies.push({ id, from, title });
    this.noteChanged(id);
  }

  /**
   * The server has forgotten this menu (its tombstone was purged, SY-23) but this
   * device still has changes to it: move them to a fresh id and push them as a new
   * menu. A forgotten id is never written again, because devices that saw its
   * tombstone would ignore its restarted versions (SY-18). The old id's state
   * stays, as a deleted menu, so a late save to it ends up here again. The
   * revision carries over, so an editor that follows the move still knows
   * whether it has seen the latest version (SY-24).
   */
  moveToFreshId(id: string) {
    const menu = this.menus[id];
    const state = this.sync[id];
    if (!menu || !state) return;
    const to = this.freshId();
    delete this.menus[id];
    this.menus[to] = { ...menu, id: to };
    this.sync[to] = { baseVersion: 0, seenVersion: 0, dirty: true, editId: this.ctx.newEditId(), revision: state.revision };
    this.sync[id] = { ...state, dirty: false, baseVersion: state.seenVersion, revision: state.revision + 1 };
    this.moved.push({ from: id, to });
    this.noteChanged(id);
    this.noteChanged(to);
  }

  /** The merge table in spec §6, for one record. */
  apply(record: RemoteRecord) {
    const { id, version } = record;
    const state = this.sync[id];
    // SY-18: never go back to (or repeat) a version already seen. This also makes
    // merging the same records twice the same as once.
    if (version <= (state?.seenVersion ?? 0)) return;

    if (!record.readable) {
      // SY-17, SY-19: skipped and counted; never replaces or deletes a local menu,
      // whatever the server's bare flag says. Remembering the version means this
      // device won't push the menu (it would only be rejected) until a readable,
      // newer version arrives, and won't accept an older one meanwhile.
      this.unreadable++;
      this.sync[id] = state
        ? { ...state, seenVersion: version }
        : { baseVersion: 0, seenVersion: version, dirty: false, editId: "", revision: 0 };
      return;
    }

    const body = record.body;
    const remote = body.deleted ? null : body.doc;
    const mine = this.menus[id];

    // Nothing here, or a clean copy: add it, fast-forward (SY-34), delete it, or
    // just remember the version of a deletion.
    if (!state || !state.dirty) {
      this.take(id, version, body.editId, remote);
      return;
    }

    // Our own write whose reply was lost (SY-37): it is on the server now. Still
    // dirty only if this device changed the menu again since. (If another device
    // has already built on that write, the record carries its edit id instead,
    // and this is a conflict: the copy is redundant, but nothing is lost.)
    if (body.editId === state.editId) {
      const same = mine === undefined ? remote === null : remote !== null && sameContent(contentOf(mine), remote);
      // Same content: hold exactly the server's copy (save times included).
      if (same && remote !== null) this.menus[id] = { ...remote, id };
      this.sync[id] = { ...state, baseVersion: version, seenVersion: version, dirty: !same };
      return;
    }

    if (mine === undefined) {
      // Deleted here, not yet pushed. Against a deletion: done. Against a change
      // made elsewhere: edit beats delete (SY-36), take the remote.
      this.take(id, version, body.editId, remote);
      return;
    }

    if (remote === null) {
      // Changed here, deleted elsewhere: edit beats delete (SY-36). Keep ours and
      // push it over the tombstone.
      this.sync[id] = { ...state, baseVersion: version, seenVersion: version };
      return;
    }

    if (sameContent(contentOf(mine), remote)) {
      // The same change on both sides: nothing to keep apart.
      this.take(id, version, body.editId, remote);
      return;
    }

    // SY-35: both changed. The newer edit keeps the menu id; the other is kept as
    // a new menu. Both are pushed.
    if (localIsNewer(contentOf(mine), state.editId, { ...body, doc: remote }, this.ctx)) {
      this.sync[id] = { ...state, baseVersion: version, seenVersion: version };
      this.keepAsCopy(id, remote);
    } else {
      const ours = contentOf(mine);
      this.take(id, version, body.editId, remote);
      this.keepAsCopy(id, ours);
    }
  }
}

// ---- pulls -------------------------------------------------------------------------

/**
 * Applies records from the server (a page of a pull, or the current record in a
 * 412) to this device's menus, per the table in spec §6. Records may come in any
 * order and may repeat.
 */
export const mergeRecords = (local: Local, records: readonly RemoteRecord[], ctx: MergeContext): MergeResult => {
  const draft = new Draft(local, ctx);
  draft.adoptUnsynced();
  for (const record of records) draft.apply(record);
  return draft.result();
};

/**
 * After a pull has caught up with the server: a menu deleted here that the server
 * never had (it was made here and its first push never landed) has nothing left
 * to sync, so its state goes. Call only when no push is in flight: a push that
 * already landed would have shown up in the pull.
 */
export const dropUnsentDeletes = (local: Local): Local => {
  const sync = table(local.sync);
  for (const [id, s] of Object.entries(sync)) {
    if (s.dirty && s.baseVersion === 0 && s.seenVersion === 0 && !has(local.menus, id)) delete sync[id];
  }
  return { menus: local.menus, sync };
};

/**
 * SY-32: a pull from 0 after `resync` has caught up, and `present` holds every id
 * it listed. A menu this device had seen on the server that is now missing was
 * deleted and its tombstone forgotten: a clean copy is deleted here; one with
 * changes here moves to a fresh id and is pushed as a new menu (edit beats delete).
 */
export const applyResync = (local: Local, present: ReadonlySet<string>, ctx: MergeContext): MergeResult => {
  const draft = new Draft(local, ctx);
  for (const [id, state] of Object.entries(local.sync)) {
    if (present.has(id) || state.seenVersion === 0) continue;
    const mine = draft.menus[id];
    if (mine !== undefined && state.dirty) {
      draft.moveToFreshId(id);
    } else {
      if (mine !== undefined) {
        delete draft.menus[id];
        draft.noteChanged(id);
      }
      draft.sync[id] = { ...state, dirty: false, baseVersion: state.seenVersion, revision: state.revision + (mine ? 1 : 0) };
    }
  }
  return draft.result();
};

// ---- local changes -------------------------------------------------------------

const changedHere = (state: MenuSyncState | undefined, ctx: MergeContext, revision: number): MenuSyncState => ({
  baseVersion: state?.baseVersion ?? 0,
  seenVersion: state?.seenVersion ?? 0,
  dirty: true,
  editId: state?.dirty ? state.editId : ctx.newEditId(),
  revision,
});

/**
 * A save from the editor (SY-24, SY-30). `startedFrom` is the revision of the
 * stored menu the editor loaded (null for a menu not saved before). If sync has
 * changed the stored menu since, that is a conflict (SY-35), never an overwrite:
 * the save is the newer edit and keeps the id, and the version it didn't see is
 * kept as a copy. Returns the menu's new revision for the editor's next save.
 */
export const applyLocalSave = (
  local: Local,
  doc: SavedMenu,
  startedFrom: number | null,
  ctx: MergeContext
): MergeResult & { revision: number } => {
  const draft = new Draft(local, ctx);
  const state = draft.sync[doc.id];
  const stored = draft.menus[doc.id];
  const current = state?.revision ?? 0;
  if ((startedFrom ?? 0) < current && stored !== undefined && !sameContent(contentOf(stored), contentOf(doc))) {
    draft.keepAsCopy(doc.id, contentOf(stored));
  }
  // A stored menu that was deleted meanwhile comes back: edit beats delete (SY-36).
  const revision = current + 1;
  draft.menus[doc.id] = doc;
  draft.sync[doc.id] = changedHere(state, ctx, revision);
  return { ...draft.result(), revision };
};

/** The user deleted a menu here. Its tombstone is pushed later (SY-19). */
export const applyLocalDelete = (local: Local, id: string, ctx: MergeContext): Local => {
  if (!has(local.menus, id)) return local;
  const menus = table(local.menus);
  delete menus[id];
  const sync = table(local.sync);
  const state = sync[id];
  if (state) sync[id] = changedHere(state, ctx, state.revision + 1);
  return { menus, sync };
};

// ---- pushes ----------------------------------------------------------------------

/**
 * The requests this device should make, one per dirty menu, in id order. A menu
 * whose latest server version couldn't be read waits (its push would only be
 * rejected), and so does a deletion of a menu the server may never have had: the
 * next pull settles it (`dropUnsentDeletes`).
 */
export const pushesFor = (local: Local, deviceId: string): Push[] => {
  const pushes: Push[] = [];
  for (const id of Object.keys(local.sync).sort()) {
    const s = local.sync[id];
    if (!s.dirty || s.baseVersion < s.seenVersion) continue;
    const menu = local.menus[id];
    if (menu !== undefined) {
      pushes.push({
        kind: "put",
        id,
        ifMatch: s.baseVersion > 0 ? s.baseVersion : null,
        revision: s.revision,
        body: { deleted: false, editId: s.editId, deviceId, doc: contentOf(menu) },
      });
    } else if (s.baseVersion > 0) {
      pushes.push({
        kind: "delete",
        id,
        ifMatch: s.baseVersion,
        revision: s.revision,
        body: { deleted: true, editId: s.editId, deviceId },
      });
    }
  }
  return pushes;
};

/** The server accepted `push` as `version`. Clean, unless the menu changed here since it was sent. */
export const applyPushed = (local: Local, push: Push, version: number): Local => {
  const state = local.sync[push.id];
  if (!state) return local;
  const seen = Math.max(state.seenVersion, version);
  const sync = table(local.sync);
  sync[push.id] = { ...state, baseVersion: seen, seenVersion: seen, dirty: state.revision !== push.revision };
  return { menus: local.menus, sync };
};

/**
 * A menu's first push (`If-None-Match: *`) failed without saying whether the
 * server applied it (the reply was lost). It is never pushed as new under that
 * id again: if it did land, another device may delete it, and once that
 * tombstone is forgotten (SY-23), a new menu under the same id would restart at
 * version 1, below the version those devices remember (SY-18). So the menu
 * moves to a fresh id, and the old id becomes a deletion that the next pull
 * settles: pushed if the menu turns out to be on the server, dropped if not.
 */
export const applyUnknownCreate = (local: Local, push: Push, ctx: MergeContext): MergeResult => {
  const draft = new Draft(local, ctx);
  const state = draft.sync[push.id];
  const menu = draft.menus[push.id];
  if (push.kind !== "put" || push.ifMatch !== null || !state || state.baseVersion !== 0 || menu === undefined) {
    return draft.result();
  }
  const to = draft.freshId();
  delete draft.menus[push.id];
  draft.menus[to] = { ...menu, id: to };
  draft.sync[to] = { baseVersion: 0, seenVersion: 0, dirty: true, editId: ctx.newEditId(), revision: state.revision };
  // Same edit id: a pull that finds the menu recognises it as ours (SY-37).
  draft.sync[push.id] = { ...state, dirty: true, revision: state.revision + 1 };
  draft.moved.push({ from: push.id, to });
  draft.noteChanged(push.id);
  draft.noteChanged(to);
  return draft.result();
};

/**
 * The server rejected `push` (412) and sent its current record, or null if it has
 * none. The record is merged like a pulled one (SY-35…SY-37). With no record, the
 * server has forgotten the menu (SY-23): a deletion is done, and changes move to a
 * fresh id.
 */
export const applyRejected = (local: Local, push: Push, current: RemoteRecord | null, ctx: MergeContext): MergeResult => {
  if (current !== null) return mergeRecords(local, [current], ctx);
  const draft = new Draft(local, ctx);
  const state = draft.sync[push.id];
  if (state?.dirty) {
    if (has(draft.menus, push.id)) draft.moveToFreshId(push.id);
    else draft.sync[push.id] = { ...state, dirty: false, baseVersion: state.seenVersion };
  }
  return draft.result();
};
