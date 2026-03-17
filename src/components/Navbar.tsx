import "./Navbar.css";
import { useState } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="navbar">
      <div className="navbar-header">
        <h1>{title}</h1>
        <div className="spacer" />
        {links && links.length > 0 && (
          <button
            className={`hamburger${menuOpen ? " open" : ""}`}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
          >
            <span className="hamburger-line" />
            <span className="hamburger-line" />
            <span className="hamburger-line" />
          </button>
        )}
        {links?.map(({ to, text }) => (
          <NavLink key={to} to={to} className="link navbar-desktop-link">
            {text}
          </NavLink>
        ))}
      </div>
      {menuOpen && links && links.length > 0 && (
        <div className="navbar-mobile-links">
          {links.map(({ to, text }) => (
            <NavLink
              key={to}
              to={to}
              className="link"
              onClick={() => setMenuOpen(false)}
            >
              {text}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  );
};
