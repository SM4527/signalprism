import { expect, test } from "@playwright/test";

/** README screenshots from the sample stack. Run with `npm run shots`; skipped in the normal e2e run. */
test.skip(!process.env.SHOTS, "set SHOTS=1 to capture screenshots");
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });

const pages = [
  { name: "signals", path: "/?days=365" },
  { name: "ticker", path: "/ticker/EVMD" },
  { name: "watchlist", path: "/watchlist", fullPage: true },
  { name: "rules", path: "/rules" },
  { name: "status", path: "/status" },
];

for (const { name, path, fullPage } of pages) {
  test(`screenshot ${name}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText("SAMPLE DATA")).toBeVisible();
    await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage });
  });
}
