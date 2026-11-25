import { test, expect } from "@playwright/test";
import { deflate, inflate } from "pako";
import { getShareValues } from "./helpers";

// Build and read links the same way the app does (pako + base64), without the UI.
const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const decode = (data: string) => JSON.parse(inflate(Buffer.from(data, "base64"), { to: "string" }));
const slug = (title: string, menu: object, person?: object) =>
  [encode(title), encode(menu), ...(person ? [encode(person)] : [])].join(":");
const menuPath = (title: string, menu: object) => `/menu?encoded=${encodeURIComponent(slug(title, menu))}`;

const MENU = {
  Touch: [
    { item: "Kissing", value: "must-have" },
    { item: "Cuddling", value: "maybe" },
  ],
  Later: [{ item: "Trust" }],
};

test.describe("Item notes (DM-6, LK-9, PR-3)", () => {
  test("a note is saved, shared in the menu link and left out of the template link", async ({ page }) => {
    await page.goto(menuPath("Notes", MENU));
    await page.getByRole("button", { name: "Add a note to Kissing" }).click();
    const note = page.getByRole("textbox", { name: "Note on Kissing", exact: true });
    await expect(note).toBeFocused();
    await note.fill("not in public");

    // It survives a reload (autosave) ...
    await page.waitForTimeout(800);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Note on Kissing", exact: true })).toHaveValue("not in public");

    // ... travels in the menu link, but not the template link.
    const { menuSlug, templateSlug } = await getShareValues(page);
    expect(decode(menuSlug.split(":")[1]).Touch[0]).toMatchObject({ item: "Kissing", note: "not in public" });
    expect(JSON.stringify(decode(templateSlug.split(":")[1]))).not.toContain("not in public");
  });

  test("n opens the note for the highlighted item", async ({ page }) => {
    await page.goto(menuPath("Keys", MENU));
    await page.locator(".menu-item").filter({ has: page.locator('input[value="Kissing"]') }).focus();
    await page.keyboard.press("n");
    await expect(page.getByRole("textbox", { name: "Note on Kissing", exact: true })).toBeFocused();
    await page.keyboard.type("ask first");
    await expect(page.getByRole("textbox", { name: "Note on Kissing", exact: true })).toHaveValue("ask first");
  });

  test("Compare shows each person's note under the item (CP-14)", async ({ page }) => {
    const a = slug("A", { G: [{ item: "Kissing", value: "must-have", note: "not in public" }] }, { name: "Ana" });
    const b = slug("B", { G: [{ item: "kissing", value: "must-have" }] }, { name: "Ben" });
    await page.goto(`/compare?encoded=${encodeURIComponent(a)}&encoded=${encodeURIComponent(b)}`);
    const notes = page.getByRole("list", { name: "Notes on Kissing" });
    await expect(notes).toContainText("Ana: not in public");
    await expect(notes).not.toContainText("Ben");
    // Notes don't change the verdict: both want it.
    await expect(page.getByRole("button", { name: /^All want/ })).toContainText("1");
  });
});

test.describe("Make into group (ED-14)", () => {
  test("turns an item into a group right after its own, keeping its answer; undo restores", async ({ page }) => {
    await page.goto(menuPath("Groups", MENU));
    await page.getByRole("button", { name: 'Make "Kissing" into a group' }).click();

    const titles = page.locator(".menu-group-header input");
    await expect(titles).toHaveCount(4); // Touch, Kissing, Later + the new-group row
    await expect(titles.nth(0)).toHaveValue("Touch");
    await expect(titles.nth(1)).toHaveValue("Kissing");
    await expect(titles.nth(2)).toHaveValue("Later");

    const newGroup = page.locator(".menu-group").nth(1);
    await expect(newGroup.locator(".menu-item-input").first()).toHaveValue("Kissing");
    await expect(newGroup.locator("select").first()).toHaveValue("must-have");
    await expect(page.locator(".menu-group").nth(0).locator('input[value="Kissing"]')).toHaveCount(0);

    // One undo step brings it back.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(titles).toHaveCount(3);
    await expect(page.locator(".menu-group").nth(0).locator(".menu-item-input").first()).toHaveValue("Kissing");
  });

  test("is disabled, with a reason, when a group already has that name; m does nothing then", async ({ page }) => {
    await page.goto(menuPath("Taken", { Touch: [{ item: "Later" }], Later: [] }));
    const button = page.getByRole("button", { name: 'Make "Later" into a group' });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("title", "There's already a group with this name");
    await page.locator(".menu-item").filter({ has: page.locator('input[value="Later"]') }).first().focus();
    await page.keyboard.press("m");
    await expect(page.locator(".menu-group-header input")).toHaveCount(3);
  });

  test("m makes the highlighted item into a group", async ({ page }) => {
    await page.goto(menuPath("Keys", MENU));
    await page.locator(".menu-item").filter({ has: page.locator('input[value="Cuddling"]') }).focus();
    await page.keyboard.press("m");
    await expect(page.locator(".menu-group-header input").nth(1)).toHaveValue("Cuddling");
  });
});
