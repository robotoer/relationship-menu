/**
 * Page that displays a single relationship menu.
 */

import "./Menu.css";
import { MenuGroup } from "../components/MenuGroup";
import { MenuItem } from "../components/MenuItem";
import { RelationshipMenu, RelationshipMenuItem } from "../model/menu";
import { ShareSection } from "../components/ShareSection";

const MenuTitle = ({
  className,
  placeholder,
  ...params
}: React.DetailedHTMLProps<
  React.InputHTMLAttributes<HTMLInputElement>,
  HTMLInputElement
>) => (
  <input
    className={className ? `menu-title ${className}` : "menu-title"}
    placeholder={placeholder || "Menu title"}
    {...params}
  />
);

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
  title,
  menu,
  menuEncoded,
  templateEncoded,
  onChange,
  onChangeTitle,
}: {
  title: string;
  menu: RelationshipMenu;
  menuEncoded: string;
  templateEncoded: string;
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
  onChangeTitle: (title: string) => void;
}) => {
  return (
    <>
      <ShareSection
        menuEncoded={menuEncoded}
        menuUrl={`${window.location.protocol}//${window.location.host}/menu/${menuEncoded}`}
        templateEncoded={templateEncoded}
        templateUrl={`${window.location.protocol}//${window.location.host}/menu/${templateEncoded}`}
      />
      <MenuTitle
        value={title}
        placeholder="Menu title"
        onChange={(e) => onChangeTitle(e.target.value)}
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
