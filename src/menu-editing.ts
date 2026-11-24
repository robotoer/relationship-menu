/**
 * Pure helpers for applying edits from the menu editor to a RelationshipMenu.
 */

import { RelationshipMenu, RelationshipMenuItem } from "./model/menu";

/**
 * An edit coming from the menu editor.
 *
 * - `{ kind: "group", newGroup }` adds a group.
 * - `{ kind: "group", oldGroup, newGroup }` renames a group (`newGroup` may be "").
 * - `{ kind: "group", oldGroup }` (no `newGroup`) deletes a group.
 * - `{ kind: "item", group, itemIndex: <length>, value }` adds an item.
 * - `{ kind: "item", group, itemIndex, value }` updates an item.
 * - `{ kind: "item", group, itemIndex }` (no `value`) deletes an item.
 */
export type MenuChange =
  | {
      kind: "item";
      group: string;
      itemIndex: number;
      value?: Partial<RelationshipMenuItem>;
    }
  | { kind: "group"; oldGroup?: string; newGroup?: string };

/**
 * Returns the menu with `change` applied, without mutating `menu`.
 *
 * Group order is preserved when renaming. Edits that would merge two groups (adding
 * or renaming a group to a name that is already used) are ignored, because groups are
 * keyed by name and the other group's items would otherwise be overwritten.
 *
 * @param generateId - Creates an id for new items that don't bring their own.
 */
export const applyMenuChange = (
  menu: RelationshipMenu,
  change: MenuChange,
  generateId: () => string
): RelationshipMenu => {
  if (change.kind === "group") {
    const { oldGroup, newGroup } = change;
    const exists = (name: string) =>
      Object.prototype.hasOwnProperty.call(menu, name);

    if (oldGroup !== undefined && newGroup === undefined) {
      if (!exists(oldGroup)) return menu;
      const result: RelationshipMenu = {};
      for (const group of Object.keys(menu)) {
        if (group !== oldGroup) result[group] = menu[group];
      }
      return result;
    }

    if (oldGroup !== undefined && newGroup !== undefined) {
      if (oldGroup === newGroup || !exists(oldGroup) || exists(newGroup)) {
        return menu;
      }
      const result: RelationshipMenu = {};
      for (const group of Object.keys(menu)) {
        result[group === oldGroup ? newGroup : group] = menu[group];
      }
      return result;
    }

    if (newGroup !== undefined) {
      if (newGroup === "" || exists(newGroup)) return menu;
      return { ...menu, [newGroup]: [] };
    }

    return menu;
  }

  const { group, itemIndex, value } = change;
  const items = menu[group];
  if (!items) return menu;

  if (value === undefined) {
    if (itemIndex < 0 || itemIndex >= items.length) return menu;
    return { ...menu, [group]: items.filter((_, index) => index !== itemIndex) };
  }

  if (itemIndex === items.length) {
    const added: RelationshipMenuItem = {
      item: "",
      ...value,
      id: value.id || generateId(),
    };
    return { ...menu, [group]: [...items, added] };
  }

  if (itemIndex >= 0 && itemIndex < items.length) {
    return {
      ...menu,
      [group]: items.map((item, index) =>
        index === itemIndex ? { ...item, ...value } : item
      ),
    };
  }

  return menu;
};
