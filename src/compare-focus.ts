/**
 * Where people stand on each item, in one word (spec CP-30..CP-33). Every item gets
 * exactly one bucket, so counts always add up to the number of items and nothing is
 * shown twice. Built only on the verified predicates in src/answer-cells.ts.
 *
 * The buckets answer the question two people actually have after comparing: where do
 * we need to talk, what only needs a quick check, and where are we already aligned.
 */

import { ComparedMenuItemValue } from "./model/compare";
import { toCell } from "./compare-filters";
import { isAgree, isAllWant, isConflict, isMissing, isUnanswered } from "./answer-cells";

export type Bucket =
  | "conflict"
  | "talk"
  | "open"
  | "degree"
  | "shared-maybe"
  | "shared-want"
  | "shared-no";

/** The five groups the compare page shows and filters by. */
export type Zone = "conflict" | "talk" | "open" | "quick" | "aligned";

/** Filters on the compare page: a zone, everything, or items with notes. */
export type FocusFilter = "all" | Zone | "notes";

export const BUCKETS: Record<
  Bucket,
  { label: string; description: string; zone: Zone; minutes: number }
> = {
  conflict: {
    label: "Conflict",
    description: "Someone wants it and someone marked it Off limits",
    zone: "conflict",
    minutes: 6,
  },
  talk: {
    label: "Talk about it",
    description: "Your answers point different ways, but nobody ruled it out",
    zone: "talk",
    minutes: 4,
  },
  open: {
    label: "Not answered yet",
    description: "Someone hasn't answered it, or it isn't on everyone's menu",
    zone: "open",
    minutes: 2,
  },
  degree: {
    label: "Want it, different amounts",
    description: "Everyone wants it, some more than others (Must have and Like to have)",
    zone: "quick",
    minutes: 2,
  },
  "shared-maybe": {
    label: "Everyone's unsure",
    description: "Everyone answered Maybe",
    zone: "quick",
    minutes: 2,
  },
  "shared-want": {
    label: "Everyone wants it",
    description: "Everyone gave the same answer, and it's a yes",
    zone: "aligned",
    minutes: 2,
  },
  "shared-no": {
    label: "Shared limit",
    description: "Everyone marked it Off limits",
    zone: "aligned",
    minutes: 1,
  },
};

export const ZONES: { id: Zone; label: string; description: string }[] = [
  { id: "conflict", label: "Conflicts", description: BUCKETS.conflict.description },
  { id: "talk", label: "Talk about it", description: BUCKETS.talk.description },
  { id: "open", label: "Not answered", description: BUCKETS.open.description },
  {
    id: "quick",
    label: "Quick checks",
    description: "Everyone wants it but some more than others, or everyone said Maybe",
  },
  {
    id: "aligned",
    label: "Same page",
    description: "Everyone gave the same yes, or everyone marked it Off limits",
  },
];

/** Buckets in each zone, in display order. */
export const ZONE_BUCKETS: Record<Zone, Bucket[]> = {
  conflict: ["conflict"],
  talk: ["talk"],
  open: ["open"],
  quick: ["degree", "shared-maybe"],
  aligned: ["shared-want", "shared-no"],
};

export const FOCUS_FILTERS: { id: FocusFilter; label: string; description: string }[] = [
  { id: "all", label: "All", description: "Every item" },
  ...ZONES,
  { id: "notes", label: "With notes", description: "Someone wrote a note on it" },
];

/**
 * The one bucket an item belongs to. A conflict always counts as a conflict, even
 * if someone else hasn't answered; otherwise anything not answered by everyone is
 * "open"; the rest are split by whether answers match and whether everyone wants it.
 */
export const bucketOf = (values: ComparedMenuItemValue[]): Bucket => {
  const cells = values.map(toCell);
  if (isConflict(cells)) return "conflict";
  if (cells.length === 0 || isUnanswered(cells) || isMissing(cells)) return "open";
  if (isAgree(cells)) {
    if (cells[0] === "maybe") return "shared-maybe";
    if (cells[0] === "off-limits") return "shared-no";
    return "shared-want";
  }
  if (isAllWant(cells)) return "degree";
  return "talk";
};

export const zoneOf = (values: ComparedMenuItemValue[]): Zone => BUCKETS[bucketOf(values)].zone;

/** Whether anyone wrote a note on this item. */
export const hasNotes = (item: { notes?: (string | undefined)[] }) =>
  !!item.notes?.some((note) => typeof note === "string" && note.trim().length > 0);

export const matchesFocusFilter = (
  item: { values: ComparedMenuItemValue[]; notes?: (string | undefined)[] },
  filter: FocusFilter
): boolean => {
  if (filter === "all") return true;
  if (filter === "notes") return hasNotes(item);
  return zoneOf(item.values) === filter;
};
