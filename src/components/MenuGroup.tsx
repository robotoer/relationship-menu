import "./MenuGroup.css";
import { ReactNode } from "react";

/**
 * Represents a menu group component.
 *
 * @component
 * @param {ReactNode} title - The title of the menu group.
 * @param {ReactNode} children - The content of the menu group.
 * @returns {JSX.Element} The rendered menu group component.
 */
export const MenuGroup = ({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) => {
  return (
    <div className="menu-group">
      {title}
      {children}
    </div>
  );
};
