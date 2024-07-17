/**
 * Represents the value of a relationship menu item.
 * Possible values include:
 * - "must-have"
 * - "like-to-have"
 * - "maybe"
 * - "off-limits"
 */
export type RelationshipMenuItemValue =
  | "must-have"
  | "like-to-have"
  | "maybe"
  | "off-limits";

/**
 * Represents a relationship menu item.
 */
export type RelationshipMenuItem = {
  item: string;
  value?: RelationshipMenuItemValue;
};

/**
 * Represents a group of relationship menu items.
 */
export type RelationshipMenuGroup = RelationshipMenuItem[];

/**
 * Represents a relationship menu.
 * @typedef {Object.<string, RelationshipMenuGroup>} RelationshipMenu
 */
export type RelationshipMenu = {
  [key: string]: RelationshipMenuGroup;
};

/**
 * Represents a relationship menu document.
 */
export type RelationshipMenuDocument = {
  title: string;
  encoded: string;
};
