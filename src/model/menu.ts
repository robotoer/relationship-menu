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
  /**
   * Optional note on this item ("only on weekends"). Personal like the answer:
   * included in menu links, left out of template links.
   */
  note?: string;
};

/** Longest note kept when reading a link. */
export const ITEM_NOTE_LIMIT = 280;

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
  /**
   * Random id (spec SY-20): the key this menu is saved under, in this browser and in
   * sync. Never part of a link. Absent until the menu is first saved.
   */
  id?: string;
  title: string;
  encoded: string;
  /** When this menu was first saved in this browser (ms since epoch). */
  createdAt?: number;
  /** When this menu was last saved (ms since epoch). */
  updatedAt?: number;
  person?: Person;
};
