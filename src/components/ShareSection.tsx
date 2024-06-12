/**
 * The share section component provides 4 share panes in a horizontal row (flexbox) for a single relationship menu:
 * - URL to relationship menu containing preferences
 * - Encoded data slug for relationship menu containing preferences
 * - URL to relationship menu as a template (without any preferences)
 * - Encoded data slug for relationship menu as a template (without any preferences)
 */

import { SharePane } from "./SharePane";
import "./ShareSection.css";

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
    <div className="share-section">
      <SharePane
        value={menuUrl}
        description="Share Menu Link"
      />
      <SharePane
        value={menuEncoded}
        description="Share Menu Slug"
      />
      <SharePane
        value={templateUrl}
        description="Share Template Link"
      />
      <SharePane
        value={templateEncoded}
        description="Share Template Slug"
      />
    </div>
  );
};
