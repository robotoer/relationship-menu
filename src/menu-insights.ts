/**
 * "Just for fun" (docs/spec/insights.md, IN-1..IN-9): a menu's theme scores, its
 * animal and style, and its badges. Pure functions over the menu alone: nothing
 * here is sent or stored (IN-1), and the words come from insights-content.ts.
 */

import { ANSWER_RANK } from "./compare-insights";
import {
  BADGE_IDS,
  BADGE_TEXT,
  BadgeId,
  GROUP_THEMES,
  ITEM_THEMES,
  Style,
  THEMES,
  THEME_KEYWORDS,
  Theme,
} from "./insights-content";
import { RelationshipMenu, RelationshipMenuItemValue } from "./model/menu";

/** Answered items needed before there's an animal (IN-4). */
export const HATCH_AT = 5;
/** Answered items a theme needs before it has a score (IN-3). */
export const THEME_MIN = 2;
/** A second theme needs at least this score to add a "streak" (IN-4). */
export const STREAK_MIN = 2;

/** Lower case, single spaces, straight quotes: how template text is matched (IN-2). */
export const normalizeText = (text: string) =>
  text.replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();

const lookup = (byTheme: Record<Theme, string[]>) => {
  const map = new Map<string, Theme>();
  for (const theme of THEMES) for (const text of byTheme[theme]) map.set(normalizeText(text), theme);
  return map;
};
const ITEM_LOOKUP = lookup(ITEM_THEMES);
const GROUP_LOOKUP = lookup(GROUP_THEMES);

/** Whether this text is one of the template items (so not someone's own). */
export const isTemplateItem = (text: string) => ITEM_LOOKUP.has(normalizeText(text));

const keywordTheme = (text: string): Theme | null =>
  THEME_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;

/** IN-2: template tag, else item keywords, else group tag, else group keywords. */
export const themeOf = (item: string, group: string): Theme | null =>
  ITEM_LOOKUP.get(normalizeText(item)) ??
  keywordTheme(item) ??
  GROUP_LOOKUP.get(normalizeText(group)) ??
  keywordTheme(group);

export const ANSWERS = Object.keys(ANSWER_RANK) as RelationshipMenuItemValue[];
/** One of the four answers; anything else counts as unanswered (DM-2). */
export const isAnswer = (value: unknown): value is RelationshipMenuItemValue =>
  typeof value === "string" && (ANSWERS as string[]).includes(value);

export type ThemeScore = {
  theme: Theme;
  answered: number;
  /** Mean answer rank, 0 (Off limits) to 3 (Must have); null below THEME_MIN answers. */
  score: number | null;
};

export type MenuAnimal =
  | { kind: "hatching"; needed: number }
  /** `theme` is null for the Chameleon: answers, but no theme with a score. */
  | { kind: "animal"; theme: Theme | null; style: Style; streak: Theme | null };

export type Badge = { id: BadgeId; earned: boolean };

export type MenuInsights = {
  /** Non-blank items. */
  items: number;
  answered: number;
  counts: Record<RelationshipMenuItemValue, number>;
  notes: number;
  ownItems: number;
  /** One per theme, in THEMES order. */
  themes: ThemeScore[];
  animal: MenuAnimal;
  /** Every effort badge, and the answer badges that are earned (IN-7), in BADGE_IDS order. */
  badges: Badge[];
};

/** IN-5: the first style that applies to the answered items. */
export const styleOf = (counts: Record<RelationshipMenuItemValue, number>, answered: number): Style => {
  const share = (value: RelationshipMenuItemValue) => (answered > 0 ? counts[value] / answered : 0);
  if (share("maybe") >= 0.4) return "curious";
  if (share("must-have") >= 0.5) return "wholehearted";
  if (share("off-limits") >= 0.3) return "discerning";
  if (counts.maybe === 0) return "decisive";
  return "easygoing";
};

/** Themes with a score, best first: score, then answered items, then theme order (IN-4). */
export const rankThemes = (themes: ThemeScore[]): ThemeScore[] =>
  themes
    .filter((t) => t.score !== null)
    .sort(
      (a, b) =>
        (b.score as number) - (a.score as number) ||
        b.answered - a.answered ||
        THEMES.indexOf(a.theme) - THEMES.indexOf(b.theme)
    );

export const menuInsights = (menu: RelationshipMenu): MenuInsights => {
  const counts: Record<RelationshipMenuItemValue, number> = {
    "must-have": 0,
    "like-to-have": 0,
    maybe: 0,
    "off-limits": 0,
  };
  const sums = new Map<Theme, { answered: number; total: number }>();
  let items = 0;
  let answered = 0;
  let notes = 0;
  let ownItems = 0;

  for (const [group, groupItems] of Object.entries(menu ?? {})) {
    if (!Array.isArray(groupItems)) continue;
    for (const entry of groupItems) {
      if (!entry || typeof entry.item !== "string" || !entry.item.trim()) continue;
      items++;
      if (!isTemplateItem(entry.item)) ownItems++;
      if (typeof entry.note === "string" && entry.note.trim()) notes++;
      if (!isAnswer(entry.value)) continue;
      answered++;
      counts[entry.value]++;
      const theme = themeOf(entry.item, group);
      if (!theme) continue;
      const sum = sums.get(theme) ?? { answered: 0, total: 0 };
      sum.answered++;
      sum.total += ANSWER_RANK[entry.value];
      sums.set(theme, sum);
    }
  }

  const themes: ThemeScore[] = THEMES.map((theme) => {
    const sum = sums.get(theme) ?? { answered: 0, total: 0 };
    return {
      theme,
      answered: sum.answered,
      score: sum.answered >= THEME_MIN ? sum.total / sum.answered : null,
    };
  });

  let animal: MenuAnimal;
  if (answered < HATCH_AT) {
    animal = { kind: "hatching", needed: HATCH_AT - answered };
  } else {
    const [top, second] = rankThemes(themes);
    animal = {
      kind: "animal",
      theme: top?.theme ?? null,
      style: styleOf(counts, answered),
      streak: second && (second.score as number) >= STREAK_MIN ? second.theme : null,
    };
  }

  const earned: Record<BadgeId, boolean> = {
    hatched: answered >= HATCH_AT,
    cartographer: items >= 10 && answered === items,
    "well-rounded": themes.every((t) => t.score !== null),
    "fine-print": notes >= 5,
    homebrewer: ownItems >= 3,
    "boundary-keeper": counts["off-limits"] > 0,
    "full-spectrum": ANSWERS.every((value) => counts[value] > 0),
  };
  const badges = BADGE_IDS.filter((id) => BADGE_TEXT[id].kind === "effort" || earned[id]).map(
    (id): Badge => ({ id, earned: earned[id] })
  );

  return { items, answered, counts, notes, ownItems, themes, animal, badges };
};

/** IN-6: "Another one" goes through a fixed list; any whole number picks a wording. */
export const pickWording = <T>(options: readonly T[], variant: number): T =>
  options[((Math.trunc(variant) % options.length) + options.length) % options.length];
