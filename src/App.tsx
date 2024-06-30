import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { Routes, Route, useSearchParams } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { LibraryPage } from "./pages/Library";
import { AboutPage } from "./pages/About";
import { ComparePage } from "./pages/Compare";
import {
  RelationshipMenu,
  RelationshipMenuDocument,
  RelationshipMenuItem,
} from "./model/menu";
import { MenuPage } from "./pages/Menu";
import { decodeData, encodeData } from "./data-encoder";
import { MenuComparison } from "./model/compare";
import { compareMenus } from "./data-comparer";

const WrappedLibraryPage = () => {
  const [documents, setDocuments] = useState<RelationshipMenuDocument[]>([]);
  useEffect(() => {
    const newDocuments = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("menu:")) {
        const value = localStorage.getItem(key);
        if (value) {
          const title = decodeData(key.slice(5));
          const document: RelationshipMenuDocument = {
            title,
            image: "https://via.placeholder.com/150",
            encoded: value,
          };
          newDocuments.push(document);
        }
      }
    }
    setDocuments(newDocuments);
  }, []);
  return <LibraryPage menus={documents} />;
};

const WrappedMenuPage = () => {
  const [title, setTitle] = useState("");
  const [menu, setMenu] = useState<RelationshipMenu>({});
  // Get path paremeters from react-router-dom:
  const [params, setParams] = useSearchParams();
  // Sync the encoded data with the menu state only on first load (to prevent infinite loop):
  useEffect(() => {
    const encodedRaw = params.get("encoded");
    const [encodedTitle, encoded] = encodedRaw?.split(":") ?? [
      undefined,
      undefined,
    ];
    if (encoded) {
      setMenu(decodeData(encoded));
    }
    if (encodedTitle) {
      setTitle(decodeData(encodedTitle));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Save the menu to the browser local storage:
  useEffect(() => {
    // Don't save empty menus:
    if (Object.keys(menu).length === 0) {
      return;
    }

    const menuTitleEncoded = encodeData(title);
    const key = `menu:${menuTitleEncoded}`;
    const value = encodeData(menu);
    localStorage.setItem(key, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]); // We are purpusely not saving when the title changes to avoid creating a new document unnecessarily.
  // Update query parameters as menu or title changes:
  useEffect(() => {
    const menuEncoded = encodeData(menu);
    const menuTitleEncoded = encodeData(title);
    setParams({ encoded: `${menuTitleEncoded}:${menuEncoded}` });
  }, [menu, title, setParams]);

  const menuEncoded = useMemo(
    () => `${encodeData(title)}:${encodeData(menu)}`,
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
  const templateEncoded = useMemo(() => encodeData(template), [template]);

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
            // Add a new item to the group if the itemIndex is out of bounds:
            if (itemIndex === newMenu[group].length) {
              newMenu[group].push(value as RelationshipMenuItem);
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

const WrappedComparePage = () => {
  const [comparison, setComparison] = useState({} as MenuComparison);
  const [titles, setTitles] = useState([] as string[]);
  const [params, setParams] = useSearchParams();
  const [encoded, encodedTitles] = useMemo(
    () => params.getAll("encoded")?.map((x) => x.split(":")[0]),
    [params]
  );

  // Load comparison documents from query parameters:
  useEffect(() => {
    const encodedRaw = params.get("encoded");
    const encoded = params.getAll("encoded")?.flatMap((x) => {
      try {
        return [x.split(":")[1]];
      } catch (e) {
        console.error("Failed to decode menu:", x);
        return [];
      }
    });
    const encodedTitles = params.getAll("encoded")?.flatMap((x) => {
      try {
        return [x.split(":")[0]];
      } catch (e) {
        console.error("Failed to decode menu:", x);
        return [];
      }
    });
    if (encodedRaw) {
      const decoded = encoded.flatMap((x) => {
        try {
          return [decodeData(x) as RelationshipMenu];
        } catch (e) {
          console.error("Failed to decode menu:", x);
          return [];
        }
      });
      const comparison = compareMenus(decoded);
      setComparison(comparison);
    }
    if (encodedTitles) {
      setTitles(encodedTitles.map(decodeData));
    }
  }, [encoded, encodedTitles, params]);

  return (
    <ComparePage
      comparison={comparison}
      titles={titles}
      encoded={params.getAll("encoded")}
      onChangeCompared={
        // Update the page query params
        (encoded) => {
          setParams({ encoded });
        }
      }
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
