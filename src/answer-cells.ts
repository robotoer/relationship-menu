/**
 * How one compared item's answers are classified (spec §7, CP-10..CP-12).
 *
 * This file is verified with LemmaScript (Dafny backend): the predicates below are
 * the code the app runs (src/compare-filters.ts calls them), and the `check*`
 * functions are lemmas — their `ensures` must hold for every possible input.
 * Run: `npx lsc check --backend=dafny src/answer-cells.ts`.
 */

/**
 * One menu's answer for one item. "absent": the item isn't on that menu.
 * "none": it's on the menu but unanswered.
 */
export type Cell =
  | "absent"
  | "none"
  | "must-have"
  | "like-to-have"
  | "maybe"
  | "soft-no"
  | "off-limits";

//@ pure
export function isAnswered(c: Cell): boolean {
  return c !== "absent" && c !== "none";
}

//@ pure
export function wants(c: Cell): boolean {
  return c === "must-have" || c === "like-to-have";
}

/** Everyone gave an answer (and there is at least one menu). */
//@ pure
export function everyoneAnswered(cells: Cell[]): boolean {
  return cells.length > 0 && cells.every((c) => isAnswered(c));
}

/** Someone wants it (Must/Like) and someone marked it Off limits. */
//@ pure
export function isConflict(cells: Cell[]): boolean {
  return cells.some((c) => wants(c)) && cells.some((c) => c === "off-limits");
}

/** Everyone answered, all the same. */
//@ pure
export function isAgree(cells: Cell[]): boolean {
  return everyoneAnswered(cells) && cells.every((c) => c === cells[0]);
}

/** Everyone answered Must have or Like to have. */
//@ pure
export function isAllWant(cells: Cell[]): boolean {
  return everyoneAnswered(cells) && cells.every((c) => wants(c));
}

/** Everyone answered, answers differ, and it isn't a conflict ("Talk about it"). */
//@ pure
export function isDiffer(cells: Cell[]): boolean {
  return everyoneAnswered(cells) && !isAgree(cells) && !isConflict(cells);
}

/** Someone has it on their menu but didn't answer. */
//@ pure
export function isUnanswered(cells: Cell[]): boolean {
  return cells.some((c) => c === "none");
}

/** Some menu doesn't include it. */
//@ pure
export function isMissing(cells: Cell[]): boolean {
  return cells.some((c) => c === "absent");
}

// ---- Lemmas -----------------------------------------------------------------

/** CP-10: when everyone answered, exactly one of Agree / Talk about it / Conflict. */
export function checkFullyAnsweredHasOneVerdict(cells: Cell[]): boolean {
  //@ contract If everyone answered an item, it is in exactly one of Agree, Talk about it and Conflicts.
  //@ requires everyoneAnswered(cells)
  //@ ensures isAgree(cells) || isDiffer(cells) || isConflict(cells)
  //@ ensures !(isAgree(cells) && isConflict(cells))
  //@ ensures !(isAgree(cells) && isDiffer(cells))
  //@ ensures !(isDiffer(cells) && isConflict(cells))
  return true;
}

/** CP-11: Agree and Conflict never overlap, for any input. */
export function checkAgreeExcludesConflict(cells: Cell[]): boolean {
  //@ contract An item never counts as both Agree and Conflicts.
  //@ ensures !(isAgree(cells) && isConflict(cells))
  return true;
}

/** CP-11: All want implies everyone answered, and is never a conflict. */
export function checkAllWantIsAnsweredAndNoConflict(cells: Cell[]): boolean {
  //@ contract "All want" items were answered by everyone and are never conflicts.
  //@ ensures isAllWant(cells) ==> everyoneAnswered(cells)
  //@ ensures isAllWant(cells) ==> !isConflict(cells)
  return true;
}

/** CP-11: Talk about it and Unanswered/Not-on-every-menu never overlap. */
export function checkDifferIsFullyAnswered(cells: Cell[]): boolean {
  //@ contract "Talk about it" only applies when everyone answered.
  //@ ensures isDiffer(cells) ==> !isUnanswered(cells) && !isMissing(cells)
  return true;
}

/** CP-11: without anyone wanting it, nothing is a conflict (e.g. Maybe vs Off limits). */
export function checkNoWantNoConflict(cells: Cell[]): boolean {
  //@ contract If nobody answered Must have or Like to have, it is not a conflict.
  //@ requires forall(k: nat, k < cells.length ==> !wants(cells[k]))
  //@ ensures !isConflict(cells)
  return true;
}
