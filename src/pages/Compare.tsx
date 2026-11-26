/**
 * Displays a comparison of multiple relationship menus.
 */

import "./Compare.css";
import "../components/MenuItemCompare.css";
import { track } from "../analytics";
import { Link } from "react-router-dom";
import { MenuCompareLegend } from "../components/MenuCompareLegend";
import { MenuGroup } from "../components/MenuGroup";
import {
  COMPARE_VALUE_LABELS,
  MenuItemCompare,
} from "../components/MenuItemCompare";
import { MenuComparison } from "../model/compare";
import { CompareSection } from "../components/CompareSection";
import { useMemo, useState } from "react";
import { COMPARE_FILTERS, CompareFilter, matchesFilter } from "../compare-filters";
import { byDifference, compareInsights, flattenComparison, matchesQuery } from "../compare-insights";
import { buildAgenda } from "../discussion";
import { CompareOverview } from "../components/CompareOverview";
import { platform } from "../platform";

type CompareSort = "menu" | "difference";

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
  discussLink,
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
  /** Link to the guided discussion of these menus. */
  discussLink?: string;
}) => {
  const columnTitles = (legendTitles ?? titles).map(
    (title, index) => title || `Menu ${index + 1}`
  );
  const [filter, setFilter] = useState<CompareFilter>("all");
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [sort, setSort] = useState<CompareSort>("menu");
  const insights = useMemo(
    () => compareInsights(comparison, columnTitles.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comparison, columnTitles.length]
  );
  const topicCount = useMemo(() => buildAgenda(comparison).length, [comparison]);
  const counts = insights.counts;
  const groupNames = Object.keys(comparison);
  // Filter, search and group selection, then either menu order (grouped) or one
  // list sorted by difference.
  const shown = useMemo(
    () =>
      flattenComparison(comparison).filter(
        (item) =>
          matchesFilter(item, filter) &&
          matchesQuery(item, query) &&
          (!groupFilter || item.group === groupFilter)
      ),
    [comparison, filter, query, groupFilter]
  );
  const groups: [string, typeof shown][] = useMemo(() => {
    if (sort === "difference") return shown.length ? [["Biggest differences first", byDifference(shown)]] : [];
    const byGroup = new Map<string, typeof shown>();
    for (const item of shown) byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), item]);
    return Array.from(byGroup.entries());
  }, [shown, sort]);
  const narrowed = filter !== "all" || query.trim() !== "" || groupFilter !== "";
  const hasItems = counts.all > 0;
  const chooseFilter = (id: CompareFilter) => {
    if (id !== filter) track("compare_filter_used", { filter: id });
    setFilter(id);
  };
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
          {hasItems && (
            <CompareOverview
              insights={insights}
              names={columnTitles}
              onFilter={(id) => {
                chooseFilter(id);
                document.getElementById("compare-items")?.scrollIntoView?.({ behavior: "smooth" });
              }}
              discussLink={discussLink}
              topicCount={topicCount}
            />
          )}
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
                  onClick={() => chooseFilter(id)}
                >
                  {label} <span className="compare-filter-count">{counts[id]}</span>
                </button>
              ))}
            </div>
          )}
          {!hasItems && (
            <p className="compare-empty">These menus don't have any items yet.</p>
          )}
          {hasItems && (
            <div className="compare-toolbar" id="compare-items">
              <label>
                <span>Search</span>
                <input
                  type="search"
                  value={query}
                  placeholder="Item, group or note"
                  onChange={(e) => {
                    if (e.target.value.trim() && !query.trim()) track("compare_searched");
                    setQuery(e.target.value);
                  }}
                />
              </label>
              {groupNames.length > 1 && (
                <label>
                  <span>Group</span>
                  <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                    <option value="">All groups</option>
                    {groupNames.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span>Order</span>
                <select
                  value={sort}
                  onChange={(e) => {
                    const next = e.target.value as CompareSort;
                    if (next !== sort) track("compare_sorted", { sort: next });
                    setSort(next);
                  }}
                >
                  <option value="menu">Menu order</option>
                  <option value="difference">Biggest differences first</option>
                </select>
              </label>
              {narrowed && (
                <button
                  type="button"
                  className="compare-clear"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                    setGroupFilter("");
                  }}
                >
                  Show everything
                </button>
              )}
            </div>
          )}
          {hasItems && groups.length === 0 && (
            <p className="compare-empty">Nothing matches. Try another filter or search.</p>
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
                    group={sort === "difference" ? item.group : undefined}
                    menuItems={item.values}
                    titles={columnTitles}
                    notes={item.notes}
                  />
                ))}
              </MenuGroup>
            ))}
          </div>
          {platform().support && (
          <p className="support-nudge">
            Did this help you two talk?{" "}
            <Link to="/support" state={{ supportFrom: "compare" }}>
              Support Relationship Menu
            </Link>{" "}
            to keep it free and private.
          </p>
          )}
        </>
      )}
    </div>
  );
};
