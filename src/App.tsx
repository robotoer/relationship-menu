import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { Routes, Route, useLocation, useSearchParams } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { LibraryPage } from "./pages/Library";
import { AboutPage } from "./pages/About";
import { ComparePage } from "./pages/Compare";
import {
  RelationshipMenu,
} from "./model/menu";
import { MenuPage } from "./pages/Menu";
import { decodeData, encodeData } from "./data-encoder";
import { MenuComparison } from "./model/compare";
import { useStorage } from "./providers/Storage";
import { compareMenus } from "./data-comparer";
import { MenuChange, applyMenuChange } from "./menu-editing";
import { useAutosave } from "./autosave";
import {
  DecodedCompareSlug,
  decodeCompareSlug,
  expandCompareEntry,
  normalizeCompareEntry,
} from "./compare-slug";

/** Counter for generating unique item IDs within a page session. */
let _nextItemId = 0;
const generateItemId = (): string => `item_${++_nextItemId}`;

/** Assigns stable IDs to any menu items that don't already have one. */
const ensureItemIds = (menu: RelationshipMenu): RelationshipMenu => {
  const result: RelationshipMenu = Object.create(null);
  for (const group of Object.keys(menu)) {
    result[group] = menu[group].map((item) => ({
      ...item,
      id: item.id || generateItemId(),
    }));
  }
  return result;
};

/** Strips `id` fields from every item so encoded data stays backward-compatible. */
const stripMenuIds = (menu: RelationshipMenu): RelationshipMenu => {
  const result: RelationshipMenu = Object.create(null);
  for (const group of Object.keys(menu)) {
    result[group] = menu[group].map(({ id: _, ...rest }) => rest);
  }
  return result;
};

/**
 * A component that wraps the LibraryPage component and provides the necessary data.
 * @returns The wrapped LibraryPage component.
 */
const WrappedLibraryPage = () => {
  const { documents: documentsMap, deleteDocument } = useStorage();
  const documents = useMemo(
    () =>
      Object.values(documentsMap).map((doc) => ({
        ...doc,
        id: `${encodeData(doc.title)}:${doc.encoded}`,
      })),
    [documentsMap]
  );
  return <LibraryPage menus={documents} onDelete={deleteDocument} />;
};

/** Whether a stored encoded menu has the same groups, items and answers as `menu`. */
const sameMenu = (encoded: string, menu: RelationshipMenu): boolean => {
  try {
    return (
      JSON.stringify(stripMenuIds(decodeData(encoded))) ===
      JSON.stringify(stripMenuIds(menu))
    );
  } catch {
    return false;
  }
};

/** "Title (2)", "Title (3)", ... — the first that isn't already a saved menu's title. */
const uniqueTitle = (title: string, saved: { [title: string]: unknown }) => {
  for (let n = 2; ; n++) {
    const candidate = `${title || "Untitled"} (${n})`;
    if (!Object.prototype.hasOwnProperty.call(saved, candidate)) return candidate;
  }
};

/**
 * A wrapped version of the MenuPage component that handles state management and data encoding/decoding.
 * It uses react-router-dom to get path parameters and syncs the encoded data with the menu state.
 * The menu is saved to the browser's local storage and query parameters are updated as the menu or title changes.
 * @returns The wrapped MenuPage component.
 */
const WrappedMenuPage = () => {
  const { storage, documents } = useStorage();
  const [title, setTitle] = useState("");
  const [menu, setMenuState] = useState<RelationshipMenu>({});
  // Latest menu, updated synchronously so rapid edits always build on each other.
  const menuRef = useRef<RelationshipMenu>({});
  const undoStack = useRef<RelationshipMenu[]>([]);
  const redoStack = useRef<RelationshipMenu[]>([]);
  // The text field last edited, so a run of keystrokes in one field is one undo step.
  const lastTextEdit = useRef<string | null>(null);
  /** Replaces the menu (e.g. when loading) without recording an undo step. */
  const setMenu = (next: RelationshipMenu) => {
    menuRef.current = next;
    undoStack.current = [];
    redoStack.current = [];
    lastTextEdit.current = null;
    setMenuState(next);
  };
  const editMenu = (change: MenuChange) => {
    const prev = menuRef.current;
    const next = applyMenuChange(prev, change, generateItemId);
    if (next === prev) return;
    const textEdit =
      change.kind === "item" && change.value && "item" in change.value
        ? `item:${change.group}:${change.itemIndex}`
        : change.kind === "group" && change.oldGroup !== undefined && change.newGroup !== undefined
        ? `group:${Object.keys(prev).indexOf(change.oldGroup)}`
        : null;
    if (!textEdit || textEdit !== lastTextEdit.current) {
      undoStack.current = [...undoStack.current.slice(-99), prev];
    }
    lastTextEdit.current = textEdit;
    redoStack.current = [];
    menuRef.current = next;
    setMenuState(next);
  };
  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(menuRef.current);
    lastTextEdit.current = null;
    menuRef.current = prev;
    setMenuState(prev);
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(menuRef.current);
    lastTextEdit.current = null;
    menuRef.current = next;
    setMenuState(next);
  };
  const loadedFromUrl = useRef(false);
  // The title this editor's menu is saved under (set when a menu is loaded or first
  // saved). Renaming saves under the new title and removes this entry.
  const ownedTitle = useRef<string | null>(null);
  // Get path paremeters from react-router-dom:
  const [params, setParams] = useSearchParams();

  // The link this page was opened with. Captured once: the URL is rewritten as the
  // menu is edited, and must not be read back as a new menu to load.
  const initialEncoded = useRef(params.get("encoded"));
  // False until the opened link (if any) has been loaded.
  const [loaded, setLoaded] = useState(!initialEncoded.current);
  const [notice, setNotice] = useState<string | null>(null);

  // Load the menu from the link. Two formats:
  // 1. "titleEncoded:menuEncoded" — self-contained link (all data in URL)
  // 2. A document ID (CID or title) — looked up from storage (retried once
  //    storage is ready, since IPFS starts asynchronously)
  useEffect(() => {
    const raw = initialEncoded.current;
    if (!raw || loadedFromUrl.current) return;
    const selfContained = raw.includes(":");
    if (selfContained) loadedFromUrl.current = true;
    let cancelled = false;
    (async () => {
      let opened: { title: string; menu: RelationshipMenu } | null = null;
      try {
        if (selfContained) {
          opened = decodeCompareSlug(raw);
        } else {
          const doc = (await storage.getDocuments(raw))[raw];
          const decoded = doc && decodeCompareSlug(`${encodeData(doc.title)}:${doc.encoded}`);
          if (!decoded) return; // Not found yet: retry when storage changes.
          loadedFromUrl.current = true;
          opened = decoded;
        }
      } catch (e) {
        console.error("Failed to open menu link:", e);
      }
      if (cancelled) return;
      if (!opened) {
        setNotice(
          "This link couldn't be opened. It may have been cut off when it was copied; ask for it again."
        );
        setLoaded(true);
        return;
      }
      // Opening a link must never replace a different menu you already saved under
      // the same title (e.g. your partner's menu, or a template of your own menu):
      // open it as a copy with a free title instead.
      const saved = await storage.getDocuments();
      if (cancelled) return;
      const existing = saved[opened.title];
      let openedTitle = opened.title;
      if (existing && !sameMenu(existing.encoded, opened.menu)) {
        openedTitle = uniqueTitle(opened.title, saved);
        setNotice(
          `You already have a menu called "${opened.title}", so this link was opened as "${openedTitle}". Rename it any time.`
        );
        ownedTitle.current = null;
      } else {
        ownedTitle.current = opened.title;
      }
      setTitle(openedTitle);
      setMenu(ensureItemIds(opened.menu));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage]);
  // Save the menu (and its title) to storage, debounced, one save at a time.
  const titleTaken =
    title !== ownedTitle.current &&
    Object.prototype.hasOwnProperty.call(documents, title);
  const docToSave = useMemo(
    () =>
      !loaded || titleTaken || (title === "" && Object.keys(menu).length === 0)
        ? null
        : { title, encoded: encodeData(stripMenuIds(menu)) },
    [title, menu, titleTaken, loaded]
  );
  const saveState = useAutosave(docToSave, async (doc) => {
    await storage.saveDocuments(doc);
    const previous = ownedTitle.current;
    ownedTitle.current = doc.title;
    if (previous !== null && previous !== doc.title) {
      await storage.deleteDocument(previous);
    }
  });

  // Keep the URL in sync with the menu so it can be bookmarked or reloaded. Replace
  // the history entry rather than pushing one per edit, so Back leaves the editor.
  useEffect(() => {
    if (!loaded) return;
    const encoded = `${encodeData(title)}:${encodeData(stripMenuIds(menu))}`;
    if (params.get("encoded") !== encoded) {
      setParams({ encoded }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, title, loaded]);

  const menuEncoded = useMemo(
    () => `${encodeData(title)}:${encodeData(stripMenuIds(menu))}`,
    [menu, title]
  );
  const template = useMemo(() => {
    // Strip all values from the menu to create a template:
    const template: RelationshipMenu = {};
    for (const group in menu) {
      template[group] = menu[group].map((item) => ({ item: item.item }));
    }
    return template;
  }, [menu]);
  const templateEncoded = useMemo(
    () => `${encodeData(title)}:${encodeData(template)}`,
    [title, template]
  );

  return (
    <MenuPage
      title={title}
      menu={menu}
      menuEncoded={menuEncoded}
      templateEncoded={templateEncoded}
      onChange={editMenu}
      onUndo={undo}
      onRedo={redo}
      onChangeTitle={setTitle}
      saveStatus={titleTaken ? "title-taken" : saveState}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
    />
  );
};

/** Whether a list of compare entries contains at least two valid menus. */
const opensCompared = (entries: string[]) =>
  entries.filter((entry) => decodeCompareSlug(entry) !== null).length >= 2;

/**
 * A wrapped component for the ComparePage.
 *
 * Decodes self-contained slugs (titleEncoded:menuEncoded format) directly
 * rather than looking them up from storage, so compare links work across
 * browsers without needing shared storage.
 *
 * The entries being edited live in local state so typing is applied synchronously
 * (React Router applies search param updates as a deferred transition, which makes a
 * URL-controlled input drop keystrokes). Edits are mirrored into the URL with
 * `history.replaceState` so the page stays shareable; navigations from elsewhere
 * (links, back/forward) still reset the entries from the URL.
 *
 * @returns The wrapped ComparePage component.
 */
const WrappedComparePage = () => {
  const [params] = useSearchParams();
  // Changes on every router navigation (but not on our own replaceState calls).
  const { key: navigationKey } = useLocation();
  const paramEntries = useMemo(
    () => params.getAll("encoded").filter((e) => e.trim().length > 0),
    [params]
  );

  // Every entry the user has typed, including ones that don't decode (yet), so that
  // inputs never disappear while being typed or edited.
  const [encodedList, setEncodedList] = useState(paramEntries);

  // The comparison is shown when the user clicks Compare. A compare link that already
  // contains 2+ valid menus (e.g. a shared link) opens straight to the comparison.
  const [compareClicked, setCompareClicked] = useState(() =>
    opensCompared(paramEntries)
  );

  useEffect(() => {
    setEncodedList(paramEntries);
    setCompareClicked(opensCompared(paramEntries));
  }, [paramEntries, navigationKey]);

  const updateEntries = (entries: string[]) => {
    const normalized = entries.flatMap(expandCompareEntry).map((entry) =>
      // Store pasted share links as plain slugs once they decode.
      decodeCompareSlug(entry) ? normalizeCompareEntry(entry) : entry
    );
    setEncodedList(normalized);
    const newParams = new URLSearchParams();
    normalized.forEach((entry) => newParams.append("encoded", entry));
    const query = newParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`
    );
  };

  // Decode each entry; null for entries that aren't a valid slug or share link.
  const decoded = useMemo(
    () => encodedList.map((entry) => decodeCompareSlug(entry)),
    [encodedList]
  );

  const valid = useMemo(
    () => decoded.filter((d): d is DecodedCompareSlug => d !== null),
    [decoded]
  );

  // Label for each input: the decoded menu title, if any.
  const inputTitles = useMemo(
    () => decoded.map((d) => d?.title || ""),
    [decoded]
  );

  const errors = useMemo(
    () =>
      decoded.map((d) =>
        d ? undefined : "Not a valid menu slug or share link"
      ),
    [decoded]
  );

  // One column per successfully decoded menu, in input order.
  const legendTitles = useMemo(() => valid.map((d) => d.title), [valid]);

  const comparison = useMemo(() => {
    if (valid.length === 0) return {} as MenuComparison;
    return compareMenus(valid.map((d) => d.menu));
  }, [valid]);

  const canCompare = valid.length >= 2;

  return (
    <ComparePage
      comparison={comparison}
      titles={inputTitles}
      encoded={encodedList}
      errors={errors}
      legendTitles={legendTitles}
      showComparison={compareClicked && canCompare}
      canCompare={canCompare}
      onChangeCompared={updateEntries}
      onCompare={() => setCompareClicked(true)}
    />
  );
};

/**
 * Main application component.
 *
 * Contains the main nav bar and routes to the various pages.
 *
 * This component also handles storage/retrieval from browser local storage of stored
 * relationship menu documents.
 */
export const App = () => {
  const libraryPage = useMemo(() => <WrappedLibraryPage />, []);
  const menuPage = useMemo(() => <WrappedMenuPage />, []);
  const comparePage = useMemo(() => <WrappedComparePage />, []);
  const aboutPage = useMemo(() => <AboutPage />, []);

  const location = useLocation();

  useEffect(() => {
    // track pageview with gtag / react-ga / react-ga4, for example:
    window.gtag("event", "page_view", {
      page_path: location.pathname + location.search,
    });
  }, [location]);

  return (
    <div className="app">
      <Navbar
        title="Relationship Menu"
        links={[
          { to: "/", text: "Library" },
          { to: "/compare", text: "Compare" },
          { to: "/about", text: "About" },
        ]}
      />
      <Routes>
        <Route path="/" element={libraryPage} />
        <Route path="/menu" element={menuPage} />
        <Route path="/compare" element={comparePage} />
        <Route path="/about" element={aboutPage} />
      </Routes>
    </div>
  );
};
