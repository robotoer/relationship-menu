import { test, expect, Page } from "@playwright/test";
import { deflate } from "pako";

// Build links the same way the app does (pako + base64).
const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const slug = (title: string, menu: object, person?: object) =>
  [encode(title), encode(menu), ...(person ? [encode(person)] : [])].join(":");

// Recognisable text that must never reach analytics (spec PR-2).
const SECRET = "Zqx";
const MENU = {
  [`${SECRET} group`]: [
    { item: `${SECRET} kissing`, value: "must-have", note: `${SECRET} note` },
    { item: `${SECRET} cuddling` },
    { item: `${SECRET} dancing` },
    { item: `${SECRET} hiking` },
  ],
};
const PERSON = { name: `${SECRET} Ana` };

/** Every gtag call so far (index.html queues them in window.dataLayer). */
const gtagCalls = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? []).map((args) =>
      JSON.stringify(Array.from(args))
    )
  );

test.describe("Analytics (PR-2)", () => {
  test("tracks what people do, and never sends menu text, names, notes or links", async ({ page }) => {
    // window.dataLayer starts empty on every full page load: collect before leaving.
    const calls: string[] = [];
    const collect = async () => calls.push(...(await gtagCalls(page)));
    // Arrive from a shared menu link.
    await page.goto(`/menu?encoded=${encodeURIComponent(slug(`${SECRET} title`, MENU, PERSON))}`);
    await expect(page.locator(".menu-item").first()).toBeVisible();

    // Answer enough to pass a milestone, open the share dialog and copy a link.
    const pickers = page.locator(".menu-item select");
    await pickers.nth(1).selectOption("maybe");
    await pickers.nth(2).selectOption("maybe");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy template link" }).click();
    await page.keyboard.press("Escape");

    await expect(page.locator(".save-status")).toHaveText(/Saved/);
    await collect();
    // Compare two menus from a compare link, and use a filter.
    const other = slug("Other", { [`${SECRET} group`]: [{ item: `${SECRET} kissing`, value: "off-limits" }] });
    await page.goto(
      `/compare?encoded=${encodeURIComponent(slug(`${SECRET} title`, MENU, PERSON))}&encoded=${encodeURIComponent(other)}`
    );
    await expect(page.locator(".menu-item-compare").first()).toBeVisible();
    await page.getByRole("button", { name: /^Conflicts/ }).click();

    await collect();
    // Search the Library.
    await page.goto("/library");
    await page.getByRole("searchbox").fill(SECRET);
    await collect();

    const sent = calls
      .map((c) => JSON.parse(c))
      .filter((c) => c[0] === "event")
      .map((c) => ({ name: c[1] as string, params: c[2] as Record<string, unknown> }));
    const names = sent.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "page_view",
        "shared_link_opened",
        "menu_progress",
        "share_dialog_opened",
        "link_copied",
        "comparison_shown",
        "compare_filter_used",
        "library_searched",
      ])
    );
    expect(sent.find((e) => e.name === "shared_link_opened")!.params).toMatchObject({
      link_type: "menu",
      has_person: true,
      item_count: 4,
    });
    expect(sent.find((e) => e.name === "link_copied")!.params).toEqual({ link_type: "template" });
    expect(sent.find((e) => e.name === "comparison_shown")!.params).toMatchObject({
      menu_count: 2,
      source: "link",
      conflict_count: 1,
    });

    // Nothing anyone typed, and no link contents, ever leaves the browser.
    const everything = calls.join("\n");
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain("encoded");
  });
});
