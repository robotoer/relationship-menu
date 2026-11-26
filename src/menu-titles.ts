/**
 * Naming a copy so it never replaces a menu you already have (spec LK-6, HO-5).
 */

/** What an empty title is called in a copy's name. */
const base = (title: string) => title || "Untitled";

/** "Title (2)", "Title (3)", … — the first that isn't taken. */
export const uniqueTitle = (title: string, taken: ReadonlySet<string>): string => {
  for (let n = 2; ; n++) {
    const candidate = `${base(title)} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
};

/** Whether `candidate` is a name uniqueTitle could give a copy of `title`. */
export const isNumberedCopyOf = (candidate: string, title: string): boolean => {
  const prefix = `${base(title)} (`;
  if (!candidate.startsWith(prefix) || !candidate.endsWith(")")) return false;
  const n = candidate.slice(prefix.length, -1);
  return /^[1-9]\d*$/.test(n) && n !== "1";
};
