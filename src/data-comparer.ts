/**
 * Helper methods for converting menu model data into comparison menu data.
 */

import { ComparedMenuItem, MenuComparison } from "./model/compare";
import { RelationshipMenu } from "./model/menu";

/**
 * Creates a case-insensitive ID from a menu item's (or group's) text, ignoring the
 * selected preference, so the same item can be matched across menus.
 */
export const itemId = (item: string): string =>
  (item || "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Compares multiple RelationshipMenu objects and returns a MenuComparison object.
 *
 * Groups and items are matched across menus by case-insensitive text rather than
 * position, so menus with different or reordered items compare correctly. The
 * display text is taken from the first menu that contains the group/item.
 *
 * Each item's `values` has one entry per menu: the selected preference, `undefined`
 * when the item is on that menu without a preference, or `null` when the item is
 * not on that menu at all. Items with blank text are ignored.
 *
 * @param menus An array of RelationshipMenu objects to compare.
 * @returns A MenuComparison object representing the comparison result.
 */
export const compareMenus = (menus: RelationshipMenu[]): MenuComparison => {
  // group id -> display name, in first-seen order
  const groupNames = new Map<string, string>();
  // group id -> (item id -> compared item), in first-seen order
  const groupItems = new Map<string, Map<string, ComparedMenuItem>>();

  menus.forEach((menu, menuIndex) => {
    Object.entries(menu || {}).forEach(([group, items]) => {
      const groupKey = itemId(group);
      if (!groupNames.has(groupKey)) {
        groupNames.set(groupKey, group);
        groupItems.set(groupKey, new Map());
      }
      const itemMap = groupItems.get(groupKey)!;

      (Array.isArray(items) ? items : []).forEach((item) => {
        const key = itemId(item?.item);
        if (!key) {
          return;
        }
        if (!itemMap.has(key)) {
          itemMap.set(key, {
            item: item.item.trim(),
            values: new Array(menus.length).fill(null),
          });
        }
        const compared = itemMap.get(key)!;
        // If an item appears twice in the same menu, keep the first answer given.
        if (!compared.values[menuIndex]) {
          compared.values[menuIndex] = item.value || undefined;
        }
      });
    });
  });

  const comparison: MenuComparison = {};
  groupNames.forEach((name, groupKey) => {
    comparison[name] = Array.from(groupItems.get(groupKey)!.values());
  });
  return comparison;
};
