/**
 * Page that displays a single relationship menu.
 */

import "./Menu.css";
import { MenuGroup } from "../components/MenuGroup";
import { MenuItem } from "../components/MenuItem";
import { RelationshipMenu, RelationshipMenuItem } from "../model/menu";
import { ShareSection } from "../components/ShareSection";
import { useMemo } from "react";
import { encodeData } from "../data-encoder";

const GroupTitle = ({
  className,
  placeholder,
  ...params
}: React.DetailedHTMLProps<
  React.InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
>) => (
  <input
    className={className ? `new-group-title ${className}` : "new-group-title"}
    placeholder={placeholder || "New group"}
    {...params}
  />
);

export const MenuPage = ({
  menu,
  onChange,
}: {
  menu: RelationshipMenu;
  onChange: (
    change:
      | {
          kind: "item";
          group: string;
          itemIndex: number;
          value?: Partial<RelationshipMenuItem>;
        }
      | { kind: "group"; oldGroup?: string; newGroup?: string }
  ) => void;
}) => {
  const menuEncoded = useMemo(() => encodeData(menu), [menu]);
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
    <>
      <ShareSection
        menuEncoded={menuEncoded}
        menuUrl={`https://example.com/${menuEncoded}`}
        templateEncoded={templateEncoded}
        templateUrl={`https://example.com/${templateEncoded}`}
      />
      <div className="menu-page">
        {Object.keys(menu).map((group, groupIndex) => (
          <MenuGroup
            key={groupIndex}
            title={
              <GroupTitle
                value={group}
                onChange={(e) =>
                  onChange({
                    kind: "group",
                    oldGroup: group,
                    newGroup: e.target.value,
                  })
                }
              />
            }
          >
            {menu[group].map((item, itemIndex) => (
              <MenuItem
                key={itemIndex}
                item={item.item}
                value={item.value}
                onChange={(value) =>
                  onChange({ kind: "item", group, itemIndex, value })
                }
              />
            ))}

            {/* Divider */}
            <div className="menu-divider" />

            {/* Adding new relationship menu items */}
            <MenuItem
              item=""
              value={undefined}
              onChange={(value) =>
                onChange({
                  kind: "item",
                  group,
                  itemIndex: menu[group].length,
                  value,
                })
              }
            />
          </MenuGroup>
        ))}

        {/* Adding new relationship menu groups */}
        <MenuGroup
          title={
            <GroupTitle
              onChange={(e) => {
                onChange({ kind: "group", newGroup: e.target.value });
                // Clear the input field after adding a new group:
                e.target.value = "";
              }}
            />
          }
        >
          Enter a new group title to add a new group.
        </MenuGroup>
      </div>
    </>
  );
};
