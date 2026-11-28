/**
 * Property tests for merging copies of a conversation (spec CV-8): random edits on
 * random copies, merged in every order, always give the same result, never lose a
 * comment, and survive the trip through a link (CV-6, CV-9).
 */
import fc from "fast-check";
import { encodeMenuSlug } from "../compare-slug";
import {
  addComment,
  Comment,
  Conversation,
  conversationFromLink,
  conversationLink,
  canonical,
  deleteComment,
  mergeConversations,
  moveTopic,
  newConversation,
  parseConversation,
  replaceMenu,
  setTitle,
  suggestParts,
  conversationAgenda,
  updateAreaNotes,
  updatePart,
  updateSettings,
  updateTopic,
} from "../conversation";

const ana = encodeMenuSlug("Ana's", { G: [{ item: "Kissing", value: "must-have" }, { item: "Kids", value: "must-have" }, { item: "Pets", value: "like-to-have" }], H: [{ item: "Travel", value: "maybe" }] }, { name: "Ana" });
const ben = encodeMenuSlug("Ben's", { G: [{ item: "Kissing", value: "must-have" }, { item: "Kids", value: "off-limits" }, { item: "Pets", value: "maybe" }], H: [{ item: "Travel", value: "must-have" }] }, { name: "Ben" });
const ben2 = encodeMenuSlug("Ben's", { G: [{ item: "Kissing", value: "must-have" }, { item: "Kids", value: "maybe" }] }, { name: "Ben" });

const ID = "AAAAAAAAAAAAAAAAAAAAAA";
let counter = 0;
const nextId = () => (counter++).toString(36).padStart(22, "x");
const base = (): Conversation => {
  const c = newConversation([ana, ben], 1000, ID);
  return { ...c, parts: suggestParts(conversationAgenda(c), 2, 1000, () => `part${"p".repeat(16)}${(counter++ % 1000).toString().padStart(2, "0")}`.slice(0, 22).padEnd(22, "q")) };
};

const KEYS = ["k1", "k2", "k3"];
const AREAS = ["G", "H"];
type Edit = (c: Conversation, now: number) => Conversation;
const edit: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ k: fc.constantFrom(...KEYS), note: fc.string({ maxLength: 8 }) }).map(({ k, note }) => (c: Conversation, now: number) => updateTopic(c, k, { note }, now)),
  fc.record({ k: fc.constantFrom(...KEYS), o: fc.constantFrom("agreed", "boundary", "revisit" as const) }).map(({ k, o }) => (c: Conversation, now: number) => updateTopic(c, k, { outcome: o }, now)),
  fc.record({ a: fc.constantFrom(...AREAS), p: fc.integer({ min: 0, max: 1 }), t: fc.string({ maxLength: 8 }) }).map(({ a, p, t }) => (c: Conversation, now: number) => updateAreaNotes(c, a, p, { matters: t }, now)),
  fc.record({ k: fc.constantFrom(...KEYS), p: fc.integer({ min: 0, max: 1 }), t: fc.string({ minLength: 1, maxLength: 8 }) }).map(({ k, p, t }) => (c: Conversation, now: number) => addComment(c, { topic: k }, p, `x${t}`, now, nextId())),
  fc.record({ a: fc.constantFrom(...AREAS), t: fc.string({ minLength: 1, maxLength: 8 }) }).map(({ a, t }) => (c: Conversation, now: number) => addComment(c, { area: a }, 0, `y${t}`, now, nextId())),
  fc.constant((c: Conversation, now: number) => {
    const list = c.topics.k1?.comments ?? [];
    return list.length ? deleteComment(c, { topic: "k1" }, list[0].id, now) : c;
  }),
  fc.string({ maxLength: 6 }).map((t) => (c: Conversation, now: number) => setTitle(c, t, now)),
  // Settings are shared and merge like the rest: the newer change wins (CV-18).
  fc.record({ hide: fc.boolean(), wants: fc.boolean(), hardest: fc.boolean() }).map(
    ({ hide, wants, hardest }) =>
      (c: Conversation, now: number) =>
        updateSettings(
          c,
          {
            menuNotes: hide ? "hide" : "highlight",
            order: hardest ? "hardest" : "gentle",
            include: { ...(c.settings?.include ?? {
                conflict: true,
                talk: true,
                open: true,
                degree: true,
                "shared-maybe": false,
                "shared-want": false,
                "shared-soft-no": false,
                "shared-no": false,
              }), "shared-want": wants },
          },
          now
        )
  ),
  fc.constant((c: Conversation, now: number) => replaceMenu(c, 1, ben2, now)),
  fc.boolean().map((done) => (c: Conversation, now: number) => (c.parts[0] ? updatePart(c, c.parts[0].id, { done }, now) : c)),
  fc.constant((c: Conversation, now: number) => {
    const key = c.parts[0]?.topicKeys[0];
    const to = c.parts[c.parts.length - 1];
    return key && to ? moveTopic(c, key, to.id, now) : c;
  })
);

/** A copy that started from `start` and had these edits, at increasing times. */
const copy = (start: Conversation, edits: Edit[], t0: number) => edits.reduce((c, e, i) => e(c, t0 + i * 3), start);
const copies = fc.tuple(
  fc.array(edit, { maxLength: 8 }),
  fc.array(edit, { maxLength: 8 }),
  fc.array(edit, { maxLength: 8 }),
  fc.integer({ min: 0, max: 2 })
);

const comments = (c: Conversation): Comment[] =>
  [...Object.values(c.topics), ...Object.values(c.areas)].flatMap((t) => t.comments);
const same = (a: Conversation, b: Conversation) => expect(canonical(a)).toBe(canonical(b));

describe("conversation merge (CV-8)", () => {
  it("is commutative, associative and idempotent", () => {
    fc.assert(
      fc.property(copies, ([ea, eb, ec, skew]) => {
        const start = base();
        const a = copy(start, ea, 2000);
        const b = copy(start, eb, 2001 + skew);
        const c = copy(start, ec, 2002);
        same(mergeConversations(a, b), mergeConversations(b, a));
        same(mergeConversations(mergeConversations(a, b), c), mergeConversations(a, mergeConversations(b, c)));
        same(mergeConversations(a, a), mergeConversations(a, start));
        const ab = mergeConversations(a, b);
        same(mergeConversations(ab, a), ab);
      }),
      { numRuns: 300 }
    );
  });

  it("keeps every comment from both copies, and a deletion on either side wins", () => {
    fc.assert(
      fc.property(copies, ([ea, eb]) => {
        const start = base();
        const a = copy(start, ea, 2000);
        const b = copy(start, eb, 2001);
        const merged = comments(mergeConversations(a, b));
        const ids = new Set(merged.map((x) => x.id));
        for (const x of [...comments(a), ...comments(b)]) expect(ids.has(x.id)).toBe(true);
        for (const x of [...comments(a), ...comments(b)].filter((x) => x.deleted)) {
          expect(merged.find((m) => m.id === x.id)?.deleted).toBe(true);
        }
      }),
      { numRuns: 300 }
    );
  });

  it("the most recent change to a note wins", () => {
    const start = base();
    const a = updateTopic(start, "k1", { note: "older" }, 5000);
    const b = updateTopic(start, "k1", { note: "newer" }, 6000);
    expect(mergeConversations(a, b).topics.k1.note).toBe("newer");
    expect(mergeConversations(b, a).topics.k1.note).toBe("newer");
    // Each person's area notes are separate, so both people's edits survive.
    const x = updateAreaNotes(start, "G", 0, { matters: "Ana's" }, 5000);
    const y = updateAreaNotes(start, "G", 1, { matters: "Ben's" }, 4000);
    const m = mergeConversations(x, y);
    expect([m.areas.G.people["0"].matters, m.areas.G.people["1"].matters]).toEqual(["Ana's", "Ben's"]);
  });

  it("refuses to merge different conversations", () => {
    expect(() => mergeConversations(base(), newConversation([ana, ben], 1, "BBBBBBBBBBBBBBBBBBBBBB"))).toThrow();
  });
});

describe("conversation links (CV-6, CV-9)", () => {
  it("round-trip through a link, whatever was edited", () => {
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 10 }), (edits) => {
        const c = copy(base(), edits, 2000);
        const back = conversationFromLink(conversationLink("https://x", c));
        expect(back).not.toBeNull();
        same(back!, parseConversation(JSON.parse(JSON.stringify(c)))!);
        // Parsing is stable: a parsed conversation parses to itself.
        same(parseConversation(JSON.parse(JSON.stringify(back)))!, back!);
      }),
      { numRuns: 150 }
    );
  });

  it("never throws on junk, and rejects what isn't a conversation", () => {
    fc.assert(
      fc.property(fc.anything(), (junk) => {
        expect(() => parseConversation(junk)).not.toThrow();
      }),
      { numRuns: 300 }
    );
    expect(parseConversation({ kind: "conversation", version: 1, id: ID, menus: [] })).toBeNull();
    expect(conversationFromLink("https://x/talk#c=notbase64!!")).toBeNull();
    expect(conversationFromLink("https://x/talk")).toBeNull();
  });
});
