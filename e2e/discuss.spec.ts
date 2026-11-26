import { test, expect, Page } from "@playwright/test";
import { deflate } from "pako";

const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const slug = (title: string, menu: object, person?: object) =>
  [encode(title), encode(menu), ...(person ? [encode(person)] : [])].join(":");

const ANA = slug(
  "Ana's menu",
  {
    Touch: [
      { item: "Kissing", value: "must-have" },
      { item: "Cuddling", value: "like-to-have" },
    ],
    Future: [
      { item: "Kids", value: "must-have" },
      { item: "Pets", value: "like-to-have" },
    ],
  },
  { name: "Ana" }
);
const BEN = slug(
  "Ben's menu",
  {
    Touch: [
      { item: "Kissing", value: "must-have" },
      { item: "Cuddling", value: "maybe" },
    ],
    Future: [
      { item: "Kids", value: "off-limits" },
      { item: "Pets" },
    ],
  },
  { name: "Ben" }
);
const comparePath = `/compare?encoded=${encodeURIComponent(ANA)}&encoded=${encodeURIComponent(BEN)}`;

/** Every gtag call on this page (index.html queues them in dataLayer). */
const gtagCalls = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? []).map((a) => JSON.stringify(Array.from(a)))
  );

test.describe("Compare overview and guided discussion", () => {
  test("the overview summarises the comparison, and its tiles filter the list (CP-20..CP-24)", async ({ page }) => {
    await page.goto(comparePath);
    const overview = page.getByRole("region", { name: "At a glance" });
    await expect(overview).toContainText("You agree on 33% of the 3 items everyone answered, with 1 conflict.");
    await expect(overview).toContainText("1 item isn't answered by everyone yet.");
    await expect(overview.getByRole("listitem").filter({ hasText: "Kids" }).first()).toBeVisible();

    await overview.getByRole("button", { name: /Conflicts: 1/ }).click();
    const grid = page.locator(".compare-page-grid");
    await expect(grid.locator(".menu-item-compare")).toHaveCount(1);
    await expect(grid).toContainText("Kids");

    await page.getByRole("button", { name: "Show everything" }).click();
    await page.getByRole("combobox", { name: "Order" }).selectOption("difference");
    await expect(grid.locator(".menu-item-compare .menu-item").first()).toHaveText("Kids · Future");
  });

  test("talk it through: topics, notes and outcomes, a summary, and notes kept on reload (DS-1..DS-7)", async ({ page }) => {
    await page.goto(comparePath);
    await page.getByRole("link", { name: /Talk it through/ }).click();
    await expect(page).toHaveURL(/\/discuss\?/);
    await expect(page.getByRole("heading", { level: 1, name: "Talk it through" })).toBeVisible();
    await expect(page.getByText(/Ana & Ben: 4 topics/)).toBeVisible();

    await page.getByRole("button", { name: "▶ Start" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Kissing" })).toBeVisible();
    await page.getByRole("button", { name: /Skip for now/ }).click(); // Cuddling (difference)
    await page.getByRole("button", { name: /Skip for now/ }).click(); // Kids (conflict)
    await expect(page.getByRole("heading", { level: 1, name: "Kids" })).toBeVisible();
    await page.getByRole("textbox", { name: "What came up?" }).fill("Zqx private note");
    await page.getByRole("radio", { name: /Revisit later/ }).check();
    await page.getByRole("textbox", { name: "Next step (optional)" }).fill("Talk again in spring");

    await page.getByRole("button", { name: "Summary" }).click();
    const revisit = page.locator("section").filter({ has: page.getByRole("heading", { name: /Revisit later/ }) });
    await expect(revisit).toContainText("Kids");
    await expect(revisit).toContainText("Zqx private note");
    await expect(revisit).toContainText("Talk again in spring");

    // Notes survive a reload, and you can carry on where you left off.
    await page.reload();
    await page.getByRole("button", { name: /Continue \(1 of 4 done\)/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Kissing" })).toBeVisible();

    // Nothing written in the discussion reaches analytics.
    const calls = (await gtagCalls(page)).join("\n");
    expect(calls).not.toContain("Zqx");
    expect(calls).toContain("discussion_started");
  });

  test("nothing scrolls sideways on a small phone (AX-4)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const noOverflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await page.goto(comparePath);
    await expect(page.getByRole("region", { name: "At a glance" })).toBeVisible();
    expect(await noOverflow()).toBe(true);
    await page.getByRole("link", { name: /Talk it through/ }).click();
    await page.getByRole("button", { name: "▶ Start" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Kissing" })).toBeVisible();
    expect(await noOverflow()).toBe(true);
  });
});
