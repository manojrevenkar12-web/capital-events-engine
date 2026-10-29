import { expect, test } from "@playwright/test";

test("every screen runs under the production content security policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto("/sign-in");
  expect(res?.headers()["content-security-policy"]).toContain("default-src 'self'");
  await page.getByRole("button", { name: "Sign in as Alice Brandt" }).click();
  await expect(page.locator(".drawdown")).toBeVisible();
  for (const name of ["Capital events", "Side letters", "Capital accounts", "Bank", "Audit trail"]) {
    await page.getByRole("navigation").getByRole("link", { name }).click();
    await expect(page.locator(".panel").first()).toBeVisible();
  }
  await page.getByRole("navigation").getByRole("link", { name: "Capital events" }).click();
  await page.getByRole("link", { name: /CALL-2026-03/ }).click();
  await expect(page.locator(".seal")).toBeVisible();
  expect(violations).toEqual([]);
});
