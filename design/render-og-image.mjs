// Renders design/og-image.html to public/og-image.png (1200×630), with the
// Chromium that Playwright already installs for the e2e tests.
// Usage: yarn og-image [output.png]
import { chromium } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const source = pathToFileURL(resolve(here, "og-image.html")).href;
const output = resolve(process.argv[2] ?? resolve(here, "../public/og-image.png"));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(source);
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() =>
    ["20px 'Press Start 2P'", "20px VT323"].filter((font) => !document.fonts.check(font))
  );
  if (missing.length) throw new Error(`Fonts didn't load: ${missing.join(", ")}. Run yarn install first.`);
  await page.screenshot({ path: output, type: "png" });
  console.log(`Wrote ${output}`);
} finally {
  await browser.close();
}
