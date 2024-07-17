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
 * @param {string} id - The ID of the menu item.
 * @param {string} item - The text content of the menu item.
 * @param {RelationshipMenuItemValue} value - The value of the menu item.
 * @param {(value: Partial<RelationshipMenuItem>) => void} onChange - The callback function triggered when the menu item value changes.
 * @returns {JSX.Element} The rendered menu item component.
 */
export const MenuItem = ({
  id,
  item,
  value,
  onChange,
}: {
  id?: string;
  item: string;
  value?: RelationshipMenuItemValue;
  onChange: (value: Partial<RelationshipMenuItem>) => void;
}) => {
  return (
    <div className="menu-item">
      <select
        value={value}
        onChange={(e) =>
          onChange({ value: e.target.value as RelationshipMenuItemValue })
        }
        className={value || "unknown"}
      >
        <option value={undefined}>---</option>
        <option value="must-have">Must Have</option>
        <option value="like-to-have">Like to Have</option>
        <option value="maybe">Maybe</option>
        <option value="off-limits">Off Limits</option>
      </select>
      <label>
        <MenuItemInput
          id={id}
          value={item}
          onChange={(e) => onChange({ item: e.target.value })}
        />
      </label>
    </div>
  );
};
