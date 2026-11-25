# Dafny model of menu editing

`MenuEditing.dfy` models `applyMenuChange` (`src/menu-editing.ts`): a menu is an ordered `seq` of `(name, items)` groups, an item is `(text, answer?)`, and `Apply(m, c)` covers every change kind (add/rename/delete group, add/update/delete item, move item/group by ±1, insert-group, replace). The case-folding used by insert-group is an uninterpreted `Fold`; no property of it is assumed. Like the code, insert-group ignores a blank group name, skips texts already present or repeated earlier in its own list, and an update that changes nothing returns the same menu. The file contains no `assume` or `{:axiom}`.

| Lemma | Rule | fast-check test (`src/__props__/menu-editing.props.test.ts`) |
| --- | --- | --- |
| `DM_1_DistinctNamesPreserved` | DM-1 | "DM-1: no edit merges or drops groups…" |
| `ED_1_AddGroupAppendsOrNoop` | ED-1 | "ED-1: add group appends at the end or is a no-op" |
| `ED_2_RenameKeepsPositionAndItems` | ED-2 | "ED-2: rename keeps position and items…" |
| `ED_3_OnlyDeleteRemovesGroups` | ED-3 | "ED-3: only delete-group removes a group…" |
| `ED_4_AddItemAppends` | ED-4 | "ED-4: add item appends to the group with a fresh id" |
| `ED_5_UpdateChangesOnlyGivenFields` | ED-5 | "ED-5: updating an item changes only the given fields" |
| `ED_6_DeleteItemRemovesExactlyThat` | ED-6 | "ED-6: delete item removes exactly that item…" |
| `ED_7_MoveItemSwapsOrNoop`, `ED_7_MoveGroupSwapsOrNoop` | ED-7 | the two "ED-7: move … swaps neighbours…" tests |
| `ED_8_InsertGroupOnlyAppendsMissing` | ED-8 | "ED-8: insert-group only appends missing items…" |
| `ED_9_ReplaceReplaces` | ED-9 | "ED-9: replace returns the given menu" |
| `ED_11_NoSilentLoss` | ED-11 | "ED-11: no silent loss…" |
| (not modelled) | ED-10, ED-12 | "ED-10: …", "ED-12: …" and the "regressions found by these properties" block |

Run: `dafny verify docs/spec/formal/dafny/MenuEditing.dfy` (Dafny 4.11; expect "0 errors") and
`CI=true npx react-scripts test --watchAll=false src/__props__/menu-editing`.

Deliberately left out: item `id`s and `generateId` (DM-3), JS object identity (ED-10: "same object" for no-ops), prototypes and `__proto__`-style keys (ED-12), offsets other than ±1, and the JS rule that array-index keys such as `"0"` are always listed first. The model assumes keys keep insertion order, which is false for those names. The fast-check tests cover the JS-only points.

The property tests first found four problems in `menu-editing.ts`, all now fixed and kept as regression tests:

- an item edit naming a missing group `constructor` crashed (ED-12);
- edits that changed nothing returned a new object, which made an empty undo step (ED-10);
- insert-group added repeats from its own list and accepted a blank name (ED-8; the model was updated to match and re-proved: 44 verified, 0 errors);
- group names made only of digits ignore insertion order, a JavaScript rule. This one is a known limitation (KL-1 in the spec): a move that can't take effect now returns the same menu.
