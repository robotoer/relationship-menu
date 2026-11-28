import { useState } from "react";
import { CompareInput } from "./CompareInput";
import { encodeMenuSlug } from "../compare-slug";
import "./CompareSection.css";

/** How many menus one comparison holds (same ceiling as a conversation). */
export const COMPARE_LIMIT = 8;

/** One of this browser's saved menus, offered to add to the comparison. */
export type LibraryMenu = { title: string; encoded: string; person?: { name?: string } };

/**
 * <CompareSection /> is where the menus to compare are chosen: one stacked box per
 * menu, a "+" underneath to add another, and the saved menus from this browser to
 * pick from instead of pasting a link.
 *
 * The filled boxes come first, then one empty box. Typing or pasting into the empty
 * box adds a menu and leaves a fresh empty one; clearing a box removes that menu. The
 * empty box is in the same keyed list as the others, so React keeps its DOM element
 * (and the caret in it) rather than remounting it.
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
  const [picking, setPicking] = useState(false);
  const full = menus.length >= COMPARE_LIMIT;
  const entries = full ? menus : [...menus, ""];
  const already = new Set(menus.map((menu) => menu.trim()).filter(Boolean));
  const offered = library
    .map((menu) => ({
      title: menu.person?.name || menu.title || "Untitled menu",
      slug: encodeMenuSlug(menu.title, menu.encoded, menu.person),
    }))
    .filter((menu) => !already.has(menu.slug));
  const add = (value: string) => {
    if (!value.trim() || full) return;
    onChange([...menus, value]);
  };
  return (
    <div className="compare-section">
      <div className="compare-boxes">
        {entries.map((menu, index) => {
          const isNew = index === menus.length;
          return (
            <CompareInput
              key={index}
              label={(!isNew && titles[index]) || `Menu ${index + 1}`}
              value={menu}
              error={isNew ? undefined : errors[index]}
              onChange={(value) => {
                if (isNew) {
                  if (!value) return;
                  onChange([...menus, value]);
                  return;
                }
                if (!value) {
                  onChange(menus.filter((_, i) => i !== index));
                  return;
                }
                const updated = [...menus];
                updated[index] = value;
                onChange(updated);
              }}
            />
          );
        })}
      </div>

      {/* One more menu: paste a link, or pick one already saved here. */}
      {!full && (
        <div className="compare-add">
          <button
            type="button"
            className="compare-add-button"
            aria-expanded={picking}
            aria-controls="compare-library"
            onClick={() => setPicking((open) => !open)}
          >
            + {picking ? "Hide my menus" : "Add a menu"}
          </button>
          {menus.length >= 2 && (
            <span className="compare-add-note">
              {menus.length} of {COMPARE_LIMIT} menus
            </span>
          )}
        </div>
      )}

      {picking && (
        <div className="compare-library" id="compare-library" role="group" aria-label="Your saved menus">
          {offered.length === 0 ? (
            <p className="compare-library-empty">
              {library.length === 0
                ? "You haven't saved any menus in this browser yet."
                : "Every saved menu is already in this comparison."}
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
        </div>
      )}

      <button className="compare-button" onClick={onCompare} disabled={!canCompare}>
        Compare
      </button>
    </div>
  );
};
