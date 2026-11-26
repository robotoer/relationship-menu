import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // HO-1: a tiny stand-in for the built app, so the tests don't need a build.
          // Everything else about assets (SPA fallback, run_worker_first) comes from
          // wrangler.toml.
          assets: { directory: "./test/fixtures/app" },
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Fake values: tests stub Stripe's API and sign webhooks with this secret.
            STRIPE_SECRET_KEY: "rk_test_fake",
            STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
          },
        },
      }),
    ],
    test: {
      // test-node/ runs in Node instead (vitest.node.config.ts).
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
