/**
 * The new address's side of the hand-off: /import (spec HO-4, HO-5).
 *
 * The hand-off page on the old address opens /import with menus in the URL
 * fragment. The importer takes them out of the address bar first, saves them
 * without overwriting anything (src/import-menus.ts), and replies to the old
 * address, which sends the next part or opens the page that was asked for.
 */

import { planImport } from "../import-menus";
import type { Storage } from "../storage";
import { encodeHandoffReply, parseHandoffRequest } from "./format";
import { OLD_ORIGIN } from "./origins";

export const IMPORT_PATH = "/import";

let captured: string | null = null;
let running: Promise<ImportOutcome> | null = null;

/**
 * HO-5: if this is /import, takes the fragment out of the address bar (replacing
 * the history entry) and keeps it for the importer. Called first thing at startup,
 * before the app renders or reports anything.
 */
export const captureImportFragment = (
  location: Pick<Location, "pathname" | "search" | "hash"> = window.location,
  history: Pick<History, "state" | "replaceState"> = window.history
): void => {
  if (location.pathname !== IMPORT_PATH || location.hash.length <= 1) return;
  captured = location.hash.slice(1);
  running = null;
  history.replaceState(history.state, "", location.pathname + location.search);
};

export type ImportOutcome =
  /** Not a hand-off (e.g. /import opened by hand). */
  | { kind: "nothing" }
  /** Saved (or already here): go back to the old address for the rest. */
  | { kind: "done"; reply: string; added: number }
  /** Couldn't save, or the menus didn't arrive whole: say so, then reply "not saved". */
  | { kind: "failed"; reply: string };

/** Saves the menus in `fragment` without overwriting, and says where to go next. */
export const importHandoff = async (
  storage: Storage,
  fragment: string | null,
  oldOrigin: string = OLD_ORIGIN
): Promise<ImportOutcome> => {
  const request = parseHandoffRequest(fragment);
  if (!request) return { kind: "nothing" };
  const reply = (ok: boolean) => `${oldOrigin}/#${encodeHandoffReply({ id: request.id, ok })}`;
  if (!request.complete) return { kind: "failed", reply: reply(false) };
  try {
    const add = planImport(Object.values(await storage.getDocuments()), request.menus);
    if (add.length > 0) {
      const ids = await storage.saveDocuments(...add);
      if (ids.length !== add.length) return { kind: "failed", reply: reply(false) };
    }
    return { kind: "done", reply: reply(true), added: add.length };
  } catch {
    return { kind: "failed", reply: reply(false) };
  }
};

/** Imports what captureImportFragment kept, once per page load (StrictMode runs effects twice). */
export const importCaptured = (storage: Storage): Promise<ImportOutcome> => {
  if (!running) {
    const fragment = captured;
    captured = null;
    running = importHandoff(storage, fragment);
  }
  return running;
};
