import "./MenuGroup.css";
import { ReactNode } from "react";
import type { RowProps } from "./MenuItem";
import { MoveButtons, MoveControls } from "./MoveButtons";

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
  headerProps,
  move,
  moveName,
}: {
  title: ReactNode;
  children?: ReactNode;
  onDelete?: () => void;
  deleteAriaLabel?: string;
  headerProps?: RowProps;
  /** Reorder mode (ED-23): ▲▼ instead of delete. */
  move?: MoveControls;
  /** How the move buttons name this group, e.g. `group "Touch"`. */
  moveName?: string;
}) => {
  const label = deleteAriaLabel || "Delete group";
  return (
    <div className="menu-group">
      <div {...headerProps} className="menu-group-header">
        {title}
        {move && <MoveButtons name={moveName ?? "group"} controls={move} />}
        {!move && onDelete && (
          <button
            type="button"
            className="menu-group-delete icon-button"
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
