import "./Navbar.css";
import { NavLink } from "react-router-dom";

/**
 * Main navigation bar component.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {string} props.title - The title of the navigation bar.
 * @param {Array<{ to: string, text: string }>} [props.links] - The array of links to be displayed in the navigation bar.
 * @returns {JSX.Element} The rendered navigation bar component.
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
