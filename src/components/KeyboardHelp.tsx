import { useEffect, useRef } from "react";
import { SHORTCUTS } from "../keyboard";
import "./KeyboardHelp.css";

/**
 * Modal listing the menu editor's keyboard shortcuts.
 *
 * Closes on Escape, on "?" and on clicking the backdrop, and returns focus to
 * whatever was focused before it opened.
 */
export const KeyboardHelp = ({ onClose }: { onClose: () => void }) => {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="keyboard-help-backdrop" onClick={onClose}>
      <div
        className="keyboard-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="keyboard-help-header">
          <h2 id="keyboard-help-title">Keyboard controls</h2>
          <button
            ref={closeButton}
            type="button"
            className="keyboard-help-close"
            onClick={onClose}
            aria-label="Close keyboard controls"
          >
            ✕
          </button>
        </div>
        <p className="keyboard-help-intro">
          Highlight a row with ↑/↓ or j/k, then answer with 1–4. Press Enter to type, Esc
          to stop typing.
        </p>
        <div className="keyboard-help-sections">
          {SHORTCUTS.map(({ section, keys }) => (
            <section key={section}>
              <h3>{section}</h3>
              <dl>
                {keys.map(([combo, description]) => (
                  <div key={combo} className="keyboard-help-row">
                    <dt>
                      {combo.split(" / ").map((part, i) => (
                        <span key={part}>
                          {i > 0 && <span className="keyboard-help-or"> or </span>}
                          <kbd>{part}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd>{description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
