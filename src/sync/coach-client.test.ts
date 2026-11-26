import { fromBase64Url, fromHex, sha256, toBase64Url, utf8 } from "./bytes";
import { deriveKeys } from "./keys";
import { canonicalRequest } from "./sign";
import { VECTOR_ACCOUNT } from "./test-vectors";
import { createSyncCoachClient } from "./coach-client";

/** Checks an Authorization header the way server/src/auth.ts does. */
const verifyLikeTheServer = async (header: string, method: string, path: string, body: Uint8Array) => {
  const fields = Object.fromEntries(
    header.replace(/^MenuSync v1 /, "").split(", ").map((part) => part.split("=") as [string, string])
  );
  const message = canonicalRequest(method, path, Number(fields.ts), toBase64Url(await sha256(body)));
  const verifier = await crypto.subtle.importKey("raw", fromBase64Url(fields.key)!, { name: "Ed25519" }, false, ["verify"]);
  return { fields, valid: await crypto.subtle.verify({ name: "Ed25519" }, verifier, fromBase64Url(fields.sig)!, utf8(message)) };
};

describe("createSyncCoachClient", () => {
  it("signs POST /v1/coach with the supporter's keys, over the exact body sent", async () => {
    const keys = await deriveKeys(fromHex(VECTOR_ACCOUNT.secret));
    const guide = { opening: "o", closing: "c", topics: [{ id: "t0", about: "a", questions: ["q"] }] };
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(guide)));
    const client = createSyncCoachClient(keys, "https://sync.example", {
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => 1_800_000_000_000,
    });
    const request = { people: 2, topics: [{ id: "t0", group: "G", item: "Kids", kind: "conflict" as const, answers: ["must-have" as const, "off-limits" as const] }] };
    expect(await client(request)).toEqual(guide);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://sync.example/v1/coach");
    const body = init!.body as Uint8Array;
    const { fields, valid } = await verifyLikeTheServer((init!.headers as Record<string, string>).authorization, "POST", "/v1/coach", body);
    expect(valid).toBe(true);
    expect(fields.account).toBe(VECTOR_ACCOUNT.accountId);
    expect(fields.ts).toBe("1800000000");
    // A different body doesn't verify with the same header.
    expect((await verifyLikeTheServer((init!.headers as Record<string, string>).authorization, "POST", "/v1/coach", utf8("{}"))).valid).toBe(false);
  });
});
