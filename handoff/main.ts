/**
 * Entry point of the hand-off page, the only thing the old address serves now
 * (spec HO-3…HO-8). No app, no analytics: it brings this browser's saved menus
 * over to the new address, then opens the page that was asked for there. The
 * logic is in src/handoff/.
 */

import { NEW_ORIGIN } from "../src/handoff/origins";
import { fallbackUrl, runHandoff } from "../src/handoff/send";

let gone = false;
const go = (url: string) => {
  if (gone) return;
  gone = true;
  window.location.replace(url);
};

const fallback = fallbackUrl(window.location, NEW_ORIGIN);
const link = document.getElementById("new-address");
if (link instanceof HTMLAnchorElement) link.href = fallback;

// Never leave anyone stuck here: whatever happens, go on within a few seconds.
setTimeout(() => go(fallback), 8000);
try {
  runHandoff({
    location: window.location,
    local: window.localStorage,
    session: window.sessionStorage,
    newOrigin: NEW_ORIGIN,
  }).then(go, () => go(fallback));
} catch {
  // Storage blocked (window.localStorage throws): there's nothing to bring over.
  go(fallback);
}
