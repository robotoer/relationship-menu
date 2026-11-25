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
import { applyMenuChange } from "./menu-editing";
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

/**
 * A wrapped version of the MenuPage component that handles state management and data encoding/decoding.
 * It uses react-router-dom to get path parameters and syncs the encoded data with the menu state.
 * The menu is saved to the browser's local storage and query parameters are updated as the menu or title changes.
 * @returns The wrapped MenuPage component.
 */
const WrappedMenuPage = () => {
  const { storage } = useStorage();
  const [title, setTitle] = useState("");
  const [menu, setMenu] = useState<RelationshipMenu>({});
  const loadedFromUrl = useRef(false);
  // Get path paremeters from react-router-dom:
  const [params, setParams] = useSearchParams();

  // Memoize encodedRaw to use as stable dependency
  const encodedRaw = useMemo(() => params.get("encoded"), [params]);

  // Decode menu data from the URL encoded parameter on initial load.
  // Supports two formats:
  // 1. "titleEncoded:menuEncoded" — self-contained link (all data in URL)
  // 2. A document ID (CID or title) — looked up from storage
  useEffect(() => {
    if (!encodedRaw || loadedFromUrl.current) {
      return;
    }
    // The encoded format is "titleEncoded:menuEncoded" where both parts are
    // pako-compressed base64 strings. Base64 uses [A-Za-z0-9+/=] so ":"
    // is a safe delimiter.
    const colonIndex = encodedRaw.indexOf(":");
    if (colonIndex !== -1) {
      // Format 1: self-contained "titleEncoded:menuEncoded"
      try {
        const titlePart = encodedRaw.slice(0, colonIndex);
        const menuPart = encodedRaw.slice(colonIndex + 1);
        const decodedTitle = decodeData(titlePart);
        const decodedMenu = decodeData(menuPart);
        if (decodedTitle !== undefined && decodedTitle !== null) {
          setTitle(decodedTitle);
        }
        if (decodedMenu && typeof decodedMenu === "object") {
          setMenu(ensureItemIds(decodedMenu));
        }
        loadedFromUrl.current = true;
      } catch (e) {
        console.error("Failed to decode menu from URL:", e);
      }
    } else {
      // Format 2: document ID lookup (CID or title)
      (async () => {
        try {
          const docs = await storage.getDocuments(encodedRaw);
          const doc = docs[encodedRaw];
          if (doc) {
            setTitle(doc.title);
            const decodedMenu = decodeData(doc.encoded);
            if (decodedMenu && typeof decodedMenu === "object") {
              setMenu(ensureItemIds(decodedMenu));
            }
            loadedFromUrl.current = true;
          } else {
            console.warn(`Document not found for ID: ${encodedRaw}`);
          }
        } catch (e) {
          console.error("Failed to fetch document by ID:", e);
        }
      })();
    }
  }, [encodedRaw, storage]);
  // Save the menu to the browser local storage:
  useEffect(() => {
    (async () => {
      // Don't save empty menus:
      if (Object.keys(menu).length === 0) {
        return;
      }

      const value = encodeData(stripMenuIds(menu));
      await storage.saveDocuments({
        title,
        encoded: value,
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]); // We are purpusely not saving when the title changes to avoid creating a new document unnecessarily.
  // Update query parameters as menu or title changes:
  useEffect(() => {
    const strippedMenu = stripMenuIds(menu);
    const menuEncoded = encodeData(strippedMenu);
    const menuTitleEncoded = encodeData(title);
    setParams({ encoded: `${menuTitleEncoded}:${menuEncoded}` });
  }, [menu, title, setParams]);

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
      onChange={(change) =>
        // Functional update so rapid edits (fast typing) never build on a stale menu.
        setMenu((prev) => applyMenuChange(prev, change, generateItemId))
      }
      onChangeTitle={setTitle}
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
