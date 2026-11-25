/**
 * Filters for the compare view: which items people agree on, conflict on, etc.
 */

import { ComparedMenuItem, ComparedMenuItemValue, MenuComparison } from "./model/compare";
import {
  Cell,
  isAgree,
  isAllWant,
  isConflict,
  isDiffer,
  isMissing,
  isUnanswered,
} from "./answer-cells";

export type CompareFilter =
  | "all"
  | "agree"
  | "both-want"
  | "conflict"
  | "differ"
  | "unanswered"
  | "missing";

export const COMPARE_FILTERS: {
  id: CompareFilter;
  label: string;
  description: string;
}[] = [
  { id: "all", label: "All", description: "Every item" },
  {
    id: "agree",
    label: "Agree",
    description: "Everyone gave the same answer",
  },
  {
    id: "both-want",
    label: "All want",
    description: "Everyone answered Must have or Like to have",
  },
  {
    id: "conflict",
    label: "Conflicts",
    description: "Someone wants it and someone marked it Off limits",
  },
  {
    id: "differ",
    label: "Talk about it",
    description: "Answers differ, but nobody ruled it out",
  },
  {
    id: "unanswered",
    label: "Unanswered",
    description: "Someone has it on their menu but didn't answer",
  },
  {
    id: "missing",
    label: "Not on every menu",
    description: "At least one menu doesn't include this item",
  },
];

/** A compared value as a verified Cell: null → "absent", undefined → "none". */
export const toCell = (value: ComparedMenuItemValue): Cell =>
  value === null ? "absent" : value === undefined ? "none" : value;

/**
 * Every filter an item belongs to (besides "all"). The predicates come from
 * src/answer-cells.ts, whose properties (CP-10, CP-11) are proved with LemmaScript.
 */
export const itemCategories = (values: ComparedMenuItemValue[]): Set<CompareFilter> => {
  const cells = values.map(toCell);
  const categories = new Set<CompareFilter>();
  if (isMissing(cells)) categories.add("missing");
  if (isUnanswered(cells)) categories.add("unanswered");
  if (isConflict(cells)) categories.add("conflict");
  if (isAgree(cells)) categories.add("agree");
  if (isDiffer(cells)) categories.add("differ");
  if (isAllWant(cells)) categories.add("both-want");
  return categories;
};

export const matchesFilter = (item: ComparedMenuItem, filter: CompareFilter) =>
  filter === "all" || itemCategories(item.values).has(filter);

/** Number of items matching each filter. */
export const countByFilter = (comparison: MenuComparison) => {
  const counts = Object.fromEntries(COMPARE_FILTERS.map((f) => [f.id, 0])) as Record<
    CompareFilter,
    number
  >;
  for (const group of Object.values(comparison)) {
    for (const item of group) {
      counts.all++;
      itemCategories(item.values).forEach((c) => counts[c]++);
    }
  }
  return counts;
};

/** The comparison restricted to items matching `filter`; empty groups are dropped. */
export const filterComparison = (
  comparison: MenuComparison,
  filter: CompareFilter
): MenuComparison => {
  if (filter === "all") return comparison;
  const result: MenuComparison = Object.create(null);
  for (const [group, items] of Object.entries(comparison)) {
    const kept = items.filter((item) => matchesFilter(item, filter));
    if (kept.length > 0) result[group] = kept;
  }
  return result;
};
