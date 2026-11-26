import { useState } from "react";
import { track } from "../analytics";
import { BUCKETS, Bucket } from "../compare-focus";
import { Conversation, ConversationSettings, MenuNotesView, bucketCounts, settingsOf, updateSettings } from "../conversation";
import { Topic } from "../discussion";

/** The order buckets are offered in: what needs a talk first, then what you agree on. */
const BUCKET_ORDER: Bucket[] = ["conflict", "talk", "open", "degree", "shared-want", "shared-maybe", "shared-no"];

const NOTES_VIEWS: { id: MenuNotesView; label: string; hint: string }[] = [
  { id: "show", label: "Show them", hint: "Under each person's answer" },
  { id: "highlight", label: "Highlight them", hint: "Set apart on each topic, and marked ✎ in the plan" },
  { id: "hide", label: "Hide until revealed", hint: "Talk first, then read what each of you wrote" },
];

type Setting = "include" | "order" | "menu_notes" | "prompts";

/**
 * Shaping a conversation's agenda (spec CV-15…CV-17): which kinds of item are on it,
 * including the ones you agree on; the order; how notes from each person's menu
 * show; and whether suggested questions do. Settings are shared with everyone in
 * the conversation.
 */
export const AgendaSettings = ({
  conversation,
  planSaved,
  onChange,
  defaultOpen = false,
}: {
  conversation: Conversation;
  /** Whether the parts have been changed by hand (new topics then go to "Not planned yet"). */
  planSaved: boolean;
  onChange: (c: Conversation) => void;
  defaultOpen?: boolean;
}) => {
  const settings = settingsOf(conversation);
  const counts = bucketCounts(conversation);
  const change = (setting: Setting, next: Partial<Omit<ConversationSettings, "updatedAt">>) => {
    track("conversation_settings_changed", { setting });
    onChange(updateSettings(conversation, next));
  };
  const visible = BUCKET_ORDER.filter((b) => counts[b] > 0);
  return (
    <details className="conv-settings" open={defaultOpen}>
      <summary>
        <h2>Shape the agenda</h2>
      </summary>
      <p className="conv-hint">
        Choose what to talk about, including what you already agree on, and how notes show. These settings are part of
        the conversation, so everyone you send it to sees the same agenda.
        {planSaved && " Topics you add go to \"Not planned yet\"; move them into a part."}
      </p>
      <div className="conv-settings-grid">
        <fieldset>
          <legend>What's on the agenda</legend>
          {visible.map((b) => (
            <label key={b} className="conv-setting">
              <input
                type="checkbox"
                checked={settings.include[b]}
                onChange={(e) => change("include", { include: { ...settings.include, [b]: e.target.checked } })}
              />
              <span>
                <span className="conv-setting-title">
                  <span className={`zone-dot zone-${BUCKETS[b].zone}`} aria-hidden="true" /> {BUCKETS[b].label}{" "}
                  <span className="conv-setting-count">({counts[b]})</span>
                </span>
                <small>{BUCKETS[b].description}</small>
              </span>
            </label>
          ))}
          {!settings.include["shared-want"] && counts["shared-want"] > 0 && (
            <label className="conv-setting-inline">
              <span>Start with</span>
              <select value={settings.warmUp} onChange={(e) => change("include", { warmUp: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "none" : n}
                  </option>
                ))}
              </select>
              <span>of the things you all want, to warm up</span>
            </label>
          )}
        </fieldset>
        <div>
          <fieldset>
            <legend>Order</legend>
            <label className="conv-setting">
              <input type="radio" name="conv-order" checked={settings.order === "gentle"} onChange={() => change("order", { order: "gentle" })} />
              <span>
                Easiest first
                <small>What you share first, the hardest last</small>
              </span>
            </label>
            <label className="conv-setting">
              <input type="radio" name="conv-order" checked={settings.order === "hardest"} onChange={() => change("order", { order: "hardest" })} />
              <span>
                Hardest first
                <small>While you're fresh; end on what you share</small>
              </span>
            </label>
          </fieldset>
          <fieldset>
            <legend>Suggested questions</legend>
            <label className="conv-setting">
              <input type="checkbox" checked={settings.prompts} onChange={(e) => change("prompts", { prompts: e.target.checked })} />
              <span>
                Show them on each topic
                <small>A few questions to get you started</small>
              </span>
            </label>
          </fieldset>
        </div>
        <fieldset>
          <legend>Notes from your menus</legend>
          {NOTES_VIEWS.map((n) => (
            <label key={n.id} className="conv-setting">
              <input type="radio" name="conv-menu-notes" checked={settings.menuNotes === n.id} onChange={() => change("menu_notes", { menuNotes: n.id })} />
              <span>
                {n.label}
                <small>{n.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </details>
  );
};

/** Whether anyone wrote a note on this topic on their menu. */
export const hasMenuNotes = (topic: Pick<Topic, "notes">) => !!topic.notes?.some((n) => !!n?.trim());

/**
 * Notes from each person's menu on a topic (CV-16): listed, highlighted, or hidden
 * behind a button until someone chooses to read them.
 */
export const MenuNotes = ({ topic, names, view }: { topic: Topic; names: string[]; view: MenuNotesView }) => {
  const [revealed, setRevealed] = useState(false);
  const notes = (topic.notes ?? [])
    .map((note, i) => ({ note: note?.trim(), who: names[i] ?? `Menu ${i + 1}` }))
    .filter((n): n is { note: string; who: string } => !!n.note);
  if (notes.length === 0) return null;
  if (view === "hide" && !revealed) {
    return (
      <p className="conv-menu-notes-hidden">
        <button type="button" onClick={() => setRevealed(true)}>
          Show what {notes.length === 1 ? `${notes[0].who} wrote on their menu` : "you wrote on your menus"}
        </button>
      </p>
    );
  }
  return (
    <section className={`conv-menu-notes${view === "highlight" ? " highlight" : ""}`} aria-label="From your menus">
      <h2>From your menus</h2>
      <ul>
        {notes.map((n) => (
          <li key={n.who}>
            <strong>{n.who}:</strong> “{n.note}”
          </li>
        ))}
      </ul>
    </section>
  );
};
