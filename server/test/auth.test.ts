import { describe, expect, it } from "vitest";
import { toBase64Url, utf8 } from "../src/bytes";
import { Device, call, seedAccount, supporter } from "./helpers";

describe("SY-6: signed requests", () => {
  it("accepts a correctly signed request", async () => {
    const device = await supporter();
    const response = await device.fetch("GET", "/v1/account");
    expect(response.status).toBe(200);
  });

  it("rejects a request with no Authorization header", async () => {
    const response = await call(new Request("https://sync.test/v1/account"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a signature made with a different key", async () => {
    const device = await supporter();
    const other = await Device.create();
    const header = await other.authorization("GET", "/v1/account", new Uint8Array());
    // Claim the first device's account and key, but carry the other device's signature.
    const forged = header
      .replace(/account=[^,]+/, `account=${device.accountId}`)
      .replace(/key=[^,]+/, `key=${toBase64Url(device.publicKey)}`);
    const response = await call(new Request("https://sync.test/v1/account", { headers: { authorization: forged } }));
    expect(response.status).toBe(401);
  });

  it("rejects a key that doesn't hash to the claimed account (no stored credential needed)", async () => {
    const victim = await supporter();
    const attacker = await Device.create();
    const header = await attacker.authorization("GET", "/v1/account", new Uint8Array());
    const response = await call(
      new Request("https://sync.test/v1/account", {
        headers: { authorization: header.replace(/account=[^,]+/, `account=${victim.accountId}`) },
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects timestamps more than 5 minutes off", async () => {
    const device = await supporter();
    const now = Math.floor(Date.now() / 1000);
    expect((await device.fetch("GET", "/v1/account", { ts: now - 301 })).status).toBe(401);
    expect((await device.fetch("GET", "/v1/account", { ts: now + 301 })).status).toBe(401);
    expect((await device.fetch("GET", "/v1/account", { ts: now - 299 })).status).toBe(200);
  });

  it("binds the signature to the method, path, query and body", async () => {
    const device = await supporter();
    const body = utf8(JSON.stringify({ plan: "supporter_12_yearly" }));
    const header = await device.authorization("GET", "/v1/menus?since=0", new Uint8Array());

    const otherQuery = await call(new Request("https://sync.test/v1/menus?since=5", { headers: { authorization: header } }));
    expect(otherQuery.status).toBe(401);

    const otherPath = await call(new Request("https://sync.test/v1/account", { headers: { authorization: header } }));
    expect(otherPath.status).toBe(401);

    const postHeader = await device.authorization("POST", "/v1/checkout", body);
    const swappedBody = await call(
      new Request("https://sync.test/v1/checkout", {
        method: "POST",
        headers: { authorization: postHeader },
        body: utf8(JSON.stringify({ plan: "supporter_30_lifetime" })),
      })
    );
    expect(swappedBody.status).toBe(401);
  });

  it("works for an account the server has never seen (status none)", async () => {
    const device = await Device.create();
    const response = await device.fetch("GET", "/v1/account");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "none", readOnly: true });
  });

  it("derives the account id as base64url(SHA-256(public key)[0..16])", async () => {
    const device = await Device.create();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", device.publicKey));
    expect(device.accountId).toBe(toBase64Url(digest.slice(0, 16)));
    expect(device.accountId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    await seedAccount(device.accountId);
  });
});
