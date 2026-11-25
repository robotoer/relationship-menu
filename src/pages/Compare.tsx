/**
 * Displays a comparison of multiple relationship menus.
 */

import "./Compare.css";
import "../components/MenuItemCompare.css";
import { MenuCompareLegend } from "../components/MenuCompareLegend";
import { MenuGroup } from "../components/MenuGroup";
import {
  COMPARE_VALUE_LABELS,
  MenuItemCompare,
} from "../components/MenuItemCompare";
import { MenuComparison } from "../model/compare";
import { CompareSection } from "../components/CompareSection";
import { useMemo, useState } from "react";
import {
  COMPARE_FILTERS,
  CompareFilter,
  countByFilter,
  filterComparison,
} from "../compare-filters";

/**
 * A key explaining what each color in the comparison grid means.
 */
const CompareColorKey = () => (
  <ul className="compare-key" aria-label="Color key">
    {Object.entries(COMPARE_VALUE_LABELS).map(([className, label]) => (
      <li key={className}>
        <span className={`compare-key-swatch ${className}`} aria-hidden="true" />
        {label}
      </li>
    ))}
  </ul>
);

/**
 * Renders the ComparePage component.
 *
 * @param titles - The title for each entry in `encoded` ("" when unknown), used to label inputs.
 * @param encoded - The menu slugs entered by the user, in input order.
 * @param errors - Optional validation error for each entry in `encoded`.
 * @param legendTitles - Titles of the menus in the comparison (one per column). Defaults to `titles`.
 * @param comparison - An object representing the menu comparison.
 * @param showComparison - Whether to show the comparison grid.
 * @param canCompare - Whether the Compare button is enabled. Defaults to "2+ non-empty entries".
 * @param onChangeCompared - A function that is called when the compared menus change.
 * @param onCompare - A function that is called when the Compare button is clicked.
 */
export const ComparePage = ({
  titles,
  encoded,
  errors,
  legendTitles,
  comparison,
  showComparison,
  canCompare,
  onChangeCompared,
  onCompare,
}: {
  titles: string[];
  encoded: string[];
  errors?: (string | undefined)[];
  legendTitles?: string[];
  comparison: MenuComparison;
  showComparison: boolean;
  canCompare?: boolean;
  onChangeCompared: (encoded: string[]) => void;
  onCompare: () => void;
}) => {
  const columnTitles = (legendTitles ?? titles).map(
    (title, index) => title || `Menu ${index + 1}`
  );
  const [filter, setFilter] = useState<CompareFilter>("all");
  const counts = useMemo(() => countByFilter(comparison), [comparison]);
  const groups = Object.entries(
    useMemo(() => filterComparison(comparison, filter), [comparison, filter])
  );
  const hasItems = counts.all > 0;
  return (
    <div className="compare-page">
      <h1 className="sr-only">Compare menus</h1>
      <CompareSection
        titles={titles}
        menus={encoded}
        errors={errors}
        onChange={onChangeCompared}
        onCompare={onCompare}
        canCompare={
          canCompare ??
          encoded.filter((e) => e.trim().length > 0).length >= 2
        }
      />
      {showComparison && (
        <>
          <CompareColorKey />
          {hasItems && (
            <div className="compare-filters" role="group" aria-label="Show items">
              {COMPARE_FILTERS.map(({ id, label, description }) => (
                <button
                  key={id}
                  type="button"
                  className={`compare-filter compare-filter-${id}`}
                  aria-pressed={filter === id}
                  title={description}
                  onClick={() => setFilter(id)}
                >
                  {label} <span className="compare-filter-count">{counts[id]}</span>
                </button>
              ))}
            </div>
          )}
          {!hasItems && (
            <p className="compare-empty">These menus don't have any items yet.</p>
          )}
          {hasItems && groups.length === 0 && (
            <p className="compare-empty">
              Nothing here: no items are "
              {COMPARE_FILTERS.find((f) => f.id === filter)?.label}".
            </p>
          )}
          {hasItems && filter !== "all" && groups.length > 0 && (
            <p className="compare-filter-description">
              {COMPARE_FILTERS.find((f) => f.id === filter)?.description}.
            </p>
          )}
          <div className="compare-page-grid">
            {groups.map(([title, group], index) => (
              <MenuGroup key={index} title={<h2>{title}</h2>}>
                <MenuCompareLegend titles={columnTitles} />
                {group.map((item, itemIndex) => (
                  <MenuItemCompare
                    key={itemIndex}
                    item={item.item}
                    menuItems={item.values}
                    titles={columnTitles}
                    notes={item.notes}
                  />
                ))}
              </MenuGroup>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
