import { describe, expect, it } from "vitest";
import wranglerToml from "../wrangler.toml?raw";
import { unsigned } from "./helpers";

/**
 * HO-1: one Worker serves the built app (static files) and /v1/* (the API). The
 * routing itself, asset router in front and this Worker behind it, is checked
 * end to end in test-node/routing.test.ts; these check the two halves here.
 */
describe("HO-1: only /v1/* runs Worker code", () => {
  it("wrangler.toml routes only /v1/* to the Worker and falls back to the app", () => {
    const assets = wranglerToml.match(/^\[assets\]\n((?:[^[\n].*\n?)*)/m)?.[1] ?? "";
    expect(assets).toMatch(/^directory = "\.\.\/build"$/m);
    expect(assets).toMatch(/^not_found_handling = "single-page-application"$/m);
    expect(assets).toMatch(/^run_worker_first = \["\/v1\/\*"\]$/m);
    // Environments inherit [assets]; none may override it.
    expect(wranglerToml).not.toMatch(/^\[env\.[a-z]+\.assets\]/m);
  });

  it("production is served at wantsandwonts.com, as a custom domain (the whole host)", () => {
    const production = wranglerToml.match(/^\[env\.production\]\n((?:[^[\n].*\n?|\n|  .*\n|\]\n)*)/m)?.[1] ?? "";
    expect(production).toMatch(/^routes = \[\n  \{ pattern = "wantsandwonts\.com", custom_domain = true \},\n\]$/m);
    // Only production has an address of its own.
    expect(wranglerToml.match(/^routes\b/gm)).toHaveLength(1);
  });

  it("the Worker code answers anything outside /v1/ with a JSON 404, so it never serves pages", async () => {
    for (const path of ["/", "/library", "/import", "/menu?encoded=abc", "/robots.txt", "/v1"]) {
      const response = await unsigned("GET", path);
      expect(response.status, path).toBe(404);
      expect(await response.json(), path).toEqual({ error: "not_found" });
    }
  });
});
