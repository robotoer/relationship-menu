import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "wrangler";

/**
 * HO-1, HO-2, NV-1, end to end through Cloudflare's own request routing: the
 * asset router in front, the Worker behind it only for /v1/*. Runs the real
 * wrangler.toml (each environment), with test/fixtures/app in place of the build.
 */

const SERVER = resolve(import.meta.dirname, "..");
const FIXTURE_APP = join(SERVER, "test/fixtures/app");
const toml = readFileSync(join(SERVER, "wrangler.toml"), "utf8");

const tempDirs: string[] = [];
afterAll(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/**
 * wrangler.toml with absolute paths, the fixture app in place of ../build, and no
 * `routes`. The harness reads a route as a path pattern (`wantsandwonts.com` would
 * be the root page only) and sends requests that match it straight to the Worker,
 * past the asset router. On Cloudflare a custom domain is the whole host, asset
 * router included, and production is checked there (server/README.md).
 */
const configFile = (): string => {
  const patched = toml
    .replace(/^main = "src\/index\.ts"$/m, `main = ${JSON.stringify(join(SERVER, "src/index.ts"))}`)
    .replace(/^directory = "\.\.\/build"$/m, `directory = ${JSON.stringify(FIXTURE_APP)}`)
    .replaceAll(/^migrations_dir = "migrations"$/gm, `migrations_dir = ${JSON.stringify(join(SERVER, "migrations"))}`)
    .replace(/^routes = \[\n(?:[ \t].*\n)*\]\n/m, "");
  // Guard: the replacements above must all have applied.
  expect(patched).toContain(FIXTURE_APP);
  expect(patched).toContain(join(SERVER, "src/index.ts"));
  expect(patched).not.toMatch(/^routes\b/m);
  const dir = mkdtempSync(join(tmpdir(), "wantsandwonts-routing-"));
  tempDirs.push(dir);
  const file = join(dir, "wrangler.toml");
  writeFileSync(file, patched);
  return file;
};

/** A browser opening a page by its address. */
const NAVIGATE = { accept: "text/html", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

for (const env of [undefined, "test", "production"]) {
  describe(`HO-1 routing (${env ?? "local"} environment)`, () => {
    let server: TestHarness;
    beforeAll(async () => {
      server = createTestHarness({ workers: [{ configPath: configFile(), ...(env ? { env } : {}) }] });
      await server.listen();
    }, 60_000);
    afterAll(() => server?.close());

    it("NV-1: every page address serves the app, without running Worker code", async () => {
      for (const path of ["/", "/library", "/menu?encoded=abc", "/compare", "/import", "/support", "/no/such/page", "/v1"]) {
        const response = await server.fetch(`https://wantsandwonts.com${path}`, { headers: NAVIGATE });
        expect(response.status, path).toBe(200);
        const body = await response.text();
        expect(body, path).toContain("fixture app shell");
        // The Worker's own answer to a path it doesn't know is a JSON 404.
        expect(body, path).not.toContain("not_found");
      }
    });

    it("serves the app's files as they are", async () => {
      const response = await server.fetch("https://wantsandwonts.com/robots.txt");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("a static file\n");
    });

    it("/v1/* always runs the Worker, even where a static file has the same path", async () => {
      const health = await server.fetch("https://wantsandwonts.com/v1/health");
      expect(await health.text()).toBe("ok");
      const unknown = await server.fetch("https://wantsandwonts.com/v1/nope", { headers: NAVIGATE });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: "not_found" });
    });

    it("HO-2: no CORS headers, on pages or on the API", async () => {
      for (const path of ["/library", "/v1/health"]) {
        const response = await server.fetch(`https://wantsandwonts.com${path}`, {
          headers: { ...NAVIGATE, origin: "https://evil.example" },
        });
        for (const [name] of response.headers) expect(name.toLowerCase(), path).not.toMatch(/^access-control-/);
      }
    });
  });
}
