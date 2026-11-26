/*
 * Wants & Won'ts push notifications (docs/spec/notifications.md §7b, NT-25…NT-27).
 *
 * Registered only when someone turns on "Notify me". It has no fetch handler, so
 * it never caches or intercepts anything. A push carries only
 * {box, kind, count}: no names or text. This shows the Private text (NT-26), and a
 * tap opens the conversation that box belongs to on this device.
 */

const BOX_ID = /^[A-Za-z0-9_-]{22}$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const box = typeof data.box === "string" && BOX_ID.test(data.box) ? data.box : null;
  const count = Number.isInteger(data.count) && data.count > 1 && data.count < 1000 ? data.count : 1;
  const body = count > 1 ? `${count} new changes in a conversation.` : "Something new in a conversation.";
  // Every push is shown (Safari requires it); a newer one replaces an older one for the same box.
  event.waitUntil(
    self.registration.showNotification("Wants & Won'ts", {
      body,
      tag: box ? `box-${box}` : "wants-live",
      renotify: true,
      icon: "/logo192.png",
      data: { box },
    })
  );
});

/** The conversation a box belongs to on this device (src/live/live-store.ts), or null. */
const conversationFor = (box) =>
  new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open("wants-live", 1);
    } catch (e) {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => request.result.createObjectStore("boxes", { keyPath: "conversationId" });
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const all = db.transaction("boxes", "readonly").objectStore("boxes").getAll();
        all.onsuccess = () => {
          const entry = (all.result || []).find((e) => e && e.boxId === box);
          resolve(entry ? entry.conversationId : null);
          db.close();
        };
        all.onerror = () => {
          resolve(null);
          db.close();
        };
      } catch (e) {
        resolve(null);
        db.close();
      }
    };
  });

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const box = event.notification.data && event.notification.data.box;
      const id = box ? await conversationFor(box) : null;
      const url = id ? `/talk?id=${encodeURIComponent(id)}&from=notification` : "/library";
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          const moved = await client.navigate(url);
          return (moved || client).focus();
        } catch (e) {
          // Not ours to navigate: open a new window instead.
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
