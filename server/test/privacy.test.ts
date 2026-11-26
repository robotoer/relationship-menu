import { afterEach, describe, expect, it, vi } from "vitest";
import { toBase64Url, toHex, utf8 } from "../src/bytes";
import { clearPriceCache } from "../src/stripe";
import { call, createMenu, event, mockStripe, newId, record, subscription, supporter, webhookRequest } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const MARKER = "ZqxSecretMenuText";

describe("SY-44: nothing identifying or secret reaches the logs", () => {
  it("logs only route patterns, statuses and codes through a full flow, including failures", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    clearPriceCache();

    const device = await supporter();
    const ciphertext = record(400, MARKER);
    const { id } = await createMenu(device, ciphertext);
    // A version mismatch, an oversize write, a bad request, and a Stripe outage.
    await device.fetch("PUT", `/v1/menus/${id}`, { body: ciphertext, headers: { "if-match": "9" } });
    await device.fetch("PUT", `/v1/menus/${newId()}`, { body: record(70_000, MARKER), headers: { "if-none-match": "*" } });
    await device.fetch("POST", "/v1/checkout", { body: `{"plan":"${MARKER}"}` });
    mockStripe({});
    await device.fetch("POST", "/v1/checkout", { body: { plan: "supporter_12_yearly" } });
    await call(
      new Request(`https://sync.test/v1/pair/${newId()}`, { headers: { "cf-connecting-ip": "203.0.113.77" } })
    );
    await call(await webhookRequest(event("customer.subscription.updated", subscription({ id: "sub_x", account_id: device.accountId }))));

    const everything = lines.join("\n");
    expect(lines.length).toBeGreaterThan(0); // the Stripe outage was logged
    for (const secret of [
      MARKER,
      toBase64Url(utf8(MARKER)),
      toHex(utf8(MARKER)),
      device.accountId,
      toBase64Url(device.publicKey),
      id,
      "203.0.113.77",
      "MenuSync v1",
      "rk_test_fake",
      "whsec_test_fake",
      "sub_x",
    ]) {
      expect(everything).not.toContain(secret);
    }
    // Every line is the structured shape from src/log.ts.
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(expect.arrayContaining(["route", "status", "code"]));
      expect(String(parsed.route)).not.toMatch(/[A-Za-z0-9_-]{22}/);
    }
  });
});

describe("SY-41: same origin, no CORS", () => {
  it("never sends Access-Control-Allow-* headers", async () => {
    const device = await supporter();
    const response = await device.fetch("GET", "/v1/account", { headers: { origin: "https://evil.example" } });
    for (const [name] of response.headers) expect(name.toLowerCase()).not.toMatch(/^access-control-/);
  });
});
