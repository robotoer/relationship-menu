import "./MenuItemCompare.css";
import { RelationshipMenuItemValue } from "../model/menu";

/**
 * Color coded comparison of multiple relationship menus.
 *
 * Preferences for each relationship menu item should be dipslayed in a color coded grid
 * where columns are different people and rows are relationship menu items as normally displayed.
 *
 * @param item - The item to be displayed.
 * @param menuItems - An array of menu items for comparison.
 * @returns The rendered MenuItemCompare component.
 */
export const MenuItemCompare = ({
  item,
  menuItems,
}: {
  item: string;
  menuItems: (RelationshipMenuItemValue | undefined)[];
}) => {
  return (
    <div className="menu-item-compare">
      {menuItems.map((menuItem, itemIndex) => (
        <div key={itemIndex} className={menuItem || "unknown"}></div>
      ))}
      <div className="menu-item>">{item}</div>
    </div>
  );
};
