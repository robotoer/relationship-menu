/**
 * Page that displays a single relationship menu.
 */

import "./Menu.css";
import { MenuGroup } from "../components/MenuGroup";
import { MenuItem } from "../components/MenuItem";
import { RelationshipMenu, RelationshipMenuItem } from "../model/menu";
import { ShareSection } from "../components/ShareSection";
import { Link } from "react-router-dom";

/**
 * Renders an input element for the menu title.
 *
 * @component
 * @param {React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement>} props - The input element props.
 * @param {string} props.className - The class name for the input element.
 * @param {string} props.placeholder - The placeholder text for the input element.
 * @param {React.InputHTMLAttributes<HTMLInputElement>} props.params - Additional parameters for the input element.
 * @returns {JSX.Element} The rendered input element.
 */
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

/**
 * Represents the menu page component.
 *
 * @param title - The title of the menu.
 * @param menu - The relationship menu.
 * @param menuEncoded - The encoded string representation of the menu.
 * @param templateEncoded - The encoded string representation of the template.
 * @param onChange - The callback function for handling menu changes.
 * @param onChangeTitle - The callback function for handling title changes.
 * @returns The rendered menu page component.
 */
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
      <div className="menu-title-container">
        <MenuTitle
          value={title}
          placeholder="Menu title"
          onChange={(e) => onChangeTitle(e.target.value)}
        />
        <Link to={`/compare?encoded=${menuEncoded}`} className="menu-compare">
          Compare
        </Link>
      </div>
      <ShareSection
        menuEncoded={menuEncoded}
        menuUrl={`${window.location.protocol}//${window.location.host}/menu?encoded=${encodeURIComponent(menuEncoded)}`}
        templateEncoded={templateEncoded}
        templateUrl={`${window.location.protocol}//${window.location.host}/menu?encoded=${encodeURIComponent(templateEncoded)}`}
      />
      <div className="menu-page">
        {Object.keys(menu).map((group, groupIndex) => {
          const groupEncoded = btoa(group || "").replace(/=/g, "");
          return (
            <MenuGroup
              key={groupIndex}
              title={
                <GroupTitle
                  id={`menu-group-input-${groupEncoded}`}
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
                  id={`menu-item-input-${groupEncoded}-${itemIndex}`}
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
                onChange={(value) => {
                  (async () => {
                    onChange({
                      kind: "item",
                      group,
                      itemIndex: menu[group].length,
                      value,
                    });

                    await new Promise((resolve) => setTimeout(resolve, 0));

                    const query = `#menu-item-input-${groupEncoded}-${menu[group].length - 1}`;
                    // Focus on the new item input field after adding a new item:
                    const newItemInput = document.querySelector(
                      query
                    ) as HTMLInputElement;
                    if (newItemInput) {
                      newItemInput.focus();
                    } else {
                      console.error(
                        `Could not find new item input field to focus on: ${query}`
                      );
                    }
                  })();
                }}
              />
            </MenuGroup>
          );
        })}

        {/* Adding new relationship menu groups */}
        <MenuGroup
          title={
            <GroupTitle
              onChange={(e) => {
                (async () => {
                  const newGroup = e.target.value;
                  onChange({ kind: "group", newGroup });
                  // Clear the input field after adding a new group:
                  e.target.value = "";

                  await new Promise((resolve) => setTimeout(resolve, 0));

                  const query = `#menu-group-input-${btoa(
                    newGroup || ""
                  ).replace(/=/g, "")}`;
                  // Focus on the new group input field after adding a new group:
                  const newGroupInput = document.querySelector(
                    query
                  ) as HTMLInputElement;
                  if (newGroupInput) {
                    newGroupInput.focus();
                  } else {
                    console.error(
                      `Could not find new group input field to focus on: ${query}`
                    );
                  }
                })();
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
