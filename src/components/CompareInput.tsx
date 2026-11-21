import { useId } from "react";
import "./CompareInput.css";

/**
 * A component that renders a compare input field.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {string} props.label - The label for the input field.
 * @param {string} [props.value] - The current value of the input field.
 * @param {string} [props.error] - An error message to show below the input.
 * @param {Function} props.onChange - The callback function to handle value changes.
 */
export const CompareInput = ({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value?: string;
  error?: string;
  onChange: (value?: string) => void;
}) => {
  const id = useId();
  return (
    <div className={error ? "compare-input compare-input-invalid" : "compare-input"}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value ?? ""}
        placeholder="Paste a menu slug or share link"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <span id={`${id}-error`} className="compare-input-error">
          {error}
        </span>
      )}
    </div>
  );
};
