/**
 * Person info on a menu (name, pronouns, note). Its own module, without the link
 * encoder, so the hand-off page (src/handoff/) can use it and stay small.
 */

import { Person } from "./model/menu";

const PERSON_LIMITS: Record<keyof Person, number> = { name: 60, pronouns: 30, note: 280 };

/** Keeps only short string fields of a person; returns undefined if nothing is left. */
export const sanitizePerson = (value: unknown): Person | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const person: Person = {};
  for (const key of Object.keys(PERSON_LIMITS) as (keyof Person)[]) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === "string" && field.trim()) {
      // Trim again after cutting, so sanitizing the result again changes nothing.
      person[key] = field.trim().slice(0, PERSON_LIMITS[key]).trimEnd();
    }
  }
  return Object.keys(person).length ? person : undefined;
};
