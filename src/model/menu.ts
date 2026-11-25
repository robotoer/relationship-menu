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
  id?: string;
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
/**
 * Optional information about the person a menu belongs to. It travels with shared
 * menu links (never with template links) so comparisons can show who's who.
 */
export type Person = {
  name?: string;
  pronouns?: string;
  note?: string;
};

export type RelationshipMenuDocument = {
  title: string;
  encoded: string;
  /** When this menu was first saved in this browser (ms since epoch). */
  createdAt?: number;
  /** When this menu was last saved (ms since epoch). */
  updatedAt?: number;
  person?: Person;
};
