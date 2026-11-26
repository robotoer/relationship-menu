import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "../src/bytes";
import { env, newId, record, supporter, unsigned, Device } from "./helpers";

describe("SY-10, SY-12: one-time pairing links", () => {
  it("returns the blob exactly once; a second read says it was used", async () => {
    const device = await supporter();
    const id = newId();
    const blob = record(120);
    const created = await device.fetch("POST", "/v1/pair", { body: { id, blob: toBase64Url(blob) } });
    expect(created.status).toBe(201);

    const first = await unsigned("GET", `/v1/pair/${id}`);
    expect(first.status).toBe(200);
    expect(fromBase64Url(((await first.json()) as { blob: string }).blob)).toEqual(blob);

    const second = await unsigned("GET", `/v1/pair/${id}`);
    expect(second.status).toBe(410);
    expect(await second.json()).toEqual({ error: "used" });

    // The blob itself is gone from the database.
    const row = await env.DB.prepare("SELECT blob FROM pairings WHERE id = ?").bind(id).first<{ blob: unknown }>();
    expect(row?.blob).toBeNull();
  });

  it("says an expired link has expired (10 minutes)", async () => {
    const id = newId();
    await env.DB.prepare("INSERT INTO pairings (id, blob, expires_at) VALUES (?, ?, ?)").bind(id, record(50), Date.now() - 1).run();
    const response = await unsigned("GET", `/v1/pair/${id}`);
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "expired" });
  });

  it("answers 404 for unknown ids", async () => {
    expect((await unsigned("GET", `/v1/pair/${newId()}`)).status).toBe(404);
    expect((await unsigned("GET", "/v1/pair/x")).status).toBe(404);
  });

  it("caps blobs at 1 KiB and requires a supporter account (SY-45)", async () => {
    const device = await supporter();
    const big = await device.fetch("POST", "/v1/pair", { body: { id: newId(), blob: toBase64Url(record(1025)) } });
    expect(big.status).toBe(413);

    const stranger = await Device.create();
    const none = await stranger.fetch("POST", "/v1/pair", { body: { id: newId(), blob: toBase64Url(record(50)) } });
    expect(none.status).toBe(402);
  });

  it("won't overwrite an existing pairing id", async () => {
    const device = await supporter();
    const id = newId();
    await device.fetch("POST", "/v1/pair", { body: { id, blob: toBase64Url(record(50)) } });
    const again = await device.fetch("POST", "/v1/pair", { body: { id, blob: toBase64Url(record(50)) } });
    expect(again.status).toBe(409);
  });
});
