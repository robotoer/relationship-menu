/**
 * Conversations (spec §7c, CV-1…): a saved comparison that people come back to over
 * several sittings. It holds the menus being compared, the agenda split into parts,
 * notes for each area (one set per person) and each topic, comments left for later,
 * and the AI coach's suggestions if anyone asked for them.
 *
 * It lives in this browser's storage and travels as a link (in the address's #hash,
 * which browsers never send to a server). Opening someone's link merges their copy
 * into yours, so two people can take turns adding to it without any server: that's
 * the "async" part. Pure functions; the pages do the saving.
 */

import { decodeData, encodeData } from "./data-encoder";
import { DecodedCompareSlug, decodeCompareSlug, normalizeCompareEntry } from "./compare-slug";
import { compareMenus } from "./data-comparer";
import { AgendaOptions, agendaFor, DEFAULT_AGENDA, discussionKey, hashString, OUTCOMES, Outcome, Topic, TOPIC_KINDS } from "./discussion";
import { BUCKETS, Bucket, bucketOf } from "./compare-focus";
import { loadSavedGuide, SavedCoachGuide } from "./coach";
import { newMenuId, MENU_ID_PATTERN } from "./menu-id";
import { compareInsights, GroupSummary } from "./compare-insights";
import { COMPARE_VALUE_LABELS, compareValueClass } from "./components/MenuItemCompare";

// ---- The record ----

/** A comment left on a topic or an area, for the others to read later. */
export type Comment = {
  id: string;
  /** Who wrote it: a column of the comparison (0 = first menu), or null if unknown. */
  by: number | null;
  text: string;
  at: number;
  /** Removed by its writer; kept (without text) so a merge doesn't bring it back. */
  deleted?: boolean;
};

/** What was said and decided about one topic (an item). */
export type TopicEntry = {
  note?: string;
  outcome?: Outcome;
  followUp?: string;
  /** When note, outcome or follow-up last changed (they merge together). */
  updatedAt: number;
  comments: Comment[];
};

/** One person's notes on an area, in three prompts (CV-5). */
export type PersonAreaNotes = {
  matters?: string;
  unsure?: string;
  helps?: string;
  updatedAt: number;
};

export const AREA_PROMPTS: { field: "matters" | "unsure" | "helps"; label: string; placeholder: string }[] = [
  { field: "matters", label: "What matters most to me here", placeholder: "e.g. Feeling chosen, time that's just ours" },
  { field: "unsure", label: "What I'm unsure or worried about", placeholder: "e.g. I'm not sure how often feels right yet" },
  { field: "helps", label: "What would help me", placeholder: "e.g. Talking about it before, not in the moment" },
];

/** Everything about one area (a group of the menu). */
export type AreaEntry = {
  /** Per person, keyed by column ("0", "1", …). */
  people: Record<string, PersonAreaNotes>;
  comments: Comment[];
};

/** A part of the conversation: some topics to talk through in one sitting (CV-3). */
export type Part = {
  id: string;
  order: number;
  title: string;
  topicKeys: string[];
  /** A date (YYYY-MM-DD) people picked for it, if any. */
  when?: string;
  done?: boolean;
  note?: string;
  updatedAt: number;
};

/** How notes from each person's menu show on a topic (CV-16). */
export type MenuNotesView = "show" | "highlight" | "hide";

/**
 * How this conversation is set up (CV-15…CV-17): what's on the agenda, in which
 * order, how menu notes show, and whether suggested questions do. Shared by
 * everyone: it travels in the conversation's link, and the newer change wins.
 */
export type ConversationSettings = AgendaOptions & {
  menuNotes: MenuNotesView;
  prompts: boolean;
  updatedAt: number;
};

export const DEFAULT_SETTINGS: Omit<ConversationSettings, "updatedAt"> = {
  ...DEFAULT_AGENDA,
  menuNotes: "show",
  prompts: true,
};

/** A conversation's settings, or the defaults (the agenda it has always had). */
export const settingsOf = (c: Pick<Conversation, "settings">): ConversationSettings =>
  c.settings ?? { ...DEFAULT_SETTINGS, updatedAt: 0 };

/** One compared menu: its link slug, and when it was last replaced. */
export type MenuSlot = { slug: string; updatedAt: number };

export type Conversation = {
  kind: "conversation";
  version: 1;
  /** Random, like menu ids; the same in every copy of this conversation. */
  id: string;
  title: string;
  titleUpdatedAt: number;
  createdAt: number;
  updatedAt: number;
  menus: MenuSlot[];
  parts: Part[];
  topics: Record<string, TopicEntry>;
  areas: Record<string, AreaEntry>;
  coach?: SavedCoachGuide;
  /** Absent until someone changes a setting. */
  settings?: ConversationSettings;
};

const dict = <T>(): Record<string, T> => Object.create(null);

// ---- Limits (also applied to links from other people, CV-9) ----

export const CONVERSATION_LIMITS = {
  title: 120,
  note: 4000,
  followUp: 400,
  partTitle: 120,
  comment: 1000,
  commentsPerTarget: 300,
  parts: 60,
  menus: 8,
  topicKeys: 400,
};

const text = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;
const time = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const isId = (v: unknown): v is string => typeof v === "string" && MENU_ID_PATTERN.test(v);

// ---- Making one ----

/** The names in a comparison: each menu's person, else its title. */
export const menuNames = (menus: DecodedCompareSlug[]) =>
  menus.map((d) => d.person?.name || d.title || "Untitled menu");

/** The menus that decode, in order. */
export const decodedMenus = (c: Pick<Conversation, "menus">): DecodedCompareSlug[] =>
  c.menus.map((m) => decodeCompareSlug(m.slug)).filter((d): d is DecodedCompareSlug => d !== null);

/** The agenda for a conversation's current menus and settings (CV-15). */
export const conversationAgenda = (c: Pick<Conversation, "menus" | "settings">): Topic[] => {
  const menus = decodedMenus(c);
  return menus.length >= 2 ? agendaFor(compareMenus(menus.map((d) => d.menu)), settingsOf(c)) : [];
};

/** A new conversation about these menu slugs (or links). */
export const newConversation = (entries: string[], now = Date.now(), id = newMenuId()): Conversation => {
  const slugs = entries.map(normalizeCompareEntry).filter((e) => decodeCompareSlug(e) !== null);
  const names = menuNames(slugs.map((s) => decodeCompareSlug(s)!));
  return {
    kind: "conversation",
    version: 1,
    id,
    title: names.join(" & ").slice(0, CONVERSATION_LIMITS.title),
    titleUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    menus: slugs.slice(0, CONVERSATION_LIMITS.menus).map((slug) => ({ slug, updatedAt: now })),
    parts: [],
    topics: dict(),
    areas: dict(),
  };
};

/** Which saved conversation a set of menus belongs to: the same people and titles (CV-2). */
export const matchKeyFor = (menus: DecodedCompareSlug[]) => discussionKey(menus);
export const matchKey = (c: Pick<Conversation, "menus">) => matchKeyFor(decodedMenus(c));

// ---- Reading untrusted data (storage, other people's links) ----

const parseComments = (raw: unknown): Comment[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Comment[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object" || !isId(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    const by = Number.isInteger(c.by) && c.by >= 0 && c.by < CONVERSATION_LIMITS.menus ? c.by : null;
    if (c.deleted === true) out.push({ id: c.id, by, text: "", at: time(c.at), deleted: true });
    else {
      const t = text(c.text, CONVERSATION_LIMITS.comment);
      if (t) out.push({ id: c.id, by, text: t, at: time(c.at) });
    }
  }
  return sortComments(out).slice(-CONVERSATION_LIMITS.commentsPerTarget);
};

const sortComments = (list: Comment[]) => [...list].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));

const parseTopic = (raw: unknown): TopicEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const outcome = OUTCOMES.some((o) => o.id === v.outcome) ? (v.outcome as Outcome) : undefined;
  const note = text(v.note, CONVERSATION_LIMITS.note);
  const followUp = text(v.followUp, CONVERSATION_LIMITS.followUp);
  return {
    ...(note ? { note } : {}),
    ...(outcome ? { outcome } : {}),
    ...(followUp ? { followUp } : {}),
    updatedAt: time(v.updatedAt),
    comments: parseComments(v.comments),
  };
};

const parseArea = (raw: unknown): AreaEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const people = dict<PersonAreaNotes>();
  if (v.people && typeof v.people === "object") {
    for (const [k, p] of Object.entries(v.people as Record<string, unknown>)) {
      if (!/^[0-7]$/.test(k) || !p || typeof p !== "object") continue;
      const n = p as Record<string, unknown>;
      const notes: PersonAreaNotes = { updatedAt: time(n.updatedAt) };
      for (const { field } of AREA_PROMPTS) {
        const t = text(n[field], CONVERSATION_LIMITS.note);
        if (t) notes[field] = t;
      }
      people[k] = notes;
    }
  }
  return { people, comments: parseComments(v.comments) };
};

const parsePart = (raw: unknown): Part | null => {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (!isId(v.id)) return null;
  const keys = Array.isArray(v.topicKeys)
    ? [...new Set(v.topicKeys.filter((k): k is string => typeof k === "string" && k.length <= 400))].slice(
        0,
        CONVERSATION_LIMITS.topicKeys
      )
    : [];
  const when = typeof v.when === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.when) ? v.when : undefined;
  const note = text(v.note, CONVERSATION_LIMITS.note);
  return {
    id: v.id,
    order: typeof v.order === "number" && Number.isFinite(v.order) ? v.order : 0,
    title: text(v.title, CONVERSATION_LIMITS.partTitle) ?? "Part",
    topicKeys: keys,
    ...(when ? { when } : {}),
    ...(v.done === true ? { done: true } : {}),
    ...(note ? { note } : {}),
    updatedAt: time(v.updatedAt),
  };
};

const BUCKET_IDS = Object.keys(BUCKETS) as Bucket[];

const parseSettings = (raw: unknown): ConversationSettings | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  const include = { ...DEFAULT_SETTINGS.include };
  if (v.include && typeof v.include === "object") {
    for (const b of BUCKET_IDS) {
      const on = (v.include as Record<string, unknown>)[b];
      if (typeof on === "boolean") include[b] = on;
    }
  }
  const warmUp = typeof v.warmUp === "number" && Number.isFinite(v.warmUp) ? Math.max(0, Math.min(5, Math.floor(v.warmUp))) : DEFAULT_SETTINGS.warmUp;
  return {
    include,
    warmUp,
    order: v.order === "hardest" ? "hardest" : "gentle",
    menuNotes: v.menuNotes === "highlight" || v.menuNotes === "hide" ? v.menuNotes : "show",
    prompts: typeof v.prompts === "boolean" ? v.prompts : true,
    updatedAt: time(v.updatedAt),
  };
};

/** A conversation from storage or a link, cleaned up; null if it isn't one (CV-9). */
export const parseConversation = (raw: unknown): Conversation | null => {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (v.kind !== "conversation" || v.version !== 1 || !isId(v.id)) return null;
  const menus = Array.isArray(v.menus)
    ? v.menus
        .filter((m): m is MenuSlot => !!m && typeof m === "object" && typeof (m as MenuSlot).slug === "string")
        .filter((m) => m.slug.length < 200_000 && decodeCompareSlug(m.slug) !== null)
        .slice(0, CONVERSATION_LIMITS.menus)
        .map((m) => ({ slug: m.slug, updatedAt: time(m.updatedAt) }))
    : [];
  if (menus.length < 2) return null;
  const topics = dict<TopicEntry>();
  for (const [k, t] of Object.entries((v.topics as Record<string, unknown>) ?? {})) {
    const parsed = k.length <= 400 ? parseTopic(t) : null;
    if (parsed) topics[k] = parsed;
  }
  const areas = dict<AreaEntry>();
  for (const [k, a] of Object.entries((v.areas as Record<string, unknown>) ?? {})) {
    const parsed = k.length <= 400 ? parseArea(a) : null;
    if (parsed) areas[k] = parsed;
  }
  const seenParts = new Set<string>();
  const parts = (Array.isArray(v.parts) ? v.parts : [])
    .map(parsePart)
    .filter((p): p is Part => p !== null && !seenParts.has(p.id) && (seenParts.add(p.id), true))
    .slice(0, CONVERSATION_LIMITS.parts);
  const coach = loadSavedGuide(v.coach);
  const settings = parseSettings(v.settings);
  const createdAt = time(v.createdAt);
  return {
    kind: "conversation",
    version: 1,
    id: v.id,
    title: text(v.title, CONVERSATION_LIMITS.title) ?? "Conversation",
    titleUpdatedAt: time(v.titleUpdatedAt),
    createdAt,
    updatedAt: Math.max(createdAt, time(v.updatedAt)),
    menus,
    parts: sortParts(parts),
    topics,
    areas,
    ...(coach ? { coach } : {}),
    ...(settings ? { settings } : {}),
  };
};

const sortParts = (parts: Part[]) => [...parts].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

// ---- Merging two copies (CV-8) ----

/** JSON with keys sorted, so equal values always compare equal (for tie-breaks). */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v
  );

/** The later of two values by time; on a tie, a fixed choice so both sides agree. */
const later = <T extends { updatedAt: number }>(a: T | undefined, b: T | undefined): T | undefined => {
  if (!a) return b;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return canonical(a) >= canonical(b) ? a : b;
};

/** Every comment from both sides; a deletion on either side wins. */
const mergeComments = (a: Comment[], b: Comment[]): Comment[] => {
  const byId = new Map<string, Comment>();
  for (const c of [...a, ...b]) {
    const prev = byId.get(c.id);
    if (!prev) byId.set(c.id, c);
    else if (c.deleted && !prev.deleted) byId.set(c.id, c);
    else if (!!c.deleted === !!prev.deleted && canonical(c) > canonical(prev)) byId.set(c.id, c);
  }
  return sortComments([...byId.values()]).slice(-CONVERSATION_LIMITS.commentsPerTarget);
};

const mergeMaps = <T>(a: Record<string, T>, b: Record<string, T>, merge: (x?: T, y?: T) => T) => {
  const out = dict<T>();
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = merge(a[k], b[k]);
  return out;
};

const fieldsOf = ({ comments: _c, ...rest }: TopicEntry) => rest;

/**
 * Two copies of the same conversation combined: for each menu, part, topic and
 * person's area notes, the most recently changed version wins; comments from both
 * are kept. The same result whichever order they're merged in, and merging again
 * changes nothing.
 */
export const mergeConversations = (a: Conversation, b: Conversation): Conversation => {
  if (a.id !== b.id) throw new Error("Not the same conversation");
  const title = later({ updatedAt: a.titleUpdatedAt, t: a.title }, { updatedAt: b.titleUpdatedAt, t: b.title })!;
  const menus = Array.from({ length: Math.max(a.menus.length, b.menus.length) }, (_, i) => later(a.menus[i], b.menus[i])!);
  const parts = mergeMaps(
    Object.fromEntries(a.parts.map((p) => [p.id, p])),
    Object.fromEntries(b.parts.map((p) => [p.id, p])),
    (x, y) => later(x, y)!
  );
  const topics = mergeMaps(a.topics, b.topics, (x, y) => {
    if (!x || !y) return (x ?? y)!;
    const fields = later({ ...fieldsOf(x) }, { ...fieldsOf(y) })!;
    return { ...fields, comments: mergeComments(x.comments, y.comments) };
  });
  const areas = mergeMaps(a.areas, b.areas, (x, y) => {
    if (!x || !y) return (x ?? y)!;
    return { people: mergeMaps(x.people, y.people, (p, q) => later(p, q)!), comments: mergeComments(x.comments, y.comments) };
  });
  const coach =
    a.coach && b.coach
      ? later({ ...a.coach, updatedAt: a.coach.createdAt }, { ...b.coach, updatedAt: b.coach.createdAt })!
      : a.coach ?? b.coach;
  const { updatedAt: _u, ...coachFields } = (coach ?? {}) as SavedCoachGuide & { updatedAt?: number };
  const settings = later(a.settings, b.settings);
  return {
    kind: "conversation",
    version: 1,
    id: a.id,
    title: title.t,
    titleUpdatedAt: title.updatedAt,
    createdAt: Math.min(a.createdAt, b.createdAt),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    menus,
    parts: sortParts(Object.values(parts)),
    topics,
    areas,
    ...(coach ? { coach: coachFields as SavedCoachGuide } : {}),
    ...(settings ? { settings } : {}),
  };
};

/** What a merge brought in: comments and notes that weren't in `before`. */
export const mergeNews = (before: Conversation, after: Conversation) => {
  const ids = (c: Conversation) =>
    new Set(
      [...Object.values(c.topics), ...Object.values(c.areas)].flatMap((t) => t.comments.filter((x) => !x.deleted).map((x) => x.id))
    );
  const had = ids(before);
  const comments = [...ids(after)].filter((id) => !had.has(id)).length;
  let notes = 0;
  for (const [k, t] of Object.entries(after.topics)) if (t.updatedAt > (before.topics[k]?.updatedAt ?? 0)) notes++;
  for (const [k, a] of Object.entries(after.areas))
    for (const [p, n] of Object.entries(a.people)) if (n.updatedAt > (before.areas[k]?.people[p]?.updatedAt ?? 0)) notes++;
  const menus = after.menus.filter((m, i) => m.updatedAt > (before.menus[i]?.updatedAt ?? 0)).length;
  return { comments, notes, menus };
};

// ---- Changing it (each returns a new conversation) ----

const touch = (c: Conversation, now: number, change: Partial<Conversation>): Conversation => ({
  ...c,
  ...change,
  updatedAt: Math.max(now, c.updatedAt),
});

/** How many of the conversation's items are in each bucket, for the settings (CV-15). */
export const bucketCounts = (c: Pick<Conversation, "menus">): Record<Bucket, number> => {
  const counts = Object.fromEntries(BUCKET_IDS.map((k) => [k, 0])) as Record<Bucket, number>;
  const menus = decodedMenus(c);
  if (menus.length < 2) return counts;
  for (const group of Object.values(compareMenus(menus.map((d) => d.menu)))) {
    for (const item of group) counts[bucketOf(item.values)]++;
  }
  return counts;
};

/** Changes some settings (CV-15…CV-17). */
export const updateSettings = (
  c: Conversation,
  change: Partial<Omit<ConversationSettings, "updatedAt">>,
  now = Date.now()
): Conversation => touch(c, now, { settings: { ...settingsOf(c), ...change, updatedAt: now } });

export const setTitle = (c: Conversation, title: string, now = Date.now()) =>
  touch(c, now, { title: title.slice(0, CONVERSATION_LIMITS.title), titleUpdatedAt: now });

export const updateTopic = (
  c: Conversation,
  key: string,
  change: Partial<Pick<TopicEntry, "note" | "outcome" | "followUp">>,
  now = Date.now()
) => {
  const topics = Object.assign(dict<TopicEntry>(), c.topics);
  const prev = topics[key] ?? { updatedAt: 0, comments: [] };
  topics[key] = { ...prev, ...change, updatedAt: now };
  return touch(c, now, { topics });
};

export const updateAreaNotes = (
  c: Conversation,
  area: string,
  person: number,
  change: Partial<Omit<PersonAreaNotes, "updatedAt">>,
  now = Date.now()
) => {
  const areas = Object.assign(dict<AreaEntry>(), c.areas);
  const prev = areas[area] ?? { people: dict<PersonAreaNotes>(), comments: [] };
  const people = Object.assign(dict<PersonAreaNotes>(), prev.people);
  people[String(person)] = { ...people[String(person)], ...change, updatedAt: now };
  areas[area] = { ...prev, people };
  return touch(c, now, { areas });
};

/** Where a comment goes: a topic (by key) or an area (by group name). */
export type CommentTarget = { topic: string } | { area: string };

const withComments = (c: Conversation, target: CommentTarget, edit: (list: Comment[]) => Comment[], now: number) => {
  if ("topic" in target) {
    const topics = Object.assign(dict<TopicEntry>(), c.topics);
    const prev = topics[target.topic] ?? { updatedAt: 0, comments: [] };
    topics[target.topic] = { ...prev, comments: edit(prev.comments) };
    return touch(c, now, { topics });
  }
  const areas = Object.assign(dict<AreaEntry>(), c.areas);
  const prev = areas[target.area] ?? { people: dict<PersonAreaNotes>(), comments: [] };
  areas[target.area] = { ...prev, comments: edit(prev.comments) };
  return touch(c, now, { areas });
};

export const addComment = (
  c: Conversation,
  target: CommentTarget,
  by: number | null,
  body: string,
  now = Date.now(),
  id = newMenuId()
) => {
  const t = body.trim().slice(0, CONVERSATION_LIMITS.comment);
  if (!t) return c;
  return withComments(c, target, (list) => [...list, { id, by, text: t, at: now }].slice(-CONVERSATION_LIMITS.commentsPerTarget), now);
};

export const deleteComment = (c: Conversation, target: CommentTarget, id: string, now = Date.now()) =>
  withComments(c, target, (list) => list.map((x) => (x.id === id ? { id: x.id, by: x.by, text: "", at: x.at, deleted: true } : x)), now);

export const commentsFor = (c: Conversation, target: CommentTarget): Comment[] =>
  ("topic" in target ? c.topics[target.topic]?.comments : c.areas[target.area]?.comments) ?? [];

export const setParts = (c: Conversation, parts: Part[], now = Date.now()) => touch(c, now, { parts: sortParts(parts) });

export const updatePart = (c: Conversation, id: string, change: Partial<Omit<Part, "id">>, now = Date.now()) =>
  setParts(c, c.parts.map((p) => (p.id === id ? { ...p, ...change, updatedAt: now } : p)), now);

/** Moves a topic to another part (out of whichever part had it). */
export const moveTopic = (c: Conversation, key: string, toPart: string, now = Date.now()) =>
  setParts(
    c,
    c.parts.map((p) => {
      const has = p.topicKeys.includes(key);
      if (p.id === toPart && !has) return { ...p, topicKeys: [...p.topicKeys, key], updatedAt: now };
      if (p.id !== toPart && has) return { ...p, topicKeys: p.topicKeys.filter((k) => k !== key), updatedAt: now };
      return p;
    }),
    now
  );

/** Replaces one menu (a newer version of the same person's menu, CV-7). */
export const replaceMenu = (c: Conversation, index: number, slug: string, now = Date.now()) => {
  if (!decodeCompareSlug(slug) || index < 0 || index >= c.menus.length) return c;
  const menus = c.menus.map((m, i) => (i === index ? { slug: normalizeCompareEntry(slug), updatedAt: now } : m));
  return touch(c, now, { menus });
};

export const saveCoachGuide = (c: Conversation, guide: SavedCoachGuide, now = Date.now()) => touch(c, now, { coach: guide });

// ---- Splitting the agenda into parts (CV-3) ----

/**
 * The agenda in parts of at most `perPart` topics, keeping each area together where
 * it fits. Areas go easiest first (most shared, fewest conflicts), as in the agenda,
 * or hardest first when the conversation is set up that way (CV-17).
 */
export const suggestParts = (
  agenda: Topic[],
  perPart = 6,
  now = Date.now(),
  makeId = newMenuId,
  order: AgendaOptions["order"] = "gentle"
): Part[] => {
  const areas: { group: string; topics: Topic[]; hardness: number; first: number }[] = [];
  agenda.forEach((t, i) => {
    let area = areas.find((a) => a.group === t.group);
    if (!area) areas.push((area = { group: t.group, topics: [], hardness: 0, first: i }));
    area.topics.push(t);
    area.hardness += t.kind === "conflict" ? 3 : t.kind === "explore" ? 1 : t.kind === "check-in" ? 0.5 : 0;
  });
  const sign = order === "hardest" ? -1 : 1;
  areas.sort((a, b) => sign * (a.hardness / a.topics.length - b.hardness / b.topics.length) || a.first - b.first);

  const parts: { groups: string[]; keys: string[] }[] = [];
  for (const area of areas) {
    for (let i = 0; i < area.topics.length; i += perPart) {
      const chunk = area.topics.slice(i, i + perPart).map((t) => t.key);
      const last = parts[parts.length - 1];
      if (last && i === 0 && last.keys.length + chunk.length <= perPart) {
        last.keys.push(...chunk);
        last.groups.push(area.group);
      } else parts.push({ groups: [area.group], keys: chunk });
    }
  }
  return parts.map((p, i) => ({
    id: makeId(),
    order: i,
    title: p.groups.join(", ").slice(0, CONVERSATION_LIMITS.partTitle),
    topicKeys: p.keys,
    updatedAt: now,
  }));
};

/**
 * The parts with the current agenda's topics: keys no longer in the agenda (menus
 * changed) are left out, and topics in no part go into a final "Not planned yet".
 */
export const partsWithTopics = (parts: Part[], agenda: Topic[]): { part: Part | null; topics: Topic[] }[] => {
  const byKey = new Map(agenda.map((t) => [t.key, t]));
  const placed = new Set<string>();
  const out: { part: Part | null; topics: Topic[] }[] = parts.map((part) => {
    const topics = part.topicKeys.map((k) => byKey.get(k)).filter((t): t is Topic => !!t && !placed.has(t.key));
    topics.forEach((t) => placed.add(t.key));
    return { part, topics };
  });
  const rest = agenda.filter((t) => !placed.has(t.key));
  if (rest.length > 0) out.push({ part: null, topics: rest });
  return out;
};

/** Minutes to set aside for some topics: about four each, at least ten. */
export const minutesFor = (topicCount: number) => Math.max(10, topicCount * 4);

// ---- Insights about an area (CV-4) ----

/** Plain sentences about how an area's answers line up. No verdicts, just counts. */
export const areaInsights = (summary: GroupSummary, topics: Topic[], names: string[]): string[] => {
  const lines: string[] = [];
  const answered = summary.total - summary.open;
  if (summary.alignment !== null) {
    lines.push(`You agree on ${summary.agree} of the ${answered} item${answered === 1 ? "" : "s"} everyone answered here.`);
  }
  if (summary.bothWant > 0) lines.push(`${summary.bothWant} shared want${summary.bothWant === 1 ? "" : "s"}: a good place to start.`);
  const conflicts = topics.filter((t) => t.kind === "conflict");
  if (conflicts.length > 0) {
    lines.push(
      `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} (someone marked it Off limits): ${conflicts
        .map((t) => t.item)
        .slice(0, 3)
        .join(", ")}${conflicts.length > 3 ? "…" : ""}. Off limits is a complete answer; talk about what's behind it, not whether to change it.`
    );
  }
  const explore = topics.filter((t) => t.kind === "explore");
  if (explore.length > 0) {
    lines.push(`${explore.length} difference${explore.length === 1 ? "" : "s"} where nobody said no, worth exploring.`);
  }
  if (summary.open > 0) lines.push(`${summary.open} item${summary.open === 1 ? " isn't" : "s aren't"} answered by everyone yet.`);
  // Who cares most about this area: Must haves per person.
  const musts = names.map((_, i) => topics.filter((t) => t.values[i] === "must-have").length);
  const max = Math.max(0, ...musts);
  if (max > 0 && musts.filter((m) => m === max).length === 1 && names.length > 1) {
    lines.push(`${names[musts.indexOf(max)]} has the most Must haves in this area (${max}).`);
  }
  return lines;
};

/** Each area of the agenda with its summary, in agenda order. */
export const agendaAreas = (c: Pick<Conversation, "menus">, agenda: Topic[]) => {
  const menus = decodedMenus(c);
  const insights = compareInsights(compareMenus(menus.map((d) => d.menu)), menus.length);
  const groups = [...new Set(agenda.map((t) => t.group))];
  return groups.map((group) => ({
    group,
    summary: insights.byGroup.find((g) => g.group === group)!,
    topics: agenda.filter((t) => t.group === group),
  }));
};

// ---- Storage (this browser) ----

export const CONVERSATION_PREFIX = "conversation:";
export const conversationKey = (id: string) => `${CONVERSATION_PREFIX}${id}`;

export const loadConversation = (id: string): Conversation | null => {
  try {
    const raw = localStorage.getItem(conversationKey(id));
    return raw ? parseConversation(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

/** Saves a conversation; false if storage refused. */
export const saveConversation = (c: Conversation): boolean => {
  try {
    localStorage.setItem(conversationKey(c.id), JSON.stringify(c));
    return true;
  } catch (e) {
    console.error("Couldn't save the conversation:", e);
    return false;
  }
};

export const deleteConversation = (id: string) => {
  try {
    localStorage.removeItem(conversationKey(id));
    localStorage.removeItem(`${ME_PREFIX}${id}`);
    localStorage.removeItem(`${SEEN_PREFIX}${id}`);
  } catch {
    // Nothing to do.
  }
};

/** Every saved conversation, most recently changed first. */
export const listConversations = (): Conversation[] => {
  const out: Conversation[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(CONVERSATION_PREFIX)) continue;
      const c = loadConversation(key.slice(CONVERSATION_PREFIX.length));
      if (c) out.push(c);
    }
  } catch {
    // Storage unavailable: no conversations.
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
};

/** The saved conversation about these menus' people and titles, if any (CV-2). */
export const findConversation = (menus: DecodedCompareSlug[]): Conversation | null => {
  const key = matchKeyFor(menus);
  return listConversations().find((c) => matchKey(c) === key) ?? null;
};

/**
 * Notes from before conversations existed (`discussion:<hash>`, spec DS-5), moved
 * into a conversation for the same menus. The old entry is removed only after the
 * conversation is saved (CV-10).
 */
export const adoptOldDiscussion = (c: Conversation, now = Date.now()): Conversation => {
  const menus = decodedMenus(c);
  const oldKey = discussionKey(menus);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(oldKey);
  } catch {
    return c;
  }
  if (!raw) return c;
  try {
    const old = JSON.parse(raw);
    if (old?.version !== 1 || typeof old.topics !== "object") return c;
    let next = c;
    for (const [key, t] of Object.entries(old.topics as Record<string, Record<string, unknown>>)) {
      const entry = parseTopic({ ...t, updatedAt: old.updatedAt ?? now });
      if (!entry) continue;
      const { comments: _c, updatedAt: _u, ...fields } = entry;
      if (Object.keys(fields).length > 0) next = updateTopic(next, key, fields, time(old.updatedAt) || now);
    }
    const coach = loadSavedGuide(old.coach);
    if (coach && !next.coach) next = { ...next, coach };
    if (saveConversation(next)) localStorage.removeItem(oldKey);
    return next;
  } catch {
    return c;
  }
};

// ---- Who's using this device, and what they've seen (never shared) ----

const ME_PREFIX = "conversation-me:";
const SEEN_PREFIX = "conversation-seen:";

export const loadMe = (id: string): number | null => {
  try {
    const v = Number(localStorage.getItem(`${ME_PREFIX}${id}`));
    return localStorage.getItem(`${ME_PREFIX}${id}`) !== null && Number.isInteger(v) && v >= 0 ? v : null;
  } catch {
    return null;
  }
};

export const saveMe = (id: string, person: number | null) => {
  try {
    if (person === null) localStorage.removeItem(`${ME_PREFIX}${id}`);
    else localStorage.setItem(`${ME_PREFIX}${id}`, String(person));
  } catch {
    // Not remembered; they'll be asked again.
  }
};

/** When this device last looked at the conversation (for "new" marks, CV-11). */
export const loadSeen = (id: string): number => {
  try {
    return Number(localStorage.getItem(`${SEEN_PREFIX}${id}`)) || 0;
  } catch {
    return 0;
  }
};

export const saveSeen = (id: string, at: number) => {
  try {
    localStorage.setItem(`${SEEN_PREFIX}${id}`, String(at));
  } catch {
    // Fine: things just stay marked new.
  }
};

/** Comments someone else left since this device last looked. */
export const unreadComments = (c: Conversation, me: number | null, seen: number) =>
  [...Object.values(c.topics), ...Object.values(c.areas)]
    .flatMap((t) => t.comments)
    .filter((x) => !x.deleted && x.at > seen && (me === null || x.by !== me)).length;

// ---- Links (CV-6) ----

/**
 * The link to a conversation. Everything is in the #hash, which browsers keep to
 * themselves: it never reaches our server or its logs, nor analytics.
 */
export const conversationLink = (origin: string, c: Conversation) => `${origin}/talk#c=${encodeData(c)}`;

/** The conversation in a link, an address hash (`#c=…`) or the bare payload; null if none. */
export const conversationFromLink = (value: string): Conversation | null => {
  const hash = value.includes("#") ? value.slice(value.indexOf("#") + 1) : value;
  const payload = new URLSearchParams(hash).get("c") ?? (hash.startsWith("c=") ? hash.slice(2) : null);
  if (!payload) return null;
  try {
    return parseConversation(decodeData(payload.replace(/ /g, "+")));
  } catch {
    return null;
  }
};

/** A short fingerprint of a conversation's content (for "already up to date"). */
export const conversationVersion = (c: Conversation) => hashString(JSON.stringify(c)).toString(36);

// ---- Summary (CV-12) ----

const answerText = (v: Topic["values"][number]) =>
  v ? COMPARE_VALUE_LABELS[compareValueClass(v)] : v === null ? "not on menu" : "no answer";

/** The whole conversation as Markdown: parts, area notes, topics and comments. */
export const conversationSummary = (c: Conversation, agenda: Topic[], names: string[], date = new Date(c.updatedAt)) => {
  const who = (by: number | null) => (by === null ? "Someone" : names[by] ?? `Person ${by + 1}`);
  const flat = (s: string) => s.trim().replace(/\s*\n\s*/g, " ");
  const lines = [
    `# ${c.title || "Our relationship menu conversation"}`,
    ``,
    `${names.join(", ")} · ${date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`,
    ``,
  ];
  // Where you landed, by outcome (as in DS-7), then everything by part and area.
  for (const outcome of [...OUTCOMES, { id: undefined, label: "Not settled yet" }]) {
    const topics = agenda.filter((t) => {
      const r = c.topics[t.key];
      const covered = !!r && (!!r.outcome || !!r.note?.trim() || !!r.followUp?.trim());
      return covered && r!.outcome === outcome.id;
    });
    if (topics.length === 0) continue;
    lines.push(`## ${outcome.label}`, ``);
    for (const t of topics) {
      const r = c.topics[t.key]!;
      lines.push(`- **${t.item}** (${t.group})${r.followUp?.trim() ? `. Next step: ${flat(r.followUp)}` : ""}`);
    }
    lines.push(``);
  }
  lines.push(`---`, ``);
  const parts = partsWithTopics(c.parts, agenda);
  parts.forEach(({ part, topics }, i) => {
    lines.push(`## ${part ? `Part ${i + 1}: ${part.title}` : "Not planned yet"}${part?.done ? " (done)" : ""}`, ``);
    if (part?.when) lines.push(`_Planned for ${part.when}_`, ``);
    if (part?.note?.trim()) lines.push(flat(part.note), ``);
    for (const group of [...new Set(topics.map((t) => t.group))]) {
      lines.push(`### ${group}`, ``);
      const area = c.areas[group];
      for (const [p, n] of Object.entries(area?.people ?? {})) {
        const said = AREA_PROMPTS.filter((q) => n[q.field]?.trim()).map((q) => `${q.label}: ${flat(n[q.field]!)}`);
        if (said.length) lines.push(`- **${who(Number(p))}**: ${said.join(" · ")}`);
      }
      for (const x of area?.comments ?? []) if (!x.deleted) lines.push(`- 💬 ${who(x.by)}: ${flat(x.text)}`);
      for (const t of topics.filter((t) => t.group === group)) {
        const r = c.topics[t.key];
        const outcome = OUTCOMES.find((o) => o.id === r?.outcome)?.label;
        lines.push(
          `- **${t.item}** (${TOPIC_KINDS[t.kind].label}). ${t.values.map((v, j) => `${names[j] ?? `Menu ${j + 1}`}: ${answerText(v)}`).join("; ")}${
            outcome ? ` → **${outcome}**` : ""
          }`
        );
        if (r?.note?.trim()) lines.push(`  - Notes: ${flat(r.note)}`);
        if (r?.followUp?.trim()) lines.push(`  - Next step: ${flat(r.followUp)}`);
        for (const x of r?.comments ?? []) if (!x.deleted) lines.push(`  - 💬 ${who(x.by)}: ${flat(x.text)}`);
      }
      lines.push(``);
    }
  });
  return lines.join("\n");
};
