/**
 * Displays a comparison of multiple relationship menus.
 */

import "./Compare.css";
import { MenuCompareLegend } from "../components/MenuCompareLegend";
import { MenuGroup } from "../components/MenuGroup";
import { MenuItemCompare } from "../components/MenuItemCompare";
import { MenuComparison } from "../model/compare";

export const ComparePage = ({
  titles,
  comparison,
}: {
  titles: string[];
  comparison: MenuComparison;
}) => {
  return (
    <div className="compare-page">
      {Object.entries(comparison).map(
        ([title, group], index) => (
          <MenuGroup key={index} title={title}>
            <MenuCompareLegend titles={titles} />
            {group.map((item, itemIndex) => (
              <MenuItemCompare
                key={itemIndex}
                item={item.item}
                menuItems={item.values}
              />
            ))}
          </MenuGroup>
        )
      )}
    </div>
  );
};
