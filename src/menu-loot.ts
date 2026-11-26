/**
 * "Just for fun", phase 2 (docs/spec/insights.md, IN-10..IN-13): the RPG character
 * sheet and the loot item. Pure functions over the menu and its insights; the words
 * come from insights-content.ts.
 */

import {
  LOOT_BASES,
  LOOT_PREFIXES,
  LOOT_SUFFIXES,
  Rarity,
  SENSITIVE_ITEMS,
  SENSITIVE_KEYWORDS,
  Theme,
} from "./insights-content";
import { MenuInsights, isAnswer, normalizeText, pickWording, rankThemes } from "./menu-insights";
import { RelationshipMenu, RelationshipMenuItemValue } from "./model/menu";

/** Longest quote on a loot item (IN-12). */
export const QUOTE_MAX = 40;
/** One level per this many answered items, up to MAX_LEVEL (IN-10). */
export const LEVEL_EVERY = 5;
export const MAX_LEVEL = 20;

const SENSITIVE_LOOKUP = new Set(SENSITIVE_ITEMS.map(normalizeText));

/** IN-12: a flagged template item, or own text on a tender topic. */
export const isSensitive = (text: string) =>
  SENSITIVE_LOOKUP.has(normalizeText(text)) || SENSITIVE_KEYWORDS.test(text);

/**
 * IN-12: the lines where a quote could read as a dig ("Immune to", "Unidentified").
 * Tender topics are quoted only as things wanted, never here.
 */
export const JOKE_LINES: readonly RelationshipMenuItemValue[] = ["maybe", "off-limits"];

/** Whether this item may be quoted on the line for its answer (IN-12). */
export const canQuote = (text: string, answer: RelationshipMenuItemValue) =>
  !(JOKE_LINES.includes(answer) && isSensitive(text));

/** Single spaces, cut to QUOTE_MAX characters with "…" (IN-12). */
export const quote = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= QUOTE_MAX ? clean : `${clean.slice(0, QUOTE_MAX - 1).trimEnd()}…`;
};

/** IN-10: 1, plus 1 for every LEVEL_EVERY answered items, up to MAX_LEVEL. */
export const levelFor = (answered: number) =>
  Math.min(MAX_LEVEL, 1 + Math.floor(Math.max(0, answered) / LEVEL_EVERY));

/** IN-13: from how much of the menu is answered, never which answers. */
export const rarityFor = (answered: number, items: number): Rarity => {
  if (items >= 10 && answered === items) return "legendary";
  const share = items > 0 ? answered / items : 0;
  if (share >= 0.9) return "epic";
  if (share >= 0.7) return "rare";
  if (share >= 0.4) return "uncommon";
  return "common";
};

export type CharacterSheet = {
  /** The class's theme; null for the Chameleon's Shapeshifter. */
  theme: Theme | null;
  multiclass: Theme | null;
  level: number;
};

/** IN-10: the class follows the animal; nothing until it hatches. */
export const characterSheet = (insights: MenuInsights): CharacterSheet | null =>
  insights.animal.kind === "animal"
    ? { theme: insights.animal.theme, multiclass: insights.animal.streak, level: levelFor(insights.answered) }
    : null;

export type LootLine = { answer: RelationshipMenuItemValue; text: string };

export type Loot = {
  prefix: string;
  base: string;
  /** A quoted Must have, or a phrase when none can be quoted. */
  suffix: string;
  suffixIsQuote: boolean;
  rarity: Rarity;
  /** The top two themes with a score, best first. */
  themeStats: { theme: Theme; score: number }[];
  /** Must haves, then Like to have, Maybe and Off limits (IN-11). */
  lines: LootLine[];
};

export const lootName = (loot: Loot) => `${loot.prefix} ${loot.base} of ${loot.suffix}`;

/** The list starting from position `n` (wrapping), so each roll features other items. */
const rotate = <T,>(list: T[], n: number): T[] => {
  if (list.length === 0) return list;
  const k = ((Math.trunc(n) % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
};

/**
 * IN-11: the loot item for a hatched menu, or null. `variant` ("Roll again") changes
 * only the words and which items are quoted.
 */
export const menuLoot = (menu: RelationshipMenu, insights: MenuInsights, variant = 0): Loot | null => {
  if (insights.animal.kind !== "animal") return null;
  const { theme, style, streak } = insights.animal;

  // Quotable items by answer, in menu order; each text once (IN-12).
  const quotable: Record<RelationshipMenuItemValue, string[]> = {
    "must-have": [],
    "like-to-have": [],
    maybe: [],
    "off-limits": [],
  };
  const seen = new Set<string>();
  for (const items of Object.values(menu ?? {})) {
    if (!Array.isArray(items)) continue;
    for (const entry of items) {
      if (!entry || typeof entry.item !== "string" || !entry.item.trim()) continue;
      if (!isAnswer(entry.value) || !canQuote(entry.item, entry.value)) continue;
      // By the quote itself, so two long items cut to the same text count once.
      const text = quote(entry.item);
      const key = normalizeText(text);
      if (seen.has(key)) continue;
      seen.add(key);
      quotable[entry.value].push(text);
    }
  }

  const [signature, ...mustHaves] = rotate(quotable["must-have"], variant);
  const pick = (answer: RelationshipMenuItemValue, list: string[], count: number): LootLine[] =>
    list.slice(0, count).map((text) => ({ answer, text }));
  const prefixes = LOOT_PREFIXES[style];

  return {
    prefix: pickWording(prefixes, variant),
    base: pickWording(LOOT_BASES[theme ?? "none"], Math.floor(variant / prefixes.length)),
    suffix: signature ?? LOOT_SUFFIXES[streak ?? theme ?? "none"],
    suffixIsQuote: signature !== undefined,
    rarity: rarityFor(insights.answered, insights.items),
    themeStats: rankThemes(insights.themes)
      .slice(0, 2)
      .map((t) => ({ theme: t.theme, score: t.score as number })),
    lines: [
      ...pick("must-have", mustHaves, 2),
      ...pick("like-to-have", rotate(quotable["like-to-have"], variant), 1),
      ...pick("maybe", rotate(quotable.maybe, variant), 1),
      ...pick("off-limits", rotate(quotable["off-limits"], variant), 2),
    ],
  };
};
