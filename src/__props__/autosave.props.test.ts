import type { MockInstance } from "vitest";
/**
 * Model-based property tests for the autosave queue (spec §5, rules SV-1, SV-2,
 * SV-3, SV-5). They drive the REAL useAutosave hook with random sequences of
 * edits, timer advances, save resolutions/rejections and unmounts, and check
 * the same invariants as the TLA+ model in docs/spec/formal/tla/Autosave.tla.
 */
import { act, renderHook } from "@testing-library/react";
import fc from "fast-check";
import { AUTOSAVE_DELAY_MS, SaveState, useAutosave } from "../autosave";
import { RelationshipMenuDocument } from "../model/menu";

// ---- documents: 2 titles x 3 versions, one object per value (like a memo) ----
const TITLES = ["A", "B"];
const VERSIONS = [1, 2, 3];
const DOCS: RelationshipMenuDocument[] = TITLES.flatMap((title) =>
  VERSIONS.map((v) => ({ title, encoded: `v${v}` }))
);
const key = (d: RelationshipMenuDocument) => `${d.title}/${d.encoded}`;
/** The editor's menu id (SY-20): one stored entry, whatever the title. */
const MENU_ID = "menu-under-test";

// ---- actions -------------------------------------------------------------------
type Action =
  | { kind: "edit"; doc: number } // switch to DOCS[doc] (may revert to an earlier one)
  | { kind: "advance"; ms: number }
  | { kind: "settle"; pick: number; ok: boolean } // resolve/reject an in-flight save
  | { kind: "unmount" };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("edit" as const), doc: fc.nat(DOCS.length - 1) }) },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("advance" as const),
      ms: fc.oneof(fc.integer({ min: 0, max: 450 }), fc.constantFrom(AUTOSAVE_DELAY_MS, 2 * AUTOSAVE_DELAY_MS)),
    }),
  },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("settle" as const), pick: fc.nat(3), ok: fc.boolean() }) }
);
/** Random actions, optionally with the page left (unmount) at a random point. */
const scenarioArb: fc.Arbitrary<Action[]> = fc
  .tuple(fc.array(actionArb, { maxLength: 40, size: "max" }), fc.option(fc.nat(40)))
  .map(([actions, leaveAt]) =>
    leaveAt === null
      ? actions
      : [...actions.slice(0, leaveAt), { kind: "unmount" as const }, ...actions.slice(leaveAt)]
  );

// ---- one run -------------------------------------------------------------------
type Call = {
  doc: RelationshipMenuDocument;
  overlapped: boolean; // another save was still in flight when this one started
  settled: boolean;
  ok?: boolean;
  finish: (ok: boolean) => void;
};

type Trace = {
  calls: Call[];
  /** How many saves had happened when the quiet status was read (SV-1 is about then). */
  callsBeforeUnmount: number;
  /** Documents moved onto the queue (timer fired or page left), in order. */
  flushes: RelationshipMenuDocument[];
  /** For each save call: the doc that was successfully saved before it started. */
  savedBefore: (RelationshipMenuDocument | null)[];
  latest: RelationshipMenuDocument;
  statusAfterQuiet: SaveState | null;
  /** App-like storage (SV-5, SY-21): the menu's id-keyed entry -> saved title/content. */
  store: Map<string, string>;
  violations: string[];
};

const flushPromises = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/**
 * Runs the actions against the real hook. When `appLike` is set the save callback
 * behaves like App.tsx: write the menu's one id-keyed entry (a failed write throws
 * before anything else). Renames are ordinary saves; nothing is deleted.
 */
const run = async (actions: Action[], appLike = false): Promise<Trace> => {
  const calls: Call[] = [];
  const flushes: RelationshipMenuDocument[] = [];
  const savedBefore: (RelationshipMenuDocument | null)[] = [];
  const store = new Map<string, string>();
  const violations: string[] = [];
  let lastSuccess: RelationshipMenuDocument | null = null;

  const inFlight = () => calls.filter((c) => !c.settled);
  const startCall = (doc: RelationshipMenuDocument) =>
    new Promise<boolean>((resolve) => {
      const call: Call = {
        doc,
        overlapped: inFlight().length > 0,
        settled: false,
        finish: (ok) => {
          call.settled = true;
          call.ok = ok;
          resolve(ok);
        },
      };
      savedBefore.push(lastSuccess);
      calls.push(call);
    });

  const save = vi.fn(async (doc: RelationshipMenuDocument) => {
    const ok = await startCall(doc);
    if (!ok) {
      // After a failure the hook can't know what storage holds (SV-1 fix found by TLC),
      // so nothing counts as "already saved" until the next success.
      lastSuccess = null;
      throw new Error("save failed");
    }
    if (appLike) {
      // SY-21: the menu is one entry under its id, whatever its title.
      const had = store.size;
      store.set(MENU_ID, key(doc));
      if (store.size < had) violations.push(`entry removed while saving ${key(doc)}`);
    }
    lastSuccess = doc;
  });

  let latest = DOCS[0];
  // Test-side view of the debounce timer, to know which documents get flushed.
  let now = 0;
  let pending: { doc: RelationshipMenuDocument; due: number } | null = { doc: latest, due: AUTOSAVE_DELAY_MS };
  let mounted = true;

  const { rerender, unmount, result } = renderHook(({ d }) => useAutosave(d, save), {
    initialProps: { d: latest },
  });

  const settle = async (pick: number, ok: boolean) => {
    const open = inFlight();
    if (open.length === 0) return;
    await act(async () => {
      open[pick % open.length].finish(ok);
      await flushPromises();
    });
  };
  const doUnmount = async () => {
    if (!mounted) return;
    mounted = false;
    if (pending) flushes.push(pending.doc);
    pending = null;
    await act(async () => {
      unmount();
      await flushPromises();
    });
  };

  for (const a of actions) {
    if (a.kind === "edit") {
      if (!mounted || DOCS[a.doc] === latest) continue;
      latest = DOCS[a.doc];
      pending = { doc: latest, due: now + AUTOSAVE_DELAY_MS };
      await act(async () => {
        rerender({ d: latest });
        await flushPromises();
      });
    } else if (a.kind === "advance") {
      now += a.ms;
      if (mounted && pending && now >= pending.due) {
        flushes.push(pending.doc);
        pending = null;
      }
      await act(async () => {
        vi.advanceTimersByTime(a.ms);
        await flushPromises();
      });
    } else if (a.kind === "settle") {
      await settle(a.pick, a.ok);
    } else {
      await doUnmount();
    }
  }

  // Quiet: no more edits. Let the timer fire and every queued save succeed.
  let statusAfterQuiet: SaveState | null = null;
  if (mounted) {
    now += AUTOSAVE_DELAY_MS;
    if (pending) flushes.push(pending.doc);
    pending = null;
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flushPromises();
    });
  }
  for (let i = 0; i < 20 && inFlight().length > 0; i++) await settle(0, true);
  if (mounted) statusAfterQuiet = result.current;
  // The saves made by leaving happen after the status was read, so they can't be
  // what the status was about. (SV-1 is checked against the quiet moment.)
  const callsBeforeUnmount = calls.length;
  await doUnmount();
  for (let i = 0; i < 20 && inFlight().length > 0; i++) await settle(0, true);

  return { calls, callsBeforeUnmount, flushes, savedBefore, latest, statusAfterQuiet, store, violations };
};

describe("useAutosave properties (spec §5)", () => {
  let errorSpy: MockInstance;
  beforeEach(() => {
    vi.useFakeTimers();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  const NUM_RUNS = 100;

  it("SV-2: one save in flight at a time, saves start in edit (flush) order", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (actions) => {
        const t = await run(actions);
        // TLA+ SV2_OneInFlight
        expect(t.calls.filter((c) => c.overlapped)).toEqual([]);
        // TLA+ SV2_StartInEditOrder / SV2_FinishInStartOrder: the saved docs are an
        // in-order subsequence of the flushed docs (each flush is saved at most once).
        let f = 0;
        for (const c of t.calls) {
          while (f < t.flushes.length && t.flushes[f] !== c.doc) f++;
          expect(f).toBeLessThan(t.flushes.length);
          f++;
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("SV-3: a superseded or reverted-to-saved version is never written", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (actions) => {
        const t = await run(actions);
        const flushed = new Set(t.flushes.map(key));
        t.calls.forEach((c, i) => {
          // TLA+ SV3_SupersededNeverSaved: only documents that were still the latest
          // when the timer fired (or the page was left) are ever saved.
          expect(flushed.has(key(c.doc))).toBe(true);
          // TLA+ SV3_NoRedundantWrite: never re-write the version last saved successfully
          // (with no failed save since).
          expect(t.savedBefore[i]).not.toBe(c.doc);
        });
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("SV-1: after edits stop (quiet or leaving), the latest version is saved or the status is error", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (actions) => {
        const t = await run(actions);
        const calls = t.calls.slice(0, t.callsBeforeUnmount);
        const succeeded = calls.filter((c) => c.ok);
        const lastOk = succeeded.length ? succeeded[succeeded.length - 1].doc : null;
        const last = calls[calls.length - 1];
        // TLA+ SV1_EventuallySaved: stored = latest, unless the last save failed.
        if (lastOk !== t.latest) {
          expect(last?.ok).toBe(false);
          expect(last?.doc).toBe(t.latest);
          if (t.statusAfterQuiet !== null) expect(t.statusAfterQuiet).toBe("error");
        } else if (t.statusAfterQuiet !== null) {
          expect(t.statusAfterQuiet).toBe("saved");
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("SV-5: renaming keeps the menu in one entry, and a failed save changes nothing", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (actions) => {
        const t = await run(actions, true);
        // TLA+ SV5_NeverRemoved / SV5_FailedSaveKeepsOld
        expect(t.violations).toEqual([]);
        const succeeded = t.calls.filter((c) => c.ok);
        const lastOk = succeeded.length ? succeeded[succeeded.length - 1].doc : null;
        if (lastOk) {
          // Exactly one entry, holding the last successful save (title and content).
          expect([...t.store.entries()]).toEqual([[MENU_ID, key(lastOk)]]);
        } else {
          expect(t.store.size).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
