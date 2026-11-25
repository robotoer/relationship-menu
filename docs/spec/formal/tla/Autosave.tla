------------------------------ MODULE Autosave ------------------------------
(***************************************************************************)
(* Model of the editor autosave (src/autosave.ts, useAutosave) together    *)
(* with the save callback in src/App.tsx (save under the new title, then   *)
(* delete the old title's entry only after that save succeeded).           *)
(*                                                                         *)
(* A document is a pair <<title, version>>.  The user edits it (any other  *)
(* pair, so reverting to an earlier version is included), each edit        *)
(* replaces the single pending document and (re)arms the 400 ms debounce   *)
(* timer.  Time is abstracted: the timer may fire at any moment while a    *)
(* document is pending, and an edit before it fires resets it.  Firing the *)
(* timer, or leaving the page (pagehide / unmount), "flushes": the pending *)
(* document is appended to the promise queue.  The queue runs one job at a *)
(* time; a job equal to the last saved document is skipped, otherwise the  *)
(* save starts, and its write may succeed or fail; after a successful      *)
(* write under a new title the old title's entry is deleted.               *)
(*                                                                         *)
(* History variables (started, finished, superseded, storedSeq) exist only *)
(* to state the properties; every edit gets a sequence number.             *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
    Titles,         \* menu titles, e.g. {"T1", "T2"}
    N,              \* contents are versions 1..N
    MaxEdits,       \* bound on the number of edits, so editing eventually stops
    InitTitle,      \* title of the document the editor opens with
    NoTitle,        \* model value: "no title" / "no document"
    DeleteCanFail   \* whether storage.deleteDocument may throw

ASSUME InitTitle \in Titles /\ N \in Nat \ {0} /\ MaxEdits \in Nat
ASSUME DeleteCanFail \in BOOLEAN

Docs  == Titles \X (1..N)
NoDoc == <<NoTitle, 0>>
Job   == [d : Docs, s : 0..MaxEdits]

VARIABLES
    doc, docSeq,     \* the document in the editor and the edit that produced it
    edits,           \* number of edits made so far
    pending, pendSeq,\* pending.current (NoDoc when no timer is armed)
    queue,           \* jobs appended to the promise queue, not yet run
    active,          \* the running save (a set, so "at most one" is checkable)
    lastSaved,       \* lastSaved.current (compared by value, like the JSON key)
    owned,           \* ownedTitle.current in App.tsx
    store,           \* storage: title -> stored version (0 = no entry)
    status,          \* SaveState
    left,            \* the user left the page (component unmounted)
    lastFailed,      \* the most recently finished save failed
    started,         \* history: edit seq numbers of saves, in start order
    finished,        \* history: edit seq numbers of saves, in finish order
    superseded,      \* history: edits replaced while still pending
    storedSeq        \* history: edit seq of the last successful write

vars == <<doc, docSeq, edits, pending, pendSeq, queue, active, lastSaved,
          owned, store, status, left, lastFailed, started, finished,
          superseded, storedSeq>>

TypeOK ==
    /\ doc \in Docs /\ docSeq \in 0..MaxEdits /\ edits \in 0..MaxEdits
    /\ pending \in Docs \cup {NoDoc} /\ pendSeq \in 0..MaxEdits
    /\ queue \in Seq(Job)
    /\ active \subseteq [d : Docs, s : 0..MaxEdits, phase : {"write", "delete"},
                         prev : Titles \cup {NoTitle}]
    /\ lastSaved \in Docs \cup {NoDoc}
    /\ owned \in Titles \cup {NoTitle}
    /\ store \in [Titles -> 0..N]
    /\ status \in {"idle", "pending", "saving", "saved", "error"}
    /\ left \in BOOLEAN /\ lastFailed \in BOOLEAN
    /\ superseded \subseteq 0..MaxEdits /\ storedSeq \in 0..MaxEdits

Init ==
    /\ doc = <<InitTitle, 1>> /\ docSeq = 0 /\ edits = 0
    /\ pending = doc /\ pendSeq = 0          \* the mount effect arms the timer
    /\ queue = <<>> /\ active = {}
    /\ lastSaved = NoDoc /\ owned = NoTitle
    /\ store = [t \in Titles |-> 0]
    /\ status = "pending" /\ left = FALSE /\ lastFailed = FALSE
    /\ started = <<>> /\ finished = <<>> /\ superseded = {} /\ storedSeq = 0

\* The promise queue runs as microtasks: when no save is running, the next
\* queued job starts before any user event or timer (macrotasks) can happen.
Macrotask == ~(active = {} /\ queue # <<>>)

\* ---- the user ------------------------------------------------------------
\* The [doc] effect: replace the pending document, reset the timer.
Edit(d) ==
    /\ Macrotask /\ ~left /\ edits < MaxEdits /\ d # doc
    /\ doc' = d /\ edits' = edits + 1 /\ docSeq' = edits + 1
    /\ pending' = d /\ pendSeq' = edits + 1
    /\ superseded' = IF pending # NoDoc THEN superseded \cup {pendSeq}
                                        ELSE superseded
    /\ status' = "pending"
    /\ UNCHANGED <<queue, active, lastSaved, owned, store, left, lastFailed,
                   started, finished, storedSeq>>

\* flush(): move the pending document onto the queue.
FlushVars ==
    /\ queue' = IF pending # NoDoc
                  THEN Append(queue, [d |-> pending, s |-> pendSeq])
                  ELSE queue
    /\ pending' = NoDoc

\* The debounce timer fires (enabled only while a document is pending).
TimerFire ==
    /\ Macrotask /\ pending # NoDoc
    /\ FlushVars
    /\ UNCHANGED <<doc, docSeq, edits, pendSeq, active, lastSaved, owned, store,
                   status, left, lastFailed, started, finished, superseded,
                   storedSeq>>

\* pagehide / visibilitychange hidden / unmount: flush immediately.
Leave ==
    /\ Macrotask /\ ~left /\ left' = TRUE
    /\ FlushVars
    /\ UNCHANGED <<doc, docSeq, edits, pendSeq, active, lastSaved, owned, store,
                   status, lastFailed, started, finished, superseded, storedSeq>>

\* ---- the serialized queue -------------------------------------------------
StartJob ==
    /\ active = {} /\ queue # <<>>
    /\ LET j == Head(queue) IN
         /\ queue' = Tail(queue)
         /\ IF j.d = lastSaved
              THEN /\ status' = IF pending = NoDoc THEN "saved" ELSE status  \* skip: nothing to write
                   /\ UNCHANGED <<active, started>>
              ELSE /\ active' = {[d |-> j.d, s |-> j.s, phase |-> "write",
                                  prev |-> NoTitle]}
                   /\ started' = Append(started, j.s)
                   /\ status' = "saving"
    /\ UNCHANGED <<doc, docSeq, edits, pending, pendSeq, lastSaved, owned, store,
                   left, lastFailed, finished, superseded, storedSeq>>

\* The whole save callback resolved.
Succeed(a) ==
    /\ active' = {} /\ lastSaved' = a.d /\ lastFailed' = FALSE
    /\ finished' = Append(finished, a.s)
    /\ status' = IF pending = NoDoc THEN "saved" ELSE status

\* The save callback threw.
Fail(a) ==
    /\ active' = {} /\ lastFailed' = TRUE
    /\ finished' = Append(finished, a.s)
    /\ status' = "error"
    /\ lastSaved' = NoDoc   \* storage may hold part of this save: forget the last saved version

\* storage.saveDocuments returned ids; then App decides whether to delete.
WriteOk ==
    \E a \in active :
      /\ a.phase = "write"
      /\ store' = [store EXCEPT ![a.d[1]] = a.d[2]]
      /\ storedSeq' = a.s
      /\ owned' = a.d[1]
      /\ IF owned # NoTitle /\ owned # a.d[1]
           THEN /\ active' = {[a EXCEPT !.phase = "delete", !.prev = owned]}
                /\ UNCHANGED <<lastSaved, lastFailed, finished, status>>
           ELSE Succeed(a)
      /\ UNCHANGED <<doc, docSeq, edits, pending, pendSeq, queue, left, started,
                     superseded>>

\* storage.saveDocuments returned no ids: App throws before touching anything.
WriteFail ==
    \E a \in active :
      /\ a.phase = "write"
      /\ Fail(a)
      /\ UNCHANGED <<doc, docSeq, edits, pending, pendSeq, queue, owned, store,
                     left, started, superseded, storedSeq>>

\* Rename step: delete the old title's entry.
DeleteOk ==
    \E a \in active :
      /\ a.phase = "delete"
      /\ store' = [store EXCEPT ![a.prev] = 0]
      /\ Succeed(a)
      /\ UNCHANGED <<doc, docSeq, edits, pending, pendSeq, queue, owned, left,
                     started, superseded, storedSeq>>

DeleteFail ==
    \E a \in active :
      /\ DeleteCanFail /\ a.phase = "delete"
      /\ Fail(a)
      /\ UNCHANGED <<doc, docSeq, edits, pending, pendSeq, queue, owned, store,
                     left, started, superseded, storedSeq>>

Next ==
    \/ \E d \in Docs : Edit(d)
    \/ TimerFire \/ Leave
    \/ StartJob \/ WriteOk \/ WriteFail \/ DeleteOk \/ DeleteFail

\* The user is not forced to edit or leave; timers fire, the queue runs and
\* storage calls return.
Fairness ==
    /\ WF_vars(TimerFire)
    /\ WF_vars(StartJob)
    /\ WF_vars(WriteOk \/ WriteFail)
    /\ WF_vars(DeleteOk \/ DeleteFail)

Spec == Init /\ [][Next]_vars /\ Fairness

\* ===========================================================================
\* Properties
\* ===========================================================================

Range(s) == {s[i] : i \in DOMAIN s}
IsPrefix(p, s) == Len(p) <= Len(s) /\ \A i \in 1..Len(p) : p[i] = s[i]

\* SV-2: at most one save in flight.
SV2_OneInFlight == Cardinality(active) <= 1

\* SV-2: saves start in edit order (strictly increasing edit numbers).
SV2_StartInEditOrder ==
    \A i \in 1..Len(started) - 1 : started[i] < started[i + 1]

\* SV-2: saves complete in the order they started.
SV2_FinishInStartOrder == IsPrefix(finished, started)

\* SV-2: the stored version never goes backwards relative to start order.
SV2_StoredNeverBackwards == [][storedSeq' >= storedSeq]_vars

\* SV-3: an edit superseded before its timer fired is never written.
SV3_SupersededNeverSaved == Range(started) \cap superseded = {}

\* SV-3: reverting to the already-saved version writes nothing (a write never
\* starts for the document that is already saved).
SV3_NoRedundantWrite == \A a \in active : a.d # lastSaved

\* SV-5: an entry is removed only in the rename step, for the save's previous
\* title, after the new title was written successfully by that same save.
SV5_DeleteOnlyAfterSave ==
    [][\A t \in Titles :
         (store[t] # 0 /\ store'[t] = 0) =>
            \E a \in active : /\ a.phase = "delete" /\ a.prev = t
                              /\ a.d[1] # t /\ store[a.d[1]] = a.d[2]]_vars

\* SV-5: a failed save never removes (or changes) any entry.
SV5_FailedSaveKeepsOld == [][WriteFail => store' = store]_vars

\* SV-1: leaving the page flushes the pending document immediately.
SV1_LeaveFlushes ==
    [][Leave /\ pending # NoDoc =>
         queue' = Append(queue, [d |-> pending, s |-> pendSeq])]_vars

\* SV-1 (liveness): edits stop (MaxEdits bounds them, and Edit has no
\* fairness), so eventually nothing is pending or running and either the
\* latest document is the stored one, or the last save failed and the
\* status is "error".
Settled ==
    /\ pending = NoDoc /\ queue = <<>> /\ active = {}
    /\ \/ status = "saved" /\ lastSaved = doc /\ store[doc[1]] = doc[2]
       \/ status = "error" /\ lastFailed
SV1_EventuallySaved == <>[]Settled

\* Not one of the rules: "saved" is shown only when nothing is pending.
\* Checked by AutosaveStatus.cfg; TLC finds a violation (see README).
StatusSavedMeansNothingPending == status = "saved" => pending = NoDoc
=============================================================================
