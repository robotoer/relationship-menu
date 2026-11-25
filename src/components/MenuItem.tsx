import "./MenuItem.css";
import { useLayoutEffect, useRef, useState } from "react";
import { RelationshipMenuItem, RelationshipMenuItemValue } from "../model/menu";

/**
 * The text of a menu item: a one-row textarea that grows to fit, so long items
 * wrap instead of being cut off (most visible on phones). Newlines are never kept:
 * Enter moves to the next row (handled by the editor) and pasted line breaks
 * become spaces.
 */
const MenuItemInput = ({
  className,
  placeholder,
  onChange,
  value,
  ...params
}: React.DetailedHTMLProps<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  HTMLTextAreaElement
>) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Height follows the text: on every change, when the field's width changes
  // (layout, rotation, resizing), and once web fonts have loaded (they change how
  // the text wraps).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      // scrollHeight excludes the border, but height (border-box) includes it.
      const border = el.offsetHeight - el.clientHeight;
      el.style.height = `${el.scrollHeight + border}px`;
    };
    fit();
    let width = el.clientWidth;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            // Only width matters; ignore the height changes fit() itself causes.
            if (el.clientWidth !== width) {
              width = el.clientWidth;
              fit();
            }
          });
    observer?.observe(el);
    let active = true;
    document.fonts?.ready.then(() => active && fit());
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className ? `menu-item-input ${className}` : "menu-item-input"}
      placeholder={placeholder || "New item"}
      value={value}
      onChange={(e) => {
        if (/[\r\n]/.test(e.target.value)) {
          e.target.value = e.target.value.replace(/\s*[\r\n]+\s*/g, " ");
        }
        onChange?.(e);
      }}
      {...params}
    />
  );
};

/**
 * Color-coded display of a single relationship menu item. Selected preference (if any)
 * should be displayed as a colored box before the item text.
 *
 * If the colored box is clicked, a dropdown should appear with the options for the user to change
 * their preference.
 *
 * @param {string} [id] - Optional DOM id for the input element. Omitted for the "new item" row.
 * @param {string} item - The text content of the menu item.
 * @param {RelationshipMenuItemValue} [value] - Optional preference value. When omitted the selector shows "---".
 * @param {(value: Partial<RelationshipMenuItem>) => void} onChange - The callback function triggered when the menu item value changes.
 * @param {() => void} [onDelete] - Optional callback triggered when the delete button is clicked. When provided, a delete button is rendered next to the item.
 * @returns {JSX.Element} The rendered menu item component.
 */
/** Extra attributes for the row element (used for keyboard navigation). */
export type RowProps = React.HTMLAttributes<HTMLDivElement> & {
  [dataAttribute: `data-${string}`]: string | number | undefined;
};

export const MenuItem = ({
  id,
  item,
  value,
  note,
  onChange,
  onDelete,
  onMakeGroup,
  makeGroupBlockedReason,
  rowProps,
}: {
  id?: string;
  item: string;
  value?: RelationshipMenuItemValue;
  /** The item's note. Notes can only be added to existing items (rows with `onDelete`). */
  note?: string;
  onChange: (value: Partial<RelationshipMenuItem>) => void;
  onDelete?: () => void;
  /** Turns this item into a group. Omit for the "new item" row. */
  onMakeGroup?: () => void;
  /** When set, "make into group" is disabled and this explains why. */
  makeGroupBlockedReason?: string;
  rowProps?: RowProps;
}) => {
  const { className: rowClassName, ...restRowProps } = rowProps || {};
  const [noteOpen, setNoteOpen] = useState(false);
  // Focus the note field only when the user just opened it (not on first render).
  const [focusNote, setFocusNote] = useState(false);
  const showNote = !!onDelete && (noteOpen || !!note);
  const label = item || "this item";
  return (
    <div
      {...restRowProps}
      className={rowClassName ? `menu-item ${rowClassName}` : "menu-item"}
    >
      <select
        // "" is "no preference": it must map back to undefined, not be stored as text.
        value={value ?? ""}
        aria-label={item ? `Preference for ${item}` : "Preference"}
        onChange={(e) =>
          onChange({
            value: (e.target.value || undefined) as
              | RelationshipMenuItemValue
              | undefined,
          })
        }
        className={value || "unknown"}
      >
        <option value="">---</option>
        <option value="must-have">Must Have</option>
        <option value="like-to-have">Like to Have</option>
        <option value="maybe">Maybe</option>
        <option value="off-limits">Off Limits</option>
      </select>
      <label>
        <MenuItemInput
          id={id}
          value={item}
          aria-label={item ? "Item" : "New item"}
          onChange={(e) => onChange({ item: e.target.value })}
        />
      </label>
      {onDelete && (
        <button
          type="button"
          className={note ? "menu-item-note-toggle icon-button has-note" : "menu-item-note-toggle icon-button"}
          onClick={() => {
            if (showNote && !note) {
              setNoteOpen(false);
            } else {
              setNoteOpen(true);
              setFocusNote(true);
            }
          }}
          aria-expanded={showNote}
          aria-label={note ? `Edit note on ${label}` : `Add a note to ${label}`}
          title={note ? "Edit note (n)" : "Add a note (n)"}
        >
          ✎
        </button>
      )}
      {onMakeGroup && (
        <button
          type="button"
          className="menu-item-make-group icon-button"
          onClick={onMakeGroup}
          disabled={!!makeGroupBlockedReason}
          aria-label={`Make ${item ? `"${item}"` : "this item"} into a group`}
          title={makeGroupBlockedReason || "Make into a group, to add more detailed items under it (m)"}
        >
          ⤴
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="menu-item-delete icon-button"
          onClick={onDelete}
          aria-label={item ? `Delete item: ${item}` : "Delete item"}
          title="Delete item"
        >
          ✕
        </button>
      )}
      {showNote && (
        <label className="menu-item-note">
          <span className="sr-only">Note on {label}</span>
          <input
            value={note ?? ""}
            autoFocus={focusNote}
            maxLength={280}
            placeholder="Note: e.g. only on weekends, let's talk first…"
            onChange={(e) => onChange({ note: e.target.value || undefined })}
            onBlur={() => {
              setFocusNote(false);
              if (!note) setNoteOpen(false);
            }}
          />
        </label>
      )}
    </div>
  );
};
