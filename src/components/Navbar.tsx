import "./Navbar.css";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { isSupporter, useSync } from "../sync/context";

/** A pixel heart: a light outline (for contrast on the dark bar) around a red heart. */
const PixelHeart = () => (
  <svg viewBox="0 0 9 8" width="27" height="24" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    <path
      className="navbar-heart-outline"
      d="M2 0h2v1H2zM5 0h2v1H5zM1 1h1v1H1zM4 1h1v1H4zM7 1h1v1H7zM0 2h1v2H0zM8 2h1v2H8zM1 4h1v1H1zM7 4h1v1H7zM2 5h1v1H2zM6 5h1v1H6zM3 6h1v1H3zM5 6h1v1H5zM4 7h1v1H4z"
    />
    <path className="navbar-heart-fill" d="M2 1h2v1H2zM5 1h2v1H5zM1 2h7v2H1zM2 4h5v1H2zM3 5h3v1H3zM4 6h1v1H4z" />
  </svg>
);

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
  /** `state` is passed to the route (e.g. where a Support visit came from). */
  links?: { to: string; text: string; state?: unknown }[];
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const { state } = useSync();

  return (
    <nav className="navbar">
      <div className="navbar-header">
        <Link to="/" className="navbar-home">
          {title}
        </Link>
        <div className="spacer" />
        {/* SY-71: supporters see a heart; it leads to their sync settings. */}
        {isSupporter(state) && (
          <Link to="/sync" className="navbar-heart" aria-label="Supporter" title="Supporter">
            <PixelHeart />
          </Link>
        )}
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
        {links?.map(({ to, text, state }) => (
          <NavLink key={to} to={to} state={state} className="link navbar-desktop-link">
            {text}
          </NavLink>
        ))}
      </div>
      {menuOpen && links && links.length > 0 && (
        <div className="navbar-mobile-links">
          {links.map(({ to, text, state }) => (
            <NavLink
              key={to}
              to={to}
              state={state}
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
