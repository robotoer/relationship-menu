import "./MenuGroup.css";
import { ReactNode } from "react";

/**
 * Represents a menu group component.
 *
 * @component
 * @param {ReactNode} title - The title of the menu group.
 * @param {ReactNode} children - The content of the menu group.
 * @param {() => void} [onDelete] - Optional callback to delete the group.
 * @param {string} [deleteAriaLabel] - Custom aria-label for the delete button.
 * @returns {JSX.Element} The rendered menu group component.
 */
export const MenuGroup = ({
  title,
  children,
  onDelete,
  deleteAriaLabel,
}: {
  title: ReactNode;
  children?: ReactNode;
  onDelete?: () => void;
  deleteAriaLabel?: string;
}) => {
  const label = deleteAriaLabel || "Delete group";
  return (
    <div className="menu-group">
      <div className="menu-group-header">
        {title}
        {onDelete && (
          <button
            type="button"
            className="menu-group-delete"
            onClick={onDelete}
            aria-label={label}
            title={label}
          >
            ✕
          </button>
        )}
      </div>
      {children}
    </div>
  );
};
