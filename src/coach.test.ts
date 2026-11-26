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
