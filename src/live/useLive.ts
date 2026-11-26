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
import { endLive, inviteLink, needsPush, pullLive, pushLive, renewInvite, shareLive } from "./live-session";
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

export type Live = {
  status: LiveStatus;
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

  // Which box (if any) this conversation is shared in, on this device.
  useEffect(() => {
    if (!deps) return;
    let cancelled = false;
    deps.store.get(conversation.id).then(
      (e) => {
        if (cancelled) return;
        setEntry(e);
        setStatus(e ? { state: "syncing", members: 0, unreadable: 0 } : { state: "off" });
      },
      () => !cancelled && setStatus({ state: "off" })
    );
    return () => {
      cancelled = true;
    };
  }, [deps, conversation.id]);

  const fail = useCallback(
    async (e: unknown, current: LiveEntry) => {
      if (!deps) return;
      if (e instanceof LiveError) {
        if (e.reason === "offline") return setStatus((s) => ({ state: "offline", lastSyncAt: "lastSyncAt" in s ? s.lastSyncAt : undefined }));
        if (e.reason === "not_found" || e.status === 401 || e.status === 403) {
          // Sharing was stopped, or this device was removed (NT-15): forget the box, keep the conversation.
          await deps.store.delete(current.conversationId).catch(() => undefined);
          setEntry(null);
          return setStatus({ state: "stopped" });
        }
        if (e.reason === "read_only") return setStatus({ state: "read_only", members: 0 });
        return setStatus({ state: "error", reason: e.reason });
      }
      setStatus({ state: "error", reason: e instanceof Error && e.name === "CopyTooLargeError" ? "too_large" : "failed" });
    },
    [deps]
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
            setEntry(next);
            return setStatus({ state: "read_only", members: pulled.members });
          }
          if (push && needsPush(next, local.current)) next = await pushLive(deps, next, local.current);
          setEntry(next);
          setStatus({ state: "live", members: pulled.members, lastSyncAt: Date.now(), unreadable: pulled.unreadable });
        } catch (e) {
          await fail(e, current);
        }
      };
      queue.current = queue.current.then(run, run);
      return queue.current as Promise<void>;
    },
    [deps, fail]
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

  // Write this device's copy 3 seconds after the last local change.
  useEffect(() => {
    if (!live || !entryRef.current || !needsPush(entryRef.current, conversation)) return;
    const timer = setTimeout(() => void sync(), PUSH_AFTER_MS);
    return () => clearTimeout(timer);
  }, [live, conversation, sync]);

  return {
    status,
    entry,
    canShare: !!deps?.authorizeAccount,
    invite: entry ? inviteLink(origin, entry) : null,
    share: async () => {
      if (!deps?.authorizeAccount || entryRef.current) return;
      setStatus({ state: "syncing", members: 1, unreadable: 0 });
      try {
        const created = await shareLive(deps, deps.authorizeAccount, local.current);
        setEntry(created);
        setStatus({ state: "live", members: 1, lastSyncAt: Date.now(), unreadable: 0 });
        track("live_shared");
      } catch (e) {
        if (e instanceof LiveError) setStatus({ state: "error", reason: e.reason });
        else setStatus({ state: "error", reason: e instanceof Error && e.name === "CopyTooLargeError" ? "too_large" : "failed" });
      }
    },
    renew: async () => {
      const current = entryRef.current;
      if (!deps || !current?.isHost) return;
      try {
        setEntry(await renewInvite(deps, current));
      } catch (e) {
        await fail(e, current);
      }
    },
    end: async () => {
      const current = entryRef.current;
      if (!deps || !current) return;
      try {
        await endLive(deps, current);
        setEntry(null);
        setStatus({ state: "off" });
        track(current.isHost ? "live_stopped" : "live_left");
      } catch (e) {
        await fail(e, current);
      }
    },
    syncNow: () => sync(),
  };
};
