import { buildCoachRequest, CoachError, coachPreview, createCoachClient, loadSavedGuide, saveGuide } from "./coach";
import { compareMenus } from "./data-comparer";
import { buildAgenda } from "./discussion";

const agenda = buildAgenda(
  compareMenus([
    { Touch: [{ item: "Kissing", value: "must-have", note: "Zqx secret note" }], Future: [{ item: "Kids", value: "must-have" }, { item: "Pets" }] },
    { Touch: [{ item: "Kissing", value: "must-have" }], Future: [{ item: "Kids", value: "off-limits" }, { item: "Pets", value: "maybe" }] },
  ])
);

describe("buildCoachRequest (CO-3)", () => {
  it("sends only topic text, group, kind and answers, with request ids", () => {
    const { request, ids } = buildCoachRequest(agenda, 2);
    expect(request).toEqual({
      people: 2,
      topics: [
        { id: "t0", group: "Touch", item: "Kissing", kind: "celebrate", answers: ["must-have", "must-have"] },
        { id: "t1", group: "Future", item: "Kids", kind: "conflict", answers: ["must-have", "off-limits"] },
        { id: "t2", group: "Future", item: "Pets", kind: "check-in", answers: ["no answer", "maybe"] },
      ],
    });
    expect(JSON.stringify(request)).not.toContain("Zqx");
    expect(ids.get("t1")).toBe(agenda[1].key);
  });

  it("caps the number of topics and trims long text to the server's limits", () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ ...agenda[0], key: `k${i}`, item: "x".repeat(300), group: "g".repeat(100) }));
    const { request, omitted } = buildCoachRequest(many, 2);
    expect(request.topics).toHaveLength(40);
    expect(omitted).toBe(5);
    expect(request.topics[0].item).toHaveLength(160);
    expect(request.topics[0].group).toHaveLength(80);
  });

  it("previews exactly what will be sent, one line per topic (CO-9)", () => {
    expect(coachPreview(buildCoachRequest(agenda, 2).request)).toEqual([
      "Kissing (Touch): Person 1 Must have, Person 2 Must have",
      "Kids (Future): Person 1 Must have, Person 2 Off limits",
      "Pets (Future): Person 1 no answer, Person 2 Maybe",
    ]);
  });
});

describe("saved guides (CO-10)", () => {
  it("re-keys by topic, drops unknown ids, and reads back only well-formed data", () => {
    const { ids } = buildCoachRequest(agenda, 2);
    const saved = saveGuide(
      { opening: "Hi", closing: "Bye", topics: [{ id: "t1", about: "A", questions: ["Q1", "Q2", "Q3", "Q4"] }, { id: "t9", about: "?", questions: ["x"] }] },
      ids,
      5
    );
    expect(saved).toEqual({ createdAt: 5, opening: "Hi", closing: "Bye", topics: { [agenda[1].key]: { about: "A", questions: ["Q1", "Q2", "Q3"] } } });
    expect(loadSavedGuide(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(loadSavedGuide({ opening: 1 })).toBeUndefined();
    expect(loadSavedGuide({ opening: "a", closing: "b", topics: { k: { about: "x", questions: [1, "ok"] }, j: null } })?.topics).toEqual({
      k: { about: "x", questions: ["ok"] },
    });
  });
});

describe("saved area insights (CO-10)", () => {
  const { ids, groups } = buildCoachRequest(agenda, 2);
  const guide = (areas?: unknown) =>
    ({ opening: "Hi", closing: "Bye", topics: [{ id: "t0", about: "A", questions: ["Q"] }], areas }) as never;

  it("keys insights by group, trimmed and capped, first one per group", () => {
    const saved = saveGuide(
      guide([
        { group: "Future", insight: "  You differ on kids.  " },
        { group: "Touch", insight: "x".repeat(500) },
        { group: "Touch", insight: "a later duplicate" },
        { group: "Future", insight: "another" },
        { group: "Nowhere", insight: "not sent" },
        { group: "Touch" },
        null,
      ]),
      ids,
      5,
      groups
    );
    expect(saved.areas).toEqual({ Future: "You differ on kids.", Touch: "x".repeat(300) });
    expect(Object.getPrototypeOf(saved.areas)).toBeNull();
    expect(loadSavedGuide(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("maps sent group text back to the comparison's exact group text", () => {
    const long = "g".repeat(100);
    const odd = buildCoachRequest(
      [
        { ...agenda[0], key: "a", group: long },
        { ...agenda[0], key: "b", group: "Out  doors" },
      ],
      2
    );
    const saved = saveGuide(
      guide([
        { group: "g".repeat(80), insight: "Long group." },
        { group: "Out doors", insight: "Spaced group." },
      ]),
      odd.ids,
      5,
      odd.groups
    );
    expect(saved.areas).toEqual({ [long]: "Long group.", "Out  doors": "Spaced group." });
  });

  it("is optional: guides without areas save and load as before", () => {
    const saved = saveGuide(guide(), ids, 5, groups);
    expect(saved).not.toHaveProperty("areas");
    expect(saveGuide(guide("junk"), ids, 5)).not.toHaveProperty("areas");
    expect(saveGuide(guide([]), ids, 5)).not.toHaveProperty("areas");
    const old = { createdAt: 1, opening: "a", closing: "b", topics: {} };
    expect(loadSavedGuide(old)).toEqual(old);
  });

  it("without the group map, uses the group text as sent", () => {
    expect(saveGuide(guide([{ group: "Touch", insight: "Shared." }]), ids, 5).areas).toEqual({ Touch: "Shared." });
  });

  it("reads back only string insights, capped, ignoring junk and prototype keys", () => {
    const raw = JSON.parse(
      `{"opening":"a","closing":"b","topics":{},"areas":{"Touch":" ok ","Future":3,"Pets":null,"Blank":"  ","__proto__":"proto","Long":"${"y".repeat(400)}"}}`
    );
    const loaded = loadSavedGuide(raw)!;
    expect({ ...loaded.areas }).toEqual(JSON.parse(`{"Touch":"ok","__proto__":"proto","Long":"${"y".repeat(300)}"}`));
    expect(Object.getPrototypeOf(loaded.areas)).toBeNull();
    expect(Object.keys(loaded.areas!)).toEqual(["Touch", "__proto__", "Long"]);
    for (const areas of [["Touch", "x"], "Touch", 5, null, {}]) {
      expect(loadSavedGuide({ opening: "a", closing: "b", topics: {}, areas })).not.toHaveProperty("areas");
    }
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`g${i}`, "x"]));
    expect(Object.keys(loadSavedGuide({ opening: "a", closing: "b", topics: {}, areas: many })!.areas!)).toHaveLength(40);
  });
});

describe("createCoachClient", () => {
  const { request } = buildCoachRequest(agenda, 2);
  const respond = (status: number, body: unknown) =>
    vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

  it("posts the signed request and returns the guide", async () => {
    const guide = { opening: "o", closing: "c", topics: [{ id: "t0", about: "a", questions: ["q"] }] };
    const fetch = respond(200, guide);
    const authorize = vi.fn(async () => "MenuSync v1 test");
    const client = createCoachClient({ origin: "https://sync.example", authorize, fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await client(request)).toEqual(guide);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://sync.example/v1/coach");
    expect((init!.headers as Record<string, string>).authorization).toBe("MenuSync v1 test");
    expect(authorize).toHaveBeenCalledWith("POST", "/v1/coach", init!.body);
    expect(JSON.parse(new TextDecoder().decode(init!.body as Uint8Array))).toEqual(request);
  });

  it.each([
    [503, "coach_unavailable", "unavailable"],
    [402, "not_supporter", "not_supporter"],
    [402, "read_only", "not_supporter"],
    [429, "coach_quota", "quota"],
    [429, "rate_limited", "busy"],
    [503, "coach_busy", "busy"],
    [422, "coach_declined", "declined"],
    [502, "coach_failed", "failed"],
  ])("maps %s %s to %s", async (status, error, reason) => {
    const client = createCoachClient({ origin: "", authorize: async () => "", fetch: respond(status, { error }) as unknown as typeof fetch });
    await expect(client(request)).rejects.toEqual(new CoachError(reason as never));
  });
});
