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
import { openedFromState, track, trackOnce } from "../analytics";
import { exportMenus } from "../export-menus";
import { HomeScreenHint } from "../components/HomeScreenHint";

/**
 * Renders the Library page, displaying a list of relationship menus.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {RelationshipMenuDocument[]} props.menus - The array of relationship menus to display.
 * @param {function} [props.onDelete] - Optional callback to delete a menu by its id.
 * @returns {JSX.Element} The rendered Library page.
 */
export const LibraryPage = ({
  menus,
  onDelete,
}: {
  /** Saved menus: `id` is the menu id (SY-20); `link` is the slug its tile opens. */
  menus: (RelationshipMenuDocument & { id: string; link: string })[];
  onDelete?: (id: string) => void | Promise<void>;
}) => {
  // Id of the menu whose Delete was clicked and is waiting for confirmation.
  const [confirming, setConfirming] = useState<string | null>(null);
  // Move keyboard focus into the confirmation when it appears.
  const keepButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming !== null) keepButton.current?.focus();
  }, [confirming]);
  const handleDelete = async (id: string) => {
    setConfirming(null);
    try {
      await onDelete?.(id);
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

  // Export all menus (SV-13): what the last export did, for the status line.
  const [exported, setExported] = useState<string | null>(null);
  const handleExport = async () => {
    try {
      const outcome = await exportMenus(menus);
      if (outcome === "cancelled") return;
      track("menus_exported");
      const count = `${menus.length} menu${menus.length === 1 ? "" : "s"}`;
      setExported(
        outcome === "shared" ? `Shared a file with ${count}.` : `Downloaded a file with ${count}.`
      );
    } catch (e) {
      console.error("Failed to export menus:", e);
      setExported("Couldn't export. Try again, or open each menu and copy its link with Share.");
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
        {menus.length === 0 && <HomeScreenHint className="library-hint" />}
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
        {menus.length > 0 && (
          <div className="library-export">
            <button type="button" onClick={handleExport} aria-describedby="library-export-about">
              Export all menus
            </button>
            <span id="library-export-about" aria-live="polite">
              {exported ??
                "A backup file with a link to each menu. It's made on this device and never uploaded."}
            </span>
          </div>
        )}
      </div>
      <div className="library">
        {shown.map((menu) => {
          const stats = menuStats(menu.encoded);
          const name = menu.title || "Untitled menu";
          return (
            <div key={menu.id} className="menu-tile-wrapper">
              <MenuTile
                title={menu.title}
                image={
                  <RandomAvatar name={menu.person?.name || menu.title} size={56} />
                }
                link={`/menu?encoded=${encodeURIComponent(menu.link)}`}
                // The menu id says which saved menu this is (titles can repeat); the
                // rest keeps reopening a saved menu from counting as a shared link.
                linkState={{ ...openedFromState("library"), menuId: menu.id }}
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
                (confirming === menu.id ? (
                  <div className="delete-menu-confirm" role="group" aria-label="Confirm delete">
                    <span>Delete for good?</span>
                    <button
                      className="delete-menu-button"
                      onClick={() => handleDelete(menu.id)}
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
                    onClick={() => setConfirming(menu.id)}
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
