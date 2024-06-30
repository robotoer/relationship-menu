import { Link } from "react-router-dom";
import "./MenuTile.css";
import { ReactNode } from "react";

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
