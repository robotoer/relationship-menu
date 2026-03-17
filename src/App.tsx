import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { Routes, Route, useLocation, useSearchParams } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { LibraryPage } from "./pages/Library";
import { AboutPage } from "./pages/About";
import { ComparePage } from "./pages/Compare";
import {
  RelationshipMenu,
  RelationshipMenuItem,
} from "./model/menu";
import { MenuPage } from "./pages/Menu";
import { decodeData, encodeData } from "./data-encoder";
import { MenuComparison } from "./model/compare";
import { useStorage } from "./providers/Storage";
import { compareMenus } from "./data-comparer";

/** Counter for generating unique item IDs within a page session. */
let _nextItemId = 0;
const generateItemId = (): string => `item_${++_nextItemId}`;

/** Assigns stable IDs to any menu items that don't already have one. */
const ensureItemIds = (menu: RelationshipMenu): RelationshipMenu => {
  const result: RelationshipMenu = {};
  for (const group in menu) {
    result[group] = menu[group].map((item) => ({
      ...item,
      id: item.id || generateItemId(),
    }));
  }
  return result;
};

/** Strips `id` fields from every item so encoded data stays backward-compatible. */
const stripMenuIds = (menu: RelationshipMenu): RelationshipMenu => {
  const result: RelationshipMenu = {};
  for (const group in menu) {
    result[group] = menu[group].map(({ id: _, ...rest }) => rest);
  }
  return result;
};

/**
 * A component that wraps the LibraryPage component and provides the necessary data.
 * @returns The wrapped LibraryPage component.
 */
const WrappedLibraryPage = () => {
  const { documents: documentsMap } = useStorage();
  const documents = useMemo(
    () =>
      Object.values(documentsMap).map((doc) => ({
        ...doc,
        id: `${encodeData(doc.title)}:${doc.encoded}`,
      })),
    [documentsMap]
  );
  return <LibraryPage menus={documents} />;
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
      onChange={
        // Update the value of `menu` in the state:
        (change) => {
          if (change.kind === "group") {
            const { oldGroup, newGroup } = change;
            if (oldGroup && newGroup) {
              const newMenu = { ...menu };
              newMenu[newGroup] = newMenu[oldGroup];
              delete newMenu[oldGroup];
              setMenu(newMenu);
            } else if (oldGroup) {
              const newMenu = { ...menu };
              delete newMenu[oldGroup];
              setMenu(newMenu);
            } else if (newGroup) {
              const newMenu = { ...menu };
              newMenu[newGroup] = [];
              setMenu(newMenu);
            } else {
              console.error("Invalid group change:", change);
            }
          } else if (change.kind === "item") {
            const { group, itemIndex, value } = change;
            const newMenu = { ...menu };
            if (value === undefined && itemIndex >= 0 && itemIndex < newMenu[group].length) {
              // Delete the item from the group:
              newMenu[group] = newMenu[group].filter((_, index) => index !== itemIndex);
            } else if (itemIndex === newMenu[group].length) {
              // Add a new item to the group:
              newMenu[group] = [...newMenu[group], { ...(value as RelationshipMenuItem), id: generateItemId() }];
            } else if (itemIndex >= 0 && itemIndex < newMenu[group].length) {
              newMenu[group] = newMenu[group].map((item, index) =>
                index === itemIndex ? { ...item, ...value } : item
              );
            } else {
              console.error("Invalid item change:", change);
            }
            setMenu(newMenu);
          } else {
            console.error("Invalid change:", change);
          }
        }
      }
      onChangeTitle={setTitle}
    />
  );
};

/**
 * A wrapped component for the ComparePage.
 *
 * Decodes self-contained slugs (titleEncoded:menuEncoded format) directly
 * rather than looking them up from storage, so compare links work across
 * browsers without needing shared storage.
 *
 * @returns The wrapped ComparePage component.
 */
const WrappedComparePage = () => {
  const [params, setParams] = useSearchParams();
  const encodedList = useMemo(
    () => params.getAll("encoded").filter(Boolean),
    [params]
  );

  // Show comparison automatically when loading with 2+ encoded params (shared link)
  const [showComparison, setShowComparison] = useState(
    encodedList.length >= 2
  );

  // Keep showComparison in sync with the current encoded list (URL state)
  useEffect(() => {
    setShowComparison(encodedList.length >= 2);
  }, [encodedList]);

  // Decode each encoded param into title + menu, preserving the original encoded string
  const decoded = useMemo(() => {
    return encodedList.map((enc) => {
      try {
        const colonIndex = enc.indexOf(":");
        if (colonIndex !== -1) {
          const titlePart = enc.slice(0, colonIndex);
          const menuPart = enc.slice(colonIndex + 1);
          const title = decodeData(titlePart) as string;
          const menu = decodeData(menuPart) as RelationshipMenu;
          return { title, menu, encoded: enc };
        }
      } catch (e) {
        console.error("Failed to decode compare slug:", e);
      }
      return null;
    });
  }, [encodedList]);

  // Filter to only successfully decoded entries so titles, encoded, and comparison
  // all come from the same set and column counts stay aligned.
  const validDecoded = useMemo(
    () =>
      decoded.filter(
        (
          d
        ): d is { title: string; menu: RelationshipMenu; encoded: string } =>
          d !== null
      ),
    [decoded]
  );

  const titles = useMemo(
    () => validDecoded.map((d) => d.title),
    [validDecoded]
  );

  const validEncoded = useMemo(
    () => validDecoded.map((d) => d.encoded),
    [validDecoded]
  );

  const comparison = useMemo(() => {
    const menus = validDecoded.map((d) => d.menu);
    if (menus.length === 0) return {} as MenuComparison;
    return compareMenus(menus);
  }, [validDecoded]);

  return (
    <ComparePage
      comparison={comparison}
      titles={titles}
      encoded={validEncoded}
      showComparison={showComparison}
      onChangeCompared={(encoded) => {
        const newParams = new URLSearchParams();
        encoded.forEach((e) => newParams.append("encoded", e));
        setParams(newParams);
      }}
      onCompare={() => setShowComparison(true)}
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
