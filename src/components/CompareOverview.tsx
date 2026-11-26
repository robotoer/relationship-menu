import "./CompareOverview.css";
import { Link } from "react-router-dom";
import { CompareFilter } from "../compare-filters";
import { Insights } from "../compare-insights";
import { COMPARE_VALUE_LABELS, compareValueClass } from "./MenuItemCompare";

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * The comparison at a glance (spec CP-20..CP-24): headline numbers, alignment per
 * group, the biggest differences, each person's answers, and a way into a guided
 * discussion. The number tiles double as filter shortcuts.
 */
export const CompareOverview = ({
  insights,
  names,
  onFilter,
  discussLink,
  topicCount,
}: {
  insights: Insights;
  names: string[];
  onFilter: (filter: CompareFilter) => void;
  /** Where "Talk it through" goes, or undefined when there's nothing to discuss. */
  discussLink?: string;
  topicCount: number;
}) => {
  const { counts, alignment, fullyAnswered, byGroup, people, topDifferences } = insights;
  const open = counts.unanswered + counts.missing;
  const tiles: { filter: CompareFilter; label: string; value: number; className: string }[] = [
    { filter: "both-want", label: "Shared wants", value: counts["both-want"], className: "tile-want" },
    { filter: "agree", label: "Agree", value: counts.agree, className: "tile-agree" },
    { filter: "differ", label: "Talk about it", value: counts.differ, className: "tile-differ" },
    { filter: "conflict", label: "Conflicts", value: counts.conflict, className: "tile-conflict" },
  ];

  return (
    <section className="compare-overview" aria-labelledby="compare-overview-title">
      <h2 id="compare-overview-title">At a glance</h2>
      <p className="overview-headline">
        {alignment === null ? (
          <>No item has been answered by everyone yet.</>
        ) : (
          <>
            You agree on <strong>{percent(alignment)}</strong> of the {fullyAnswered} items everyone
            answered
            {counts.conflict > 0 ? (
              <>
                , with <strong>{counts.conflict}</strong> conflict{counts.conflict === 1 ? "" : "s"}
              </>
            ) : (
              <>, and there are no conflicts</>
            )}
            .
          </>
        )}
        {open > 0 && <> {open} item{open === 1 ? " isn't" : "s aren't"} answered by everyone yet.</>}
      </p>

      <div className="overview-tiles">
        {tiles.map((tile) => (
          <button
            key={tile.filter}
            type="button"
            className={`overview-tile ${tile.className}`}
            onClick={() => onFilter(tile.filter)}
            aria-label={`${tile.label}: ${tile.value}. Show these items`}
          >
            <span className="overview-tile-value">{tile.value}</span>
            <span className="overview-tile-label">{tile.label}</span>
          </button>
        ))}
      </div>

      {discussLink && topicCount > 0 && (
        <div className="overview-discuss">
          <div>
            <strong>Ready to talk it through?</strong> A guided conversation goes through{" "}
            {topicCount} topic{topicCount === 1 ? "" : "s"}, easiest first, with prompts and a place
            for notes and decisions.
          </div>
          <Link className="button button-primary" to={discussLink}>
            ▶ Talk it through
          </Link>
        </div>
      )}

      <div className="overview-columns">
        {byGroup.length > 1 && (
          <div className="overview-panel">
            <h3>By group</h3>
            <ul className="overview-groups">
              {byGroup.map((g) => (
                <li key={g.group}>
                  <span className="overview-group-name">{g.group}</span>
                  <span
                    className="overview-bar"
                    role="img"
                    aria-label={
                      g.alignment === null
                        ? `${g.group}: not enough answers yet`
                        : `${g.group}: ${percent(g.alignment)} agree`
                    }
                  >
                    <span style={{ width: g.alignment === null ? 0 : percent(g.alignment) }} />
                  </span>
                  <span className="overview-group-stat">
                    {g.alignment === null ? "–" : percent(g.alignment)}
                    {g.conflict > 0 && (
                      <span className="overview-flag">
                        {" "}· {g.conflict} conflict{g.conflict === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {topDifferences.length > 0 && (
          <div className="overview-panel">
            <h3>Biggest differences</h3>
            <ol className="overview-differences">
              {topDifferences.map((item) => (
                <li key={`${item.group}\u0000${item.item}`}>
                  <span className="overview-diff-swatches" aria-hidden="true">
                    {item.values.map((v, i) => (
                      <span key={i} className={`swatch ${compareValueClass(v)}`} />
                    ))}
                  </span>
                  <span className="overview-diff-text">
                    {item.item}
                    <span className="overview-diff-group"> · {item.group}</span>
                    <span className="sr-only">
                      {" "}
                      ({item.values
                        .map((v, i) => `${names[i]}: ${COMPARE_VALUE_LABELS[compareValueClass(v)]}`)
                        .join(", ")}
                      )
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="overview-panel">
          <h3>Each person</h3>
          <ul className="overview-people">
            {people.map((p, i) => (
              <li key={i}>
                <span className="overview-person-name">{names[i]}</span>
                <span className="overview-person-stats">
                  <span className="swatch must-have" aria-hidden="true" /> {p.mustHave} must
                  <span className="swatch off-limits" aria-hidden="true" /> {p.offLimits} off limits
                  {p.unanswered + p.notOnMenu > 0 && <> · {p.unanswered + p.notOnMenu} open</>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};
