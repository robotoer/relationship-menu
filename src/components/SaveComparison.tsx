import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { decodeCompareSlug, normalizeCompareEntry } from "../compare-slug";
import { adoptOldDiscussion, findConversation, newConversation, saveConversation } from "../conversation";
import { platform } from "../platform";
import { track } from "../analytics";

/**
 * On the Compare page: keep this comparison as a conversation in the Library, so you
 * can come back to it, plan it in parts and share it (spec CV-1, CV-2).
 */
export const SaveComparison = ({ entries }: { entries: string[] }) => {
  const slugs = useMemo(
    () => entries.map(normalizeCompareEntry).filter((e) => decodeCompareSlug(e) !== null),
    [entries]
  );
  const [version, setVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const saved = useMemo(
    () => (slugs.length >= 2 ? findConversation(slugs.map((s) => decodeCompareSlug(s)!)) : null),
    // `version` re-reads storage after saving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slugs, version]
  );
  if (slugs.length < 2) return null;

  const params = new URLSearchParams();
  slugs.forEach((s) => params.append("encoded", s));
  const compareUrl = `${platform().publicOrigin}/compare?${params.toString()}`;

  return (
    <div className="overview-save">
      {saved ? (
        <p>
          <strong>Saved in your Library</strong> as "{saved.title}".{" "}
          <Link to={`/talk?id=${saved.id}`}>Open the conversation</Link>
        </p>
      ) : (
        <>
          <p>Keep this comparison to come back to: plan the talk in parts, take notes, share it.</p>
          <button
            type="button"
            onClick={() => {
              const c = adoptOldDiscussion(newConversation(slugs));
              if (saveConversation(c)) {
                track("conversation_saved", { source: "compare" });
                setVersion((v) => v + 1);
              }
            }}
          >
            💾 Save this comparison
          </button>
        </>
      )}
      <button
        type="button"
        onClick={async () => {
          try {
            await platform().copyText(compareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch (e) {
            console.error("Copy failed:", e);
          }
        }}
      >
        {copied ? "Copied!" : "Copy link to this comparison"}
      </button>
    </div>
  );
};
