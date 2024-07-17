import "./CompareInput.css";

/**
 * A component that renders a compare input field.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {string} props.label - The label for the input field.
 * @param {string} [props.value] - The current value of the input field.
 * @param {Function} props.onChange - The callback function to handle value changes.
 */
export const CompareInput = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (value?: string) => void;
}) => {
  return (
    <div className="compare-input">
      <label>{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // className={value || "unknown"}
      />
    </div>
  );
};
