import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { Routes, Route, useParams } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { LibraryPage } from "./pages/Library";
import { AboutPage } from "./pages/About";
import { ComparePage } from "./pages/Compare";
import { RelationshipMenu, RelationshipMenuDocument, RelationshipMenuItem } from "./model/menu";
import { MenuPage } from "./pages/Menu";
import { decodeData } from "./data-encoder";

const WrappedLibraryPage = () => {
  const [documents, setDocuments] = useState<RelationshipMenuDocument[]>([]);
  useEffect(() => {
    const stored = localStorage.getItem("documents");
    if (stored) {
      setDocuments(JSON.parse(stored));
    }
  }, []);
  return <LibraryPage menus={documents} />;
};

const WrappedMenuPage = () => {
  const [menu, setMenu] = useState<RelationshipMenu>({});
  // Get path paremeters from react-router-dom:
  const { encoded } = useParams<{ encoded: string }>();
  // Sync the encoded data with the menu state:
  useEffect(() => {
    if (!encoded) return;
    setMenu(decodeData(encoded));
  }, [encoded]);
  return (
    <MenuPage
      menu={menu}
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
    />
  );
};

const WrappedComparePage = () => {
  const [comparison, setComparison] = useState({});
  const [titles, setTitles] = useState([]);

  // Load comparison documents from query parameters:
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const comparisonEncoded = urlParams.get("comparison");
    if (comparisonEncoded) {
      setComparison(decodeData(comparisonEncoded));
    }
    const titlesEncoded = urlParams.get("titles");
    if (titlesEncoded) {
      setTitles(decodeData(titlesEncoded));
    }
  }, []);

  return <ComparePage comparison={comparison} titles={titles} />;
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
        title="Non-Escalator Relationship Menu"
        links={[
          { to: "/", text: "Library" },
          { to: "/compare", text: "Compare" },
          { to: "/about", text: "About" },
        ]}
      />
      <Routes>
        <Route path="/" element={libraryPage} />
        <Route path="/menu" element={menuPage} />
        <Route path="/menu/:encoded" element={menuPage} />
        <Route path="/compare" element={comparePage} />
        <Route path="/about" element={aboutPage} />
      </Routes>
    </div>
  );
};
