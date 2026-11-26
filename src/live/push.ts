/**
 * "Notify me" on this device (docs/spec/notifications.md NT-20…NT-22, NT-28, §7b):
 * the browser's push subscription, registered with the box. The service worker
 * (public/push-sw.js) is registered only here, when someone asks for notifications.
 *
 * Safari only allows the permission prompt straight from a tap, so everything that
 * can be done before the tap (the server's key, the service worker) is prepared
 * first, and the tap only subscribes.
 */

import { toBase64Url } from "../sync/bytes";
import { currentBrowser, homeScreenDevice } from "../persistence";
import { BoxApi, LiveError } from "./box-api";
import { LiveEntry, LiveStore } from "./live-store";
import { platform } from "../platform";

export const SERVICE_WORKER_URL = "/push-sw.js";

export type PushSupport = "ok" | "home-screen" | "unsupported" | "denied";

type Env = { navigator: Navigator; window: Window & typeof globalThis };
const env = (): Env => ({ navigator, window });

/** Whether this browser can get push notifications, and if not, why (NT-22). */
export const pushSupport = ({ navigator: nav, window: win }: Env = env()): PushSupport => {
  // The store apps: the operating system asks when "Notify me" is tapped.
  if (platform().nativePush) return "ok";
  const has = "serviceWorker" in nav && "PushManager" in win && "Notification" in win;
  if (!has) return homeScreenDevice(currentBrowser()) ? "home-screen" : "unsupported";
  return win.Notification.permission === "denied" ? "denied" : "ok";
};

export type PushPrepared = { registration: ServiceWorkerRegistration; key: Uint8Array } | { native: true };

/** The server's key and the service worker, ready before any tap. */
export const preparePush = async (api: BoxApi, { navigator: nav }: Env = env()): Promise<PushPrepared> => {
  if (platform().nativePush) return { native: true };
  const key = await api.pushKey();
  await nav.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
  const registration = await nav.serviceWorker.ready;
  return { registration, key };
};

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

/** Subscribes this browser (call straight from the tap), then registers it with the box. */
export const enablePush = async (
  { api, store }: { api: BoxApi; store: LiveStore },
  entry: LiveEntry,
  prepared: PushPrepared
): Promise<LiveEntry> => {
  const native = platform().nativePush;
  if (native || "native" in prepared) {
    // The store apps (§7c): the operating system's permission, then an FCM token.
    const device = native ? await native.register() : null;
    if (!device) throw new LiveError("permission_denied");
    const { subId } = await api.subscribe({ boxId: entry.boxId, device: entry.device }, { kind: "fcm", ...device });
    const next = { ...entry, push: { subId } };
    await store.put(next);
    return next;
  }
  const { pushManager } = prepared.registration;
  let sub = await pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, prepared.key)) {
    // The server's key changed: the old subscription can't be used any more.
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub ??= await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(prepared.key) });
  const p256dh = sub.getKey("p256dh");
  const auth = sub.getKey("auth");
  if (!p256dh || !auth) throw new LiveError("failed");
  const { subId } = await api.subscribe(
    { boxId: entry.boxId, device: entry.device },
    { endpoint: sub.endpoint, p256dh: toBase64Url(new Uint8Array(p256dh)), auth: toBase64Url(new Uint8Array(auth)) }
  );
  const next = { ...entry, push: { subId } };
  await store.put(next);
  return next;
};

/**
 * Turns notifications off for this conversation on this device (NT-28). The
 * browser's own subscription is kept while another conversation still uses it.
 */
export const disablePush = async (
  { api, store }: { api: BoxApi; store: LiveStore },
  entry: LiveEntry,
  registration?: ServiceWorkerRegistration | null
): Promise<LiveEntry> => {
  if (entry.push) {
    try {
      await api.unsubscribe({ boxId: entry.boxId, device: entry.device }, entry.push.subId);
    } catch (e) {
      if (!(e instanceof LiveError && e.reason === "not_found")) throw e;
    }
  }
  const next: LiveEntry = { ...entry, push: undefined };
  await store.put(next);
  await forgetBrowserSubscriptionIfUnused(store, registration);
  return next;
};

/** After leaving or stopping (the server deletes its subscriptions), drop the browser's if nothing uses it. */
export const forgetBrowserSubscriptionIfUnused = async (store: LiveStore, registration?: ServiceWorkerRegistration | null) => {
  const stillUsed = (await store.all()).some((e) => e.push);
  if (stillUsed) return;
  const native = platform().nativePush;
  if (native) return native.unregister().catch(() => undefined);
  if (!registration) return;
  const sub = await registration.pushManager.getSubscription().catch(() => null);
  await sub?.unsubscribe().catch(() => false);
};
