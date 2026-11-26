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

test("10b5-1 plan buys are hidden by default and shown when the box is unchecked", async ({ page }) => {
  const badge = page.getByText("10b5-1 plan", { exact: true });
  await page.goto("/?days=365");
  await expect(page.getByLabel("Hide 10b5-1 plan buys")).toBeChecked();
  await expect(badge).toHaveCount(0);

  await page.getByLabel("Hide 10b5-1 plan buys").uncheck();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByLabel("Hide 10b5-1 plan buys")).not.toBeChecked();
  await expect(badge.first()).toBeVisible();
});

test("ticker audit lines are grouped per filing and expand without scripts", async ({ page }) => {
  await page.goto("/ticker/EVMD");
  const group = page.getByTestId("audit-group").first();
  await expect(group).toBeVisible();
  await expect(group.getByTestId("audit-line").first()).toBeHidden();
  await group.locator("summary").click();
  await expect(group.getByTestId("audit-line").first()).toBeVisible();
});
