import "./MenuItem.css";
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
  onChange,
  onDelete,
  rowProps,
}: {
  id?: string;
  item: string;
  value?: RelationshipMenuItemValue;
  onChange: (value: Partial<RelationshipMenuItem>) => void;
  onDelete?: () => void;
  rowProps?: RowProps;
}) => {
  const { className: rowClassName, ...restRowProps } = rowProps || {};
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
          aria-label={item ? undefined : "New item"}
          onChange={(e) => onChange({ item: e.target.value })}
        />
      </label>
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
    </div>
  );
};
