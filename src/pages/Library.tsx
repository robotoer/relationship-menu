import "./Library.css";

/**
 * Page that displays a grid of relationship menus available to the current user.
 */

import { MenuTile } from "../components/MenuTile";
import { RelationshipMenuDocument } from "../model/menu";
import { Link } from "react-router-dom";
import { encodeData } from "../data-encoder";

export const LibraryPage = ({
  menus,
}: {
  menus: RelationshipMenuDocument[];
}) => {
  return (
    <div className="library">
      {menus.map((menu) => (
        <MenuTile
          key={menu.encoded}
          title={menu.title}
          image={<img src={menu.image} alt={menu.title} />}
          link={`/menu?encoded=${menu.encoded}&encodedTitle=${encodeData(menu.title)}`}
        />
      ))}

      {/* Add a button to create a new menu */}
      <div className="create-menu">
        <Link to="/menu">
          <button>Create New Menu</button>
        </Link>
      </div>
    </div>
  );
};
