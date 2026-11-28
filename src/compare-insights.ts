/**
 * High-level insights about a comparison (spec §7, CP-22, CP-24, CP-25, CP-30..CP-33):
 * where people need to talk, where they're aligned, and what matters most to each
 * person. Pure functions over the output of compareMenus(), so they can be tested
 * without rendering.
 */

import {
  ComparedMenuItem,
  ComparedMenuItemValue,
  MenuComparison,
} from "./model/compare";
import { itemCategories } from "./compare-filters";
import { RelationshipMenuItemValue } from "./model/menu";
import {
  BUCKETS,
  Bucket,
  Zone,
  bucketOf,
  hasNotes,
  zoneOf,
} from "./compare-focus";

/** Answers in order from "no" to "yes", used to measure how far apart answers are. */
export const ANSWER_RANK: Record<RelationshipMenuItemValue, number> = {
  "off-limits": 0,
  "soft-no": 1,
  maybe: 2,
  "like-to-have": 3,
  "must-have": 4,
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
  Object.entries(comparison).flatMap(([group, items]) =>
    items.map((item) => ({ ...item, group })),
  );

/** Items sorted by difference (largest first); ties keep menu order. */
export const byDifference = (items: GroupedItem[]): GroupedItem[] =>
  items
    .map((item, index) => ({
      item,
      index,
      score: differenceScore(item.values),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);

/** How far apart an item's answers are, for the bands of "biggest differences first" (CP-25). */
export type DifferenceBand =
  | "conflict"
  | "far"
  | "step"
  | "same"
  | "uncompared";

export const DIFFERENCE_BANDS: {
  id: DifferenceBand;
  label: string;
  description: string;
}[] = [
  {
    id: "conflict",
    label: "Conflicts",
    description: "Someone wants it and someone marked it Off limits",
  },
  {
    id: "far",
    label: "Far apart",
    description: "Answers two steps apart, like Must have and Maybe",
  },
  {
    id: "step",
    label: "One step apart",
    description: "Answers next to each other, like Must have and Like to have",
  },
  {
    id: "same",
    label: "Same answer",
    description: "Everyone who answered gave the same answer",
  },
  {
    id: "uncompared",
    label: "Can't compare yet",
    description: "Fewer than two people answered",
  },
];

/** The band an item falls in; bands follow `differenceScore`'s order. */
export const differenceBand = (
  values: ComparedMenuItemValue[],
): DifferenceBand => {
  const gap = answerGap(values);
  if (gap === null) return "uncompared";
  if (itemCategories(values).has("conflict")) return "conflict";
  return gap >= 2 ? "far" : gap === 1 ? "step" : "same";
};

/** Items sorted by difference and split into bands, leaving out empty bands. */
export const byDifferenceBands = (
  items: GroupedItem[],
): { band: (typeof DIFFERENCE_BANDS)[number]; items: GroupedItem[] }[] => {
  const sorted = byDifference(items);
  return DIFFERENCE_BANDS.map((band) => ({
    band,
    items: sorted.filter((item) => differenceBand(item.values) === band.id),
  })).filter(({ items }) => items.length > 0);
};

/** Whether an item's text, group or any note contains `query` (ignoring case). */
export const matchesQuery = (item: GroupedItem, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.item, item.group, ...(item.notes ?? [])].some(
    (text) => typeof text === "string" && text.toLowerCase().includes(q),
  );
};

export type GroupSummary = {
  group: string;
  total: number;
  /** How many of the group's items are in each zone; they add up to `total`. */
  zones: Record<Zone, number>;
  /** The verified filters' counts for this group (used by a conversation's area insights, CV-4). */
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
  /**
   * This person's Must haves that not everyone else wants: someone answered Maybe or
   * Off limits, didn't answer, or doesn't have it on their menu. In focus order.
   */
  mustNotShared: GroupedItem[];
  /** This person's Off limits that someone else wants. In focus order. */
  limitsWanted: GroupedItem[];
};

export type Insights = {
  total: number;
  /** Items in each bucket; they add up to `total` (CP-30). */
  buckets: Record<Bucket, number>;
  /** Items in each zone; they add up to `total`. */
  zones: Record<Zone, number>;
  /** Items someone wrote a note on. */
  withNotes: number;
  /** Every conflict, difference and open item, most important first (CP-32). */
  focus: GroupedItem[];
  /** Items everyone wants, those with more Must haves first. */
  sharedWants: GroupedItem[];
  /** Items everyone marked Off limits. */
  sharedLimits: GroupedItem[];
  byGroup: GroupSummary[];
  /** One entry per compared menu, in column order. */
  people: PersonSummary[];
};

const FOCUS_RANK: Partial<Record<Bucket, number>> = {
  conflict: 3,
  talk: 2,
  open: 1,
};

/**
 * Most important first: conflicts, then other differences, then items not everyone
 * answered; within each, the largest gap first, then items with notes (someone has
 * something to say), then menu order.
 */
export const byFocus = (items: GroupedItem[]): GroupedItem[] =>
  items
    .map((item, index) => ({
      item,
      index,
      rank: FOCUS_RANK[bucketOf(item.values)] ?? 0,
      gap: answerGap(item.values) ?? 0,
      notes: hasNotes(item) ? 1 : 0,
    }))
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        b.gap - a.gap ||
        b.notes - a.notes ||
        a.index - b.index,
    )
    .map(({ item }) => item);

const zero = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const BUCKET_IDS = Object.keys(BUCKETS) as Bucket[];
const ZONE_IDS: Zone[] = ["conflict", "talk", "open", "quick", "aligned"];

const wants = (v: ComparedMenuItemValue) =>
  v === "must-have" || v === "like-to-have";

/** Summarises a comparison of `menuCount` menus (spec CP-30..CP-33). */
export const compareInsights = (
  comparison: MenuComparison,
  menuCount: number,
): Insights => {
  const items = flattenComparison(comparison);
  const buckets = zero(BUCKET_IDS);
  const zones = zero(ZONE_IDS);
  for (const item of items) {
    const bucket = bucketOf(item.values);
    buckets[bucket]++;
    zones[BUCKETS[bucket].zone]++;
  }

  const byGroup = Object.entries(comparison).map(
    ([group, groupItems]): GroupSummary => {
      const counts = zero(ZONE_IDS);
      for (const item of groupItems) counts[zoneOf(item.values)]++;
      const cats = groupItems.map((item) => itemCategories(item.values));
      const full = groupItems.filter(
        (item) => item.values.length > 0 && item.values.every(isAnswer),
      ).length;
      const agree = cats.filter((c) => c.has("agree")).length;
      return {
        group,
        total: groupItems.length,
        zones: counts,
        agree,
        bothWant: cats.filter((c) => c.has("both-want")).length,
        conflict: cats.filter((c) => c.has("conflict")).length,
        differ: cats.filter((c) => c.has("differ")).length,
        open: cats.filter((c) => c.has("unanswered") || c.has("missing"))
          .length,
        alignment: full > 0 ? agree / full : null,
      };
    },
  );

  const focus = byFocus(
    items.filter((item) => FOCUS_RANK[bucketOf(item.values)] !== undefined),
  );
  const mustCount = (item: GroupedItem) =>
    item.values.filter((v) => v === "must-have").length;
  const sharedWants = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => bucketOf(item.values) === "shared-want")
    .sort((a, b) => mustCount(b.item) - mustCount(a.item) || a.index - b.index)
    .map(({ item }) => item);
  const sharedLimits = items.filter(
    (item) => bucketOf(item.values) === "shared-no",
  );

  const people: PersonSummary[] = Array.from({ length: menuCount }, (_, m) => {
    const person: PersonSummary = {
      mustHave: 0,
      likeToHave: 0,
      maybe: 0,
      offLimits: 0,
      unanswered: 0,
      notOnMenu: 0,
      mustNotShared: [],
      limitsWanted: [],
    };
    for (const item of items) {
      const v = item.values[m];
      if (v === null) person.notOnMenu++;
      else if (v === undefined) person.unanswered++;
      else if (v === "must-have") person.mustHave++;
      else if (v === "like-to-have") person.likeToHave++;
      else if (v === "maybe") person.maybe++;
      else person.offLimits++;
      const others = item.values.filter((_, i) => i !== m);
      if (v === "must-have" && others.some((o) => !wants(o)))
        person.mustNotShared.push(item);
      if (v === "off-limits" && others.some(wants))
        person.limitsWanted.push(item);
    }
    person.mustNotShared = byFocus(person.mustNotShared);
    person.limitsWanted = byFocus(person.limitsWanted);
    return person;
  });

  return {
    total: items.length,
    buckets,
    zones,
    withNotes: items.filter(hasNotes).length,
    focus,
    sharedWants,
    sharedLimits,
    byGroup,
    people,
  };
};
