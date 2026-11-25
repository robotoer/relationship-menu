import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SharePane } from "./SharePane";
import "./ShareDialog.css";

/**
 * Share dialog for a menu, laid out in the order people actually use the links:
 * 1. send the template link so someone can fill in the same items privately,
 * 2. swap menu links (with answers) once you've both answered,
 * 3. paste their link to compare.
 * Slugs (the same data without the web address) are tucked under "Advanced".
 */
export const ShareDialog = ({
  title,
  personName,
  menuUrl,
  menuEncoded,
  templateUrl,
  templateEncoded,
  onClose,
}: {
  title: string;
  personName?: string;
  menuUrl: string;
  menuEncoded: string;
  templateUrl: string;
  templateEncoded: string;
  onClose: () => void;
}) => {
  const dialog = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [theirs, setTheirs] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const name = title || "this menu";
  const invite = `I made a relationship menu${title ? ` ("${title}")` : ""} for us to fill in. Open this link, mark each item, then send me your menu link: ${templateUrl}`;
  const canNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  // Focus the dialog, keep Tab inside it, close on Escape, restore focus on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input, summary, [tabindex]:not([tabindex='-1'])"
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  const compare = () => {
    const entries = [menuEncoded, theirs.trim()].filter(Boolean);
    navigate(`/compare?${entries.map((e) => `encoded=${encodeURIComponent(e)}`).join("&")}`);
  };

  return (
    <div className="share-dialog-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="share-dialog-header">
          <h2 id="share-dialog-title">Share "{name}"</h2>
          <button
            type="button"
            className="share-dialog-close"
            onClick={onClose}
            aria-label="Close share dialog"
          >
            ✕
          </button>
        </div>
        <p className="share-dialog-intro">
          Links carry the whole menu inside them, so nothing is uploaded. Send the
          template first; swap menu links once you've both answered.
        </p>

        <section className="share-step" aria-labelledby="share-step-invite">
          <h3 id="share-step-invite">
            <span className="share-step-number">1</span> Invite someone to fill it in
          </h3>
          <SharePane
            value={templateUrl}
            title="Template link"
            description="Your groups and items with no answers, so they answer without seeing yours. Opening it saves a copy in their browser."
          />
          <div className="share-step-actions">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(invite);
                  setInviteCopied(true);
                  setTimeout(() => setInviteCopied(false), 1500);
                } catch (e) {
                  console.error("Copy failed:", e);
                }
              }}
            >
              {inviteCopied ? "Copied!" : "Copy invite message"}
            </button>
            {canNativeShare && (
              <button
                type="button"
                onClick={() =>
                  navigator
                    .share({ title: "Relationship menu", text: invite })
                    .catch(() => {})
                }
              >
                Share…
              </button>
            )}
            <span className="sr-only" role="status" aria-live="polite">
              {inviteCopied ? "Invite message copied" : ""}
            </span>
          </div>
        </section>

        <section className="share-step" aria-labelledby="share-step-answers">
          <h3 id="share-step-answers">
            <span className="share-step-number">2</span> Share your answers
          </h3>
          <SharePane
            value={menuUrl}
            title="Menu link"
            description={`Includes your answers and notes${
              personName ? `, and your name (${personName})` : ""
            }. Anyone with this link can see them, so send it only to the people you're comparing with.`}
          />
        </section>

        <section className="share-step" aria-labelledby="share-step-compare">
          <h3 id="share-step-compare">
            <span className="share-step-number">3</span> Compare
          </h3>
          <form
            className="share-compare"
            onSubmit={(e) => {
              e.preventDefault();
              compare();
            }}
          >
            <label htmlFor="share-their-link">
              Got their menu link? Paste it to compare with yours.
            </label>
            <div className="share-input-container">
              <input
                id="share-their-link"
                value={theirs}
                placeholder="Their menu link or slug"
                onChange={(e) => setTheirs(e.target.value)}
              />
              <button type="submit" className="button-primary">
                Compare
              </button>
            </div>
          </form>
        </section>

        <details className="share-advanced">
          <summary>Advanced: slugs</summary>
          <p>
            A slug is the same data as a link without the web address. Paste one into
            Compare, or use it where long links get cut off.
          </p>
          <div className="share-advanced-panes">
            <SharePane value={menuEncoded} title="Menu slug" description="With your answers." />
            <SharePane value={templateEncoded} title="Template slug" description="No answers." />
          </div>
        </details>
      </div>
    </div>
  );
};
