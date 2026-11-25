/**
 * Page that displays a single relationship menu.
 */

import "./Menu.css";
import { Fragment, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MenuGroup } from "../components/MenuGroup";
import { MenuItem } from "../components/MenuItem";
import { Person, RelationshipMenu } from "../model/menu";
import { MenuChange } from "../menu-editing";
import { SaveState } from "../autosave";
import { KeyAction, PREFERENCE_CYCLE, SEQUENCE_TIMEOUT_MS, resolveKey } from "../keyboard";
import { KeyboardHelp } from "../components/KeyboardHelp";
import {
  GROUP_TEMPLATES,
  MENU_TEMPLATES,
  MenuTemplate,
  templateItemCount,
} from "../templates";
import { ShareDialog } from "../components/ShareDialog";
import { track } from "../analytics";
import { Link } from "react-router-dom";

/**
 * Renders an input element for the menu title.
 *
 * @component
 * @param {React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>} props - The input element props.
 * @param {string} props.className - The class name for the input element.
 * @param {string} props.placeholder - The placeholder text for the input element.
 * @param {React.InputHTMLAttributes<HTMLInputElement>} props.params - Additional parameters for the input element.
 * @returns {JSX.Element} The rendered input element.
 */
const MenuTitle = ({
  className,
  placeholder,
  ...params
}: React.DetailedHTMLProps<
  React.InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
>) => (
  <input
    className={className ? `menu-title ${className}` : "menu-title"}
    placeholder={placeholder || "Menu title"}
    {...params}
  />
);

/**
 * Input for a group's name.
 *
 * Keeps a local draft so a name that is already used by another group can be shown
 * (with a warning) without being applied: groups are keyed by name, so applying it
 * would overwrite the other group.
 *
 * @param value - The group's current name ("" for the "new group" input).
 * @param takenNames - Names used by other groups.
 * @param isNew - Whether this is the trailing "new group" input (an empty name is not committed).
 * @param onCommit - Called with the new name once it is valid.
 */
const GroupTitle = ({
  id,
  value,
  takenNames,
  isNew = false,
  onCommit,
}: {
  id?: string;
  value: string;
  takenNames: string[];
  isNew?: boolean;
  onCommit: (name: string) => void;
}) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const taken = draft !== value && takenNames.includes(draft);
  return (
    <>
      <input
        id={id}
        className="new-group-title"
        placeholder="New group"
        value={draft}
        aria-invalid={taken || undefined}
        aria-describedby={taken && id ? `${id}-error` : undefined}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (next === value || takenNames.includes(next)) return;
          if (isNew && next === "") return;
          onCommit(next);
        }}
      />
      {taken && (
        <span id={id ? `${id}-error` : undefined} className="group-title-error">
          A group with this name already exists
        </span>
      )}
    </>
  );
};

export type SaveStatus = SaveState | "title-taken";

const SAVE_LABELS: { [status: string]: string } = {
  pending: "Saving…",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
  "title-taken": "Another menu already has this title. Rename to save.",
};

/** Shows whether the menu's latest changes are saved. */
const SaveIndicator = ({ status }: { status?: SaveStatus }) =>
  status && SAVE_LABELS[status] ? (
    <span
      className={`save-status save-status-${status}`}
      role="status"
      aria-live="polite"
    >
      {SAVE_LABELS[status]}
    </span>
  ) : null;

/**
 * Optional "who is this menu for" fields. Shared in the menu link (so a comparison
 * can show who's who) but never in the template link.
 */
const PersonFields = ({
  person,
  onChange,
}: {
  person: Person;
  onChange: (person: Person) => void;
}) => (
  <fieldset className="person-fields">
    <legend>Whose menu is this? (optional)</legend>
    <label>
      <span>Your name</span>
      <input
        value={person.name ?? ""}
        maxLength={60}
        placeholder="e.g. Sam"
        onChange={(e) => onChange({ ...person, name: e.target.value })}
      />
    </label>
    <label>
      <span>Pronouns</span>
      <input
        value={person.pronouns ?? ""}
        maxLength={30}
        placeholder="e.g. they/them"
        onChange={(e) => onChange({ ...person, pronouns: e.target.value })}
      />
    </label>
    <label className="person-note">
      <span>Note</span>
      <input
        value={person.note ?? ""}
        maxLength={280}
        placeholder="Anything to add, like what you're looking for"
        onChange={(e) => onChange({ ...person, note: e.target.value })}
      />
    </label>
    <p className="person-hint">Included in your menu link, never in the template link.</p>
  </fieldset>
);

/** Counter for keys of the trailing "new item" row, which become the new item's id. */
let nextPendingItemId = 0;

/**
 * Represents the menu page component.
 *
 * @param title - The title of the menu.
 * @param menu - The relationship menu.
 * @param menuEncoded - The encoded string representation of the menu.
 * @param templateEncoded - The encoded string representation of the template.
 * @param onChange - The callback function for handling menu changes.
 * @param onChangeTitle - The callback function for handling title changes.
 * @returns The rendered menu page component.
 */
export const MenuPage = ({
  title,
  menu,
  menuEncoded,
  templateEncoded,
  onChange,
  onChangeTitle,
  saveStatus,
  onUndo,
  onRedo,
  notice,
  onDismissNotice,
  person,
  onChangePerson,
  onUseTemplate,
}: {
  title: string;
  menu: RelationshipMenu;
  menuEncoded: string;
  templateEncoded: string;
  onChange: (change: MenuChange) => void;
  onChangeTitle: (title: string) => void;
  saveStatus?: SaveStatus;
  onUndo?: () => void;
  onRedo?: () => void;
  notice?: string | null;
  onDismissNotice?: () => void;
  person?: Person;
  onChangePerson?: (person: Person) => void;
  onUseTemplate?: (template: MenuTemplate) => void;
}) => {
  const groupNames = Object.keys(menu);
  /** Why an item can't become a group right now, or undefined if it can (ED-14). */
  const makeGroupBlockedReason = (text: string) => {
    const name = text.trim();
    if (!name) return "Give the item some text first";
    if (Object.prototype.hasOwnProperty.call(menu, name)) {
      return "There's already a group with this name";
    }
    return undefined;
  };
  // Key (and future id) of each group's "new item" row, by group name.
  const pendingItemIds = useRef<{ [group: string]: string }>({});
  const pendingItemIdFor = (group: string) =>
    (pendingItemIds.current[group] ??= `new_${++nextPendingItemId}`);

  // ---- Keyboard controls (see src/keyboard.ts) ----
  const pageRef = useRef<HTMLDivElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = () => {
    track("keyboard_help_opened");
    setHelpOpen(true);
  };
  const [shareOpen, setShareOpen] = useState(false);
  const sequence = useRef<{ key: string; at: number } | null>(null);
  // Row to focus after the next render (rows can move or disappear on edits).
  // `index` is a fallback for when that row no longer exists (e.g. undo removed it).
  const focusAfterRender = useRef<{
    rowKey: string;
    mode: "row" | "input";
    index?: number;
  } | null>(null);

  const rowElements = () =>
    Array.from(
      pageRef.current?.querySelectorAll<HTMLElement>("[data-row-key]") ?? []
    );

  const focusRow = (row: HTMLElement | undefined, mode: "row" | "input") => {
    if (!row) return;
    if (mode === "input") {
      // The row's first text field: an item's textarea, or a group title's input.
      const input = row.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
      if (input) {
        input.focus();
        const end = input.value.length;
        input.setSelectionRange?.(end, end);
        return;
      }
    }
    row.focus();
    row.scrollIntoView?.({ block: "nearest" });
  };

  useLayoutEffect(() => {
    const target = focusAfterRender.current;
    if (!target) return;
    focusAfterRender.current = null;
    const rows = rowElements();
    const match = rows.find((row) => row.dataset.rowKey === target.rowKey);
    const fallback =
      target.index === undefined
        ? undefined
        : rows[Math.min(target.index, rows.length - 1)];
    focusRow(match ?? fallback, target.mode);
  });

  // Pressing j/k (or ?) with nothing focused starts keyboard navigation.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.target !== document.body || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        openHelp();
      } else if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        focusRow(rowElements()[0], "row");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const perform = (action: KeyAction, row: HTMLElement) => {
    const rows = rowElements();
    const index = rows.indexOf(row);
    const kind = row.dataset.rowKind;
    const groupIndex = Number(row.dataset.groupIndex);
    const group = Number.isNaN(groupIndex) ? undefined : groupNames[groupIndex];
    const itemIndex = Number(row.dataset.itemIndex);
    const item = kind === "item" && group !== undefined ? menu[group][itemIndex] : undefined;
    const isHeader = (r: HTMLElement) =>
      r.dataset.rowKind === "group" || r.dataset.rowKind === "new-group";
    const byKey = (key: string) => rows.find((r) => r.dataset.rowKey === key);

    switch (action.type) {
      case "next":
        return focusRow(rows[index + 1], "row");
      case "prev":
        return focusRow(rows[index - 1], "row");
      case "first":
        return focusRow(rows[0], "row");
      case "last":
        return focusRow(rows[rows.length - 1], "row");
      case "next-group":
        return focusRow(rows.slice(index + 1).find(isHeader), "row");
      case "prev-group":
        return focusRow(rows.slice(0, index).reverse().find(isHeader), "row");
      case "edit":
        return focusRow(row, "input");
      case "stop-editing":
        return focusRow(row, "row");
      case "next-row-input":
        return focusRow(rows[index + 1], "input");
      case "prev-row-input":
        return focusRow(rows[index - 1], "input");
      case "set-preference":
        if (item && group !== undefined) {
          onChange({ kind: "item", group, itemIndex, value: { value: action.value } });
        }
        return;
      case "cycle-preference":
        if (item && group !== undefined) {
          const n = PREFERENCE_CYCLE.length;
          const at = PREFERENCE_CYCLE.indexOf(item.value);
          const value = PREFERENCE_CYCLE[(at + action.direction + n) % n];
          onChange({ kind: "item", group, itemIndex, value: { value } });
        }
        return;
      case "new-item":
        if (group === undefined) return focusRow(row, "input");
        return focusRow(byKey(pendingItemIdFor(group)), "input");
      case "new-group":
        return focusRow(byKey("new-group"), "input");
      case "move":
        if (item && group !== undefined) {
          focusAfterRender.current = { rowKey: row.dataset.rowKey!, mode: "row" };
          onChange({ kind: "move-item", group, itemIndex, offset: action.offset });
        } else if (kind === "group" && group !== undefined) {
          const to = groupIndex + action.offset;
          if (to >= 0 && to < groupNames.length) {
            focusAfterRender.current = { rowKey: `group-${to}`, mode: "row" };
            onChange({ kind: "move-group", group, offset: action.offset });
          }
        }
        return;
      case "delete":
        if (item && group !== undefined) {
          const neighbour = rows[index + 1] ?? rows[index - 1];
          if (neighbour) {
            focusAfterRender.current = { rowKey: neighbour.dataset.rowKey!, mode: "row" };
          }
          onChange({ kind: "item", group, itemIndex });
        } else if (kind === "group" && group !== undefined) {
          focusAfterRender.current = {
            rowKey: groupIndex < groupNames.length - 1 ? `group-${groupIndex}` : "new-group",
            mode: "row",
          };
          onChange({ kind: "group", oldGroup: group });
        }
        return;
      case "note": {
        if (!item) return;
        const toggle = row.querySelector<HTMLButtonElement>(".menu-item-note-toggle");
        const field = row.querySelector<HTMLInputElement>(".menu-item-note input");
        if (field) field.focus();
        else toggle?.click(); // opens the note field and focuses it
        return;
      }
      case "make-group":
        if (item && group !== undefined && !makeGroupBlockedReason(item.item)) {
          focusAfterRender.current = { rowKey: `group-${groupIndex + 1}`, mode: "row" };
          onChange({ kind: "item-to-group", group, itemIndex });
        }
        return;
      case "undo":
      case "redo":
        focusAfterRender.current = { rowKey: row.dataset.rowKey!, mode: "row", index };
        return action.type === "undo" ? onUndo?.() : onRedo?.();
      case "help":
        return openHelp();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (helpOpen || shareOpen || e.nativeEvent.isComposing) return;
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-row-key]");
    if (!row) return;
    if (target.tagName === "SELECT" || target.tagName === "BUTTON") {
      // Let the picker and buttons handle their own keys; Esc returns to the row.
      if (e.key === "Escape") {
        e.preventDefault();
        focusRow(row, "row");
      }
      return;
    }
    const mode = target === row ? "row" : "input";
    const now = Date.now();
    const pending =
      sequence.current && now - sequence.current.at < SEQUENCE_TIMEOUT_MS
        ? sequence.current.key
        : null;
    const { action, pending: nextPending } = resolveKey(e, mode, pending);
    sequence.current = nextPending ? { key: nextPending, at: now } : null;
    if (nextPending) e.preventDefault();
    if (!action) return;
    e.preventDefault();
    perform(action, row);
  };
  return (
    <div className="menu-editor">
      <h1 className="sr-only">Edit menu</h1>
      <div className="menu-title-container">
        <MenuTitle
          value={title}
          placeholder="Menu title"
          onChange={(e) => onChangeTitle(e.target.value)}
        />
        <SaveIndicator status={saveStatus} />
        {onUndo && (
          <button type="button" className="menu-undo" onClick={onUndo} title="Undo (u / Ctrl+Z)">
            Undo
          </button>
        )}
        {onRedo && (
          <button type="button" className="menu-redo" onClick={onRedo} title="Redo (Ctrl+Y)">
            Redo
          </button>
        )}
        <button
          type="button"
          className="keyboard-help-button"
          onClick={() => openHelp()}
          aria-keyshortcuts="?"
        >
          Keys <kbd>?</kbd>
        </button>
        <Link
          to={`/compare?encoded=${encodeURIComponent(menuEncoded)}`}
          className="button menu-compare"
        >
          Compare
        </Link>
        <button
          type="button"
          className="button-primary menu-share"
          onClick={() => {
            track("share_dialog_opened");
            setShareOpen(true);
          }}
          aria-haspopup="dialog"
        >
          Share
        </button>
      </div>
      {shareOpen && (
        <ShareDialog
          title={title}
          personName={person?.name?.trim() || undefined}
          menuUrl={`${window.location.origin}/menu?encoded=${encodeURIComponent(menuEncoded)}`}
          menuEncoded={menuEncoded}
          templateUrl={`${window.location.origin}/menu?encoded=${encodeURIComponent(templateEncoded)}`}
          templateEncoded={templateEncoded}
          onClose={() => setShareOpen(false)}
        />
      )}
      {onChangePerson && (
        <PersonFields person={person ?? {}} onChange={onChangePerson} />
      )}
      {notice && (
        <div className="menu-notice" role="status">
          <span>{notice}</span>
          {onDismissNotice && (
            <button type="button" onClick={onDismissNotice} aria-label="Dismiss notice">
              ✕
            </button>
          )}
        </div>
      )}

      {helpOpen && <KeyboardHelp onClose={() => setHelpOpen(false)} />}
      {groupNames.length === 0 && onUseTemplate && (
        <section className="template-picker" aria-labelledby="template-picker-title">
          <h2 id="template-picker-title">Pick a starting point</h2>
          <p>
            Each template is a list of topics to answer. Rename, remove or add anything
            afterwards.
          </p>
          <div className="template-cards">
            {MENU_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="template-card"
                onClick={() => onUseTemplate(template)}
              >
                <span className="template-card-name">{template.name}</span>
                <span className="template-card-description">{template.description}</span>
                <span className="template-card-count">
                  {Object.keys(template.groups).length} groups · {templateItemCount(template)}{" "}
                  items
                </span>
              </button>
            ))}
            <button
              type="button"
              className="template-card template-card-blank"
              onClick={() => {
                track("blank_menu_started");
                pageRef.current
                  ?.querySelector<HTMLInputElement>('[data-row-key="new-group"] input')
                  ?.focus();
              }}
            >
              <span className="template-card-name">Blank menu</span>
              <span className="template-card-description">
                Start from nothing and type your own groups and items.
              </span>
            </button>
          </div>
        </section>
      )}
      <div className="menu-page" ref={pageRef} onKeyDown={onKeyDown}>
        {/*
          The trailing "new group" and "new item" rows are rendered in the same keyed
          lists as the existing rows. When one of them receives text it becomes a real
          group/item with the same key, so React keeps the same input element and the
          user keeps typing into it, with no focus hand-off that fast typing can outrun.
        */}
        {[...groupNames, null].map((group, groupIndex) => {
          const inputId = `menu-group-input-${groupIndex}`;
          if (group === null) {
            return (
              <MenuGroup
                key={groupIndex}
                headerProps={{
                  tabIndex: -1,
                  "data-row-key": "new-group",
                  "data-row-kind": "new-group",
                }}
                title={
                  <GroupTitle
                    id={inputId}
                    value=""
                    isNew
                    takenNames={groupNames}
                    onCommit={(newGroup) => onChange({ kind: "group", newGroup })}
                  />
                }
              >
                Enter a new group title to add a new group.
              </MenuGroup>
            );
          }
          const items = menu[group];
          const pendingId = pendingItemIdFor(group);
          const rows = [
            ...items.map((item, itemIndex) => ({
              key: item.id || `index-${itemIndex}`,
              item,
              itemIndex,
            })),
            { key: pendingId, item: null, itemIndex: items.length },
          ];
          return (
            <MenuGroup
              key={groupIndex}
              headerProps={{
                tabIndex: -1,
                "data-row-key": `group-${groupIndex}`,
                "data-row-kind": "group",
                "data-group-index": groupIndex,
              }}
              title={
                <GroupTitle
                  id={inputId}
                  value={group}
                  takenNames={groupNames.filter((name) => name !== group)}
                  onCommit={(newGroup) =>
                    onChange({ kind: "group", oldGroup: group, newGroup })
                  }
                />
              }
              onDelete={() => onChange({ kind: "group", oldGroup: group })}
              deleteAriaLabel={`Delete group: ${group}`}
            >
              {rows.map(({ key, item, itemIndex }) => (
                <Fragment key={key}>
                  {item === null && <div className="menu-divider" />}
                  <MenuItem
                    rowProps={{
                      tabIndex: -1,
                      "data-row-key": key,
                      "data-row-kind": item ? "item" : "new-item",
                      "data-group-index": groupIndex,
                      "data-item-index": itemIndex,
                    }}
                    id={item ? `menu-item-input-${groupIndex}-${key}` : undefined}
                    item={item ? item.item : ""}
                    value={item ? item.value : undefined}
                    note={item ? item.note : undefined}
                    onMakeGroup={
                      item
                        ? () => {
                            focusAfterRender.current = {
                              rowKey: `group-${groupIndex + 1}`,
                              mode: "row",
                            };
                            onChange({ kind: "item-to-group", group, itemIndex });
                          }
                        : undefined
                    }
                    makeGroupBlockedReason={item ? makeGroupBlockedReason(item.item) : undefined}
                    onChange={(value) => {
                      if (item) {
                        onChange({ kind: "item", group, itemIndex, value });
                        return;
                      }
                      // Adding: the new item takes this row's key as its id.
                      delete pendingItemIds.current[group];
                      onChange({
                        kind: "item",
                        group,
                        itemIndex,
                        value: { ...value, id: pendingId },
                      });
                    }}
                    onDelete={
                      item
                        ? () => onChange({ kind: "item", group, itemIndex })
                        : undefined
                    }
                  />
                </Fragment>
              ))}
            </MenuGroup>
          );
        })}
      </div>
      <div className="group-adder">
        <label>
          <span>Add a ready-made group</span>
          <select
            value=""
            onChange={(e) => {
              const group = GROUP_TEMPLATES.find((g) => g.name === e.target.value);
              if (group) {
                onChange({ kind: "insert-group", group: group.name, items: group.items });
              }
            }}
          >
            <option value="">Choose a group…</option>
            {GROUP_TEMPLATES.map((group) => (
              <option key={group.name} value={group.name}>
                {group.name}
                {groupNames.includes(group.name) ? " (add missing items)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
};
