import "./Library.css";

/**
 * Page that displays a grid of relationship menus available to the current user.
 */

import { MenuTile } from "../components/MenuTile";
import { RelationshipMenuDocument } from "../model/menu";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { starterMenuPath } from "../starter-menu";
import { RandomAvatar } from "react-random-avatars";

/**
 * Renders the Library page, displaying a list of relationship menus.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {RelationshipMenuDocument[]} props.menus - The array of relationship menus to display.
 * @param {function} [props.onDelete] - Optional callback to delete a menu by title.
 * @returns {JSX.Element} The rendered Library page.
 */
export const LibraryPage = ({
  menus,
  onDelete,
}: {
  menus: (RelationshipMenuDocument & { id: string })[];
  onDelete?: (title: string) => void | Promise<void>;
}) => {
  // Title of the menu whose Delete was clicked and is waiting for confirmation.
  const [confirming, setConfirming] = useState<string | null>(null);
  // Move keyboard focus into the confirmation when it appears.
  const keepButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming !== null) keepButton.current?.focus();
  }, [confirming]);
  const handleDelete = async (title: string) => {
    setConfirming(null);
    try {
      await onDelete?.(title);
    } catch (e) {
      console.error("Failed to delete menu:", e);
    }
  };

  return (
    <div className="library-page">
      <div className="library-header">
        <h1>Your menus</h1>
        <p>
          Menus you've made or opened are saved in this browser.{" "}
          {menus.length === 0 && "Nothing here yet: start one below."}
        </p>
      </div>
      <div className="library">
        {menus.map((menu) => (
          <div key={menu.title} className="menu-tile-wrapper">
            <MenuTile
              title={menu.title}
              image={<RandomAvatar name={menu.title} size={150} />}
              link={`/menu?encoded=${encodeURIComponent(menu.id)}`}
            />
            {onDelete &&
              (confirming === menu.title ? (
                <div
                  className="delete-menu-confirm"
                  role="group"
                  aria-label="Confirm delete"
                >
                  <span>Delete for good?</span>
                  <button
                    className="delete-menu-button"
                    onClick={() => handleDelete(menu.title)}
                    aria-label={`Yes, delete ${menu.title || "Untitled menu"}`}
                  >
                    Yes
                  </button>
                  <button
                    className="delete-menu-cancel"
                    onClick={() => setConfirming(null)}
                    aria-label="Keep it"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  className="delete-menu-button"
                  onClick={() => setConfirming(menu.title)}
                  aria-label={`Delete ${menu.title || "Untitled menu"}`}
                >
                  Delete
                </button>
              ))}
          </div>
        ))}

        {/* Add a button to create a new menu */}
        <div className="create-menu">
          <Link className="button button-primary" to="/menu">
            Create New Menu
          </Link>
          <Link className="create-menu-starter" to={starterMenuPath()}>
            or start from the starter menu
          </Link>
        </div>
      </div>
    </div>
  );
};
