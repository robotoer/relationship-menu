import "./Library.css";

/**
 * Page that displays a grid of relationship menus available to the current user.
 */

import { MenuTile } from "../components/MenuTile";
import { RelationshipMenuDocument } from "../model/menu";

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
          link={`/menu/${menu.encoded}`}
        />
      ))}

      {/* Add a button to create a new menu */}
      <div className="create-menu">
        <button>Create New Menu</button>
      </div>
    </div>
  );
};
