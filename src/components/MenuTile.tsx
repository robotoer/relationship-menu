import { Link } from "react-router-dom";
import "./MenuTile.css";
import { ReactNode } from "react";

/**
 * Represents a menu tile component.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {string} props.title - The title of the menu tile.
 * @param {ReactNode} props.image - The image to be displayed in the menu tile.
 * @param {string} props.link - The link to navigate when the menu tile is clicked.
 * @returns {JSX.Element} The rendered menu tile component.
 */
export const MenuTile = ({
  title,
  image,
  link,
  children,
}: {
  title: string;
  image: ReactNode;
  link: string;
  /** Extra details shown under the title (person, counts, dates). */
  children?: ReactNode;
}) => {
  return (
    <div className="menu-tile">
      <div className="menu-tile-header">
        {image}
        <h2 className={title ? undefined : "untitled"}>{title || "Untitled menu"}</h2>
      </div>
      {children}
      <Link to={link}>View</Link>
    </div>
  );
};
