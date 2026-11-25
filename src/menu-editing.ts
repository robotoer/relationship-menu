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
 * - `{ kind: "move-item", group, itemIndex, offset }` moves an item up (-1) or down (+1).
 * - `{ kind: "move-group", group, offset }` moves a group up (-1) or down (+1).
 * - `{ kind: "insert-group", group, items }` adds a ready-made group; if a group with
 *   that name exists, only the items it doesn't already have are appended.
 * - `{ kind: "replace", menu }` replaces the whole menu (e.g. starting from a template).
 */
export type MenuChange =
  | {
      kind: "item";
      group: string;
      itemIndex: number;
      value?: Partial<RelationshipMenuItem>;
    }
  | { kind: "group"; oldGroup?: string; newGroup?: string }
  | { kind: "move-item"; group: string; itemIndex: number; offset: number }
  | { kind: "move-group"; group: string; offset: number }
  | { kind: "insert-group"; group: string; items: string[] }
  | { kind: "replace"; menu: RelationshipMenu };

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
  if (change.kind === "replace") {
    return change.menu;
  }

  if (change.kind === "insert-group") {
    const existing = Object.prototype.hasOwnProperty.call(menu, change.group)
      ? menu[change.group]
      : [];
    const have = new Set(existing.map((item) => item.item.trim().toLowerCase()));
    const added = change.items
      .filter((item) => item.trim() && !have.has(item.trim().toLowerCase()))
      .map((item) => ({ item, id: generateId() }));
    if (added.length === 0 && existing.length > 0) return menu;
    const result: RelationshipMenu = Object.create(null);
    const define = (name: string, value: RelationshipMenu[string]) =>
      Object.defineProperty(result, name, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    for (const name of Object.keys(menu)) define(name, menu[name]);
    define(change.group, [...existing, ...added]);
    return result;
  }

  if (change.kind === "move-group") {
    const names = Object.keys(menu);
    const from = names.indexOf(change.group);
    const to = from + change.offset;
    if (from === -1 || to < 0 || to >= names.length || to === from) return menu;
    names.splice(to, 0, names.splice(from, 1)[0]);
    // No prototype: group names are user text (e.g. "__proto__").
      const result: RelationshipMenu = Object.create(null);
    for (const name of names) result[name] = menu[name];
    return result;
  }

  if (change.kind === "move-item") {
    const items = menu[change.group];
    const from = change.itemIndex;
    const to = from + change.offset;
    if (!items || from < 0 || from >= items.length || to < 0 || to >= items.length || to === from) {
      return menu;
    }
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return { ...menu, [change.group]: next };
  }

  if (change.kind === "group") {
    const { oldGroup, newGroup } = change;
    const exists = (name: string) =>
      Object.prototype.hasOwnProperty.call(menu, name);

    if (oldGroup !== undefined && newGroup === undefined) {
      if (!exists(oldGroup)) return menu;
      // No prototype: group names are user text (e.g. "__proto__").
      const result: RelationshipMenu = Object.create(null);
      for (const group of Object.keys(menu)) {
        if (group !== oldGroup) result[group] = menu[group];
      }
      return result;
    }

    if (oldGroup !== undefined && newGroup !== undefined) {
      if (oldGroup === newGroup || !exists(oldGroup) || exists(newGroup)) {
        return menu;
      }
      // No prototype: group names are user text (e.g. "__proto__").
      const result: RelationshipMenu = Object.create(null);
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
