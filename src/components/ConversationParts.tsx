/**
 * Pieces of the "Talk it through" pages (spec §7c): comments for later, an area's
 * insights and per-person notes, conversation tips, and the dictation hint.
 */
import { useId, useMemo, useState } from "react";
import {
  AREA_PROMPTS,
  AreaEntry,
  Comment,
  CommentTarget,
  Conversation,
  addComment,
  commentsFor,
  deleteComment,
  updateAreaNotes,
} from "../conversation";
import { TIP_SOURCES, TIP_STAGES, Tip, tipsIn } from "../conversation-tips";
import { currentDictationHint } from "../dictation";
import { track } from "../analytics";

const formatWhen = (at: number) =>
  new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "Posting as …": who's using this device, for comments and "new" marks (CV-11). */
export const WhoAmI = ({
  names,
  me,
  onMe,
  label = "I'm",
}: {
  names: string[];
  me: number | null;
  onMe: (person: number | null) => void;
  label?: string;
}) => {
  const id = useId();
  return (
    <span className="conv-whoami">
      <label htmlFor={id}>{label}</label>{" "}
      <select id={id} value={me ?? ""} onChange={(e) => onMe(e.target.value === "" ? null : Number(e.target.value))}>
        <option value="">choose…</option>
        {names.map((n, i) => (
          <option key={i} value={i}>
            {n}
          </option>
        ))}
      </select>
    </span>
  );
};

/** Comments on a topic or an area, left for the others to read later (CV-11). */
export const Comments = ({
  conversation,
  target,
  names,
  me,
  onMe,
  seen,
  onChange,
  label,
}: {
  conversation: Conversation;
  target: CommentTarget;
  names: string[];
  me: number | null;
  onMe: (person: number | null) => void;
  /** When this device last looked: later comments by others are marked new. */
  seen: number;
  onChange: (next: Conversation) => void;
  label: string;
}) => {
  const [draft, setDraft] = useState("");
  const list = commentsFor(conversation, target).filter((c) => !c.deleted);
  const fieldId = useId();
  const who = (c: Comment) => (c.by === null ? "Someone" : names[c.by] ?? `Person ${c.by + 1}`);
  const post = () => {
    if (!draft.trim()) return;
    onChange(addComment(conversation, target, me, draft));
    track("conversation_comment_added", { target: "topic" in target ? "topic" : "area" });
    setDraft("");
  };
  return (
    <section className="conv-comments" aria-label={label}>
      <h3>
        Comments {list.length > 0 && <span className="discuss-count">{list.length}</span>}
      </h3>
      {list.length > 0 && (
        <ul>
          {list.map((c) => {
            const isNew = c.at > seen && (me === null || c.by !== me);
            return (
              <li key={c.id} className={isNew ? "conv-comment-new" : undefined}>
                <p className="conv-comment-meta">
                  <strong>{who(c)}</strong> · {formatWhen(c.at)}
                  {isNew && <span className="conv-new"> new</span>}
                  {me !== null && c.by === me && (
                    <button
                      type="button"
                      className="conv-link-button"
                      aria-label={`Delete your comment from ${formatWhen(c.at)}`}
                      onClick={() => onChange(deleteComment(conversation, target, c.id))}
                    >
                      Delete
                    </button>
                  )}
                </p>
                <p className="conv-comment-text">{c.text}</p>
              </li>
            );
          })}
        </ul>
      )}
      <label htmlFor={fieldId} className="sr-only">
        Add a comment
      </label>
      <textarea
        id={fieldId}
        rows={2}
        value={draft}
        placeholder="Something to say before you next talk? Leave a comment."
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="conv-comment-actions">
        <WhoAmI names={names} me={me} onMe={onMe} label="Posting as" />
        <button type="button" disabled={!draft.trim()} onClick={post}>
          Add comment
        </button>
      </div>
    </section>
  );
};

/** One person's three prompts for an area (CV-5). */
const PersonNotes = ({
  area,
  person,
  name,
  isMe,
  entry,
  conversation,
  onChange,
}: {
  area: string;
  person: number;
  name: string;
  isMe: boolean;
  entry?: AreaEntry;
  conversation: Conversation;
  onChange: (next: Conversation) => void;
}) => {
  const notes = entry?.people[String(person)];
  return (
    <fieldset className="conv-person-notes">
      <legend>
        {name}
        {isMe && " (you)"}
      </legend>
      {AREA_PROMPTS.map((p) => (
        <label key={p.field} className="discuss-field">
          <span>{p.label}</span>
          <textarea
            rows={2}
            value={notes?.[p.field] ?? ""}
            placeholder={p.placeholder}
            aria-label={`${name}: ${p.label}`}
            onChange={(e) => onChange(updateAreaNotes(conversation, area, person, { [p.field]: e.target.value }))}
          />
        </label>
      ))}
    </fieldset>
  );
};

/**
 * An area (a group of the menu): plain insights from the answers, the AI coach's
 * insight if there is one, each person's notes, and comments (CV-4, CV-5).
 */
export const AreaPanel = ({
  area,
  insights,
  aiInsight,
  conversation,
  names,
  me,
  onMe,
  seen,
  onChange,
  open,
}: {
  area: string;
  insights: string[];
  aiInsight?: string;
  conversation: Conversation;
  names: string[];
  me: number | null;
  onMe: (person: number | null) => void;
  seen: number;
  onChange: (next: Conversation) => void;
  open: boolean;
}) => {
  const entry = conversation.areas[area];
  const filled = names.filter((_, i) => AREA_PROMPTS.some((p) => entry?.people[String(i)]?.[p.field]?.trim())).length;
  // People in order, with this device's person first.
  const order = me === null ? names.map((_, i) => i) : [me, ...names.map((_, i) => i).filter((i) => i !== me)];
  return (
    <details className="conv-area" open={open}>
      <summary>
        <span className="conv-area-label">Area</span> {area || "(no group)"}
        <span className="conv-area-status">
          {" "}
          · notes from {filled} of {names.length}
        </span>
      </summary>
      <section aria-label={`About ${area || "this area"}`}>
        {insights.length > 0 && (
          <ul className="conv-insights">
            {insights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {aiInsight && (
          <p className="conv-ai-insight" aria-label="Suggested by the AI coach">
            ✦ {aiInsight}
          </p>
        )}
        <p className="conv-hint">
          Each of you can jot these down before you talk, or together. <DictationHint />
        </p>
        <div className="conv-people">
          {order.map((i) => (
            <PersonNotes
              key={i}
              area={area}
              person={i}
              name={names[i]}
              isMe={i === me}
              entry={entry}
              conversation={conversation}
              onChange={onChange}
            />
          ))}
        </div>
        <Comments
          conversation={conversation}
          target={{ area }}
          names={names}
          me={me}
          onMe={onMe}
          seen={seen}
          onChange={onChange}
          label={`Comments on ${area || "this area"}`}
        />
      </section>
    </details>
  );
};

/** The device's own way to dictate (CV-14). */
export const DictationHint = () => {
  const hint = useMemo(currentDictationHint, []);
  return <span className="conv-dictation">🎤 {hint}</span>;
};

const Sources = ({ tip }: { tip: Tip }) => (
  <span className="conv-tip-sources">
    Adapted from{" "}
    {tip.sources.map((s, i) => (
      <span key={s}>
        {i > 0 && "; "}
        <a href={TIP_SOURCES[s].url} target="_blank" rel="noopener noreferrer">
          {TIP_SOURCES[s].label}
        </a>
      </span>
    ))}
  </span>
);

/** A single tip, e.g. on a topic card. */
export const TipCard = ({ tip, heading = "Tip" }: { tip: Tip; heading?: string }) => (
  <aside className="conv-tip" aria-label={`${heading}: ${tip.title}`}>
    <p>
      <strong>
        💡 {heading}: {tip.title}.
      </strong>{" "}
      {tip.text}
    </p>
    <details>
      <summary>Where this comes from</summary>
      <Sources tip={tip} />
    </details>
  </aside>
);

/** Every tip, by stage (CV-13). */
export const TipsPanel = ({ open = false }: { open?: boolean }) => (
  <details className="conv-tips" open={open} onToggle={(e) => (e.currentTarget.open ? track("conversation_tips_opened") : undefined)}>
    <summary>💡 Tips for hard conversations</summary>
    <p className="conv-hint">
      Ideas many couples find helpful, adapted from relationship research and practice. They're tips, not
      therapy, and they assume you both feel safe to speak freely.
    </p>
    {TIP_STAGES.map((stage) => (
      <section key={stage.id} aria-label={stage.label}>
        <h3>{stage.label}</h3>
        <ul>
          {tipsIn(stage.id).map((tip) => (
            <li key={tip.id}>
              <strong>{tip.title}.</strong> {tip.text} <Sources tip={tip} />
            </li>
          ))}
        </ul>
      </section>
    ))}
  </details>
);
