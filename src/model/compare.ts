import { RelationshipMenuItemValue } from "./menu";

/**
 * One menu's answer for a compared item:
 * - a preference value when one was selected,
 * - `undefined` when the item is on that menu but has no preference selected,
 * - `null` when the item is not on that menu at all.
 */
export type ComparedMenuItemValue = RelationshipMenuItemValue | null | undefined;

/**
 * Represents a compared menu item.
 */
export type ComparedMenuItem = {
  item: string;
  values: ComparedMenuItemValue[];
  /**
   * Present only when someone wrote a note on this item: one entry per compared
   * menu, holding that person's note (or undefined).
   */
  notes?: (string | undefined)[];
};

/**
 * Represents a group of compared menu items.
 */
export type ComparedMenuGroup = ComparedMenuItem[];

/**
 * Represents a comparison of menus.
 */
export type MenuComparison = {
  [key: string]: ComparedMenuGroup;
};
