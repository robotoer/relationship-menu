/**
 * The app's request signing (src/sync/sign.ts) against the server's check.
 *
 * src/sync/test-vectors.ts holds headers the app produced for fixed requests,
 * and src/sync/sign.test.ts checks that the app still produces exactly those.
 * Here the server's own authenticate() must accept each of them, so the two
 * sides can't drift apart.
 */

import { describe, expect, it } from "vitest";
import { KEY_VECTORS, SIGN_VECTORS, VECTOR_ACCOUNT } from "../../src/sync/test-vectors";
import { accountIdForKey, authenticate } from "../src/auth";
import { fromBase64Url, toBase64Url } from "../src/bytes";
import { HttpError } from "../src/http";

type Vector = { method: string; pathAndQuery: string; body: string; ts: number; header: string };

const requestFor = (vector: Vector) =>
  new Request(`https://sync.test${vector.pathAndQuery}`, { method: vector.method, headers: { authorization: vector.header } });

const bodyOf = (vector: Vector) => fromBase64Url(vector.body)!;

const statusOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error: unknown) => (error instanceof HttpError ? error.status : 500)
  );

describe("SY-6: the app's signed requests pass the server's check", () => {
  it.each(SIGN_VECTORS)("accepts the app's header for $method $pathAndQuery", async (vector) => {
    const caller = await authenticate(requestFor(vector), bodyOf(vector), vector.ts * 1000);
    expect(caller.accountId).toBe(VECTOR_ACCOUNT.accountId);
    expect(toBase64Url(caller.publicKey)).toBe(VECTOR_ACCOUNT.publicKey);
    expect(caller.ts).toBe(vector.ts);
  });

  it("derives the same account ids from the app's public keys", async () => {
    for (const vector of KEY_VECTORS) {
      expect(await accountIdForKey(fromBase64Url(vector.publicKey)!)).toBe(vector.accountId);
    }
  });

  it("still rejects those headers on a different body, path or method, or outside the 5-minute window", async () => {
    const put = SIGN_VECTORS.find((v) => v.method === "PUT")!;
    const body = bodyOf(put);
    const changed = new Uint8Array(body);
    changed[0]! ^= 1;
    expect(await statusOf(authenticate(requestFor(put), changed, put.ts * 1000))).toBe(401);
    expect(await statusOf(authenticate(requestFor({ ...put, pathAndQuery: "/v1/menus/AAECAwQFBgcICQoLDA0ODx" }), body, put.ts * 1000))).toBe(401);
    expect(await statusOf(authenticate(requestFor({ ...put, method: "DELETE" }), body, put.ts * 1000))).toBe(401);
    expect(await statusOf(authenticate(requestFor(put), body, (put.ts + 301) * 1000))).toBe(401);
    expect(await statusOf(authenticate(requestFor(put), body, (put.ts + 299) * 1000))).toBe(200);
  });
});
