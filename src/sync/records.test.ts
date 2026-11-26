import fc from "fast-check";
import { encodeData } from "../data-encoder";
import { type Bytes, concat, fromBase64Url, fromHex, fromUtf8, toBase64Url, toHex, utf8 } from "./bytes";
import { type SyncKeys, deriveKeys, hkdf } from "./keys";
import {
  MAX_PADDED_BYTES,
  MAX_TOMBSTONE_PADDED_BYTES,
  type MenuRecord,
  SyncRecordError,
  decryptRecord,
  encryptRecord,
  pad,
  recordAad,
  tombstone,
  unpad,
} from "./records";
import { KEY_VECTORS, RECORD_VECTORS, VECTOR_ACCOUNT } from "./test-vectors";

const MENU_ID = "AAECAwQFBgcICQoLDA0ODw";
const OTHER_MENU_ID = "_____________________w";

let keys: SyncKeys;
let otherKeys: SyncKeys;
/** The AES key's bytes, derived again here so tests can read and write raw plaintexts. */
let rawKey: CryptoKey;

beforeAll(async () => {
  keys = await deriveKeys(fromHex(VECTOR_ACCOUNT.secret));
  otherKeys = await deriveKeys(fromHex(KEY_VECTORS[0].secret));
  const bytes = await hkdf(fromHex(VECTOR_ACCOUNT.secret), utf8("menu-sync/v1"), utf8("encrypt"), 32);
  rawKey = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
});

/** A real menu, encoded as links encode it, full of marker text. */
const MARKERS = {
  title: "Marker title PK4 our weekends",
  group: "Marker group QX7",
  item: "Marker item ZQ9 holding hands in public",
  note: "Marker note VJ3 only after we talk",
  name: "Marker name RW2",
};
const markerRecord = (): MenuRecord => ({
  id: MENU_ID,
  title: MARKERS.title,
  encoded: encodeData({ [MARKERS.group]: [{ item: MARKERS.item, value: "maybe", note: MARKERS.note }] }),
  person: { name: MARKERS.name, pronouns: "they/them" },
  createdAt: 1795564800000,
  updatedAt: 1795568400000,
  editId: "ZWRpdC1pZC10ZXN0MDAwMQ",
});

const stored = (ciphertext: Uint8Array, over: Partial<{ id: string; version: number; deleted: boolean }> = {}) => ({
  id: over.id ?? MENU_ID,
  version: over.version ?? 1,
  deleted: over.deleted ?? false,
  ciphertext,
});

const expectUnreadable = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(SyncRecordError);
  expect((error as SyncRecordError).problem).toBe("unreadable");
  expect((error as SyncRecordError).message).toBe("This synced record couldn't be read.");
};

/** Opens a record with the raw key and the documented additional data, returning the padded plaintext. */
const openByHand = async (ciphertext: Uint8Array, accountId: string, menuId: string, version: number, deleted: boolean) => {
  const aad = concat(utf8("menu-sync/v1"), utf8(accountId), utf8(menuId), fromHex(version.toString(16).padStart(16, "0")), new Uint8Array([deleted ? 1 : 0]));
  const params = { name: "AES-GCM", iv: ciphertext.slice(0, 12), additionalData: aad };
  return new Uint8Array(await crypto.subtle.decrypt(params, rawKey, ciphertext.slice(12)));
};

/** Seals any padded plaintext with the right key and additional data, as a buggy or future client might. */
const sealByHand = async (padded: Uint8Array, menuId = MENU_ID, version = 1, deleted = false) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = recordAad(keys.accountId, menuId, version, deleted);
  return concat(iv, new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, rawKey, padded as Bytes)));
};

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** A text's raw, hex and base64 forms (base64 at all three byte alignments, standard and URL-safe). */
const encodings = (text: string): string[] => {
  const bytes = utf8(text);
  const forms = [latin1(bytes), toHex(bytes), toHex(bytes).toUpperCase()];
  for (let shift = 0; shift < 3; shift++) {
    const b64 = btoa(latin1(concat(new Uint8Array(shift), bytes)));
    const stable = b64.slice(Math.ceil((shift * 4) / 3), Math.floor(((shift + bytes.length) * 4) / 3));
    forms.push(stable, stable.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  return forms;
};

/** The record as bytes, base64, base64url and hex: anywhere a copy of the text could hide. */
const views = (ciphertext: Uint8Array) => [latin1(ciphertext), btoa(latin1(ciphertext)), toBase64Url(ciphertext), toHex(ciphertext), toHex(ciphertext).toUpperCase()];

const recordArb: fc.Arbitrary<MenuRecord> = fc.record(
  {
    id: fc.uint8Array({ minLength: 16, maxLength: 16 }).map(toBase64Url),
    title: fc.string({ unit: "binary", maxLength: 200 }),
    encoded: fc.string({ maxLength: 3000 }),
    person: fc.record(
      { name: fc.string({ unit: "binary" }), pronouns: fc.string(), note: fc.string({ unit: "binary", maxLength: 300 }) },
      { requiredKeys: [] }
    ),
    createdAt: fc.integer({ min: 0, max: 4e12 }),
    updatedAt: fc.integer({ min: 0, max: 4e12 }),
    editId: fc.string({ minLength: 1, maxLength: 40 }),
  },
  { requiredKeys: ["id", "title", "encoded", "editId"] }
);

describe("SY-15: records are AES-256-GCM, bound to their account, menu, version and deleted flag", () => {
  test("round trip: what's encrypted decrypts to the same record", async () => {
    await fc.assert(
      fc.asyncProperty(recordArb, fc.integer({ min: 1, max: 2 ** 40 }), async (record, version) => {
        const ciphertext = await encryptRecord(keys, version, record);
        expect(await decryptRecord(keys, stored(ciphertext, { id: record.id, version }))).toEqual(record);
      }),
      { numRuns: 150 }
    );
  });

  test.each(RECORD_VECTORS)("the frozen record (version $version, deleted $deleted) still decrypts", async (vector) => {
    const record = await decryptRecord(keys, { id: vector.record.id, version: vector.version, deleted: vector.deleted, ciphertext: vector.ciphertext });
    expect(record).toEqual(vector.record);
  });

  test("every single-byte change is rejected", async () => {
    const ciphertext = await encryptRecord(keys, 7, markerRecord());
    for (let i = 0; i < ciphertext.length; i++) {
      const tampered = new Uint8Array(ciphertext);
      tampered[i]! ^= 1 + (i % 255);
      await expectUnreadable(decryptRecord(keys, stored(tampered, { version: 7 })));
    }
    // The original is still fine: it's the change that's rejected.
    expect((await decryptRecord(keys, stored(ciphertext, { version: 7 }))).title).toBe(MARKERS.title);
  });

  test("truncated, extended, empty or garbage records are rejected", async () => {
    const ciphertext = await encryptRecord(keys, 1, markerRecord());
    await expectUnreadable(decryptRecord(keys, stored(ciphertext.slice(0, -1))));
    await expectUnreadable(decryptRecord(keys, stored(ciphertext.slice(1))));
    await expectUnreadable(decryptRecord(keys, stored(concat(ciphertext, new Uint8Array(1)))));
    await expectUnreadable(decryptRecord(keys, stored(new Uint8Array())));
    await expectUnreadable(decryptRecord(keys, stored(crypto.getRandomValues(new Uint8Array(1052)))));
    await expectUnreadable(decryptRecord(keys, { ...stored(ciphertext), ciphertext: "not base64url!" }));
  });

  test("a record moved to another account, another menu or another version, or with its flag flipped, is rejected", async () => {
    const vector = RECORD_VECTORS[0];
    const original = { id: vector.record.id, version: vector.version, deleted: vector.deleted, ciphertext: vector.ciphertext };
    await expectUnreadable(decryptRecord({ ...keys, accountId: otherKeys.accountId }, original));
    await expectUnreadable(decryptRecord(otherKeys, original));
    await expectUnreadable(decryptRecord(keys, { ...original, id: OTHER_MENU_ID }));
    await expectUnreadable(decryptRecord(keys, { ...original, version: vector.version - 1 }));
    await expectUnreadable(decryptRecord(keys, { ...original, version: vector.version + 1 }));
    await expectUnreadable(decryptRecord(keys, { ...original, deleted: true }));
  });

  test("property: any other (account, menu, version, deleted) is rejected", async () => {
    const ciphertext = await encryptRecord(keys, 5, markerRecord());
    const context = fc.record({
      account: fc.constantFrom(keys.accountId, otherKeys.accountId),
      id: fc.constantFrom(MENU_ID, OTHER_MENU_ID),
      version: fc.integer({ min: 1, max: 10 }),
      deleted: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(context, async ({ account, id, version, deleted }) => {
        const attempt = decryptRecord({ ...keys, accountId: account }, { id, version, deleted, ciphertext });
        if (account === keys.accountId && id === MENU_ID && version === 5 && !deleted) {
          expect((await attempt).title).toBe(MARKERS.title);
        } else {
          await expectUnreadable(attempt);
        }
      })
    );
  });

  test("the additional data is the documented 65 bytes", () => {
    const aad = recordAad(VECTOR_ACCOUNT.accountId, MENU_ID, 3, false);
    expect(toHex(aad)).toBe(
      toHex(utf8("menu-sync/v1")) + toHex(utf8(VECTOR_ACCOUNT.accountId)) + toHex(utf8(MENU_ID)) + "0000000000000003" + "00"
    );
    expect(toHex(recordAad(VECTOR_ACCOUNT.accountId, MENU_ID, 2 ** 32 + 5, true)).slice(-18)).toBe("000000010000000501");
    expect(() => recordAad("short", MENU_ID, 1, false)).toThrow();
    expect(() => recordAad(VECTOR_ACCOUNT.accountId, "has spaces in it ......", 1, false)).toThrow();
    expect(() => recordAad(VECTOR_ACCOUNT.accountId, MENU_ID, 0, false)).toThrow();
    expect(() => recordAad(VECTOR_ACCOUNT.accountId, MENU_ID, 1.5, false)).toThrow();
  });

  test("the frozen record opens by hand with the documented key, additional data and layout", async () => {
    const vector = RECORD_VECTORS[0];
    const ciphertext = fromBase64Url(vector.ciphertext)!;
    expect(ciphertext).toHaveLength(1052);
    const padded = await openByHand(ciphertext, VECTOR_ACCOUNT.accountId, vector.record.id, vector.version, false);
    const length = new DataView(padded.buffer).getUint32(0);
    expect(fromUtf8(padded.slice(4, 4 + length))).toBe(
      '{"v":1,"id":"AAECAwQFBgcICQoLDA0ODw","title":"Frozen vector menu","encoded":"eJyrVkrOT0lVslJKzEvMTVWqBQApRQUN",' +
        '"person":{"name":"Alex","pronouns":"they/them"},"createdAt":1795564800000,"updatedAt":1795568400000,"editId":"ZWRpdC1pZC12ZWN0b3IwMQ"}'
    );
    expect(padded.slice(4 + length).every((byte) => byte === 0)).toBe(true);
  });

  test("every write gets a fresh random nonce", async () => {
    const a = await encryptRecord(keys, 1, markerRecord());
    const b = await encryptRecord(keys, 1, markerRecord());
    expect(toHex(a.slice(0, 12))).not.toBe(toHex(b.slice(0, 12)));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  test("decrypted records are checked: format version, id, fields and padding (SY-17: else unreadable)", async () => {
    const json = (value: object) => pad(utf8(JSON.stringify(value)));
    const good = { v: 1, id: MENU_ID, title: "t", encoded: "e", editId: "x" };
    expect((await decryptRecord(keys, stored(await sealByHand(json(good))))).title).toBe("t");

    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(json({ ...good, v: 2 })))));
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(json({ ...good, id: OTHER_MENU_ID })))));
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(json({ ...good, title: 5 })))));
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(json({ ...good, editId: "" })))));
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(json({ ...good, createdAt: "today" })))));
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(json({ ...good, person: { name: 1 } })))));
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(json({ ...good, deleted: false })))));
    // A tombstone flag inside that the additional data doesn't match.
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(json({ ...good, deleted: true })))));
    // Not JSON, not UTF-8, padding not as pad() writes it.
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(pad(utf8("{not json"))))));
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(pad(new Uint8Array([0x7b, 0xff, 0x7d]))))));
    const loose = new Uint8Array(2048);
    loose.set(json(good).slice(0, 1024));
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(loose))));
    const dirty = json(good);
    dirty[1023] = 1;
    await expectUnreadable(decryptRecord(keys, stored(await sealByHand(dirty))));
  });

  test("keeps only a record's own fields", async () => {
    const padded = pad(utf8(JSON.stringify({ v: 1, id: MENU_ID, title: "t", encoded: "e", editId: "x", extra: "?", person: { name: "n", other: 1 } })));
    expect(await decryptRecord(keys, stored(await sealByHand(padded)))).toEqual({
      id: MENU_ID,
      title: "t",
      encoded: "e",
      person: { name: "n" },
      editId: "x",
    });
  });
});

describe("SY-16: the plaintext is the whole menu, padded to a multiple of 1 KiB", () => {
  test("the record holds no title, item, note or name, as raw text, hex or base64", async () => {
    const record = markerRecord();
    const ciphertext = await encryptRecord(keys, 1, record);
    const haystacks = views(ciphertext);
    const needles = [...Object.values(MARKERS), record.encoded].flatMap(encodings);
    for (const needle of needles) {
      for (const haystack of haystacks) expect(haystack.includes(needle)).toBe(false);
    }
    // The same check does find them in the plaintext, so it would catch a record sent unencrypted.
    const padded = latin1(await openByHand(ciphertext, keys.accountId, MENU_ID, 1, false));
    expect(padded.includes(latin1(utf8(MARKERS.title)))).toBe(true);
    expect(padded.includes(latin1(utf8(record.encoded)))).toBe(true);
  });

  test("the plaintext is { v, id, title, encoded, person, createdAt, updatedAt, editId }, in that order", async () => {
    const padded = await openByHand(await encryptRecord(keys, 2, markerRecord()), keys.accountId, MENU_ID, 2, false);
    const plain = unpad(padded)!;
    const parsed = JSON.parse(fromUtf8(plain));
    expect(Object.keys(parsed)).toEqual(["v", "id", "title", "encoded", "person", "createdAt", "updatedAt", "editId"]);
    expect(parsed.v).toBe(1);
  });

  test("sizes are whole KiB plus 28 bytes of nonce and tag, with the least padding that fits", async () => {
    const sizes = new Set<number>();
    for (const length of [0, 1, 100, ...Array.from({ length: 201 }, (_, i) => 850 + i), 3000, 20000, 60000]) {
      const record = { ...markerRecord(), title: "x".repeat(length) };
      const ciphertext = await encryptRecord(keys, 1, record);
      const plain = unpad(await openByHand(ciphertext, keys.accountId, MENU_ID, 1, false))!;
      expect(ciphertext.length % 1024).toBe(28);
      expect(ciphertext.length).toBe(Math.ceil((4 + plain.length) / 1024) * 1024 + 28);
      sizes.add(ciphertext.length);
    }
    // Crossing from one KiB to two happens inside the 850–1050 range.
    expect(sizes.has(1052)).toBe(true);
    expect(sizes.has(2076)).toBe(true);
  });

  test("padding: a 4-byte length, the bytes, then zeros", () => {
    expect(toHex(pad(utf8("hi")).slice(0, 8))).toBe("0000000268690000");
    expect(pad(new Uint8Array(1020))).toHaveLength(1024);
    expect(pad(new Uint8Array(1021))).toHaveLength(2048);
    expect(pad(new Uint8Array())).toHaveLength(1024);
    expect(fromUtf8(unpad(pad(utf8("hello")))!)).toBe("hello");
    expect(unpad(new Uint8Array(3))).toBeNull();
    expect(unpad(new Uint8Array(1023))).toBeNull();
  });

  test("a menu too big for the server's 64 KiB is refused before it's sent", async () => {
    expect(MAX_PADDED_BYTES + 28).toBeLessThanOrEqual(64 * 1024);
    expect(MAX_PADDED_BYTES + 1024 + 28).toBeGreaterThan(64 * 1024);
    const fits = await encryptRecord(keys, 1, { ...markerRecord(), encoded: "x".repeat(MAX_PADDED_BYTES - 1000) });
    expect(fits.length).toBe(MAX_PADDED_BYTES + 28);
    const error = await encryptRecord(keys, 1, { ...markerRecord(), encoded: "x".repeat(MAX_PADDED_BYTES) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncRecordError);
    expect((error as SyncRecordError).problem).toBe("too_large");
    expect((error as SyncRecordError).message).not.toContain("x");
  });
});

describe("SY-19: a deletion is an encrypted tombstone", () => {
  test("a tombstone is a record with deleted: true and nothing of the menu", async () => {
    const dead = tombstone(MENU_ID, "ZWRpdC1pZC10b21iMDAwMQ", 1795572000000);
    expect(dead).toEqual({ id: MENU_ID, title: "", encoded: "", updatedAt: 1795572000000, editId: "ZWRpdC1pZC10b21iMDAwMQ", deleted: true });
    const ciphertext = await encryptRecord(keys, 4, dead);
    expect(ciphertext.length).toBe(1052);
    expect(ciphertext.length).toBeLessThanOrEqual(4 * 1024);
    expect(await decryptRecord(keys, stored(ciphertext, { version: 4, deleted: true }))).toEqual(dead);
  });

  test("the server can't turn a menu into a deletion, or a deletion back into a menu", async () => {
    const live = await encryptRecord(keys, 2, markerRecord());
    await expectUnreadable(decryptRecord(keys, stored(live, { version: 2, deleted: true })));
    const dead = await encryptRecord(keys, 3, tombstone(MENU_ID, "e"));
    await expectUnreadable(decryptRecord(keys, stored(dead, { version: 3, deleted: false })));
  });

  test("the server can't forge a tombstone", async () => {
    await expectUnreadable(decryptRecord(keys, stored(crypto.getRandomValues(new Uint8Array(1052)), { deleted: true })));
    const otherAccount = await encryptRecord(otherKeys, 1, tombstone(MENU_ID, "e"));
    await expectUnreadable(decryptRecord(keys, stored(otherAccount, { deleted: true })));
  });

  test("a tombstone carrying a whole menu would exceed the server's 4 KiB, so it's refused", async () => {
    expect(MAX_TOMBSTONE_PADDED_BYTES + 28).toBeLessThanOrEqual(4 * 1024);
    const big = { ...markerRecord(), encoded: "x".repeat(MAX_TOMBSTONE_PADDED_BYTES), deleted: true as const };
    const error = await encryptRecord(keys, 1, big).catch((e: unknown) => e);
    expect((error as SyncRecordError).problem).toBe("too_large");
  });
});
