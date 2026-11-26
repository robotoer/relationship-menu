import "./MenuItemCompare.css";
import { ComparedMenuItemValue } from "../model/compare";
import { BUCKETS, bucketOf } from "../compare-focus";

/**
 * Human readable labels for each comparison cell state.
 */
export const COMPARE_VALUE_LABELS: { [className: string]: string } = {
  "must-have": "Must Have",
  "like-to-have": "Like to Have",
  maybe: "Maybe",
  "off-limits": "Off Limits",
  unknown: "No preference",
  absent: "Not on this menu",
};

/**
 * A symbol for each answer, drawn inside its colored square so answers can be told
 * apart without relying on color (AX-3).
 */
export const COMPARE_VALUE_GLYPHS: { [className: string]: string } = {
  "must-have": "★",
  "like-to-have": "✓",
  maybe: "?",
  "off-limits": "✕",
  unknown: "–",
  absent: "",
};

/**
 * CSS class used for a comparison cell: the preference itself, "unknown" when the item
 * has no preference selected, or "absent" when the item is not on that menu.
 */
export const compareValueClass = (value: ComparedMenuItemValue): string =>
  value === null ? "absent" : value || "unknown";

/** A small answer square with its symbol, for lists outside the grid. */
export const Swatch = ({ value }: { value: ComparedMenuItemValue }) => {
  const className = compareValueClass(value);
  return (
    <span className={`swatch ${className}`} aria-hidden="true">
      {COMPARE_VALUE_GLYPHS[className]}
    </span>
  );
};

/**
 * Everyone's answer to one item, each labelled with whose it is: "Ana: Must Have".
 * Used wherever an item is shown outside the grid, so nobody has to decode colors.
 */
export const AnswerList = ({
  values,
  names,
  only,
  className = "",
}: {
  values: ComparedMenuItemValue[];
  names: string[];
  /** Show only these people (column indexes). */
  only?: number[];
  className?: string;
}) => (
  <ul className={`answer-list ${className}`}>
    {values.map((v, i) =>
      only && !only.includes(i) ? null : (
        <li key={i}>
          <Swatch value={v} />
          <span>
            <span className="answer-who">{names[i] ?? `Menu ${i + 1}`}:</span>{" "}
            {COMPARE_VALUE_LABELS[compareValueClass(v)]}
          </span>
        </li>
      )
    )}
  </ul>
);

/**
 * Read-only, color coded comparison of one relationship menu item across multiple menus.
 *
 * Preferences for each relationship menu item are displayed in a color coded grid
 * where columns are different people and rows are relationship menu items as normally displayed.
 * Items that need a conversation carry a small tag saying why; quick checks only a
 * colored edge.
 *
 * @param item - The item to be displayed.
 * @param menuItems - One value per compared menu (see ComparedMenuItemValue).
 * @param titles - Optional menu titles, used to label each cell for tooltips and screen readers.
 * @param notes - Optional notes, one per menu, shown under the item with whose they are.
 * @returns The rendered MenuItemCompare component.
 */
export const MenuItemCompare = ({
  item,
  menuItems,
  titles = [],
  notes = [],
  group,
  tag = true,
}: {
  item: string;
  /** Shown as a small caption, for lists that mix groups (e.g. sorted by difference). */
  group?: string;
  menuItems: ComparedMenuItemValue[];
  titles?: string[];
  /** Each person's note on this item (same order as `menuItems`), if any. */
  notes?: (string | undefined)[];
  /** Whether to show the "Conflict" / "Talk about it" / … tag. */
  tag?: boolean;
}) => {
  const withNotes = notes
    .map((note, index) => ({ note, who: titles[index] || `Menu ${index + 1}` }))
    .filter((entry): entry is { note: string; who: string } => !!entry.note);
  const bucket = menuItems.length > 0 ? bucketOf(menuItems) : null;
  const zone = bucket ? BUCKETS[bucket].zone : null;
  return (
    <div className={`menu-item-compare${zone ? ` zone-${zone}` : ""}`}>
      {menuItems.map((menuItem, itemIndex) => {
        const className = compareValueClass(menuItem);
        const who = titles[itemIndex] || `Menu ${itemIndex + 1}`;
        const description = `${who}: ${COMPARE_VALUE_LABELS[className]}`;
        return (
          <div key={itemIndex} className={className} title={description} role="img" aria-label={description}>
            <span aria-hidden="true">{COMPARE_VALUE_GLYPHS[className]}</span>
          </div>
        );
      })}
      <div className="menu-item">
        {item}
        {group && <span className="menu-item-compare-group"> · {group}</span>}
      </div>
      {tag && bucket && zone !== "aligned" && zone !== "quick" && (
        <span className={`zone-tag zone-${zone}`} title={BUCKETS[bucket].description}>
          {BUCKETS[bucket].label}
        </span>
      )}
      {withNotes.length > 0 && (
        <ul className="compare-notes" aria-label={`Notes on ${item}`}>
          {withNotes.map(({ note, who }) => (
            <li key={who}>
              <span className="compare-note-who">{who}:</span> {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
