import "./SharePane.css";

/**
 * Configuragle component representing the sharing of a single line of text.
 *
 * This is used to share urls for relationship menus as well as the raw encoded menu data slug itself.
 *
 * @param value - The value to be displayed in the share input.
 * @param description - The description to be displayed below the title.
 * @param title - The title to be displayed at the top of the share pane.
 * @returns The SharePane component.
 */
export const SharePane = ({
  value,
  description,
  title,
}: {
  value: string;
  description?: string;
  title?: string;
}) => {
  return (
    <div className="share-pane">
      {title && <h3 className="title">{title}</h3>}
      {description && <p className="description">{description}</p>}
      <div className="share-input-container">
        <input type="text" value={value} readOnly className="share-input" />
        <button
          className="share-button"
          onClick={() => navigator.clipboard.writeText(value)}
        >
          Copy
        </button>
      </div>
    </div>
  );
};
