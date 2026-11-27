import { expect, test } from "@playwright/test";

test("rules page edits a rule, rejects bad input and keeps the saved value", async ({ page }) => {
  await page.goto("/rules");
  const form = page.getByTestId("rule-form").first();
  await expect(form.getByLabel("Minimum value", { exact: true })).toHaveValue("100000");
  await expect(form.getByLabel("CEO")).toBeChecked();
  await expect(form.getByLabel("COO")).not.toBeChecked();

  await form.getByLabel("Minimum value", { exact: true }).fill("lots");
  await form.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByTestId("rules-msg")).toHaveText("Not saved: minValue: must be a number, 0 or more");
  await expect(page.getByTestId("rule-form").first().getByLabel("Minimum value", { exact: true })).toHaveValue("100000");

  await page.getByTestId("rule-form").first().getByLabel("Minimum value", { exact: true }).fill("150000");
  await page.getByTestId("rule-form").first().getByLabel("COO").check();
  await page.getByTestId("rule-form").first().getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByTestId("rules-msg")).toContainText("Rule saved");
  const saved = page.getByTestId("rule-form").first();
  await expect(saved.getByLabel("Minimum value", { exact: true })).toHaveValue("150000");
  await expect(saved.getByLabel("COO")).toBeChecked();

  // Put the sample rule back.
  await saved.getByLabel("Minimum value", { exact: true }).fill("100000");
  await saved.getByLabel("COO").uncheck();
  await saved.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByTestId("rule-form").first().getByLabel("Minimum value", { exact: true })).toHaveValue("100000");
});

test("notification settings save, and a bad value is refused", async ({ page }) => {
  await page.goto("/rules");
  const form = page.getByTestId("notification-form");
  await form.getByLabel("Daily cap").fill("0");
  await form.getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByTestId("rules-msg")).toHaveText("Not saved: dailyCap: must be at least 1");

  await page.getByTestId("notification-form").getByLabel("Quiet hours start").fill("22:00");
  await page.getByTestId("notification-form").getByLabel("Quiet hours end").fill("07:00");
  await page.getByTestId("notification-form").getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByTestId("rules-msg")).toHaveText("Notification settings saved.");
  await expect(page.getByTestId("notification-form").getByLabel("Quiet hours start")).toHaveValue("22:00");

  // Clear the quiet hours again.
  await page.getByTestId("notification-form").getByLabel("Quiet hours start").fill("");
  await page.getByTestId("notification-form").getByLabel("Quiet hours end").fill("");
  await page.getByTestId("notification-form").getByRole("button", { name: "Save notification settings" }).click();
  await expect(page.getByTestId("notification-form").getByLabel("Quiet hours start")).toHaveValue("");
});

test("send test push on the sample stack only records the would-be message, and Status lists it", async ({ page }) => {
  await page.goto("/rules");
  await page.getByRole("button", { name: "Send test push" }).click();
  await expect(page.getByTestId("rules-msg")).toContainText("Test push logged only");

  await page.goto("/status");
  await expect(page.getByTestId("pushover-status")).toContainText("not used on the sample stack");
  await expect(page.getByTestId("notifications").getByText("SignalPrism test push").first()).toBeVisible();
  await expect(page.getByTestId("notification-counts")).toContainText("logged");
});
