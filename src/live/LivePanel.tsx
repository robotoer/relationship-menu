import { useState } from "react";
import { Link } from "react-router-dom";
import { platform } from "../platform";
import type { Live } from "./useLive";

const ago = (at?: number) => {
  if (!at) return "";
  const minutes = Math.round((Date.now() - at) / 60000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
};

const FAILURE: Record<string, string> = {
  not_supporter: "Live sharing is for supporters. Your support status couldn't be confirmed.",
  read_only: "Your support has lapsed, so live sharing is paused.",
  too_many_boxes: "You're already sharing 50 conversations live. Stop sharing one to share this.",
  too_large: "This conversation is too big to share live. You can still send it as a link.",
  rate_limited: "Too many changes at once. It'll try again shortly.",
  failed: "Something went wrong with live sharing. It'll try again; your notes are safe here.",
};

/** Live sharing on the conversation page (NT-10…NT-16). */
export const LivePanel = ({ live }: { live: Live }) => {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { status, entry } = live;

  if (status.state === "loading") return null;

  if (!entry) {
    return (
      <section className="conv-live" aria-labelledby="conv-live-title">
        <h2 id="conv-live-title">Share live</h2>
        {status.state === "stopped" && (
          <p className="conv-notice" role="status">
            Live sharing of this conversation was stopped. Everything is still here, and you can keep talking by
            sending links.
          </p>
        )}
        {status.state === "error" && (
          <p className="discuss-coach-error" role="alert">
            {FAILURE[status.reason] ?? FAILURE.failed}
          </p>
        )}
        {live.canShare ? (
          <>
            <p>
              Keep everyone's copy up to date automatically: notes, outcomes and comments appear on each device
              whenever it's open. Everything is encrypted on your device; our server can't read it.
            </p>
            <button type="button" className="button-primary" onClick={() => void live.share()}>
              Share live…
            </button>
          </>
        ) : (
          <p className="conv-hint">
            Supporters can share a conversation live, so it stays up to date on everyone's devices.
            {platform().support && (
              <>
                {" "}
                <Link to="/support" state={{ supportFrom: "live" }}>
                  Support the project
                </Link>{" "}
                to turn it on; the people you invite don't need to.
              </>
            )}
          </p>
        )}
      </section>
    );
  }

  const summary =
    status.state === "live" || status.state === "syncing"
      ? `Live · ${Math.max(1, status.members)} device${Math.max(1, status.members) === 1 ? "" : "s"}${status.state === "live" ? ` · up to date ${ago(status.lastSyncAt)}` : " · updating…"}`
      : status.state === "offline"
        ? "Offline: your changes are kept here and sent when you're back online."
        : status.state === "read_only"
          ? "Live sharing has paused (the host's support has lapsed). You can still read it, and keep talking by sending links."
          : status.state === "error"
            ? FAILURE[status.reason] ?? FAILURE.failed
            : "";

  return (
    <section className="conv-live" aria-labelledby="conv-live-title">
      <h2 id="conv-live-title">Shared live</h2>
      <p className="conv-live-status" role="status">
        {summary}
      </p>
      {status.state === "live" && status.unreadable > 0 && (
        <p className="conv-hint">Some shared changes couldn't be read and were skipped.</p>
      )}
      {entry.isHost && live.invite && (
        <div className="conv-invite">
          <p>
            <strong>Invite:</strong> send this link to the people in this conversation. It works for 7 days.
          </p>
          <p className="conv-hint">
            Anyone with this link can read and add to this conversation, now and later. Send it only to the people
            in it.
          </p>
          <div className="discuss-actions">
            {platform().shareText && (
              <button
                type="button"
                className="button-primary"
                onClick={() =>
                  void platform()
                    .shareText!({ title: "Our conversation", text: `Join our conversation on Wants & Won'ts: ${live.invite}` })
                    .catch(() => {})
                }
              >
                Send invite…
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                try {
                  await platform().copyText(live.invite!);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch (e) {
                  console.error("Copy failed:", e);
                }
              }}
            >
              {copied ? "Copied!" : "Copy invite link"}
            </button>
            <button type="button" onClick={() => void live.renew()}>
              New invite link
            </button>
          </div>
        </div>
      )}
      {entry.isHost && !live.invite && (
        <button type="button" onClick={() => void live.renew()}>
          Make an invite link
        </button>
      )}
      <NotifyControl live={live} />
      <div className="discuss-actions">
        <button type="button" onClick={() => void live.syncNow()}>
          Update now
        </button>
        {confirming ? (
          <span className="conv-live-confirm">
            {entry.isHost
              ? "Stop sharing for everyone? Each device keeps the conversation as it is now."
              : "Leave? You keep the conversation as it is now; the others aren't told why."}{" "}
            <button type="button" onClick={() => void live.end().then(() => setConfirming(false))}>
              {entry.isHost ? "Stop sharing" : "Leave"}
            </button>{" "}
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}>
            {entry.isHost ? "Stop sharing…" : "Leave…"}
          </button>
        )}
      </div>
    </section>
  );
};

/** "Notify me" on this device (NT-20…NT-22, NT-26, NT-28). */
const NotifyControl = ({ live }: { live: Live }) => {
  const { state, enable, disable } = live.notify;
  const note: Record<string, string> = {
    "home-screen":
      "On iPhone and iPad, notifications work once Wants & Won'ts is on your Home Screen: tap Share, then Add to Home Screen, and open it from there.",
    unsupported: "This browser can't show notifications. You'll still see everything new when you open the conversation.",
    denied: platform().nativePush
      ? "Notifications are off for Wants & Won'ts. You can turn them on in your phone's Settings, then try again."
      : "Notifications are blocked for this site. You can allow them in your browser's settings, then try again.",
    unavailable: "Notifications aren't available right now. You'll still see everything new when you open the conversation.",
    error: "Couldn't change notifications. Please try again.",
  };
  return (
    <div className="conv-notify">
      <h3>Notifications</h3>
      {state === "on" ? (
        <>
          <p>
            🔔 On for this device. They only say "Something new in a conversation": no names, no topics. At most one
            every 15 minutes.
          </p>
          <button type="button" onClick={() => void disable()}>
            Turn off on this device
          </button>
        </>
      ) : state === "off" || state === "working" || state === "error" ? (
        <>
          <p className="conv-hint">
            Get a notification on this device when someone else comments or adds notes: at most one every 15 minutes,
            with no names or topics on the lock screen.
          </p>
          <button type="button" className="button-primary" disabled={state === "working"} onClick={enable}>
            {state === "working" ? "Turning on…" : "🔔 Notify me on this device"}
          </button>
          {state === "error" && (
            <p className="discuss-coach-error" role="alert">
              {note.error}
            </p>
          )}
        </>
      ) : (
        <p className="conv-hint">{note[state]}</p>
      )}
    </div>
  );
};
