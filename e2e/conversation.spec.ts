import { test, expect, Page, BrowserContext } from "@playwright/test";
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

const gtagCalls = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? []).map((a) => JSON.stringify(Array.from(a)))
  );

/** Copies the conversation link from the plan and returns it. */
const copyLink = async (page: Page) => {
  await page.getByRole("button", { name: "The plan" }).click().catch(() => {});
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied!" })).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
};

const newPerson = async (browser: import("@playwright/test").Browser, baseURL: string | undefined) => {
  const context: BrowserContext = await browser.newContext({ baseURL });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  return { context, page: await context.newPage() };
};

test.describe("Conversations: saved, in parts, and passed back and forth (spec §7c)", () => {
  test("save a comparison, take notes, and swap links to comment without being in the same room (CV-1..CV-11)", async ({
    browser,
    baseURL,
  }) => {
    test.skip(browser.browserType().name() !== "chromium", "clipboard permissions");
    const ana = await newPerson(browser, baseURL);
    const ben = await newPerson(browser, baseURL);

    // Ana saves the comparison and opens the conversation.
    await ana.page.goto(comparePath);
    await ana.page.getByRole("button", { name: "💾 Save this comparison" }).click();
    await ana.page.getByRole("link", { name: "Open the conversation" }).click();
    await expect(ana.page).toHaveURL(/\/talk\?id=/);
    await expect(ana.page.getByRole("heading", { level: 1, name: "Talk it through" })).toBeVisible();
    await ana.page.getByRole("combobox", { name: "On this device, I'm" }).selectOption({ label: "Ana" });

    // Tips and the plan.
    await ana.page.getByText("💡 Tips for hard conversations").click();
    await expect(ana.page.getByRole("region", { name: "When it gets heated" })).toBeVisible();
    await expect(ana.page.getByRole("textbox", { name: "Name of part 1" })).toBeVisible();

    // The area's insights and Ana's own notes, then a comment on a topic.
    await ana.page.getByRole("button", { name: "▶ Start" }).click();
    const touch = ana.page.getByRole("region", { name: "About Touch" });
    await expect(touch).toContainText("shared want");
    await touch.getByRole("textbox", { name: "Ana: What matters most to me here" }).fill("Zqx feeling close");
    await expect(ana.page.getByRole("heading", { level: 1, name: "Kissing" })).toBeVisible();
    const comments = ana.page.getByRole("region", { name: "Comments on Kissing" });
    await comments.getByRole("textbox", { name: "Add a comment" }).fill("Zqx can we start here?");
    await comments.getByRole("button", { name: "Add comment" }).click();
    await expect(comments).toContainText("Ana");
    const anaLink = await copyLink(ana.page);
    expect(anaLink).toMatch(/\/talk#c=/);

    // Ben opens it on his own phone: it's saved there, and he replies.
    await ben.page.goto(anaLink);
    await expect(ben.page.locator(".conv-notice")).toContainText("now saved in this browser");
    await expect(ben.page).toHaveURL(/\/talk\?id=/);
    expect(ben.page.url()).not.toContain("#c=");
    await ben.page.getByRole("combobox", { name: "On this device, I'm" }).selectOption({ label: "Ben" });
    await expect(ben.page.getByText(/1 new comment since you last looked/)).toBeVisible();
    await ben.page.getByRole("button", { name: "▶ Start" }).click();
    const benComments = ben.page.getByRole("region", { name: "Comments on Kissing" });
    await expect(benComments).toContainText("Zqx can we start here?");
    await expect(benComments.locator(".conv-new")).toBeVisible();
    await benComments.getByRole("textbox", { name: "Add a comment" }).fill("Yes, Sunday?");
    await benComments.getByRole("button", { name: "Add comment" }).click();
    const benLink = await copyLink(ben.page);

    // Ana opens Ben's reply: merged into her copy, nothing of hers lost.
    await ana.page.goto(benLink);
    await expect(ana.page.locator(".conv-notice")).toContainText("Brought up to date: 1 new comment");
    await ana.page.getByRole("button", { name: /Continue|Start/ }).first().click();
    const anaComments = ana.page.getByRole("region", { name: "Comments on Kissing" });
    await expect(anaComments).toContainText("Zqx can we start here?");
    await expect(anaComments).toContainText("Yes, Sunday?");
    await expect(ana.page.getByRole("region", { name: "About Touch" }).getByRole("textbox", { name: "Ana: What matters most to me here" })).toHaveValue("Zqx feeling close");

    // The Library lists it.
    await ana.page.goto("/library");
    await expect(ana.page.getByRole("heading", { name: "Your conversations" })).toBeVisible();
    await expect(ana.page.getByRole("link", { name: "Ana & Ben" })).toBeVisible();

    // Nothing anyone wrote reaches analytics.
    for (const page of [ana.page, ben.page]) {
      expect((await gtagCalls(page)).join("\n")).not.toContain("Zqx");
    }
    await ana.context.close();
    await ben.context.close();
  });

  test("nothing scrolls sideways on a small phone, with the area notes open (AX-4)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(comparePath);
    await page.getByRole("link", { name: /Talk it through/ }).click();
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(await noOverflow()).toBe(true);
    await page.getByRole("button", { name: "▶ Start" }).click();
    await expect(page.getByRole("region", { name: "About Touch" })).toBeVisible();
    expect(await noOverflow()).toBe(true);
  });
});
