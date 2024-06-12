/**
 * Helper methods for converting menu model data into comparison menu data.
 */

import { MenuComparison } from "./model/compare";
import { RelationshipMenu } from "./model/menu";

export const compareMenus = (menus: RelationshipMenu[]): MenuComparison => {
  const comparison: MenuComparison = {};

  // Iterate first over groups, then over items in each group.
  menus.forEach((menu, menuIndex) => {
    Object.entries(menu).forEach(([group, items]) => {
      if (!comparison[group]) {
        comparison[group] = [];
      }

      items.forEach((item, itemIndex) => {
        if (!comparison[group][itemIndex]) {
          comparison[group][itemIndex] = {
            item: item.item,
            values: [],
          };
        }

        comparison[group][itemIndex].values[menuIndex] = item.value;
      });
    });
  });

  return comparison;
};
