import "./MenuItemCompare.css";
import { ComparedMenuItemValue } from "../model/compare";

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
 * CSS class used for a comparison cell: the preference itself, "unknown" when the item
 * has no preference selected, or "absent" when the item is not on that menu.
 */
export const compareValueClass = (value: ComparedMenuItemValue): string =>
  value === null ? "absent" : value || "unknown";

/**
 * Read-only, color coded comparison of one relationship menu item across multiple menus.
 *
 * Preferences for each relationship menu item are displayed in a color coded grid
 * where columns are different people and rows are relationship menu items as normally displayed.
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
}: {
  item: string;
  /** Shown as a small caption, for lists that mix groups (e.g. sorted by difference). */
  group?: string;
  menuItems: ComparedMenuItemValue[];
  titles?: string[];
  /** Each person's note on this item (same order as `menuItems`), if any. */
  notes?: (string | undefined)[];
}) => {
  const withNotes = notes
    .map((note, index) => ({ note, who: titles[index] || `Menu ${index + 1}` }))
    .filter((entry): entry is { note: string; who: string } => !!entry.note);
  return (
    <div className="menu-item-compare">
      {menuItems.map((menuItem, itemIndex) => {
        const className = compareValueClass(menuItem);
        const who = titles[itemIndex] || `Menu ${itemIndex + 1}`;
        const description = `${who}: ${COMPARE_VALUE_LABELS[className]}`;
        return (
          <div
            key={itemIndex}
            className={className}
            title={description}
            role="img"
            aria-label={description}
          ></div>
        );
      })}
      <div className="menu-item">
        {item}
        {group && <span className="menu-item-compare-group"> · {group}</span>}
      </div>
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
