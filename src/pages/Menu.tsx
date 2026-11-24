/**
 * Page that displays a single relationship menu.
 */

import "./Menu.css";
import { Fragment, useEffect, useRef, useState } from "react";
import { MenuGroup } from "../components/MenuGroup";
import { MenuItem } from "../components/MenuItem";
import { RelationshipMenu } from "../model/menu";
import { MenuChange } from "../menu-editing";
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

/**
 * Input for a group's name.
 *
 * Keeps a local draft so a name that is already used by another group can be shown
 * (with a warning) without being applied: groups are keyed by name, so applying it
 * would overwrite the other group.
 *
 * @param value - The group's current name ("" for the "new group" input).
 * @param takenNames - Names used by other groups.
 * @param isNew - Whether this is the trailing "new group" input (an empty name is not committed).
 * @param onCommit - Called with the new name once it is valid.
 */
const GroupTitle = ({
  id,
  value,
  takenNames,
  isNew = false,
  onCommit,
}: {
  id?: string;
  value: string;
  takenNames: string[];
  isNew?: boolean;
  onCommit: (name: string) => void;
}) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const taken = draft !== value && takenNames.includes(draft);
  return (
    <>
      <input
        id={id}
        className="new-group-title"
        placeholder="New group"
        value={draft}
        aria-invalid={taken || undefined}
        aria-describedby={taken && id ? `${id}-error` : undefined}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (next === value || takenNames.includes(next)) return;
          if (isNew && next === "") return;
          onCommit(next);
        }}
      />
      {taken && (
        <span id={id ? `${id}-error` : undefined} className="group-title-error">
          A group with this name already exists
        </span>
      )}
    </>
  );
};

/** Counter for keys of the trailing "new item" row, which become the new item's id. */
let nextPendingItemId = 0;

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
  onChange: (change: MenuChange) => void;
  onChangeTitle: (title: string) => void;
}) => {
  const groupNames = Object.keys(menu);
  // Key (and future id) of each group's "new item" row, by group name.
  const pendingItemIds = useRef<{ [group: string]: string }>({});
  const pendingItemIdFor = (group: string) =>
    (pendingItemIds.current[group] ??= `new_${++nextPendingItemId}`);
  return (
    <>
      <div className="menu-title-container">
        <MenuTitle
          value={title}
          placeholder="Menu title"
          onChange={(e) => onChangeTitle(e.target.value)}
        />
        <Link
          to={`/compare?encoded=${encodeURIComponent(menuEncoded)}`}
          className="menu-compare"
        >
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
        {/*
          The trailing "new group" and "new item" rows are rendered in the same keyed
          lists as the existing rows. When one of them receives text it becomes a real
          group/item with the same key, so React keeps the same input element and the
          user keeps typing into it, with no focus hand-off that fast typing can outrun.
        */}
        {[...groupNames, null].map((group, groupIndex) => {
          const inputId = `menu-group-input-${groupIndex}`;
          if (group === null) {
            return (
              <MenuGroup
                key={groupIndex}
                title={
                  <GroupTitle
                    id={inputId}
                    value=""
                    isNew
                    takenNames={groupNames}
                    onCommit={(newGroup) => onChange({ kind: "group", newGroup })}
                  />
                }
              >
                Enter a new group title to add a new group.
              </MenuGroup>
            );
          }
          const items = menu[group];
          const pendingId = pendingItemIdFor(group);
          const rows = [
            ...items.map((item, itemIndex) => ({
              key: item.id || `index-${itemIndex}`,
              item,
              itemIndex,
            })),
            { key: pendingId, item: null, itemIndex: items.length },
          ];
          return (
            <MenuGroup
              key={groupIndex}
              title={
                <GroupTitle
                  id={inputId}
                  value={group}
                  takenNames={groupNames.filter((name) => name !== group)}
                  onCommit={(newGroup) =>
                    onChange({ kind: "group", oldGroup: group, newGroup })
                  }
                />
              }
              onDelete={() => onChange({ kind: "group", oldGroup: group })}
              deleteAriaLabel={`Delete group: ${group}`}
            >
              {rows.map(({ key, item, itemIndex }) => (
                <Fragment key={key}>
                  {item === null && <div className="menu-divider" />}
                  <MenuItem
                    id={item ? `menu-item-input-${groupIndex}-${key}` : undefined}
                    item={item ? item.item : ""}
                    value={item ? item.value : undefined}
                    onChange={(value) => {
                      if (item) {
                        onChange({ kind: "item", group, itemIndex, value });
                        return;
                      }
                      // Adding: the new item takes this row's key as its id.
                      delete pendingItemIds.current[group];
                      onChange({
                        kind: "item",
                        group,
                        itemIndex,
                        value: { ...value, id: pendingId },
                      });
                    }}
                    onDelete={
                      item
                        ? () => onChange({ kind: "item", group, itemIndex })
                        : undefined
                    }
                  />
                </Fragment>
              ))}
            </MenuGroup>
          );
        })}
      </div>
    </>
  );
};
