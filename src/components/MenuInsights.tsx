import "./MenuInsights.css";
import { useMemo, useState } from "react";
import {
  BADGE_TEXT,
  CHAMELEON,
  EGG_EMOJI,
  STYLE_TEXT,
  THEME_ANIMALS,
  THEME_LABELS,
} from "../insights-content";
import { MenuAnimal, menuInsights, pickWording } from "../menu-insights";
import { RelationshipMenu } from "../model/menu";

/** "A Curious Otter" / "An Easygoing Cat". */
const withArticle = (phrase: string) => `${/^[aeiou]/i.test(phrase) ? "An" : "A"} ${phrase}`;

const AnimalCard = ({ animal }: { animal: MenuAnimal }) => {
  const [variant, setVariant] = useState(0);
  if (animal.kind === "hatching") {
    return (
      <div className="insights-animal">
        <span className="insights-emoji" aria-hidden="true">
          {EGG_EMOJI}
        </span>
        <div>
          <h3>Still hatching</h3>
          <p>
            Answer {animal.needed} more item{animal.needed === 1 ? "" : "s"} to see what hatches.
          </p>
        </div>
      </div>
    );
  }
  const creature = animal.theme ? THEME_ANIMALS[animal.theme] : CHAMELEON;
  const style = STYLE_TEXT[animal.style];
  return (
    <div className="insights-animal">
      <span className="insights-emoji" aria-hidden="true">
        {creature.emoji}
      </span>
      <div>
        <h3>
          {withArticle(`${style.adjective} ${creature.name}`)}
          {animal.streak && (
            <>
              {" "}
              <span className="insights-streak">
                with a streak of {THEME_ANIMALS[animal.streak].name}
              </span>
            </>
          )}
        </h3>
        <p className="insights-blurb" aria-live="polite">
          {pickWording(creature.blurbs, variant)}
        </p>
        <p className="insights-style">{style.description}</p>
        <button type="button" className="insights-another" onClick={() => setVariant((v) => v + 1)}>
          Another one
        </button>
      </div>
    </div>
  );
};

/**
 * "Just for fun" under the editor (docs/spec/insights.md): the menu's animal, its
 * stats and its badges. Worked out here from the menu alone; nothing is sent (IN-1).
 */
export const MenuInsights = ({ menu }: { menu: RelationshipMenu }) => {
  const { animal, themes, badges } = useMemo(() => menuInsights(menu), [menu]);
  const sortedBadges = [...badges.filter((b) => b.earned), ...badges.filter((b) => !b.earned)];

  return (
    <section className="menu-insights" aria-labelledby="menu-insights-title">
      <h2 id="menu-insights-title">Just for fun</h2>
      <AnimalCard animal={animal} />

      <h3>Stats</h3>
      <ul className="insights-stats">
        {themes.map(({ theme, score }) => (
          <li key={theme}>
            <span className="insights-stat-label">{THEME_LABELS[theme]}</span>
            <span className="insights-stat-bar" aria-hidden="true">
              <span style={{ width: `${((score ?? 0) / 3) * 100}%` }} />
            </span>
            <span className="insights-stat-value">
              {score === null ? (
                <>
                  <span aria-hidden="true">?</span>
                  <span className="sr-only">not enough answers yet</span>
                </>
              ) : (
                <>
                  {score.toFixed(1)}
                  <span className="sr-only"> out of 3</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      <h3>Badges</h3>
      <ul className="insights-badges">
        {sortedBadges.map(({ id, earned }) => {
          const badge = BADGE_TEXT[id];
          return (
            <li key={id} className={earned ? "insights-badge" : "insights-badge is-locked"}>
              <span className="insights-badge-emoji" aria-hidden="true">
                {earned ? badge.emoji : "🔒"}
              </span>
              <span>
                <strong>{badge.name}</strong>
                {!earned && <span className="sr-only"> (not yet earned)</span>}
                <span className="insights-badge-text">{earned ? badge.earned : badge.hint}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="insights-footnote">
        Just for fun, and not a personality test. Worked out in this browser from the answers;
        nothing is sent anywhere.
      </p>
    </section>
  );
};
