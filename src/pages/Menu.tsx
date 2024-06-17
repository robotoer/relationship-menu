/**
 * Page that displays a single relationship menu.
 */

import "./Menu.css";
import { MenuGroup } from "../components/MenuGroup";
import { MenuItem } from "../components/MenuItem";
import { RelationshipMenu, RelationshipMenuItemValue } from "../model/menu";
import { ShareSection } from "../components/ShareSection";

export const MenuPage = ({
  menu,
  onChange,
}: {
  menu: RelationshipMenu;
  onChange: (
    group: string,
    itemIndex: number,
    value?: RelationshipMenuItemValue
  ) => void;
}) => {
  return (
    <>
      <ShareSection
        menuEncoded="TEMP"
        menuUrl="TEMP"
        templateEncoded="TEMP"
        templateUrl="TEMP"
      />
      <div className="menu-page">
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
            {/* Adding new relationship menu items */}
            <MenuItem
              item="New item"
              value={undefined}
              onChange={(value) => onChange(group, menu[group].length, value)}
            />
          </MenuGroup>
        ))}
        {/* Adding new relationship menu groups */}
        <MenuGroup title="Add new group">
          <MenuItem
            item="New group"
            value={undefined}
            onChange={(value) => onChange("New group", 0, value)}
          />
        </MenuGroup>
      </div>
    </>
  );
};
