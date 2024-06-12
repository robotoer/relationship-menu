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
        <MenuTile key={menu.encoded} title={menu.title} image={menu.image} link={`/menu/${menu.encoded}`} />
      ))}
    </div>
  );
};
