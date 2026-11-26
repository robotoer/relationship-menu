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

# Notify model (TLA+)

`Notify.tla` models when push notifications are sent for a live conversation ([notifications.md §4](../../notifications.md#4-notifications) NT-23, NT-24 and [§7b](../../notifications.md#7b-wire-protocol-push-phase-3)): the scheduler in `server/src/push.ts` (`offer(sub, kind, now)`, `flush(sub, now)`), driven by the copy write handler and the 5-minute cron, on the `push_subs` rows. There is one box. Each member has one or two devices, and each device has one subscription. A member writes their copy with `Notify: comment`, `notes` or `none`. The write handler lists the subscriptions of the *other* members, then offers the change to each one. Those offers run later and in any order, so a member can leave, or the host can stop sharing, between the listing and the offer.

An offer sends now if the subscription is due: a full window since its last push, and fewer than the daily cap today. The push carries `count` = the waiting changes + this one. Otherwise the change waits: `count + 1`, and comment beats notes. Each cron run lists the subscriptions with something waiting, then flushes each one that still exists and is due. A push can be accepted. It can fail for now (429, 5xx or a network error), and then the changes keep waiting for the next cron; `MaxFails` bounds these failures. Or it can find the subscription gone (404 or 410), and then the subscription is deleted. Leaving deletes the member's subscriptions, and Stop sharing deletes all of them. When the host lapses, the box is read-only: writes are refused, and changes already waiting still go out.

**Time** is scaled down. One tick is one cron period, so the 15-minute window is 3 ticks. Each row keeps the ticks since its last push, saturated at `Window`, because `push.ts` only asks whether `now − last_sent_at ≥ 15 min`. The clock is the time of day, so time runs forever in finitely many states and liveness is checked without a time bound. The daily count resets at midnight. `push.ts` does the same lazily, by comparing the row's `day` with today's. Requests take far less than 5 minutes, so the write handlers and the cron finish before the clock moves on.

| Constant | Meaning | Real value | In the configs |
| --- | --- | --- | --- |
| `Window` | ticks between two pushes to one subscription | 3 (15 min) | 3 |
| `DailyCap` | pushes per subscription per UTC day | 20 | 2 |
| `CronEvery` | ticks between cron runs | 1 (5 min) | 1, or 2 in `NotifyLiveness.cfg` (a flush can wait for the next run after the window ends) |
| `DayLen` | ticks per day | 288 | 8 (the window allows 3 pushes a day, the cap 2) |
| `Members`, `Host`, `TwoDevices` | who is in the box, and who has a second device | — | `h` + `a` (2 devices); `NotifyThree.cfg` adds `b` |
| `MaxWrites`, `MaxFails` | bounds, so writing and failing stop | — | 3 (2 in `NotifyThree.cfg`), 1 |

| TLA+ property | Rule | What it says |
| --- | --- | --- |
| `NT23_NeverOwnWrite` | NT-23 | No subscription is ever offered, holding or sent a change its own member wrote. The server only knows the member, so none of the writer's devices is told. |
| `NT23_NothingForNone` | NT-23 | `Notify: none` is offered to nobody. |
| `NT24_Window` (action) | NT-24 | A push is only ever accepted when the subscription's last push was at least `Window` ago. |
| `NT24_DailyCap` | NT-24 | At most `DailyCap` pushes per subscription per day. |
| `NT24_CountAndKind`, `PendingKind` | NT-24, NT-25 | Every push's `count` is the number of changes it covers (at least 1, none covered twice). Its `kind` is `comment` if any of them was a comment, else `notes`. |
| `NoSendAfterLeave` (action), `DeletedOnLeave`, `NeverResubscribed` | NT-56 | Nothing is sent to a subscription after its member left, after the host stopped sharing, or after it was deleted (404/410). |
| `CountsAddUp` | NT-24 | For each subscription that still exists, every change it was offered is exactly one of: still with the write handler, waiting in the row (`pending_count` = their number), or covered by a push. The pushes' counts add up to the changes sent. |
| `NT24_EventuallyNotified` (`~>`; weak fairness on the clock, the cron, offers and flushes; a transient failure is retried by a later cron) | NT-24 | Nothing is held back forever. Every offered change is eventually in a push to that subscription, unless the subscription is deleted. |

How the model maps to `server/src/push.ts`:

| Model | `push.ts` / `push_subs` |
| --- | --- |
| `row[s].age` (saturated at `Window`; a new row is due) | `now − last_sent_at` (`NULL`: never sent) |
| `row[s].today` | `sent_today`, read as 0 when `day` isn't today |
| `row[s].count`, `row[s].kind` | `pending_count`, `pending_kind` |
| `Due`, `Hold`, `AfterPush`, `Merge` | the "send now" test, the "wait" branch, the row after an accepted push, and "comment beats notes" in `offer` and `flush` |
| `Offer(s)` | the write handler calling `offer(sub, kind, now)` for one subscription and sending if told to |
| `Cron` + `Flush(s)` | the 5-minute cron listing subscriptions with `pending_count > 0`, then `flush(sub, now)` and sending for each |
| `Failed` / `Gone` | 429, 5xx or network error: the row keeps the changes, and `last_sent_at` and `sent_today` stay as they were / 404 or 410: the row is deleted |
| `Leave`, `StopSharing`, `Lapse` | leaving or Stop sharing deletes the rows (NT-56); a read-only box refuses writes |

The model assumes two things about the code around `push.ts`. A server test should check both:

- **Each offer or flush acts on its own row, at once.** The send decision and the row update are one conditional statement on that row. For example, an `UPDATE … WHERE sub_id = ?` that `RETURNING` shows still matched. So a row deleted after the handler or cron listed it gets no push. And two writes, or a write and the cron, can't both decide to send to one subscription in the same window. The mutated model that skips the "row still exists" check fails `NoSendAfterLeave`.
- **A transient failure doesn't count as a push.** `last_sent_at` and `sent_today` don't move, so the next cron can retry.

Not modelled: a push that the push service accepted, but whose answer was lost (a network error after delivery). The server counts it as a transient failure, so the retry can reach the device on the next cron, less than 15 minutes later. That breaks NT-24's window for that device. It's rare and harmless: `Topic: <boxId>` makes the newer push replace the older one. Recording `last_sent_at` on a network error too, while keeping the changes pending, would close the gap and delay the retry by at most one window. Also not modelled: subscribing, muting (a deletion, like 404/410), the 5-per-member limit, payload encryption and VAPID. The server tests cover those.

Run it the same way:

    java -cp tla2tools.jar tlc2.TLC -workers auto -config Notify.cfg Notify.tla

| Config | What varies | States (distinct) | TLC time (4 cores) |
| --- | --- | --- | --- |
| `Notify.cfg` | host with 1 device, `a` with 2; 3 writes, 1 transient failure; reaches the daily cap; safety | 5,669,672 | about 1.5 min |
| `NotifyThree.cfg` | adds `b` (one device), so a write reaches two members and one can leave mid-offer; 2 writes; safety | 7,635,056 | about 3 min |
| `NotifyLiveness.cfg` | host and `a` with 1 device each, cron every 2 ticks, 3 writes, 1 transient failure; `NT24_EventuallyNotified` | 784,720 | about 2 min |

All three pass with TLC 1.8.0, and CI runs them in `.github/workflows/formal.yml`. To check that the properties have teeth, the model was mutated one change at a time, and TLC caught each mutation:

- dropping the daily cap from `Due` fails `NT24_DailyCap`;
- dropping the window fails `NT24_Window`;
- offering to the writer's own devices fails `NT23_NeverOwnWrite`;
- offering on `Notify: none` fails `NT23_NothingForNone`;
- skipping the "row still exists" check fails `NoSendAfterLeave`;
- "notes beats comment" and "count stays 1" each fail `NT24_CountAndKind`;
- no midnight reset, dropping the changes on a transient failure, and a cron that flushes nothing each fail `NT24_EventuallyNotified`.
