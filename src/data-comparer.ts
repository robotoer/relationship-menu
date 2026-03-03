/**
 * Helper methods for converting menu model data into comparison menu data.
 */

import { ComparedMenuItem, MenuComparison } from "./model/compare";
import { RelationshipMenu } from "./model/menu";

/**
 * Creates a case-insensitive ID from a menu item name for matching across menus.
 */
const itemId = (item: string): string => item.toLowerCase().trim();

/**
 * Compares multiple RelationshipMenu objects and returns a MenuComparison object.
 * Items are matched across menus by case-insensitive item name rather than index,
 * so menus with disparate items are compared correctly.
 * @param menus An array of RelationshipMenu objects to compare.
 * @returns A MenuComparison object representing the comparison result.
 */
export const compareMenus = (menus: RelationshipMenu[]): MenuComparison => {
  const comparison: MenuComparison = {};

  // Collect all group names across all menus
  const allGroups = new Set<string>();
  menus.forEach((menu) => {
    Object.keys(menu).forEach((group) => allGroups.add(group));
  });

  // For each group, match items by case-insensitive name
  allGroups.forEach((group) => {
    const itemMap = new Map<string, ComparedMenuItem>();
    const itemOrder: string[] = [];

    menus.forEach((menu, menuIndex) => {
      const items = menu[group] || [];
      items.forEach((item) => {
        const id = itemId(item.item);
        if (!itemMap.has(id)) {
          itemMap.set(id, {
            item: item.item,
            values: new Array(menus.length).fill(undefined),
          });
          itemOrder.push(id);
        }
        itemMap.get(id)!.values[menuIndex] = item.value;
      });
    });

    comparison[group] = itemOrder.map((id) => itemMap.get(id)!);
  });

  return comparison;
};
