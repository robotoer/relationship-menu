import "./MenuCompareLegend.css";

/**
 * Component that displays a legend with the colors used to represent different preferences for
 * a specific relationship menu item.
 */

export const MenuCompareLegend = ({ titles }: { titles: string[] }) => {
  return (
    <div className="menu-compare-legend">
      {titles.map((title, index) => (
        <div className="legend-title-outer">
          <div key={index} className="legend-title">
            {title}
          </div>
        </div>
      ))}
    </div>
  );
};
