/**
 * /import: where the old address's hand-off page brings saved menus (spec HO-4,
 * HO-5). Usually on screen for a moment only.
 */

import "./Import.css";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useStorage } from "../providers/Storage";
import { ImportOutcome, importCaptured } from "../handoff/receive";
import { OLD_ORIGIN } from "../handoff/origins";

/** Leaves for another address (the old one, to continue the hand-off). */
const leave = (url: string) => window.location.replace(url);

export const ImportPage = ({ onLeave = leave }: { onLeave?: (url: string) => void }) => {
  const { storage } = useStorage();
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  useEffect(() => {
    let active = true;
    importCaptured(storage).then((result) => {
      if (!active) return;
      if (result.kind === "done") onLeave(result.reply);
      else setOutcome(result);
    });
    return () => {
      active = false;
    };
  }, [storage, onLeave]);

  if (outcome?.kind === "nothing") return <Navigate to="/library" replace />;

  if (outcome?.kind === "failed") {
    return (
      <div className="import-page">
        <h1>Your menus couldn't be brought over</h1>
        <p>
          This browser didn't let them be saved here, or they didn't arrive whole. They're still
          saved at {new URL(OLD_ORIGIN).host}, unchanged, and coming back there tries again.
        </p>
        <button className="button button-primary" onClick={() => onLeave(outcome.reply)}>
          Continue without them
        </button>
      </div>
    );
  }

  return (
    <div className="import-page" role="status">
      <h1>Bringing your menus over…</h1>
    </div>
  );
};
