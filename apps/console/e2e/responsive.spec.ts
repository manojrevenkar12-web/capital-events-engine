import { expect, test } from "@playwright/test";

test("the overview fits a phone without sideways scrolling", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in as Vera Lindqvist" }).click();
  await expect(page.locator(".drawdown")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (process.env.SCREENSHOTS) await page.screenshot({ path: "../../docs/screenshots/10-phone.png", fullPage: true });
});
