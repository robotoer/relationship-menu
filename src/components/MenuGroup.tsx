import "./MenuGroup.css";
import { ReactNode } from "react";

/**
 * Represents a menu group component.
 *
 * @component
 * @param {ReactNode} title - The title of the menu group.
 * @param {ReactNode} children - The content of the menu group.
 * @param {() => void} [onDelete] - Optional callback to delete the group.
 * @returns {JSX.Element} The rendered menu group component.
 */
export const MenuGroup = ({
  title,
  children,
  onDelete,
}: {
  title: ReactNode;
  children?: ReactNode;
  onDelete?: () => void;
}) => {
  return (
    <div className="menu-group">
      <div className="menu-group-header">
        {title}
        {onDelete && (
          <button
            className="menu-group-delete"
            onClick={onDelete}
            aria-label="Delete group"
            title="Delete group"
          >
            ✕
          </button>
        )}
      </div>
      {children}
    </div>
  );
};
