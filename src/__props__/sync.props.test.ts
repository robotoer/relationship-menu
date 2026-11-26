/**
 * Property tests for supporter sync (spec §6 and §16: SY-17…SY-19, SY-24,
 * SY-31, SY-32, SY-34…SY-39). They drive the REAL merge (src/sync/merge.ts) and
 * engine (src/sync/engine.ts). The two-device simulation runs both against an
 * in-memory server that behaves like server/src/menus.ts (versions, seq pages,
 * 412 with the current record, tombstones, forgotten tombstones and `resync`),
 * and checks the same properties as docs/spec/formal/tla/Sync.tla.
 *
 * Edit histories (§16): every edit adds a fresh tag to the menu's content, and
 * a menu's `encoded` is the set of tags it has seen. "Lost" can then be stated
 * exactly: an edit is lost if no menu holds its tag and no deletion was made by
 * a device that had seen it.
 */
import fc from "fast-check";
import type { SavedMenu } from "../menu-store";
import {
  Engine,
  Reply,
  Request,
  createEngine,
  deleteLocally,
  nextRequest,
  pendingPushes,
  receive,
  retryDelayMs,
  saveLocally,
  wantPull,
  PUSH_DELAY_MS,
  RETRY_MAX_MS,
} from "../sync/engine";
import {
  Local,
  MenuContent,
  MenuSyncState,
  MergeContext,
  Push,
  RemoteRecord,
  applyLocalSave,
  contentOf,
  docOf,
  mergeRecords,
  sameContent,
} from "../sync/merge";
import { MenuRecord, tombstone } from "../sync/records";

const pad = (s: string) => s.padEnd(22, "0");
const counter = (prefix: string) => {
  let n = 0;
  return () => pad(`${prefix}${++n}`);
};
/** Ids for one device, prefixed with its name so runs are repeatable. */
const contextFor = (device: string): MergeContext => ({
  newMenuId: counter(`${device}c`),
  newEditId: counter(`${device}e`),
});

// =====================================================================================
// 1. The merge on its own: random local menus and states, random records.
// =====================================================================================

const IDS = ["m1", "m2", "m3", "m4"].map(pad);
const TITLES = ["A", "B", "A (from another device)"];
const EDIT_IDS = ["e1", "e2", "e3"];

const contentArb: fc.Arbitrary<MenuContent> = fc.record({
  title: fc.constantFrom(...TITLES),
  encoded: fc.constantFrom("x", "y", "z"),
  updatedAt: fc.nat(3),
});

type Slot = { menu: MenuContent | null; state: MenuSyncState | null };
const stateArb: fc.Arbitrary<MenuSyncState> = fc
  .record({ base: fc.nat(4), extra: fc.nat(2), dirty: fc.boolean(), editId: fc.constantFrom(...EDIT_IDS), revision: fc.nat(5) })
  .map(({ base, extra, dirty, editId, revision }) => ({ baseVersion: base, seenVersion: base + (extra === 2 ? 1 : 0), dirty, editId, revision }));
const localArb: fc.Arbitrary<Local> = fc
  .array(fc.record({ menu: fc.option(contentArb, { nil: null }), state: fc.option(stateArb, { nil: null }) }), {
    minLength: IDS.length,
    maxLength: IDS.length,
  })
  .map((slots: Slot[]) => {
    const local: Local = { menus: {}, sync: {} };
    slots.forEach(({ menu, state }, i) => {
      if (menu) local.menus[IDS[i]] = { ...menu, id: IDS[i] };
      if (state) local.sync[IDS[i]] = state;
    });
    return local;
  });

/** A record as `decryptRecord` returns it: a menu, or a tombstone (records.ts). */
const readableArb: fc.Arbitrary<RemoteRecord> = fc
  .record({
    id: fc.constantFrom(...IDS),
    version: fc.integer({ min: 1, max: 6 }),
    deleted: fc.boolean(),
    editId: fc.constantFrom(...EDIT_IDS, "r1", "r2"),
    doc: contentArb,
  })
  .map(({ id, version, deleted, editId, doc }) => ({
    id,
    version,
    readable: true as const,
    record: deleted ? tombstone(id, editId) : { id, ...doc, editId },
  }));
const unreadableArb: fc.Arbitrary<RemoteRecord> = fc.record({
  id: fc.constantFrom(...IDS),
  version: fc.integer({ min: 1, max: 6 }),
  readable: fc.constant(false as const),
  claimsDeleted: fc.boolean(),
});
const recordArb: fc.Arbitrary<RemoteRecord> = fc.oneof({ weight: 5, arbitrary: readableArb }, { weight: 1, arbitrary: unreadableArb });
/** One page: each menu at most once, like the server's pull (one row per menu). */
const pageArb = (records = recordArb) => fc.uniqueArray(records, { selector: (r) => r.id, maxLength: IDS.length });

const LOCAL_DEVICE = "devA";
const merge = (local: Local, records: RemoteRecord[]) => mergeRecords(local, records, contextFor(LOCAL_DEVICE));
const plain = ({ menus, sync }: Local) => JSON.parse(JSON.stringify({ menus, sync }));
/** The local side as the merge sees it before any record: unsynced menus adopted (SY-13). */
const adopted = (local: Local) => plain(merge(local, []));

describe("sync merge properties (spec §6)", () => {
  it("SY-34…SY-37: merging the same records twice is the same as merging them once", () => {
    fc.assert(
      fc.property(localArb, fc.array(recordArb, { maxLength: 8 }), (local, records) => {
        const once = merge(local, records);
        const twice = merge(once, records);
        expect(plain(twice)).toEqual(plain(once));
        expect(twice.copies).toEqual([]);
      }),
      { numRuns: 500 }
    );
  });

  it("SY-18: a version no newer than one already seen changes nothing", () => {
    fc.assert(
      fc.property(localArb, fc.array(recordArb, { maxLength: 8 }), (local, records) => {
        const old = records.filter((r) => r.version <= (local.sync[r.id]?.seenVersion ?? 0));
        expect(plain(merge(local, old))).toEqual(adopted(local));
      }),
      { numRuns: 500 }
    );
  });

  it("SY-17, SY-19: a record that can't be read never replaces or deletes a local menu, whatever its deleted flag", () => {
    fc.assert(
      fc.property(localArb, pageArb(unreadableArb), (local, records) => {
        const result = merge(local, records);
        expect(plain(result).menus).toEqual(adopted(local).menus);
        expect(result.copies).toEqual([]);
        expect(result.unreadable).toBe(records.filter((r) => r.version > (local.sync[r.id]?.seenVersion ?? 0)).length);
        // …and its version is remembered (SY-18), so that menu isn't pushed until a readable newer one arrives.
        for (const r of records) expect(result.sync[r.id].seenVersion).toBeGreaterThanOrEqual(r.version);
      }),
      { numRuns: 300 }
    );
  });

  it("SY-34: a menu that hasn't changed here takes the newer synced version", () => {
    fc.assert(
      fc.property(localArb, pageArb(), (local, records) => {
        const result = merge(local, records);
        for (const r of records) {
          const before = adopted(local).sync[r.id] as MenuSyncState | undefined;
          if (!r.readable || r.version <= (before?.seenVersion ?? 0) || before?.dirty) continue;
          expect(result.sync[r.id]).toMatchObject({ baseVersion: r.version, seenVersion: r.version, dirty: false, editId: r.record.editId });
          if (r.record.deleted) expect(result.menus[r.id]).toBeUndefined();
          else expect(contentOf(result.menus[r.id])).toEqual(docOf(r.record));
          expect(result.copies.filter((c) => c.from === r.id)).toEqual([]);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("SY-35, SY-36, SY-37: changes made here always survive, as the menu or a copy, and so does the other side's", () => {
    fc.assert(
      fc.property(localArb, pageArb(), (local, records) => {
        const before = merge(local, []);
        const result = merge(local, records);
        const survives = (id: string, doc: MenuContent) =>
          (result.menus[id] !== undefined && sameContent(contentOf(result.menus[id]), doc)) ||
          result.copies.some(
            (c) => c.from === id && result.menus[c.id].encoded === doc.encoded && result.menus[c.id].title.startsWith(`${doc.title || "Untitled"} (from another device)`)
          );
        for (const r of records) {
          const s = before.sync[r.id];
          const mine = before.menus[r.id];
          if (!r.readable || r.version <= (s?.seenVersion ?? 0) || !s?.dirty) continue;
          const copies = result.copies.filter((c) => c.from === r.id);
          if (r.record.editId === s.editId) {
            // SY-37: our own write (its reply was lost): no copy, and our version stays.
            expect(copies).toEqual([]);
            if (mine) expect(survives(r.id, contentOf(mine))).toBe(true);
            continue;
          }
          if (mine) {
            // Ours survives: under its id, or as a copy (SY-35); over a deletion, it stays and is pushed (SY-36).
            expect(survives(r.id, contentOf(mine))).toBe(true);
            if (r.record.deleted) expect(result.sync[r.id]).toMatchObject({ dirty: true, baseVersion: r.version });
          }
          // The other device's change survives too, unless it was a deletion.
          if (!r.record.deleted) expect(survives(r.id, docOf(r.record))).toBe(true);
          expect(copies.length).toBeLessThanOrEqual(1);
          for (const c of copies) expect(result.sync[c.id]).toMatchObject({ baseVersion: 0, dirty: true });
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("SY-35: a conflict copy is titled \"Title (from another device)\", or \"… (2)\" and so on if that is taken", () => {
    fc.assert(
      fc.property(localArb, readableArb, (local, record) => {
        const result = merge(local, [record]);
        for (const c of result.copies) {
          const others = Object.values(result.menus).filter((m) => m.id !== c.id);
          expect(others.map((m) => m.title)).not.toContain(c.title);
          expect(c.title).toMatch(/^.* \(from another device\)( \(\d+\))?$/);
          if (/\(\d+\)$/.test(c.title)) expect(others.map((m) => m.title)).toContain(c.title.replace(/ \(\d+\)$/, ""));
        }
      }),
      { numRuns: 1000 }
    );
  });

  it("SY-24: a save that started from an older revision than the stored one keeps both versions", () => {
    fc.assert(
      fc.property(localArb, fc.constantFrom(...IDS), contentArb, fc.nat(6), (local, id, content, startedFrom) => {
        const ctx = contextFor(LOCAL_DEVICE);
        const before = mergeRecords(local, [], ctx);
        const stored = before.menus[id];
        const revision = before.sync[id]?.revision ?? 0;
        const doc: SavedMenu = { ...content, id };
        const result = applyLocalSave(before, doc, startedFrom, ctx);
        expect(result.menus[id]).toEqual(doc);
        expect(result.sync[id]).toMatchObject({ dirty: true, revision: revision + 1 });
        expect(result.revision).toBe(revision + 1);
        const conflict = startedFrom < revision && stored !== undefined && !sameContent(contentOf(stored), content);
        expect(result.copies.length).toBe(conflict ? 1 : 0);
        if (conflict) expect(result.menus[result.copies[0].id].encoded).toBe(stored.encoded);
      }),
      { numRuns: 500 }
    );
  });
});

// =====================================================================================
// 2. An in-memory server that behaves like server/src/menus.ts.
// =====================================================================================

type Row = { id: string; version: number; seq: number; deleted: boolean; record: MenuRecord };

/**
 * An in-memory server/src/menus.ts: versions, seq, pages, 412 with the current
 * record, tombstones, and forgotten tombstones with `resync`. It adds two things
 * this simulation showed the real server needs (a follow-up there): it honours
 * `full` (see `Request` in engine.ts), without which a full listing longer than
 * one page never finishes, as every later page is answered `resync` again; and
 * every pull reply says `purged` (see `Reply`), so a tombstone forgotten while a
 * full listing is part-way through is noticed.
 */
class FakeServer {
  rows = new Map<string, Row>();
  seq = 0;
  /** Newest seq of a forgotten tombstone (accounts.purged_seq). */
  purgedSeq = 0;
  /** Small pages, so pulls take several (the real server sends 100). */
  pageSize = 2;

  private toRemote(row: Row): RemoteRecord {
    return { id: row.id, version: row.version, readable: true, record: structuredClone(row.record) };
  }

  /** GET /v1/menus?since=[&full=1] */
  list(since: number, full = false): Reply {
    const purged = this.purgedSeq;
    if (!full && since > 0 && since < purged) return { kind: "pulled", records: [], next: 0, more: false, resync: true, purged };
    const rows = [...this.rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    const page = rows.slice(0, this.pageSize);
    return {
      kind: "pulled",
      records: page.map((r) => this.toRemote(r)),
      next: page.length > 0 ? page[page.length - 1].seq : since,
      more: rows.length > this.pageSize,
      resync: false,
      purged,
    };
  }

  /** PUT or DELETE /v1/menus/:id, conditional on the version (SY-42). */
  write(push: Push): Reply {
    const row = this.rows.get(push.id);
    const record = structuredClone(push.record);
    if (push.kind === "put" && push.ifMatch === null) {
      if (row) return { kind: "rejected", current: this.toRemote(row) };
      this.rows.set(push.id, { id: push.id, version: 1, seq: ++this.seq, deleted: false, record });
      return { kind: "accepted", version: 1, seq: this.seq };
    }
    if (!row || row.version !== push.ifMatch) return { kind: "rejected", current: row ? this.toRemote(row) : null };
    const next = { id: push.id, version: row.version + 1, seq: ++this.seq, deleted: push.kind === "delete", record };
    this.rows.set(push.id, next);
    return { kind: "accepted", version: next.version, seq: next.seq };
  }

  handle(request: Request): Reply {
    return request.kind === "pull" ? this.list(request.since, request.full) : this.write(request);
  }

  /** The daily cron, with time abstracted: forget every tombstone (SY-23, SY-45). */
  purge() {
    for (const row of [...this.rows.values()]) {
      if (!row.deleted) continue;
      this.purgedSeq = Math.max(this.purgedSeq, row.seq);
      this.rows.delete(row.id);
    }
  }
}

// =====================================================================================
// 3. Two devices and the server, random interleavings (SY-38, SY-39).
// =====================================================================================

type Device = {
  name: string;
  ctx: MergeContext;
  engine: Engine;
  online: boolean;
  /** Sent and not yet at the server. */
  wire: Request | null;
  /** Answered by the server and not yet received. */
  inbox: Reply | null;
  /** An open editor: the menu it loaded and the revision it loaded (SY-24). */
  editor: { doc: SavedMenu; revision: number } | null;
};

type Action =
  | { kind: "edit"; dev: number; pick: number; rename: number | null }
  | { kind: "create"; dev: number; title: number }
  | { kind: "delete"; dev: number; pick: number }
  | { kind: "open"; dev: number; pick: number }
  | { kind: "editorSave"; dev: number }
  | { kind: "send"; dev: number }
  | { kind: "serve"; dev: number; loseReply: boolean }
  | { kind: "receive"; dev: number }
  /** send, serve and receive in one go. */
  | { kind: "roundTrip"; dev: number; loseReply: boolean }
  | { kind: "tick"; ms: number }
  | { kind: "offline"; dev: number }
  | { kind: "online"; dev: number }
  | { kind: "visible"; dev: number }
  | { kind: "purge" };

const SIM_TITLES = ["Us", "Them", "Us (from another device)"];
const dev = fc.nat(1);
const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("edit" as const), dev, pick: fc.nat(5), rename: fc.option(fc.nat(SIM_TITLES.length - 1), { nil: null, freq: 4 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("create" as const), dev, title: fc.nat(SIM_TITLES.length - 1) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("delete" as const), dev, pick: fc.nat(5) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("open" as const), dev, pick: fc.nat(5) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("editorSave" as const), dev }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("send" as const), dev }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("serve" as const), dev, loseReply: fc.nat(3).map((n) => n === 0) }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("receive" as const), dev }) },
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("roundTrip" as const), dev, loseReply: fc.nat(3).map((n) => n === 0) }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("tick" as const),
      ms: fc.oneof(fc.integer({ min: 0, max: 3_000 }), fc.constant(PUSH_DELAY_MS), fc.constant(RETRY_MAX_MS)),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("offline" as const), dev }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("online" as const), dev }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("visible" as const), dev }) },
  { weight: 2, arbitrary: fc.constant({ kind: "purge" as const }) }
);
const actionsArb = (maxLength: number) => fc.array(actionArb, { maxLength, size: "max" });

/** One run: the random actions, then everyone online until nothing changes. */
const simulate = (start: { menus: [number, number]; synced: boolean }, actions: Action[]) => {
  const sim = new Simulation(start);
  for (const a of actions) sim.step(a);
  sim.settle();
  sim.checkConverged();
  return sim;
};

/**
 * Menus each device has before turning sync on (SY-13), 0–2 each, and whether
 * both devices have already synced once (so they share menus to conflict over).
 */
const startArb = fc.record({ menus: fc.tuple(fc.nat(2), fc.nat(2)), synced: fc.boolean() });

const tagsOf = (doc: { encoded: string }): string[] => JSON.parse(doc.encoded);
const withTag = (doc: { encoded: string }, tag: string) => JSON.stringify([...tagsOf(doc), tag].sort());

class Simulation {
  server = new FakeServer();
  now = 1_000;
  devices: Device[];
  /** Every edit made (its tag), and the tags of every deletion's menu (§16). */
  made = new Set<string>();
  deletedSeen = new Set<string>();
  private nextTag = 0;
  /** Highest seenVersion per device and menu, to check SY-18 along the way. */
  private seen = new Map<string, number>();
  violations: string[] = [];
  copiesMade = 0;
  /** How often each interesting case came up, to check the runs reach them. */
  static reached: { [what: string]: number } = {};
  private note(what: string) {
    Simulation.reached[what] = (Simulation.reached[what] ?? 0) + 1;
  }

  constructor({ menus: start, synced }: { menus: [number, number]; synced: boolean }) {
    this.devices = ["devA", "devB"].map((name, i) => {
      const ctx = contextFor(name);
      const menus: Local["menus"] = {};
      for (let k = 0; k < start[i]; k++) {
        const id = ctx.newMenuId();
        const tag = this.tag();
        menus[id] = { id, title: SIM_TITLES[k % 2], encoded: JSON.stringify([tag]), createdAt: this.now, updatedAt: this.now };
      }
      return { name, ctx, engine: createEngine({ menus, sync: {} }, 0, this.now, ctx), online: true, wire: null, inbox: null, editor: null };
    });
    if (synced) this.settle();
  }

  private tag() {
    const tag = `t${++this.nextTag}`;
    this.made.add(tag);
    return tag;
  }

  private liveIds(d: Device) {
    return Object.keys(d.engine.local.menus).sort();
  }

  private pick(d: Device, n: number): SavedMenu | undefined {
    const ids = this.liveIds(d);
    return ids.length > 0 ? d.engine.local.menus[ids[n % ids.length]] : undefined;
  }

  /** Saves locally and returns the menu's new revision. */
  private save(d: Device, doc: SavedMenu, startedFrom: number | null) {
    const saved = saveLocally(d.engine, doc, startedFrom, this.now, d.ctx);
    d.engine = saved.engine;
    this.copiesMade += saved.events.copies.length;
    return saved.revision;
  }

  private deliver(d: Device, loseReply: boolean) {
    if (!d.wire) return;
    const request = d.wire;
    d.wire = null;
    // Offline: the request never reaches the server.
    if (!d.online) {
      d.inbox = { kind: "failed", notApplied: true };
      return;
    }
    const reply = this.server.handle(request);
    // The server applied it, but the answer never arrives (SY-37).
    d.inbox = loseReply ? { kind: "failed" } : reply;
    if (loseReply && reply.kind === "accepted") this.note("lost reply to an accepted write");
    if (reply.kind === "rejected") this.note(reply.current ? "412 with the current record" : "412, server forgot the menu");
    if (reply.kind === "pulled" && reply.resync) this.note("resync");
    if (reply.kind === "pulled" && reply.more) this.note("pull with more pages");
  }

  private checkRequest(d: Device, request: Request) {
    if (request.kind === "pull") return;
    const s = d.engine.local.sync[request.id];
    // SY-31, SY-42: every write is conditional on the version this device is based on.
    if (!s?.dirty) this.violations.push(`${d.name} pushed clean ${request.id}`);
    const expected = s && s.baseVersion > 0 ? s.baseVersion : null;
    if (request.ifMatch !== expected) this.violations.push(`${d.name} pushed ${request.id} with If-Match ${request.ifMatch}, base ${s?.baseVersion}`);
    if (request.kind === "delete" && request.ifMatch === null) this.violations.push(`unconditional delete`);
  }

  private take(d: Device) {
    if (!d.inbox) return;
    const reply = d.inbox;
    d.inbox = null;
    const request = d.engine.inFlight;
    const before = d.engine.local;
    const done = receive(d.engine, reply, this.now, d.ctx);
    d.engine = done.engine;
    this.copiesMade += done.events.copies.length;
    if (done.events.copies.length > 0) this.note("conflict copy");
    if (done.events.moved.length > 0) this.note("moved to a fresh id");
    if (request && request.kind !== "pull") {
      const s = before.sync[request.id];
      if (reply.kind === "rejected" && reply.current?.readable && reply.current.record.editId === s?.editId) this.note("own write recognised (SY-37)");
      if (reply.kind === "rejected" && reply.current?.readable && reply.current.record.deleted && before.menus[request.id]) this.note("edit beats delete: pushed over a tombstone");
      if (reply.kind === "rejected" && reply.current?.readable && !reply.current.record.deleted && !before.menus[request.id]) this.note("edit beats delete: deletion here undone");
    }
    if (Object.keys(before.sync).some((id) => !(id in done.engine.local.sync))) this.note("unsent deletion settled");
    // The editor follows a menu that moved to a fresh id (SY-32), keeping what it loaded.
    for (const { from, to } of done.events.moved) {
      if (d.editor?.doc.id === from) d.editor = { ...d.editor, doc: { ...d.editor.doc, id: to } };
    }
  }

  private send(d: Device) {
    if (d.wire || d.inbox) return;
    const next = nextRequest(d.engine, this.now);
    if (!("request" in next)) return;
    this.checkRequest(d, next.request);
    d.engine = next.engine;
    d.wire = next.request;
    if (!d.online) this.deliver(d, false);
  }

  step(a: Action): void {
    const d = "dev" in a ? this.devices[a.dev] : this.devices[0];
    switch (a.kind) {
      case "edit": {
        const menu = this.pick(d, a.pick);
        if (!menu) return this.step({ kind: "create", dev: a.dev, title: a.rename ?? 0 });
        const doc = { ...menu, encoded: withTag(menu, this.tag()), updatedAt: this.now, ...(a.rename !== null ? { title: SIM_TITLES[a.rename] } : {}) };
        this.save(d, doc, d.engine.local.sync[menu.id]?.revision ?? 0);
        break;
      }
      case "create": {
        const id = d.ctx.newMenuId();
        this.save(d, { id, title: SIM_TITLES[a.title], encoded: JSON.stringify([this.tag()]), createdAt: this.now, updatedAt: this.now }, null);
        break;
      }
      case "delete": {
        const menu = this.pick(d, a.pick);
        if (!menu) return;
        for (const t of tagsOf(menu)) this.deletedSeen.add(t);
        d.engine = deleteLocally(d.engine, menu.id, this.now, d.ctx);
        break;
      }
      case "open": {
        const menu = this.pick(d, a.pick);
        if (menu) d.editor = { doc: menu, revision: d.engine.local.sync[menu.id]?.revision ?? 0 };
        break;
      }
      case "editorSave": {
        // The editor saves what it loaded plus a new edit, saying which revision it loaded (SY-24).
        if (!d.editor) return;
        const doc = { ...d.editor.doc, encoded: withTag(d.editor.doc, this.tag()), updatedAt: this.now };
        if (d.editor.revision < (d.engine.local.sync[doc.id]?.revision ?? 0)) this.note("save from an older revision (SY-24)");
        d.editor = { doc, revision: this.save(d, doc, d.editor.revision) };
        break;
      }
      case "send":
        this.send(d);
        break;
      case "serve":
        this.deliver(d, a.loseReply);
        break;
      case "receive":
        this.take(d);
        break;
      case "roundTrip":
        this.send(d);
        this.deliver(d, a.loseReply);
        this.take(d);
        break;
      case "tick":
        this.now += a.ms;
        break;
      case "offline":
        d.online = false;
        break;
      case "online":
        d.online = true;
        break;
      case "visible":
        d.engine = wantPull(d.engine);
        break;
      case "purge":
        this.server.purge();
        break;
    }
    this.checkInvariants();
  }

  /** Every device online, nothing lost any more, until a full round changes nothing on the server. */
  settle() {
    for (const d of this.devices) d.online = true;
    for (let round = 0; round < 40; round++) {
      const before = this.server.seq;
      for (const d of this.devices) {
        this.deliver(d, false);
        this.take(d);
        d.engine = wantPull(d.engine);
        for (let i = 0; i < 1_000; i++) {
          const next = nextRequest(d.engine, this.now);
          if ("request" in next) {
            this.checkRequest(d, next.request);
            d.engine = next.engine;
            d.wire = next.request;
            this.deliver(d, false);
            this.take(d);
            this.checkInvariants();
            continue;
          }
          const busy = pendingPushes(d.engine).length > 0 || d.engine.pulling || d.engine.pullWanted;
          if (busy && next.wait !== null) {
            this.now += Math.max(1, next.wait);
            continue;
          }
          break;
        }
      }
      if (round > 0 && this.server.seq === before) return;
    }
    this.violations.push("did not settle");
  }

  /** Tags held by live menus on `devices` (and, optionally, live rows on the server). */
  private held(devices: Device[], server: boolean) {
    const tags = new Set<string>();
    for (const d of devices) for (const m of Object.values(d.engine.local.menus)) for (const t of tagsOf(m)) tags.add(t);
    if (server) for (const r of this.server.rows.values()) if (!r.deleted) for (const t of tagsOf(r.record)) tags.add(t);
    return tags;
  }

  checkInvariants() {
    // SY-39 at every step (TLA+ NoSilentLoss): every edit is in a live menu on a
    // device or the server, or a device that had seen it deleted the menu.
    const held = this.held(this.devices, true);
    for (const t of this.made) {
      if (!held.has(t) && !this.deletedSeen.has(t)) this.violations.push(`edit ${t} lost`);
    }
    // SY-18: a device never goes back to an older version of a menu.
    for (const d of this.devices) {
      for (const [id, s] of Object.entries(d.engine.local.sync)) {
        const key = `${d.name}/${id}`;
        if (s.seenVersion < (this.seen.get(key) ?? 0)) this.violations.push(`${key} went back to version ${s.seenVersion}`);
        this.seen.set(key, s.seenVersion);
        if (s.baseVersion > s.seenVersion) this.violations.push(`${key} based on an unseen version`);
      }
    }
  }

  /** SY-38: every device holds exactly the server's live menus, and nothing is waiting to be pushed. */
  checkConverged() {
    const canon = (doc: MenuContent) =>
      JSON.stringify([doc.title, doc.encoded, doc.person ?? null, doc.createdAt ?? null, doc.updatedAt ?? null]);
    const serverMenus = new Map<string, string>();
    for (const r of this.server.rows.values()) if (!r.deleted) serverMenus.set(r.id, canon(docOf(r.record)));
    for (const d of this.devices) {
      const mine = d.engine.local.menus;
      const ids = Object.keys(mine).sort();
      if (JSON.stringify(ids) !== JSON.stringify([...serverMenus.keys()].sort())) {
        this.violations.push(`${d.name} has ${ids.join(",")}; server has ${[...serverMenus.keys()].sort().join(",")}`);
        continue;
      }
      for (const id of ids) {
        if (canon(contentOf(mine[id])) !== serverMenus.get(id)) this.violations.push(`${d.name} differs on ${id}`);
      }
      const dirty = Object.entries(d.engine.local.sync).filter(([, s]) => s.dirty);
      if (dirty.length > 0) this.violations.push(`${d.name} still dirty: ${dirty.map(([id]) => id).join(",")}`);
    }
    // SY-39 after settling: every edit is in some menu on every device, unless a device that had seen it deleted it.
    for (const d of this.devices) {
      const held = this.held([d], false);
      for (const t of this.made) if (!held.has(t) && !this.deletedSeen.has(t)) this.violations.push(`${d.name} lacks edit ${t}`);
    }
  }
}

describe("sync between two devices (spec §6, SY-38, SY-39)", () => {
  it("SY-38, SY-39: two devices and the server converge, and no edit is silently lost", () => {
    fc.assert(
      fc.property(startArb, actionsArb(100), (start, actions) => {
        expect(simulate(start, actions).violations).toEqual([]);
      }),
      // SYNC_RUNS=50000 for a longer search.
      { numRuns: Number((globalThis as { process?: { env: { SYNC_RUNS?: string } } }).process?.env.SYNC_RUNS) || 1000 }
    );
  }, 600_000);

  it("the simulation reaches every case in the merge table, lost replies, resync and moves", () => {
    const expected = [
      "lost reply to an accepted write",
      "own write recognised (SY-37)",
      "412 with the current record",
      "412, server forgot the menu",
      "conflict copy",
      "edit beats delete: pushed over a tombstone",
      "edit beats delete: deletion here undone",
      "save from an older revision (SY-24)",
      "unsent deletion settled",
      "resync",
      "moved to a fresh id",
      "pull with more pages",
    ];
    // A fixed seed, so this is the same every time; the property above uses a new one each run.
    Simulation.reached = {};
    fc.assert(
      fc.property(startArb, actionsArb(100), (start, actions) => {
        expect(simulate(start, actions).violations).toEqual([]);
      }),
      { seed: 20261125, numRuns: 1000 }
    );
    for (const what of expected) expect(Simulation.reached[what] ?? 0, what).toBeGreaterThan(0);
  }, 60_000);

  it("SY-38, SY-39 without deletions or forgotten tombstones: edits are never dropped at all", () => {
    const noDeletes = actionArb.filter((a) => a.kind !== "delete" && a.kind !== "purge");
    fc.assert(
      fc.property(startArb, fc.array(noDeletes, { maxLength: 80, size: "max" }), (start, actions) => {
        const sim = simulate(start, actions);
        expect(sim.violations).toEqual([]);
        expect(sim.deletedSeen.size).toBe(0);
      }),
      { numRuns: 300 }
    );
  }, 60_000);

  it("SY-37: with one device editing, lost replies and offline periods never make a conflict copy", () => {
    // Like SyncOneWriter.cfg: device B only syncs. (No editor: two editors on one
    // device can conflict with each other, SY-24.)
    const userAction = ["edit", "create", "delete", "open", "editorSave"];
    const oneWriter = actionArb.filter(
      (a) => a.kind !== "open" && a.kind !== "editorSave" && !(userAction.includes(a.kind) && "dev" in a && a.dev !== 0)
    );
    fc.assert(
      fc.property(fc.nat(2), fc.boolean(), fc.array(oneWriter, { maxLength: 100, size: "max" }), (menus, synced, actions) => {
        const sim = simulate({ menus: [menus, 0], synced }, actions);
        expect(sim.violations).toEqual([]);
        expect(sim.copiesMade).toBe(0);
      }),
      { numRuns: 500 }
    );
  }, 60_000);

  it("SY-31: one request at a time, pushes wait for the 2 s delay, and retries back off from 1 s to 5 minutes", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 15 }), (outcomes) => {
        const ctx = contextFor("devA");
        let engine = createEngine({ menus: {}, sync: {} }, 0, 0, ctx);
        let now = 0;
        // First the pull on load.
        let next = nextRequest(engine, now);
        expect("request" in next && next.request).toEqual({ kind: "pull", since: 0, full: true });
        engine = next.engine;
        expect(nextRequest(engine, now)).toEqual({ engine, wait: null }); // one at a time
        engine = receive(engine, { kind: "pulled", records: [], next: 0, more: false, resync: false }, now, ctx).engine;
        // A save: nothing is pushed before PUSH_DELAY_MS.
        const id = pad("menu");
        engine = saveLocally(engine, { id, title: "T", encoded: "x", updatedAt: now }, null, now, ctx).engine;
        next = nextRequest(engine, now);
        expect(next).toMatchObject({ wait: PUSH_DELAY_MS });
        now += PUSH_DELAY_MS;
        let failures = 0;
        for (const ok of outcomes) {
          next = nextRequest(engine, now);
          if (!("request" in next)) {
            // Waiting out the backoff.
            expect(next.wait).toBe(retryDelayMs(failures));
            now += next.wait!;
            next = nextRequest(engine, now);
          }
          if ("request" in next && next.request.kind === "pull") {
            // The 5-minute pull came due first; it succeeds, so the backoff starts over.
            engine = receive(next.engine, { kind: "pulled", records: [], next: 0, more: false, resync: false }, now, ctx).engine;
            failures = 0;
            next = nextRequest(engine, now);
          }
          expect("request" in next && next.request).toMatchObject({ kind: "put", id, ifMatch: null });
          engine = next.engine;
          if (ok) {
            engine = receive(engine, { kind: "accepted", version: 1, seq: 1 }, now, ctx).engine;
            expect(engine.local.sync[id]).toMatchObject({ dirty: false, baseVersion: 1 });
            return;
          }
          // Offline: certainly not applied, so the same push is retried.
          engine = receive(engine, { kind: "failed", notApplied: true }, now, ctx).engine;
          failures++;
          expect(engine.retryAt - now).toBe(Math.min(RETRY_MAX_MS, 1_000 * 2 ** (failures - 1)));
        }
      })
    );
  });
});
