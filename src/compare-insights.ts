/**
 * High-level insights about a comparison (spec §7, CP-20..CP-25): where people line
 * up, where they differ most, and how each person answered. Pure functions over the
 * output of compareMenus(), so they can be tested without rendering.
 */

import { ComparedMenuItem, ComparedMenuItemValue, MenuComparison } from "./model/compare";
import { CompareFilter, countByFilter, itemCategories } from "./compare-filters";
import { RelationshipMenuItemValue } from "./model/menu";

/** Answers in order from "no" to "yes", used to measure how far apart answers are. */
export const ANSWER_RANK: Record<RelationshipMenuItemValue, number> = {
  "off-limits": 0,
  maybe: 1,
  "like-to-have": 2,
  "must-have": 3,
};

const isAnswer = (v: ComparedMenuItemValue): v is RelationshipMenuItemValue =>
  typeof v === "string";

/**
 * How far apart the answers are, from 0 (same) to 3 (Must have vs Off limits), or
 * null when fewer than two people answered.
 */
export const answerGap = (values: ComparedMenuItemValue[]): number | null => {
  const ranks = values.filter(isAnswer).map((v) => ANSWER_RANK[v]);
  if (ranks.length < 2) return null;
  return Math.max(...ranks) - Math.min(...ranks);
};

/**
 * A sort key for "biggest differences first": conflicts above everything, then by
 * gap. Items nobody can be compared on yet (fewer than two answers) sort last.
 */
export const differenceScore = (values: ComparedMenuItemValue[]): number => {
  const gap = answerGap(values);
  if (gap === null) return -1;
  return (itemCategories(values).has("conflict") ? 10 : 0) + gap;
};

/** An item together with the group it's in. */
export type GroupedItem = ComparedMenuItem & { group: string };

/** Every item in menu order, with its group. */
export const flattenComparison = (comparison: MenuComparison): GroupedItem[] =>
  Object.entries(comparison).flatMap(([group, items]) => items.map((item) => ({ ...item, group })));

/** Items sorted by difference (largest first); ties keep menu order. */
export const byDifference = (items: GroupedItem[]): GroupedItem[] =>
  items
    .map((item, index) => ({ item, index, score: differenceScore(item.values) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);

/** Whether an item's text, group or any note contains `query` (ignoring case). */
export const matchesQuery = (item: GroupedItem, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.item, item.group, ...(item.notes ?? [])].some(
    (text) => typeof text === "string" && text.toLowerCase().includes(q)
  );
};

export type GroupSummary = {
  group: string;
  total: number;
  agree: number;
  bothWant: number;
  conflict: number;
  differ: number;
  /** Items not everyone has answered (unanswered or not on every menu). */
  open: number;
  /** Agreements among items everyone answered (0..1), or null if none were. */
  alignment: number | null;
};

export type PersonSummary = {
  mustHave: number;
  likeToHave: number;
  maybe: number;
  offLimits: number;
  unanswered: number;
  notOnMenu: number;
};

export type Insights = {
  counts: Record<CompareFilter, number>;
  /** Items everyone answered. */
  fullyAnswered: number;
  /** Agree ÷ fully answered (0..1), or null when nothing was fully answered. */
  alignment: number | null;
  byGroup: GroupSummary[];
  /** One entry per compared menu, in column order. */
  people: PersonSummary[];
  /** The largest differences (conflicts first), at most `topLimit`. */
  topDifferences: GroupedItem[];
};

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** Summarises a comparison of `menuCount` menus. */
export const compareInsights = (
  comparison: MenuComparison,
  menuCount: number,
  topLimit = 5
): Insights => {
  const items = flattenComparison(comparison);
  const counts = countByFilter(comparison);
  const isFull = (item: GroupedItem) => item.values.every(isAnswer) && item.values.length > 0;
  const fullyAnswered = items.filter(isFull).length;

  const byGroup = Object.entries(comparison).map(([group, groupItems]): GroupSummary => {
    const cats = groupItems.map((item) => itemCategories(item.values));
    const full = groupItems.filter((item) => item.values.every(isAnswer) && item.values.length > 0).length;
    const agree = cats.filter((c) => c.has("agree")).length;
    return {
      group,
      total: groupItems.length,
      agree,
      bothWant: cats.filter((c) => c.has("both-want")).length,
      conflict: cats.filter((c) => c.has("conflict")).length,
      differ: cats.filter((c) => c.has("differ")).length,
      open: cats.filter((c) => c.has("unanswered") || c.has("missing")).length,
      alignment: ratio(agree, full),
    };
  });

  const people: PersonSummary[] = Array.from({ length: menuCount }, (_, m) => {
    const person: PersonSummary = { mustHave: 0, likeToHave: 0, maybe: 0, offLimits: 0, unanswered: 0, notOnMenu: 0 };
    for (const item of items) {
      const v = item.values[m];
      if (v === null) person.notOnMenu++;
      else if (v === undefined) person.unanswered++;
      else if (v === "must-have") person.mustHave++;
      else if (v === "like-to-have") person.likeToHave++;
      else if (v === "maybe") person.maybe++;
      else person.offLimits++;
    }
    return person;
  });

  const topDifferences = byDifference(items)
    .filter((item) => (answerGap(item.values) ?? 0) > 0)
    .slice(0, topLimit);

  return {
    counts,
    fullyAnswered,
    alignment: ratio(counts.agree, fullyAnswered),
    byGroup,
    people,
    topDifferences,
  };
};
