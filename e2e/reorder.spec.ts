import { test, expect } from "@playwright/test";
import { deflate } from "pako";

const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const menu = {
  Touch: [
    { item: "Kissing", value: "must-have" },
    { item: "Cuddling" },
  ],
  Future: [{ item: "Kids", value: "maybe" }],
};
const path = `/menu?encoded=${encodeURIComponent(`${encode("Ours")}:${encode(menu)}`)}`;

test.describe("Reordering items and groups (ED-7, ED-23)", () => {
  test("on a small phone, ▲▼ move items and groups, nothing scrolls sideways, and the order is saved", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(path);
    await expect(page.getByRole("textbox", { name: "Item", exact: true }).first()).toHaveValue("Kissing");
    await page.getByRole("button", { name: "↕ Reorder" }).click();
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await noOverflow()).toBe(true);

    await page.getByRole("button", { name: 'Move "Kissing" down' }).click();
    await page.getByRole("button", { name: 'Move group "Future" up' }).click();
    const items = page.getByRole("textbox", { name: "Item", exact: true });
    await expect(items.nth(0)).toHaveValue("Kids");
    await expect(items.nth(1)).toHaveValue("Cuddling");
    await expect(items.nth(2)).toHaveValue("Kissing");
    await page.getByRole("button", { name: "✓ Done reordering" }).click();

    // Saved: the Library's copy opens in the new order.
    await expect(page.getByText(/Saved/).first()).toBeVisible();
    await page.goto("/library");
    await page.getByRole("link", { name: "View" }).first().click();
    await expect(page.getByRole("textbox", { name: "Item", exact: true }).nth(0)).toHaveValue("Kids");
    await expect(page.getByRole("textbox", { name: "Item", exact: true }).nth(2)).toHaveValue("Kissing");
  });
});
