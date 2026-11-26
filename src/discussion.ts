/**
 * A guided discussion of a comparison (spec §7b, DS-1..DS-8): an agenda of topics,
 * prompts for each, and the notes and outcomes people record. Pure functions; the
 * page stores the record in this browser only.
 *
 * The agenda is plain data on purpose, so it can later be prepared or enriched by an
 * AI assistant without changing the page.
 */

import { MenuComparison } from "./model/compare";
import { itemCategories } from "./compare-filters";
import { answerGap, flattenComparison, GroupedItem } from "./compare-insights";
import { itemId } from "./data-comparer";

/**
 * Kinds of topic, in agenda order: start with something you share, then differences,
 * then conflicts, then items not everyone has answered.
 */
export type TopicKind = "celebrate" | "explore" | "conflict" | "check-in";

export type Topic = GroupedItem & {
  /** Stable id for this item (normalised group + item text). */
  key: string;
  kind: TopicKind;
  prompts: string[];
};

export type Outcome = "agreed" | "compromise" | "revisit" | "agree-to-disagree" | "boundary";

export const OUTCOMES: { id: Outcome; label: string; hint: string }[] = [
  { id: "agreed", label: "Agreed", hint: "We're on the same page" },
  { id: "compromise", label: "Compromise", hint: "We found a middle ground" },
  { id: "revisit", label: "Revisit later", hint: "Not settled yet; come back to it" },
  { id: "agree-to-disagree", label: "Agree to disagree", hint: "Different views, and that's okay" },
  { id: "boundary", label: "Boundary", hint: "A firm limit we'll both respect" },
];

export const TOPIC_KINDS: Record<TopicKind, { label: string; intro: string }> = {
  celebrate: { label: "Shared ground", intro: "Something you both want. Start here." },
  explore: { label: "Talk about it", intro: "Your answers differ, but nobody ruled it out." },
  conflict: { label: "Conflict", intro: "Someone wants this and someone marked it Off limits." },
  "check-in": { label: "Check in", intro: "Not everyone has answered this yet." },
};

const PROMPTS: Record<TopicKind, string[]> = {
  celebrate: [
    "What does this look like for each of you, day to day?",
    "What's one way you could make more room for this?",
    "Why does this matter to you?",
    "Is there anything about this you've never said out loud?",
  ],
  explore: [
    "What does your answer mean to you? Describe it in your own words.",
    "What would make this feel more like a yes, or more comfortable, for you?",
    "Is there a version of this that would work for both of you?",
    "What's underneath your answer: a need, a worry, a past experience?",
    "How often, how much, or when would feel right?",
  ],
  conflict: [
    "Take turns: what's behind your answer? The other person only listens, then sums up what they heard.",
    "What are you worried would happen if it went the other way?",
    "Is this a firm limit for now, or something that could change with time or trust?",
    "What would respecting the 'no' look like, without the other person losing something important?",
    "Is there a smaller, related thing you could both say yes to?",
  ],
  "check-in": [
    "Would you like to answer this now, together?",
    "Is it unanswered because you're unsure, or because it doesn't apply?",
    "Should this be on both of your menus?",
  ],
};

/** Ground rules shown before the agenda. */
export const GROUND_RULES = [
  "Take turns. Whoever's speaking finishes before the other responds.",
  "Be curious, not persuasive. You're learning what the other person needs.",
  "Say \"I feel… / I need…\" rather than \"You always…\".",
  "Anyone can pause or skip a topic. Nothing has to be decided today.",
];

/** Small, stable string hash (FNV-1a), used to pick prompts and key records. */
export const hashString = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

/** `count` prompts for a topic, chosen deterministically from its key. */
export const promptsFor = (kind: TopicKind, key: string, count = 3): string[] => {
  const list = PROMPTS[kind];
  const start = hashString(key) % list.length;
  return Array.from({ length: Math.min(count, list.length) }, (_, i) => list[(start + i) % list.length]);
};

export const topicKey = (group: string, item: string) => `${itemId(group)}\u0000${itemId(item)}`;

const kindOf = (item: GroupedItem): TopicKind | null => {
  const c = itemCategories(item.values);
  if (c.has("conflict")) return "conflict";
  if (c.has("unanswered") || c.has("missing")) return "check-in";
  if (c.has("differ")) return "explore";
  if (c.has("both-want")) return "celebrate";
  return null; // agreed, and not something everyone wants: nothing to discuss
};

/**
 * The agenda: up to `maxCelebrate` shared wants (Must have first), then every
 * difference and every conflict (largest gap first), then items not everyone
 * answered. Agreed items that aren't shared wants are left out.
 */
export const buildAgenda = (comparison: MenuComparison, maxCelebrate = 2): Topic[] => {
  const items = flattenComparison(comparison).map((item, index) => ({ item, index, kind: kindOf(item) }));
  const ofKind = (kind: TopicKind) => items.filter((x) => x.kind === kind);
  const byGap = (a: (typeof items)[number], b: (typeof items)[number]) =>
    (answerGap(b.item.values) ?? 0) - (answerGap(a.item.values) ?? 0) || a.index - b.index;
  const mustCount = (x: (typeof items)[number]) => x.item.values.filter((v) => v === "must-have").length;

  const ordered = [
    ...ofKind("celebrate")
      .sort((a, b) => mustCount(b) - mustCount(a) || a.index - b.index)
      .slice(0, maxCelebrate),
    ...ofKind("explore").sort(byGap),
    ...ofKind("conflict").sort(byGap),
    ...ofKind("check-in"),
  ];
  return ordered.map(({ item, kind }) => {
    const key = topicKey(item.group, item.item);
    return { ...item, key, kind: kind!, prompts: promptsFor(kind!, key) };
  });
};

/** What people wrote down for one topic. */
export type TopicRecord = { note?: string; outcome?: Outcome; followUp?: string };

/** A discussion's notes, saved in this browser. */
export type DiscussionRecord = {
  version: 1;
  startedAt: number;
  updatedAt: number;
  topics: Record<string, TopicRecord>;
};

export const emptyRecord = (now: number): DiscussionRecord => ({
  version: 1,
  startedAt: now,
  updatedAt: now,
  topics: Object.create(null),
});

/** Whether a topic has anything recorded. */
export const isCovered = (record: TopicRecord | undefined) =>
  !!record && (!!record.outcome || !!record.note?.trim() || !!record.followUp?.trim());

/**
 * Storage key for a discussion between these people: stable when answers change,
 * so notes survive edits. Based on the menus' titles and names.
 */
export const discussionKey = (menus: { title: string; person?: { name?: string } }[]) =>
  `discussion:${hashString(
    menus
      .map((m) => `${m.person?.name ?? ""}\u0000${m.title}`)
      .sort()
      .join("\u0001")
  ).toString(36)}`;

export const loadDiscussion = (key: string): DiscussionRecord | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed.topics !== "object" || !parsed.topics) return null;
    const topics: Record<string, TopicRecord> = Object.create(null);
    for (const [k, v] of Object.entries(parsed.topics as Record<string, TopicRecord>)) {
      if (!v || typeof v !== "object") continue;
      const outcome = OUTCOMES.some((o) => o.id === v.outcome) ? v.outcome : undefined;
      topics[k] = {
        ...(typeof v.note === "string" ? { note: v.note } : {}),
        ...(outcome ? { outcome } : {}),
        ...(typeof v.followUp === "string" ? { followUp: v.followUp } : {}),
      };
    }
    return {
      version: 1,
      startedAt: Number(parsed.startedAt) || Date.now(),
      updatedAt: Number(parsed.updatedAt) || Date.now(),
      topics,
    };
  } catch {
    return null;
  }
};

export const saveDiscussion = (key: string, record: DiscussionRecord) => {
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch (e) {
    console.error("Couldn't save discussion notes:", e);
  }
};

const ANSWER_LABEL: Record<string, string> = {
  "must-have": "Must have",
  "like-to-have": "Like to have",
  maybe: "Maybe",
  "off-limits": "Off limits",
};

/** A plain-text (Markdown) summary of the discussion, for copying or saving. */
export const discussionSummary = (
  agenda: Topic[],
  record: DiscussionRecord,
  names: string[],
  date = new Date(record.updatedAt)
): string => {
  const lines = [
    `# Our relationship menu discussion`,
    ``,
    `${names.join(", ")} · ${date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`,
    ``,
  ];
  for (const outcome of [...OUTCOMES, { id: undefined, label: "Not settled yet", hint: "" }]) {
    const topics = agenda.filter(
      (t) => isCovered(record.topics[t.key]) && record.topics[t.key]?.outcome === outcome.id
    );
    if (topics.length === 0) continue;
    lines.push(`## ${outcome.label}`, ``);
    for (const t of topics) {
      const r = record.topics[t.key]!;
      const answers = t.values
        .map((v, i) => `${names[i] ?? `Menu ${i + 1}`}: ${v ? ANSWER_LABEL[v] : v === null ? "not on menu" : "no answer"}`)
        .join("; ");
      lines.push(`- **${t.item}** (${t.group}). ${answers}`);
      if (r.note?.trim()) lines.push(`  - Notes: ${r.note.trim().replace(/\s*\n\s*/g, " ")}`);
      if (r.followUp?.trim()) lines.push(`  - Next step: ${r.followUp.trim().replace(/\s*\n\s*/g, " ")}`);
    }
    lines.push(``);
  }
  const skipped = agenda.filter((t) => !isCovered(record.topics[t.key])).length;
  if (skipped > 0) lines.push(`_${skipped} topic${skipped === 1 ? "" : "s"} not discussed yet._`, ``);
  return lines.join("\n");
};
