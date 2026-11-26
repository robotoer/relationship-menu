import "./CompareOverview.css";
import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ZONES, Zone } from "../compare-focus";
import { GroupedItem, Insights } from "../compare-insights";
import { AnswerList, Swatch } from "./MenuItemCompare";
import { ComparedMenuItemValue } from "../model/compare";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Ana & Ben", "Ana, Ben & Cal". */
export const joinNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;

const isYes = (v: ComparedMenuItemValue) => v === "must-have" || v === "like-to-have";

const FOCUS_LIMIT = 6;
const PERSON_LIMIT = 4;
const ALIGNED_LIMIT = 8;

/**
 * Where you stand (spec CP-30..CP-34): one bar that splits every item into Conflicts,
 * Talk about it, Not answered, Quick checks and Same page (the parts add up to the
 * whole); what to talk about first; what matters most to each person; where you're
 * aligned; and each group at a glance. Every count opens the matching items below.
 */
export const CompareOverview = ({
  insights,
  names,
  onFilter,
  onGroup,
  onShowFocus,
  discussLink,
  topicCount,
  actions,
}: {
  insights: Insights;
  names: string[];
  onFilter: (zone: Zone) => void;
  onGroup: (group: string) => void;
  /** Shows every item, most important first. */
  onShowFocus: () => void;
  /** Where "Talk it through" goes, or undefined when it can't. */
  discussLink?: string;
  /** Topics on the suggested agenda. */
  topicCount: number;
  /** Save / share controls shown with "Talk it through" (CV-1). */
  actions?: ReactNode;
}) => {
  const { total, zones, focus, sharedWants, sharedLimits, byGroup, people } = insights;
  const needTalk = zones.conflict + zones.talk;
  const two = names.length === 2;
  const others = (i: number) => (two ? names[1 - i] : "everyone else");
  const otherIndexes = (i: number) => names.map((_, j) => j).filter((j) => j !== i);

  return (
    <section className="compare-overview" aria-labelledby="compare-overview-title">
      <h2 id="compare-overview-title">Where you stand</h2>
      <p className="overview-headline">
        {joinNames(names)}: you're on the same page on <strong>{zones.aligned}</strong> of {total} items.{" "}
        {needTalk > 0 ? (
          <>
            <strong>{needTalk}</strong> {needTalk === 1 ? "is" : "are"} worth a real conversation
            {zones.conflict > 0 && <>, including {plural(zones.conflict, "conflict")}</>}
            {zones.quick > 0 ? (
              <>
                , and {zones.quick} only need{zones.quick === 1 ? "s" : ""} a quick check.
              </>
            ) : (
              "."
            )}
          </>
        ) : zones.quick > 0 ? (
          <>
            Nothing needs a big conversation; {zones.quick} only need{zones.quick === 1 ? "s" : ""} a quick check.
          </>
        ) : (
          <>Nothing needs a big conversation.</>
        )}
        {zones.open > 0 && <> {plural(zones.open, "item")} {zones.open === 1 ? "isn't" : "aren't"} answered by everyone yet.</>}
      </p>

      <ZoneBar zones={zones} total={total} />
      <ul className="zone-legend" aria-label="Items of each kind">
        {ZONES.map((z) => (
          <li key={z.id}>
            <button
              type="button"
              className={`zone-legend-button zone-${z.id}`}
              onClick={() => onFilter(z.id)}
              disabled={zones[z.id] === 0}
              aria-label={`${z.label}: ${zones[z.id]}. Show these items`}
              title={z.description}
            >
              <span className={`zone-dot zone-${z.id}`} aria-hidden="true" />
              <span className="zone-legend-count">{zones[z.id]}</span> {z.label}
            </button>
          </li>
        ))}
      </ul>

      {discussLink && (
        <div className="overview-discuss">
          <div>
            <strong>Ready to talk it through?</strong>{" "}
            {topicCount > 0 ? (
              <>
                Turn this into a conversation: {plural(topicCount, "topic")}, easiest first, in parts you can take one
                sitting at a time, with notes for each of you and next steps.
              </>
            ) : (
              <>Start a conversation about anything on your menus, with notes for each of you.</>
            )}
          </div>
          <Link className="button button-primary" to={discussLink}>
            ▶ Talk it through
          </Link>
        </div>
      )}
      {actions}

      <div className="overview-columns">
        <div className="overview-panel overview-focus">
          <h3>Talk about these first</h3>
          {focus.length === 0 ? (
            <p className="overview-quiet">Nothing here: no conflicts, differences or unanswered items.</p>
          ) : (
            <>
              <ol className="overview-focus-list">
                {focus.slice(0, FOCUS_LIMIT).map((item) => (
                  <FocusItem key={`${item.group}\u0000${item.item}`} item={item} names={names} />
                ))}
              </ol>
              {focus.length > FOCUS_LIMIT && (
                <button type="button" className="overview-more" onClick={onShowFocus}>
                  See all {focus.length}, most important first
                </button>
              )}
            </>
          )}
        </div>

        <div className="overview-panel overview-people">
          <h3>What matters most to each of you</h3>
          {people.map((p, i) => (
            <div key={i} className="overview-person">
              <h4>{names[i]}</h4>
              <p className="overview-person-stats">
                <span>
                  <Swatch value="must-have" /> {plural(p.mustHave, "must-have")}
                </span>
                <span>
                  <Swatch value="off-limits" /> {p.offLimits} off limits
                </span>
                {p.unanswered + p.notOnMenu > 0 && <span>{p.unanswered + p.notOnMenu} not answered</span>}
              </p>
              {p.mustHave > 0 && p.mustNotShared.length === 0 && (
                <p className="overview-quiet">
                  {two ? `${others(i)} wants` : "Everyone else wants"} all of {names[i]}'s must-haves too.
                </p>
              )}
              {p.mustNotShared.length > 0 && (
                <PersonList
                  title={`Must-haves that aren't a yes for ${others(i)}`}
                  items={p.mustNotShared}
                  names={names}
                  show={(item) => otherIndexes(i).filter((j) => !isYes(item.values[j]))}
                />
              )}
              {p.limitsWanted.length > 0 && (
                <PersonList
                  title={`Off limits, but ${two ? `${others(i)} wants it` : "someone wants it"}`}
                  items={p.limitsWanted}
                  names={names}
                  show={(item) => otherIndexes(i).filter((j) => isYes(item.values[j]))}
                />
              )}
            </div>
          ))}
        </div>

        <div className="overview-stack">
        <div className="overview-panel overview-aligned">
          <h3>Where you're aligned</h3>
          {sharedWants.length + sharedLimits.length === 0 ? (
            <p className="overview-quiet">No item has the same answer from everyone yet.</p>
          ) : (
            <>
              {sharedWants.length > 0 && (
                <>
                  <h4>
                    You all want <span className="overview-count">{sharedWants.length}</span>
                  </h4>
                  <ItemChips items={sharedWants} limit={ALIGNED_LIMIT} />
                </>
              )}
              {sharedLimits.length > 0 && (
                <>
                  <h4>
                    Shared limits <span className="overview-count">{sharedLimits.length}</span>
                  </h4>
                  <ItemChips items={sharedLimits} limit={ALIGNED_LIMIT} />
                </>
              )}
            </>
          )}
        </div>

        {byGroup.length > 1 && (
          <div className="overview-panel overview-groups">
            <h3>By group</h3>
            <ul>
              {byGroup.map((g) => {
                const groupTalk = g.zones.conflict + g.zones.talk;
                return (
                  <li key={g.group}>
                    <button
                      type="button"
                      className="overview-group-name link-button"
                      onClick={() => onGroup(g.group)}
                      title={`Show ${g.group}`}
                    >
                      {g.group}
                    </button>
                    <ZoneBar zones={g.zones} total={g.total} small label={g.group} />
                    <span className="overview-group-stat">
                      {g.zones.conflict > 0 && <span className="overview-flag">{plural(g.zones.conflict, "conflict")}</span>}
                      {g.zones.conflict > 0 && g.zones.talk > 0 && " · "}
                      {g.zones.talk > 0 && <>{g.zones.talk} to talk</>}
                      {groupTalk === 0 && (g.zones.aligned === g.total ? "All aligned" : g.zones.open > 0 ? `${g.zones.open} open` : "Quick checks only")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        </div>
      </div>
    </section>
  );
};

/** A bar split into the five zones, in proportion; the parts add up to the whole (CP-30). */
const ZoneBar = ({
  zones,
  total,
  small,
  label,
}: {
  zones: Record<Zone, number>;
  total: number;
  small?: boolean;
  label?: string;
}) => (
  <div
    className={`zone-bar${small ? " zone-bar-small" : ""}`}
    role="img"
    aria-label={`${label ? `${label}: ` : ""}${ZONES.filter((z) => zones[z.id] > 0)
      .map((z) => `${zones[z.id]} ${z.label.toLowerCase()}`)
      .join(", ")}`}
  >
    {total > 0 &&
      ZONES.filter((z) => zones[z.id] > 0).map((z) => (
        <span key={z.id} className={`zone-${z.id}`} style={{ flexGrow: zones[z.id] }}>
          {!small && zones[z.id] / total >= 0.06 ? zones[z.id] : ""}
        </span>
      ))}
  </div>
);

const FocusItem = ({ item, names }: { item: GroupedItem; names: string[] }) => {
  const notes = (item.notes ?? [])
    .map((note, i) => ({ note: note?.trim(), who: names[i] ?? `Menu ${i + 1}` }))
    .filter((n): n is { note: string; who: string } => !!n.note);
  return (
    <li>
      <div className="overview-focus-title">
        <strong>{item.item}</strong> <span className="overview-group-caption">· {item.group}</span>
      </div>
      <AnswerList values={item.values} names={names} />
      {notes.length > 0 && (
        <ul className="overview-notes" aria-label={`Notes on ${item.item}`}>
          {notes.map((n) => (
            <li key={n.who}>
              <span className="compare-note-who">{n.who}:</span> “{n.note}”
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

const PersonList = ({
  title,
  items,
  names,
  show,
}: {
  title: string;
  items: GroupedItem[];
  names: string[];
  /** Whose answers to show for each item (column indexes). */
  show: (item: GroupedItem) => number[];
}) => (
  <>
    <p className="overview-person-heading">{title}:</p>
    <ul className="overview-person-items">
      {items.slice(0, PERSON_LIMIT).map((item) => (
        <li key={`${item.group}\u0000${item.item}`}>
          <span>{item.item}</span>
          <AnswerList className="answer-list-compact" values={item.values} names={names} only={show(item)} />
        </li>
      ))}
      {items.length > PERSON_LIMIT && <li className="overview-quiet">and {items.length - PERSON_LIMIT} more</li>}
    </ul>
  </>
);

const ItemChips = ({ items, limit }: { items: GroupedItem[]; limit: number }) => (
  <ul className="overview-chips">
    {items.slice(0, limit).map((item) => (
      <li key={`${item.group}\u0000${item.item}`} title={item.group}>
        {item.item}
      </li>
    ))}
    {items.length > limit && <li className="overview-chip-more">+{items.length - limit} more</li>}
  </ul>
);
