import { RelationshipMenuItemValue } from "./menu";

/**
 * Represents a compared menu item.
 */
export type ComparedMenuItem = {
  item: string;
  values: (RelationshipMenuItemValue | undefined)[];
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
