import { fromBase64Url, fromHex, sha256, toBase64Url, toHex } from "./bytes";
import { PairingError, createPairing, openPairing, pairingIdForKey, pairingKeyFromFragment, pairingLink } from "./pairing";
import { VECTOR_ACCOUNT } from "./test-vectors";

const SECRET = fromHex(VECTOR_ACCOUNT.secret);

const pairingError = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => e
  );

describe("SY-10: one-time pairing links", () => {
  test("round trip: the link's key opens the blob and gives back the secret", async () => {
    const pairing = await createPairing(SECRET);
    const link = pairingLink("https://wantsandwonts.com", pairing.key);
    const key = pairingKeyFromFragment(new URL(link).hash);
    expect(key).not.toBeNull();
    expect(toHex(await openPairing(key!, pairing.blob))).toBe(VECTOR_ACCOUNT.secret);
  });

  test("the id is base64url of the first 16 bytes of SHA-256(K), as the server stores it", async () => {
    const pairing = await createPairing(SECRET);
    const k = fromBase64Url(pairing.key)!;
    expect(k).toHaveLength(32);
    expect(pairing.id).toBe(toBase64Url((await sha256(k)).slice(0, 16)));
    expect(pairing.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await pairingIdForKey(k)).toBe(pairing.id);
  });

  test("the blob is 60 bytes (nonce, encrypted secret, tag), well under the server's 1 KiB", async () => {
    const blob = fromBase64Url((await createPairing(SECRET)).blob)!;
    expect(blob).toHaveLength(12 + 32 + 16);
    expect(toHex(blob)).not.toContain(VECTOR_ACCOUNT.secret);
  });

  test("every pairing has its own key, id and nonce", async () => {
    const a = await createPairing(SECRET);
    const b = await createPairing(SECRET);
    expect(a.key).not.toBe(b.key);
    expect(a.id).not.toBe(b.id);
    expect(a.blob).not.toBe(b.blob);
  });

  test("the link is /pair with K only in the fragment, which browsers never send (SY-11)", async () => {
    const { key, id } = await createPairing(SECRET);
    const url = new URL(pairingLink("https://wantsandwonts.com/some/page?x=1", key));
    expect(url.origin + url.pathname + url.search).toBe("https://wantsandwonts.com/pair");
    expect(url.hash).toBe(`#${key}`);
    expect(url.href).not.toContain(id);
  });

  test("reads the fragment with or without '#', and rejects anything else", async () => {
    const { key } = await createPairing(SECRET);
    expect(toBase64Url(pairingKeyFromFragment(key)!)).toBe(key);
    expect(toBase64Url(pairingKeyFromFragment(`#${key}`)!)).toBe(key);
    for (const bad of ["", "#", key.slice(1), key + "A", `${key.slice(0, 42)}!`, `#${key}&x=1`]) {
      expect(pairingKeyFromFragment(bad)).toBeNull();
    }
    // 43 characters carry 258 bits: a last character with either spare bit set isn't a key's spelling.
    const zero = toBase64Url(new Uint8Array(32));
    expect(pairingKeyFromFragment(zero)).not.toBeNull();
    expect(pairingKeyFromFragment(zero.slice(0, 42) + "B")).toBeNull();
  });

  test("a wrong key or a changed blob doesn't open, and says so without details", async () => {
    const pairing = await createPairing(SECRET);
    const other = await createPairing(SECRET);
    const wrongKey = await pairingError(openPairing(fromBase64Url(other.key)!, pairing.blob));
    expect(wrongKey).toBeInstanceOf(PairingError);
    expect((wrongKey as Error).message).toBe("This pairing link doesn't work. Type the 24 words instead.");

    const blob = fromBase64Url(pairing.blob)!;
    for (let i = 0; i < blob.length; i++) {
      const tampered = new Uint8Array(blob);
      tampered[i]! ^= 0x80;
      expect(await pairingError(openPairing(fromBase64Url(pairing.key)!, tampered))).toBeInstanceOf(PairingError);
    }
    expect(await pairingError(openPairing(fromBase64Url(pairing.key)!, blob.slice(1)))).toBeInstanceOf(PairingError);
    expect(await pairingError(openPairing(fromBase64Url(pairing.key)!, "not base64url!"))).toBeInstanceOf(PairingError);
    expect(await pairingError(openPairing(new Uint8Array(16), pairing.blob))).toBeInstanceOf(PairingError);
  });

  test("only a 32-byte secret can be paired", async () => {
    await expect(createPairing(new Uint8Array(16))).rejects.toThrow();
  });
});
