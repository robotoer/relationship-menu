import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { Routes, Route, useLocation, useSearchParams } from "react-router-dom";
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
// import { compareMenus } from "./data-comparer";
import { useDocuments, useStorage } from "./providers/Storage";
import { calculateIpfsHash } from "./ipfs";

/**
 * A component that wraps the LibraryPage component and provides the necessary data.
 * @returns The wrapped LibraryPage component.
 */
const WrappedLibraryPage = () => {
  const { documents: documentsMap } = useStorage();
  const [documents, setDocuments] = useState<
    (RelationshipMenuDocument & { id: string })[]
  >([]);
  useEffect(() => {
    (async () => {
      setDocuments(
        await Promise.all(
          Object.values(documentsMap).map(async (document) => ({
            ...document,
            id: await calculateIpfsHash(document),
          }))
        )
      );
    })();
  }, [documentsMap]);
  return <LibraryPage menus={documents} />;
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
  const [menu, setMenu] = useState<RelationshipMenu>({});
  // Get path paremeters from react-router-dom:
  const [params, setParams] = useSearchParams();
  // Sync the encoded data with the menu state only on first load (to prevent infinite loop):
  useEffect(() => {
    const encodedRaw = params.get("encoded");
    if (!encodedRaw) {
      return;
    }
    const document = documents[encodedRaw];
    if (!document) {
      return;
    }

    const { title, encoded } = document;

    if (encoded) {
      setMenu(decodeData(encoded));
    }
    if (title !== undefined && title !== null) {
      setTitle(title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Save the menu to the browser local storage:
  useEffect(() => {
    (async () => {
      // Don't save empty menus:
      if (Object.keys(menu).length === 0) {
        return;
      }

      console.log("Saving menu:", storage);

      const value = encodeData(menu);
      console.log("Saving menu:", title, value);
      const ids = await storage.saveDocuments({
        title,
        encoded: value,
      });
      console.log("Saved menu:", ids);
    })();
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

/**
 * A wrapped component for the ComparePage.
 *
 * @returns The wrapped ComparePage component.
 */
const WrappedComparePage = () => {
  const [comparison, setComparison] = useState({} as MenuComparison);
  const [params, setParams] = useSearchParams();
  // const [encoded, encodedTitles] = useMemo(
  //   () => params.getAll("encoded")?.map((x) => x.split(":")[0]),
  //   [params]
  // );
  const ids = useMemo(() => params.getAll("encoded"), [params]);
  const documents = useDocuments(...ids);
  const titles = useMemo(
    () => documents.map((doc) => doc?.title || ""),
    [documents]
  );

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
