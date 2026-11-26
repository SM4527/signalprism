import { expect, test } from "@playwright/test";

test("watchlist lists the sample companies with a source chip", async ({ page }) => {
  await page.goto("/watchlist");
  await expect(page.getByText("SAMPLE DATA")).toBeVisible();
  const rows = page.getByTestId("watchlist-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(1);
  await expect(rows.first().getByText("manual")).toBeVisible();
});

test("the other screens load", async ({ page }) => {
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Rules" })).toBeVisible();
  await expect(page.getByText("CEO, CFO")).toBeVisible();
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Parse errors (2)" })).toBeVisible();
});
