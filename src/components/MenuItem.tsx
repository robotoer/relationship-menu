import "./MenuItem.css";
import { useState } from "react";
import { RelationshipMenuItem, RelationshipMenuItemValue } from "../model/menu";

/**
 * A custom input component for menu items.
 *
 * @component
 * @param {React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>} props - The input element props.
 * @param {string} props.className - The class name for the input element.
 * @param {string} props.placeholder - The placeholder text for the input element.
 * @returns {JSX.Element} The rendered input element.
 */
const MenuItemInput = ({
  className,
  placeholder,
  ...params
}: React.DetailedHTMLProps<
  React.InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
>) => (
  <input
    className={className ? `menu-item-input ${className}` : "menu-item-input"}
    placeholder={placeholder || "New item"}
    {...params}
  />
);

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
