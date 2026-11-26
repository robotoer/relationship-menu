import "./MenuCompareLegend.css";

/**
 * Column headings for the comparison grid: each person's name, written across above
 * their column (cut short with "…" if it doesn't fit; the full name is its tooltip).
 * On phones, where columns are narrower, the names are listed in column order instead.
 *
 * @param titles - The titles to be displayed in the legend.
 */
export const MenuCompareLegend = ({ titles }: { titles: string[] }) => {
  return (
    <div className="menu-compare-legend">
      <div className="legend-titles-mobile">
        {titles.map((title, index) => (
          <span key={index}>{title}</span>
        ))}
      </div>
      {titles.map((title, index) => (
        <div className="legend-title-outer" key={index} title={title}>
          <div className="legend-title">{title}</div>
        </div>
      ))}
    </div>
  );
};
