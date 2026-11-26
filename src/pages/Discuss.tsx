import "./Discuss.css";
import "../components/CompareOverview.css";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  CoachClient,
  CoachError,
  SavedCoachGuide,
  buildCoachRequest,
  coachPreview,
  saveGuide,
  coachFailureText,
  COACH_LIMITS,
} from "../coach";
import { Link } from "react-router-dom";
import { track } from "../analytics";
import { platform } from "../platform";
import { COMPARE_VALUE_LABELS, compareValueClass } from "../components/MenuItemCompare";
import { GROUND_RULES, OUTCOMES, Outcome, Topic, topicLabel } from "../discussion";
import {
  Conversation,
  TopicEntry,
  agendaAreas,
  areaInsights,
  conversationAgenda,
  conversationLink,
  conversationSummary,
  minutesFor,
  moveTopic,
  partsWithTopics,
  saveCoachGuide,
  setParts,
  settingsOf,
  setTitle,
  suggestParts,
  unreadComments,
  updatePart,
  updateTopic,
} from "../conversation";
import { tipFor, tipsIn } from "../conversation-tips";
import { AreaPanel, Comments, DictationHint, TipCard, TipsPanel, WhoAmI } from "../components/ConversationParts";
import { LivePanel } from "../live/LivePanel";
import { AgendaSettings, MenuNotes, hasMenuNotes } from "../components/AgendaSettings";
import type { Live } from "../live/useLive";

type View = { kind: "intro" } | { kind: "topic"; part: number; index: number } | { kind: "summary" };

/** A newer version of one of the compared menus, saved in this browser (CV-7). */
export type MenuUpdate = { index: number; name: string; slug: string };

const isCovered = (r: TopicEntry | undefined) =>
  !!r && (!!r.outcome || !!r.note?.trim() || !!r.followUp?.trim());

/**
 * "Talk it through" (spec §7b, §7c): a conversation about a comparison, in parts. It
 * starts with the plan (parts, tips, sharing), then goes one topic at a time with
 * everyone's answers, the area's insights and each person's notes, prompts, notes,
 * an outcome and comments, then a summary to keep. The caller saves `onChange`.
 */
export const DiscussPage = ({
  conversation,
  onChange,
  names,
  compareLink,
  coach,
  me,
  onMe,
  seen,
  menuUpdates = [],
  onUseMenu,
  notice,
  live,
}: {
  conversation: Conversation;
  onChange: (next: Conversation) => void;
  names: string[];
  compareLink: string;
  /** The AI coach, when this browser can use it (a supporter); otherwise a teaser. */
  coach?: CoachClient;
  /** Which person is using this device, if they said. */
  me: number | null;
  onMe: (person: number | null) => void;
  /** When this device last looked at the conversation (for "new" marks). */
  seen: number;
  menuUpdates?: MenuUpdate[];
  onUseMenu?: (update: MenuUpdate) => void;
  /** A message about what just happened (e.g. someone's link was merged). */
  notice?: ReactNode;
  /** Live sharing (docs/spec/notifications.md), when this page has it. */
  live?: Live;
}) => {
  const [view, setView] = useState<View>({ kind: "intro" });
  const [copied, setCopied] = useState<"summary" | "link" | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const record = conversation;

  const agenda = useMemo(() => conversationAgenda(conversation), [conversation.menus, conversation.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  // Until someone changes the plan, it's the suggested one (saved with the first change).
  const settings = settingsOf(conversation);
  const suggested = useMemo(
    () => suggestParts(agenda, 6, conversation.createdAt, undefined, settings.order),
    [agenda, conversation.createdAt, settings.order]
  );
  const plan = conversation.parts.length > 0 ? conversation.parts : suggested;
  const parts = useMemo(() => partsWithTopics(plan, agenda), [plan, agenda]);
  const areas = useMemo(() => agendaAreas(conversation, agenda), [conversation.menus, agenda]); // eslint-disable-line react-hooks/exhaustive-deps

  const covered = agenda.filter((t) => isCovered(record.topics[t.key])).length;
  const unread = unreadComments(conversation, me, seen);

  /** Saves the plan the first time it's touched, then applies `edit`. */
  const withPlan = (edit: (c: Conversation) => Conversation) =>
    onChange(edit(conversation.parts.length > 0 ? conversation : setParts(conversation, suggested)));

  // Move focus to the new heading when the view changes (keyboard and screen readers).
  useEffect(() => {
    heading.current?.focus();
  }, [view]);

  useEffect(() => {
    if (view.kind !== "summary") return;
    const count = (o: Outcome) => agenda.filter((t) => record.topics[t.key]?.outcome === o).length;
    track("discussion_summary_viewed", {
      topic_count: agenda.length,
      covered_count: covered,
      agreed: count("agreed"),
      compromise: count("compromise"),
      revisit: count("revisit"),
      agree_to_disagree: count("agree-to-disagree"),
      boundary: count("boundary"),
    });
    // Once per visit to the summary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind]);

  const update = (key: string, change: Partial<Pick<TopicEntry, "note" | "outcome" | "followUp">>) =>
    onChange(updateTopic(conversation, key, change));

  /** The first part (and topic in it) not finished yet. */
  const firstOpen = (): { part: number; index: number } => {
    for (let p = 0; p < parts.length; p++) {
      if (parts[p].part?.done) continue;
      const i = parts[p].topics.findIndex((t) => !isCovered(record.topics[t.key]));
      if (i !== -1) return { part: p, index: i };
    }
    return { part: 0, index: 0 };
  };

  const start = (at: { part: number; index: number }) => {
    track("discussion_started", { topic_count: agenda.length, menu_count: names.length, resumed: covered > 0 });
    setView({ kind: "topic", ...at });
  };

  const share = async (method: "share" | "copy") => {
    const link = conversationLink(platform().publicOrigin, conversation);
    const message = `I've added to our Wants & Won'ts conversation "${conversation.title}". Open this to see it and add yours: ${link}`;
    try {
      if (method === "share" && platform().shareText) {
        if (!(await platform().shareText!({ title: conversation.title, text: message }))) return;
      } else {
        await platform().copyText(link);
        setCopied("link");
        setTimeout(() => setCopied(null), 1500);
      }
      track("conversation_shared", { method });
    } catch (e) {
      console.error("Couldn't share the conversation:", e);
    }
  };

  if (agenda.length === 0) {
    return (
      <div className="discuss-page">
        <h1>Talk it through</h1>
        <p>
          Nothing is on the agenda.{" "}
          {settings.updatedAt === 0
            ? "You agree on everything you've both answered. Enjoy that, or add what you share below."
            : "Choose what to talk about below."}
        </p>
        <AgendaSettings conversation={conversation} planSaved={conversation.parts.length > 0} onChange={onChange} defaultOpen />
        <Link className="button" to={compareLink}>
          Back to the comparison
        </Link>
      </div>
    );
  }

  if (view.kind === "intro") {
    const byKind = [...new Set(agenda.map(topicLabel))].map((info) => ({
      ...info,
      count: agenda.filter((t) => topicLabel(t) === info).length,
    }));
    const next = firstOpen();
    return (
      <div className="discuss-page">
        <h1 tabIndex={-1} ref={heading}>
          Talk it through
        </h1>
        {notice && (
          <p className="conv-notice" role="status">
            {notice}
          </p>
        )}
        <p className="discuss-lead">
          {names.join(" & ")}: {agenda.length} topic{agenda.length === 1 ? "" : "s"}
          {parts.length > 1 ? ` in ${parts.filter((p) => p.part).length} parts` : ""}, about{" "}
          {Math.max(5, agenda.length * 3)} minutes in all.{" "}
          {settings.order === "hardest"
            ? "Start with the hardest, while you're fresh, and end on what you share."
            : "Start with something you share, then work towards the harder ones."}{" "}
          You can stop any time; everything is saved in this browser.
        </p>
        <div className="conv-header-row">
          <label className="conv-title">
            <span>Conversation name</span>
            <input value={conversation.title} maxLength={120} onChange={(e) => onChange(setTitle(conversation, e.target.value))} />
          </label>
          <WhoAmI names={names} me={me} onMe={onMe} label="On this device, I'm" />
        </div>
        {unread > 0 && (
          <p className="conv-unread" role="status">
            💬 {unread} new comment{unread === 1 ? "" : "s"} since you last looked. They're marked "new" on their
            topics.
          </p>
        )}
        {menuUpdates.length > 0 && onUseMenu && (
          <div className="conv-menu-updates" role="status">
            {menuUpdates.map((u) => (
              <p key={u.index}>
                {u.name}'s menu has changed since this conversation started.{" "}
                <button type="button" onClick={() => onUseMenu(u)}>
                  Use the latest version
                </button>
              </p>
            ))}
          </div>
        )}
        <ul className="discuss-kinds">
          {byKind.map((k) => (
            <li key={k.label}>
              <strong>{k.count}</strong> {k.label}: {k.intro}
            </li>
          ))}
        </ul>
        <h2>Before you start</h2>
        <ol className="discuss-rules">
          {GROUND_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
        <TipCard tip={tipsIn("before")[0]} heading="First" />
        <TipsPanel />

        <div className="discuss-actions">
          <button type="button" className="button-primary" onClick={() => start(covered > 0 ? next : { part: 0, index: 0 })}>
            {covered > 0 ? `▶ Continue (${covered} of ${agenda.length} done)` : "▶ Start"}
          </button>
          {covered > 0 && (
            <button type="button" onClick={() => setView({ kind: "summary" })}>
              See notes so far
            </button>
          )}
          <Link className="button" to={compareLink}>
            Back to the comparison
          </Link>
        </div>

        <AgendaSettings conversation={conversation} planSaved={conversation.parts.length > 0} onChange={onChange} />

        <h2>The plan</h2>
        <p className="conv-hint">
          Hard conversations go better in shorter sittings. Here's the agenda in parts of a few topics each, easiest
          first. Rename them, pick a day, or move topics between them.
        </p>
        <ol className="conv-parts">
          {parts.map(({ part, topics }, p) => (
            <li key={part?.id ?? "rest"} className={`conv-part${part?.done ? " done" : ""}`}>
              <div className="conv-part-head">
                {part ? (
                  <input
                    className="conv-part-title"
                    aria-label={`Name of part ${p + 1}`}
                    value={part.title}
                    maxLength={120}
                    onChange={(e) => withPlan((c) => updatePart(c, part.id, { title: e.target.value }))}
                  />
                ) : (
                  <strong>Not planned yet</strong>
                )}
                <span className="conv-part-meta">
                  {topics.length} topic{topics.length === 1 ? "" : "s"} · about {minutesFor(topics.length)} min ·{" "}
                  {topics.filter((t) => isCovered(record.topics[t.key])).length} done
                </span>
              </div>
              {part && (
                <div className="conv-part-controls">
                  <label>
                    <span>When</span>{" "}
                    <input
                      type="date"
                      value={part.when ?? ""}
                      onChange={(e) => withPlan((c) => updatePart(c, part.id, { when: e.target.value || undefined }))}
                    />
                  </label>
                  <label className="conv-check">
                    <input
                      type="checkbox"
                      checked={!!part.done}
                      onChange={(e) => {
                        withPlan((c) => updatePart(c, part.id, { done: e.target.checked }));
                        if (e.target.checked) track("conversation_part_done", { part_count: parts.length });
                      }}
                    />
                    <span>Done</span>
                  </label>
                  {topics.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const i = topics.findIndex((t) => !isCovered(record.topics[t.key]));
                        start({ part: p, index: i === -1 ? 0 : i });
                      }}
                    >
                      {topics.some((t) => isCovered(record.topics[t.key])) ? "Continue" : "Start"} part {p + 1}
                    </button>
                  )}
                </div>
              )}
              <details className="conv-part-topics">
                <summary>Topics and notes</summary>
                <ul>
                  {topics.map((t) => (
                    <li key={t.key}>
                      <span className={`swatch-dot kind-${t.kind}`} aria-hidden="true" /> {t.item}{" "}
                      <span className="discuss-summary-group">· {t.group}</span>
                      {settings.menuNotes === "highlight" && hasMenuNotes(t) && (
                        <span className="conv-has-notes" title="Someone wrote a note on their menu">
                          {" "}
                          ✎<span className="sr-only"> has menu notes</span>
                        </span>
                      )}
                      {parts.filter((x) => x.part).length > 1 && (
                        <select
                          aria-label={`Move "${t.item}" to another part`}
                          value={part?.id ?? ""}
                          onChange={(e) => withPlan((c) => moveTopic(c, t.key, e.target.value))}
                        >
                          {!part && <option value="">Not planned</option>}
                          {parts
                            .filter((x) => x.part)
                            .map((x, i) => (
                              <option key={x.part!.id} value={x.part!.id}>
                                Part {i + 1}
                              </option>
                            ))}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
                {part && (
                  <label className="discuss-field">
                    <span>Notes for this part</span>
                    <textarea
                      rows={2}
                      value={part.note ?? ""}
                      placeholder="What to remember next time, what you agreed to try"
                      onChange={(e) => withPlan((c) => updatePart(c, part.id, { note: e.target.value }))}
                    />
                  </label>
                )}
              </details>
            </li>
          ))}
        </ol>

        {live && <LivePanel live={live} />}

        <section className="conv-share" aria-labelledby="conv-share-title">
          <h2 id="conv-share-title">{live?.entry ? "Send a copy instead" : "Not in the same room?"}</h2>
          <p>
            Take turns from your own phones. Send this conversation; when they open the link, it's added to their
            copy (or saved, if they don't have one), with your notes and comments. They add theirs and send it back.
            Each link brings both copies up to date.
          </p>
          <p className="conv-hint">
            The link holds both menus, every note and every comment. Anyone with it can read them, so send it only
            to the people in this conversation. It never passes through our server.
          </p>
          <div className="discuss-actions">
            {platform().shareText && (
              <button type="button" className="button-primary" onClick={() => share("share")}>
                Send my updates…
              </button>
            )}
            <button type="button" onClick={() => share("copy")}>
              {copied === "link" ? "Copied!" : "Copy link"}
            </button>
          </div>
        </section>

        {coach ? (
          <CoachPanel
            agenda={agenda}
            people={names.length}
            coach={coach}
            saved={record.coach}
            onSaved={(guide) => onChange(saveCoachGuide(conversation, guide))}
          />
        ) : platform().aiTeaser ? (
          <AiPrepTeaser />
        ) : null}
        <SafetyNote />
      </div>
    );
  }

  if (view.kind === "summary") {
    const summary = conversationSummary({ ...conversation, parts: plan }, agenda, names);
    const download = () => {
      const file = new File([summary], "relationship-menu-discussion.md", { type: "text/markdown" });
      void platform()
        .saveFile(file)
        .then(
          (outcome) => {
            if (outcome !== "cancelled") track("discussion_summary_exported", { method: "download" });
          },
          (e) => console.error("Couldn't save the summary:", e)
        );
    };
    return (
      <div className="discuss-page">
        <h1 tabIndex={-1} ref={heading}>
          Your discussion
        </h1>
        <p className="discuss-lead">
          {covered} of {agenda.length} topics discussed. These notes are saved only in this browser; send the
          conversation to the others, or copy or download it to keep it somewhere else.
        </p>
        {record.coach?.closing && <p className="discuss-coach-closing">{record.coach.closing}</p>}
        <TipCard tip={tipsIn("closing")[1]} heading="Before you finish" />
        {OUTCOMES.map((o) => {
          const topics = agenda.filter((t) => record.topics[t.key]?.outcome === o.id);
          if (topics.length === 0) return null;
          return (
            <section key={o.id} className={`discuss-outcome outcome-${o.id}`}>
              <h2>
                {o.label} <span className="discuss-count">{topics.length}</span>
              </h2>
              <ul>
                {topics.map((t) => (
                  <SummaryItem key={t.key} topic={t} record={record.topics[t.key]!} names={names} />
                ))}
              </ul>
            </section>
          );
        })}
        {(() => {
          const unsettled = agenda.filter((t) => isCovered(record.topics[t.key]) && !record.topics[t.key]?.outcome);
          return unsettled.length > 0 ? (
            <section className="discuss-outcome">
              <h2>
                Notes, no outcome yet <span className="discuss-count">{unsettled.length}</span>
              </h2>
              <ul>
                {unsettled.map((t) => (
                  <SummaryItem key={t.key} topic={t} record={record.topics[t.key]!} names={names} />
                ))}
              </ul>
            </section>
          ) : null;
        })()}
        <div className="discuss-actions">
          <button
            type="button"
            className="button-primary"
            onClick={async () => {
              try {
                await platform().copyText(summary);
                setCopied("summary");
                setTimeout(() => setCopied(null), 1500);
                track("discussion_summary_exported", { method: "copy" });
              } catch (e) {
                console.error("Copy failed:", e);
              }
            }}
          >
            {copied === "summary" ? "Copied!" : "Copy summary"}
          </button>
          <button type="button" onClick={download}>
            Download (.md)
          </button>
          <button
            type="button"
            onClick={() => {
              track("discussion_summary_exported", { method: "print" });
              window.print();
            }}
          >
            Print
          </button>
          <button type="button" onClick={() => setView({ kind: "topic", ...firstOpen() })}>
            Back to topics
          </button>
          <button type="button" onClick={() => setView({ kind: "intro" })}>
            The plan
          </button>
          <Link className="button" to={compareLink}>
            Back to the comparison
          </Link>
        </div>
        <SafetyNote />
      </div>
    );
  }

  const { part, topics } = parts[view.part] ?? parts[0];
  const topic = topics[view.index] ?? topics[0];
  const r = record.topics[topic.key];
  const lastInPart = view.index === topics.length - 1;
  const nextPart = parts.findIndex((p, i) => i > view.part && p.topics.length > 0 && !p.part?.done);
  const firstOfArea = topics.findIndex((t) => t.group === topic.group) === view.index;
  const area = areas.find((a) => a.group === topic.group);
  const go = (index: number) => {
    if (index < 0) return setView({ kind: "intro" });
    if (index < topics.length) return setView({ kind: "topic", part: view.part, index });
    // End of this part: mark it done, then the next part or the summary.
    if (part && !part.done) {
      withPlan((c) => updatePart(c, part.id, { done: true }));
      track("conversation_part_done", { part_count: parts.length });
    }
    setView(nextPart === -1 ? { kind: "summary" } : { kind: "intro" });
  };
  return (
    <div className="discuss-page discuss-topic-view">
      {parts.length > 1 && (
        <p className="conv-part-label">
          Part {view.part + 1} of {parts.length}: {part?.title ?? "Not planned yet"}
        </p>
      )}
      <nav className="discuss-progress" aria-label="Topics">
        <ol>
          {topics.map((t, i) => (
            <li key={t.key}>
              <button
                type="button"
                className={`discuss-dot kind-${t.kind}${isCovered(record.topics[t.key]) ? " done" : ""}`}
                aria-current={i === view.index ? "step" : undefined}
                aria-label={`Topic ${i + 1}: ${t.item}${isCovered(record.topics[t.key]) ? " (done)" : ""}`}
                title={t.item}
                onClick={() => go(i)}
              />
            </li>
          ))}
        </ol>
        <span>
          {view.index + 1} / {topics.length}
        </span>
      </nav>

      {area && (
        <AreaPanel
          key={`${topic.group}-${view.part}`}
          area={area.group}
          insights={areaInsights(area.summary, area.topics, names)}
          aiInsight={record.coach?.areas?.[area.group]}
          conversation={conversation}
          names={names}
          me={me}
          onMe={onMe}
          seen={seen}
          onChange={onChange}
          open={firstOfArea}
        />
      )}

      <article className={`discuss-card kind-${topic.kind}`}>
        <p className="discuss-kind">
          {topicLabel(topic).label} · {topic.group}
        </p>
        <h1 tabIndex={-1} ref={heading}>
          {topic.item}
        </h1>
        <ul className="discuss-answers">
          {topic.values.map((v, i) => (
            <li key={i}>
              <span className={`swatch ${compareValueClass(v)}`} aria-hidden="true" />
              <span>
                <strong>{names[i]}</strong>: {COMPARE_VALUE_LABELS[compareValueClass(v)]}
              </span>
              {settings.menuNotes === "show" && topic.notes?.[i] && (
                <span className="discuss-their-note">"{topic.notes[i]}"</span>
              )}
            </li>
          ))}
        </ul>
        {settings.menuNotes !== "show" && (
          <MenuNotes key={topic.key} topic={topic} names={names} view={settings.menuNotes} />
        )}

        {record.coach?.topics[topic.key] && (
          <section className="discuss-coach" aria-label="Suggested by the AI coach">
            <h2>✦ Suggested for you</h2>
            {record.coach.topics[topic.key].about && <p>{record.coach.topics[topic.key].about}</p>}
            <ul className="discuss-prompts">
              {record.coach.topics[topic.key].questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </section>
        )}
        {settings.prompts && (
          <>
            <h2>{record.coach?.topics[topic.key] ? "More to talk about" : "Talk about"}</h2>
            <ul className="discuss-prompts">
              {topic.prompts.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        )}
        <TipCard tip={tipFor(topic.kind, topic.key)} />

        <label className="discuss-field">
          <span>What came up?</span>
          <textarea
            value={r?.note ?? ""}
            rows={4}
            placeholder="Notes for both of you: what you each said, what you learned"
            onChange={(e) => update(topic.key, { note: e.target.value })}
          />
        </label>
        <p className="conv-hint">
          <DictationHint />
        </p>

        <fieldset className="discuss-outcomes">
          <legend>Where did you land?</legend>
          {OUTCOMES.map((o) => (
            <label key={o.id} className={`discuss-outcome-option outcome-${o.id}`}>
              <input
                type="radio"
                name={`outcome-${topic.key}`}
                checked={r?.outcome === o.id}
                onChange={() => update(topic.key, { outcome: o.id })}
              />
              <span>
                <strong>{o.label}</strong>
                <small>{o.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="discuss-field">
          <span>Next step (optional)</span>
          <input
            value={r?.followUp ?? ""}
            placeholder="e.g. Try it for a month, then check in"
            onChange={(e) => update(topic.key, { followUp: e.target.value })}
          />
        </label>

        <Comments
          conversation={conversation}
          target={{ topic: topic.key }}
          names={names}
          me={me}
          onMe={onMe}
          seen={seen}
          onChange={onChange}
          label={`Comments on ${topic.item}`}
        />
      </article>

      <div className="discuss-actions discuss-nav">
        <button type="button" onClick={() => go(view.index - 1)}>
          ◀ Back
        </button>
        <button type="button" className="button-primary" onClick={() => go(view.index + 1)}>
          {lastInPart ? (nextPart === -1 ? "Finish ▶" : `Finish part ${view.part + 1} ▶`) : isCovered(r) ? "Next ▶" : "Skip for now ▶"}
        </button>
        <button type="button" onClick={() => setView({ kind: "summary" })}>
          Summary
        </button>
        <button type="button" onClick={() => setView({ kind: "intro" })}>
          The plan
        </button>
      </div>
      <SafetyNote />
    </div>
  );
};

/** Shown on every view: what this is (and isn't), and where to get help (CO-11). */
const SafetyNote = () => (
  <aside className="discuss-safety" aria-label="Not therapy">
    This is a conversation guide, not therapy or counselling. If you feel unsafe or are in crisis, in the
    US call or text <strong>988</strong>, or the National Domestic Violence Hotline at{" "}
    <strong>1-800-799-7233</strong> (text START to 88788). Outside the US, contact your local emergency
    number or helplines.
  </aside>
);

/**
 * "Prepare with AI" (spec CO-9, CO-10): shows exactly what would be sent, needs
 * everyone's agreement each time, then saves the suggestions with the notes.
 */
const CoachPanel = ({
  agenda,
  people,
  coach,
  saved,
  onSaved,
}: {
  agenda: Topic[];
  people: number;
  coach: CoachClient;
  saved?: SavedCoachGuide;
  onSaved: (guide: SavedCoachGuide) => void;
}) => {
  const [step, setStep] = useState<"idle" | "consent" | "working">("idle");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<CoachError | null>(null);
  const { request, ids, groups, omitted } = useMemo(() => buildCoachRequest(agenda, people), [agenda, people]);

  const send = async () => {
    setStep("working");
    setError(null);
    track("coach_requested", { topic_count: request.topics.length, people });
    try {
      const guide = await coach(request);
      onSaved(saveGuide(guide, ids, Date.now(), groups));
      track("coach_result", { outcome: "ok" });
      setStep("idle");
      setAgreed(false);
    } catch (e) {
      const failure = e instanceof CoachError ? e : new CoachError("failed");
      track("coach_result", { outcome: failure.reason });
      setError(failure);
      setStep("consent");
    }
  };

  if (step === "idle") {
    return (
      <section className="discuss-ai" aria-label="AI coach">
        {saved ? (
          <>
            <h2>✦ Prepared with AI</h2>
            {saved.opening && <p className="discuss-coach-opening">{saved.opening}</p>}
            <p>Each topic has suggested questions for you two, alongside the built-in prompts.</p>
            <button type="button" className="discuss-ai-button" onClick={() => setStep("consent")}>
              Prepare again
            </button>
          </>
        ) : (
          <button type="button" className="discuss-ai-button" onClick={() => setStep("consent")}>
            ✦ Prepare this conversation with AI
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="discuss-ai discuss-consent" aria-label="AI coach">
      <h2>Prepare with AI</h2>
      <p>
        An AI (Anthropic's Claude, through OpenRouter) will suggest an opening and questions written for these topics. To do
        that, <strong>this is all that's sent</strong>:
      </p>
      <ul className="discuss-consent-list">
        {coachPreview(request).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {omitted > 0 && (
        <p>
          The last {omitted} topics aren't included ({COACH_LIMITS.maxTopics} at most, to keep each preparation small).
        </p>
      )}
      <p>
        <strong>Never sent:</strong> names, notes, menu titles, or anything you write in this discussion.
        It goes through our server, which doesn't log or keep it, then through OpenRouter to the AI
        provider. Neither uses it for training. The suggestions are saved only in this browser, with
        your notes.
      </p>
      <p>It's a conversation guide, not therapy, and it won't take sides or judge your answers.</p>
      <label className="discuss-consent-check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>Everyone taking part agrees to send this.</span>
      </label>
      {error && (
        <p className="discuss-coach-error" role="alert">
          {coachFailureText(error)}
        </p>
      )}
      <div className="discuss-actions">
        <button type="button" className="button-primary" disabled={!agreed || step === "working"} onClick={send}>
          {step === "working" ? "Preparing…" : "Prepare questions"}
        </button>
        <button type="button" disabled={step === "working"} onClick={() => setStep("idle")}>
          Cancel
        </button>
      </div>
    </section>
  );
};

const SummaryItem = ({ topic, record, names }: { topic: Topic; record: TopicEntry; names: string[] }) => (
  <li className="discuss-summary-item">
    <span className="discuss-summary-swatches" aria-hidden="true">
      {topic.values.map((v, i) => (
        <span key={i} className={`swatch ${compareValueClass(v)}`} />
      ))}
    </span>
    <div>
      <strong>{topic.item}</strong> <span className="discuss-summary-group">· {topic.group}</span>
      <span className="sr-only">
        {" "}
        ({topic.values.map((v, i) => `${names[i]}: ${COMPARE_VALUE_LABELS[compareValueClass(v)]}`).join(", ")})
      </span>
      {record.note?.trim() && <p>{record.note}</p>}
      {record.followUp?.trim() && (
        <p className="discuss-next">
          <strong>Next step:</strong> {record.followUp}
        </p>
      )}
      {record.comments.filter((c) => !c.deleted).length > 0 && (
        <p className="discuss-summary-comments">
          💬 {record.comments.filter((c) => !c.deleted).length} comment
          {record.comments.filter((c) => !c.deleted).length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  </li>
);

/** "Prepare with AI" isn't built yet: measure interest honestly (like the Support page). */
const AiPrepTeaser = () => {
  const [asked, setAsked] = useState(false);
  return (
    <div className="discuss-ai">
      {asked ? (
        <p role="status">
          Thanks! An AI helper that prepares this conversation with you (suggested questions for your
          specific answers, and a recap afterwards) isn't available yet. Knowing you'd use it helps us
          decide to build it. Nothing about your menus was sent.
        </p>
      ) : (
        <button
          type="button"
          className="discuss-ai-button"
          onClick={() => {
            track("ai_prep_interest");
            setAsked(true);
          }}
        >
          ✦ Prepare this conversation with AI (coming soon)
        </button>
      )}
    </div>
  );
};
