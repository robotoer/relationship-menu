/**
 * The sync code (SY-1, SY-5): the 256-bit secret, shown as 24 words.
 *
 * It's standard BIP-39 with the English list: the 32 secret bytes are followed
 * by a checksum byte (the first byte of SHA-256 of the secret), and those 264
 * bits are read as 24 numbers of 11 bits, each picking one of the 2048 words.
 * So the last word carries 3 bits of the secret and the 8 checksum bits.
 *
 * Typing a code ignores case and extra spaces, and accepts any word by its first
 * four letters (every word in the list is unique by then). A code that doesn't
 * match its checksum gets one message that doesn't say which word is wrong: the
 * checksum can't tell.
 *
 * The word list is loaded with import(), so it's only downloaded when a sync
 * screen needs it, not with the main app (SY-1).
 *
 * Never log or send the words or the secret, not even in an error message.
 */

import { type Bytes, randomBytes, sha256 } from "./bytes";

export const SYNC_SECRET_BYTES = 32;
export const SYNC_CODE_WORDS = 24;
/** Letters that are enough to identify any word. */
export const WORD_PREFIX_LETTERS = 4;

export const WRONG_WORD_MESSAGE = "One of the words is wrong.";

export type SyncCodeProblem = "length" | "unknown_word" | "checksum";

/**
 * A code that can't be read. The message is fit to show; it never contains any
 * of the words. `position` (1-based) is set only for a word that isn't in the
 * list at all: for a checksum failure nobody can know which word is wrong.
 */
export class SyncCodeError extends Error {
  constructor(
    readonly problem: SyncCodeProblem,
    message: string,
    readonly position?: number
  ) {
    super(message);
    this.name = "SyncCodeError";
  }
}

type WordList = {
  words: readonly string[];
  /** Exact word → index. */
  index: ReadonlyMap<string, number>;
  /** First four letters → index (three-letter words are their own prefix). */
  prefixes: ReadonlyMap<string, number>;
};

let wordList: Promise<WordList> | undefined;

const loadWordList = (): Promise<WordList> =>
  (wordList ??= import("./bip39-english").then(({ BIP39_ENGLISH: words }) => {
    if (words.length !== 2048) throw new Error("The sync code word list didn't load correctly.");
    const index = new Map(words.map((word, i) => [word, i]));
    const prefixes = new Map(words.map((word, i) => [word.slice(0, WORD_PREFIX_LETTERS), i]));
    if (index.size !== 2048 || prefixes.size !== 2048) throw new Error("The sync code word list didn't load correctly.");
    return { words, index, prefixes };
  }));

/** The 2048 words, for screens that show or autocomplete codes. */
export const syncCodeWords = async (): Promise<readonly string[]> => (await loadWordList()).words;

/** A new sync secret: 256 bits from crypto.getRandomValues (SY-1). */
export const newSyncSecret = (): Bytes => randomBytes(SYNC_SECRET_BYTES);

/** The 24 words for a 32-byte secret. */
export const secretToWords = async (secret: Uint8Array): Promise<string[]> => {
  if (secret.length !== SYNC_SECRET_BYTES) throw new Error("A sync secret is 32 bytes.");
  const { words } = await loadWordList();
  const checksum = (await sha256(secret))[0]!;
  const indices: number[] = [];
  let acc = 0;
  let accBits = 0;
  for (const byte of [...secret, checksum]) {
    acc = (acc << 8) | byte;
    accBits += 8;
    if (accBits >= 11) {
      accBits -= 11;
      indices.push((acc >> accBits) & 0x7ff);
      acc &= (1 << accBits) - 1;
    }
  }
  return indices.map((i) => words[i]!);
};

const normalize = (text: string): string[] => {
  const trimmed = text.normalize("NFKD").toLowerCase().trim();
  return trimmed ? trimmed.split(/\s+/) : [];
};

/** The index of a typed word: the word itself, or its first four letters or more. */
const indexOf = (list: WordList, token: string): number | undefined => {
  const exact = list.index.get(token);
  if (exact !== undefined) return exact;
  if (token.length < WORD_PREFIX_LETTERS) return undefined;
  const candidate = list.prefixes.get(token.slice(0, WORD_PREFIX_LETTERS));
  // "aban", "aband" and "abandon" all mean abandon; "abanbon" is a typo, not a prefix.
  return candidate !== undefined && list.words[candidate]!.startsWith(token) ? candidate : undefined;
};

/**
 * Reads a typed or pasted code and returns its 32-byte secret.
 * Throws SyncCodeError if it isn't 24 known words with a matching checksum.
 */
export const parseSyncCode = async (text: string): Promise<Bytes> => {
  const tokens = normalize(text);
  if (tokens.length !== SYNC_CODE_WORDS) {
    throw new SyncCodeError("length", `A sync code has ${SYNC_CODE_WORDS} words. This has ${tokens.length}.`);
  }
  const list = await loadWordList();
  const bytes = new Uint8Array(SYNC_SECRET_BYTES + 1);
  let acc = 0;
  let accBits = 0;
  let out = 0;
  for (const [position, token] of tokens.entries()) {
    const index = indexOf(list, token);
    if (index === undefined) {
      throw new SyncCodeError("unknown_word", `Word ${position + 1} isn't one of the sync code words.`, position + 1);
    }
    acc = (acc << 11) | index;
    accBits += 11;
    while (accBits >= 8) {
      accBits -= 8;
      bytes[out++] = (acc >> accBits) & 0xff;
    }
    acc &= (1 << accBits) - 1;
  }
  const secret = bytes.slice(0, SYNC_SECRET_BYTES);
  const checksum = bytes[SYNC_SECRET_BYTES];
  bytes.fill(0);
  if ((await sha256(secret))[0] !== checksum) {
    secret.fill(0);
    throw new SyncCodeError("checksum", WRONG_WORD_MESSAGE);
  }
  return secret;
};

/**
 * Words that start with what's been typed so far, for autocomplete (SY-5).
 * From four letters on there is at most one.
 */
export const completeWord = async (typed: string, limit = 8): Promise<string[]> => {
  const prefix = typed.normalize("NFKD").toLowerCase().trim();
  if (!prefix) return [];
  const list = await loadWordList();
  if (prefix.length >= WORD_PREFIX_LETTERS) {
    const index = indexOf(list, prefix);
    return index === undefined ? [] : [list.words[index]!];
  }
  return list.words.filter((word) => word.startsWith(prefix)).slice(0, limit);
};
