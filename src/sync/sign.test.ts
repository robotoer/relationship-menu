import { fromBase64Url, fromHex, sha256, toBase64Url, utf8 } from "./bytes";
import { deriveKeys } from "./keys";
import { authorizationHeader, canonicalRequest, requestPath } from "./sign";
import { SIGN_VECTORS, VECTOR_ACCOUNT } from "./test-vectors";

const HEADER = /^MenuSync v1 account=([A-Za-z0-9_-]{22}), key=([A-Za-z0-9_-]{43}), ts=(\d+), sig=([A-Za-z0-9_-]{86})$/;

const keys = () => deriveKeys(fromHex(VECTOR_ACCOUNT.secret));

/** Checks a header the way server/src/auth.ts authenticate() does, written out again here. */
const verifyLikeTheServer = async (header: string, method: string, path: string, body: Uint8Array) => {
  const [, account, key, ts, sig] = HEADER.exec(header) ?? [];
  const publicKey = fromBase64Url(key!)!;
  if (toBase64Url((await sha256(publicKey)).slice(0, 16)) !== account) return false;
  const message = ["menu-sync/v1", method, path, ts, toBase64Url(await sha256(body))].join("\n");
  const verifier = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "Ed25519" }, verifier, fromBase64Url(sig!)!, utf8(message));
};

describe("SY-6: signed requests, exactly as the server checks them", () => {
  // server/test/client-vectors.test.ts checks these same headers with the server's authenticate().
  test.each(SIGN_VECTORS)("$method $pathAndQuery → the frozen header", async (vector) => {
    const header = await authorizationHeader(await keys(), vector.method, vector.pathAndQuery, fromBase64Url(vector.body)!, vector.ts);
    expect(header).toBe(vector.header);
  });

  test("the header names the account and public key, and the signature verifies", async () => {
    const k = await keys();
    const body = utf8(JSON.stringify({ plan: "supporter_12_yearly" }));
    const header = await authorizationHeader(k, "post", "/v1/checkout", body, 1795564800);
    const [, account, key, ts] = HEADER.exec(header) ?? [];
    expect(account).toBe(VECTOR_ACCOUNT.accountId);
    expect(key).toBe(VECTOR_ACCOUNT.publicKey);
    expect(ts).toBe("1795564800");
    expect(await verifyLikeTheServer(header, "POST", "/v1/checkout", body)).toBe(true);
  });

  test("the signature covers the method, path, query, time and body", async () => {
    const k = await keys();
    const body = utf8("body");
    const header = await authorizationHeader(k, "PUT", "/v1/menus/AAECAwQFBgcICQoLDA0ODw?x=1", body, 1795564800);
    expect(await verifyLikeTheServer(header, "PUT", "/v1/menus/AAECAwQFBgcICQoLDA0ODw?x=1", body)).toBe(true);
    expect(await verifyLikeTheServer(header, "DELETE", "/v1/menus/AAECAwQFBgcICQoLDA0ODw?x=1", body)).toBe(false);
    expect(await verifyLikeTheServer(header, "PUT", "/v1/menus/AAECAwQFBgcICQoLDA0ODx?x=1", body)).toBe(false);
    expect(await verifyLikeTheServer(header, "PUT", "/v1/menus/AAECAwQFBgcICQoLDA0ODw?x=2", body)).toBe(false);
    expect(await verifyLikeTheServer(header.replace("ts=1795564800", "ts=1795564801"), "PUT", "/v1/menus/AAECAwQFBgcICQoLDA0ODw?x=1", body)).toBe(false);
    expect(await verifyLikeTheServer(header, "PUT", "/v1/menus/AAECAwQFBgcICQoLDA0ODw?x=1", utf8("bodY"))).toBe(false);
  });

  test("a string body is signed as its UTF-8 bytes", async () => {
    const k = await keys();
    const text = '{"plan":"supporter_6_yearly","note":"ünïcödé"}';
    expect(await authorizationHeader(k, "POST", "/v1/checkout", text, 1)).toBe(
      await authorizationHeader(k, "POST", "/v1/checkout", utf8(text), 1)
    );
  });

  test("the canonical request is the five lines from server/README.md", () => {
    expect(canonicalRequest("get", "/v1/menus?since=0", 12, "hash")).toBe("menu-sync/v1\nGET\n/v1/menus?since=0\n12\nhash");
  });

  test("signs the path as fetch() sends it and the Worker parses it", () => {
    expect(requestPath("/v1/menus?since=0")).toBe("/v1/menus?since=0");
    expect(requestPath("/v1/menus?")).toBe("/v1/menus");
    expect(requestPath("/v1/a b")).toBe("/v1/a%20b");
    expect(requestPath("/v1/./menus/../account")).toBe("/v1/account");
  });

  test("refuses anything that isn't a path on our own origin", async () => {
    for (const bad of ["v1/account", "//evil.example/v1/account", "/\\evil.example/v1", "https://evil.example/v1", "/v1/account#x"]) {
      expect(() => requestPath(bad)).toThrow();
    }
    const k = await keys();
    await expect(authorizationHeader(k, "GET", "https://evil.example/v1/account", "", 1)).rejects.toThrow();
    await expect(authorizationHeader(k, "GET\nX", "/v1/account", "", 1)).rejects.toThrow();
    await expect(authorizationHeader(k, "GET", "/v1/account", "", 1.5)).rejects.toThrow();
    await expect(authorizationHeader(k, "GET", "/v1/account", "", -1)).rejects.toThrow();
    await expect(authorizationHeader(k, "GET", "/v1/account", "", 1e13)).rejects.toThrow();
  });
});
