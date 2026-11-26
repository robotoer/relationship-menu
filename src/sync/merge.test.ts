/**
 * The merge table in spec §6, one row at a time. The properties in
 * src/__props__/sync.props.test.ts check the same rules on random inputs.
 */
import { Engine, PUSH_DELAY_MS, Reply, createEngine, nextRequest, receive, saveLocally, syncStep } from "./engine";
import {
  Local,
  MenuSyncState,
  MergeContext,
  RemoteRecord,
  applyLocalSave,
  dropUnsentDeletes,
  mergeRecords,
  pushesFor,
  recordVersion,
} from "./merge";
import { fromHex } from "./bytes";
import { deriveKeys } from "./keys";
import { decryptRecord, encryptRecord, tombstone } from "./records";
import { VECTOR_ACCOUNT } from "./test-vectors";

const ID = "menu00000000000000000a";
const ctx = (): MergeContext => {
  let n = 0;
  return { newMenuId: () => `copy${++n}`.padEnd(22, "0"), newEditId: () => `edit${++n}` };
};
const doc = (encoded: string, title = "Us", updatedAt = 1) => ({ title, encoded, updatedAt });
const state = (s: Partial<MenuSyncState>): MenuSyncState => ({ baseVersion: 3, seenVersion: 3, dirty: false, editId: "mine", revision: 5, ...s });
const live = (version: number, encoded: string, editId = "theirs", updatedAt = 2): RemoteRecord => ({
  id: ID,
  version,
  readable: true,
  record: { id: ID, ...doc(encoded, "Us", updatedAt), editId },
});
const deletion = (version: number, editId = "theirs"): RemoteRecord => ({ id: ID, version, readable: true, record: tombstone(ID, editId) });
const nextReq = (engine: Engine) => {
  const next = nextRequest(engine, 0);
  if (!("request" in next)) throw new Error("expected a request");
  return next.engine;
};
const local = (encoded: string | null, s: Partial<MenuSyncState> | null): Local => ({
  menus: encoded === null ? {} : { [ID]: { id: ID, ...doc(encoded) } },
  sync: s === null ? {} : { [ID]: state(s) },
});

describe("the merge table (spec §6)", () => {
  it("nothing here, live remote: add it, clean", () => {
    const r = mergeRecords(local(null, null), [live(1, "theirs")], ctx());
    expect(r.menus[ID].encoded).toBe("theirs");
    expect(r.sync[ID]).toMatchObject({ baseVersion: 1, seenVersion: 1, dirty: false });
  });

  it("nothing here, tombstone: nothing, but the version is remembered", () => {
    const r = mergeRecords(local(null, null), [deletion(4)], ctx());
    expect(r.menus[ID]).toBeUndefined();
    expect(r.sync[ID]).toMatchObject({ seenVersion: 4, dirty: false });
  });

  it("SY-34: clean copy, live remote: fast-forward", () => {
    const r = mergeRecords(local("old", {}), [live(4, "new")], ctx());
    expect(r.menus[ID].encoded).toBe("new");
    expect(r.sync[ID]).toMatchObject({ baseVersion: 4, dirty: false, revision: 6 });
    expect(r.changed).toEqual([ID]);
  });

  it("clean copy, tombstone: deleted here", () => {
    const r = mergeRecords(local("old", {}), [deletion(4)], ctx());
    expect(r.menus[ID]).toBeUndefined();
    expect(r.sync[ID]).toMatchObject({ baseVersion: 4, dirty: false });
  });

  it("SY-37: dirty, same edit id as the remote: our own write whose reply was lost, marked clean", () => {
    const r = mergeRecords(local("mine", { dirty: true }), [live(4, "mine", "mine", 1)], ctx());
    expect(r.copies).toEqual([]);
    expect(r.sync[ID]).toMatchObject({ baseVersion: 4, dirty: false });
  });

  it("SY-37: …and if it changed again since, still dirty, now based on that write", () => {
    const r = mergeRecords(local("mine, then more", { dirty: true }), [live(4, "mine", "mine")], ctx());
    expect(r.copies).toEqual([]);
    expect(r.menus[ID].encoded).toBe("mine, then more");
    expect(r.sync[ID]).toMatchObject({ baseVersion: 4, dirty: true });
  });

  it("SY-35: dirty, live remote with a newer edit: the remote keeps the id, ours becomes a copy", () => {
    const r = mergeRecords(local("mine", { dirty: true }), [live(4, "theirs", "theirs", 9)], ctx());
    expect(r.menus[ID].encoded).toBe("theirs");
    expect(r.copies).toHaveLength(1);
    const copy = r.menus[r.copies[0].id];
    expect(copy).toMatchObject({ title: "Us (from another device)", encoded: "mine" });
    expect(pushesFor(r).map((p) => [p.id, p.kind, p.ifMatch])).toEqual([[copy.id, "put", null]]);
  });

  it("SY-35: dirty, live remote with an older edit: ours keeps the id, the remote becomes a copy; both are pushed", () => {
    const r = mergeRecords(local("mine", { dirty: true }), [live(4, "theirs", "theirs", 0)], ctx());
    expect(r.menus[ID].encoded).toBe("mine");
    expect(r.menus[r.copies[0].id]).toMatchObject({ title: "Us (from another device)", encoded: "theirs" });
    expect(pushesFor(r).map((p) => [p.id, p.ifMatch]).sort()).toEqual([[r.copies[0].id, null], [ID, 4]].sort());
  });

  it("SY-35: the same edit time: the higher edit id wins (records carry no device id)", () => {
    const r = mergeRecords(local("mine", { dirty: true }), [live(4, "theirs", "theirs", 1)], ctx());
    // "mine" < "theirs": theirs wins.
    expect(r.menus[ID].encoded).toBe("theirs");
  });

  it('SY-35: a copy\'s title gets "(2)" if "Title (from another device)" is taken', () => {
    const before = local("mine", { dirty: true });
    before.menus["other0000000000000000a"] = { id: "other0000000000000000a", title: "Us (from another device)", encoded: "x" };
    before.sync["other0000000000000000a"] = state({});
    const r = mergeRecords(before, [live(4, "theirs", "theirs", 9)], ctx());
    expect(r.copies[0].title).toBe("Us (from another device) (2)");
  });

  it("SY-36: dirty, tombstone: edit beats delete, ours is pushed over the tombstone", () => {
    const r = mergeRecords(local("mine", { dirty: true }), [deletion(4)], ctx());
    expect(r.menus[ID].encoded).toBe("mine");
    expect(pushesFor(r)).toMatchObject([{ kind: "put", id: ID, ifMatch: 4 }]);
  });

  it("SY-36: deleted here (not pushed), live remote changed elsewhere: edit beats delete, take the remote", () => {
    const r = mergeRecords(local(null, { dirty: true }), [live(4, "theirs")], ctx());
    expect(r.menus[ID].encoded).toBe("theirs");
    expect(r.sync[ID]).toMatchObject({ dirty: false });
  });

  it("deleted here, tombstone: done", () => {
    const r = mergeRecords(local(null, { dirty: true }), [deletion(4)], ctx());
    expect(r.sync[ID]).toMatchObject({ baseVersion: 4, dirty: false });
    expect(pushesFor(r)).toEqual([]);
  });

  it("SY-18: an older version than one already seen is ignored", () => {
    const r = mergeRecords(local("mine", { seenVersion: 5, baseVersion: 5 }), [live(4, "old")], ctx());
    expect(r.menus[ID].encoded).toBe("mine");
  });

  it("SY-17, SY-19: a record that can't be read, even one the server says is deleted, is counted and changes nothing", () => {
    const r = mergeRecords(local("mine", {}), [{ id: ID, version: 4, readable: false, claimsDeleted: true }], ctx());
    expect(r.menus[ID].encoded).toBe("mine");
    expect(r.unreadable).toBe(1);
  });

  it("SY-24: a save from an older revision keeps the version it didn't see as a copy", () => {
    const r = applyLocalSave(local("synced meanwhile", { revision: 6 }), { id: ID, ...doc("my edit") }, 5, ctx());
    expect(r.menus[ID].encoded).toBe("my edit");
    expect(r.menus[r.copies[0].id].encoded).toBe("synced meanwhile");
    expect(r.revision).toBe(7);
  });
});

describe("a new menu's first push with no answer", () => {
  it("SY-37, SY-18: moves to a fresh id; the old id is deleted if the push landed, dropped if not", () => {
    const c = ctx();
    let engine: Engine = createEngine({ menus: {}, sync: {} }, 0, 0, c);
    engine = receive(nextReq(engine), { kind: "pulled", records: [], next: 0, more: false, resync: false }, 0, c).engine;
    engine = saveLocally(engine, { id: ID, ...doc("new") }, null, 0, c).engine;
    const sent = nextRequest(engine, PUSH_DELAY_MS);
    if (!("request" in sent) || sent.request.kind !== "put") throw new Error("expected a push");
    const done = receive(sent.engine, { kind: "failed" }, PUSH_DELAY_MS, c);
    const [{ from, to }] = done.events.moved;
    expect(from).toBe(ID);
    expect(done.engine.local.menus[to].encoded).toBe("new");
    expect(done.engine.local.menus[ID]).toBeUndefined();
    // The push had landed: the pull finds it under our edit id, and it is deleted.
    expect(recordVersion(sent.request)).toBe(1);
    const landed: RemoteRecord = { id: ID, version: 1, readable: true, record: sent.request.record };
    const pulled = mergeRecords(done.engine.local, [landed], c);
    expect(pushesFor(pulled).map((p) => [p.kind, p.id, p.ifMatch]).sort()).toEqual([["delete", ID, 1], ["put", to, null]].sort());
    // It hadn't: a pull that has caught up drops the old id.
    expect(dropUnsentDeletes(done.engine.local).sync[ID]).toBeUndefined();
  });
});

describe("with the records layer (records.ts)", () => {
  it("SY-15, SY-16, SY-19: a push's record and tombstone round-trip through encryption and merge on the other device", async () => {
    const keys = await deriveKeys(fromHex(VECTOR_ACCOUNT.secret));
    const id = "AAECAwQFBgcICQoLDA0ODw";
    const mine: Local = { menus: { [id]: { id, title: "Us", encoded: "x", person: { name: "Sam" }, updatedAt: 5 } }, sync: {} };
    const [put] = pushesFor(mergeRecords(mine, [], ctx()));
    const sealed = await encryptRecord(keys, recordVersion(put), put.record);
    const read = await decryptRecord(keys, { id, version: recordVersion(put), deleted: false, ciphertext: sealed });
    const other = mergeRecords({ menus: {}, sync: {} }, [{ id, version: 1, readable: true, record: read }], ctx());
    expect(other.menus[id]).toEqual(mine.menus[id]);

    const gone = { ...other, menus: {}, sync: { [id]: { ...other.sync[id], dirty: true, editId: "del1" } } };
    const [del] = pushesFor(gone);
    expect(del).toMatchObject({ kind: "delete", ifMatch: 1 });
    const sealedDel = await encryptRecord(keys, recordVersion(del), del.record);
    const readDel = await decryptRecord(keys, { id, version: 2, deleted: true, ciphertext: sealedDel });
    expect(mergeRecords(other, [{ id, version: 2, readable: true, record: readDel }], ctx()).menus[id]).toBeUndefined();
  });
});

describe("syncStep", () => {
  it("SY-30: a save made while a request is in the air is kept", async () => {
    const c = ctx();
    let engine: Engine = createEngine({ menus: {}, sync: {} }, 0, 0, c);
    let release: (reply: Reply) => void = () => {};
    const step = syncStep(
      () => engine,
      (e) => (engine = e),
      () => new Promise<Reply>((resolve) => (release = resolve)),
      () => 0,
      c
    );
    // The first pull is in the air; save meanwhile.
    engine = saveLocally(engine, { id: ID, ...doc("saved") }, null, 0, c).engine;
    release({ kind: "pulled", records: [], next: 0, more: false, resync: false });
    await step;
    expect(engine.local.menus[ID].encoded).toBe("saved");
    expect(engine.local.sync[ID]).toMatchObject({ dirty: true });
    expect(engine.inFlight).toBeNull();
  });
});
