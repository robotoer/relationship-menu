/**
 * Underspecified menu items (spec SV-17). "Communication", "Quality time" and
 * "Respect" mean different things to different people: two menus can agree on the
 * words and disagree completely about the relationship. Nothing here blocks anyone:
 * it powers a gentle hint while writing, a stronger prompt in Talk it through, and a
 * test that keeps the built-in templates from shipping bare single words.
 */

/** Whole items that, on their own, mean too many different things to compare. */
export const VAGUE_ITEMS: readonly string[] = [
  "affection",
  "attention",
  "boundaries",
  "care",
  "closeness",
  "commitment",
  "communication",
  "compromise",
  "connection",
  "effort",
  "emotional support",
  "equality",
  "fun",
  "honesty",
  "intimacy",
  "jealousy",
  "kids",
  "love",
  "loyalty",
  "money",
  "openness",
  "patience",
  "physical affection",
  "privacy",
  "quality time",
  "respect",
  "romance",
  "safety",
  "sex",
  "space",
  "support",
  "time",
  "trust",
  "understanding",
  "vulnerability",
];

const normalize = (item: string) =>
  item
    .toLowerCase()
    .replace(/[()[\]{}"'.:;!?,*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Whether an item is one of those bare words. Only an item that is *exactly* a vague
 * word counts: "Trust with money" and "Weekly quality time" are already specific
 * enough to talk about, and guessing at longer items raises false alarms.
 */
export const isVagueItem = (item: string): boolean => {
  if (!item?.trim()) return false;
  return VAGUE_ITEMS.includes(normalize(item));
};

/** The hint shown while writing such an item. */
export const SPECIFICITY_HINT =
  "This could mean different things to each of you. Add what it looks like in practice, like “Weekly time together, phones away”.";

const hintFor = (item: string) => (isVagueItem(item) ? SPECIFICITY_HINT : undefined);

export default hintFor;
