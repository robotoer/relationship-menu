import "./Support.css";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { SupportFrom, SupportPlan, track } from "../analytics";

/** Pay-what-you-want options. Amounts are in US dollars. */
export const SUPPORT_OPTIONS: { amount: 6 | 12 | 24 | 30; plan: SupportPlan; label: string; note: string }[] = [
  { amount: 6, plan: "yearly", label: "$6 / year", note: "Covers a few people's sync" },
  { amount: 12, plan: "yearly", label: "$12 / year", note: "Suggested" },
  { amount: 24, plan: "yearly", label: "$24 / year", note: "Keeps it free for others" },
  { amount: 30, plan: "lifetime", label: "$30 once", note: "Lifetime supporter" },
];

const SUPPORT_FROM: readonly SupportFrom[] = ["nav", "share", "compare", "landing"];

/**
 * "Support the project" page. Everything in the app stays free; supporters chip in
 * to keep it running and get a few conveniences as thanks.
 *
 * Checkout isn't open yet: choosing an amount says so plainly (it must never look
 * like a payment happened) and records which option was picked, to gauge interest.
 */
export const SupportPage = () => {
  const location = useLocation();
  const [chosen, setChosen] = useState<(typeof SUPPORT_OPTIONS)[number] | null>(null);
  const notice = useRef<HTMLDivElement>(null);

  // Where the visitor came from (set by the links that lead here), for analytics.
  const from = (location.state as { supportFrom?: SupportFrom } | null)?.supportFrom;
  useEffect(() => {
    track("support_viewed", { from: from && SUPPORT_FROM.includes(from) ? from : "direct" });
    // Once per visit to the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (chosen) notice.current?.focus();
  }, [chosen]);

  return (
    <div className="support-page">
      <h1>Support Relationship Menu</h1>
      <p className="support-lead">
        No ads, no accounts, no tracking of what you write. Your menus never leave your
        browser unless you choose to share them, and <strong>everything here stays free</strong>.
      </p>
      <p className="support-lead">
        If it's helped a conversation, you can chip in to keep it running. As thanks,
        supporters will get a few conveniences (we're building them now):
      </p>

      <ul className="support-perks">
        <li>
          <span className="support-perk-name">Sync across your devices</span>
          Start a menu on your laptop, answer it on your phone. Encrypted on your
          device before it's sent, so even we can't read your menus.
        </li>
        <li>
          <span className="support-perk-name">Encrypted backup</span>
          A new phone or a cleared browser doesn't mean starting over.
        </li>
        <li>
          <span className="support-perk-name">A supporter heart</span>
          A small pixel heart in the app, and our thanks.
        </li>
      </ul>

      <h2 id="support-amount">Pay what you like</h2>
      <div className="support-options" role="group" aria-labelledby="support-amount">
        {SUPPORT_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            className={
              option.note === "Suggested" ? "support-option support-option-suggested" : "support-option"
            }
            aria-pressed={chosen === option}
            onClick={() => {
              track("support_option_chosen", { amount_usd: option.amount, plan: option.plan });
              setChosen(option);
            }}
          >
            <span className="support-option-amount">{option.label}</span>
            <span className="support-option-note">{option.note}</span>
          </button>
        ))}
      </div>

      {chosen && (
        <div className="support-notice" role="status" tabIndex={-1} ref={notice}>
          <p>
            <strong>Thank you!</strong> Supporter checkout isn't open yet. We're building
            sync first, and choosing {chosen.label} here hasn't charged you anything.
          </p>
          <p>
            Picking an amount tells us people want this, which really helps. Until then,
            the best support is sharing the app with someone you'd like to talk with.
          </p>
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
