import "./Support.css";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SupportAmount, SupportFrom, SupportPlan, track } from "../analytics";
import {
  CheckoutPlan,
  SUPPORTER_STATUSES,
  SyncAccount,
  SyncError,
  SyncErrorReason,
  isSupporter,
  useSync,
} from "../sync/context";

export type SupportOption = {
  amount: SupportAmount;
  plan: SupportPlan;
  /** The server's plan id (SY-60). */
  checkoutPlan: CheckoutPlan;
  label: string;
  note: string;
};

/** Pay-what-you-want options (SY-60). Amounts are in US dollars. */
export const SUPPORT_OPTIONS: SupportOption[] = [
  { amount: 6, plan: "yearly", checkoutPlan: "supporter_6_yearly", label: "$6 / year", note: "Covers a few people's sync" },
  { amount: 12, plan: "yearly", checkoutPlan: "supporter_12_yearly", label: "$12 / year", note: "Suggested" },
  { amount: 24, plan: "yearly", checkoutPlan: "supporter_24_yearly", label: "$24 / year", note: "Keeps it free for others" },
  { amount: 30, plan: "lifetime", checkoutPlan: "supporter_30_lifetime", label: "$30 once", note: "Lifetime supporter" },
];

const SUPPORT_FROM: readonly SupportFrom[] = ["nav", "share", "compare", "landing", "live", "coach"];

const optionFor = (plan: CheckoutPlan | null | undefined) => SUPPORT_OPTIONS.find((o) => o.checkoutPlan === plan);

/**
 * The plan chosen before leaving for Checkout, kept for this tab only: the return
 * URL carries just `checkout=done` or `=cancelled`, and a cancel has no server
 * status to read the plan from (SY-61). Only the plan id is kept, never a URL.
 */
export const CHECKOUT_PLAN_KEY = "support:checkout-plan";

const rememberPlan = (plan: CheckoutPlan) => {
  try {
    sessionStorage.setItem(CHECKOUT_PLAN_KEY, plan);
  } catch {
    // Storage blocked: only the cancel event is lost.
  }
};

/** Reads and forgets the remembered plan. */
const takeRememberedPlan = (): SupportOption | undefined => {
  try {
    const plan = sessionStorage.getItem(CHECKOUT_PLAN_KEY);
    sessionStorage.removeItem(CHECKOUT_PLAN_KEY);
    return optionFor(plan as CheckoutPlan | null);
  } catch {
    return undefined;
  }
};

/**
 * How long to wait between asks for the status after returning from Checkout:
 * about a minute in all (SY-69). Stripe's webhook usually lands within seconds.
 */
export const CONFIRM_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 15000, 15000];

const reasonOf = (error: unknown): SyncErrorReason => (error instanceof SyncError ? error.reason : "failed");

/** Plain words for a Checkout that couldn't start (SY-61). Nothing was charged in any of these. */
const checkoutErrorText = (reason: SyncErrorReason): string => {
  switch (reason) {
    case "offline":
      // The server may have answered and the reply been lost, so say only what's sure:
      // no payment happens without Stripe's page. A sync code made just now is kept.
      return "We didn't get an answer from our server, so checkout didn't open. Nothing was charged. Check your connection and try again.";
    case "rate_limited":
      return "That was several tries in a short time. Nothing was charged. Please wait a minute and try again.";
    case "unavailable":
      return "Checkout isn't available here right now. Nothing was charged.";
    default:
      return "Something went wrong opening checkout. Nothing was charged. Please try again.";
  }
};

/** Plain words for a Customer Portal that couldn't open (SY-64). */
const portalErrorText = (reason: SyncErrorReason): string => {
  switch (reason) {
    case "offline":
      // A portal session on its own changes nothing about the subscription.
      return "We didn't get an answer from our server. Nothing changed. Check your connection and try again.";
    case "rate_limited":
      return "That was several tries in a short time. Nothing changed. Please wait a minute and try again.";
    case "not_supporter":
      return "We couldn't find a subscription for this sync code. Nothing changed.";
    default:
      return "Something went wrong opening your subscription. Nothing changed. Please try again.";
  }
};

const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { dateStyle: "long" });

/** What the supporter sees instead of the amounts (SY-64): their plan, its date, and the portal. */
const SupporterStatus = ({
  account,
  onManage,
  busy,
}: {
  account: SyncAccount;
  onManage: () => void;
  busy: boolean;
}) => {
  if (account.status === "lifetime") {
    return <p>You're a lifetime supporter. There's nothing to renew. Thank you!</p>;
  }
  const option = optionFor(account.plan);
  return (
    <>
      <p>
        You're supporting at {option ? `$${option.amount} a year` : "a yearly amount"}.
        {account.renewsAt !== null && (
          <>
            {" "}{account.cancelAtPeriodEnd ? "Ends" : "Renews"} on {formatDate(account.renewsAt)}.
          </>
        )}
      </p>
      {account.status === "past_due" && (
        <p>
          Your last payment didn't go through. Stripe will try again, and sync keeps working
          meanwhile. You can update your card under Manage subscription.
        </p>
      )}
      <p>Change the amount, update your card, see receipts or cancel in Stripe's portal.</p>
      <button type="button" className="button-primary" onClick={onManage} disabled={busy}>
        {busy ? "Opening…" : "Manage subscription"}
      </button>
    </>
  );
};

type Returned = "done" | "cancelled" | null;
/** After `?checkout=done`: asking the server, confirmed, still unconfirmed after a minute, or sync isn't on here. */
type Confirmation = "waiting" | "confirmed" | "slow" | "checking" | "no_sync";

/**
 * "Support the project" page. Everything in the app stays free; supporters chip in
 * to keep it running and get sync, encrypted backup and a heart as thanks.
 *
 * Choosing an amount opens Stripe Checkout through the sync runtime (SY-61), which
 * first turns sync on if it's off. Coming back, the page waits for the server to
 * report the supporter status before it says thank you (SY-69).
 *
 * `openStripe` leaves for a Stripe page; tests pass their own.
 */
export const SupportPage = ({
  openStripe = (url: string) => window.location.assign(url),
}: {
  openStripe?: (url: string) => void;
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const sync = useSync();
  const { state } = sync;
  // The latest actions, for effects and timers that outlive a render.
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  });

  // Where the visitor came from (set by the links that lead here), for analytics.
  const from = (location.state as { supportFrom?: SupportFrom } | null)?.supportFrom;
  useEffect(() => {
    track("support_viewed", { from: from && SUPPORT_FROM.includes(from) ? from : "direct" });
    // Once per visit to the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Coming back from Checkout ----

  const [returned] = useState<Returned>(() => {
    const value = new URLSearchParams(location.search).get("checkout");
    return value === "done" || value === "cancelled" ? value : null;
  });
  const [confirmation, setConfirmation] = useState<Confirmation>("waiting");
  const [round, setRound] = useState(0);
  /** The account as the server last told this page, when it's fresher than `state` (after a return or a 409). */
  const [fetchedAccount, setFetchedAccount] = useState<SyncAccount | null>(null);
  const completedSent = useRef(false);
  const returnNotice = useRef<HTMLDivElement>(null);

  // Take `?checkout=…` out of the address, so a reload or a bookmark doesn't replay it.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has("checkout")) return;
    params.delete("checkout");
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash },
      { replace: true, state: location.state }
    );
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (returned === "cancelled") {
      const option = takeRememberedPlan();
      if (option) track("checkout_cancelled", { amount_usd: option.amount, plan: option.plan });
    } else if (returned === "done") {
      // The server's plan is the one that counts now.
      takeRememberedPlan();
    }
    if (returned) returnNotice.current?.focus();
  }, [returned]);

  const confirm = (account: SyncAccount) => {
    setFetchedAccount(account);
    setConfirmation("confirmed");
    const option = optionFor(account.plan);
    if (option && !completedSent.current) {
      completedSent.current = true;
      track("checkout_completed", { amount_usd: option.amount, plan: option.plan });
    }
  };

  // Ask the server until it reports a supporter status, backing off, for about a minute.
  const ready = state.kind !== "loading";
  const syncOff = state.kind === "off" || state.kind === "unsupported";
  useEffect(() => {
    if (returned !== "done" || !ready || round > 0) return;
    if (syncOff) {
      setConfirmation("no_sync");
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const check = async () => {
      let account: SyncAccount | null = null;
      try {
        account = await syncRef.current.refreshAccount();
      } catch {
        // Offline or rate limited: try again on the next step.
      }
      if (stopped) return;
      if (account && SUPPORTER_STATUSES.includes(account.status)) return confirm(account);
      if (attempt >= CONFIRM_BACKOFF_MS.length) return setConfirmation("slow");
      timer = setTimeout(check, CONFIRM_BACKOFF_MS[attempt++]);
    };
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned, ready, syncOff, round]);

  const checkAgain = async () => {
    setRound((r) => r + 1);
    setConfirmation("checking");
    let account: SyncAccount | null = null;
    try {
      account = await syncRef.current.refreshAccount();
    } catch {
      // Same as not confirmed yet.
    }
    if (account && SUPPORTER_STATUSES.includes(account.status)) confirm(account);
    else setConfirmation("slow");
  };

  // ---- Choosing an amount ----

  const [pending, setPending] = useState<CheckoutPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [alreadySupporter, setAlreadySupporter] = useState(false);
  const errorNotice = useRef<HTMLDivElement>(null);

  // Coming back to this page with the Back button restores it as it was left: busy.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setPending(null);
        setPortalBusy(false);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    if (error) errorNotice.current?.focus();
  }, [error]);

  const choose = async (option: SupportOption) => {
    setError(null);
    setPending(option.checkoutPlan);
    let url: string;
    try {
      url = await sync.checkout(option.checkoutPlan);
    } catch (e) {
      setPending(null);
      const reason = reasonOf(e);
      if (reason === "already_supporter") {
        setAlreadySupporter(true);
        try {
          setFetchedAccount(await sync.refreshAccount());
        } catch {
          // The message below still says so.
        }
        return;
      }
      setError(checkoutErrorText(reason));
      return;
    }
    track("checkout_started", { amount_usd: option.amount, plan: option.plan });
    rememberPlan(option.checkoutPlan);
    openStripe(url);
  };

  const manage = async () => {
    setError(null);
    setPortalBusy(true);
    try {
      openStripe(await sync.manageSubscription());
    } catch (e) {
      setPortalBusy(false);
      setError(portalErrorText(reasonOf(e)));
    }
  };

  const supporterAccount =
    state.kind === "on" && isSupporter(state)
      ? state.account
      : fetchedAccount && SUPPORTER_STATUSES.includes(fetchedAccount.status)
        ? fetchedAccount
        : null;
  // While a return is being confirmed, don't offer the amounts again: that invites paying twice.
  const confirming = returned === "done" && confirmation !== "confirmed";
  const canCheckout = state.kind === "off" || state.kind === "on";

  return (
    <div className="support-page">
      <h1>Support Wants &amp; Won'ts</h1>

      {returned && (
        <div className="support-notice support-return" role="status" tabIndex={-1} ref={returnNotice}>
          {returned === "cancelled" && (
            <p>
              Checkout was cancelled, and nothing was charged. You're welcome to pick an amount
              whenever you like, or not at all: everything here stays free.
            </p>
          )}
          {returned === "done" && (confirmation === "waiting" || confirmation === "checking") && (
            <p>Waiting for Stripe to confirm…</p>
          )}
          {returned === "done" && confirmation === "confirmed" && (
            <p>
              <strong>Thank you, you're a supporter!</strong>
            </p>
          )}
          {returned === "done" && confirmation === "slow" && (
            <>
              <p>
                Stripe hasn't confirmed your payment yet. It can take a few minutes, and you
                don't need to pay again.
              </p>
              <button type="button" onClick={checkAgain}>
                Check again
              </button>
            </>
          )}
          {returned === "done" && confirmation === "no_sync" && (
            <p>
              Sync isn't on in this browser, so we can't check your supporter status here. Your
              support is linked to the sync code that was on when you paid: turn on sync with that
              code in <Link to="/sync">sync settings</Link>.
            </p>
          )}
          {returned === "done" && (confirmation === "confirmed" || confirmation === "slow") && (
            <p>
              Next, save your sync code. It's the only key to your synced menus, and we can't
              recover it. <Link to="/sync">Show my sync code</Link>
            </p>
          )}
        </div>
      )}

      <p className="support-lead">
        No ads, no sign-up, no tracking of what you write. Your menus stay in your browser
        unless you share them or turn on sync, and <strong>everything here stays free</strong>.
      </p>
      <p className="support-lead">
        If it's helped a conversation, you can chip in to keep it running. As thanks,
        supporters get a few conveniences:
      </p>

      <ul className="support-perks">
        <li>
          <span className="support-perk-name">Sync across your devices</span>
          Start a menu on your laptop, answer it on your phone. Menus are encrypted on your
          device before they're sent, so even we can't read them.
        </li>
        <li>
          <span className="support-perk-name">Encrypted backup</span>
          A new phone or a cleared browser doesn't mean starting over: your sync code brings
          your menus back.
        </li>
        <li>
          <span className="support-perk-name">A supporter heart</span>
          A small pixel heart in the menu bar, and our thanks.
        </li>
      </ul>

      {supporterAccount ? (
        <>
          <h2>Your support</h2>
          <div className="support-status">
            <SupporterStatus account={supporterAccount} onManage={manage} busy={portalBusy} />
          </div>
        </>
      ) : confirming ? null : (
        <>
          <h2 id="support-amount">Pay what you like</h2>
          {state.kind === "unsupported" && (
            <div className="support-notice" id="support-checkout-note">
              <p>
                This browser can't sync, so supporter checkout can't start here: sync needs
                encryption that this browser doesn't have. Everything else in the app works as
                usual.
              </p>
              <p>
                To support, open this page in a recent browser: Chrome or Edge 137 or later,
                Firefox 129 or later, or Safari 17 or later.
              </p>
            </div>
          )}
          {state.kind === "off" && (
            <p className="support-checkout-note" id="support-checkout-note">
              Choosing an amount turns on sync in this browser and creates your sync code, which
              you'll see after paying. Payment is handled by Stripe.
            </p>
          )}
          {state.kind === "on" && (
            <p className="support-checkout-note" id="support-checkout-note">
              Sync is already on in this browser, so your support goes to its sync code. Payment
              is handled by Stripe.
            </p>
          )}
          <div
            className="support-options"
            role="group"
            aria-labelledby="support-amount"
            aria-describedby={state.kind === "loading" ? undefined : "support-checkout-note"}
            aria-busy={pending !== null}
          >
            {SUPPORT_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                className={
                  option.note === "Suggested" ? "support-option support-option-suggested" : "support-option"
                }
                disabled={!canCheckout || pending !== null}
                onClick={() => void choose(option)}
              >
                <span className="support-option-amount">{option.label}</span>
                <span className="support-option-note">
                  {pending === option.checkoutPlan ? "Opening checkout…" : option.note}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {alreadySupporter && (
        <div className="support-notice" role="status">
          <p>This sync code is already a supporter, so nothing was charged. Thank you!</p>
        </div>
      )}

      {error && (
        <div className="support-notice support-error" role="alert" tabIndex={-1} ref={errorNotice}>
          <p>{error}</p>
        </div>
      )}

      <h2>Other ways to help</h2>
      <ul className="support-other">
        <li>
          Send a <Link to="/menu">menu</Link> to someone, or tell a friend about it.
        </li>
        <li>
          Report bugs or ideas, or star the project, on{" "}
          <a href="https://github.com/robotoer/relationship-menu" target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </li>
      </ul>
    </div>
  );
};
