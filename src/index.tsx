import { startApp } from "./start";
import { captureImportFragment } from "./handoff/receive";

// HO-5: menus arriving from the old address are in /import's URL fragment. Take
// them out of the address bar before anything else runs.
captureImportFragment();

startApp();
