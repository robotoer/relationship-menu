/**
 * Client side of the AI conversation coach (docs/spec/coach.md). Builds the
 * smallest possible request from a discussion agenda: topic text, group and each
 * person's answer, with people as "Person 1", "Person 2"… Never names, notes or
 * menu titles (CO-3). The reply is kept with the discussion notes, in this
 * browser only.
 */

import type { ComparedMenuItemValue } from "./model/compare";
import type { Topic } from "./discussion";

/** Must match server/src/coach.ts. */
export const COACH_LIMITS = { maxTopics: 15, maxItemChars: 160, maxGroupChars: 80, maxPeople: 6 } as const;

type Answer = "must-have" | "like-to-have" | "maybe" | "off-limits" | "no answer" | "not on menu";
export type CoachRequest = {
  people: number;
  topics: { id: string; group: string; item: string; kind: Topic["kind"]; answers: Answer[] }[];
};
export type CoachArea = { group: string; insight: string };
export type CoachGuide = {
  opening: string;
  /** One insight per area (menu group), keyed by the group text sent. Older servers omit it. */
  areas?: CoachArea[];
  topics: { id: string; about: string; questions: string[] }[];
  closing: string;
};
/** What's kept with the discussion: the guide, keyed by topic key instead of request id. */
export type SavedCoachGuide = {
  createdAt: number;
  opening: string;
  closing: string;
  topics: Record<string, { about: string; questions: string[] }>;
  /** Insight per area, keyed by the exact group text of the comparison. Absent in older saves. */
  areas?: Record<string, string>;
};

/** Longest saved area insight (the server caps at 300). */
export const MAX_AREA_INSIGHT_CHARS = 300;

const toAnswer = (value: ComparedMenuItemValue): Answer =>
  value === null ? "not on menu" : value === undefined ? "no answer" : value;

/**
 * The request for an agenda, plus which agenda topic each request id stands for
 * (`ids`) and which comparison group each sent group text stands for (`groups`).
 * At most 15 topics (the first ones), text trimmed to the server's limits.
 */
export const buildCoachRequest = (agenda: Topic[], people: number) => {
  const included = agenda.slice(0, COACH_LIMITS.maxTopics);
  const ids = new Map<string, string>();
  const groups = new Map<string, string>();
  const request: CoachRequest = {
    people,
    topics: included.map((topic, i) => {
      const id = `t${i}`;
      ids.set(id, topic.key);
      const group = topic.group.replace(/\s+/g, " ").trim().slice(0, COACH_LIMITS.maxGroupChars);
      if (!groups.has(group)) groups.set(group, topic.group);
      return {
        id,
        group,
        item: topic.item.replace(/\s+/g, " ").trim().slice(0, COACH_LIMITS.maxItemChars),
        kind: topic.kind,
        answers: topic.values.map(toAnswer),
      };
    }),
  };
  return { request, ids, groups, omitted: agenda.length - included.length };
};

const ANSWER_LABEL: Record<Answer, string> = {
  "must-have": "Must have",
  "like-to-have": "Like to have",
  maybe: "Maybe",
  "off-limits": "Off limits",
  "no answer": "no answer",
  "not on menu": "not on menu",
};

/** One line per topic, exactly as it will be sent: shown before anyone agrees (CO-9). */
export const coachPreview = (request: CoachRequest) =>
  request.topics.map(
    (t) =>
      `${t.item}${t.group ? ` (${t.group})` : ""}: ${t.answers.map((a, i) => `Person ${i + 1} ${ANSWER_LABEL[a]}`).join(", ")}`
  );

/**
 * Area insights as a map from group text, keeping the first insight per group (at
 * most one per possible topic); anything that isn't a non-empty string is dropped.
 * Undefined when there are none.
 */
const toAreaMap = (entries: [unknown, unknown][]): Record<string, string> | undefined => {
  const areas: Record<string, string> = Object.create(null);
  let count = 0;
  for (const [group, insight] of entries) {
    if (count >= COACH_LIMITS.maxTopics) break;
    if (typeof group !== "string" || typeof insight !== "string" || Object.hasOwn(areas, group)) continue;
    const text = insight.trim().slice(0, MAX_AREA_INSIGHT_CHARS);
    if (!text) continue;
    areas[group] = text;
    count++;
  }
  return count ? areas : undefined;
};

/**
 * Re-keys a guide by agenda topic key, for saving with the discussion. Area
 * insights are keyed by the comparison's group text: pass `groups` from
 * buildCoachRequest to map each sent group back to it (without it, the sent text
 * is used, which is the same unless the group had extra spaces or was clipped).
 * Areas for groups that weren't sent are dropped.
 */
export const saveGuide = (
  guide: CoachGuide,
  ids: Map<string, string>,
  now = Date.now(),
  groups?: Map<string, string>
): SavedCoachGuide => {
  const topics: SavedCoachGuide["topics"] = Object.create(null);
  for (const t of guide.topics) {
    const key = ids.get(t.id);
    if (key && t.questions.length) topics[key] = { about: t.about, questions: t.questions.slice(0, 3) };
  }
  const areas = toAreaMap(
    (Array.isArray(guide.areas) ? guide.areas : []).map((a): [unknown, unknown] =>
      a && typeof a === "object" && typeof a.group === "string"
        ? [groups ? groups.get(a.group) : a.group, a.insight]
        : [undefined, undefined]
    )
  );
  return { createdAt: now, opening: guide.opening, closing: guide.closing, topics, ...(areas ? { areas } : {}) };
};

/** Reads a saved guide back from storage, dropping anything malformed. */
export const loadSavedGuide = (raw: unknown): SavedCoachGuide | undefined => {
  const v = raw as Partial<SavedCoachGuide> | null;
  if (!v || typeof v !== "object" || typeof v.opening !== "string" || typeof v.closing !== "string") return undefined;
  const topics: SavedCoachGuide["topics"] = Object.create(null);
  for (const [key, t] of Object.entries(v.topics ?? {})) {
    if (!t || typeof t.about !== "string" || !Array.isArray(t.questions)) continue;
    const questions = t.questions.filter((q): q is string => typeof q === "string").slice(0, 3);
    if (questions.length) topics[key] = { about: t.about, questions };
  }
  const rawAreas: unknown = v.areas;
  const areas =
    rawAreas && typeof rawAreas === "object" && !Array.isArray(rawAreas) ? toAreaMap(Object.entries(rawAreas)) : undefined;
  return { createdAt: Number(v.createdAt) || 0, opening: v.opening, closing: v.closing, topics, ...(areas ? { areas } : {}) };
};

/** Why a coach request didn't work, in words people can act on. */
export type CoachFailure = "unavailable" | "not_supporter" | "quota" | "busy" | "declined" | "failed";

/** Which limit a `quota` failure hit (CO-8): this account's for today or this month, or everyone's. */
export type CoachLimit = "day" | "month" | "total";

export class CoachError extends Error {
  constructor(
    readonly reason: CoachFailure,
    readonly limit?: CoachLimit
  ) {
    super(reason);
  }
}

export const COACH_FAILURE_TEXT: Record<CoachFailure, string> = {
  unavailable: "The AI coach isn't switched on right now. The built-in prompts below still work.",
  not_supporter: "The AI coach is a thank-you for supporters.",
  quota: "You've used today's AI preparations. Try again tomorrow; the built-in prompts still work.",
  busy: "The AI service is busy. Please try again in a minute.",
  declined: "The AI couldn't help with these topics. The built-in prompts still work.",
  failed: "Something went wrong preparing questions. Please try again.",
};

const QUOTA_TEXT: Record<CoachLimit, string> = {
  day: "You've used today's AI preparations. Try again tomorrow; the built-in prompts still work.",
  month: "You've used this month's AI preparations. They come back at the start of next month; the built-in prompts still work.",
  total: "The AI coach has reached its limit for now. Please try again later; the built-in prompts still work.",
};

/** What to say about a failed request, including which limit a `quota` failure hit. */
export const coachFailureText = (error: CoachError): string =>
  error.reason === "quota" ? QUOTA_TEXT[error.limit ?? "day"] : COACH_FAILURE_TEXT[error.reason];

/** Sends a request and returns the guide. Injected so the page doesn't know about keys. */
export type CoachClient = (request: CoachRequest) => Promise<CoachGuide>;

const failureFor = (status: number, code: string | undefined): CoachFailure => {
  if (code === "coach_unavailable") return "unavailable";
  if (code === "not_supporter" || code === "read_only") return "not_supporter";
  if (code === "coach_quota") return "quota";
  if (code === "coach_busy" || status === 429) return "busy";
  if (code === "coach_declined") return "declined";
  return "failed";
};

/**
 * A coach client for the sync server. `authorize` signs the request the way
 * supporter sync does (server/README.md, "Wire protocol").
 */
export const createCoachClient =
  (options: {
    origin: string;
    authorize: (method: string, pathAndQuery: string, body: Uint8Array) => Promise<string>;
    fetch?: typeof fetch;
  }): CoachClient =>
  async (request) => {
    const body = new TextEncoder().encode(JSON.stringify(request));
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(`${options.origin}/v1/coach`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: await options.authorize("POST", "/v1/coach", body),
        },
        body,
      });
    } catch {
      throw new CoachError("failed");
    }
    const data = (await response.json().catch(() => null)) as
      | (CoachGuide & { error?: string; scope?: string; period?: string })
      | null;
    if (!response.ok || !data || !Array.isArray(data.topics)) {
      const reason = failureFor(response.status, data?.error);
      const limit: CoachLimit | undefined =
        reason !== "quota" ? undefined : data?.scope === "total" ? "total" : data?.period === "month" ? "month" : "day";
      throw new CoachError(reason, limit);
    }
    return data;
  };
