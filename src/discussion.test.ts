import { compareMenus } from "./data-comparer";
import {
  buildAgenda,
  discussionKey,
  discussionSummary,
  emptyRecord,
  isCovered,
  loadDiscussion,
  promptsFor,
  saveDiscussion,
} from "./discussion";

const comparison = compareMenus([
  {
    G: [
      { item: "Kissing", value: "must-have" },
      { item: "Hiking", value: "like-to-have" },
      { item: "Cuddling", value: "like-to-have" },
      { item: "Kids", value: "must-have" },
      { item: "Pets", value: "maybe" },
      { item: "Travel", value: "maybe" },
      { item: "Marriage" },
    ],
  },
  {
    G: [
      { item: "Kissing", value: "must-have" },
      { item: "Hiking", value: "like-to-have" },
      { item: "Cuddling", value: "maybe" },
      { item: "Kids", value: "off-limits" },
      { item: "Pets", value: "maybe" },
      { item: "Travel", value: "off-limits" },
      { item: "Marriage", value: "maybe" },
    ],
  },
]);

describe("buildAgenda (DS-2, DS-3)", () => {
  const agenda = buildAgenda(comparison);

  it("orders topics: shared wants, then differences, then conflicts, then unanswered", () => {
    expect(agenda.map((t) => [t.item, t.kind])).toEqual([
      ["Kissing", "celebrate"], // Must have from both comes first
      ["Hiking", "celebrate"],
      ["Cuddling", "explore"], // Like vs Maybe and Maybe vs Off limits: both gap 1,
      ["Travel", "explore"], //   so menu order; Maybe vs Off limits isn't a conflict
      ["Kids", "conflict"],
      ["Marriage", "check-in"],
    ]);
  });

  it("leaves out agreed items that aren't shared wants (Pets: Maybe/Maybe)", () => {
    expect(agenda.find((t) => t.item === "Pets")).toBeUndefined();
  });

  it("gives every topic prompts, picked the same way every time", () => {
    for (const topic of agenda) {
      expect(topic.prompts.length).toBeGreaterThanOrEqual(2);
      expect(promptsFor(topic.kind, topic.key)).toEqual(topic.prompts);
    }
  });

  it("caps shared wants at the given number", () => {
    expect(buildAgenda(comparison, 1).filter((t) => t.kind === "celebrate")).toHaveLength(1);
  });
});

describe("discussion records (DS-5, DS-6)", () => {
  beforeEach(() => localStorage.clear());

  it("keys discussions by who and which menus, independent of order or answers", () => {
    const a = { title: "Ana's menu", person: { name: "Ana" } };
    const b = { title: "Ben's menu" };
    expect(discussionKey([a, b])).toBe(discussionKey([b, a]));
    expect(discussionKey([a, b])).not.toBe(discussionKey([a, { title: "Other" }]));
    expect(discussionKey([a, b])).toMatch(/^discussion:/);
  });

  it("saves and loads notes, dropping anything malformed", () => {
    const record = emptyRecord(1000);
    record.topics["k"] = { note: "hi", outcome: "compromise", followUp: "try it for a month" };
    saveDiscussion("discussion:x", record);
    expect(loadDiscussion("discussion:x")?.topics.k).toEqual(record.topics.k);

    localStorage.setItem(
      "discussion:y",
      JSON.stringify({ version: 1, topics: { a: { outcome: "nonsense", note: 5 }, b: null } })
    );
    expect(loadDiscussion("discussion:y")?.topics).toEqual({ a: {} });
    localStorage.setItem("discussion:z", "not json");
    expect(loadDiscussion("discussion:z")).toBeNull();
  });

  it("isCovered is true once anything is recorded", () => {
    expect(isCovered(undefined)).toBe(false);
    expect(isCovered({ note: "  " })).toBe(false);
    expect(isCovered({ outcome: "revisit" })).toBe(true);
    expect(isCovered({ note: "x" })).toBe(true);
  });
});

describe("discussionSummary (DS-7)", () => {
  it("groups discussed topics by outcome, with answers, notes and next steps", () => {
    const agenda = buildAgenda(comparison);
    const record = emptyRecord(Date.UTC(2026, 10, 25));
    const kids = agenda.find((t) => t.item === "Kids")!;
    const travel = agenda.find((t) => t.item === "Travel")!;
    record.topics[kids.key] = { outcome: "boundary", note: "Ben is sure.\nAna understands." };
    record.topics[travel.key] = { outcome: "compromise", followUp: "One short trip this year" };
    const text = discussionSummary(agenda, record, ["Ana", "Ben"]);
    expect(text).toContain("# Our relationship menu discussion");
    expect(text).toContain("Ana, Ben");
    expect(text).toContain("## Compromise");
    expect(text).toContain("- **Travel** (G). Ana: Maybe; Ben: Off limits");
    expect(text).toContain("  - Next step: One short trip this year");
    expect(text).toContain("## Boundary");
    expect(text).toContain("  - Notes: Ben is sure. Ana understands.");
    expect(text).toContain(`_${agenda.length - 2} topics not discussed yet._`);
  });
});
