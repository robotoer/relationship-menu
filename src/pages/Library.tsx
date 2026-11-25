import "./Library.css";

/**
 * Page that displays a grid of relationship menus available to the current user.
 */

import { MenuTile } from "../components/MenuTile";
import { RelationshipMenuDocument } from "../model/menu";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LibrarySort,
  matchesSearch,
  menuStats,
  relativeTime,
  shortDate,
  sortMenus,
} from "../library-info";
import { RandomAvatar } from "react-random-avatars";
import { track, trackOnce } from "../analytics";

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
      track("menu_deleted");
    } catch (e) {
      console.error("Failed to delete menu:", e);
    }
  };

  const [sort, setSort] = useState<LibrarySort>("edited");
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => sortMenus(menus.filter((menu) => matchesSearch(menu, query)), sort),
    [menus, query, sort]
  );

  return (
    <div className="library-page">
      <div className="library-header">
        <h1>Your menus</h1>
        <p>
          Menus you've made or opened are saved in this browser.{" "}
          {menus.length === 0 && "Nothing here yet: start one below."}
        </p>
        {menus.length > 0 && (
          <div className="library-controls">
            <label>
              <span>Search</span>
              <input
                type="search"
                value={query}
                placeholder="Title, name or item"
                onChange={(e) => {
                  // Only that a search happened (once per visit), never what was typed.
                  if (e.target.value.trim()) trackOnce("library_searched", "library_searched");
                  setQuery(e.target.value);
                }}
              />
            </label>
            <label>
              <span>Sort by</span>
              <select
                value={sort}
                onChange={(e) => {
                  track("library_sorted", { sort: e.target.value as LibrarySort });
                  setSort(e.target.value as LibrarySort);
                }}
              >
                <option value="edited">Recently edited</option>
                <option value="created">Newest</option>
                <option value="title">Title (A–Z)</option>
              </select>
            </label>
            <span className="library-count" role="status">
              {shown.length === menus.length
                ? `${menus.length} menu${menus.length === 1 ? "" : "s"}`
                : `${shown.length} of ${menus.length}`}
            </span>
          </div>
        )}
      </div>
      <div className="library">
        {shown.map((menu) => {
          const stats = menuStats(menu.encoded);
          const name = menu.title || "Untitled menu";
          return (
            <div key={menu.title} className="menu-tile-wrapper">
              <MenuTile
                title={menu.title}
                image={
                  <RandomAvatar name={menu.person?.name || menu.title} size={56} />
                }
                link={`/menu?encoded=${encodeURIComponent(menu.id)}`}
              >
                <dl className="menu-tile-details">
                  {menu.person?.name && (
                    <div>
                      <dt>For</dt>
                      <dd>
                        {menu.person.name}
                        {menu.person.pronouns && ` (${menu.person.pronouns})`}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Items</dt>
                    <dd>
                      {stats.items} in {stats.groups} group{stats.groups === 1 ? "" : "s"}
                    </dd>
                  </div>
                  <div>
                    <dt>Answered</dt>
                    <dd>
                      <span
                        className="menu-tile-progress"
                        role="progressbar"
                        aria-label={`${name}: answered`}
                        aria-valuemin={0}
                        aria-valuemax={stats.items}
                        aria-valuenow={stats.answered}
                      >
                        <span
                          style={{
                            width: stats.items
                              ? `${(stats.answered / stats.items) * 100}%`
                              : 0,
                          }}
                        />
                      </span>
                      {stats.answered}/{stats.items}
                    </dd>
                  </div>
                  {menu.updatedAt && (
                    <div>
                      <dt>Edited</dt>
                      <dd>
                        <time dateTime={new Date(menu.updatedAt).toISOString()}>
                          {relativeTime(menu.updatedAt)}
                        </time>
                      </dd>
                    </div>
                  )}
                  {menu.createdAt && (
                    <div>
                      <dt>Created</dt>
                      <dd>
                        <time dateTime={new Date(menu.createdAt).toISOString()}>
                          {shortDate(menu.createdAt)}
                        </time>
                      </dd>
                    </div>
                  )}
                </dl>
              </MenuTile>
              {onDelete &&
                (confirming === menu.title ? (
                  <div className="delete-menu-confirm" role="group" aria-label="Confirm delete">
                    <span>Delete for good?</span>
                    <button
                      className="delete-menu-button"
                      onClick={() => handleDelete(menu.title)}
                      aria-label={`Yes, delete ${name}`}
                    >
                      Yes
                    </button>
                    <button
                      ref={keepButton}
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
                    aria-label={`Delete ${name}`}
                  >
                    Delete
                  </button>
                ))}
            </div>
          );
        })}
        {menus.length > 0 && shown.length === 0 && (
          <p className="library-empty">No menus match "{query}".</p>
        )}

        <div className="create-menu">
          <Link className="button button-primary" to="/menu">
            Create New Menu
          </Link>
        </div>
      </div>
    </div>
  );
};
