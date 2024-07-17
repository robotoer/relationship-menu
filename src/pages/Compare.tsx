/**
 * Displays a comparison of multiple relationship menus.
 */

import "./Compare.css";
import { MenuCompareLegend } from "../components/MenuCompareLegend";
import { MenuGroup } from "../components/MenuGroup";
import { MenuItemCompare } from "../components/MenuItemCompare";
import { MenuComparison } from "../model/compare";
import { CompareSection } from "../components/CompareSection";

/**
 * Renders the ComparePage component.
 *
 * @param titles - An array of strings representing the titles of the menus.
 * @param encoded - An array of strings representing the encoded menus.
 * @param comparison - An object representing the menu comparison.
 * @param onChangeCompared - A function that is called when the compared menus change.
 */
export const ComparePage = ({
  titles,
  encoded,
  comparison,
  onChangeCompared,
}: {
  titles: string[];
  encoded: string[];
  comparison: MenuComparison;
  onChangeCompared: (encoded: string[]) => void;
}) => {
  return (
    <div className="compare-page">
      <CompareSection
        titles={titles}
        menus={encoded}
        onChange={onChangeCompared}
      />
      <div className="compare-page-grid">
        {Object.entries(comparison).map(([title, group], index) => (
          <MenuGroup key={index} title={<h2>{title}</h2>}>
            <MenuCompareLegend titles={titles} />
            {group.map((item, itemIndex) => (
              <MenuItemCompare
                key={itemIndex}
                item={item.item}
                menuItems={item.values}
              />
            ))}
          </MenuGroup>
        ))}
      </div>
    </div>
  );
};
