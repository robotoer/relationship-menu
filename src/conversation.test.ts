import { encodeMenuSlug } from "./compare-slug";
import {
  CONVERSATION_LIMITS,
  addComment,
  agendaAreas,
  areaInsights,
  conversationAgenda,
  conversationSummary,
  minutesFor,
  newConversation,
  parseConversation,
  partsWithTopics,
  settingsOf,
  suggestParts,
  updateAreaNotes,
  updateSettings,
  updateTopic,
  mergeConversations,
} from "./conversation";
import { dictationHint } from "./dictation";
import { TIPS, TIP_SOURCES, tipFor } from "./conversation-tips";

const menu = (name: string, groups: Record<string, [string, string][]>) =>
  encodeMenuSlug(
    `${name}'s`,
    Object.fromEntries(Object.entries(groups).map(([g, items]) => [g, items.map(([item, value]) => ({ item, value: value as never }))])),
    { name }
  );
const ana = menu("Ana", {
  Easy: [["Hugs", "must-have"], ["Walks", "like-to-have"]],
  Hard: [["Kids", "must-have"], ["Moving", "maybe"], ["Pets", "must-have"]],
  Big: Array.from({ length: 8 }, (_, i) => [`Thing ${i}`, "maybe"] as [string, string]),
});
const ben = menu("Ben", {
  Easy: [["Hugs", "must-have"], ["Walks", "like-to-have"]],
  Hard: [["Kids", "off-limits"], ["Moving", "must-have"], ["Pets", "off-limits"]],
  Big: Array.from({ length: 8 }, (_, i) => [`Thing ${i}`, "like-to-have"] as [string, string]),
});

describe("conversations", () => {
  const c = newConversation([ana, ben], 1000, "AAAAAAAAAAAAAAAAAAAAAA");
  const agenda = conversationAgenda(c);

  it("CV-1: starts named after the people, with both menus", () => {
    expect(c.title).toBe("Ana & Ben");
    expect(c.menus).toHaveLength(2);
    expect(newConversation([ana, "not a menu", ben]).menus).toHaveLength(2);
  });

  it("CV-3: suggests parts of a few topics, easiest areas first, keeping areas together", () => {
    let n = 0;
    const parts = suggestParts(agenda, 6, 1, () => `p${n++}`.padEnd(22, "x"));
    const groupsOf = (keys: string[]) => [...new Set(keys.map((k) => agenda.find((t) => t.key === k)!.group))];
    // Big's 8 topics split 6 + 2; Hard's 3 fit after those 2.
    expect(parts.map((p) => groupsOf(p.topicKeys))).toEqual([["Easy"], ["Big"], ["Big", "Hard"]]);
    expect(parts.every((p) => p.topicKeys.length <= 6)).toBe(true);
    expect(parts.flatMap((p) => p.topicKeys).sort()).toEqual(agenda.map((t) => t.key).sort());
    expect(parts[0].title).toBe("Easy");
    expect(minutesFor(2)).toBe(10);
    expect(minutesFor(6)).toBe(24);
  });

  it("CV-3: topics no longer in the agenda drop out; new ones go to 'Not planned yet'", () => {
    const parts = [{ id: "p".repeat(22), order: 0, title: "One", topicKeys: [agenda[0].key, "gone"], updatedAt: 1 }];
    const withTopics = partsWithTopics(parts, agenda);
    expect(withTopics[0].topics.map((t) => t.key)).toEqual([agenda[0].key]);
    expect(withTopics[1].part).toBeNull();
    expect(withTopics[1].topics).toHaveLength(agenda.length - 1);
  });

  it("CV-4: plain insights for an area, with no verdicts", () => {
    const hard = agendaAreas(c, agenda).find((a) => a.group === "Hard")!;
    const lines = areaInsights(hard.summary, hard.topics, ["Ana", "Ben"]);
    expect(lines).toEqual([
      "You agree on 0 of the 3 items everyone answered here.",
      "2 conflicts (someone marked it Off limits): Kids, Pets. Off limits is a complete answer; talk about what's behind it, not whether to change it.",
      "1 difference where nobody said no, worth exploring.",
      "Ana has the most Must haves in this area (2).",
    ]);
    expect(lines.join(" ")).not.toMatch(/compatib|score|wrong|should change/i);
  });

  it("CV-9: limits apply to what's read back, including from links", () => {
    const long = updateTopic(c, agenda[0].key, { note: "x".repeat(10_000) });
    expect(parseConversation(JSON.parse(JSON.stringify(long)))!.topics[agenda[0].key].note).toHaveLength(CONVERSATION_LIMITS.note);
    const proto = JSON.parse(JSON.stringify(c));
    proto.topics = JSON.parse('{"__proto__": {"note": "x", "updatedAt": 1, "comments": []}}');
    const parsed = parseConversation(proto)!;
    expect(Object.getPrototypeOf(parsed.topics)).toBeNull();
    expect(({} as Record<string, unknown>).note).toBeUndefined();
  });

  it("CV-12: the summary has outcomes, then parts, areas, notes and comments", () => {
    let x = updateTopic(c, agenda.find((t) => t.item === "Kids")!.key, { outcome: "boundary", note: "Ben is sure" }, 2000);
    x = updateAreaNotes(x, "Hard", 1, { matters: "Being heard" }, 2000);
    x = addComment(x, { area: "Hard" }, 0, "Thank you for saying it", 2001, "c".repeat(22));
    x = { ...x, parts: suggestParts(agenda, 6, 1) };
    const md = conversationSummary(x, agenda, ["Ana", "Ben"], new Date(2026, 10, 26));
    expect(md).toContain("## Boundary\n\n- **Kids** (Hard)");
    expect(md).toContain("## Part 3: Big, Hard");
    expect(md).toContain("### Hard");
    expect(md).toContain("- **Ben**: What matters most to me here: Being heard");
    expect(md).toContain("- 💬 Ana: Thank you for saying it");
    expect(md).toContain("  - Notes: Ben is sure");
  });
});

describe("dictation hints (CV-14)", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5, /microphone on your keyboard/],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5, /microphone on your keyboard/],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0, /Fn/],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, /microphone on your keyboard/],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0, /Windows key \+ H/],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)", 0, /Search \+ D/],
    ["", 0, /device's dictation/],
  ])("%s", (ua, touch, expected) => {
    expect(dictationHint(ua, touch)).toMatch(expected);
  });
});

describe("conversation tips (CV-13)", () => {
  it("every tip is short, sourced, and never quotes statistics or calls itself therapy", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(35);
    for (const tip of TIPS) {
      expect(tip.text.split(/\s+/).length).toBeLessThanOrEqual(45);
      expect(tip.sources.length).toBeGreaterThan(0);
      for (const s of tip.sources) expect(TIP_SOURCES[s].url).toMatch(/^https:\/\//);
      expect(tip.text).not.toMatch(/\d+\s*%|5:1|therap|counsell?ing session|treatment/i);
    }
  });

  it("no tip nudges someone away from an Off limits answer", () => {
    const boundaries = TIPS.filter((t) => t.stage === "boundaries").map((t) => `${t.title}. ${t.text}`).join(" ");
    expect(boundaries).toMatch(/complete answer/);
    expect(boundaries).toMatch(/talk someone out of/);
  });

  it("each kind of topic gets a fitting tip, the same one each time", () => {
    expect(tipFor("conflict", "a").stage).toMatch(/boundaries|heated/);
    expect(tipFor("explore", "k")).toBe(tipFor("explore", "k"));
  });
});

describe("conversation settings (CV-15…CV-18)", () => {
  const c = newConversation([ana, ben], 1000, "AAAAAAAAAAAAAAAAAAAAAA");

  it("start as the agenda conversations have always had, until someone changes them", () => {
    expect(c.settings).toBeUndefined();
    expect(settingsOf(c)).toMatchObject({ menuNotes: "show", prompts: true, order: "gentle", warmUp: 2 });
    // Two shared wants to start, then every difference, conflict and open item.
    const items = conversationAgenda(c).map((t) => t.item);
    expect(items.slice(0, 2)).toEqual(["Hugs", "Walks"]);
    expect(items).toEqual(expect.arrayContaining(["Thing 0", "Kids", "Moving"]));
  });

  it("change what's on the agenda, including what you agree on", () => {
    const noWarmUp = updateSettings(c, { warmUp: 0 }, 2000);
    expect(conversationAgenda(noWarmUp).map((t) => t.item)).not.toContain("Hugs");
    const withWants = updateSettings(noWarmUp, { include: { ...settingsOf(c).include, "shared-want": true } }, 2001);
    expect(conversationAgenda(withWants).map((t) => t.item)).toEqual(expect.arrayContaining(["Hugs", "Walks"]));
    const noDifferences = updateSettings(c, { include: { ...settingsOf(c).include, talk: false, degree: false } }, 2000);
    expect(conversationAgenda(noDifferences).every((t) => t.kind !== "explore")).toBe(true);
    expect(withWants.updatedAt).toBe(2001);
  });

  it("put the hardest areas first when asked", () => {
    let n = 0;
    const hardest = updateSettings(c, { order: "hardest" }, 2000);
    const parts = suggestParts(conversationAgenda(hardest), 6, 1, () => `p${n++}`.padEnd(22, "x"), "hardest");
    const agenda = conversationAgenda(hardest);
    expect(agenda.find((t) => t.key === parts[0].topicKeys[0])!.group).toBe("Hard");
  });

  it("travel with the conversation, are cleaned when read, and the newer change wins a merge", () => {
    const mine = updateSettings(c, { menuNotes: "hide" }, 2000);
    const theirs = updateSettings(c, { prompts: false }, 3000);
    expect(settingsOf(mergeConversations(mine, theirs))).toMatchObject({ prompts: false, menuNotes: "show" });
    expect(mergeConversations(mine, theirs)).toEqual(mergeConversations(theirs, mine));
    const read = parseConversation(JSON.parse(JSON.stringify({ ...mine, settings: { ...mine.settings, menuNotes: "shout", warmUp: 99, include: { conflict: "yes", "shared-no": true } } })))!;
    expect(read.settings).toMatchObject({ menuNotes: "show", warmUp: 5, include: { conflict: true, "shared-no": true } });
    expect(parseConversation(JSON.parse(JSON.stringify(mine)))!.settings).toEqual(mine.settings);
  });
});
