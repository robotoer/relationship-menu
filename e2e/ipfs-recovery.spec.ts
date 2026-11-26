import { test, expect, Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { deflate } from "pako";

/**
 * SY-91, SY-92: menus that the IPFS version (July 2024 – March 2026) kept only in
 * Helia's IndexedDB block store come back into the Library, and the old store is
 * left untouched.
 */

const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");

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

/** A JSON block as Helia's @helia/json stored it: its CID and block-store key. */
const heliaBlock = (doc: object) => {
  const json = JSON.stringify(doc);
  const digest = createHash("sha256").update(json).digest();
  const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), digest]);
  const cid = "b" + base32(Buffer.concat([Buffer.from([0x01, 0x80, 0x04]), multihash]));
  return { json, cid, key: `/B${base32(multihash).toUpperCase()}` };
};

const seedIpfsEra = (page: Page, blocks: { json: string; cid: string; key: string }[], date: string) =>
  page.evaluate(
    ({ blocks, date }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("helia-blocks", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("helia-blocks");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("helia-blocks", "readwrite");
          for (const block of blocks) {
            tx.objectStore("helia-blocks").put(new TextEncoder().encode(block.json), block.key);
            localStorage.setItem(`menu:${block.cid}`, date);
          }
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    { blocks, date }
  );

test("SY-91: a menu only the IPFS version kept appears in the Library again", async ({ page }) => {
  const menu = { Together: [{ item: "Cooking dinner", value: "must-have" }, { item: "Weekend trips" }] };
  const recovered = heliaBlock({ title: "Saved in 2025", encoded: encode(menu) });
  await page.goto("/");
  await seedIpfsEra(page, [recovered], "2025-06-01T12:00:00.000Z");

  await page.goto("/library");
  const tiles = page.locator(".menu-tile");
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first().locator("h2")).toHaveText("Saved in 2025");
  // It opens with its items intact.
  await tiles.first().getByRole("link").first().click();
  await expect(page.locator(".menu-group").first()).toContainText("Cooking dinner");
  await expect(page.locator(".menu-group").first()).toContainText("Weekend trips");
  await expect(page.locator(".menu-item select").first()).toHaveValue("must-have");

  // SY-92: the old block store is still there, unchanged.
  const blocks = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("helia-blocks");
        open.onsuccess = () => {
          const count = open.result.transaction("helia-blocks").objectStore("helia-blocks").count();
          count.onsuccess = () => resolve(count.result);
        };
      })
  );
  expect(blocks).toBe(1);
});

test("SY-91: a pointer whose data is gone isn't shown as an unreadable menu", async ({ page }) => {
  await page.goto("/");
  const missing = heliaBlock({ title: "Lost", encoded: encode({ G: [{ item: "x" }] }) });
  await page.evaluate((cid) => localStorage.setItem(`menu:${cid}`, "2025-06-01T12:00:00.000Z"), missing.cid);
  await page.goto("/library");
  await expect(page.locator(".menu-tile")).toHaveCount(0);
});
