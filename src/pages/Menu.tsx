/**
 * Page that displays a single relationship menu.
 */

import "./Menu.css";
import { MenuGroup } from "../components/MenuGroup";
import { MenuItem } from "../components/MenuItem";
import { RelationshipMenu, RelationshipMenuItem } from "../model/menu";
import { ShareSection } from "../components/ShareSection";
import { Link } from "react-router-dom";
import { useLayoutEffect, useRef } from "react";

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
  // Where to move focus after the next commit, when typing into a "new item" or
  // "new group" row creates a real item/group. Focusing in a layout effect runs in
  // the same task as the keystroke that caused it; a setTimeout would let queued
  // key events (which browsers handle before timers) land in the placeholder row
  // and create extra items.
  const pendingFocus = useRef<
    { kind: "item"; groupEncoded: string } | { kind: "group"; groupEncoded: string } | null
  >(null);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) {
      return;
    }
    pendingFocus.current = null;
    const groupInput = document.getElementById(
      `menu-group-input-${target.groupEncoded}`
    ) as HTMLInputElement | null;
    if (!groupInput) {
      console.error(
        `Could not find group input field to focus on: menu-group-input-${target.groupEncoded}`
      );
      return;
    }
    if (target.kind === "group") {
      groupInput.focus();
      return;
    }
    const inputs = groupInput
      .closest(".menu-group")
      ?.querySelectorAll<HTMLInputElement>("input.menu-item-input");
    // The second-to-last input is the newly added item
    // (last one is the empty "New item" row)
    if (inputs && inputs.length >= 2) {
      inputs[inputs.length - 2].focus();
    }
  });

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
              onDelete={() =>
                onChange({ kind: "group", oldGroup: group })
              }
              deleteAriaLabel={`Delete group: ${group}`}
            >
              {menu[group].map((item, itemIndex) => (
                <MenuItem
                  id={`menu-item-input-${groupEncoded}-${item.id || itemIndex}`}
                  key={item.id || itemIndex}
                  item={item.item}
                  value={item.value}
                  onChange={(value) =>
                    onChange({ kind: "item", group, itemIndex, value })
                  }
                  onDelete={() =>
                    onChange({ kind: "item", group, itemIndex })
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
                  // Focus the newly added item once it has rendered:
                  pendingFocus.current = { kind: "item", groupEncoded };
                  onChange({
                    kind: "item",
                    group,
                    itemIndex: menu[group].length,
                    value,
                  });
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
                const newGroup = e.target.value;
                // Focus the new group's title input once it has rendered:
                pendingFocus.current = {
                  kind: "group",
                  groupEncoded: btoa(newGroup || "").replace(/=/g, ""),
                };
                onChange({ kind: "group", newGroup });
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
