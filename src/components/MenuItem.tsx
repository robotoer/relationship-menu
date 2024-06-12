import "./MenuItem.css";
import { RelationshipMenuItemValue } from "../model/menu";

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
  onChange: (value?: RelationshipMenuItemValue) => void;
}) => {
  return (
    <div className="menu-item">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as RelationshipMenuItemValue)}
        className={value}
      >
        <option value={undefined}>---</option>
        <option value="must-have">Must Have</option>
        <option value="like-to-have">Like to Have</option>
        <option value="maybe">Maybe</option>
        <option value="off-limits">Off Limits</option>
      </select>
      <label>{item}</label>
    </div>
  );
};
