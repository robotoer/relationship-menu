import { CompareInput } from "./CompareInput";
import "./CompareSection.css";

/**
 * <CompareSection /> is a component that displays a list of encoded relationship menus for comparison.
 *
 * The currently filled out inputs are shown first, followed by one empty input. Typing or
 * pasting into the empty input adds a new menu to the comparison, and a new empty input
 * appears after it. Clearing an input removes that menu. A Compare button shows the
 * comparison once enough menus are entered.
 *
 * The trailing empty input is rendered as part of the same keyed list as the filled
 * inputs so that, when it receives a value, React keeps the same DOM element (and focus)
 * for it instead of moving the text into a freshly mounted input.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {string[]} props.titles - The titles of the menus (one per entry in `menus`).
 * @param {string[]} props.menus - The menu slugs to compare.
 * @param {(string | undefined)[]} [props.errors] - Validation errors, one per entry in `menus`.
 * @param {function} props.onChange - The callback function triggered when the menus change.
 * @param {function} props.onCompare - The callback function triggered when the Compare button is clicked.
 * @param {boolean} props.canCompare - Whether there are enough menus to compare.
 * @returns {JSX.Element} The rendered CompareSection component.
 */
export const CompareSection = ({
  titles,
  menus,
  errors = [],
  onChange,
  onCompare,
  canCompare,
}: {
  titles: string[];
  menus: string[];
  errors?: (string | undefined)[];
  onChange: (menus: string[]) => void;
  onCompare: () => void;
  canCompare: boolean;
}) => {
  const entries = [...menus, ""];
  return (
    <div className="compare-section">
      {entries.map((menu, index) => {
        const isNew = index === menus.length;
        return (
          <CompareInput
            key={index}
            label={(!isNew && titles[index]) || `Menu ${index + 1}`}
            value={menu}
            error={isNew ? undefined : errors[index]}
            onChange={(value) => {
              if (isNew) {
                if (!value) return;
                onChange([...menus, value]);
                return;
              }
              if (!value) {
                onChange(menus.filter((_, i) => i !== index));
                return;
              }
              const updated = [...menus];
              updated[index] = value;
              onChange(updated);
            }}
          />
        );
      })}
      <button
        className="compare-button"
        onClick={onCompare}
        disabled={!canCompare}
      >
        Compare
      </button>
    </div>
  );
};
