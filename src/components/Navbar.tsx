import "./Navbar.css";
import { NavLink } from "react-router-dom";

/**
 * Main navigation bar component.
 */
export const Navbar = ({
  title,
  links,
}: {
  title: string;
  links?: { to: string; text: string }[];
}) => {
  return (
    <nav className="navbar">
      <h1>{title}</h1>
      <div className="spacer" />
      {links?.map(({ to, text }) => (
        <NavLink key={to} to={to} className="link">
          {text}
        </NavLink>
      ))}
    </nav>
  );
};
