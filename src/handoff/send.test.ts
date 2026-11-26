import { KeyValueStore, menuKey } from "../menu-store";
import { encodeHandoffReply, parseHandoffRequest } from "./format";
import { MAX_PARTS, SENT_KEY, VISIT_KEY, collectMenus, fallbackUrl, nextPart, runHandoff } from "./send";

/**
 * The hand-off page on the old address (spec HO-3, HO-4, HO-6), with in-memory
 * storage and the importer's replies simulated (the real round trip between two
 * origins is e2e/handoff.spec.ts).
 */

const NEW = "https://new.test";

class MemoryStore implements KeyValueStore {
  map = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

let local: MemoryStore;
let session: MemoryStore;
beforeEach(() => {
  local = new MemoryStore();
  session = new MemoryStore();
});

const at = (path: string) => {
  const url = new URL(path, "https://old.test");
  return { pathname: url.pathname, search: url.search, hash: url.hash };
};

const run = (location: ReturnType<typeof at>, maxLength?: number) =>
  runHandoff({ location, local, session, newOrigin: NEW, recover: async () => 0, ...(maxLength ? { maxLength } : {}) });

/**
 * Opens `path` on the old address and follows the hand-off to the end, with the new
 * address replying `ok` to each part. Returns the requests it sent and where it ended.
 */
const visit = async (path: string, { maxLength, ok = true }: { maxLength?: number; ok?: boolean } = {}) => {
  const requests: { url: string; titles: string[] }[] = [];
  let location = at(path);
  for (let hop = 0; hop < 200; hop++) {
    const next = await run(location, maxLength);
    if (!next.startsWith(`${NEW}/import#`)) return { requests, final: next };
    const request = parseHandoffRequest(new URL(next).hash);
    expect(request?.complete).toBe(true);
    requests.push({ url: next, titles: request!.menus.map((m) => m.title) });
    location = at(`/#${encodeHandoffReply({ id: request!.id, ok })}`);
  }
  throw new Error("The hand-off didn't finish");
};

const save = (id: string, title: string, encoded = `${title.replace(/\W/g, "") || "x"}AAAA`, extra: object = {}) =>
  local.setItem(menuKey(id), JSON.stringify({ title, encoded, savedAt: 1, ...extra }));
const ID = (c: string) => c.repeat(22);

describe("HO-3: every old link keeps working", () => {
  it.each(["/", "/menu?encoded=abc%3Adef#top", "/compare?encoded=a&encoded=b", "/library", "/no/such/page?x=1#y"])(
    "%s goes to the same path, query and fragment on the new address",
    async (path) => {
      expect(await visit(path)).toEqual({ requests: [], final: NEW + path });
    }
  );

  it("can't be sent to another host by the path", async () => {
    // https://relationship-menu.vercel.app//evil.example/x has the path //evil.example/x.
    const final = await run({ pathname: "//evil.example/x", search: "", hash: "" });
    expect(final).toBe(`${NEW}//evil.example/x`);
    expect(new URL(final).host).toBe("new.test");
  });

  it("falls back to the same page, or the home page for a stray reply", () => {
    expect(fallbackUrl(at("/menu?encoded=x#top"), NEW)).toBe(`${NEW}/menu?encoded=x#top`);
    expect(fallbackUrl(at(`/#${encodeHandoffReply({ id: ID("A"), ok: true })}`), NEW)).toBe(`${NEW}/`);
  });
});

describe("HO-4: saved menus go to the new address first", () => {
  it("sends menus in every format, then continues to the page asked for", async () => {
    save(ID("A"), "Current");
    local.setItem("menu:Older", JSON.stringify({ title: "Older", encoded: "OlderAAA", savedAt: 5 }));
    local.setItem("menu:Oldest", "OldestAA"); // the oldest format: the encoded menu itself
    local.setItem("unrelated", "kept");

    const { requests, final } = await visit("/menu?encoded=x#top");
    expect(final).toBe(`${NEW}/menu?encoded=x#top`);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.titles.sort()).toEqual(["Current", "Older", "Oldest"]);
    expect(requests[0]!.url.length).toBeLessThanOrEqual(32 * 1024);
  });

  it("sends one menu once when an older entry and its migrated copy both exist (SY-90)", async () => {
    save(ID("A"), "Same", "NewerAAA", { legacyTitle: "Same", savedAt: 10 });
    local.setItem("menu:Same", JSON.stringify({ title: "Same", encoded: "OlderAAA", savedAt: 5 }));
    const { requests } = await visit("/");
    expect(requests.map((r) => r.titles)).toEqual([["Same"]]);
    expect(parseHandoffRequest(new URL(requests[0]!.url).hash)!.menus[0]!.encoded).toBe("NewerAAA");
  });

  it("recovers IPFS-only menus first (SY-91)", async () => {
    const recover = vi.fn(async () => {
      local.setItem("menu:bafy", JSON.stringify({ title: "From IPFS", encoded: "IpfsAAAA", savedAt: 3 }));
    });
    const menus = await collectMenus(local, recover);
    expect(recover).toHaveBeenCalledOnce();
    expect(menus.map((m) => m.title)).toEqual(["From IPFS"]);
  });

  it("still sends the rest if recovery fails", async () => {
    save(ID("A"), "Current");
    expect((await collectMenus(local, async () => Promise.reject(new Error("no IndexedDB")))).map((m) => m.title)).toEqual([
      "Current",
    ]);
  });

  it("splits many menus into parts of at most 32 KB, each sent once", async () => {
    for (let i = 0; i < 40; i++) save(`${String(i).padStart(2, "0")}${"B".repeat(20)}`, `Menu ${i}`, "Q".repeat(3000));
    const { requests, final } = await visit("/library");
    expect(final).toBe(`${NEW}/library`);
    expect(requests.length).toBeGreaterThan(3);
    for (const { url } of requests) expect(url.length).toBeLessThanOrEqual(32 * 1024);
    const titles = requests.flatMap((r) => r.titles);
    expect(titles).toHaveLength(40);
    expect(new Set(titles).size).toBe(40);
  });

  it("sends a single menu bigger than a part on its own", async () => {
    save(ID("A"), "Huge", "Q".repeat(40_000));
    save(ID("B"), "Small");
    const { requests } = await visit("/");
    expect(requests.map((r) => r.titles.length)).toEqual([1, 1]);
  });

  it("fits as many menus as possible in each part", () => {
    const menus = Array.from({ length: 10 }, (_, i) => ({ title: `M${i}`, encoded: "QUFB".repeat(50) }));
    const { count, url } = nextPart(menus, ID("A"), NEW, 1000);
    expect(url.length).toBeLessThanOrEqual(1000);
    expect(nextPart(menus.slice(0, count + 1), ID("A"), NEW, 100_000).url.length).toBeGreaterThan(1000);
  });

  it("stops after MAX_PARTS parts in one visit; the rest go next time", async () => {
    for (let i = 0; i < MAX_PARTS + 5; i++) save(`${String(i).padStart(3, "0")}${"C".repeat(19)}`, `M${i}`, "Q".repeat(300));
    const first = await visit("/", { maxLength: 600 });
    expect(first.requests).toHaveLength(MAX_PARTS);
    const second = await visit("/", { maxLength: 600 });
    expect(second.requests.flatMap((r) => r.titles)).toHaveLength(5);
  });
});

describe("HO-6: nothing is deleted, and only changes are sent again", () => {
  it("leaves every menu entry as it was", async () => {
    save(ID("A"), "Current");
    local.setItem("menu:Older", JSON.stringify({ title: "Older", encoded: "OlderAAA", savedAt: 5 }));
    local.setItem("menu:Oldest", "OldestAA");
    const before = new Map(local.map);
    await visit("/");
    const after = new Map(local.map);
    after.delete(SENT_KEY);
    expect(after).toEqual(before);
    // Its own bookkeeping isn't read as a menu by older versions (they read "menu:…").
    expect(SENT_KEY.startsWith("menu")).toBe(false);
  });

  it("a second visit sends nothing if nothing changed, and only what changed if something did", async () => {
    save(ID("A"), "One");
    save(ID("B"), "Two");
    expect((await visit("/")).requests.flatMap((r) => r.titles).sort()).toEqual(["One", "Two"]);
    expect(await visit("/library")).toEqual({ requests: [], final: `${NEW}/library` });

    // An old tab saves an edit, and a new menu.
    save(ID("B"), "Two", "EditedAA");
    save(ID("C"), "Three");
    expect((await visit("/")).requests.flatMap((r) => r.titles).sort()).toEqual(["Three", "Two"]);
    expect((await visit("/")).requests).toEqual([]);
  });

  it("a save that only changes the date isn't sent again", async () => {
    save(ID("A"), "One", "SameAAAA", { updatedAt: 1 });
    await visit("/");
    save(ID("A"), "One", "SameAAAA", { updatedAt: 2 });
    expect((await visit("/")).requests).toEqual([]);
  });

  it("sends again if the new address couldn't save them", async () => {
    save(ID("A"), "One");
    const failed = await visit("/menu?encoded=x", { ok: false });
    expect(failed.final).toBe(`${NEW}/menu?encoded=x`);
    expect(local.getItem(SENT_KEY)).toBeNull();
    expect((await visit("/")).requests.flatMap((r) => r.titles)).toEqual(["One"]);
  });

  it("forgets menus that are gone, so its list doesn't grow", async () => {
    save(ID("A"), "One");
    save(ID("B"), "Two");
    await visit("/");
    expect(JSON.parse(local.getItem(SENT_KEY)!)).toHaveLength(2);
    local.removeItem(menuKey(ID("B")));
    await visit("/");
    expect(JSON.parse(local.getItem(SENT_KEY)!)).toHaveLength(1);
  });
});

describe("HO-4: replies", () => {
  it("ignores a reply that isn't this tab's: no new hand-off, just the home page", async () => {
    save(ID("A"), "One");
    const reply = at(`/#${encodeHandoffReply({ id: ID("Z"), ok: true })}`);
    expect(await run(reply)).toBe(`${NEW}/`);
    expect(local.getItem(SENT_KEY)).toBeNull();
    expect(session.getItem(VISIT_KEY)).toBeNull();
  });

  it("goes straight on if this tab can't keep track of the hand-off", async () => {
    save(ID("A"), "One");
    session.failWrites = true;
    expect(await visit("/library")).toEqual({ requests: [], final: `${NEW}/library` });
  });

  it("goes on if it can't record what was sent (storage full)", async () => {
    save(ID("A"), "One");
    const first = await run(at("/library"));
    const { id } = parseHandoffRequest(new URL(first).hash)!;
    local.failWrites = true;
    expect(await run(at(`/#${encodeHandoffReply({ id, ok: true })}`))).toBe(`${NEW}/library`);
  });

  it("ignores a damaged record of the visit", async () => {
    save(ID("A"), "One");
    session.setItem(VISIT_KEY, JSON.stringify({ id: ID("A"), dest: "https://evil.example/", pending: [], parts: 0 }));
    expect(await run(at(`/#${encodeHandoffReply({ id: ID("A"), ok: true })}`))).toBe(`${NEW}/`);
    session.setItem(VISIT_KEY, "{not json");
    expect(await run(at(`/#${encodeHandoffReply({ id: ID("A"), ok: true })}`))).toBe(`${NEW}/`);
  });
});
