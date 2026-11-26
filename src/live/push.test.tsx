import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { encodeMenuSlug } from "../compare-slug";
import { newConversation, saveConversation } from "../conversation";
import { StorageProvider } from "../providers/Storage";
import { createLocalStorage } from "../storage";
import { TalkRoute } from "../pages/Talk";
import { createBoxApi } from "./box-api";
import { createFakeBoxServer } from "./fake-box-server";
import { createLiveStore } from "./live-store";
import { shareLive } from "./live-session";
import { disablePush, enablePush, preparePush, pushSupport } from "./push";
import type { LiveDeps } from "./useLive";

const ana = encodeMenuSlug("Ana's", { G: [{ item: "Kids", value: "must-have" }] }, { name: "Ana" });
const ben = encodeMenuSlug("Ben's", { G: [{ item: "Kids", value: "off-limits" }] }, { name: "Ben" });
const ID = "PushTestConversation00";
const account = async () => "MenuSync v1 account=AccountAccountAccount0, key=k, ts=1, sig=s";

/** A browser's push machinery, in memory. */
const fakeBrowser = () => {
  let subscription: PushSubscription | null = null;
  const subscribeCalls: unknown[] = [];
  const makeSub = (key: Uint8Array) =>
    ({
      endpoint: `https://fcm.googleapis.com/fcm/send/device${subscribeCalls.length}`,
      options: { applicationServerKey: new Uint8Array(key).buffer },
      getKey: (name: string) => new Uint8Array(name === "p256dh" ? 65 : 16).fill(7).buffer,
      unsubscribe: vi.fn(async () => {
        subscription = null;
        return true;
      }),
    }) as unknown as PushSubscription;
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async (options: PushSubscriptionOptionsInit) => {
      subscribeCalls.push(options);
      subscription = makeSub(options.applicationServerKey as Uint8Array);
      return subscription;
    }),
  };
  const registration = { pushManager } as unknown as ServiceWorkerRegistration;
  const serviceWorker = { register: vi.fn(async () => registration), ready: Promise.resolve(registration) };
  return { registration, serviceWorker, pushManager, subscribeCalls, current: () => subscription };
};

const install = (browser: ReturnType<typeof fakeBrowser>, permission: NotificationPermission = "default", grant: NotificationPermission = "granted") => {
  Object.defineProperty(navigator, "serviceWorker", { value: browser.serviceWorker, configurable: true });
  Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true });
  const Notification = { permission, requestPermission: vi.fn(async () => grant) };
  Object.defineProperty(window, "Notification", { value: Notification, configurable: true });
  return Notification;
};
const uninstall = () => {
  for (const [target, key] of [[navigator, "serviceWorker"], [window, "PushManager"], [window, "Notification"]] as const) {
    delete (target as unknown as Record<string, unknown>)[key];
  }
};

describe("push on this device (NT-20…NT-22, NT-28, §7b)", () => {
  afterEach(() => uninstall());

  it("says why a browser can't get notifications", () => {
    expect(pushSupport()).toBe("unsupported");
    install(fakeBrowser(), "denied");
    expect(pushSupport()).toBe("denied");
    install(fakeBrowser(), "default");
    expect(pushSupport()).toBe("ok");
    uninstall();
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(iphone);
    expect(pushSupport()).toBe("home-screen");
    ua.mockRestore();
  });

  it("subscribes once, registers with the box, and turning off keeps the browser's subscription while another conversation uses it", async () => {
    const server = createFakeBoxServer();
    const deps = { api: createBoxApi({ fetch: server.fetch }), store: createLiveStore(new IDBFactory()) };
    const browser = fakeBrowser();
    install(browser);
    const one = await shareLive(deps, account, newConversation([ana, ben], 1000, ID));
    const two = await shareLive(deps, account, newConversation([ana, ben], 1000, "PushTestConversation01"));
    const prepared = await preparePush(deps.api);
    expect(browser.serviceWorker.register).toHaveBeenCalledWith("/push-sw.js", { scope: "/" });

    const a = await enablePush(deps, one, prepared);
    const b = await enablePush(deps, two, prepared);
    expect(browser.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(browser.subscribeCalls[0]).toMatchObject({ userVisibleOnly: true });
    expect(server.subscriptions.size).toBe(2);
    expect([...server.subscriptions.values()][0].endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\/fcm\/send\//);

    await disablePush(deps, a, browser.registration);
    expect(server.subscriptions.size).toBe(1);
    expect(browser.current()).not.toBeNull();
    await disablePush(deps, b, browser.registration);
    expect(server.subscriptions.size).toBe(0);
    expect(browser.current()).toBeNull();
  });

  it("re-subscribes when the server's key has changed", async () => {
    const server = createFakeBoxServer();
    const deps = { api: createBoxApi({ fetch: server.fetch }), store: createLiveStore(new IDBFactory()) };
    const browser = fakeBrowser();
    install(browser);
    const entry = await shareLive(deps, account, newConversation([ana, ben], 1000, ID));
    const prepared = await preparePush(deps.api);
    await enablePush(deps, entry, prepared);
    await enablePush(deps, entry, { ...prepared, key: new Uint8Array(65).fill(9) });
    expect(browser.pushManager.subscribe).toHaveBeenCalledTimes(2);
  });

  describe("the Notify me control", () => {
    beforeEach(() => localStorage.clear());

    const renderLive = async (deps: LiveDeps) => {
      saveConversation(newConversation([ana, ben], 1000, ID));
      render(
        <StorageProvider storage={createLocalStorage()}>
          <MemoryRouter initialEntries={[`/talk?id=${ID}`]}>
            <Routes>
              <Route path="/talk" element={<TalkRoute live={deps} />} />
            </Routes>
          </MemoryRouter>
        </StorageProvider>
      );
      await act(async () => {});
    };

    it("asks from the tap, turns on, and off again", async () => {
      const server = createFakeBoxServer();
      const store = createLiveStore(new IDBFactory());
      const deps: LiveDeps = { api: createBoxApi({ fetch: server.fetch }), store, authorizeAccount: account };
      await shareLive(deps, account, newConversation([ana, ben], 1000, ID));
      const Notification = install(fakeBrowser());
      await renderLive(deps);
      const panel = await screen.findByRole("region", { name: "Shared live" });
      fireEvent.click(await within(panel).findByRole("button", { name: "🔔 Notify me on this device" }));
      expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
      expect(await within(panel).findByText(/On for this device/)).toBeInTheDocument();
      expect(panel).toHaveTextContent('They only say "Something new in a conversation": no names, no topics.');
      expect(server.subscriptions.size).toBe(1);
      expect((await store.get(ID))?.push?.subId).toBeTruthy();
      fireEvent.click(within(panel).getByRole("button", { name: "Turn off on this device" }));
      await waitFor(() => expect(server.subscriptions.size).toBe(0));
      expect(await within(panel).findByRole("button", { name: "🔔 Notify me on this device" })).toBeInTheDocument();
    });

    it("explains a refusal, a browser without push, and a server without it", async () => {
      const server = createFakeBoxServer();
      const deps: LiveDeps = { api: createBoxApi({ fetch: server.fetch }), store: createLiveStore(new IDBFactory()), authorizeAccount: account };
      await shareLive(deps, account, newConversation([ana, ben], 1000, ID));
      install(fakeBrowser(), "default", "denied");
      await renderLive(deps);
      const panel = await screen.findByRole("region", { name: "Shared live" });
      fireEvent.click(await within(panel).findByRole("button", { name: "🔔 Notify me on this device" }));
      expect(await within(panel).findByText(/Notifications are blocked for this site/)).toBeInTheDocument();
      expect(server.subscriptions.size).toBe(0);
    });

    it("says so when the browser can't show notifications", async () => {
      const server = createFakeBoxServer();
      const deps: LiveDeps = { api: createBoxApi({ fetch: server.fetch }), store: createLiveStore(new IDBFactory()), authorizeAccount: account };
      await shareLive(deps, account, newConversation([ana, ben], 1000, ID));
      await renderLive(deps);
      expect(await screen.findByText(/This browser can't show notifications/)).toBeInTheDocument();
    });
  });
});
