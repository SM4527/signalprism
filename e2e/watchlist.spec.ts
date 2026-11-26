import { expect, test } from "@playwright/test";

test("watchlist lists the sample companies with a source chip", async ({ page }) => {
  await page.goto("/watchlist");
  await expect(page.getByText("SAMPLE DATA")).toBeVisible();
  const rows = page.getByTestId("watchlist-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(1);
  await expect(rows.filter({ hasText: "ACMR" }).getByText("manual")).toBeVisible();
});

test("refresh from FolioPrism builds direct and fund sources and lists untracked tickers", async ({ page }) => {
  await page.goto("/watchlist");
  await page.getByRole("button", { name: "Refresh from FolioPrism" }).click();
  await expect(page.getByTestId("watchlist-msg")).toContainText("Refreshed from FolioPrism: 2 direct");
  const rows = page.getByTestId("watchlist-row");
  await expect(rows.filter({ hasText: "MSFT" }).getByText("direct", { exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "NVDA" }).getByText("funds", { exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "QQQ" })).toHaveCount(0);
  await expect(page.getByTestId("not-tracked")).toBeVisible();
  await expect(page.getByTestId("not-tracked-row").first()).toContainText("no SEC CIK");
  await page.goto("/status");
  await expect(page.getByTestId("folioprism-status")).toContainText("reachable");
});

test("a manual ticker can be removed and added back; an unknown one is reported", async ({ page }) => {
  await page.goto("/watchlist");
  const acme = page.getByTestId("watchlist-row").filter({ hasText: "ACMR" });
  await acme.getByRole("button", { name: "Remove ACMR" }).click();
  await expect(page.getByTestId("watchlist-msg")).toHaveText("Removed ACMR.");
  await expect(acme).toHaveCount(0);

  await page.getByLabel("Tickers to add").fill("acmr nope");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("watchlist-msg")).toHaveText("Added ACMR. Unknown ticker: NOPE.");
  await expect(acme).toHaveCount(1);
});

test("the other screens load", async ({ page }) => {
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
  await expect(page.getByText("CEO, CFO")).toBeVisible();
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Parse errors (2)" })).toBeVisible();
});
