import { CompareInput } from "./CompareInput";

/**
 * <CompareSection /> is a component that displays a list of encoded relationship menus for comparison.
 *
 * The currently filled out inputs should be shown first with an empty input at the end for adding new menus.
 */
export const CompareSection = ({
  menus,
  onChange,
}: {
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
