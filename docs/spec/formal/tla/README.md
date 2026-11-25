# Autosave model (TLA+)

`Autosave.tla` models `useAutosave` (src/autosave.ts) plus App.tsx's save callback. It covers edits to any of Titles × 1..N, including reverts; the 400 ms debounce timer as "may fire while a doc is pending, reset by an edit"; flush on leave; the promise queue, where a job runs as a microtask, the next job starts before any user event, and a job equal to `lastSaved` is skipped; a write that can succeed or fail; and the rename step, which deletes the previous title after a successful write. It leaves out real time, React rendering, the `mounted` guard on `setState`, JSON keys (docs are compared by value), `createdAt`/`updatedAt`, and duplicate or legacy storage entries (SV-6, SV-9).

| TLA+ property | Rule | fast-check test (src/__props__/autosave.props.test.ts) |
| --- | --- | --- |
| `SV2_OneInFlight`, `SV2_StartInEditOrder`, `SV2_FinishInStartOrder`, `SV2_StoredNeverBackwards` | SV-2 | "SV-2: one save in flight at a time, saves start in edit (flush) order" |
| `SV3_SupersededNeverSaved`, `SV3_NoRedundantWrite` | SV-3 | "SV-3: a superseded or reverted-to-saved version is never written" |
| `SV1_EventuallySaved` (`<>[]Settled`, weak fairness on timer/queue/storage), `SV1_LeaveFlushes` | SV-1 | "SV-1: after edits stop (quiet or leaving), the latest version is saved or the status is error" |
| `SV5_DeleteOnlyAfterSave`, `SV5_FailedSaveKeepsOld` | SV-5 | "SV-5: the old title is removed only after a successful save under the new title" |

Run it with the tla2tools.jar from github.com/tlaplus/tlaplus releases (v1.8.0). Keep the jar outside the repo:

    java -cp tla2tools.jar tlc2.TLC -workers auto -config Autosave.cfg Autosave.tla

**Results.** All three configs pass with **no errors**; CI runs them in `.github/workflows/formal.yml`.

| Config | What varies | States (distinct) |
| --- | --- | --- |
| `Autosave.cfg` | 2 titles, N=3, MaxEdits=4; the old-title delete never fails | 254,874 (102,525) |
| `AutosaveDeleteFails.cfg` | same, but `storage.deleteDocument` may throw | 346,641 (137,049) |
| `AutosaveStatus.cfg` | checks `StatusSavedMeansNothingPending` ("Saved" only when nothing is waiting) | 254,874 (102,525) |

The last two configs first found real bugs, which are now fixed in `src/autosave.ts` and in the model:

- **SV-1, stale `lastSaved` after a partly failed rename.** The write succeeded but deleting the old title threw. `lastSaved` still pointed at an older version, so undoing back to that version was skipped as "already saved" while storage held something else. Fix: after any failed save, forget `lastSaved` (`Fail` sets it to `NoDoc`). The next save always writes.
- **"Saved" while an edit is waiting.** A skipped job set status "saved" even though a newer edit was pending. To reproduce: v1 is saving; edit v2, revert to v1, the timer fires; edit v3; v1 resolves. Fix: a skipped job shows "saved" only when nothing is pending.
