import { CompareInput } from "./CompareInput";
import "./CompareSection.css";

/**
 * <CompareSection /> is a component that displays a list of encoded relationship menus for comparison.
 *
 * The currently filled out inputs should be shown first with an empty input at the end for adding new menus.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {string[]} props.titles - The titles of the menus.
 * @param {string[]} props.menus - The menu items to compare.
 * @param {function} props.onChange - The callback function triggered when the menus change.
 * @returns {JSX.Element} The rendered CompareSection component.
 */
export const CompareSection = ({
  titles,
  menus,
  onChange,
}: {
  titles: string[];
  menus: string[];
  onChange: (menus: string[]) => void;
}) => {
  return (
    <div className="compare-section">
      {menus.map((menu, index) => (
        <CompareInput
          key={index}
          label={`Menu ${index + 1}`}
          value={menu}
          onChange={(value) => {
            if (!value) {
              onChange(menus.filter((_, i) => i !== index));
              return;
            }
            const updated = [...menus];
            updated[index] = value;
            onChange(updated);
          }}
        />
      ))}
      <CompareInput
        label={`Menu ${menus.length + 1}`}
        onChange={(value) => {
          if (!value) return;
          onChange([...menus, value]);
        }}
      />
    </div>
  );
};
