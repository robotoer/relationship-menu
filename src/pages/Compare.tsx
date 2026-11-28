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
  COMPARE_VALUE_GLYPHS,
  COMPARE_VALUE_LABELS,
  MenuItemCompare,
} from "../components/MenuItemCompare";
import { MenuComparison } from "../model/compare";
import { CompareSection, type LibraryMenu } from "../components/CompareSection";
import { ReactNode, useMemo, useState } from "react";
import {
  FOCUS_FILTERS,
  FocusFilter,
  matchesFocusFilter,
} from "../compare-focus";
import {
  byDifferenceBands,
  compareInsights,
  flattenComparison,
  matchesQuery,
} from "../compare-insights";
import { buildAgenda } from "../discussion";
import { CompareOverview } from "../components/CompareOverview";
import { platform } from "../platform";

type CompareSort = "menu" | "difference";

/**
 * A key explaining what each color and symbol in the comparison grid means.
 */
const CompareColorKey = () => (
  <ul className="compare-key" aria-label="Color key">
    {Object.entries(COMPARE_VALUE_LABELS).map(([className, label]) => (
      <li key={className}>
        <span className={`compare-key-swatch ${className}`} aria-hidden="true">
          {COMPARE_VALUE_GLYPHS[className]}
        </span>
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
  saveControls,
  library,
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
  /** Saving and sharing this comparison as a conversation (spec CV-1). */
  saveControls?: ReactNode;
  /** Menus saved in this browser, offered in "+ Add a menu" (SV-19). */
  library?: LibraryMenu[];
}) => {
  const columnTitles = (legendTitles ?? titles).map(
    (title, index) => title || `Menu ${index + 1}`,
  );
  // While the builder is open the page is about choosing menus; once Compare is
  // pressed it collapses to a summary line and the page belongs to the results.
  const [editing, setEditing] = useState(!showComparison);
  const [filter, setFilter] = useState<FocusFilter>("all");
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [sort, setSort] = useState<CompareSort>("menu");
  const insights = useMemo(
    () => compareInsights(comparison, columnTitles.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comparison, columnTitles.length],
  );
  const topicCount = useMemo(
    () => buildAgenda(comparison).length,
    [comparison],
  );
  const groupNames = Object.keys(comparison);
  // Filter, search and group selection, then either menu order (grouped) or one
  // list sorted by difference.
  const shown = useMemo(
    () =>
      flattenComparison(comparison).filter(
        (item) =>
          matchesFocusFilter(item, filter) &&
          matchesQuery(item, query) &&
          (!groupFilter || item.group === groupFilter),
      ),
    [comparison, filter, query, groupFilter],
  );
  const groups: [string, typeof shown][] = useMemo(() => {
    if (sort === "difference")
      return byDifferenceBands(shown).map(({ band, items }) => [
        band.label,
        items,
      ]);
    const byGroup = new Map<string, typeof shown>();
    for (const item of shown)
      byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), item]);
    return Array.from(byGroup.entries());
  }, [shown, sort]);
  const narrowed =
    filter !== "all" || query.trim() !== "" || groupFilter !== "";
  const hasItems = insights.total > 0;
  const counts: Record<FocusFilter, number> = {
    all: insights.total,
    ...insights.zones,
    notes: insights.withNotes,
  };
  const chooseFilter = (id: FocusFilter) => {
    if (id !== filter) track("compare_filter_used", { filter: id });
    setFilter(id);
  };
  const chooseSort = (next: CompareSort) => {
    if (next !== sort) track("compare_sorted", { sort: next });
    setSort(next);
  };
  const toItems = () =>
    document
      .getElementById("compare-items")
      ?.scrollIntoView?.({ behavior: "smooth" });
  return (
    <div className="compare-page">
      <header className="compare-header">
        <h1>Compare menus</h1>
        {!showComparison && (
          <p>
            See where two or more menus agree, where they differ, and what is worth talking
            about. Nothing is uploaded.
          </p>
        )}
      </header>
      <CompareSection
        titles={titles}
        menus={encoded}
        errors={errors}
        onChange={onChangeCompared}
        onCompare={() => {
          setEditing(false);
          onCompare();
        }}
        canCompare={
          canCompare ?? encoded.filter((e) => e.trim().length > 0).length >= 2
        }
        library={library}
        collapsed={showComparison && !editing}
        onEdit={() => setEditing(true)}
      />
      {showComparison && (
        <>
          {hasItems && (
            <CompareOverview
              insights={insights}
              names={columnTitles}
              onFilter={(zone) => {
                chooseFilter(zone);
                toItems();
              }}
              onGroup={(group) => {
                setFilter("all");
                setGroupFilter(group);
                toItems();
              }}
              onShowFocus={() => {
                setFilter("all");
                setGroupFilter("");
                setQuery("");
                chooseSort("difference");
                toItems();
              }}
              discussLink={discussLink}
              topicCount={topicCount}
              actions={saveControls}
            />
          )}
          {!hasItems && (
            <p className="compare-empty">
              These menus don't have any items yet.
            </p>
          )}
          {hasItems && (
            <section
              className="compare-items"
              aria-labelledby="compare-items-title"
            >
              <h2 id="compare-items-title" className="compare-items-title">
                Item by item
              </h2>
              <div
                className="compare-filters"
                role="group"
                aria-label="Show items"
              >
                {FOCUS_FILTERS.map(({ id, label, description }) => (
                  <button
                    key={id}
                    type="button"
                    className={`compare-filter compare-filter-${id}`}
                    aria-pressed={filter === id}
                    title={description}
                    onClick={() => chooseFilter(id)}
                  >
                    {label}{" "}
                    <span className="compare-filter-count">{counts[id]}</span>
                  </button>
                ))}
              </div>
              <div className="compare-toolbar" id="compare-items">
                <label>
                  <span>Search</span>
                  <input
                    type="search"
                    value={query}
                    placeholder="Item, group or note"
                    onChange={(e) => {
                      if (e.target.value.trim() && !query.trim())
                        track("compare_searched");
                      setQuery(e.target.value);
                    }}
                  />
                </label>
                {groupNames.length > 1 && (
                  <label>
                    <span>Group</span>
                    <select
                      value={groupFilter}
                      onChange={(e) => setGroupFilter(e.target.value)}
                    >
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
                    onChange={(e) => chooseSort(e.target.value as CompareSort)}
                  >
                    <option value="menu">Menu order</option>
                    <option value="difference">
                      Biggest differences first
                    </option>
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
              {filter !== "all" && groups.length > 0 && (
                <p className="compare-filter-description">
                  {FOCUS_FILTERS.find((f) => f.id === filter)?.description}.
                </p>
              )}
              <CompareColorKey />
              {groups.length === 0 && (
                <p className="compare-empty">
                  Nothing matches. Try another filter or search.
                </p>
              )}
            </section>
          )}
          {sort === "difference" ? (
            // Not groups: bands of how far apart the answers are, each a grid of
            // tiles that fills the width, in rank order (CP-25).
            <div className="compare-page-grid is-ranked">
              {groups.length > 0 && (
                <p className="compare-ranked-key">
                  Squares, left to right: {columnTitles.join(", ")}. Each item
                  shows its group.
                </p>
              )}
              {byDifferenceBands(shown).map(({ band, items }) => (
                <section
                  key={band.id}
                  className={`compare-band band-${band.id}`}
                  aria-labelledby={`compare-band-${band.id}`}
                >
                  <h2 id={`compare-band-${band.id}`}>
                    {band.label}{" "}
                    <span className="compare-band-count">{items.length}</span>
                  </h2>
                  <p className="compare-band-description">
                    {band.description}.
                  </p>
                  <ol className="compare-band-items">
                    {items.map((item, i) => (
                      <li key={`${item.group}\u0000${item.item}\u0000${i}`}>
                        <MenuItemCompare
                          item={item.item}
                          group={item.group}
                          menuItems={item.values}
                          titles={columnTitles}
                          notes={item.notes}
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          ) : (
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
          )}
          {platform().support && (
            <p className="support-nudge">
              Did this help you two talk?{" "}
              <Link to="/support" state={{ supportFrom: "compare" }}>
                Support Wants &amp; Won'ts
              </Link>{" "}
              to keep it free and private.
            </p>
          )}
        </>
      )}
    </div>
  );
};
