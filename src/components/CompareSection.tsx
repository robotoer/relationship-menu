import { useEffect, useMemo, useRef, useState } from "react";
import { decodeCompareSlug, encodeMenuSlug } from "../compare-slug";
import "./CompareSection.css";

/** How many menus one comparison holds (same ceiling as a conversation). */
export const COMPARE_LIMIT = 8;

/** One of this browser's saved menus, offered to add to the comparison. */
export type LibraryMenu = { title: string; encoded: string; person?: { name?: string } };

/** Where a compared menu came from, shown on its card so that's never a guess. */
export type MenuSource = "library" | "link";

/** What one compared entry is, for the cards and the collapsed summary. */
export type MenuSlot = { title: string; source: MenuSource; items: number | null };

const menuName = (menu: LibraryMenu) => menu.person?.name || menu.title || "Untitled menu";

/** "Your library" / "Pasted link": the badge that says where a menu came from. */
export const SOURCE_LABELS: Record<MenuSource, string> = { library: "Your library", link: "Pasted link" };

/** The menus in the comparison, as the cards and the collapsed line describe them. */
export const menuSlots = (menus: string[], titles: string[], library: LibraryMenu[]): MenuSlot[] => {
  const fromLibrary = new Set(library.map((menu) => encodeMenuSlug(menu.title, menu.encoded, menu.person)));
  return menus.map((menu, index) => {
    const decoded = decodeCompareSlug(menu);
    const items = decoded ? Object.values(decoded.menu).reduce((n, group) => n + (group?.length ?? 0), 0) : null;
    return {
      title: decoded?.title || titles[index] || `Menu ${index + 1}`,
      source: fromLibrary.has(menu.trim()) ? "library" : "link",
      items,
    };
  });
};

/**
 * <CompareSection /> is where the menus to compare are chosen (SV-19, SV-20).
 *
 * Two states, so the page belongs to the comparison once it exists:
 *
 * - **Editing:** one card per menu — its name, where it came from ("Your library" or
 *   "Pasted link") and how many items — with "Change" and a visible ✕ on each. Menus
 *   are added through one "Add a menu" card that opens a picker: search your saved
 *   menus, or paste a link. No raw slug is ever shown as the main thing.
 * - **Collapsed** (after Compare): a single line naming the menus, with their source
 *   badges, and "Edit menus" to come back.
 */
export const CompareSection = ({
  titles,
  menus,
  errors = [],
  onChange,
  onCompare,
  canCompare,
  library = [],
  collapsed = false,
  onEdit,
}: {
  titles: string[];
  menus: string[];
  errors?: (string | undefined)[];
  onChange: (menus: string[]) => void;
  onCompare: () => void;
  canCompare: boolean;
  /** Saved menus in this browser, to add without pasting a link. */
  library?: LibraryMenu[];
  /** After Compare: one compact line instead of the editor. */
  collapsed?: boolean;
  onEdit?: () => void;
}) => {
  const slots = useMemo(() => menuSlots(menus, titles, library), [menus, titles, library]);
  /** Which slot is being chosen for: "new", an index to change, or null when closed. */
  const [picker, setPicker] = useState<"new" | number | null>(menus.length === 0 ? "new" : null);
  const [query, setQuery] = useState("");
  const [pasted, setPasted] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const full = menus.length >= COMPARE_LIMIT;

  const libraryMenus = useMemo(
    () => library.map((menu) => ({ name: menuName(menu), slug: encodeMenuSlug(menu.title, menu.encoded, menu.person) })),
    [library]
  );
  // Menus already in the comparison, except the slot being changed, aren't offered.
  const used = new Set(menus.map((menu, index) => (index === picker ? "" : menu.trim())));
  const offered = libraryMenus
    .filter((menu) => !used.has(menu.slug))
    .filter((menu) => menu.name.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (picker !== null) field.current?.focus();
  }, [picker]);

  const choose = (value: string) => {
    const slug = value.trim();
    if (!slug || full) return;
    if (typeof picker === "number") {
      const updated = [...menus];
      updated[picker] = slug;
      onChange(updated);
    } else {
      onChange([...menus, slug]);
    }
    setPasted("");
    setQuery("");
    setPicker(null);
  };
  const remove = (index: number) => onChange(menus.filter((_, i) => i !== index));
  const closePicker = () => {
    setPicker(null);
    setPasted("");
    setQuery("");
  };

  if (collapsed) {
    return (
      <section className="compare-section compare-section-collapsed" aria-label="Menus being compared">
        <span className="compare-summary-label">Comparing</span>
        <ul className="compare-chips">
          {slots.map((slot, index) => (
            <li key={index} className="compare-chip">
              <span className="compare-chip-name">{slot.title}</span>
              <span className={`compare-source compare-source-${slot.source}`}>{SOURCE_LABELS[slot.source]}</span>
            </li>
          ))}
        </ul>
        {onEdit && (
          <button type="button" className="compare-edit" onClick={onEdit}>
            Edit menus
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="compare-section" aria-label="Choose menus to compare">
      <p className="compare-instructions">
        {menus.length === 0
          ? "Pick two or more menus to see where they agree, where they differ, and what to talk about. They stay on this device."
          : "Check these, then press Compare. You can change them any time."}
      </p>

      {menus.length > 0 && (
        <ul className="compare-slots" aria-label="Menus being compared">
          {menus.map((menu, index) => {
            const slot = slots[index];
            return (
              <li key={index} className="compare-slot">
                <div className="compare-slot-main">
                  <span className="compare-slot-name">{slot.title}</span>
                  <span className="compare-slot-meta">
                    <span className={`compare-source compare-source-${slot.source}`}>{SOURCE_LABELS[slot.source]}</span>
                    {slot.items !== null && ` · ${slot.items} item${slot.items === 1 ? "" : "s"}`}
                  </span>
                  {errors[index] && <span className="compare-slot-error">{errors[index]}</span>}
                </div>
                <div className="compare-slot-actions">
                  <button type="button" onClick={() => setPicker(index)}>
                    Change
                  </button>
                  <button
                    type="button"
                    className="compare-remove"
                    aria-label={`Remove ${slot.title}`}
                    title="Remove from the comparison"
                    onClick={() => remove(index)}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {picker === null && !full && (
        <button type="button" className="compare-add-open" onClick={() => setPicker("new")}>
          + Add a menu
        </button>
      )}

      {picker !== null && (
        <form
          className="compare-picker"
          aria-label={typeof picker === "number" ? "Change this menu" : "Add a menu"}
          onSubmit={(event) => {
            event.preventDefault();
            choose(pasted);
          }}
        >
          <h2>{typeof picker === "number" ? "Change this menu" : menus.length ? "Add another menu" : "Add the first menu"}</h2>

          <div className="compare-picker-library">
            <p className="compare-picker-title">From your library</p>
            {libraryMenus.length === 0 ? (
              <p className="compare-picker-empty">Nothing saved in this browser yet. Make a menu and it will appear here.</p>
            ) : (
              <>
                <label className="compare-search">
                  <span className="sr-only">Search your menus</span>
                  <input
                    type="search"
                    value={query}
                    placeholder="Search your menus"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                {offered.length === 0 ? (
                  <p className="compare-picker-empty">
                    {query.trim() ? "No menu matches that." : "Every menu saved here is already in this comparison."}
                  </p>
                ) : (
                  <ul className="compare-picker-list">
                    {offered.map((menu) => (
                      <li key={menu.slug}>
                        <button type="button" onClick={() => choose(menu.slug)}>
                          <span className="compare-picker-name">{menu.name}</span>
                          <span className="compare-source compare-source-library">Your library</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="compare-picker-paste">
            <label>
              <span>Paste a menu link</span>
              <input
                ref={field}
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
                placeholder="https://…/menu?encoded=…"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            <button type="submit" className="button-primary" disabled={!pasted.trim()}>
              Use link
            </button>
          </div>

          {menus.length > 0 && (
            <button type="button" className="compare-picker-cancel" onClick={closePicker}>
              Cancel
            </button>
          )}
        </form>
      )}

      <div className="compare-footer">
        <button type="button" className="compare-button" onClick={onCompare} disabled={!canCompare}>
          Compare
        </button>
        <span className="compare-add-note">
          {menus.length === 0
            ? "Add at least two menus"
            : `${menus.length} of ${COMPARE_LIMIT} menus${menus.length === 1 ? " · add one more" : ""}`}
        </span>
      </div>
    </section>
  );
};
