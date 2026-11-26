/** "Title (2)", "Title (3)", ... — the first that isn't already a saved menu's title. */
export const uniqueTitle = (title: string, taken: Set<string>) => {
  for (let n = 2; ; n++) {
    const candidate = `${title || "Untitled"} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
};
