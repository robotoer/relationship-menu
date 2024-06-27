/**
 * Displays a comparison of multiple relationship menus.
 */

import "./Compare.css";
import { MenuCompareLegend } from "../components/MenuCompareLegend";
import { MenuGroup } from "../components/MenuGroup";
import { MenuItemCompare } from "../components/MenuItemCompare";
import { MenuComparison } from "../model/compare";
import { useSearchParams } from "react-router-dom";
import { useMemo } from "react";
import { decodeData } from "../data-encoder";
import { RelationshipMenu } from "../model/menu";
import { CompareSection } from "../components/CompareSection";

export const ComparePage = ({
  titles,
  comparison,
}: {
  titles: string[];
  comparison: MenuComparison;
}) => {
  // Read query parameters from react-router-dom:
  const [params, setParams] = useSearchParams();
  // Decode the menu data from the query parameters:
  const decoded: RelationshipMenu[] = useMemo(
    () => params.getAll("encoded").map(decodeData),
    [params]
  );

  return (
    <div className="compare-page">
      <CompareSection
        menus={[...decoded.map((menu) => JSON.stringify(menu)), ""]}
        onChange={(menus) => {
          setParams({
            encoded: menus
              .map((menu) => (menu ? encodeURI(JSON.stringify(menu)) : ""))
              .filter((x) => !!x),
          });
        }}
      />
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
  );
};
