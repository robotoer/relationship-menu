import { SharePane } from "./SharePane";
import "./ShareSection.css";

/**
 * Renders the ShareSection component.
 * 
 * The share section component provides 4 share panes in a horizontal row (flexbox) for a single relationship menu:
 * 
 * - URL to relationship menu containing preferences
 * - Encoded data slug for relationship menu containing preferences
 * - URL to relationship menu as a template (without any preferences)
 * - Encoded data slug for relationship menu as a template (without any preferences)
 *
 * @component
 * @param {Object} props - The component props.
 * @param {string} props.menuUrl - The URL for sharing the menu.
 * @param {string} props.menuEncoded - The encoded slug for sharing the menu.
 * @param {string} props.templateUrl - The URL for sharing the template.
 * @param {string} props.templateEncoded - The encoded slug for sharing the template.
 * @returns {JSX.Element} The rendered ShareSection component.
 */
export const ShareSection = ({
  menuUrl,
  menuEncoded,
  templateUrl,
  templateEncoded,
}: {
  menuUrl: string;
  menuEncoded: string;
  templateUrl: string;
  templateEncoded: string;
}) => {
  return (
    <section className="share-section" aria-label="Share this menu">
      <SharePane
        value={menuUrl}
        title="Menu link"
        description="With your answers. Send it only to people you're comparing with."
      />
      <SharePane
        value={menuEncoded}
        title="Menu slug"
        description="Same as the menu link, without the website address. Paste into Compare."
      />
      <SharePane
        value={templateUrl}
        title="Template link"
        description="Your items with no answers, so someone can fill them in fresh."
      />
      <SharePane
        value={templateEncoded}
        title="Template slug"
        description="The template without the website address."
      />
    </section>
  );
};
