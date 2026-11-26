------------------------------- MODULE Notify --------------------------------
(***************************************************************************)
(* Model of push-notification scheduling for live conversations            *)
(* (docs/spec/notifications.md §4 NT-23, NT-24, §7b): the scheduler in     *)
(* server/src/push.ts (offer(sub, kind, now), flush(sub, now)) as driven   *)
(* by the copy write handler and the 5-minute cron, on push_subs rows.     *)
(*                                                                         *)
(* One box.  Every member has one or two devices, each with one            *)
(* subscription.  A member writes a copy with Notify: comment, notes or    *)
(* none.  The write handler lists the box's subscriptions of the other     *)
(* members, then offers the change to each one (inbox: the offers run      *)
(* later, in any order), so a member can leave, or the host stop sharing,  *)
(* between the listing and the offer.  An offer sends now if the           *)
(* subscription is due (a full Window since its last push, fewer than      *)
(* DailyCap pushes today), with count = the waiting changes + this one;    *)
(* otherwise the change waits (count + 1, comment beats notes).  Every     *)
(* CronEvery ticks the cron lists the subscriptions with something         *)
(* waiting, then flushes each one that is still there and due.  A push is  *)
(* accepted, fails for now (429, 5xx, network: the changes keep waiting    *)
(* for the next cron; MaxFails in all), or finds the subscription gone     *)
(* (404/410: it is deleted).  Leaving deletes the member's subscriptions;  *)
(* Stop sharing deletes all of them.  When the host's subscription lapses  *)
(* the box is read-only: writes are refused, and changes already waiting   *)
(* still go out.                                                           *)
(*                                                                         *)
(* Time: a tick is one cron period, scaled down (real: 5 minutes, so the   *)
(* 15-minute window is 3 ticks; 20 a day; 288 ticks a day).  A row keeps   *)
(* the ticks since its last push saturated at Window (push.ts only asks    *)
(* whether now - last_sent_at >= 15 minutes), and the clock is the time of *)
(* day, so time runs forever in finitely many states.  The daily count     *)
(* resets at midnight; push.ts does the same lazily, comparing the row's   *)
(* `day` with today.  Requests take far less than a tick, so the write     *)
(* handlers and the cron finish before the clock moves on.                 *)
(*                                                                         *)
(* Changes are numbered.  offered, pending and sent are history variables  *)
(* (the changes the rules say a subscription is to be told about, the ones *)
(* its row is holding, and the ones a push covered), used only to state    *)
(* the properties; the scheduler has only the row's count and kind, like   *)
(* push_subs.  A deleted subscription's history is dropped with it.        *)
(*                                                                         *)
(* Left out: subscribing and muting (muting deletes, like 404/410), the    *)
(* 5-per-member limit, payload encryption and VAPID (server tests), which  *)
(* of a member's devices wrote (the server only knows the member, so none  *)
(* of the writer's devices is told), and a push the push service accepted  *)
(* whose answer was lost (README.md).                                      *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets, Sequences

CONSTANTS
    Members,      \* the members of the box, host included
    Host,         \* the host (Stop sharing; the box lapses with the host)
    TwoDevices,   \* members with a second subscribed device
    Window,       \* ticks between two pushes to one subscription (real: 3)
    DailyCap,     \* pushes per subscription per day (real: 20)
    CronEvery,    \* ticks between cron runs (real: 1, the time unit)
    DayLen,       \* ticks per day (real: 288)
    MaxWrites,    \* writes in total, so writing stops
    MaxFails      \* transient push failures in total

ASSUME /\ Host \in Members /\ TwoDevices \subseteq Members
       /\ Window \in 1..50 /\ DailyCap \in 1..50 /\ CronEvery \in 1..50
       /\ DayLen \in 1..300 /\ DayLen % CronEvery = 0
       /\ MaxWrites \in 1..9 /\ MaxFails \in Nat

Subs    == {<<m, 1>> : m \in Members} \cup {<<m, 2>> : m \in TwoDevices}
Owner(s) == s[1]
SubsOf(m) == {s \in Subs : Owner(s) = m}
Kinds   == {"comment", "notes", "none"}
Changes == 1..MaxWrites
Min(a, b) == IF a < b THEN a ELSE b

\* ===========================================================================
\* The scheduler (server/src/push.ts): a push_subs row and pure functions.
\* ===========================================================================

\* age: ticks since the last push, saturated at Window (a new row has never
\* been pushed to, so it is due); today: pushes today; count and kind: the
\* waiting changes (pending_count, pending_kind; "none" when nothing waits).
Row   == [age : 0..Window, today : 0..DailyCap + 1, count : 0..MaxWrites, kind : Kinds]
NewRow == [age |-> Window, today |-> 0, count |-> 0, kind |-> "none"]

Merge(k1, k2) ==
    IF k1 = "comment" \/ k2 = "comment" THEN "comment"
    ELSE IF k1 = "notes" \/ k2 = "notes" THEN "notes" ELSE "none"

Due(r)      == r.age >= Window /\ r.today < DailyCap
Hold(r, k)  == [r EXCEPT !.count = @ + 1, !.kind = Merge(@, k)]
AfterPush(r) == [age |-> 0, today |-> r.today + 1, count |-> 0, kind |-> "none"]

\* ===========================================================================
\* State
\* ===========================================================================

VARIABLES
    tod,        \* time of day, in ticks
    cronDue,    \* a cron run is due (set every CronEvery ticks)
    todo,       \* subscriptions the running cron still has to look at
    inbox,      \* inbox[s]: changes a write handler has still to offer to s
    subs,       \* subscriptions that exist (push_subs rows)
    joined,     \* members still in the box
    box,        \* "live", "readonly" (host lapsed) or "stopped"
    chg,        \* chg[i]: change i's writer and Notify kind
    row,        \* row[s]: s's push_subs scheduling columns
    fails,      \* transient push failures so far
    offered,    \* history: changes the rules say s is to be told about
    pending,    \* history: the changes s's row is holding
    sent,       \* history: changes covered by a push accepted for s
    sentCount,  \* history: sum of `count` over the pushes accepted for s
    badPayload  \* history: some push's count or kind didn't match what it covered

vars == <<tod, cronDue, todo, inbox, subs, joined, box, chg, row, fails,
          offered, pending, sent, sentCount, badPayload>>

TypeOK ==
    /\ tod \in 0..DayLen - 1
    /\ cronDue \in BOOLEAN
    /\ todo \subseteq Subs
    /\ inbox \in [Subs -> SUBSET Changes]
    /\ subs \subseteq Subs
    /\ joined \subseteq Members
    /\ box \in {"live", "readonly", "stopped"}
    /\ chg \in Seq([by : Members, kind : Kinds]) /\ Len(chg) <= MaxWrites
    /\ row \in [Subs -> Row]
    /\ fails \in 0..MaxFails
    /\ offered \in [Subs -> SUBSET Changes]
    /\ pending \in [Subs -> SUBSET Changes]
    /\ sent \in [Subs -> SUBSET Changes]
    /\ sentCount \in [Subs -> 0..MaxWrites]
    /\ badPayload \in BOOLEAN

\* Midnight.  (Writes can come after any number of ticks, so starting at
\* another time of day adds no behaviour.)
Init ==
    /\ tod = 0
    /\ cronDue = FALSE
    /\ todo = {}
    /\ inbox = [s \in Subs |-> {}]
    /\ subs = Subs
    /\ joined = Members
    /\ box = "live"
    /\ chg = <<>>
    /\ row = [s \in Subs |-> NewRow]
    /\ fails = 0
    /\ offered = [s \in Subs |-> {}]
    /\ pending = [s \in Subs |-> {}]
    /\ sent = [s \in Subs |-> {}]
    /\ sentCount = [s \in Subs |-> 0]
    /\ badPayload = FALSE

\* ===========================================================================
\* Actions
\* ===========================================================================

\* A member writes their copy (PUT …/copies/:memberId).  The handler offers
\* the change to every subscription of another member (none for Notify:
\* none).  `offered` is the same set, written as NT-23 states it.
Write(m, k) ==
    LET i  == Len(chg) + 1
        to == IF k = "none" THEN {} ELSE {s \in subs : Owner(s) # m}
    IN  /\ box = "live" /\ m \in joined /\ Len(chg) < MaxWrites
        /\ chg' = Append(chg, [by |-> m, kind |-> k])
        /\ inbox' = [s \in Subs |-> IF s \in to THEN inbox[s] \cup {i} ELSE inbox[s]]
        /\ offered' = [s \in Subs |->
                         IF s \in subs /\ Owner(s) # m /\ k \in {"comment", "notes"}
                           THEN offered[s] \cup {i} ELSE offered[s]]
        /\ UNCHANGED <<tod, cronDue, todo, subs, joined, box, row, fails,
                       pending, sent, sentCount, badPayload>>

\* Deleting rows: they, what they held and their history are gone.
Delete(S) ==
    /\ subs' = subs \ S
    /\ row' = [s \in Subs |-> IF s \in S THEN NewRow ELSE row[s]]
    /\ pending' = [s \in Subs |-> IF s \in S THEN {} ELSE pending[s]]
    /\ offered' = [s \in Subs |-> IF s \in S THEN {} ELSE offered[s]]
    /\ sent' = [s \in Subs |-> IF s \in S THEN {} ELSE sent[s]]
    /\ sentCount' = [s \in Subs |-> IF s \in S THEN 0 ELSE sentCount[s]]

\* What a push covering the changes S should say (NT-24, NT-25): how many,
\* and "comment" if any of them was a comment, else "notes".
KindOf(S) ==
    IF \E i \in S : chg[i].kind = "comment" THEN "comment"
    ELSE IF S = {} THEN "none" ELSE "notes"

PayloadRight(s, r, batch) ==
    /\ r.count = Cardinality(batch \ sent[s])
    /\ r.count > 0
    /\ r.kind = KindOf(batch \ sent[s])

\* The push service accepts a push to s covering `batch`; r is the row the
\* payload is built from (count and kind).
Accepted(s, r, batch) ==
    /\ row' = [row EXCEPT ![s] = AfterPush(r)]
    /\ pending' = [pending EXCEPT ![s] = {}]
    /\ sent' = [sent EXCEPT ![s] = @ \cup batch]
    /\ sentCount' = [sentCount EXCEPT ![s] = @ + r.count]
    /\ badPayload' = (badPayload \/ ~PayloadRight(s, r, batch))
    /\ UNCHANGED <<subs, fails, offered>>

\* 429 / 5xx / network error: r (with everything in batch) keeps waiting.
Failed(s, r, batch) ==
    /\ fails < MaxFails
    /\ fails' = fails + 1
    /\ row' = [row EXCEPT ![s] = r]
    /\ pending' = [pending EXCEPT ![s] = batch]
    /\ UNCHANGED <<subs, offered, sent, sentCount, badPayload>>

\* 404 / 410: the subscription is deleted.
Gone(s) ==
    /\ Delete({s})
    /\ UNCHANGED <<fails, badPayload>>

\* Try a push to s: the row after adding what's waiting is r, covering batch.
Try(s, r, batch) == Accepted(s, r, batch) \/ Failed(s, r, batch) \/ Gone(s)

\* offer(sub, kind, now): the handler offers change i to s.  If s's row is
\* gone by now (the member left, the host stopped sharing, or 404/410), the
\* update finds no row and nothing is sent.
Offer(s) ==
    \E i \in inbox[s] :
        /\ inbox' = [inbox EXCEPT ![s] = @ \ {i}]
        /\ IF s \notin subs
             THEN UNCHANGED <<subs, row, fails, offered, pending, sent, sentCount, badPayload>>
           ELSE LET r == Hold(row[s], chg[i].kind)
                    b == pending[s] \cup {i}
                IN  IF Due(row[s])
                      THEN Try(s, r, b)
                    ELSE /\ row' = [row EXCEPT ![s] = r]
                         /\ pending' = [pending EXCEPT ![s] = b]
                         /\ UNCHANGED <<subs, fails, offered, sent, sentCount, badPayload>>
        /\ UNCHANGED <<tod, cronDue, todo, joined, box, chg>>

\* The cron starts: it lists the subscriptions with something waiting.
Cron ==
    /\ cronDue
    /\ cronDue' = FALSE
    /\ todo' = todo \cup {s \in subs : row[s].count > 0}
    /\ UNCHANGED <<tod, inbox, subs, joined, box, chg, row, fails,
                   offered, pending, sent, sentCount, badPayload>>

\* flush(sub, now): the cron looks at s; it sends if s still exists, has
\* something waiting and is due.
Flush(s) ==
    /\ s \in todo
    /\ todo' = todo \ {s}
    /\ IF s \in subs /\ row[s].count > 0 /\ Due(row[s])
         THEN Try(s, row[s], pending[s])
       ELSE UNCHANGED <<subs, row, fails, offered, pending, sent, sentCount, badPayload>>
    /\ UNCHANGED <<tod, cronDue, inbox, joined, box, chg>>

\* The clock moves on one tick; at midnight every row's daily count resets.
\* Requests take far less than a tick: the write handlers have made their
\* offers and the cron has finished before the clock moves on.
Tick ==
    LET t == (tod + 1) % DayLen
    IN  /\ ~cronDue /\ todo = {} /\ \A s \in Subs : inbox[s] = {}
        /\ tod' = t
        /\ cronDue' = (t % CronEvery = 0)
        /\ row' = [s \in Subs |->
                     [row[s] EXCEPT !.age = Min(@ + 1, Window),
                                    !.today = IF t = 0 THEN 0 ELSE @]]
        /\ UNCHANGED <<todo, inbox, subs, joined, box, chg, fails,
                       offered, pending, sent, sentCount, badPayload>>

\* A member (not the host) leaves: their subscriptions are deleted.
Leave(m) ==
    /\ m \in joined \ {Host} /\ box # "stopped"
    /\ joined' = joined \ {m}
    /\ Delete(SubsOf(m) \cap subs)
    /\ UNCHANGED <<tod, cronDue, todo, inbox, box, chg, fails, badPayload>>

\* The host stops sharing: the box and all its subscriptions are deleted.
StopSharing ==
    /\ box # "stopped"
    /\ box' = "stopped"
    /\ Delete(subs)
    /\ UNCHANGED <<tod, cronDue, todo, inbox, joined, chg, fails, badPayload>>

\* The host's subscription lapses: the box is read-only, writes are refused.
Lapse ==
    /\ box = "live"
    /\ box' = "readonly"
    /\ UNCHANGED <<tod, cronDue, todo, inbox, subs, joined, chg, row, fails,
                   offered, pending, sent, sentCount, badPayload>>

Next ==
    \/ \E m \in Members, k \in Kinds : Write(m, k)
    \/ \E s \in Subs : Offer(s) \/ Flush(s)
    \/ Cron \/ Tick
    \/ \E m \in Members : Leave(m)
    \/ StopSharing \/ Lapse

\* Time passes, the cron runs, and write handlers and the cron finish.  A
\* transient failure is retried by a later cron (MaxFails bounds them).
Fairness ==
    /\ WF_vars(Tick)
    /\ WF_vars(Cron)
    /\ \A s \in Subs : WF_vars(Offer(s)) /\ WF_vars(Flush(s))

Spec == Init /\ [][Next]_vars /\ Fairness

\* ===========================================================================
\* Properties
\* ===========================================================================

Told(s) == inbox[s] \cup pending[s] \cup sent[s]

\* NT-23: a subscription is never offered, held or sent a change its own
\* member wrote (so no device hears about its own write) ...
NT23_NeverOwnWrite ==
    \A s \in Subs : \A i \in Told(s) : chg[i].by # Owner(s)

\* ... nor a Notify: none change.
NT23_NothingForNone ==
    \A s \in Subs : \A i \in Told(s) : chg[i].kind \in {"comment", "notes"}

\* A push to s was accepted in this step (every push has count >= 1:
\* NT24_CountAndKind).
Pushed(s) == sentCount'[s] > sentCount[s]

\* NT-24: two accepted pushes to one subscription are at least Window apart.
NT24_Window ==
    [][\A s \in Subs : Pushed(s) => row[s].age >= Window]_vars

\* NT-24: at most DailyCap pushes per subscription per day.
NT24_DailyCap == \A s \in Subs : row[s].today <= DailyCap

\* NT-24, NT-25: every push says how many changes it covers (at least one,
\* none it covered before), and "comment" if any was a comment, else
\* "notes".  Checked on each push by PayloadRight.
NT24_CountAndKind == ~badPayload

PendingKind ==
    \A s \in subs : row[s].kind = KindOf(pending[s])

\* NT-56: nothing is sent to a subscription after its member left, after the
\* host stopped sharing, or after it was deleted; deleted ones stay deleted.
NoSendAfterLeave ==
    [][\A s \in Subs :
         (Owner(s) \notin joined \/ box = "stopped" \/ s \notin subs)
            => ~Pushed(s)]_vars
DeletedOnLeave ==
    \A s \in Subs : (Owner(s) \notin joined \/ box = "stopped") => s \notin subs
NeverResubscribed == [][subs' \subseteq subs]_vars

\* Every change offered to a subscription that still exists is either still
\* with the write handler, waiting in its row, or was in a push, exactly
\* once; the payload counts add up to the changes sent.
CountsAddUp ==
    \A s \in subs :
        /\ offered[s] = inbox[s] \cup pending[s] \cup sent[s]
        /\ inbox[s] \cap pending[s] = {}
        /\ inbox[s] \cap sent[s] = {}
        /\ pending[s] \cap sent[s] = {}
        /\ row[s].count = Cardinality(pending[s])
        /\ sentCount[s] = Cardinality(sent[s])

\* NT-24 liveness: nothing is held back forever.  Every change offered to a
\* subscription is eventually in a push to it, unless it is deleted.
NT24_EventuallyNotified ==
    \A s \in Subs, i \in Changes :
        (i \in offered[s]) ~> (i \in sent[s] \/ s \notin subs)
=============================================================================
