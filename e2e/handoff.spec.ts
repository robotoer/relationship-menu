import { test, expect, Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { deflate } from "pako";

/**
 * The move from relationship-menu.vercel.app to wantsandwonts.com (spec §12,
 * HO-3…HO-7), with two local origins standing in: the hand-off page on
 * 127.0.0.1:3098 (`yarn start:handoff`) and the app on localhost:3099. Different
 * hosts, so their storage is separate, as on the real addresses.
 */

const OLD = process.env.E2E_OLD_ORIGIN ?? "http://127.0.0.1:3098";
let NEW = "";
test.beforeEach(({ baseURL }) => {
  NEW = new URL(baseURL!).origin;
});

const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const slug = (title: string, menu: unknown) => `${encode(title)}:${encode(menu)}`;

/** A page on `origin` that runs nothing, for reading or seeding that origin's storage. */
const openBlank = async (page: Page, origin: string) => {
  await page.route(`${origin}/__blank`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>blank</title>" })
  );
  await page.goto(`${origin}/__blank`);
};

const setItems = async (page: Page, origin: string, items: Record<string, string>) => {
  await openBlank(page, origin);
  await page.evaluate((items) => {
    for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
  }, items);
};

const allItems = async (page: Page, origin: string) => {
  await openBlank(page, origin);
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)!])));
};

type Stored = { title: string; encoded: string; person?: unknown };
/** The new address's saved menus, id → menu. */
const newMenus = async (page: Page) => {
  const items = await allItems(page, NEW);
  return Object.fromEntries(
    Object.entries(items)
      .filter(([key]) => key.startsWith("menu-v2:"))
      .map(([key, value]) => [key.slice("menu-v2:".length), JSON.parse(value) as Stored])
  );
};
const newTitles = async (page: Page) => Object.values(await newMenus(page)).map((m) => m.title).sort();

const v2 = (id: string, title: string, menu: unknown, extra: object = {}) => ({
  [`menu-v2:${id.padEnd(22, "A")}`]: JSON.stringify({ title, encoded: encode(menu), savedAt: Date.now(), ...extra }),
});

/** Every top-level address the tab goes through, including history replacements. */
const recordAddresses = (page: Page) => {
  const addresses: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) addresses.push(frame.url());
  });
  return addresses;
};

/** The titles in each hand-off request this tab made (read from the /import addresses). */
const requestedTitles = (addresses: string[]) =>
  addresses
    .filter((url) => url.startsWith(`${NEW}/import#`))
    .map((url) => {
      const menus = JSON.parse(new URLSearchParams(new URL(url).hash.slice(1)).get("menus")!) as Stored[];
      return menus.map((m) => m.title).sort();
    });

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const base32 = (bytes: Uint8Array) => {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

/** Puts a menu where only the IPFS version kept it (SY-91): a block in IndexedDB, a date in localStorage. */
const seedIpfsOnly = async (page: Page, doc: object) => {
  const json = JSON.stringify(doc);
  const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), createHash("sha256").update(json).digest()]);
  const cid = "b" + base32(Buffer.concat([Buffer.from([0x01, 0x80, 0x04]), multihash]));
  const key = `/B${base32(multihash).toUpperCase()}`;
  await openBlank(page, OLD);
  await page.evaluate(
    ({ json, cid, key }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("helia-blocks", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("helia-blocks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("helia-blocks", "readwrite");
          tx.objectStore("helia-blocks").put(new TextEncoder().encode(json), key);
          localStorage.setItem(`menu:${cid}`, "2025-06-01T12:00:00.000Z");
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    { json, cid, key }
  );
};

test.describe("HO-3: every old link keeps working", () => {
  test("HO-3: old links go to the same path, query and fragment on the new address", async ({ page }) => {
    const addresses = recordAddresses(page);
    await page.goto(`${OLD}/library?from=old#section`);
    await expect(page).toHaveURL(`${NEW}/library?from=old#section`);
    await expect(page.getByRole("heading", { name: "Your menus" })).toBeVisible();
    // Nothing saved at the old address, so nothing was sent.
    expect(requestedTitles(addresses)).toEqual([]);
  });

  test("HO-3: a menu link and a compare link open on the new address", async ({ page }) => {
    const ours = slug("Our menu", { Together: [{ item: "Walks", value: "must-have" }] });
    const theirs = slug("Their menu", { Together: [{ item: "Walks", value: "maybe" }] });

    await page.goto(`${OLD}/menu?encoded=${encodeURIComponent(ours)}`);
    await expect(page).toHaveURL(new RegExp(`^${NEW}/menu\\?encoded=`));
    await expect(page.locator("input.menu-title")).toHaveValue("Our menu");

    await page.goto(`${OLD}/compare?encoded=${encodeURIComponent(ours)}&encoded=${encodeURIComponent(theirs)}`);
    await expect(page).toHaveURL(new RegExp(`^${NEW}/compare\\?encoded=`));
    await expect(page.getByText("Walks").first()).toBeVisible();
  });
});

test.describe("HO-4…HO-6: saved menus move once, without overwriting", () => {
  test("HO-4, HO-5: menus saved at the old address, in every format, arrive in the new Library", async ({ page }) => {
    await setItems(page, OLD, {
      ...v2("current", "Current menu", { G: [{ item: "Walks", value: "must-have" }] }, { person: { name: "Sam" } }),
      "menu:Older menu": JSON.stringify({ title: "Older menu", encoded: encode({ G: [{ item: "Tea" }] }), savedAt: 5 }),
      "menu:Oldest menu": encode({ H: [{ item: "Letters", value: "maybe" }] }),
    });
    await seedIpfsOnly(page, { title: "IPFS menu", encoded: encode({ I: [{ item: "Picnics" }] }) });
    const before = await allItems(page, OLD);

    const addresses = recordAddresses(page);
    await page.goto(`${OLD}/library`);
    await expect(page).toHaveURL(`${NEW}/library`);
    await expect(page.locator(".menu-tile")).toHaveCount(4);
    expect((await page.locator(".menu-tile h2").allInnerTexts()).sort()).toEqual([
      "Current menu",
      "IPFS menu",
      "Older menu",
      "Oldest menu",
    ]);
    expect(requestedTitles(addresses)).toEqual([["Current menu", "IPFS menu", "Older menu", "Oldest menu"]]);

    // HO-5: the importer took the menus out of the address bar before doing anything else.
    const arrived = addresses.findIndex((url) => url.startsWith(`${NEW}/import#handoff=1`));
    expect(arrived).toBeGreaterThanOrEqual(0);
    expect(addresses[arrived + 1]).toBe(`${NEW}/import`);
    expect(addresses.slice(arrived + 1).some((url) => url.includes("handoff=1"))).toBe(false);
    // Then replied to the old address, which went on to the page asked for.
    const steps = addresses
      .slice(arrived + 1)
      .map((url) => url.split("#")[0])
      .filter((url, i, all) => url !== all[i - 1]);
    expect(steps).toEqual([`${NEW}/import`, `${OLD}/`, `${NEW}/library`]);
    // Every step replaced the last, so none (and no menus) stay in this tab's
    // history: Back goes to where the tab was before the old link.
    await page.goBack();
    await expect(page).toHaveURL(`${OLD}/__blank`);

    // The person info came along.
    const current = Object.values(await newMenus(page)).find((m) => m.title === "Current menu");
    expect(current?.person).toEqual({ name: "Sam" });

    // HO-6: nothing at the old address was deleted or changed (IPFS-only menus were
    // copied into browser storage, as the app itself did, under the same key).
    const after = await allItems(page, OLD);
    for (const [key, value] of Object.entries(before)) {
      expect(after[key], key).toBeDefined();
      if (!/^menu:b[a-z2-7]+$/.test(key)) expect(after[key], key).toBe(value);
    }
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), "handoff:sent"].sort());
  });

  test("HO-5: nothing on the new address is overwritten", async ({ page }) => {
    const mine = { G: [{ item: "Mine", value: "must-have" }] };
    const same = { G: [{ item: "Shared", value: "maybe" }] };
    await setItems(page, NEW, {
      ...v2("mine", "Ours", mine),
      ...v2("same", "Same", same),
    });
    const before = await newMenus(page);
    await setItems(page, OLD, {
      ...v2("old-ours", "Ours", { G: [{ item: "From the old address" }] }),
      ...v2("old-same", "Same", same),
    });

    await page.goto(`${OLD}/library`);
    await expect(page).toHaveURL(`${NEW}/library`);
    await expect(page.locator(".menu-tile")).toHaveCount(3);

    const after = await newMenus(page);
    expect(Object.values(after).map((m) => m.title).sort()).toEqual(["Ours", "Ours (2)", "Same"]);
    // The menus that were already here are untouched, under the same ids.
    for (const [id, menu] of Object.entries(before)) {
      expect(after[id]?.title).toBe(menu.title);
      expect(after[id]?.encoded).toBe(menu.encoded);
    }
  });

  test("HO-6: a second visit sends only what changed at the old address", async ({ page }) => {
    await setItems(page, OLD, {
      ...v2("one", "One", { G: [{ item: "First" }] }),
      ...v2("two", "Two", { G: [{ item: "Second" }] }),
    });
    let addresses = recordAddresses(page);
    await page.goto(`${OLD}/`);
    await expect(page).toHaveURL(`${NEW}/`);
    expect(requestedTitles(addresses)).toEqual([["One", "Two"]]);

    // Nothing changed: straight through, nothing sent.
    page.removeAllListeners("framenavigated");
    addresses = recordAddresses(page);
    await page.goto(`${OLD}/compare`);
    await expect(page).toHaveURL(`${NEW}/compare`);
    expect(addresses.filter((url) => url.startsWith(`${NEW}/import`))).toEqual([]);

    // An old tab saves an edit and a new menu: only those two go.
    await setItems(page, OLD, {
      ...v2("two", "Two", { G: [{ item: "Second", value: "must-have" }] }),
      ...v2("three", "Three", { G: [{ item: "Third" }] }),
    });
    page.removeAllListeners("framenavigated");
    addresses = recordAddresses(page);
    await page.goto(`${OLD}/library`);
    await expect(page).toHaveURL(`${NEW}/library`);
    expect(requestedTitles(addresses)).toEqual([["Three", "Two"]]);
    // The edit arrives as a copy: the earlier "Two" is never overwritten (HO-5).
    expect(await newTitles(page)).toEqual(["One", "Three", "Two", "Two (2)"]);
  });

  test("HO-4: many menus travel in parts of at most 32 KB", async ({ page }) => {
    // Random item text doesn't compress, so 30 of these need several parts.
    const items: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      const menu = { G: Array.from({ length: 20 }, () => ({ item: randomBytes(60).toString("base64") })) };
      Object.assign(items, v2(`m${String(i).padStart(2, "0")}`, `Menu ${i}`, menu));
    }
    await setItems(page, OLD, items);

    const addresses = recordAddresses(page);
    await page.goto(`${OLD}/library`);
    await expect(page).toHaveURL(`${NEW}/library`, { timeout: 30_000 });
    const parts = addresses.filter((url) => url.startsWith(`${NEW}/import#`));
    expect(parts.length).toBeGreaterThan(1);
    for (const url of parts) expect(url.length).toBeLessThanOrEqual(32 * 1024);
    expect(requestedTitles(addresses).flat()).toHaveLength(30);
    await expect(page.locator(".menu-tile")).toHaveCount(30);
  });
});

test.describe("HO-7: the empty Library points to the old address", () => {
  test("HO-7: following the hint brings menus saved at the old address", async ({ page }) => {
    await setItems(page, OLD, v2("old", "Saved long ago", { G: [{ item: "Walks" }] }));
    await page.goto(`${NEW}/library`);
    await expect(page.getByText(/Used this app before at/)).toBeVisible();
    await page.getByRole("link", { name: new URL(OLD).host }).click();
    await expect(page).toHaveURL(`${NEW}/library`);
    await expect(page.locator(".menu-tile h2")).toHaveText(["Saved long ago"]);
    await expect(page.getByText(/Used this app before at/)).toHaveCount(0);
  });
});
