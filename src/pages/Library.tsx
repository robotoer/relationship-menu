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
import { importSummary, TextImport } from "../import-menus";
import { HomeScreenHint } from "../components/HomeScreenHint";
import { ConversationList } from "../components/ConversationList";
import { useSync } from "../sync/context";

/** Backups are a few kilobytes per menu: anything far bigger isn't one (SV-14). */
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Renders the Library page, displaying a list of relationship menus.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {RelationshipMenuDocument[]} props.menus - The array of relationship menus to display.
 * @param {function} [props.onDelete] - Optional callback to delete a menu by its id.
 * @param {function} [props.onImport] - Optional callback that imports pasted text or a backup file (SV-14).
 * @returns {JSX.Element} The rendered Library page.
 */
export const LibraryPage = ({
  menus,
  onDelete,
  onImport,
  oldAddress,
}: {
  /** Saved menus: `id` is the menu id (SY-20); `link` is the slug its tile opens. */
  menus: (RelationshipMenuDocument & { id: string; link: string })[];
  onDelete?: (id: string) => void | Promise<void>;
  /** Saves the menus in pasted text or a backup file without overwriting any (SV-14). */
  onImport?: (text: string) => Promise<TextImport>;
  /** The app's old address (HO-7): an empty Library says how to bring menus from there. */
  oldAddress?: string;
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

  // The way into sync settings (SY-3…SY-13). Everything here works without it (SY-70).
  const syncOn = useSync().state.kind === "on";

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

  // Import menus (SV-14): from pasted links or a backup file, read on this device.
  const [importOpen, setImportOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const pasteField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (importOpen) pasteField.current?.focus();
  }, [importOpen]);
  const closeImport = () => {
    setImportOpen(false);
    setPasted("");
    importButton.current?.focus();
  };
  const runImport = async (text: string) => {
    if (!onImport || importing) return;
    setImporting(true);
    try {
      const result = await onImport(text);
      setImported(importSummary(result));
      if (result.found > 0) {
        // Only that it happened: never what, from where, or how many.
        track("menus_imported");
        closeImport();
      }
    } catch (e) {
      console.error("Failed to import menus:", e);
      setImported("Couldn't save the menus. Try again: any that were saved are skipped.");
    } finally {
      setImporting(false);
    }
  };
  const handleImportFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    // Let the same file be chosen again later.
    input.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setImported("That file is too big to be a menu backup. Choose the file Export all menus made.");
      return;
    }
    let text: string;
    try {
      // Read here, on this device: nothing is uploaded.
      text = await file.text();
    } catch (e) {
      console.error("Failed to read the import file:", e);
      setImported("Couldn't read that file. Try choosing it again.");
      return;
    }
    await runImport(text);
  };

  return (
    <div className="library-page">
      <div className="library-header">
        <h1>Your menus</h1>
        <p>
          Menus you've made or opened are saved in this browser.{" "}
          {menus.length === 0 && "Nothing here yet: start one below."}
        </p>
        {menus.length === 0 && oldAddress && (
          <p className="library-moved">
            Used this app before at{" "}
            <a href={`${oldAddress}/library`}>{new URL(oldAddress).host}</a>? Open that address
            once in this browser to bring your menus here.
          </p>
        )}
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
        {onImport && (
          <div className="library-export">
            <button
              ref={importButton}
              type="button"
              onClick={() => (importOpen ? closeImport() : setImportOpen(true))}
              aria-expanded={importOpen}
              aria-controls="library-import"
              aria-describedby="library-import-about"
            >
              Import menus
            </button>
            <span id="library-import-about" aria-live="polite">
              {imported ??
                "Bring menus here from a backup file or menu links, for example into a Home Screen app."}
            </span>
          </div>
        )}
        {onImport && importOpen && (
          <form
            id="library-import"
            className="library-import"
            aria-label="Import menus"
            onSubmit={(e) => {
              e.preventDefault();
              void runImport(pasted);
            }}
          >
            <label htmlFor="library-import-text">Paste menu links</label>
            <textarea
              id="library-import-text"
              ref={pasteField}
              rows={3}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeImport();
              }}
              placeholder="https://…/menu?encoded=…"
              aria-describedby="library-import-note"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <p id="library-import-note" className="library-import-note">
              Links and files are read on this device; nothing is uploaded. A menu you already have is
              skipped, and one whose title is taken is added as a copy, so nothing is replaced.
            </p>
            <div className="library-import-actions">
              <button type="submit" className="button-primary" disabled={importing || !pasted.trim()}>
                Add menus
              </button>
              {/* A label, so the file picker opens natively everywhere (iPhone included). */}
              <label className="button library-import-file">
                Choose backup file
                <input
                  type="file"
                  accept=".txt,text/plain"
                  disabled={importing}
                  onChange={(e) => void handleImportFile(e.currentTarget)}
                />
              </label>
              <button type="button" onClick={closeImport}>
                Cancel
              </button>
            </div>
          </form>
        )}
        <p className="library-export library-sync">
          <span>
            {syncOn ? "Sync is on in this browser." : "Use more than one device?"}{" "}
            <Link to="/sync">{syncOn ? "Sync settings" : "Sync your menus"}</Link>
          </span>
        </p>
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
      <ConversationList />
    </div>
  );
};
