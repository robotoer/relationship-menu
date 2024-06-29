import "./MenuItem.css";
import { RelationshipMenuItem, RelationshipMenuItemValue } from "../model/menu";

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
 */
export const MenuItem = ({
  item,
  value,
  onChange,
}: {
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
          value={item}
          onChange={(e) => onChange({ item: e.target.value })}
        />
      </label>
    </div>
  );
};
