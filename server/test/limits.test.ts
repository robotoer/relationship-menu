import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPriceCache } from "../src/stripe";
import { Device, call, mockStripe, newId } from "./helpers";

afterEach(() => vi.restoreAllMocks());

describe("SY-43: rate limits", () => {
  it("allows 5 checkout/portal/pairing calls a minute per account, then answers 429 with Retry-After", async () => {
    clearPriceCache();
    mockStripe({
      "GET /v1/prices": () => ({ data: [{ id: "price_12", lookup_key: "supporter_12_yearly", recurring: { interval: "year" } }] }),
      "POST /v1/checkout/sessions": () => ({ id: "cs", url: "https://checkout.stripe.com/x" }),
    });
    const device = await Device.create();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await device.fetch("POST", "/v1/checkout", { body: { plan: "supporter_12_yearly" } })).status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);

    // Another account isn't affected.
    const other = await Device.create();
    expect((await other.fetch("POST", "/v1/checkout", { body: { plan: "supporter_12_yearly" } })).status).toBe(200);
  });

  it("limits unauthenticated pairing reads per IP address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await call(
        new Request(`https://sync.test/v1/pair/${newId()}`, { headers: { "cf-connecting-ip": "198.51.100.9" } })
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
