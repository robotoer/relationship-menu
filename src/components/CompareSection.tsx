import { useEffect, useRef, useState } from "react";
import { CompareInput } from "./CompareInput";
import { encodeMenuSlug } from "../compare-slug";
import "./CompareSection.css";

/** How many menus one comparison holds (same ceiling as a conversation). */
export const COMPARE_LIMIT = 8;

/** One of this browser's saved menus, offered to add to the comparison. */
export type LibraryMenu = { title: string; encoded: string; person?: { name?: string } };

/**
 * <CompareSection /> is where the menus to compare are chosen (SV-19).
 *
 * There is one box per menu and nothing else: no permanent empty slot. Adding happens
 * through a single "Add a menu" card, which offers the two things people actually do —
 * pick a menu saved in this browser, or paste a link — instead of one button that
 * silently does one of them. Every box has a visible ✕, so removing a menu is
 * discoverable; clearing a box's text still removes it, as before.
 *
 * With no menus yet, the card is open and the paste field has focus, so the
 * fastest path (paste a link) is still one field away.
 */
export const CompareSection = ({
  titles,
  menus,
  errors = [],
  onChange,
  onCompare,
  canCompare,
  library = [],
}: {
  titles: string[];
  menus: string[];
  errors?: (string | undefined)[];
  onChange: (menus: string[]) => void;
  onCompare: () => void;
  canCompare: boolean;
  /** Saved menus in this browser, to add without pasting a link. */
  library?: LibraryMenu[];
}) => {
  const [adding, setAdding] = useState(menus.length === 0);
  const [pasted, setPasted] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const full = menus.length >= COMPARE_LIMIT;
  const already = new Set(menus.map((menu) => menu.trim()).filter(Boolean));
  const offered = library
    .map((menu) => ({
      title: menu.person?.name || menu.title || "Untitled menu",
      slug: encodeMenuSlug(menu.title, menu.encoded, menu.person),
    }))
    .filter((menu) => !already.has(menu.slug));

  // Opening the card puts the caret in the paste field: pasting a link is the
  // commonest first move, and choosing from the list is a click away.
  useEffect(() => {
    if (adding) field.current?.focus();
  }, [adding]);

  const add = (value: string) => {
    const slug = value.trim();
    if (!slug || full) return;
    onChange([...menus, slug]);
    // Close as part of adding, not a render later: a card that vanishes on its own
    // can disappear under the person using it.
    setPasted("");
    setAdding(false);
  };
  const remove = (index: number) => onChange(menus.filter((_, i) => i !== index));
  const close = () => {
    setAdding(false);
    setPasted("");
  };

  return (
    <div className="compare-section">
      {menus.length > 0 && (
        <ul className="compare-boxes" aria-label="Menus being compared">
          {menus.map((menu, index) => (
            <li key={index} className="compare-box">
              <CompareInput
                label={titles[index] || `Menu ${index + 1}`}
                value={menu}
                error={errors[index]}
                onChange={(value) => {
                  // Clearing the text removes the menu, as it always has; the ✕ is
                  // the discoverable way to do the same thing on purpose.
                  if (!value) {
                    remove(index);
                    return;
                  }
                  const updated = [...menus];
                  updated[index] = value;
                  onChange(updated);
                }}
              />
              <button
                type="button"
                className="compare-remove"
                aria-label={`Remove ${titles[index] || `menu ${index + 1}`}`}
                title="Remove this menu from the comparison"
                onClick={() => remove(index)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {!full && !adding && (
        <button type="button" className="compare-add-open" onClick={() => setAdding(true)}>
          + Add a menu
        </button>
      )}

      {!full && adding && (
        <form
          className="compare-add-card"
          aria-label="Add a menu"
          onSubmit={(e) => {
            e.preventDefault();
            add(pasted);
          }}
        >
          <h2>{menus.length === 0 ? "Add the first menu" : "Add another menu"}</h2>

          <label className="compare-add-field">
            <span>Paste a menu link or share link</span>
            <input
              ref={field}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="https://…/menu?encoded=…"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onKeyDown={(e) => {
                if (e.key === "Escape" && menus.length > 0) close();
              }}
            />
          </label>
          <div className="compare-add-actions">
            <button type="submit" className="button-primary" disabled={!pasted.trim()}>
              Add
            </button>
            {menus.length > 0 && (
              <button type="button" onClick={close}>
                Cancel
              </button>
            )}
          </div>

          <p className="compare-add-or">or choose one of your menus</p>
          {offered.length === 0 ? (
            <p className="compare-add-empty">
              {library.length === 0
                ? "Nothing saved in this browser yet. Make a menu and it will appear here."
                : "Every menu saved here is already in this comparison."}
            </p>
          ) : (
            <ul className="compare-library-list">
              {offered.map((menu) => (
                <li key={menu.slug}>
                  <button type="button" onClick={() => add(menu.slug)}>
                    {menu.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}

      <div className="compare-footer">
        <button className="compare-button" onClick={onCompare} disabled={!canCompare}>
          Compare
        </button>
        {menus.length >= 2 && (
          <span className="compare-add-note">
            {menus.length} of {COMPARE_LIMIT} menus
          </span>
        )}
        {full && <span className="compare-add-note">That's all {COMPARE_LIMIT} of them.</span>}
      </div>
    </div>
  );
};
