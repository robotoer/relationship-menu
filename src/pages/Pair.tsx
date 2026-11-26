import "./Pair.css";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SyncErrorReason, useSync } from "../sync/context";
import { pairingKeyFromFragment } from "../sync/pairing";
import type { SyncSettingsState } from "./SyncSettings";
import { ERROR_TEXT, LOCAL_MENUS_KEPT, PAIRING_USED_ADVICE, UNSUPPORTED_TEXT, errorReason, errorText } from "./sync-copy";

/**
 * Takes the pairing key out of the address bar (SY-11). It runs while the page
 * first renders, so before any effect: before the app's page view, and before
 * anything is fetched. Any fragment is removed, even one that isn't a key, as a
 * mangled key is still secret.
 */
const takePairingKey = (): { key: Uint8Array | null; hadFragment: boolean } => {
  const { hash, pathname, search } = window.location;
  if (!hash) return { key: null, hadFragment: false };
  const key = pairingKeyFromFragment(hash);
  window.history.replaceState(window.history.state, "", pathname + search);
  return { key, hadFragment: true };
};

type Phase =
  /** Waiting for sync to finish loading. */
  | { kind: "waiting" }
  /** `/pair` without a link's key. */
  | { kind: "no_link" }
  | { kind: "unsupported" }
  /** Sync is already on here: ask before switching codes (SY-29). */
  | { kind: "confirm_switch" }
  | { kind: "joining" }
  | { kind: "joined" }
  | { kind: "failed"; reason: SyncErrorReason; text: string };

/** Failures where the link may still work, because the server never handed over the blob. */
const RETRYABLE: readonly SyncErrorReason[] = ["offline", "rate_limited", "code_unconfirmed"];

const TypeWordsInstead = () => (
  <Link className="button" to="/sync" state={{ enterCode: true } satisfies SyncSettingsState}>
    Type the 24 words instead
  </Link>
);

/**
 * The page a pairing QR code opens (`/pair#<key>`, SY-10…SY-12): it turns on
 * sync with the other device's code.
 */
export const PairPage = () => {
  const sync = useSync();
  const { state } = sync;
  const location = useLocation();
  const navigate = useNavigate();
  // Read once, during the first render (see takePairingKey).
  const [taken] = useState(takePairingKey);
  const key = useRef(taken.key);
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>(() =>
    taken.key ? { kind: "waiting" } : taken.hadFragment ? { kind: "failed", reason: "pairing_unreadable", text: ERROR_TEXT.pairing_unreadable } : { kind: "no_link" }
  );
  const heading = useRef<HTMLHeadingElement>(null);

  // The router still remembers the address it started with; drop the fragment there too.
  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: location.state });
  }, [location, navigate]);

  const join = async () => {
    if (!key.current || started.current) return;
    started.current = true;
    setPhase({ kind: "joining" });
    try {
      await sync.joinPairing(key.current);
      key.current = null;
      setPhase({ kind: "joined" });
    } catch (err) {
      const reason = errorReason(err);
      if (RETRYABLE.includes(reason)) started.current = false;
      else key.current = null;
      setPhase({ kind: "failed", reason, text: errorText(err) });
    }
  };

  useEffect(() => {
    if (phase.kind !== "waiting" || state.kind === "loading") return;
    if (state.kind === "unsupported") setPhase({ kind: "unsupported" });
    else if (state.kind === "on") setPhase({ kind: "confirm_switch" });
    else void join();
    // `join` only reads refs and stable actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, state.kind]);

  // Results take focus, so screen readers hear them.
  useEffect(() => {
    if (phase.kind === "joined" || phase.kind === "failed") heading.current?.focus();
  }, [phase]);

  const title =
    phase.kind === "joined"
      ? "This device is syncing"
      : phase.kind === "failed"
        ? "Couldn't add this device"
        : phase.kind === "unsupported"
          ? "This browser can't sync"
          : "Add this device";

  return (
    <div className="pair-page">
      <h1 tabIndex={-1} ref={heading}>
        {title}
      </h1>
      <div role="status">
        {(phase.kind === "waiting" || phase.kind === "joining") && <p>Turning on sync…</p>}
        {phase.kind === "joined" && (
          <p>Sync is on. Your menus from the other device will appear in your Library in a moment.</p>
        )}
      </div>

      {phase.kind === "joined" && (
        <div className="pair-actions">
          <Link className="button button-primary" to="/library">
            Go to your menus
          </Link>
          <Link className="button" to="/sync">
            Sync settings
          </Link>
        </div>
      )}

      {phase.kind === "confirm_switch" && (
        <section className="pair-confirm" aria-labelledby="pair-switch">
          <h2 id="pair-switch">Sync is already on here</h2>
          <p>
            This browser already syncs with a sync code. Using this link switches it to the code of the device that
            showed the QR code, and it stops syncing with its current one.
          </p>
          <p>{LOCAL_MENUS_KEPT}</p>
          <p>Nothing has been fetched yet, so if you don't switch, the link still works on another device.</p>
          <div className="pair-actions">
            <button type="button" className="button-primary" onClick={() => void join()}>
              Switch to the other device's code
            </button>
            <Link className="button" to="/sync">
              Keep my current code
            </Link>
          </div>
        </section>
      )}

      {phase.kind === "failed" && (
        <>
          <p>{phase.text}</p>
          {phase.reason === "pairing_used" && (
            <p>
              <strong>{PAIRING_USED_ADVICE}</strong> Do it on a device where sync is on: Sync, then Replace sync code.
            </p>
          )}
          {phase.reason === "unavailable" ? (
            UNSUPPORTED_TEXT.slice(1).map((line) => <p key={line}>{line}</p>)
          ) : (
            <>
              <p>
                {RETRYABLE.includes(phase.reason) ? "The link may still work. " : ""}You can also type your 24 words,
                or make a new QR code on the other device (Sync, then Add a device).
              </p>
              <div className="pair-actions">
                {RETRYABLE.includes(phase.reason) && key.current && (
                  <button type="button" className="button-primary" onClick={() => void join()}>
                    Try again
                  </button>
                )}
                <TypeWordsInstead />
              </div>
            </>
          )}
        </>
      )}

      {phase.kind === "unsupported" && UNSUPPORTED_TEXT.map((line) => <p key={line}>{line}</p>)}

      {phase.kind === "no_link" && (
        <>
          <p>
            To add this device, open Sync on a device where it's on, choose Add a device, and scan the QR code with
            this one.
          </p>
          <div className="pair-actions">
            <TypeWordsInstead />
          </div>
        </>
      )}
    </div>
  );
};
