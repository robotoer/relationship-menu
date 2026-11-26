import { fromBase64Url, fromHex, sha256, toBase64Url, toHex, utf8 } from "./bytes";
import { ENCRYPT_INFO, KDF_SALT, SIGN_INFO, accountIdForKey, deriveKeys, ed25519FromSeed, hkdf } from "./keys";
import { KEY_VECTORS } from "./test-vectors";

/** RFC 5869 Appendix A, test cases 1–3 (HKDF-SHA-256). */
const RFC5869 = [
  {
    name: "test case 1 (basic)",
    ikm: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
    salt: "000102030405060708090a0b0c",
    info: "f0f1f2f3f4f5f6f7f8f9",
    okm: "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
  },
  {
    name: "test case 2 (longer inputs and outputs)",
    ikm: Array.from({ length: 80 }, (_, i) => i.toString(16).padStart(2, "0")).join(""),
    salt: Array.from({ length: 80 }, (_, i) => (0x60 + i).toString(16)).join(""),
    info: Array.from({ length: 80 }, (_, i) => (0xb0 + i).toString(16)).join(""),
    okm:
      "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c" +
      "59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71" +
      "cc30c58179ec3e87c14c01d5c1f3434f1d87",
  },
  {
    name: "test case 3 (empty salt and info)",
    ikm: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
    salt: "",
    info: "",
    okm: "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
  },
];

/** RFC 8032 §7.1, TEST 1: seed → public key, and the signature of the empty message. */
const RFC8032_TEST1 = {
  seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  signature:
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
};

describe("SY-2: HKDF and Ed25519 match their RFCs", () => {
  test.each(RFC5869)("HKDF-SHA-256, RFC 5869 $name", async ({ ikm, salt, info, okm }) => {
    const out = await hkdf(fromHex(ikm), fromHex(salt), fromHex(info), okm.length / 2);
    expect(toHex(out)).toBe(okm);
  });

  test("an Ed25519 seed imported through PKCS#8 gives RFC 8032's public key and signature", async () => {
    const { signingKey, publicKey } = await ed25519FromSeed(fromHex(RFC8032_TEST1.seed));
    expect(toHex(publicKey)).toBe(RFC8032_TEST1.publicKey);
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, signingKey, new Uint8Array()));
    expect(toHex(signature)).toBe(RFC8032_TEST1.signature);
  });
});

describe("SY-2: keys from the sync code (frozen: a change would lock everyone out)", () => {
  test("the salt and labels never change", () => {
    expect(KDF_SALT).toBe("menu-sync/v1");
    expect(SIGN_INFO).toBe("sign");
    expect(ENCRYPT_INFO).toBe("encrypt");
  });

  test.each(KEY_VECTORS)("secret $secret → account $accountId", async (vector) => {
    const keys = await deriveKeys(fromHex(vector.secret));
    expect(toBase64Url(keys.publicKey)).toBe(vector.publicKey);
    expect(keys.accountId).toBe(vector.accountId);
  });

  test("the steps are exactly HKDF(info 'sign') → Ed25519 seed → SHA-256 of the public key", async () => {
    const [vector] = KEY_VECTORS;
    const seed = await hkdf(fromHex(vector.secret), utf8("menu-sync/v1"), utf8("sign"), 32);
    const { publicKey } = await ed25519FromSeed(seed);
    expect(toBase64Url(publicKey)).toBe(vector.publicKey);
    // As server/src/auth.ts accountIdForKey: base64url(first 16 bytes of SHA-256(key)), 22 characters.
    expect(toBase64Url((await sha256(publicKey)).slice(0, 16))).toBe(vector.accountId);
    expect(await accountIdForKey(publicKey)).toBe(vector.accountId);
    expect(vector.accountId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test("the encryption key is HKDF(info 'encrypt'), and differs from the signing seed", async () => {
    const secret = fromHex(KEY_VECTORS[1].secret);
    const keys = await deriveKeys(secret);
    const expected = await hkdf(secret, utf8("menu-sync/v1"), utf8("encrypt"), 32);
    const seed = await hkdf(secret, utf8("menu-sync/v1"), utf8("sign"), 32);
    expect(toHex(expected)).not.toBe(toHex(seed));

    // The derived key is non-extractable, so compare what it does: same nonce, same output.
    const reference = await crypto.subtle.importKey("raw", expected, { name: "AES-GCM" }, false, ["encrypt"]);
    const params = { name: "AES-GCM", iv: new Uint8Array(12), additionalData: utf8("check") };
    const plain = utf8("the same key encrypts the same way");
    const a = new Uint8Array(await crypto.subtle.encrypt(params, keys.encryptionKey, plain));
    const b = new Uint8Array(await crypto.subtle.encrypt(params, reference, plain));
    expect(toHex(a)).toBe(toHex(b));
  });

  test("the private and encryption keys can't be exported", async () => {
    const keys = await deriveKeys(fromHex(KEY_VECTORS[0].secret));
    expect(keys.signingKey).toMatchObject({ type: "private", extractable: false, usages: ["sign"] });
    expect(keys.signingKey.algorithm.name).toBe("Ed25519");
    expect(keys.encryptionKey).toMatchObject({ type: "secret", extractable: false });
    expect([...keys.encryptionKey.usages].sort()).toEqual(["decrypt", "encrypt"]);
    expect(keys.encryptionKey.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    await expect(crypto.subtle.exportKey("pkcs8", keys.signingKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("raw", keys.encryptionKey)).rejects.toThrow();
  });

  test("the public key signs: a signature verifies against it", async () => {
    const keys = await deriveKeys(fromHex(KEY_VECTORS[1].secret));
    const message = utf8("menu-sync/v1");
    const signature = await crypto.subtle.sign({ name: "Ed25519" }, keys.signingKey, message);
    const publicKey = await crypto.subtle.importKey("raw", fromBase64Url(KEY_VECTORS[1].publicKey)!, { name: "Ed25519" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, message)).toBe(true);
  });

  test("different secrets give different accounts", async () => {
    const a = await deriveKeys(fromHex(KEY_VECTORS[0].secret));
    const b = await deriveKeys(fromHex(KEY_VECTORS[1].secret));
    expect(a.accountId).not.toBe(b.accountId);
  });

  test("only 32-byte secrets are accepted", async () => {
    await expect(deriveKeys(new Uint8Array(31))).rejects.toThrow();
    await expect(deriveKeys(new Uint8Array(64))).rejects.toThrow();
  });

  test("leaves the caller's secret as it was", async () => {
    const secret = fromHex(KEY_VECTORS[1].secret);
    await deriveKeys(secret);
    expect(toHex(secret)).toBe(KEY_VECTORS[1].secret);
  });
});
