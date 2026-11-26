import "./Discuss.css";
import "../components/CompareOverview.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  COACH_FAILURE_TEXT,
  CoachClient,
  CoachError,
  CoachFailure,
  SavedCoachGuide,
  buildCoachRequest,
  coachPreview,
  saveGuide,
} from "../coach";
import { Link } from "react-router-dom";
import { track } from "../analytics";
import { platform } from "../platform";
import { COMPARE_VALUE_LABELS, compareValueClass } from "../components/MenuItemCompare";
import {
  DiscussionRecord,
  GROUND_RULES,
  OUTCOMES,
  Outcome,
  Topic,
  TOPIC_KINDS,
  TopicRecord,
  discussionSummary,
  emptyRecord,
  isCovered,
  loadDiscussion,
  saveDiscussion,
} from "../discussion";

type View = { kind: "intro" } | { kind: "topic"; index: number } | { kind: "summary" };

/**
 * A guided conversation through a comparison (spec §7b): ground rules, then one
 * topic at a time with everyone's answers, prompts, notes and an outcome, then a
 * summary to keep. Notes are saved in this browser only (DS-5).
 */
export const DiscussPage = ({
  agenda,
  names,
  recordKey,
  compareLink,
  coach,
}: {
  agenda: Topic[];
  names: string[];
  /** localStorage key for this discussion's notes. */
  recordKey: string;
  compareLink: string;
  /** The AI coach, when this browser can use it (a supporter); otherwise a teaser. */
  coach?: CoachClient;
}) => {
  const [record, setRecord] = useState<DiscussionRecord>(
    () => loadDiscussion(recordKey) ?? emptyRecord(Date.now())
  );
  const [view, setView] = useState<View>({ kind: "intro" });
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const covered = agenda.filter((t) => isCovered(record.topics[t.key])).length;
  const firstOpen = Math.max(0, agenda.findIndex((t) => !isCovered(record.topics[t.key])));
  const summary = useMemo(() => discussionSummary(agenda, record, names), [agenda, record, names]);

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

  const saveCoach = (guide: SavedCoachGuide) =>
    setRecord((prev) => {
      const next = { ...prev, updatedAt: Date.now(), coach: guide };
      saveDiscussion(recordKey, next);
      return next;
    });

  const update = (key: string, change: Partial<TopicRecord>) => {
    setRecord((prev) => {
      const topics: Record<string, TopicRecord> = Object.assign(Object.create(null), prev.topics);
      topics[key] = { ...topics[key], ...change };
      const next = { ...prev, updatedAt: Date.now(), topics };
      saveDiscussion(recordKey, next);
      return next;
    });
  };

  const start = (index: number) => {
    track("discussion_started", { topic_count: agenda.length, menu_count: names.length, resumed: covered > 0 });
    setView({ kind: "topic", index });
  };

  if (agenda.length === 0) {
    return (
      <div className="discuss-page">
        <h1>Talk it through</h1>
        <p>There's nothing to discuss: you agree on everything you've both answered. Enjoy that.</p>
        <Link className="button" to={compareLink}>
          Back to the comparison
        </Link>
      </div>
    );
  }

  if (view.kind === "intro") {
    const byKind = Object.entries(TOPIC_KINDS)
      .map(([kind, info]) => ({ ...info, count: agenda.filter((t) => t.kind === kind).length }))
      .filter((k) => k.count > 0);
    return (
      <div className="discuss-page">
        <h1 tabIndex={-1} ref={heading}>
          Talk it through
        </h1>
        <p className="discuss-lead">
          {names.join(" & ")}: {agenda.length} topic{agenda.length === 1 ? "" : "s"}, about{" "}
          {Math.max(5, agenda.length * 3)} minutes. Start with something you share, then work towards
          the harder ones. You can stop any time; your notes are kept in this browser.
        </p>
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
        <div className="discuss-actions">
          <button type="button" className="button-primary" onClick={() => start(covered > 0 ? firstOpen : 0)}>
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
        {coach ? (
          <CoachPanel agenda={agenda} people={names.length} coach={coach} saved={record.coach} onSaved={saveCoach} />
        ) : platform().aiTeaser ? (
          <AiPrepTeaser />
        ) : null}
        <SafetyNote />
      </div>
    );
  }

  if (view.kind === "summary") {
    const download = () => {
      const file = new File([summary], "relationship-menu-discussion.md", { type: "text/markdown" });
      void platform()
        .saveFile(file)
        .then((outcome) => {
          if (outcome !== "cancelled") track("discussion_summary_exported", { method: "download" });
        }, (e) => console.error("Couldn't save the summary:", e));
    };
    return (
      <div className="discuss-page">
        <h1 tabIndex={-1} ref={heading}>
          Your discussion
        </h1>
        <p className="discuss-lead">
          {covered} of {agenda.length} topics discussed. These notes are saved only in this browser;
          copy or download them to keep them somewhere else.
        </p>
        {record.coach?.closing && <p className="discuss-coach-closing">{record.coach.closing}</p>}
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
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
                track("discussion_summary_exported", { method: "copy" });
              } catch (e) {
                console.error("Copy failed:", e);
              }
            }}
          >
            {copied ? "Copied!" : "Copy summary"}
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
          <button type="button" onClick={() => setView({ kind: "topic", index: firstOpen })}>
            Back to topics
          </button>
          <Link className="button" to={compareLink}>
            Back to the comparison
          </Link>
        </div>
        <SafetyNote />
      </div>
    );
  }

  const topic = agenda[view.index];
  const r = record.topics[topic.key] ?? {};
  const last = view.index === agenda.length - 1;
  const go = (index: number) => setView(index >= agenda.length ? { kind: "summary" } : { kind: "topic", index });
  return (
    <div className="discuss-page discuss-topic-view">
      <nav className="discuss-progress" aria-label="Topics">
        <ol>
          {agenda.map((t, i) => (
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
          {view.index + 1} / {agenda.length}
        </span>
      </nav>

      <article className={`discuss-card kind-${topic.kind}`}>
        <p className="discuss-kind">
          {TOPIC_KINDS[topic.kind].label} · {topic.group}
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
              {topic.notes?.[i] && <span className="discuss-their-note">"{topic.notes[i]}"</span>}
            </li>
          ))}
        </ul>

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
        <h2>{record.coach?.topics[topic.key] ? "More to talk about" : "Talk about"}</h2>
        <ul className="discuss-prompts">
          {topic.prompts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>

        <label className="discuss-field">
          <span>What came up?</span>
          <textarea
            value={r.note ?? ""}
            rows={4}
            placeholder="Notes for both of you: what you each said, what you learned"
            onChange={(e) => update(topic.key, { note: e.target.value })}
          />
        </label>

        <fieldset className="discuss-outcomes">
          <legend>Where did you land?</legend>
          {OUTCOMES.map((o) => (
            <label key={o.id} className={`discuss-outcome-option outcome-${o.id}`}>
              <input
                type="radio"
                name={`outcome-${view.index}`}
                checked={r.outcome === o.id}
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
            value={r.followUp ?? ""}
            placeholder="e.g. Try it for a month, then check in"
            onChange={(e) => update(topic.key, { followUp: e.target.value })}
          />
        </label>
      </article>

      <div className="discuss-actions discuss-nav">
        <button type="button" onClick={() => (view.index === 0 ? setView({ kind: "intro" }) : go(view.index - 1))}>
          ◀ Back
        </button>
        <button type="button" className="button-primary" onClick={() => go(view.index + 1)}>
          {last ? "Finish ▶" : isCovered(r) ? "Next ▶" : "Skip for now ▶"}
        </button>
        <button type="button" onClick={() => setView({ kind: "summary" })}>
          Summary
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
  const [error, setError] = useState<CoachFailure | null>(null);
  const { request, ids, omitted } = useMemo(() => buildCoachRequest(agenda, people), [agenda, people]);

  const send = async () => {
    setStep("working");
    setError(null);
    track("coach_requested", { topic_count: request.topics.length, people });
    try {
      const guide = await coach(request);
      onSaved(saveGuide(guide, ids));
      track("coach_result", { outcome: "ok" });
      setStep("idle");
      setAgreed(false);
    } catch (e) {
      const reason = e instanceof CoachError ? e.reason : "failed";
      track("coach_result", { outcome: reason });
      setError(reason);
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
        An AI (Anthropic's Claude) will suggest an opening and questions written for these topics. To do
        that, <strong>this is all that's sent</strong>:
      </p>
      <ul className="discuss-consent-list">
        {coachPreview(request).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {omitted > 0 && <p>The last {omitted} topics aren't included (40 at most).</p>}
      <p>
        <strong>Never sent:</strong> names, notes, menu titles, or anything you write in this discussion.
        It goes through our server, which doesn't log or keep it. The suggestions are saved only in this
        browser, with your notes.
      </p>
      <p>It's a conversation guide, not therapy, and it won't take sides or judge your answers.</p>
      <label className="discuss-consent-check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>Everyone taking part agrees to send this.</span>
      </label>
      {error && (
        <p className="discuss-coach-error" role="alert">
          {COACH_FAILURE_TEXT[error]}
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

const SummaryItem = ({ topic, record, names }: { topic: Topic; record: TopicRecord; names: string[] }) => (
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
