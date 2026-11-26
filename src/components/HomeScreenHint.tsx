import "./HomeScreenHint.css";
import { useEffect, useState } from "react";
import { track, trackOnce } from "../analytics";
import {
  BrowserInfo,
  currentBrowser,
  dismissHomeScreenHint,
  homeScreenDevice,
  homeScreenHintDismissed,
} from "../persistence";

/**
 * A quiet tip, shown only in Safari on an iPhone or iPad (not in a Home Screen app),
 * saying that Safari may clear saved menus and how adding the site to the Home Screen
 * avoids it (spec SV-12). Dismissing it hides it for good in this browser.
 *
 * @param hasMenus - Whether menus are already saved here: they stay in Safari (the
 *   Home Screen app has storage of its own), so the tip points to the backup.
 * @param browser - For tests; defaults to the current browser.
 */
export const HomeScreenHint = ({
  hasMenus = false,
  browser,
  className,
}: {
  hasMenus?: boolean;
  browser?: BrowserInfo;
  className?: string;
}) => {
  const [device] = useState(() => homeScreenDevice(browser ?? currentBrowser()));
  const [dismissed, setDismissed] = useState(homeScreenHintDismissed);
  const shown = device !== null && !dismissed;

  useEffect(() => {
    if (shown) trackOnce("home_screen_hint_shown", "home_screen_hint_shown");
  }, [shown]);

  if (!shown) return null;
  return (
    <aside
      className={className ? `home-screen-hint ${className}` : "home-screen-hint"}
      aria-label="Tip: keep your menus"
    >
      <p>
        <strong>Keep your menus on this {device}.</strong> Safari may delete menus from
        sites you haven't opened in a week. A Home Screen app keeps them: tap Safari's
        Share button, then <em>Add to Home Screen</em>. It has its own Library, separate
        from Safari's, so make your menus there.
        {hasMenus &&
          " Menus you've already made stay in Safari: keep a copy with Export all menus in your Library."}
      </p>
      <button
        type="button"
        onClick={() => {
          dismissHomeScreenHint();
          track("home_screen_hint_dismissed");
          setDismissed(true);
        }}
        aria-label="Dismiss tip about the Home Screen"
      >
        Got it
      </button>
    </aside>
  );
};
