import "./SyncSettings.css";
import { lazy, ReactNode, Suspense, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { PairingOffer, SyncAccount, SyncErrorReason, SyncNotice, SyncState, useSync } from "../sync/context";
import { completeWord, SYNC_CODE_WORDS } from "../sync/sync-code";
import { leavePage } from "./leave-page";
import {
  ERROR_TEXT,
  LOCAL_MENUS_KEPT,
  NOTICE_TEXT,
  PLAN_TEXT,
  REPLACE_UNCONFIRMED,
  SYNC_CODE_WARNING,
  UNSUPPORTED_TEXT,
  errorReason,
  errorText,
  formatDate,
  formatTime,
} from "./sync-copy";

/** The QR encoder is only downloaded when someone adds a device (SY-10). */
const QrCode = lazy(() => import("../components/QrCode"));

/** Router state that opens word entry, e.g. from a pairing link that didn't work (SY-12). */
export type SyncSettingsState = { enterCode?: boolean };

/**
 * While `active`, runs `clear` when the browser leaves the page, before it's
 * frozen in the back-forward cache, so the words aren't on screen if someone
 * comes back with the Back button (SY-3).
 */
const useClearOnPageHide = (active: boolean, clear: () => void) => {
  const latest = useRef(clear);
  latest.current = clear;
  useEffect(() => {
    if (!active) return;
    const onPageHide = () => flushSync(() => latest.current());
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [active]);
};

/** The time, once a second while `active`. */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
};

/** Moves focus to an element when `when` becomes true, e.g. a panel's heading as it opens. */
const useFocusWhen = <T extends HTMLElement>(when: boolean) => {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (when) ref.current?.focus();
  }, [when]);
  return ref;
};

/** The 24 words, numbered. The numbers can't be selected, so copying gives just the words. */
const SyncCodeWords = ({ words }: { words: string[] }) => (
  <ol className="sync-words" role="list" aria-label="Sync code" translate="no">
    {words.map((word, i) => (
      <li key={i}>
        <span className="sync-word-number">{i + 1}.</span> {word}
      </li>
    ))}
  </ol>
);

/** A new code, shown at once after turning sync on (SY-1) or replacing the code (SY-8), with SY-4's warning first. */
const NewCode = ({ words, replaced, onDone }: { words: string[]; replaced: boolean; onDone: () => void }) => {
  const heading = useFocusWhen<HTMLHeadingElement>(true);
  return (
    <section className="sync-section sync-code-panel" aria-labelledby="sync-new-code">
      <h2 id="sync-new-code" tabIndex={-1} ref={heading}>
        {replaced ? "Your new sync code" : "Sync is on. Here's your sync code"}
      </h2>
      <p className="sync-warning">{SYNC_CODE_WARNING}</p>
      <SyncCodeWords words={words} />
      <p>
        {replaced
          ? "Your other devices have stopped syncing. On each one, open Sync and enter these words."
          : "To add another device, use Add a device in Sync, or type these words there."}{" "}
        You can see them again here with Show my sync code.
      </p>
      <button type="button" className="button-primary" onClick={onDone}>
        I've saved my sync code
      </button>
    </section>
  );
};

/** Typing or pasting the 24 words (SY-5). Case and extra spaces don't matter; words autocomplete. */
const WordEntry = ({
  label,
  hint,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  hint?: ReactNode;
  submitLabel: string;
  onSubmit: (words: string) => Promise<void>;
  onCancel: () => void;
}) => {
  const id = useId();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useFocusWhen<HTMLTextAreaElement>(true);
  const nextCaret = useRef<number | null>(null);
  // Typed words go too when the browser leaves the page, like shown ones (SY-3).
  useClearOnPageHide(text !== "", () => setText(""));

  // Numbers like "1." (from copying the numbered list) aren't words: no word has a digit.
  const cleaned = text.replace(/\d+[.)]?/g, " ");
  const count = cleaned.trim() ? cleaned.trim().split(/\s+/).length : 0;
  // The word being typed: the letters just before the caret.
  const typing = /[^\s\d.)]*$/.exec(text.slice(0, caret))![0];

  useEffect(() => {
    let current = true;
    if (!typing) {
      setSuggestions([]);
      return;
    }
    completeWord(typing).then(
      (words) => current && setSuggestions(words.filter((word) => word !== typing.toLowerCase())),
      () => current && setSuggestions([])
    );
    return () => {
      current = false;
    };
  }, [typing]);

  useEffect(() => {
    if (nextCaret.current === null || !field.current) return;
    field.current.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = null;
  });

  /** Replaces the word at the caret with `word` and a space. */
  const complete = (word: string) => {
    const start = caret - typing.length;
    const rest = text.slice(caret).replace(/^\S*/, "");
    const insert = /^\s/.test(rest) ? word : `${word} `;
    const next = text.slice(0, start) + insert + rest;
    const at = start + word.length + 1;
    nextCaret.current = at;
    setText(next);
    setCaret(at);
    field.current?.focus();
  };

  return (
    <form
      className="sync-word-entry"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(cleaned);
          setText("");
        } catch (err) {
          setError(errorText(err));
          field.current?.focus();
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={`${id}-words`}>{label}</label>
      {hint && (
        <p className="sync-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <textarea
        id={`${id}-words`}
        ref={field}
        rows={4}
        value={text}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        translate="no"
        aria-describedby={[hint && `${id}-hint`, `${id}-count`, error && `${id}-error`].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
      />
      <p className="sync-hint" id={`${id}-count`}>
        {count} of {SYNC_CODE_WORDS} words
      </p>
      {suggestions.length > 0 && (
        <div className="sync-suggestions" role="group" aria-label={`Words starting with ${typing}`}>
          {suggestions.map((word) => (
            <button key={word} type="button" className="sync-suggestion" onClick={() => complete(word)}>
              {word}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="sync-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      <div className="sync-actions">
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? "Checking…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
};

/** A button that opens an in-place confirmation, with focus moved to it and back again on Cancel. */
const ConfirmAction = ({
  label,
  title,
  confirmLabel,
  danger,
  children,
  onConfirm,
}: {
  label: string;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  children: ReactNode;
  onConfirm: () => Promise<void>;
}) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useFocusWhen<HTMLHeadingElement>(open);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      opener.current?.focus();
    }
  }, [open]);
  const cancel = () => {
    returnFocus.current = true;
    setError(null);
    setOpen(false);
  };

  if (!open) {
    return (
      <button ref={opener} type="button" className={danger ? "button-danger" : undefined} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div
      className={danger ? "sync-confirm sync-confirm-danger" : "sync-confirm"}
      role="group"
      aria-labelledby={`${id}-title`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) cancel();
      }}
    >
      <h3 id={`${id}-title`} tabIndex={-1} ref={heading}>
        {title}
      </h3>
      {children}
      {error && (
        <p className="sync-error" role="alert">
          {error}
        </p>
      )}
      <div className="sync-actions">
        <button
          type="button"
          className={danger ? "button-danger" : "button-primary"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
              setOpen(false);
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </button>
        <button type="button" onClick={cancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
};

type Announce = (message: string) => void;

/** Sync is off: turn it on with a new code, or with the words from another device. */
const SyncOff = ({
  startWithWords,
  onTurnedOn,
  announce,
}: {
  startWithWords: boolean;
  /** Shows the new code. Never rejects. */
  onTurnedOn: () => Promise<void>;
  announce: Announce;
}) => {
  const sync = useSync();
  const [enteringWords, setEnteringWords] = useState(startWithWords);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const haveCode = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!enteringWords && returnFocus.current) {
      returnFocus.current = false;
      haveCode.current?.focus();
    }
  }, [enteringWords]);

  const turnOn = async () => {
    setBusy(true);
    setError(null);
    announce("");
    try {
      await sync.turnOn();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      return;
    }
    await onTurnedOn();
  };

  return (
    <section className="sync-section" aria-labelledby="sync-off">
      <h2 id="sync-off">Sync is off on this device</h2>
      <p>
        Turn it on to keep your menus on your phone, your laptop and anywhere else you use this app. Each menu is
        encrypted on this device before it's sent, and only your own devices can read it.
      </p>
      <p>{LOCAL_MENUS_KEPT}</p>
      <p>
        Sync is a thank-you for <Link to="/support">supporters</Link>. You can turn it on first: nothing uploads
        until you support the project.
      </p>
      {enteringWords ? (
        <WordEntry
          label="Your sync code"
          hint="Type or paste the 24 words from your other device, in order. Capitals and extra spaces don't matter."
          submitLabel="Turn on sync"
          onSubmit={async (words) => {
            await sync.restore(words);
            announce("Sync is on. Menus from your other devices will appear in your Library as they arrive.");
          }}
          onCancel={() => {
            returnFocus.current = true;
            setEnteringWords(false);
          }}
        />
      ) : (
        <div className="sync-actions">
          <button type="button" className="button-primary" onClick={turnOn} disabled={busy}>
            {busy ? "Turning on…" : "Turn on sync"}
          </button>
          <button type="button" ref={haveCode} onClick={() => setEnteringWords(true)} disabled={busy}>
            I already have a sync code
          </button>
        </div>
      )}
      {error && (
        <p className="sync-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
};

/** Supporter status (SY-64…SY-67), or what's missing for it. */
const AccountStatus = ({ account }: { account: SyncAccount | null }) => {
  if (!account) return <p>Sync is on. Checking your supporter status…</p>;
  const purgeWarning = account.purgeSoon && account.purgeAt !== null && (
    <p className="sync-warning">
      Your synced menus will be deleted from the server on {formatDate(account.purgeAt)}. Support again before
      then to keep them. Menus on this device won't be affected.
    </p>
  );
  switch (account.status) {
    case "none":
      return (
        <>
          <p>{NOTICE_TEXT.not_supporter} Your menus are safe on this device meanwhile.</p>
          <p>
            <Link className="button button-primary" to="/support">
              Support the project
            </Link>
          </p>
        </>
      );
    case "lapsed":
      return (
        <>
          <p>
            Your supporter plan has ended, so sync is read-only. This device can still download your synced menus,
            but changes made here aren't uploaded. Menus on this device aren't affected.
          </p>
          {purgeWarning ||
            (account.purgeAt !== null && (
              <p>
                Your synced menus will be deleted from the server on {formatDate(account.purgeAt)}, unless you support
                again before then.
              </p>
            ))}
          <p>
            <Link className="button button-primary" to="/support">
              Support again
            </Link>
          </p>
        </>
      );
    case "past_due":
      return (
        <>
          <p>
            You're a supporter. Thank you! Your last payment didn't go through. Stripe will try again, and sync keeps
            working meanwhile. You can change your card with Manage subscription.
          </p>
          {purgeWarning}
        </>
      );
    case "lifetime":
      return <p>You're a lifetime supporter. Thank you!</p>;
    case "active":
      return (
        <>
          <p>
            You're a supporter. Thank you!
            {account.plan && ` Your plan: ${PLAN_TEXT[account.plan]}`}
            {account.plan &&
              account.renewsAt !== null &&
              `, ${account.cancelAtPeriodEnd ? "ends" : "renews"} on ${formatDate(account.renewsAt)}`}
            {account.plan && "."}
          </p>
          {purgeWarning}
        </>
      );
  }
};

/** "Show my sync code" (SY-3): hidden until asked for, and again on hiding it or leaving the page. */
const ShowCode = () => {
  const sync = useSync();
  const [words, setWords] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useFocusWhen<HTMLParagraphElement>(words !== null);
  const toggle = useRef<HTMLButtonElement>(null);
  useClearOnPageHide(words !== null, () => setWords(null));

  if (words) {
    return (
      <div className="sync-code-panel">
        <p className="sync-warning" tabIndex={-1} ref={heading}>
          {SYNC_CODE_WARNING}
        </p>
        <SyncCodeWords words={words} />
        <button
          type="button"
          onClick={() => {
            setWords(null);
            // The button is back once the words are gone.
            setTimeout(() => toggle.current?.focus());
          }}
        >
          Hide my sync code
        </button>
      </div>
    );
  }
  return (
    <>
      <p>The 24 words that turn on sync on another device. Only you have them.</p>
      <button
        type="button"
        ref={toggle}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setWords(await sync.syncCode());
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Show my sync code
      </button>
      {error && (
        <p className="sync-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
};

const minutesAndSeconds = (ms: number): string => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** "Add a device" (SY-10): a one-time QR code, the 24 words, and how long the code works. */
const AddDevice = () => {
  const sync = useSync();
  const [offer, setOffer] = useState<(PairingOffer & { words: string[] }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SyncErrorReason | null>(null);
  const [expired, setExpired] = useState(false);
  const now = useNow(offer !== null);
  const heading = useFocusWhen<HTMLParagraphElement>(offer !== null);
  const startButton = useRef<HTMLButtonElement>(null);
  useClearOnPageHide(offer !== null, () => setOffer(null));

  const remaining = offer ? offer.expiresAt - now : 0;
  useEffect(() => {
    if (offer && remaining <= 0) {
      const hadFocus = document.activeElement !== document.body && document.activeElement?.closest(".sync-pairing");
      setOffer(null);
      setExpired(true);
      if (hadFocus) setTimeout(() => startButton.current?.focus());
    }
  }, [offer, remaining]);

  const start = async () => {
    setBusy(true);
    setProblem(null);
    setExpired(false);
    try {
      const pairing = await sync.offerPairing();
      const words = await sync.syncCode();
      setOffer({ link: pairing.link, expiresAt: pairing.expiresAt, words });
    } catch (err) {
      setProblem(errorReason(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {offer ? (
        <div className="sync-pairing">
          <p tabIndex={-1} ref={heading}>
            On the other device, point the camera at this code and open the link. Sync turns on there by itself. The
            code works once.
          </p>
          <div className="sync-qr">
            <Suspense fallback={<p className="sync-hint">Drawing the QR code…</p>}>
              <QrCode value={offer.link} label="QR code that adds a device to your sync" />
            </Suspense>
          </div>
          <p className="sync-countdown">
            Works for another{" "}
            <span className="sync-countdown-time">{minutesAndSeconds(Math.max(0, remaining))}</span>
          </p>
          <p>
            No camera? On the other device, open {window.location.host}/sync, choose “I already have a sync code”,
            and type these words:
          </p>
          <p className="sync-warning">{SYNC_CODE_WARNING}</p>
          <SyncCodeWords words={offer.words} />
          <button
            type="button"
            onClick={() => {
              setOffer(null);
              setTimeout(() => startButton.current?.focus());
            }}
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <p>
            Show a QR code to scan with your phone or another computer. It turns on sync there with this device's
            code.
          </p>
          <button type="button" ref={startButton} onClick={start} disabled={busy}>
            {busy ? "Making a QR code…" : expired ? "Make a new QR code" : "Add a device"}
          </button>
        </>
      )}
      <div role="status">{expired && <p>That QR code has expired. Make a new one if you still need it.</p>}</div>
      {problem && (
        <div className="sync-error" role="alert">
          {problem === "not_supporter" ? (
            <p>
              Adding a device with a QR code needs supporter status: <Link to="/support">support the project</Link>
              . You can still turn on sync on the other device by typing your 24 words (Show my sync code).
            </p>
          ) : (
            <p>{ERROR_TEXT[problem]}</p>
          )}
        </div>
      )}
    </>
  );
};

/** "Manage subscription" (SY-64): Stripe's Customer Portal. */
const ManageSubscription = () => {
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <p>Change your card, see invoices or cancel, on Stripe's page.</p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            leavePage(await sync.manageSubscription());
          } catch (err) {
            setError(errorReason(err) === "not_supporter" ? "There's no subscription to manage yet." : errorText(err));
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening Stripe…" : "Manage subscription"}
      </button>
      {error && (
        <p className="sync-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
};

/** Notices the status above doesn't already explain. */
const noticesToShow = (state: Extract<SyncState, { kind: "on" }>): SyncNotice[] =>
  state.notices.filter(
    (notice) =>
      !(notice === "not_supporter" && state.account?.status === "none") &&
      !(notice === "read_only" && state.account?.status === "lapsed")
  );

/** Sync is on: status, progress, notices, the code, adding a device, the subscription, and turning it off. */
const SyncOn = ({
  state,
  startWithWords,
  onReplaced,
  announce,
}: {
  state: Extract<SyncState, { kind: "on" }>;
  startWithWords: boolean;
  /** Shows the new code. Never rejects. */
  onReplaced: () => Promise<void>;
  announce: Announce;
}) => {
  const sync = useSync();
  const { account } = state;
  const notices = noticesToShow(state);
  const replaced = state.notices.includes("code_replaced");
  // restore() while sync is on switches this device to the typed code and keeps its menus (SY-13).
  const [enteringWords, setEnteringWords] = useState(startWithWords);

  return (
    <>
      <section className="sync-section" aria-labelledby="sync-status">
        <h2 id="sync-status">Status</h2>
        <AccountStatus account={account} />
        <div role="status">
          <p>
            {state.pending === 0
              ? "Everything on this device is uploaded."
              : `${state.pending} ${state.pending === 1 ? "menu is" : "menus are"} waiting to upload.`}{" "}
            {state.lastSyncedAt === null ? "Not synced yet." : `Last synced ${formatTime(state.lastSyncedAt)}.`}
          </p>
          {notices.length > 0 && (
            <ul className="sync-notices">
              {notices.map((notice) => (
                <li key={notice}>
                  {NOTICE_TEXT[notice]}
                  {notice === "unreadable" &&
                    state.unreadable > 0 &&
                    ` ${state.unreadable} ${state.unreadable === 1 ? "record was" : "records were"} skipped, and nothing on this device was changed.`}
                </li>
              ))}
            </ul>
          )}
        </div>
        {enteringWords ? (
          <WordEntry
            label={replaced ? "Your new sync code" : "A different sync code"}
            hint="Type or paste the 24 words. Menus on this device are kept, and uploaded with the new code."
            submitLabel="Use this code"
            onSubmit={async (words) => {
              await sync.restore(words);
              setEnteringWords(false);
              announce("Sync is on with the new code.");
            }}
            onCancel={() => setEnteringWords(false)}
          />
        ) : (
          <div className="sync-actions">
            {replaced && (
              <button type="button" className="button-primary" onClick={() => setEnteringWords(true)}>
                Enter the new code
              </button>
            )}
            <button type="button" onClick={() => sync.syncNow()}>
              Sync now
            </button>
          </div>
        )}
      </section>

      <section className="sync-section" aria-labelledby="sync-code">
        <h2 id="sync-code">Your sync code</h2>
        <ShowCode />
      </section>

      <section className="sync-section" aria-labelledby="sync-add">
        <h2 id="sync-add">Add a device</h2>
        <AddDevice />
      </section>

      {account && account.status !== "none" && (
        <section className="sync-section" aria-labelledby="sync-subscription">
          <h2 id="sync-subscription">Subscription</h2>
          <ManageSubscription />
        </section>
      )}

      <section className="sync-section" aria-labelledby="sync-stop">
        <h2 id="sync-stop">Turn off or start over</h2>
        <div className="sync-stack">
          <ConfirmAction
            label="Turn off on this device"
            title="Turn off sync on this device?"
            confirmLabel="Turn off"
            onConfirm={async () => {
              await sync.turnOff();
              announce("Sync is off on this device. Your menus are still here, and still on your other devices.");
            }}
          >
            <p>
              Your menus stay on this device, and your synced menus stay on the server and your other devices. To
              turn sync on here again, you'll need your 24 words.
            </p>
          </ConfirmAction>
          <ConfirmAction
            label="Replace sync code"
            title="Replace your sync code?"
            confirmLabel="Replace sync code"
            onConfirm={async () => {
              try {
                await sync.replaceCode();
              } catch (err) {
                // The new code is kept until a check settles whether the server moved the account (SY-8).
                if (errorReason(err) !== "code_unconfirmed") throw err;
                announce(REPLACE_UNCONFIRMED);
                return;
              }
              await onReplaced();
            }}
          >
            <p>
              Do this if someone else may have seen your 24 words, or has a device you no longer trust. This device
              makes a new code, and moves your synced menus and supporter status to it. The old code stops working.
            </p>
            <p>Your other devices stop syncing until you enter the new code on each of them. Their menus stay.</p>
          </ConfirmAction>
          <ConfirmAction
            label="Delete synced menus"
            title="Delete your synced menus?"
            confirmLabel="Delete synced menus"
            danger
            onConfirm={async () => {
              await sync.deleteSyncedMenus();
              announce(
                "Your synced menus are deleted, and sync is off on this device. Your supporter status is unchanged."
              );
            }}
          >
            <p>
              <strong>This can't be undone.</strong> Every synced menu and live conversation hosted by this account
              is deleted from our server now, and sync turns off on this device.
            </p>
            <p>
              Menus on this and your other devices stay. Your supporter status and any subscription stay active.
              Turning sync on again can upload the menus kept on a device.
            </p>
          </ConfirmAction>
          <ConfirmAction
            label="Delete my account"
            title="Delete your account and supporter status?"
            confirmLabel="Delete my account"
            danger
            onConfirm={async () => {
              await sync.deleteSyncedData();
              announce(
                "Your account and synced data are deleted, and sync is off on this device. Your menus are still on this device."
              );
            }}
          >
            <p>
              <strong>This can't be undone.</strong> Every synced menu, live conversation and your sync account are
              deleted from our server now, and sync turns off on this device.
            </p>
            <p>
              Menus on this device stay. Your other devices keep their menus, but stop syncing. Any subscription is
              cancelled, so you won't be charged again.
              {account?.status === "lifetime" && " Your lifetime supporter status ends too, for good."}
            </p>
          </ConfirmAction>
        </div>
      </section>
    </>
  );
};

/**
 * Sync settings (`/sync`): turning sync on or off, the sync code, adding a
 * device, the subscription, and deleting synced data (docs/spec/sync.md §2, §3, §8).
 */
export const SyncSettingsPage = () => {
  const sync = useSync();
  const { state } = sync;
  const location = useLocation();
  const startWithWords = (location.state as SyncSettingsState | null)?.enterCode === true;
  const [newCode, setNewCode] = useState<{ words: string[]; replaced: boolean } | null>(null);
  const [outcome, setOutcome] = useState("");
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  useClearOnPageHide(newCode !== null, () => setNewCode(null));

  const announce: Announce = (message) => {
    setOutcome(message);
    if (message) setTimeout(() => outcomeRef.current?.focus());
  };

  /** Shows a code that was just made (SY-1, SY-8). Sync is already on by now, so this never fails the action. */
  const revealNewCode = async (replaced: boolean) => {
    try {
      setNewCode({ words: await sync.syncCode(), replaced });
    } catch {
      announce(
        `${replaced ? "Your sync code is replaced." : "Sync is on."} Use Show my sync code to see the 24 words, and keep them safe.`
      );
    }
  };

  return (
    <div className="sync-page">
      <h1>Sync</h1>
      <p className="sync-lead">
        Keep your menus the same on all your devices. They're encrypted on each device before they're sent, so
        nobody else can read them, not even us.
      </p>
      <p className="sync-outcome" role="status" tabIndex={-1} ref={outcomeRef}>
        {outcome}
      </p>

      {newCode ? (
        <NewCode
          words={newCode.words}
          replaced={newCode.replaced}
          onDone={() => {
            setNewCode(null);
            announce(newCode.replaced ? "Your sync code is replaced." : "Sync is on.");
          }}
        />
      ) : state.kind === "unsupported" ? (
        <section className="sync-section" aria-labelledby="sync-unsupported">
          <h2 id="sync-unsupported">Sync isn't available in this browser</h2>
          {UNSUPPORTED_TEXT.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      ) : state.kind === "off" ? (
        <SyncOff startWithWords={startWithWords} onTurnedOn={() => revealNewCode(false)} announce={announce} />
      ) : state.kind === "on" ? (
        <SyncOn
          state={state}
          startWithWords={startWithWords}
          onReplaced={() => revealNewCode(true)}
          announce={announce}
        />
      ) : null}
    </div>
  );
};
