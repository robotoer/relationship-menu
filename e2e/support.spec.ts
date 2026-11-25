import { test, expect, Page } from "@playwright/test";
import { deflate } from "pako";

const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const menuPath = (title: string, menu: object) =>
  `/menu?encoded=${encodeURIComponent(`${encode(title)}:${encode(menu)}`)}`;

/** Analytics events sent since this page load (index.html queues gtag calls in dataLayer). */
const events = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? [])
      .map((args) => Array.from(args))
      .filter((args) => args[0] === "event")
      .map((args) => ({ name: args[1] as string, params: args[2] as Record<string, unknown> }))
  );

test.describe("Support the project", () => {
  test("the navbar leads to the Support page; choosing an amount is recorded and clearly not a payment", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("link", { name: "Support", exact: true }).click();
    await expect(page).toHaveURL(/\/support$/);
    await expect(page.getByRole("heading", { level: 1, name: "Support Relationship Menu" })).toBeVisible();

    await page.getByRole("button", { name: /\$12 \/ year/ }).click();
    const notice = page.getByRole("status");
    await expect(notice).toContainText("hasn't charged you anything");
    await expect(notice).toBeFocused();

    const sent = await events(page);
    expect(sent).toEqual(
      expect.arrayContaining([
        { name: "support_viewed", params: { from: "nav" } },
        { name: "support_option_chosen", params: { amount_usd: 12, plan: "yearly" } },
      ])
    );
  });

  test("after sharing, the share dialog mentions supporting the project", async ({ page }) => {
    await page.goto(menuPath("Ours", { G: [{ item: "Alpha", value: "maybe" }] }));
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.getByRole("link", { name: "Support the project" })).toHaveCount(0);
    await page.getByRole("button", { name: "Copy template link" }).click();
    await page.getByRole("link", { name: "Support the project" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Support Relationship Menu" })).toBeVisible();
    await expect
      .poll(() => events(page))
      .toEqual(expect.arrayContaining([{ name: "support_viewed", params: { from: "share" } }]));
  });

  test("the landing page and comparison results link to it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "support the project" })).toHaveAttribute("href", "/support");
    const a = `${encode("A")}:${encode({ G: [{ item: "Kissing", value: "must-have" }] })}`;
    const b = `${encode("B")}:${encode({ G: [{ item: "Kissing", value: "maybe" }] })}`;
    await page.goto(`/compare?encoded=${encodeURIComponent(a)}&encoded=${encodeURIComponent(b)}`);
    await expect(page.getByRole("link", { name: "Support Relationship Menu" })).toHaveAttribute("href", "/support");
  });
});
