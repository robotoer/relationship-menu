import { test, expect, Browser, BrowserContext, Page, Route } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { deflate } from "pako";

const encode = (data: unknown) => Buffer.from(deflate(JSON.stringify(data))).toString("base64");
const slug = (title: string, menu: object, person?: object) =>
  [encode(title), encode(menu), ...(person ? [encode(person)] : [])].join(":");
const ANA = slug("Ana's menu", { Touch: [{ item: "Kissing", value: "must-have" }], Future: [{ item: "Kids", value: "must-have" }] }, { name: "Ana" });
const BEN = slug("Ben's menu", { Touch: [{ item: "Kissing", value: "must-have" }], Future: [{ item: "Kids", value: "off-limits" }] }, { name: "Ben" });
const comparePath = `/compare?encoded=${encodeURIComponent(ANA)}&encoded=${encodeURIComponent(BEN)}`;
const b64url = (b: Buffer) => b.toString("base64url");

/**
 * The sync and box servers (docs/spec/notifications.md §7a), in this test process,
 * shared by every browser. Signatures aren't checked here (the Worker's tests and
 * the app's fake do that); everything else follows the protocol. It also records
 * every request body, to check that nothing readable is ever sent (NT-60).
 */
const createServer = () => {
  type Box = { joinHash: string; host: string; seq: number; members: Set<string>; copies: Map<string, { version: number; seq: number; body: Buffer }> };
  const boxes = new Map<string, Box>();
  const bodies: string[] = [];
  const subscriptions: { boxId: string; endpoint: string }[] = [];
  const memberOf = (auth: string | undefined) => {
    const key = auth?.match(/key=([^,]+)/)?.[1];
    return key ? b64url(createHash("sha256").update(Buffer.from(key, "base64url")).digest().subarray(0, 16)) : null;
  };
  const handle = async (route: Route) => {
    const req = route.request();
    const { pathname, searchParams } = new URL(req.url());
    const body = req.postDataBuffer() ?? Buffer.alloc(0);
    bodies.push(body.toString("latin1"));
    const reply = (status: number, data?: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: data === undefined ? "" : JSON.stringify(data) });
    if (pathname === "/v1/account")
      return reply(200, {
        status: "active", plan: "supporter_12_yearly", renewsAt: Date.UTC(2027, 10, 1), readOnly: false, lapsedAt: null,
        purgeAt: null, purgeSoon: false, limits: { menus: 500, menuBytes: 65536, totalBytes: 4194304 }, usage: { menus: 0, bytes: 0 },
      });
    if (pathname.startsWith("/v1/menus")) return reply(200, { menus: [], next: 0, more: false, resync: false, purged: 0 });
    if (pathname === "/v1/push/key") return reply(200, { key: b64url(Buffer.concat([Buffer.from([4]), randomBytes(64)])) });
    if (pathname === "/v1/boxes" && req.method() === "POST") {
      const { boxId, joinHash, hostKey } = JSON.parse(body.toString());
      const host = b64url(createHash("sha256").update(Buffer.from(hostKey, "base64url")).digest().subarray(0, 16));
      boxes.set(boxId, { joinHash, host, seq: 0, members: new Set([host]), copies: new Map() });
      return reply(201, { boxId, memberId: host, inviteExpiresAt: Date.now() + 7 * 86_400_000 });
    }
    let m = pathname.match(/^\/v1\/boxes\/([^/]+)\/members$/);
    if (m && req.method() === "POST") {
      const box = boxes.get(m[1]);
      if (!box) return reply(404, { error: "not_found" });
      const { key, join } = JSON.parse(body.toString());
      if (b64url(createHash("sha256").update(Buffer.from(join, "base64url")).digest()) !== box.joinHash) return reply(403, { error: "bad_join" });
      const id = b64url(createHash("sha256").update(Buffer.from(key, "base64url")).digest().subarray(0, 16));
      box.members.add(id);
      return reply(201, { memberId: id });
    }
    const boxId = pathname.match(/^\/v1\/boxes\/([^/]+)/)?.[1] ?? "";
    const box = boxes.get(boxId);
    if (!box) return reply(404, { error: "not_found" });
    const me = memberOf(req.headers()["authorization"]);
    if (!me || !box.members.has(me)) return reply(401, { error: "unauthorized" });
    if (pathname.endsWith("/copies") && req.method() === "GET") {
      const since = Number(searchParams.get("since") ?? 0);
      const copies = [...box.copies].filter(([, c]) => c.seq > since).map(([memberId, c]) => ({ memberId, version: c.version, seq: c.seq, updatedAt: 1, ciphertext: b64url(c.body) }));
      return reply(200, { copies, seq: box.seq, readOnly: false, members: box.members.size });
    }
    if (/\/copies\/[^/]+$/.test(pathname) && req.method() === "PUT") {
      const current = box.copies.get(me);
      const ifMatch = req.headers()["if-match"]?.replace(/"/g, "");
      if ((req.headers()["if-none-match"] === "*" && current) || (ifMatch && Number(ifMatch) !== current?.version))
        return reply(412, { error: "version_mismatch", current: current ? { version: current.version } : null });
      box.seq++;
      box.copies.set(me, { version: (current?.version ?? 0) + 1, seq: box.seq, body });
      return reply(200, { version: (current?.version ?? 0) + 1, seq: box.seq });
    }
    if (pathname.endsWith("/subscriptions") && req.method() === "POST") {
      subscriptions.push({ boxId, endpoint: JSON.parse(body.toString()).endpoint });
      return reply(201, { subId: `sub${subscriptions.length}`.padEnd(22, "x") });
    }
    if (pathname.endsWith("/members/me") && req.method() === "DELETE") {
      box.members.delete(me);
      box.copies.delete(me);
      return reply(204);
    }
    if (req.method() === "DELETE") {
      boxes.delete(boxId);
      return reply(204);
    }
    return reply(404, { error: "not_found" });
  };
  return { boxes, bodies, subscriptions, handle };
};

const person = async (browser: Browser, baseURL: string | undefined, server: ReturnType<typeof createServer>, supporter: boolean) => {
  const context: BrowserContext = await browser.newContext({ baseURL });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.route(/\/v1\//, server.handle);
  if (supporter) {
    const code = b64url(randomBytes(32));
    await context.addInitScript((c) => {
      if (!localStorage.getItem("sync:code")) localStorage.setItem("sync:code", c);
    }, code);
  }
  return { context, page: await context.newPage() };
};

test.describe("Live sharing (docs/spec/notifications.md, NT-10…NT-16, NT-30, NT-60)", () => {
  test("a supporter shares live; the other person joins from the invite; comments arrive both ways; then leave and stop", async ({ browser, baseURL }) => {
    test.skip(browser.browserType().name() !== "chromium", "clipboard permissions");
    const server = createServer();
    const ana = await person(browser, baseURL, server, true);
    const ben = await person(browser, baseURL, server, false);

    await ana.page.goto(comparePath);
    await ana.page.getByRole("button", { name: "💾 Save this comparison" }).click();
    await ana.page.getByRole("link", { name: "Open the conversation" }).click();
    await ana.page.getByRole("button", { name: "Share live…" }).click();
    const live = ana.page.getByRole("region", { name: "Shared live" });
    await expect(live).toContainText(/Live · 1 device/);
    await live.getByRole("button", { name: "Copy invite link" }).click();
    const invite = await ana.page.evaluate(() => navigator.clipboard.readText());
    expect(invite).toMatch(/\/talk#live=/);

    // Ben joins: the key leaves the address bar, and he has the conversation.
    await ben.page.goto(invite);
    await expect(ben.page.locator(".conv-notice")).toContainText("You've joined this conversation");
    await expect(ben.page).toHaveURL(/\/talk\?id=/);
    expect(ben.page.url()).not.toContain("live=");
    await expect(ben.page.getByRole("region", { name: "Shared live" })).toContainText(/Live · 2 devices/);
    await expect(ben.page.getByRole("button", { name: "Copy invite link" })).toHaveCount(0);

    // Ben comments; it reaches Ana when her page syncs (here: "Update now").
    await ben.page.getByRole("combobox", { name: "On this device, I'm" }).selectOption({ label: "Ben" });
    await ben.page.getByRole("button", { name: "▶ Start" }).click();
    const benComments = ben.page.getByRole("region", { name: "Comments on Kissing" });
    await benComments.getByRole("textbox", { name: "Add a comment" }).fill("Zqx live from Ben");
    await benComments.getByRole("button", { name: "Add comment" }).click();
    await ben.page.getByRole("button", { name: "The plan" }).click();
    await ben.page.getByRole("button", { name: "Update now" }).click();
    await expect(ben.page.getByRole("region", { name: "Shared live" })).toContainText(/up to date/);

    await ana.page.getByRole("button", { name: "Update now" }).click();
    await ana.page.getByRole("button", { name: "▶ Start" }).click();
    await expect(ana.page.getByRole("region", { name: "Comments on Kissing" })).toContainText("Zqx live from Ben");

    // Nothing readable ever reached the server (NT-60).
    expect(server.bodies.join("\n")).not.toContain("Zqx");
    expect(server.bodies.join("\n")).not.toContain("Kissing");

    // Ben leaves; Ana stops sharing. Both keep the conversation.
    await ben.page.getByRole("button", { name: "Leave…" }).click();
    await ben.page.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(ben.page.getByRole("region", { name: "Share live" })).toBeVisible();
    await ana.page.getByRole("button", { name: "The plan" }).click();
    await ana.page.getByRole("button", { name: "Stop sharing…" }).click();
    await ana.page.getByRole("button", { name: "Stop sharing", exact: true }).click();
    await expect(ana.page.getByRole("region", { name: "Share live" })).toBeVisible();
    expect(server.boxes.size).toBe(0);
    await ana.context.close();
    await ben.context.close();
  });

  test("Notify me: the service worker is registered, the subscription reaches the box, and a push shows the private text (NT-20, NT-25, NT-26)", async ({
    browser,
    baseURL,
  }) => {
    test.skip(browser.browserType().name() !== "chromium", "uses the Chromium DevTools protocol to deliver a push");
    const server = createServer();
    const ana = await person(browser, baseURL, server, true);
    await ana.context.grantPermissions(["notifications"]);
    // Headless Chromium can't reach a real push service: the browser's subscribe() is stubbed.
    await ana.context.addInitScript(() => {
      const fake = {
        endpoint: "https://fcm.googleapis.com/fcm/send/e2e-device",
        options: { applicationServerKey: null as ArrayBuffer | null },
        getKey: (name: string) => new Uint8Array(name === "p256dh" ? 65 : 16).fill(4).buffer,
        unsubscribe: async () => true,
      };
      let current: typeof fake | null = null;
      const methods = {
        getSubscription: async () => current as unknown as PushSubscription,
        subscribe: async (options?: PushSubscriptionOptionsInit) => {
          fake.options.applicationServerKey = (options?.applicationServerKey as ArrayBuffer) ?? null;
          current = fake;
          return fake as unknown as PushSubscription;
        },
      };
      const w = window as unknown as Record<string, unknown>;
      // Chromium's headless shell (what CI runs) reports notifications as blocked
      // whatever was granted, and may lack the Push API: stand in for both there, and
      // let the test know it can't deliver a real push to the service worker.
      const realPush = "PushManager" in window && "Notification" in window && Notification.permission === "granted";
      if ("PushManager" in window) Object.assign(PushManager.prototype, methods);
      else {
        w.PushManager = function PushManager() {};
        Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", { get: () => methods, configurable: true });
      }
      if (!realPush) {
        w.__noRealPush = true;
        Object.defineProperty(window, "Notification", {
          value: { permission: "granted", requestPermission: async () => "granted" },
          configurable: true,
        });
      }
    });
    await ana.page.goto(comparePath);
    await ana.page.getByRole("button", { name: "💾 Save this comparison" }).click();
    await ana.page.getByRole("link", { name: "Open the conversation" }).click();
    await ana.page.getByRole("button", { name: "Share live…" }).click();
    const live = ana.page.getByRole("region", { name: "Shared live" });
    await live.getByRole("button", { name: "🔔 Notify me on this device" }).click();
    await expect(live).toContainText("On for this device");
    expect(server.subscriptions).toEqual([{ boxId: [...server.boxes.keys()][0], endpoint: "https://fcm.googleapis.com/fcm/send/e2e-device" }]);

    // The real service worker gets a push (as the push service would deliver it) and shows only the private text.
    // (Only where the browser has a Push API: the full Chromium build, not the headless shell.)
    const realPush = await ana.page.evaluate(() => !(window as unknown as { __noRealPush?: boolean }).__noRealPush);
    if (realPush) {
    const cdp = await ana.context.newCDPSession(ana.page);
    const registrationId = new Promise<string>((resolve) =>
      cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
        const r = registrations.find((x: { scopeURL: string; isDeleted: boolean }) => x.scopeURL.startsWith(new URL(baseURL!).origin) && !x.isDeleted);
        if (r) resolve(r.registrationId);
      })
    );
    await cdp.send("ServiceWorker.enable");
    const boxId = [...server.boxes.keys()][0];
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin: new URL(baseURL!).origin,
      registrationId: await registrationId,
      data: JSON.stringify({ box: boxId, kind: "comment", count: 3 }),
    });
    await expect
      .poll(() =>
        ana.page.evaluate(async () => {
          const r = await navigator.serviceWorker.ready;
          return (await r.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag }));
        })
      )
      .toEqual([{ title: "Wants & Won'ts", body: "3 new changes in a conversation.", tag: `box-${boxId}` }]);
    } else {
      test.info().annotations.push({ type: "note", description: "No Push API in this browser: push delivery to the service worker not checked." });
    }

    // Turning it off.
    await live.getByRole("button", { name: "Turn off on this device" }).click();
    await expect(live.getByRole("button", { name: "🔔 Notify me on this device" })).toBeVisible();
    await ana.context.close();
  });
});
