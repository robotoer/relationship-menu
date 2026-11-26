import "./MenuInsights.css";
import { useMemo, useState } from "react";
import {
  BADGE_TEXT,
  CHAMELEON,
  EGG_EMOJI,
  RARITY_TEXT,
  SHAPESHIFTER,
  STYLE_TEXT,
  THEME_ANIMALS,
  THEME_CLASSES,
  THEME_LABELS,
} from "../insights-content";
import {
  MenuInsights as Insights,
  menuInsights,
  pickWording,
} from "../menu-insights";
import { characterSheet, lootName, menuLoot } from "../menu-loot";
import { RelationshipMenu, RelationshipMenuItemValue } from "../model/menu";

/** "A Curious Otter" / "An Easygoing Cat". */
const withArticle = (phrase: string) =>
  `${/^[aeiou]/i.test(phrase) ? "An" : "A"} ${phrase}`;

const LINE_LABEL: Record<RelationshipMenuItemValue, string> = {
  "must-have": "+3",
  "like-to-have": "+1",
  maybe: "Unidentified:",
  "off-limits": "Immune to:",
};

/** The face-down card while too few items are answered (IN-4). */
const CardBack = ({ needed }: { needed: number }) => (
  <div className="fun-card fun-card-back">
    <div className="fun-card-frame">
      <span className="insights-emoji" aria-hidden="true">
        {EGG_EMOJI}
      </span>
      <h3>Still hatching</h3>
      <p>
        Answer {needed} more item{needed === 1 ? "" : "s"} to see what hatches.
      </p>
    </div>
  </div>
);

/**
 * The menu as one collectible card (IN-14): name and level, the animal in its art
 * window, class and rarity on the type line, its ability, stats and loot, and the
 * class's flavor text. Colours are decorative; everything is also written out.
 */
const CreatureCard = ({
  menu,
  insights,
}: {
  menu: RelationshipMenu;
  insights: Insights;
}) => {
  const [wording, setWording] = useState(0);
  const [roll, setRoll] = useState(0);
  const loot = useMemo(
    () => menuLoot(menu, insights, roll),
    [menu, insights, roll],
  );
  const sheet = characterSheet(insights);
  const { animal, themes } = insights;
  if (animal.kind !== "animal" || !sheet || !loot) return null;

  const creature = animal.theme ? THEME_ANIMALS[animal.theme] : CHAMELEON;
  const characterClass = sheet.theme
    ? THEME_CLASSES[sheet.theme]
    : SHAPESHIFTER;
  const style = STYLE_TEXT[animal.style];
  const rarity = RARITY_TEXT[loot.rarity];

  return (
    <article
      className={`fun-card theme-${animal.theme ?? "none"} rarity-${loot.rarity}`}
      aria-labelledby="fun-card-name"
    >
      <div className="fun-card-frame">
        <header className="fun-card-name">
          <h3 id="fun-card-name">
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
          <span className="fun-card-level" aria-hidden="true">
            LV<b>{sheet.level}</b>
          </span>
        </header>

        <div className="fun-card-art">
          <span className="fun-card-creature insights-emoji" aria-hidden="true">
            {creature.emoji}
          </span>
          {animal.streak && (
            <span className="fun-card-streak insights-emoji" aria-hidden="true">
              {THEME_ANIMALS[animal.streak].emoji}
            </span>
          )}
        </div>

        <p className="fun-card-type">
          <span>
            <strong>
              Level {sheet.level} {characterClass.name}
            </strong>
            {sheet.multiclass && (
              <span className="insights-multiclass">
                {" "}
                · multiclass {THEME_CLASSES[sheet.multiclass].name}
              </span>
            )}
          </span>
          <span className="insights-rarity">{rarity.label}</span>
        </p>

        <div className="fun-card-text">
          <div className="fun-card-ability">
            <p className="insights-blurb" aria-live="polite">
              {pickWording(creature.blurbs, wording)}
            </p>
            <p className="insights-style">{style.description}</p>
            <button
              type="button"
              className="fun-card-button"
              onClick={() => setWording((v) => v + 1)}
            >
              Another one
            </button>
          </div>

          <h4>Stats</h4>
          <ul className="insights-stats" aria-label="Stats">
            {themes.map(({ theme, score }) => (
              <li key={theme}>
                <span className="insights-stat-label">
                  {THEME_LABELS[theme]}
                </span>
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

          <h4>Loot</h4>
          <div className="insights-loot">
            <p className="insights-loot-name" aria-live="polite">
              <strong>{lootName(loot)}</strong>
            </p>
            {loot.themeStats.length > 0 && (
              <p className="insights-loot-themes">
                {loot.themeStats
                  .map(
                    ({ theme, score }) =>
                      `+${score.toFixed(1)} ${THEME_LABELS[theme]}`,
                  )
                  .join(" · ")}
              </p>
            )}
            {loot.lines.length > 0 && (
              <ul className="insights-loot-lines" aria-label="Loot lines">
                {loot.lines.map(({ answer, text }) => (
                  <li key={`${answer}:${text}`} className={`line-${answer}`}>
                    <span className="insights-loot-mark" aria-hidden="true" />
                    {LINE_LABEL[answer]} {text}
                  </li>
                ))}
              </ul>
            )}
            <p className="insights-loot-flavor">{rarity.flavor}</p>
            <button
              type="button"
              className="fun-card-button"
              onClick={() => setRoll((v) => v + 1)}
            >
              Roll again
            </button>
          </div>
        </div>

        <p className="fun-card-flavor">{characterClass.flavor}</p>
        <footer className="fun-card-foot">
          <span>
            {insights.answered}/{insights.items} answered
          </span>
          <span>Just for fun</span>
        </footer>
      </div>
    </article>
  );
};

/**
 * "Just for fun" under the editor (docs/spec/insights.md): the menu's card (its
 * animal, character sheet and loot) and its badges. Worked out here from the menu
 * alone; nothing is sent (IN-1).
 */
export const MenuInsights = ({ menu }: { menu: RelationshipMenu }) => {
  const insights = useMemo(() => menuInsights(menu), [menu]);
  const { animal, badges } = insights;
  const sortedBadges = [
    ...badges.filter((b) => b.earned),
    ...badges.filter((b) => !b.earned),
  ];

  return (
    <section className="menu-insights" aria-labelledby="menu-insights-title">
      <h2 id="menu-insights-title">Just for fun</h2>
      <div className="fun-layout">
        {animal.kind === "hatching" ? (
          <CardBack needed={animal.needed} />
        ) : (
          <CreatureCard menu={menu} insights={insights} />
        )}

        <div className="fun-badges">
          <h3>Badges</h3>
          <ul className="insights-badges" aria-label="Badges">
            {sortedBadges.map(({ id, earned }) => {
              const badge = BADGE_TEXT[id];
              return (
                <li
                  key={id}
                  className={
                    earned ? "insights-badge" : "insights-badge is-locked"
                  }
                >
                  <span className="insights-badge-emoji" aria-hidden="true">
                    {earned ? badge.emoji : "🔒"}
                  </span>
                  <span>
                    <strong>{badge.name}</strong>
                    {!earned && (
                      <span className="sr-only"> (not yet earned)</span>
                    )}
                    <span className="insights-badge-text">
                      {earned ? badge.earned : badge.hint}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <p className="insights-footnote">
        Just for fun, and not a personality test. Worked out in this browser
        from the answers; nothing is sent anywhere.
      </p>
    </section>
  );
};
