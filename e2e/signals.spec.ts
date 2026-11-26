import { expect, test } from "@playwright/test";

test("signals page shows the sample banner, footer, rows, badges and score breakdowns", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("SAMPLE DATA")).toBeVisible();
  await expect(page.getByText("not investment advice")).toBeVisible();

  const rows = page.getByTestId("signal-row");
  await expect(rows.first()).toBeVisible();
  await expect(page.getByText("Cluster", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("score-breakdown").first()).toContainText(/Score \d+: /);
  await expect(page.locator('a[href*="/Archives/edgar/data/"]').first()).toBeVisible();
});

test("min score filter narrows the list", async ({ page }) => {
  await page.goto("/");
  const before = await page.getByTestId("signal-row").count();
  await page.goto("/?min=8");
  const after = await page.getByTestId("signal-row").count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
});

test("matches-default-rule filter keeps only checked rows", async ({ page }) => {
  await page.goto("/?rule=1");
  const rows = page.getByTestId("signal-row");
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all()) await expect(row.getByTitle("Matches the default rule")).toBeVisible();
});

test("a ticker link opens the ticker page with audit lines", async ({ page }) => {
  await page.goto("/");
  const ticker = (await page.getByTestId("signal-row").first().locator("a").first().textContent())!;
  await page.getByTestId("signal-row").first().locator("a").first().click();
  await expect(page.getByRole("heading", { name: ticker })).toBeVisible();
  await expect(page.getByTestId("ticker-signal").first()).toBeVisible();
});

test("unknown ticker is a 404", async ({ page }) => {
  expect((await page.goto("/ticker/NOPE"))?.status()).toBe(404);
});
