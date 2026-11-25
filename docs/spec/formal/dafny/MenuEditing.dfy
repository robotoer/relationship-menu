// A model of applyMenuChange (src/menu-editing.ts) and proofs of the editing
// rules in docs/spec/README.md, section 3 (ED-1..ED-11) and DM-1.
//
// A menu is an ORDERED sequence of named groups: the TypeScript menu is a plain
// object whose key insertion order is the group order, so order is part of the
// state. Item ids, JS object identity and prototypes are left out (see README.md).

module MenuEditing {

  // ---------------------------------------------------------------- data model

  datatype Option<T> = None | Some(value: T)
  datatype Answer = MustHave | LikeToHave | Maybe | OffLimits
  datatype Item = Item(text: string, answer: Option<Answer>)
  datatype Group = Group(name: string, items: seq<Item>)
  type Menu = seq<Group>

  // DM-1: "Group names in a menu are unique (exact text)."
  ghost predicate DistinctNames(m: Menu) {
    forall a, b :: 0 <= a < b < |m| ==> m[a].name != m[b].name
  }

  // Position of the group called n, or -1 (Object.keys(menu).indexOf(n)).
  function IndexOf(m: Menu, n: string): (i: int)
    ensures -1 <= i < |m|
    ensures i >= 0 ==> m[i].name == n
    ensures i < 0 ==> forall j :: 0 <= j < |m| ==> m[j].name != n
  {
    if |m| == 0 then -1
    else if m[0].name == n then 0
    else var r := IndexOf(m[1..], n); if r < 0 then -1 else r + 1
  }

  // Case-folding used to match ready-made items: item.trim().toLowerCase().
  // Uninterpreted on purpose; NO property of it is assumed by any proof below,
  // so the ED-8 results hold for every possible folding function. The model
  // reads "blank" (item.trim() === "") as Fold(s) == "", which is equivalent
  // because lower-casing never turns a non-empty string into "" or vice versa.
  function Fold(s: string): string

  // String trim (item text → group name for ItemToGroup). Uninterpreted, like Fold.
  function Trim(s: string): string

  // ------------------------------------------------------------------ changes

  datatype Dir = Up | Down // offset -1 / +1; the editor only sends these
  function Offset(d: Dir): int { if d == Up then -1 else 1 }

  // Partial<RelationshipMenuItem>: None = field not given. answer Some(None)
  // clears the answer ("---" in the picker).
  datatype Patch = Patch(text: Option<string>, answer: Option<Option<Answer>>)

  datatype Change =
    | AddGroup(name: string)                         // { kind: "group", newGroup }
    | RenameGroup(oldName: string, newName: string)  // { kind: "group", oldGroup, newGroup }
    | DeleteGroup(name: string)                      // { kind: "group", oldGroup }
    | EditItem(group: string, index: int, patch: Patch) // { kind: "item", value }: add if index == length, else update
    | DeleteItem(group: string, index: int)          // { kind: "item" } without value
    | MoveItem(group: string, index: int, dir: Dir)  // { kind: "move-item" }
    | MoveGroup(group: string, dir: Dir)             // { kind: "move-group" }
    | InsertGroup(group: string, texts: seq<string>) // { kind: "insert-group" }
    | ItemToGroup(group: string, index: int)         // { kind: "item-to-group" }
    | Replace(menu: Menu)                            // { kind: "replace" }

  // A replacement menu must itself be a valid menu.
  ghost predicate WellFormed(c: Change) {
    c.Replace? ==> DistinctNames(c.menu)
  }

  // ----------------------------------------------------------------- helpers

  function SetItems(m: Menu, i: int, items: seq<Item>): Menu
    requires 0 <= i < |m|
  {
    m[i := Group(m[i].name, items)]
  }

  function Swap<T>(s: seq<T>, a: int, b: int): seq<T>
    requires 0 <= a < |s| && 0 <= b < |s|
  {
    s[a := s[b]][b := s[a]]
  }

  function NewItem(p: Patch): Item {
    Item(if p.text.Some? then p.text.value else "",
         if p.answer.Some? then p.answer.value else None)
  }

  // { ...item, ...value }: only the given fields change.
  function PatchItem(x: Item, p: Patch): Item {
    Item(if p.text.Some? then p.text.value else x.text,
         if p.answer.Some? then p.answer.value else x.answer)
  }

  function Folds(items: seq<Item>): set<string> {
    set x | x in items :: Fold(x.text)
  }

  // The ready-made items to append: non-blank, not already present (by fold), and
  // not repeating an earlier text in `texts` (each added text joins `have`).
  function Missing(texts: seq<string>, have: set<string>): seq<Item> {
    if |texts| == 0 then []
    else if Fold(texts[0]) != "" && Fold(texts[0]) !in have
      then [Item(texts[0], None)] + Missing(texts[1..], have + {Fold(texts[0])})
      else Missing(texts[1..], have)
  }

  function Existing(m: Menu, g: string): seq<Item> {
    var i := IndexOf(m, g); if i >= 0 then m[i].items else []
  }

  // ItemToGroup takes effect: the group and item exist, and the trimmed text is a
  // non-empty name no group has yet.
  predicate ItemToGroupApplies(m: Menu, g: string, k: int) {
    var i := IndexOf(m, g);
    i >= 0 && 0 <= k < |m[i].items|
    && Trim(m[i].items[k].text) != "" && IndexOf(m, Trim(m[i].items[k].text)) < 0
  }

  // ------------------------------------------------------ the function itself

  function Apply(m: Menu, c: Change): Menu {
    match c
    case AddGroup(n) =>
      if n == "" || IndexOf(m, n) >= 0 then m else m + [Group(n, [])]
    case RenameGroup(o, n) =>
      var i := IndexOf(m, o);
      if o == n || i < 0 || IndexOf(m, n) >= 0 then m
      else m[i := Group(n, m[i].items)]
    case DeleteGroup(n) =>
      var i := IndexOf(m, n);
      if i < 0 then m else m[..i] + m[i+1..]
    case EditItem(g, k, p) =>
      var i := IndexOf(m, g);
      if i < 0 then m
      else if k == |m[i].items| then SetItems(m, i, m[i].items + [NewItem(p)])
      else if 0 <= k < |m[i].items| then
        (if PatchItem(m[i].items[k], p) == m[i].items[k] then m // nothing changes (ED-10)
         else SetItems(m, i, m[i].items[k := PatchItem(m[i].items[k], p)]))
      else m
    case DeleteItem(g, k) =>
      var i := IndexOf(m, g);
      if i < 0 || !(0 <= k < |m[i].items|) then m
      else SetItems(m, i, m[i].items[..k] + m[i].items[k+1..])
    case MoveItem(g, k, d) =>
      var i := IndexOf(m, g);
      if i < 0 then m
      else
        var to := k + Offset(d);
        if !(0 <= k < |m[i].items|) || !(0 <= to < |m[i].items|) then m
        else SetItems(m, i, Swap(m[i].items, k, to))
    case MoveGroup(g, d) =>
      var i := IndexOf(m, g);
      var to := i + Offset(d);
      if i < 0 || !(0 <= to < |m|) then m else Swap(m, i, to)
    case InsertGroup(g, texts) =>
      var i := IndexOf(m, g);
      var existing := Existing(m, g);
      var added := Missing(texts, Folds(existing));
      if Fold(g) == "" then m                 // blank names are ignored, as for AddGroup
      else if |added| == 0 && i >= 0 then m   // nothing to add (ED-10)
      else if i >= 0 then SetItems(m, i, existing + added)
      else m + [Group(g, added)]
    case ItemToGroup(g, k) =>
      var i := IndexOf(m, g);
      if i < 0 || !(0 <= k < |m[i].items|) then m
      else
        var x := m[i].items[k];
        if Trim(x.text) == "" || IndexOf(m, Trim(x.text)) >= 0 then m
        else m[..i] + [Group(m[i].name, m[i].items[..k] + m[i].items[k+1..]),
                       Group(Trim(x.text), [x])] + m[i+1..]
    case Replace(n) => n
  }

  // ------------------------------------------------------------ basic lemmas

  lemma IndexOfDistinct(m: Menu, j: int)
    requires DistinctNames(m) && 0 <= j < |m|
    ensures IndexOf(m, m[j].name) == j
  {
    if j > 0 {
      assert m[1..][j-1] == m[j];
      IndexOfDistinct(m[1..], j - 1);
    }
  }

  lemma SwapPermutes<T>(s: seq<T>, a: int, b: int)
    requires 0 <= a < |s| && 0 <= b < |s|
    ensures |Swap(s, a, b)| == |s|
    ensures multiset(Swap(s, a, b)) == multiset(s)
  {}

  lemma MissingIsNew(texts: seq<string>, have: set<string>)
    ensures forall x :: x in Missing(texts, have) ==>
      x.text in texts && x.answer == None && Fold(x.text) != "" && Fold(x.text) !in have
  {
    if |texts| > 0 {
      if Fold(texts[0]) != "" && Fold(texts[0]) !in have {
        MissingIsNew(texts[1..], have + {Fold(texts[0])});
      } else {
        MissingIsNew(texts[1..], have);
      }
    }
  }

  // ===================================================================== DM-1

  // DM-1: every edit keeps group names unique.
  lemma DM_1_DistinctNamesPreserved(m: Menu, c: Change)
    requires DistinctNames(m) && WellFormed(c)
    ensures DistinctNames(Apply(m, c))
  {
    var r := Apply(m, c);
    match c
    case DeleteGroup(n) =>
      var i := IndexOf(m, n);
      if i >= 0 {
        forall a, b | 0 <= a < b < |r| ensures r[a].name != r[b].name {
          var a' := if a < i then a else a + 1;
          var b' := if b < i then b else b + 1;
          assert r[a] == m[a'] && r[b] == m[b'];
        }
      }
    case MoveGroup(g, d) =>
      var i := IndexOf(m, g);
      var to := i + Offset(d);
      if i >= 0 && 0 <= to < |m| {
        forall a, b | 0 <= a < b < |r| ensures r[a].name != r[b].name {
          var a' := if a == i then to else if a == to then i else a;
          var b' := if b == i then to else if b == to then i else b;
          assert r[a] == m[a'] && r[b] == m[b'];
        }
      }
    case RenameGroup(o, n) =>
      var i := IndexOf(m, o);
      if r != m {
        forall a, b | 0 <= a < b < |r| ensures r[a].name != r[b].name {
          if a != i && b != i { assert r[a] == m[a] && r[b] == m[b]; }
        }
      }
    case InsertGroup(g, texts) =>
      if |r| == |m| { SameNames(m, r); }
    case ItemToGroup(g, k) =>
      if ItemToGroupApplies(m, g, k) {
        var i := IndexOf(m, g);
        var n := Trim(m[i].items[k].text);
        // Name of r[a] in terms of m: m[a] up to i, then n, then m[a - 1].
        forall a, b | 0 <= a < b < |r| ensures r[a].name != r[b].name {
          var na := if a <= i then m[a].name else if a == i + 1 then n else m[a-1].name;
          var nb := if b <= i then m[b].name else if b == i + 1 then n else m[b-1].name;
          assert r[a].name == na && r[b].name == nb;
        }
      } else {
        SameNames(m, r);
      }
    case AddGroup(n) =>
    case Replace(n) =>
    case _ =>
      SameNames(m, r);
  }

  // Edits inside one group (SetItems) keep every name where it was.
  lemma SameNames(m: Menu, r: Menu)
    requires DistinctNames(m) && |r| == |m|
    requires forall j :: 0 <= j < |m| ==> r[j].name == m[j].name
    ensures DistinctNames(r)
  {}

  // ============================================================== ED-1..ED-9

  // ED-1: "Add group: appended at the end. Ignored if the name is empty or
  // already used."
  lemma ED_1_AddGroupAppendsOrNoop(m: Menu, n: string)
    ensures var r := Apply(m, AddGroup(n));
      if n == "" || IndexOf(m, n) >= 0 then r == m
      else |r| == |m| + 1 && r[..|m|] == m && r[|m|] == Group(n, [])
  {}

  // ED-2: "Rename group: keeps its position and items. Ignored if another group
  // already has the new name. Renaming to empty text is allowed and keeps the
  // group."
  lemma ED_2_RenameKeepsPositionAndItems(m: Menu, o: string, n: string)
    requires DistinctNames(m)
    ensures var r := Apply(m, RenameGroup(o, n)); var i := IndexOf(m, o);
      |r| == |m|
      && (IndexOf(m, n) >= 0 ==> r == m)                 // onto an existing name: no-op
      && (i >= 0 && IndexOf(m, n) < 0 ==>                 // includes n == ""
            r[i] == Group(n, m[i].items)
            && forall j :: 0 <= j < |m| && j != i ==> r[j] == m[j])
  {}

  // ED-3: "Delete group: only by the explicit delete action. Clearing a name
  // never deletes." Delete removes exactly the named group; no other change
  // (renaming to "" included) removes a group.
  lemma ED_3_OnlyDeleteRemovesGroups(m: Menu, c: Change)
    requires DistinctNames(m)
    ensures c.DeleteGroup? ==>
      var i := IndexOf(m, c.name);
      Apply(m, c) == if i < 0 then m else m[..i] + m[i+1..]
    ensures !c.DeleteGroup? && !c.Replace? ==>
      |Apply(m, c)| >= |m|
      && forall j :: 0 <= j < |m| ==> IndexOf(Apply(m, c), RenamedName(m, c, m[j].name)) >= 0
  {
    if c.DeleteItem? {
      var r := Apply(m, c);
      DM_1_DistinctNamesPreserved(m, c);
      forall j | 0 <= j < |m| ensures IndexOf(r, RenamedName(m, c, m[j].name)) >= 0 {
        assert r[j].name == m[j].name;
        IndexOfDistinct(r, j);
      }
    } else if !c.DeleteGroup? && !c.Replace? {
      ED_11_NoSilentLoss(m, c);
    }
  }

  // ED-4: "Add item: appended to the group." (The fresh id is not modelled.)
  lemma ED_4_AddItemAppends(m: Menu, g: string, p: Patch)
    requires IndexOf(m, g) >= 0
    ensures var i := IndexOf(m, g);
      Apply(m, EditItem(g, |m[i].items|, p)) == SetItems(m, i, m[i].items + [NewItem(p)])
  {}

  // ED-5: "Change item: only the given fields change."
  lemma ED_5_UpdateChangesOnlyGivenFields(m: Menu, g: string, k: int, p: Patch)
    requires IndexOf(m, g) >= 0
    requires 0 <= k < |m[IndexOf(m, g)].items|
    ensures var i := IndexOf(m, g); var r := Apply(m, EditItem(g, k, p));
      var before := m[i].items[k]; var after := r[i].items[k];
      |r| == |m| && r[i].name == g && |r[i].items| == |m[i].items|
      && (forall j :: 0 <= j < |m| && j != i ==> r[j] == m[j])
      && (forall q :: 0 <= q < |m[i].items| && q != k ==> r[i].items[q] == m[i].items[q])
      && after.text == (if p.text.Some? then p.text.value else before.text)
      && after.answer == (if p.answer.Some? then p.answer.value else before.answer)
  {}

  // ED-6: "Delete item: removes exactly that item."
  lemma ED_6_DeleteItemRemovesExactlyThat(m: Menu, g: string, k: int)
    ensures var i := IndexOf(m, g); var r := Apply(m, DeleteItem(g, k));
      if i >= 0 && 0 <= k < |m[i].items|
      then r == SetItems(m, i, m[i].items[..k] + m[i].items[k+1..])
      else r == m
  {}

  // ED-7 (items): "Move item: swaps with its neighbour; at either end nothing
  // happens. Moving never adds or removes anything."
  lemma ED_7_MoveItemSwapsOrNoop(m: Menu, g: string, k: int, d: Dir)
    ensures var i := IndexOf(m, g); var r := Apply(m, MoveItem(g, k, d));
      var to := k + Offset(d);
      if i >= 0 && 0 <= k < |m[i].items| && 0 <= to < |m[i].items|
      then r == SetItems(m, i, Swap(m[i].items, k, to))
           && multiset(r[i].items) == multiset(m[i].items)
      else r == m
  {
    var i := IndexOf(m, g);
    var to := k + Offset(d);
    if i >= 0 && 0 <= k < |m[i].items| && 0 <= to < |m[i].items| {
      SwapPermutes(m[i].items, k, to);
    }
  }

  // ED-7 (groups): same rule for groups.
  lemma ED_7_MoveGroupSwapsOrNoop(m: Menu, g: string, d: Dir)
    ensures var i := IndexOf(m, g); var r := Apply(m, MoveGroup(g, d));
      var to := i + Offset(d);
      if i >= 0 && 0 <= to < |m|
      then r == Swap(m, i, to) && multiset(r) == multiset(m)
      else r == m
  {
    var i := IndexOf(m, g);
    var to := i + Offset(d);
    if i >= 0 && 0 <= to < |m| { SwapPermutes(m, i, to); }
  }

  // ED-8: "Add a ready-made group: creates the group, or, if it exists, appends
  // only the items it doesn't already have (matched ignoring case). Existing
  // items and answers are never touched."
  lemma ED_8_InsertGroupOnlyAppendsMissing(m: Menu, g: string, texts: seq<string>)
    ensures var i := IndexOf(m, g); var r := Apply(m, InsertGroup(g, texts));
      if Fold(g) == "" then r == m
      else if i < 0 then
        |r| == |m| + 1 && r[..|m|] == m && r[|m|].name == g
        && forall x :: x in r[|m|].items ==> x.text in texts && x.answer == None && Fold(x.text) != ""
      else
        |r| == |m| && r[i].name == g
        && (forall j :: 0 <= j < |m| && j != i ==> r[j] == m[j])
        && |r[i].items| >= |m[i].items|
        && r[i].items[..|m[i].items|] == m[i].items
        && forall q :: |m[i].items| <= q < |r[i].items| ==>
             r[i].items[q].text in texts && r[i].items[q].answer == None
             && Fold(r[i].items[q].text) != ""
             && Fold(r[i].items[q].text) !in Folds(m[i].items)
  {
    var i := IndexOf(m, g);
    MissingIsNew(texts, Folds(Existing(m, g)));
    if i >= 0 && Fold(g) != "" {
      var r := Apply(m, InsertGroup(g, texts));
      var added := Missing(texts, Folds(m[i].items));
      if |added| != 0 {
        assert r[i].items == m[i].items + added;
        forall q | |m[i].items| <= q < |r[i].items|
          ensures r[i].items[q] in added
        {
          assert r[i].items[q] == added[q - |m[i].items|];
        }
      }
    }
  }

  // ED-14: "Make into group: the item becomes a new group named after its
  // (trimmed) text, placed right after its group and holding that item as its
  // only entry. Ignored if the text is blank or the name is taken."
  lemma ED_14_ItemToGroup(m: Menu, g: string, k: int)
    ensures var r := Apply(m, ItemToGroup(g, k));
      if !ItemToGroupApplies(m, g, k) then r == m
      else
        var i := IndexOf(m, g); var x := m[i].items[k];
        |r| == |m| + 1
        && r[..i] == m[..i] && r[i+2..] == m[i+1..]
        && r[i] == Group(g, m[i].items[..k] + m[i].items[k+1..])
        && r[i+1] == Group(Trim(x.text), [x])
        // nothing lost or duplicated across the whole menu
        && multiset(m[i].items) == multiset(r[i].items) + multiset(r[i+1].items)
  {
    if ItemToGroupApplies(m, g, k) {
      var s := m[IndexOf(m, g)].items;
      assert s == s[..k] + [s[k]] + s[k+1..];
    }
  }

  // ED-9: "Start from a template: replaces the whole menu."
  lemma ED_9_ReplaceReplaces(m: Menu, n: Menu)
    ensures Apply(m, Replace(n)) == n
  {}

  // ==================================================================== ED-11

  // The name a group has after c (only an effective rename changes it).
  function RenamedName(m: Menu, c: Change, n: string): string {
    if c.RenameGroup? && n == c.oldName && c.oldName != c.newName
       && IndexOf(m, c.newName) < 0
    then c.newName else n
  }

  // Items of group j that must survive c: all of them, except the one item an
  // update targets (whose given fields change by design, ED-5) or that becomes
  // its own group (ED-14 proves it lands there).
  function Protected(m: Menu, c: Change, j: int): multiset<Item>
    requires 0 <= j < |m|
  {
    var items := m[j].items;
    if (c.EditItem? || c.ItemToGroup?) && m[j].name == c.group && 0 <= c.index < |items|
    then multiset(items) - multiset{items[c.index]}  // ItemToGroup: it moves (ED-14)
    else multiset(items)
  }

  // Where group j ends up after c (an index into Apply(m, c)).
  function NewPos(m: Menu, c: Change, j: int): int {
    if c.MoveGroup? then
      var i := IndexOf(m, c.group); var to := i + Offset(c.dir);
      if i >= 0 && 0 <= to < |m| then (if j == i then to else if j == to then i else j) else j
    else if c.ItemToGroup? && ItemToGroupApplies(m, c.group, c.index) then
      (if j > IndexOf(m, c.group) then j + 1 else j)  // the new group sits at i + 1
    else j
  }

  // ED-11: "No silent loss: apart from delete and replace, every edit keeps
  // every existing item's text and answer." Precisely: for every change other
  // than DeleteGroup, DeleteItem and Replace, every group of m is still present
  // (under its new name if it was renamed), and the multiset of its
  // (text, answer) items is contained in the new group's multiset (minus the
  // single item an update edits).
  lemma ED_11_NoSilentLoss(m: Menu, c: Change)
    requires DistinctNames(m)
    requires !c.DeleteGroup? && !c.DeleteItem? && !c.Replace?
    ensures var r := Apply(m, c);
      forall j :: 0 <= j < |m| ==>
        var k := IndexOf(r, RenamedName(m, c, m[j].name));
        0 <= k < |r| && Protected(m, c, j) <= multiset(r[k].items)
  {
    var r := Apply(m, c);
    DM_1_DistinctNamesPreserved(m, c);
    forall j | 0 <= j < |m|
      ensures var k := IndexOf(r, RenamedName(m, c, m[j].name));
        0 <= k < |r| && Protected(m, c, j) <= multiset(r[k].items)
    {
      var p := NewPos(m, c, j);
      PositionKept(m, c, j);
      IndexOfDistinct(r, p);
    }
  }

  // Per-group step of ED-11: group j sits at NewPos with its (new) name and a
  // superset of its protected items.
  lemma PositionKept(m: Menu, c: Change, j: int)
    requires DistinctNames(m) && 0 <= j < |m|
    requires !c.DeleteGroup? && !c.DeleteItem? && !c.Replace?
    ensures var r := Apply(m, c); var p := NewPos(m, c, j);
      0 <= p < |r| && r[p].name == RenamedName(m, c, m[j].name)
      && Protected(m, c, j) <= multiset(r[p].items)
  {
    var r := Apply(m, c);
    match c
    case EditItem(g, k, pt) =>
      var i := IndexOf(m, g);
      if i == j && 0 <= k < |m[i].items| {
        var s := m[i].items;
        assert r[i].items == s[k := PatchItem(s[k], pt)];
        assert s == s[..k] + [s[k]] + s[k+1..];
        assert r[i].items == s[..k] + [PatchItem(s[k], pt)] + s[k+1..];
        assert multiset(s) - multiset{s[k]} == multiset(s[..k]) + multiset(s[k+1..]);
      } else if i == j && k == |m[i].items| {
        assert r[i].items == m[i].items + [NewItem(pt)];
      }
    case MoveItem(g, k, d) =>
      var i := IndexOf(m, g);
      var to := k + Offset(d);
      if i == j && 0 <= k < |m[i].items| && 0 <= to < |m[i].items| {
        SwapPermutes(m[i].items, k, to);
      }
    case InsertGroup(g, texts) =>
      var i := IndexOf(m, g);
      if i == j {
        assert multiset(m[i].items) <= multiset(m[i].items + Missing(texts, Folds(m[i].items)));
      }
    case ItemToGroup(g, k) =>
      if ItemToGroupApplies(m, g, k) {
        var i := IndexOf(m, g);
        var s := m[i].items;
        if j < i {
          assert r[j] == m[j];
        } else if j == i {
          assert r[i].items == s[..k] + s[k+1..];
          assert s == s[..k] + [s[k]] + s[k+1..];
          assert multiset(s) - multiset{s[k]} == multiset(s[..k]) + multiset(s[k+1..]);
        } else {
          assert r[j + 1] == m[j];
        }
      }
    case _ =>
  }
}
