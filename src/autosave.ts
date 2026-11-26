/**
 * Debounced, serialized autosave for the menu editor.
 */

import { useEffect, useRef, useState } from "react";
import { RelationshipMenuDocument } from "./model/menu";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

/** How long to wait after the last edit before saving. */
export const AUTOSAVE_DELAY_MS = 400;

/**
 * Saves `doc` shortly after it last changed.
 *
 * - Saves run one at a time, in order, so an older save can never finish after (and
 *   overwrite) a newer one.
 * - Rapid edits are coalesced into a single save of the latest document.
 * - A pending save is flushed when the component unmounts or the page is hidden
 *   (tab closed, navigated away), so the last edit isn't lost.
 *
 * @param doc - The document to save, or null when nothing should be saved.
 * @param save - Performs the save. Always called with the latest `save` function.
 * @param stored - What storage holds now, when something other than these saves
 *   changed it (a synced change the editor now shows, spec SY-33). Saving exactly
 *   that is then skipped, and anything else, even what was saved before, is saved.
 * @returns The current save state, for display.
 */
export const useAutosave = (
  doc: RelationshipMenuDocument | null,
  save: (doc: RelationshipMenuDocument) => Promise<void>,
  stored?: RelationshipMenuDocument | null
): SaveState => {
  const [state, setState] = useState<SaveState>("idle");
  const saveRef = useRef(save);
  saveRef.current = save;
  const pending = useRef<RelationshipMenuDocument | null>(null);
  const lastSaved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    const key = JSON.stringify(next);
    queue.current = queue.current.then(async () => {
      if (key === lastSaved.current) {
        if (mounted.current && !pending.current) setState("saved");
        return;
      }
      if (mounted.current) setState("saving");
      try {
        await saveRef.current(next);
        lastSaved.current = key;
        if (mounted.current && !pending.current) setState("saved");
      } catch (e) {
        console.error("Failed to save menu:", e);
        // Part of the save may have happened (e.g. written, but the old title not
        // removed), so storage no longer matches any known version: don't skip the
        // next save because it equals an earlier one.
        lastSaved.current = null;
        if (mounted.current) setState("error");
      }
    });
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    if (!stored) return;
    const key = JSON.stringify(stored);
    // In the queue, after any save already on its way.
    queue.current = queue.current.then(() => {
      lastSaved.current = key;
    });
  }, [stored]);

  useEffect(() => {
    if (!doc) {
      pending.current = null;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      return;
    }
    // Always replace the pending document, even when it matches the last save:
    // reverting an edit (e.g. undo) within the debounce window must cancel the edit,
    // not let it be saved. The queue skips writes that wouldn't change anything.
    pending.current = doc;
    setState("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), AUTOSAVE_DELAY_MS);
  }, [doc]);

  useEffect(() => {
    mounted.current = true;
    const onHide = () => flushRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushRef.current();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flushRef.current();
      mounted.current = false;
    };
  }, []);

  return state;
};
