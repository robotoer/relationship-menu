# Autosave model (TLA+)

`Autosave.tla` models `useAutosave` (src/autosave.ts) plus App.tsx's save callback. It covers edits to any of Titles × 1..N, including reverts; the 400 ms debounce timer as "may fire while a doc is pending, reset by an edit"; flush on leave; the promise queue, where a job runs as a microtask, the next job starts before any user event, and a job equal to `lastSaved` is skipped; and a write that can succeed or fail. Menus are stored by id (SY-20, SY-21), so the editor's menu is one entry and a rename is an ordinary save of it: nothing is ever deleted by saving. (Until November 2026 menus were keyed by title and a rename deleted the old title's entry after the new one was written; that step, and the `AutosaveDeleteFails.cfg` config that checked it, are gone.) It leaves out real time, React rendering, the `mounted` guard on `setState`, JSON keys (docs are compared by value), `createdAt`/`updatedAt`, and duplicate or legacy storage entries (SV-6, SV-9).

| TLA+ property | Rule | fast-check test (src/__props__/autosave.props.test.ts) |
| --- | --- | --- |
| `SV2_OneInFlight`, `SV2_StartInEditOrder`, `SV2_FinishInStartOrder`, `SV2_StoredNeverBackwards` | SV-2 | "SV-2: one save in flight at a time, saves start in edit (flush) order" |
| `SV3_SupersededNeverSaved`, `SV3_NoRedundantWrite` | SV-3 | "SV-3: a superseded or reverted-to-saved version is never written" |
| `SV1_EventuallySaved` (`<>[]Settled`, weak fairness on timer/queue/storage), `SV1_LeaveFlushes` | SV-1 | "SV-1: after edits stop (quiet or leaving), the latest version is saved or the status is error" |
| `SV5_NeverRemoved`, `SV5_FailedSaveKeepsOld` | SV-5 | "SV-5: renaming keeps the menu in one entry, and a failed save changes nothing" |

Run it with the tla2tools.jar from github.com/tlaplus/tlaplus releases (v1.8.0). Keep the jar outside the repo:

    java -cp tla2tools.jar tlc2.TLC -workers auto -config Autosave.cfg Autosave.tla

**Results.** Both configs pass with **no errors**; CI runs them in `.github/workflows/formal.yml`.

| Config | What varies | States (distinct) |
| --- | --- | --- |
| `Autosave.cfg` | 2 titles, N=3, MaxEdits=4 | see the CI log (model simplified in Nov 2026) |
| `AutosaveStatus.cfg` | checks `StatusSavedMeansNothingPending` ("Saved" only when nothing is waiting) | see the CI log |

Earlier versions of these configs found two real bugs, both fixed in `src/autosave.ts` and still covered:

- **SV-1, stale `lastSaved` after a partly failed rename** (title-keyed storage). The write succeeded but deleting the old title threw. `lastSaved` still pointed at an older version, so undoing back to that version was skipped as "already saved" while storage held something else. Fix: after any failed save, forget `lastSaved` (`Fail` sets it to `NoDoc`). The next save always writes.
- **"Saved" while an edit is waiting.** A skipped job set status "saved" even though a newer edit was pending. To reproduce: v1 is saving; edit v2, revert to v1, the timer fires; edit v3; v1 resolves. Fix: a skipped job shows "saved" only when nothing is pending.

# Sync model (TLA+)

`Sync.tla` models supporter sync ([sync.md §6](../../sync.md#6-syncing-and-conflicts)): the merge in `src/sync/merge.ts` and the push queue in `src/sync/engine.ts`, on two devices, against the server's conditional writes in `server/src/menus.ts`. Both devices start with one synced menu. A device can edit or delete a menu it holds. It sends one request at a time: a pull, or a push of one dirty menu with `If-Match` (or `If-None-Match: *` for a menu new to the server). The server accepts the write or answers 412 with its current row. A write can also be applied with its reply lost, and a device can go offline, which drops its requests before they reach the server. Replies go through the merge table, case by case as in the code. A conflict copy gets an id from the device's own pool, since random ids never collide.

Each menu's content is the set of edits it has seen (§16), so "lost" is exact. An edit's time is its event number, so the newer edit is the content with the larger maximum.

It leaves out seq, cursors and pages: a pull is one snapshot of the server, applied later, and the device may edit meanwhile. It also leaves out forgotten tombstones and `resync`, unreadable records (SY-17), titles, the push delay and backoff (time is abstracted, so anything can happen at any moment), menus the user creates, and saves from a stale editor (SY-24). The property tests in `src/__props__/sync.props.test.ts` cover those against the real code, with an in-memory server.

| TLA+ property | Rule | fast-check test (src/__props__/sync.props.test.ts) |
| --- | --- | --- |
| `NoSilentLoss`: every edit is in a live menu on a device or the server, or a device that had seen it deleted the menu | SY-39 (with SY-35, SY-36) | "SY-38, SY-39: two devices and the server converge, and no edit is silently lost" (checked after every step) and "SY-35, SY-36, SY-37: changes made here always survive, as the menu or a copy, …" |
| `SY38_Converges` (`<>[]Converged`; weak fairness on pulls, the server, replies and coming back online, strong fairness on pushes) | SY-38 | "SY-38, SY-39: two devices and the server converge, …" |
| `SY37_NoCopies` with one device editing (`SyncOneWriter.cfg`) | SY-37 | "SY-35, SY-36, SY-37: …" (an own write never makes a copy) |
| `SY18_NeverBackwards`, `SeenOnServer`, `BaseIsSeen` | SY-18, SY-42 | "SY-18: a version no newer than one already seen changes nothing"; the simulation checks both after every step |

Run it the same way:

    java -cp tla2tools.jar tlc2.TLC -workers auto -config Sync.cfg Sync.tla

| Config | What varies | States (distinct) |
| --- | --- | --- |
| `Sync.cfg` | both devices edit; 3 edits or deletions, 1 lost reply, 1 offline period, 2 copies per device; safety only | about 950,000 |
| `SyncLiveness.cfg` | the same with 2 edits or deletions; checks `SY38_Converges` | about 37,000 |
| `SyncOneWriter.cfg` | only device A edits; 3 edits, 2 lost replies, 2 offline periods; `SY37_NoCopies` and `SY38_Converges` | about 99,000 |

The state counts come from an explicit-state search written while building the model, before TLC first ran it. CI runs all three configs in `.github/workflows/formal.yml`.

The property tests' simulation found two gaps in the server's side of `resync` (SY-23, SY-32). Its in-memory server includes the fixes, which `server/src/menus.ts` still needs:

1. **A full listing never finishes.** A pull from 0 (the first one, or after `resync`) that takes more than one page sends later pages with `since` below `purged_seq`, and the server answers each with `resync` again. The client marks those pages `full=1`, and the server should skip the check for them.
2. **A tombstone forgotten part-way through a full listing goes unnoticed.** A menu listed on an early page can be deleted, and its tombstone forgotten, before the listing ends. The server should report `purged` (its `purged_seq`) with every pull, so the client can start the listing again if it changes.

It also found a case the client now handles itself. A device's first push of a menu lands, but its reply is lost. Another device deletes the menu and the tombstone is forgotten. The first device then pushes the menu again as new, and the server stores it as version 1, below the version 2 the other device remembers (SY-18). So a new menu whose first push got no answer moves to a fresh id, and the old id is deleted if the push turns out to have landed (`applyUnknownCreate`). The model has no forgotten tombstones, so it keeps the simpler retry under the same id.
