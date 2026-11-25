/**
 * Filters for the compare view: which items people agree on, conflict on, etc.
 */

import { ComparedMenuItem, ComparedMenuItemValue, MenuComparison } from "./model/compare";

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

const WANTS: ComparedMenuItemValue[] = ["must-have", "like-to-have"];

/** Every filter an item belongs to (besides "all"). */
export const itemCategories = (values: ComparedMenuItemValue[]): Set<CompareFilter> => {
  const categories = new Set<CompareFilter>();
  const answers = values.filter(
    (v): v is NonNullable<ComparedMenuItemValue> => v !== null && v !== undefined
  );
  const everyoneAnswered = answers.length === values.length && values.length > 0;

  if (values.some((v) => v === null)) categories.add("missing");
  if (values.some((v) => v === undefined)) categories.add("unanswered");

  const someoneWants = answers.some((v) => WANTS.includes(v));
  const someoneRefuses = answers.includes("off-limits");
  if (someoneWants && someoneRefuses) categories.add("conflict");

  if (everyoneAnswered) {
    if (answers.every((v) => v === answers[0])) categories.add("agree");
    else if (!someoneRefuses || !someoneWants) categories.add("differ");
    if (answers.every((v) => WANTS.includes(v))) categories.add("both-want");
  }
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
