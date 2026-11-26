import fc from "fast-check";
import { BIP39_ENGLISH } from "./bip39-english";
import { fromHex, sha256, toHex, utf8 } from "./bytes";
import {
  SyncCodeError,
  WRONG_WORD_MESSAGE,
  completeWord,
  newSyncSecret,
  parseSyncCode,
  secretToWords,
  syncCodeWords,
} from "./sync-code";
import syncCodeSource from "./sync-code.ts?raw";
import { KEY_VECTORS } from "./test-vectors";

/**
 * Every 256-bit English vector in trezor/python-mnemonic's vectors.json, the
 * test vectors BIP-39 itself links to (entropy → mnemonic).
 */
const OFFICIAL_VECTORS = [
  ["0000000000000000000000000000000000000000000000000000000000000000", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"],
  ["7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f", "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title"],
  ["8080808080808080808080808080808080808080808080808080808080808080", "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless"],
  ["ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote"],
  ["68a79eaca2324873eacc50cb9c6eca8cc68ea5d936f98787c60c7ebc74e6ce7c", "hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length"],
  ["9f6a2878b2520799a44ef18bc7df394e7061a224d2c33cd015b157d746869863", "panda eyebrow bullet gorilla call smoke muffin taste mesh discover soft ostrich alcohol speed nation flash devote level hobby quick inner drive ghost inside"],
  ["066dca1a2bb7e8a1db2832148ce9933eea0f3ac9548d793112d9a95c9407efad", "all hour make first leader extend hole alien behind guard gospel lava path output census museum junior mass reopen famous sing advance salt reform"],
  ["f585c11aec520db57dd353c69554b21a89b20fb0650966fa0a9d6f74fd989d8f", "void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold"],
] as const;

/** SHA-256 of bitcoin/bips bip-0039/english.txt (git blob 942040ed50f7205cafc465496229128ba4f78e75). */
const ENGLISH_TXT_SHA256 = "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda";

const secretArb = fc.uint8Array({ minLength: 32, maxLength: 32 });

/** What parseSyncCode throws, or null if it doesn't. */
const parseError = async (text: string): Promise<SyncCodeError | null> => {
  try {
    await parseSyncCode(text);
    return null;
  } catch (error) {
    if (error instanceof SyncCodeError) return error;
    throw error;
  }
};

/** Puts the 11-bit index `index` in place of word `position`. */
const replaceWord = (words: string[], position: number, index: number) =>
  words.map((word, i) => (i === position ? BIP39_ENGLISH[index]! : word));

describe("SY-1: the sync code is 256 random bits as 24 BIP-39 words", () => {
  test("the word list is the official BIP-39 English list", async () => {
    expect(BIP39_ENGLISH).toHaveLength(2048);
    expect(toHex(await sha256(utf8(BIP39_ENGLISH.join("\n") + "\n")))).toBe(ENGLISH_TXT_SHA256);
    expect(await syncCodeWords()).toEqual(BIP39_ENGLISH);
  });

  test("every word is identified by its first four letters", () => {
    expect(new Set(BIP39_ENGLISH.map((word) => word.slice(0, 4))).size).toBe(2048);
  });

  test.each(OFFICIAL_VECTORS)("%s → its official words", async (entropy, mnemonic) => {
    expect((await secretToWords(fromHex(entropy))).join(" ")).toBe(mnemonic);
    expect(toHex(await parseSyncCode(mnemonic))).toBe(entropy);
  });

  test("the frozen key vectors use these words", async () => {
    for (const vector of KEY_VECTORS) expect(toHex(await parseSyncCode(vector.words))).toBe(vector.secret);
  });

  test("a new code is 32 fresh random bytes", async () => {
    const a = newSyncSecret();
    const b = newSyncSecret();
    expect(a).toHaveLength(32);
    expect(toHex(a)).not.toBe(toHex(b));
    expect(await secretToWords(a)).toHaveLength(24);
  });

  test("only 32-byte secrets have a code", async () => {
    await expect(secretToWords(new Uint8Array(16))).rejects.toThrow();
    await expect(secretToWords(new Uint8Array(33))).rejects.toThrow();
  });

  test("the word list loads only with import(), so it's not in the main bundle", () => {
    expect(syncCodeSource).toContain('import("./bip39-english")');
    expect(syncCodeSource).not.toMatch(/^import[^\n]*bip39-english/m);
  });
});

describe("SY-5: typing the sync code", () => {
  /** How someone might type or paste a code: any case, extra spaces, words cut to four letters or more. */
  const typingArb = fc.record({
    forms: fc.array(fc.tuple(fc.nat(8), fc.constantFrom("lower", "upper", "title")), { minLength: 24, maxLength: 24 }),
    gaps: fc.array(fc.constantFrom(" ", "  ", "\n", "\t", " \n  "), { minLength: 25, maxLength: 25 }),
  });
  type Typing = { forms: [number, string][]; gaps: string[] };

  const type = (words: string[], { forms, gaps }: Typing) =>
    gaps[0]! +
    words
      .map((word, i) => {
        const [cut, style] = forms[i]!;
        const kept = word.length <= 4 ? word : word.slice(0, Math.max(4, word.length - cut));
        if (style === "upper") return kept.toUpperCase();
        if (style === "title") return kept[0]!.toUpperCase() + kept.slice(1);
        return kept;
      })
      .map((word, i) => word + gaps[i + 1]!)
      .join("");

  test("round trip: words typed in any case, spacing or 4-letter form give back the secret", async () => {
    await fc.assert(
      fc.asyncProperty(secretArb, typingArb, async (secret, typing) => {
        const typed = type(await secretToWords(secret), typing);
        expect(toHex(await parseSyncCode(typed))).toBe(toHex(secret));
      }),
      { numRuns: 200 }
    );
  });

  test("accepts each word by its first four letters, and three-letter words as they are", async () => {
    const [, mnemonic] = OFFICIAL_VECTORS[5]!;
    const short = mnemonic.split(" ").map((word) => word.slice(0, 4)).join(" ");
    expect(toHex(await parseSyncCode(short))).toBe(OFFICIAL_VECTORS[5]![0]);
    expect(toHex(await parseSyncCode(`  ${mnemonic.toUpperCase()}\n`))).toBe(OFFICIAL_VECTORS[5]![0]);
  });

  test("doesn't guess from fewer than four letters, and a typo isn't a prefix", async () => {
    const words = OFFICIAL_VECTORS[4]![1].split(" ");
    const tooShort = await parseError(words.map((w, i) => (i === 2 ? "aba" : w)).join(" "));
    expect(tooShort?.problem).toBe("unknown_word");
    expect(tooShort?.position).toBe(3);
    const typo = await parseError(words.map((w, i) => (i === 0 ? "hamstr" : w)).join(" "));
    expect(typo?.problem).toBe("unknown_word");
    expect(typo?.position).toBe(1);
    expect(typo?.message).toBe("Word 1 isn't one of the sync code words.");
  });

  test("counts the words", async () => {
    const words = OFFICIAL_VECTORS[4]![1].split(" ");
    const error = await parseError(words.slice(0, 23).join(" "));
    expect(error?.problem).toBe("length");
    expect(error?.message).toBe("A sync code has 24 words. This has 23.");
    expect((await parseError("   "))?.message).toBe("A sync code has 24 words. This has 0.");
  });

  test('a bad checksum gets one message, "One of the words is wrong.", that never says which', async () => {
    const words = OFFICIAL_VECTORS[4]![1].split(" ");
    const last = BIP39_ENGLISH.indexOf(words[23]!);
    const error = await parseError(replaceWord(words, 23, last ^ 1).join(" "));
    expect(error?.problem).toBe("checksum");
    expect(error?.message).toBe(WRONG_WORD_MESSAGE);
    expect(error?.message).toBe("One of the words is wrong.");
    expect(error?.position).toBeUndefined();
  });

  test("property: any change to the checksum bits is caught", async () => {
    await fc.assert(
      fc.asyncProperty(secretArb, fc.integer({ min: 1, max: 255 }), async (secret, mask) => {
        const words = await secretToWords(secret);
        const last = BIP39_ENGLISH.indexOf(words[23]!);
        const error = await parseError(replaceWord(words, 23, last ^ mask).join(" "));
        expect(error?.problem).toBe("checksum");
        expect(error?.message).toBe(WRONG_WORD_MESSAGE);
      }),
      { numRuns: 200 }
    );
  });

  test("property: one wrong word is caught with the one message, or reads as a different code, never the same", async () => {
    await fc.assert(
      fc.asyncProperty(secretArb, fc.nat(23), fc.integer({ min: 1, max: 2047 }), async (secret, position, delta) => {
        const words = await secretToWords(secret);
        const index = (BIP39_ENGLISH.indexOf(words[position]!) + delta) % 2048;
        const typed = replaceWord(words, position, index).join(" ");
        const error = await parseError(typed);
        if (error) {
          expect(error.problem).toBe("checksum");
          expect(error.message).toBe(WRONG_WORD_MESSAGE);
          expect(error.position).toBeUndefined();
        } else {
          expect(toHex(await parseSyncCode(typed))).not.toBe(toHex(secret));
        }
      }),
      { numRuns: 300 }
    );
  });

  test("catches about 255 in 256 wrong words: every replacement of the first word, checked", async () => {
    const words = OFFICIAL_VECTORS[4]![1].split(" ");
    const original = BIP39_ENGLISH.indexOf(words[0]!);
    let accepted = 0;
    for (let index = 0; index < 2048; index++) {
      if (index !== original && (await parseError(replaceWord(words, 0, index).join(" "))) === null) accepted++;
    }
    // The 8-bit checksum lets through 2047 / 256 ≈ 8 on average.
    expect(accepted).toBeLessThan(20);
  });

  test("autocompletes from what's typed; from four letters on there's one word at most", async () => {
    expect(await completeWord("ab")).toEqual(["abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract"]);
    expect(await completeWord("zo")).toEqual(["zone", "zoo"]);
    expect(await completeWord("act")).toEqual(["act", "action", "actor", "actress", "actual"]);
    expect(await completeWord("ABAN")).toEqual(["abandon"]);
    expect(await completeWord("aband")).toEqual(["abandon"]);
    expect(await completeWord("abanx")).toEqual([]);
    expect(await completeWord("  ")).toEqual([]);
  });
});
