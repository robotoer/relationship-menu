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
 * @returns The rendered MenuItemCompare component.
 */
export const MenuItemCompare = ({
  item,
  menuItems,
  titles = [],
}: {
  item: string;
  menuItems: ComparedMenuItemValue[];
  titles?: string[];
}) => {
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
      <div className="menu-item">{item}</div>
    </div>
  );
};
