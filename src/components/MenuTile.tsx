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
}: {
  title: string;
  image: ReactNode;
  link: string;
}) => {
  return (
    <div className="menu-tile">
      <h2>{title}</h2>
      {image}
      <Link to={link}>View</Link>
    </div>
  );
};
