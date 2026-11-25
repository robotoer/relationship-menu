/**
 * A starter relationship menu: common topics people discuss, with no answers filled in.
 * Users can rename, remove or add anything.
 */

import { encodeData } from "./data-encoder";
import { RelationshipMenu } from "./model/menu";

export const STARTER_TITLE = "Our relationship menu";

const items = (...names: string[]) => names.map((item) => ({ item }));

export const STARTER_MENU: RelationshipMenu = {
  Communication: items(
    "Daily check-ins",
    "Talking about feelings",
    "Talking about past relationships",
    "Sharing passwords or phones"
  ),
  "Time together": items(
    "Regular date nights",
    "Spending holidays together",
    "Travelling together",
    "Time apart to do our own things"
  ),
  Commitment: items(
    "Calling each other partners",
    "Meeting each other's family",
    "Moving in together",
    "Marriage",
    "Having children"
  ),
  Affection: items(
    "Holding hands",
    "Cuddling",
    "Kissing",
    "Affection in public",
    "Sex"
  ),
  "Other relationships": items(
    "Dating other people",
    "My partner dating other people",
    "Knowing about other partners",
    "Close friendships with exes"
  ),
  "Day to day": items(
    "Sharing finances",
    "Sharing chores",
    "Supporting each other's career moves",
    "Having pets"
  ),
};

/** Editor link that opens the starter menu as a new menu. */
export const starterMenuPath = () =>
  `/menu?encoded=${encodeURIComponent(
    `${encodeData(STARTER_TITLE)}:${encodeData(STARTER_MENU)}`
  )}`;
