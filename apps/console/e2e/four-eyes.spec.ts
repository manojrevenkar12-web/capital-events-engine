import { expect, type Page, test } from "@playwright/test";

/** One capital call through its whole life, by the two people the four-eyes rule needs. */
const SHOTS = process.env.SCREENSHOTS ? "../../docs/screenshots" : null;
const shot = async (page: Page, name: string, fullPage = false) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};
const signInAs = async (page: Page, who: "Alice Brandt" | "Bob Okafor" | "Vera Lindqvist") => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: `Sign in as ${who}` }).click();
  await expect(page.locator(".drawdown")).toBeVisible();
};
const signOut = async (page: Page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/sign-in/);
};

test.describe.configure({ mode: "serial" });
const reference = `CALL-E2E-${Date.now().toString(36).toUpperCase()}`;
let eventUrl = "";

test("a preparer drafts a call and sees it calculated, but cannot approve it", async ({ page }) => {
  await page.goto("/sign-in");
  await shot(page, "01-sign-in");
  await signInAs(page, "Alice Brandt");
  await shot(page, "02-overview");
  await page.getByRole("link", { name: "New capital call" }).first().click();
  await page.getByLabel("Reference").fill(reference);
  await page.getByLabel("Deal").fill("Havel Robotics");
  await page.getByLabel("Amount in euros").fill("4,000,000");
  await page.getByLabel(/^Sectors/).fill("software");
  await shot(page, "03-new-call");
  await page.getByRole("button", { name: "Create and calculate" }).click();
  await expect(page.getByRole("heading", { name: `Capital call ${reference}` })).toBeVisible();
  await expect(page.locator(".pill", { hasText: "calculated" }).first()).toBeVisible();
  await expect(page.getByRole("table").getByText("€4,000,000.00").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve result/ })).toHaveCount(0);
  eventUrl = page.url();
  await shot(page, "04-calculated", true);
  await signOut(page);
});

test("a second person approves the result shown, and issuing assigns payment references", async ({ page }) => {
  await signInAs(page, "Bob Okafor");
  await page.goto(eventUrl);
  const approve = page.getByRole("button", { name: /Approve result/ });
  const hash = (await approve.textContent())?.replace("Approve result ", "") ?? "";
  await approve.click();
  await expect(page.locator(".stamp", { hasText: "Approved" })).toBeVisible();
  await expect(page.getByRole("heading", { name: `Result ${hash}` })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "05-approved");
  await page.getByRole("button", { name: "Issue notices" }).click();
  await expect(page.locator(".pill", { hasText: "issued" }).first()).toBeVisible();
  await expect(
    page
      .getByRole("table")
      .getByText(new RegExp(`${reference}-\\d{4}`))
      .first(),
  ).toBeVisible();
});

test("side-letter terms are reviewed against the sentence they came from", async ({ page }) => {
  await signInAs(page, "Bob Okafor");
  await page.getByRole("navigation").getByRole("link", { name: "Side letters" }).click();
  await page
    .getByRole("row", { name: /in review/ })
    .first()
    .getByRole("link")
    .click();
  await expect(page.locator(".letter mark").first()).toBeVisible();
  await shot(page, "06-side-letter");
  const before = await page.getByRole("button", { name: "Approve term" }).count();
  test.skip(before === 0, "no term left to review in this database");
  await page.getByRole("button", { name: "Approve term" }).first().click();
  await expect(page.getByRole("button", { name: "Approve term" })).toHaveCount(before - 1);
});

test("the audit chain verifies and the ledger balances", async ({ page }) => {
  await signInAs(page, "Vera Lindqvist");
  await page.getByRole("navigation").getByRole("link", { name: "Capital accounts" }).click();
  await expect(page.getByText(/Ledger balances: \d+ accounts, trial balance zero/)).toBeVisible();
  await shot(page, "07-capital-accounts");
  await page.getByRole("navigation").getByRole("link", { name: "Bank" }).click();
  await expect(page.getByRole("group", { name: "Show" })).toBeVisible();
  await shot(page, "08-bank");
  await page.getByRole("navigation").getByRole("link", { name: "Audit trail" }).click();
  await expect(page.getByText(/Chain intact: \d+ records verified/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "alice" }).first()).toBeVisible();
  await shot(page, "09-audit");
  await expect(page.getByRole("button", { name: /Approve|Calculate|Issue/ })).toHaveCount(0);
});
