/**
 * Keeps a live conversation in step with the box (NT-30, NT-31): pull on open, on
 * focus, when the page becomes visible and every 2 minutes; write this device's
 * copy 3 seconds after the last edit and when the page is hidden. One sync at a
 * time; nothing here throws into the page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation } from "../conversation";
import { BoxApi, LiveError, LiveFailure } from "./box-api";
import { LiveEntry, LiveStore } from "./live-store";
import { platform } from "../platform";
import { endLive, inviteLink, needsPush, pullLive, pushLive, renewInvite, shareLive } from "./live-session";
import { PushPrepared, disablePush, enablePush, forgetBrowserSubscriptionIfUnused, preparePush, pushSupport } from "./push";
import { track } from "../analytics";

export type LiveDeps = {
  api: BoxApi;
  store: LiveStore;
  /** Signs a request with the supporter's sync account, or null if this browser isn't a supporter's. */
  authorizeAccount: ((method: string, pathAndQuery: string, body: Uint8Array) => Promise<string>) | null;
};

export type LiveStatus =
  | { state: "loading" }
  | { state: "off" }
  | { state: "syncing" | "live"; members: number; lastSyncAt?: number; unreadable: number }
  | { state: "offline"; lastSyncAt?: number }
  | { state: "read_only"; members: number }
  | { state: "stopped" }
  | { state: "error"; reason: LiveFailure | "too_large" };

export const PULL_EVERY_MS = 2 * 60 * 1000;
export const PUSH_AFTER_MS = 3000;

export type NotifyState = "off" | "on" | "working" | "unsupported" | "home-screen" | "denied" | "unavailable" | "error";

export type Live = {
  status: LiveStatus;
  /** "Notify me" on this device (NT-20…NT-22, NT-28). */
  notify: { state: NotifyState; enable: () => void; disable: () => Promise<void> };
  entry: LiveEntry | null;
  canShare: boolean;
  invite: string | null;
  share: () => Promise<void>;
  renew: () => Promise<void>;
  end: () => Promise<void>;
  syncNow: () => Promise<void>;
};

export const useLive = (
  deps: LiveDeps | undefined,
  conversation: Conversation,
  onMerged: (next: Conversation) => void,
  origin: string
): Live => {
  const [entry, setEntry] = useState<LiveEntry | null>(null);
  const [status, setStatus] = useState<LiveStatus>({ state: deps ? "loading" : "off" });
  const local = useRef(conversation);
  local.current = conversation;
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const merged = useRef(onMerged);
  merged.current = onMerged;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /**
   * The newest entry, at once: work queued after this reads it, rather than the
   * copy from the last render. Without it, a pull that started before "Notify me"
   * wrote back the entry without the push subscription (here and in storage).
   */
  const commit = useCallback((next: LiveEntry | null) => {
    entryRef.current = next;
    setEntry(next);
  }, []);
  /** Runs `work` after everything already queued (syncs, enabling or disabling push). */
  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(work, work);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);
  const prepared = useRef<PushPrepared | null>(null);
  const [notifyWork, setNotifyWork] = useState<"idle" | "working" | "error" | "unavailable" | "denied">("idle");

  // Which box (if any) this conversation is shared in, on this device.
  useEffect(() => {
    if (!deps) return;
    let cancelled = false;
    deps.store.get(conversation.id).then(
      (e) => {
        if (cancelled) return;
        commit(e);
        setStatus(e ? { state: "syncing", members: 0, unreadable: 0 } : { state: "off" });
      },
      () => !cancelled && setStatus({ state: "off" })
    );
    return () => {
      cancelled = true;
    };
  }, [deps, conversation.id, commit]);

  const fail = useCallback(
    async (e: unknown, current: LiveEntry) => {
      if (!deps) return;
      if (e instanceof LiveError) {
        if (e.reason === "offline") return setStatus((s) => ({ state: "offline", lastSyncAt: "lastSyncAt" in s ? s.lastSyncAt : undefined }));
        if (e.reason === "not_found" || e.status === 401 || e.status === 403) {
          // Sharing was stopped, or this device was removed (NT-15): forget the box, keep the conversation.
          await deps.store.delete(current.conversationId).catch(() => undefined);
          commit(null);
          return setStatus({ state: "stopped" });
        }
        if (e.reason === "read_only") return setStatus({ state: "read_only", members: 0 });
        return setStatus({ state: "error", reason: e.reason });
      }
      setStatus({ state: "error", reason: e instanceof Error && e.name === "CopyTooLargeError" ? "too_large" : "failed" });
    },
    [deps, commit]
  );

  /** Pull, merge, then write this device's copy if it's behind. Serialized. */
  const sync = useCallback(
    (push = true) => {
      const run = async () => {
        const current = entryRef.current;
        if (!deps || !current) return;
        try {
          const pulled = await pullLive(deps, current, local.current);
          let next = pulled.entry;
          if (pulled.conversation) {
            local.current = pulled.conversation;
            merged.current(pulled.conversation);
          }
          if (pulled.readOnly) {
            commit(next);
            return setStatus({ state: "read_only", members: pulled.members });
          }
          if (push && needsPush(next, local.current)) next = await pushLive(deps, next, local.current);
          commit(next);
          setStatus({ state: "live", members: pulled.members, lastSyncAt: Date.now(), unreadable: pulled.unreadable });
        } catch (e) {
          await fail(e, current);
        }
      };
      return enqueue(run);
    },
    [deps, fail, commit, enqueue]
  );

  // Pull when the box is found, on focus, when visible, and every 2 minutes; push when hidden.
  const live = !!entry;
  useEffect(() => {
    if (!live) return;
    void sync();
    const onFocus = () => void sync();
    const onVisibility = () => void sync();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void sync();
    }, PULL_EVERY_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [live, sync]);

  // Get push ready before any tap (Safari needs the subscribe call straight from it).
  const support = typeof window === "undefined" ? "unsupported" : pushSupport();
  useEffect(() => {
    if (!deps || !live || support !== "ok" || prepared.current) return;
    let cancelled = false;
    preparePush(deps.api).then(
      (p) => {
        if (!cancelled) prepared.current = p;
      },
      (e) => !cancelled && setNotifyWork(e instanceof LiveError && e.reason === "push_unavailable" ? "unavailable" : "idle")
    );
    return () => {
      cancelled = true;
    };
  }, [deps, live, support]);

  const notifyState: NotifyState =
    notifyWork === "working" || notifyWork === "error" || notifyWork === "unavailable" || notifyWork === "denied"
      ? notifyWork
      : support !== "ok"
        ? support
        : entry?.push
          ? "on"
          : "off";

  // Write this device's copy 3 seconds after the last local change.
  useEffect(() => {
    if (!live || !entryRef.current || !needsPush(entryRef.current, conversation)) return;
    const timer = setTimeout(() => void sync(), PUSH_AFTER_MS);
    return () => clearTimeout(timer);
  }, [live, conversation, sync]);

  return {
    status,
    notify: {
      state: notifyState,
      enable: () => {
        const current = entryRef.current;
        if (!deps || !current) return;
        // Ask first, straight from the tap; then subscribe and register with the box.
        // (In the store apps, the operating system asks inside enablePush.)
        const permission: Promise<NotificationPermission> = platform().nativePush
          ? Promise.resolve("granted")
          : window.Notification.permission === "granted"
            ? Promise.resolve("granted")
            : window.Notification.requestPermission();
        setNotifyWork("working");
        void enqueue(async () => {
          try {
            if ((await permission) !== "granted") return setNotifyWork("denied");
            const ready = prepared.current ?? (prepared.current = await preparePush(deps.api));
            const next = await enablePush(deps, entryRef.current ?? current, ready);
            commit(next);
            setNotifyWork("idle");
            track("notifications_enabled", { channel: "webpush" });
          } catch (e) {
            setNotifyWork(
              e instanceof LiveError && e.reason === "push_unavailable"
                ? "unavailable"
                : e instanceof LiveError && e.reason === "permission_denied"
                  ? "denied"
                  : "error"
            );
          }
        });
      },
      disable: async () => {
        const current = entryRef.current;
        if (!deps || !current) return;
        setNotifyWork("working");
        await enqueue(async () => {
          try {
            const ready = prepared.current;
            commit(await disablePush(deps, entryRef.current ?? current, ready && "registration" in ready ? ready.registration : null));
            setNotifyWork("idle");
            track("notifications_disabled");
          } catch {
            setNotifyWork("error");
          }
        });
      },
    },
    entry,
    canShare: !!deps?.authorizeAccount,
    invite: entry ? inviteLink(origin, entry) : null,
    share: async () => {
      if (!deps?.authorizeAccount || entryRef.current) return;
      setStatus({ state: "syncing", members: 1, unreadable: 0 });
      try {
        const created = await shareLive(deps, deps.authorizeAccount, local.current);
        commit(created);
        setStatus({ state: "live", members: 1, lastSyncAt: Date.now(), unreadable: 0 });
        track("live_shared");
      } catch (e) {
        if (e instanceof LiveError) setStatus({ state: "error", reason: e.reason });
        else setStatus({ state: "error", reason: e instanceof Error && e.name === "CopyTooLargeError" ? "too_large" : "failed" });
      }
    },
    renew: () =>
      enqueue(async () => {
        const current = entryRef.current;
        if (!deps || !current?.isHost) return;
        try {
          commit(await renewInvite(deps, current));
        } catch (e) {
          await fail(e, current);
        }
      }),
    end: () =>
      enqueue(async () => {
        const current = entryRef.current;
        if (!deps || !current) return;
        try {
          await endLive(deps, current);
          // The server dropped this box's subscriptions; drop the browser's if nothing else uses it.
          const ready = prepared.current;
          await forgetBrowserSubscriptionIfUnused(deps.store, ready && "registration" in ready ? ready.registration : null).catch(
            () => undefined
          );
          commit(null);
          setStatus({ state: "off" });
          track(current.isHost ? "live_stopped" : "live_left");
        } catch (e) {
          await fail(e, current);
        }
      }),
    syncNow: () => sync(),
  };
};
