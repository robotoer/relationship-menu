/**
 * Web push primitives (docs/spec/notifications.md NT-21, NT-25, NT-55, §7b):
 * RFC 8291 encryption against the RFC's own example, VAPID (RFC 8292) and the
 * endpoint allowlist.
 */

import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url, utf8 } from "../src/bytes";
import type { Env } from "../src/env";
import {
  JWT_LIFETIME_SECONDS,
  RECORD_SIZE,
  encryptPayload,
  isPushEndpoint,
  pushConfigured,
  sendPush,
  vapidAuthorization,
  vapidJwt,
  type VapidEnv,
} from "../src/webpush";
import { PUSH_ENV, PushBrowser, VAPID, VAPID_SUBJECT, env } from "./helpers";

const b64 = (text: string) => fromBase64Url(text)!;

/** An ECDH key pair from RFC 8291's base64url private key and uncompressed public key. */
const importPair = async (privateKey: string, publicKey: string): Promise<CryptoKeyPair> => {
  const pub = b64(publicKey);
  const jwk = { kty: "EC", crv: "P-256", d: privateKey, x: toBase64Url(pub.slice(1, 33)), y: toBase64Url(pub.slice(33)) };
  return {
    privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("raw", pub, { name: "ECDH", namedCurve: "P-256" }, true, []),
  };
};

/** Splits a JWT and checks its ES256 signature with the VAPID public key. */
const verifyJwt = async (jwt: string, publicKey: CryptoKey) => {
  const [header, claims, signature] = jwt.split(".");
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    b64(signature!),
    utf8(`${header}.${claims}`)
  );
  const decode = (part: string) => JSON.parse(new TextDecoder().decode(b64(part))) as Record<string, unknown>;
  return { valid, header: decode(header!), claims: decode(claims!) };
};

describe("RFC 8291 message encryption (NT-21)", () => {
  it("reproduces the example in RFC 8291 Appendix A byte for byte", async () => {
    const plaintext = utf8("When I grow up, I want to be a watermelon");
    const sender = await importPair(
      "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
    );
    const receiverPublic = b64(
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
    );
    const body = await encryptPayload(plaintext, receiverPublic, b64("BTBZMqHH6r4Tts7J_aSIgg"), {
      salt: b64("DGv6ra1nlYgDCS1FRnbzlw"),
      ephemeral: sender,
    });
    expect(toBase64Url(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    );
  });

  it("decrypts as a browser would, for payloads of every size up to one record", async () => {
    const browser = await PushBrowser.create();
    for (const size of [0, 1, 15, 16, 17, 100, 1000, RECORD_SIZE - 17]) {
      const text = "x".repeat(size);
      const body = await encryptPayload(utf8(text), browser.publicKey, browser.authSecret);
      expect(await browser.decrypt(body)).toBe(text);
      // salt (16) ‖ rs (4) ‖ idlen (1) ‖ keyid (65) ‖ data ‖ 0x02 ‖ tag (16)
      expect(body.length).toBe(86 + size + 1 + 16);
      expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
      expect(body[20]).toBe(65);
      expect(body[21]).toBe(0x04);
    }
    await expect(encryptPayload(utf8("x".repeat(RECORD_SIZE - 16)), browser.publicKey, browser.authSecret)).rejects.toThrow();
  });

  it("uses a fresh salt and sender key for every message", async () => {
    const browser = await PushBrowser.create();
    const a = await encryptPayload(utf8("same"), browser.publicKey, browser.authSecret);
    const b = await encryptPayload(utf8("same"), browser.publicKey, browser.authSecret);
    expect(toBase64Url(a.slice(0, 16))).not.toBe(toBase64Url(b.slice(0, 16)));
    expect(toBase64Url(a.slice(21, 86))).not.toBe(toBase64Url(b.slice(21, 86)));
    expect(await browser.decrypt(a)).toBe("same");
    expect(await browser.decrypt(b)).toBe("same");
  });

  it("can't be read with another browser's keys", async () => {
    const browser = await PushBrowser.create();
    const other = await PushBrowser.create();
    const body = await encryptPayload(utf8("secret"), browser.publicKey, browser.authSecret);
    await expect(other.decrypt(body)).rejects.toThrow();
  });

  it("refuses malformed receiver keys", async () => {
    const browser = await PushBrowser.create();
    await expect(encryptPayload(utf8("x"), browser.publicKey.slice(1), browser.authSecret)).rejects.toThrow();
    await expect(encryptPayload(utf8("x"), browser.publicKey, browser.authSecret.slice(1))).rejects.toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  const vapidEnv = PUSH_ENV as VapidEnv;

  it("signs an ES256 JWT for the endpoint's origin, valid at most 24 hours, with the project's subject", async () => {
    const now = Date.now();
    const jwt = await vapidJwt(vapidEnv, "https://fcm.googleapis.com/fcm/send/abc?x=1", now);
    const { valid, header, claims } = await verifyJwt(jwt, VAPID.verifyKey);
    expect(valid).toBe(true);
    expect(header).toEqual({ typ: "JWT", alg: "ES256" });
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: Math.floor(now / 1000) + JWT_LIFETIME_SECONDS, sub: VAPID_SUBJECT });
    expect(JWT_LIFETIME_SECONDS).toBeLessThanOrEqual(24 * 3600);
  });

  it("sends `vapid t=<jwt>, k=<public key>`", async () => {
    const header = await vapidAuthorization(vapidEnv, "https://web.push.apple.com/QGuQyavXuk");
    const match = header.match(/^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/);
    expect(match).not.toBeNull();
    expect(match![2]).toBe(VAPID.publicKey);
    const { valid, claims } = await verifyJwt(match![1]!, VAPID.verifyKey);
    expect(valid).toBe(true);
    expect(claims.aud).toBe("https://web.push.apple.com");
  });

  it("is on only with a well-formed key pair and a mailto: or https: subject", () => {
    expect(pushConfigured(env)).toBe(false);
    expect(pushConfigured(PUSH_ENV)).toBe(true);
    const variants: Partial<Env>[] = [
      { VAPID_PUBLIC_KEY: undefined },
      { VAPID_PRIVATE_KEY: undefined },
      { VAPID_SUBJECT: undefined },
      { VAPID_SUBJECT: "push@wantsandwonts.example" },
      { VAPID_PUBLIC_KEY: VAPID.publicKey.slice(0, -2) },
      { VAPID_PUBLIC_KEY: toBase64Url(new Uint8Array(65)) },
      { VAPID_PRIVATE_KEY: toBase64Url(new Uint8Array(31)) },
      { VAPID_PRIVATE_KEY: "not base64url!" },
    ];
    for (const variant of variants) expect(pushConfigured({ ...PUSH_ENV, ...variant })).toBe(false);
    expect(pushConfigured({ ...PUSH_ENV, VAPID_SUBJECT: "https://wantsandwonts.example/contact" })).toBe(true);
  });
});

describe("NT-55: only https endpoints on known push services", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://fcm.googleapis.com/wp/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGuQyavXuk",
    "https://api.push.apple.com/3/device/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB",
    "https://FCM.GoogleAPIs.com/fcm/send/abc",
  ])("allows %s", (endpoint) => {
    expect(isPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://example.com/push",
    "https://fcm.googleapis.com.evil.test/fcm/send/abc",
    "https://evilfcm.googleapis.com/fcm/send/abc",
    "https://googleapis.com/fcm/send/abc",
    "https://apple.com/push",
    "https://push.apple.com.evil.test/x",
    "https://evil.test/https://fcm.googleapis.com/",
    "https://evil.test/?fcm.googleapis.com",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://user:pass@fcm.googleapis.com/fcm/send/abc",
    "https://127.0.0.1/push",
    "wss://fcm.googleapis.com/fcm/send/abc",
    "fcm.googleapis.com/fcm/send/abc",
    "not a url",
    "",
    `https://fcm.googleapis.com/fcm/send/${"a".repeat(1024)}`,
  ])("refuses %s", (endpoint) => {
    expect(isPushEndpoint(endpoint)).toBe(false);
  });
});

describe("sendPush (RFC 8030)", () => {
  const vapidEnv = PUSH_ENV as VapidEnv;
  const payload = { box: "AAAAAAAAAAAAAAAAAAAAAA", kind: "notes", count: 2 } as const;

  it("posts the encrypted payload with the headers and returns the push service's status", async () => {
    const browser = await PushBrowser.create();
    const seen: { url: string; init: RequestInit }[] = [];
    const status = await sendPush(vapidEnv, browser.subscription, payload, async (url, init) => {
      seen.push({ url, init });
      return new Response(null, { status: 201 });
    });
    expect(status).toBe(201);
    expect(seen).toHaveLength(1);
    const { url, init } = seen[0]!;
    expect(url).toBe(browser.endpoint);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const headers = new Headers(init.headers);
    expect(headers.get("ttl")).toBe("86400");
    expect(headers.get("urgency")).toBe("normal");
    expect(headers.get("topic")).toBe(payload.box);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(await browser.decrypt(init.body as Uint8Array)).toBe('{"box":"AAAAAAAAAAAAAAAAAAAAAA","kind":"notes","count":2}');
  });

  it("returns the push service's error statuses, and 0 when it can't be reached", async () => {
    const browser = await PushBrowser.create();
    for (const code of [404, 410, 429, 500, 503]) {
      expect(await sendPush(vapidEnv, browser.subscription, payload, async () => new Response(null, { status: code }))).toBe(code);
    }
    expect(
      await sendPush(vapidEnv, browser.subscription, payload, async () => {
        throw new TypeError("Network connection lost.");
      })
    ).toBe(0);
  });

  it("never calls an endpoint outside the allowlist", async () => {
    const browser = await PushBrowser.create();
    let called = false;
    const attempt = sendPush(vapidEnv, { ...browser.subscription, endpoint: "https://evil.test/push" }, payload, async () => {
      called = true;
      return new Response(null, { status: 201 });
    });
    await expect(attempt).rejects.toThrow();
    expect(called).toBe(false);
  });
});
