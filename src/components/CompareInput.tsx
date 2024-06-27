import "./CompareInput.css";

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
