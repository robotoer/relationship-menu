/**
 * Page that displays a single relationship menu.
 */

import { MenuGroup } from "../components/MenuGroup";
import { MenuItem } from "../components/MenuItem";
import { RelationshipMenu, RelationshipMenuItemValue } from "../model/menu";

export const MenuPage = ({
  menu,
  onChange,
}: {
  menu: RelationshipMenu;
  onChange: (group: string, itemIndex: number, value?: RelationshipMenuItemValue) => void;
}) => {
  return (
    // <div className="menu-page">
    <>
      {Object.keys(menu).map((group, groupIndex) => (
        <MenuGroup key={groupIndex} title={group}>
          {menu[group].map((item, itemIndex) => (
            <MenuItem
              key={itemIndex}
              item={item.item}
              value={item.value}
              onChange={(value) => onChange(group, itemIndex, value)}
            />
          ))}
        </MenuGroup>
      ))}
    </>
    // </div>
  );
};
