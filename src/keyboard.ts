/**
 * Keyboard controls for the menu editor.
 *
 * The editor has two modes, like vim:
 * - "row" mode: a whole row (group title or item) is highlighted and keys act on it.
 * - "input" mode: the cursor is in a text box (or the preference picker) and keys type.
 */

import { RelationshipMenuItemValue } from "./model/menu";

export type KeyAction =
  | { type: "next" }
  | { type: "prev" }
  | { type: "first" }
  | { type: "last" }
  | { type: "next-group" }
  | { type: "prev-group" }
  | { type: "edit" }
  | { type: "stop-editing" }
  | { type: "next-row-input" }
  | { type: "prev-row-input" }
  | { type: "set-preference"; value: RelationshipMenuItemValue | undefined }
  | { type: "cycle-preference"; direction: 1 | -1 }
  | { type: "new-item" }
  | { type: "new-group" }
  | { type: "move"; offset: 1 | -1 }
  | { type: "delete" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "help" };

export type KeyInput = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

/** Preferences in cycling order (undefined = no preference). */
export const PREFERENCE_CYCLE: (RelationshipMenuItemValue | undefined)[] = [
  undefined,
  "must-have",
  "like-to-have",
  "maybe",
  "off-limits",
];

const NUMBER_PREFERENCES: { [key: string]: RelationshipMenuItemValue | undefined } = {
  "0": undefined,
  "1": "must-have",
  "2": "like-to-have",
  "3": "maybe",
  "4": "off-limits",
};

/** Multi-key sequences (`gg`, `dd`) wait this long for their second key. */
export const SEQUENCE_TIMEOUT_MS = 800;

/**
 * Maps a key press to an editor action.
 *
 * @param mode - "row" when a row is highlighted, "input" when typing in a field.
 * @param pending - The first key of a two-key sequence typed just before, if any.
 * @returns The action (or null) and the key to remember as the start of a sequence.
 */
export const resolveKey = (
  e: KeyInput,
  mode: "row" | "input",
  pending: string | null = null
): { action: KeyAction | null; pending: string | null } => {
  const mod = e.ctrlKey || e.metaKey;
  const none = { action: null, pending: null };

  if (mode === "input") {
    if (e.altKey || mod) return none;
    switch (e.key) {
      case "Escape":
        return { action: { type: "stop-editing" }, pending: null };
      case "Enter":
        return { action: { type: "next-row-input" }, pending: null };
      case "ArrowDown":
        return { action: { type: "next-row-input" }, pending: null };
      case "ArrowUp":
        return { action: { type: "prev-row-input" }, pending: null };
      default:
        return none;
    }
  }

  // Row mode.
  if (e.altKey) return none;
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) return { action: { type: "undo" }, pending: null };
    if ((k === "z" && e.shiftKey) || k === "y") {
      return { action: { type: "redo" }, pending: null };
    }
    return none;
  }

  if (pending === "g" && e.key === "g") return { action: { type: "first" }, pending: null };
  if (pending === "d" && e.key === "d") return { action: { type: "delete" }, pending: null };

  if (e.key in NUMBER_PREFERENCES) {
    return {
      action: { type: "set-preference", value: NUMBER_PREFERENCES[e.key] },
      pending: null,
    };
  }

  switch (e.key) {
    case "j":
    case "ArrowDown":
      return { action: { type: "next" }, pending: null };
    case "k":
    case "ArrowUp":
      return { action: { type: "prev" }, pending: null };
    case "h":
    case "ArrowLeft":
      return { action: { type: "cycle-preference", direction: -1 }, pending: null };
    case "l":
    case "ArrowRight":
      return { action: { type: "cycle-preference", direction: 1 }, pending: null };
    case "Home":
      return { action: { type: "first" }, pending: null };
    case "G":
    case "End":
      return { action: { type: "last" }, pending: null };
    case "]":
      return { action: { type: "next-group" }, pending: null };
    case "[":
      return { action: { type: "prev-group" }, pending: null };
    case "Enter":
    case "i":
    case "a":
      return { action: { type: "edit" }, pending: null };
    case "o":
      return { action: { type: "new-item" }, pending: null };
    case "O":
      return { action: { type: "new-group" }, pending: null };
    case "J":
      return { action: { type: "move", offset: 1 }, pending: null };
    case "K":
      return { action: { type: "move", offset: -1 }, pending: null };
    case "Delete":
    case "x":
      return { action: { type: "delete" }, pending: null };
    case "u":
      return { action: { type: "undo" }, pending: null };
    case "?":
      return { action: { type: "help" }, pending: null };
    case "g":
    case "d":
      return { action: null, pending: e.key };
    default:
      return none;
  }
};

/** Shortcut reference shown in the help overlay, grouped by section. */
export const SHORTCUTS: { section: string; keys: [string, string][] }[] = [
  {
    section: "Move around",
    keys: [
      ["↓ / j", "Next row"],
      ["↑ / k", "Previous row"],
      ["]", "Next group"],
      ["[", "Previous group"],
      ["gg / Home", "First row"],
      ["G / End", "Last row"],
    ],
  },
  {
    section: "Answer",
    keys: [
      ["1", "Must have"],
      ["2", "Like to have"],
      ["3", "Maybe"],
      ["4", "Off limits"],
      ["0", "Clear answer"],
      ["l / →", "Next answer"],
      ["h / ←", "Previous answer"],
    ],
  },
  {
    section: "Edit",
    keys: [
      ["Enter / i", "Type in this row"],
      ["o", "Add an item to this group"],
      ["O", "Add a new group"],
      ["J", "Move row down"],
      ["K", "Move row up"],
      ["dd / x / Delete", "Delete row"],
      ["u / Ctrl+Z", "Undo"],
      ["Ctrl+Y / Ctrl+Shift+Z", "Redo"],
      ["?", "Show this help"],
    ],
  },
  {
    section: "While typing",
    keys: [
      ["Esc", "Stop typing (back to the row)"],
      ["Enter", "Next row (adds an item at the end of a group)"],
      ["↓", "Next row"],
      ["↑", "Previous row"],
    ],
  },
];
