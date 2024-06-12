import { useEffect, useState } from "react";
import "./App.css";
import { Routes, Route, useParams } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { LibraryPage } from "./pages/Library";
import { AboutPage } from "./pages/About";
import { ComparePage } from "./pages/Compare";
import {
  RelationshipMenu,
  RelationshipMenuDocument,
} from "./model/menu";
import { MenuPage } from "./pages/Menu";
import { decodeData } from "./data-encoder";

/**
 * Main application component.
 *
 * Contains the main nav bar and routes to the various pages.
 *
 * This component also handles storage/retrieval from browser local storage of stored
 * relationship menu documents.
 */

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
        (group, itemIndex, value) => {
          const updated = { ...menu };
          updated[group][itemIndex].value = value;
          setMenu(updated);
        }
      }
    />
  );
};

export const App = () => {
  // Load documents from local storage:
  const [documents, setDocuments] = useState<RelationshipMenuDocument[]>(() => {
    const stored = localStorage.getItem("relationship-menus");
    return stored ? JSON.parse(stored) : [];
  });

  // TODO: Save documents to local storage:
  // const saveDocuments = (docs: RelationshipMenuDocument[]) => {
  //   localStorage.setItem("relationship-menus", JSON.stringify(docs));
  //   setDocuments(docs);
  // };

  return (
    <div className="app">
      <Navbar
        title="Relationship Menus"
        links={[
          { to: "/", text: "Home" },
          { to: "/create", text: "Create" },
          { to: "/view", text: "View" },
        ]}
      />
      <Routes>
        <Route path="/" element={<LibraryPage menus={documents} />} />
        <Route path="/menu/:encoded" element={<WrappedMenuPage />} />
        <Route
          path="/compare"
          element={<ComparePage comparison={{}} titles={[]} />}
        />
        <Route path="/about" element={<AboutPage />} />
      </Routes>
    </div>
  );
};
