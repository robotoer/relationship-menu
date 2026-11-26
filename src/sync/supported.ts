/**
 * Can this browser sync? (SY-14)
 *
 * Sync needs WebCrypto with Ed25519 (Chrome 137+, Safari 17+, Firefox 129+),
 * HKDF and AES-GCM. Rather than look for names, this runs the steps sync really
 * uses, on a fixed test secret:
 *
 * - derives the keys (HKDF, Ed25519 from a seed via PKCS#8, the public key via
 *   JWK) and requires the frozen account id, so a browser that would derive a
 *   different account from the same code can never turn sync on;
 * - signs and verifies with Ed25519;
 * - encrypts and decrypts a record with AES-256-GCM and additional data.
 *
 * Anything missing or wrong gives false; it never throws. It takes a few
 * milliseconds, so call it when a sync or Support screen opens, not on load.
 */

import { utf8 } from "./bytes";
import { deriveKeys } from "./keys";
import { decryptRecord, encryptRecord } from "./records";
import { PROTOCOL } from "./sign";

/** deriveKeys(32 zero bytes).accountId, the first entry of KEY_VECTORS in test-vectors.ts. */
export const SELF_TEST_ACCOUNT_ID = "irGW6uf_WXpCGwX1NtAvbw";

export const syncSupported = async (): Promise<boolean> => {
  try {
    const webCrypto = globalThis.crypto;
    if (!webCrypto?.subtle || typeof webCrypto.getRandomValues !== "function") return false;

    const keys = await deriveKeys(new Uint8Array(32));
    if (keys.accountId !== SELF_TEST_ACCOUNT_ID) return false;

    const message = utf8(PROTOCOL);
    const signature = await webCrypto.subtle.sign({ name: "Ed25519" }, keys.signingKey, message);
    const publicKey = await webCrypto.subtle.importKey("raw", keys.publicKey, { name: "Ed25519" }, false, ["verify"]);
    if (!(await webCrypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, message))) return false;

    const record = { id: "AAAAAAAAAAAAAAAAAAAAAA", title: "test", encoded: "", editId: "test" };
    const ciphertext = await encryptRecord(keys, 1, record);
    const opened = await decryptRecord(keys, { id: record.id, version: 1, deleted: false, ciphertext });
    return opened.title === record.title;
  } catch {
    return false;
  }
};
