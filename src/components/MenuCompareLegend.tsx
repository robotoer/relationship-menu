import "./MenuCompareLegend.css";

/**
 * Component that displays a legend with the colors used to represent different preferences for
 * a specific relationship menu item.
 *
 * @component
 * @param {Object} props - The component props.
 * @param {string[]} props.titles - The titles to be displayed in the legend.
 * @returns {JSX.Element} The rendered MenuCompareLegend component.
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
        <div className="legend-title-outer" key={index}>
          <div className="legend-title">
            {title}
          </div>
        </div>
      ))}
    </div>
  );
};
