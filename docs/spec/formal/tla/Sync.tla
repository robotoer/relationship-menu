-------------------------------- MODULE Sync ---------------------------------
(***************************************************************************)
(* Model of supporter sync (docs/spec/sync.md §6): the merge in            *)
(* src/sync/merge.ts and the push queue in src/sync/engine.ts, on two      *)
(* devices, against the server in server/src/menus.ts.                     *)
(*                                                                         *)
(* Both devices start with one synced menu.  A device can edit or delete   *)
(* a menu it holds (bounded by MaxEvents, so editing stops).  It sends one *)
(* request at a time: a pull, or a push of one changed ("dirty") menu,     *)
(* conditional on the version it is based on (If-Match, or If-None-Match:  *)
(* * for a menu new to the server).  The server accepts the write or       *)
(* rejects it (412) with its current row.  A write can also be applied     *)
(* with its reply lost (bounded by MaxLost), and a device can go offline,  *)
(* when its requests are dropped before they reach the server.  Replies    *)
(* are applied with the merge table in §6; a conflict copy gets an id from *)
(* the device's own pool, as random ids never collide.                     *)
(*                                                                         *)
(* A menu's content is the set of edits it has seen (§16), so "lost" can   *)
(* be stated exactly.  An edit's time is its event number, so the newer    *)
(* edit is the content with the larger maximum.                            *)
(*                                                                         *)
(* Left out: seq, cursors and pages (a pull is one snapshot of the server, *)
(* applied later, while the device may have edited meanwhile; the paging   *)
(* and cursor code is covered by src/__props__/sync.props.test.ts),        *)
(* forgotten tombstones and resync (same; with none, a new menu whose     *)
(* first push got no answer is retried under its id, where the code moves  *)
(* it to a fresh one, applyUnknownCreate), unreadable records (SY-17,      *)
(* property tests), titles (a copy's title), the 2 s push delay and the    *)
(* retry backoff (time is abstracted: anything may happen at any moment),  *)
(* menus created by the user, and saves from a stale editor (SY-24,        *)
(* property tests).                                                        *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
    MaxEvents,    \* edits and deletions, in total
    MaxLost,      \* replies lost after the server applied a write
    MaxOffline,   \* offline periods, in total
    MaxCopies,    \* conflict copies each device can make
    Writers       \* the devices that edit and delete; the others only sync

Devices == {"A", "B"}
ASSUME Writers \subseteq Devices /\ MaxEvents \in 1..9 /\ MaxCopies \in 1..9
       /\ MaxLost \in Nat /\ MaxOffline \in Nat

M0     == <<"S", 0>>                         \* the menu both devices start with
Pool(d) == {d} \X (1..MaxCopies)              \* ids device d gives its copies
Ids    == {M0} \cup Pool("A") \cup Pool("B")
Events == 1..MaxEvents
Max(S) == IF S = {} THEN 0 ELSE CHOOSE x \in S : \A y \in S : x >= y

\* A copy's edit id: distinct from every edit's (edits are 1..9).
CopyEid(c) == 10 * (IF c[1] = "A" THEN 1 ELSE 2) + c[2]

Absent  == [live |-> FALSE, h |-> {}]
Unknown == [known |-> FALSE, base |-> 0, seen |-> 0, dirty |-> FALSE, eid |-> 0]
NoRow   == [ver |-> 0, del |-> FALSE, h |-> {}, eid |-> 0]

VARIABLES
    lm,       \* lm[d][i]: device d's menu i (live?, and the edits it has seen)
    ss,       \* ss[d][i]: its sync state: base, seen, dirty, editId (MenuSyncState)
    srv,      \* srv[i]: the server's row (ver 0: none; del: a tombstone)
    net,      \* net[d]: idle, a request on its way, or a reply on its way back
    online,   \* online[d]
    lost,     \* replies lost so far
    offl,     \* offline periods so far
    events,   \* edits and deletions so far
    made,     \* history: every edit made
    delSeen,  \* history: what every deleted menu held when it was deleted
    copies    \* history: conflict copies made

vars == <<lm, ss, srv, net, online, lost, offl, events, made, delSeen, copies>>

Content   == [live : BOOLEAN, h : SUBSET Events]
SyncState == [known : BOOLEAN, base : Nat, seen : Nat, dirty : BOOLEAN, eid : Nat]
Row       == [ver : Nat, del : BOOLEAN, h : SUBSET Events, eid : Nat]

TypeOK ==
    /\ lm \in [Devices -> [Ids -> Content]]
    /\ ss \in [Devices -> [Ids -> SyncState]]
    /\ srv \in [Ids -> Row]
    /\ \A d \in Devices : net[d].s \in {"idle", "pull", "push", "ok", "rej", "pulled", "fail"}
    /\ online \in [Devices -> BOOLEAN]
    /\ lost \in 0..MaxLost /\ offl \in 0..MaxOffline /\ events \in 0..MaxEvents
    /\ made \subseteq Events /\ delSeen \subseteq Events
    /\ copies \subseteq [dev : Devices, from : Ids, to : Ids]

Init ==
    /\ lm = [d \in Devices |-> [i \in Ids |->
              IF i = M0 THEN [live |-> TRUE, h |-> {}] ELSE Absent]]
    /\ ss = [d \in Devices |-> [i \in Ids |->
              IF i = M0 THEN [known |-> TRUE, base |-> 1, seen |-> 1, dirty |-> FALSE, eid |-> 0]
                        ELSE Unknown]]
    /\ srv = [i \in Ids |-> IF i = M0 THEN [ver |-> 1, del |-> FALSE, h |-> {}, eid |-> 0]
                                      ELSE NoRow]
    /\ net = [d \in Devices |-> [s |-> "idle"]]
    /\ online = [d \in Devices |-> TRUE]
    /\ lost = 0 /\ offl = 0 /\ events = 0
    /\ made = {} /\ delSeen = {} /\ copies = {}

\* ---- the user (applyLocalSave, applyLocalDelete) ----------------------------
\* A change here: dirty; a new edit id only if it was clean.
Touch(s, e) == [s EXCEPT !.dirty = TRUE, !.eid = IF s.dirty THEN s.eid ELSE e]

Edit(d, i) ==
    /\ d \in Writers /\ events < MaxEvents /\ lm[d][i].live
    /\ LET e == events + 1 IN
         /\ events' = e
         /\ made' = made \cup {e}
         /\ lm' = [lm EXCEPT ![d][i].h = @ \cup {e}]
         /\ ss' = [ss EXCEPT ![d][i] = Touch(@, e)]
    /\ UNCHANGED <<srv, net, online, lost, offl, delSeen, copies>>

Delete(d, i) ==
    /\ d \in Writers /\ events < MaxEvents /\ lm[d][i].live
    /\ events' = events + 1
    /\ delSeen' = delSeen \cup lm[d][i].h
    /\ lm' = [lm EXCEPT ![d][i] = Absent]
    /\ ss' = [ss EXCEPT ![d][i] = Touch(@, events + 1)]
    /\ UNCHANGED <<srv, net, online, lost, offl, made, copies>>

\* ---- requests (nextRequest, pushesFor) ---------------------------------------
\* A deletion of a menu the server never had waits for a pull (dropUnsentDeletes).
Pushable(d) == {i \in Ids : ss[d][i].dirty /\ (lm[d][i].live \/ ss[d][i].base > 0)}

SendPull(d) ==
    /\ online[d] /\ net[d].s = "idle"
    /\ net' = [net EXCEPT ![d] = [s |-> "pull"]]
    /\ UNCHANGED <<lm, ss, srv, online, lost, offl, events, made, delSeen, copies>>

\* ifm = 0 is If-None-Match: *; a deletion always has If-Match.
SendPush(d) ==
    /\ online[d] /\ net[d].s = "idle"
    /\ \E i \in Pushable(d) :
         net' = [net EXCEPT ![d] = [s |-> "push", id |-> i, ifm |-> ss[d][i].base,
                                    del |-> ~lm[d][i].live, h |-> lm[d][i].h,
                                    eid |-> ss[d][i].eid]]
    /\ UNCHANGED <<lm, ss, srv, online, lost, offl, events, made, delSeen, copies>>

\* ---- the server (server/src/menus.ts) ----------------------------------------
\* The version check, for both If-Match and If-None-Match: * (NoRow has ver 0).
Accepts(m) == srv[m.id].ver = m.ifm
Written(m) == [ver |-> srv[m.id].ver + 1, del |-> m.del,
               h |-> IF m.del THEN {} ELSE m.h, eid |-> m.eid]

Serve(d) ==
    /\ net[d].s \in {"pull", "push"}
    /\ IF net[d].s = "pull"
         THEN /\ net' = [net EXCEPT ![d] = [s |-> "pulled", rows |-> srv]]
              /\ UNCHANGED srv
         ELSE LET m == net[d] IN
              IF Accepts(m)
                THEN /\ srv' = [srv EXCEPT ![m.id] = Written(m)]
                     /\ net' = [net EXCEPT ![d] = [s |-> "ok", id |-> m.id,
                                  ver |-> srv[m.id].ver + 1, del |-> m.del, h |-> m.h]]
                ELSE /\ net' = [net EXCEPT ![d] = [s |-> "rej", id |-> m.id, cur |-> srv[m.id]]]
                     /\ UNCHANGED srv
    /\ UNCHANGED <<lm, ss, online, lost, offl, events, made, delSeen, copies>>

\* The server applies the write, but the reply never arrives (SY-37).
LoseReply(d) ==
    /\ lost < MaxLost /\ net[d].s = "push" /\ Accepts(net[d])
    /\ srv' = [srv EXCEPT ![net[d].id] = Written(net[d])]
    /\ net' = [net EXCEPT ![d] = [s |-> "fail"]]
    /\ lost' = lost + 1
    /\ UNCHANGED <<lm, ss, online, offl, events, made, delSeen, copies>>

\* Offline: the request never reaches the server.
Drop(d) ==
    /\ ~online[d] /\ net[d].s \in {"pull", "push"}
    /\ net' = [net EXCEPT ![d] = [s |-> "fail"]]
    /\ UNCHANGED <<lm, ss, srv, online, lost, offl, events, made, delSeen, copies>>

GoOffline(d) ==
    /\ online[d] /\ offl < MaxOffline
    /\ online' = [online EXCEPT ![d] = FALSE] /\ offl' = offl + 1
    /\ UNCHANGED <<lm, ss, srv, net, lost, events, made, delSeen, copies>>

GoOnline(d) ==
    /\ ~online[d] /\ online' = [online EXCEPT ![d] = TRUE]
    /\ UNCHANGED <<lm, ss, srv, net, lost, offl, events, made, delSeen, copies>>

\* ---- the merge (mergeRecords, applyPushed, applyRejected) --------------------
\* L is one device's [lm, ss] plus the copies made (cp).
FreshId(d, L) == CHOOSE c \in Pool(d) : ~L.ss[c].known /\ ~L.lm[c].live

\* The table in spec §6, for one row.
MergeRow(d, L, i, row) ==
    LET s      == L.ss[i]
        mine   == L.lm[i]
        remote == IF row.del THEN Absent ELSE [live |-> TRUE, h |-> row.h]
        v      == row.ver
        Taken  == [L EXCEPT !.lm[i] = remote,
                            !.ss[i] = [known |-> TRUE, base |-> v, seen |-> v,
                                       dirty |-> FALSE, eid |-> row.eid]]
        Rebased(dirty) == [L EXCEPT !.ss[i] = [s EXCEPT !.base = v, !.seen = v, !.dirty = dirty]]
        c      == FreshId(d, L)
        WithCopy(L2, content) ==
            [L2 EXCEPT !.lm[c] = content,
                       !.ss[c] = [known |-> TRUE, base |-> 0, seen |-> 0, dirty |-> TRUE,
                                  eid |-> CopyEid(c)],
                       !.cp = @ \cup {[dev |-> d, from |-> i, to |-> c]}]
    IN  IF v <= s.seen THEN L                  \* SY-18: nothing newer (or no row)
        ELSE IF ~s.dirty THEN Taken            \* nothing or clean: add, fast-forward, delete (SY-34)
        ELSE IF row.eid = s.eid                \* our own write, reply lost (SY-37)
             THEN Rebased(mine # remote)
        ELSE IF ~mine.live THEN Taken          \* deleted here: done, or edit beats delete (SY-36)
        ELSE IF row.del THEN Rebased(TRUE)     \* edit beats delete: push over the tombstone (SY-36)
        ELSE IF mine.h = row.h THEN Taken      \* the same change on both
        ELSE IF Max(mine.h) > Max(row.h)       \* conflict: the newer edit keeps the id (SY-35)
             THEN WithCopy(Rebased(TRUE), remote)
             ELSE WithCopy(Taken, mine)

RECURSIVE MergeAll(_, _, _, _)
MergeAll(d, L, rows, S) ==
    IF S = {} THEN L
    ELSE LET i == CHOOSE x \in S : TRUE
         IN  MergeAll(d, MergeRow(d, L, i, rows[i]), rows, S \ {i})

\* After a pull: a deletion of a menu the server never had is done.
DropUnsent(L) ==
    [L EXCEPT !.ss = [i \in Ids |->
        IF L.ss[i].dirty /\ ~L.lm[i].live /\ L.ss[i].base = 0 /\ L.ss[i].seen = 0
          THEN Unknown ELSE L.ss[i]]]

Pushed(m) == IF m.del THEN Absent ELSE [live |-> TRUE, h |-> m.h]

Receive(d) ==
    LET m  == net[d]
        L  == [lm |-> lm[d], ss |-> ss[d], cp |-> {}]
        L2 == IF m.s = "ok"
                THEN [L EXCEPT !.ss[m.id] = [@ EXCEPT !.base = m.ver, !.seen = m.ver,
                                                      !.dirty = (L.lm[m.id] # Pushed(m))]]
              ELSE IF m.s = "rej" THEN MergeRow(d, L, m.id, m.cur)
              ELSE IF m.s = "pulled" THEN DropUnsent(MergeAll(d, L, m.rows, Ids))
              ELSE L
    IN  /\ m.s \in {"ok", "rej", "pulled", "fail"}
        /\ lm' = [lm EXCEPT ![d] = L2.lm]
        /\ ss' = [ss EXCEPT ![d] = L2.ss]
        /\ copies' = copies \cup L2.cp
        /\ net' = [net EXCEPT ![d] = [s |-> "idle"]]
        /\ UNCHANGED <<srv, online, lost, offl, events, made, delSeen>>

Next ==
    \/ \E d \in Devices, i \in Ids : Edit(d, i) \/ Delete(d, i)
    \/ \E d \in Devices :
         \/ SendPull(d) \/ SendPush(d) \/ Serve(d) \/ LoseReply(d) \/ Drop(d)
         \/ Receive(d) \/ GoOffline(d) \/ GoOnline(d)

\* Users aren't forced to edit, and the network isn't forced to fail.  Devices
\* come back online, the server answers, replies arrive, devices keep pulling,
\* and a device that keeps having something to push eventually pushes it
\* (strong fairness: it may pull in between).
Fairness ==
    \A d \in Devices :
        /\ WF_vars(SendPull(d))
        /\ SF_vars(SendPush(d))
        /\ WF_vars(Serve(d))
        /\ WF_vars(Receive(d))
        /\ WF_vars(GoOnline(d))

Spec == Init /\ [][Next]_vars /\ Fairness

\* ===========================================================================
\* Properties
\* ===========================================================================

\* SY-39 (with SY-35, SY-36, SY-37): every edit made is in some live menu, on a
\* device or the server, or a device that had seen it deleted its menu.  (A
\* later edit by a device that had seen it includes it: content is the set of
\* edits seen.)
NoSilentLoss ==
    \A e \in made :
        \/ e \in delSeen
        \/ \E d \in Devices, i \in Ids : lm[d][i].live /\ e \in lm[d][i].h
        \/ \E i \in Ids : srv[i].ver > 0 /\ ~srv[i].del /\ e \in srv[i].h

\* SY-18: a device never goes back to an older version of a menu (it may only
\* forget a menu it never saw on the server), and never sees one the server
\* didn't have.
SY18_NeverBackwards ==
    [][\A d \in Devices, i \in Ids : ss'[d][i].seen >= ss[d][i].seen \/ ss[d][i].seen = 0]_vars
SeenOnServer == \A d \in Devices, i \in Ids : ss[d][i].seen <= srv[i].ver

\* Every write is conditional on the latest version the device has seen.
BaseIsSeen == \A d \in Devices, i \in Ids : ss[d][i].base = ss[d][i].seen
LiveIsKnown == \A d \in Devices, i \in Ids : lm[d][i].live => ss[d][i].known

\* SY-37: with one device editing, lost replies and offline periods never make
\* a conflict copy.  Checked by SyncOneWriter.cfg.
SY37_NoCopies == copies = {}

\* SY-38: once edits stop, every device ends up holding exactly the server's
\* live menus, with nothing left to push.
Converged ==
    \A d \in Devices, i \in Ids :
        /\ ~ss[d][i].dirty
        /\ lm[d][i] = IF srv[i].ver > 0 /\ ~srv[i].del
                        THEN [live |-> TRUE, h |-> srv[i].h] ELSE Absent
SY38_Converges == <>[]Converged
=============================================================================
