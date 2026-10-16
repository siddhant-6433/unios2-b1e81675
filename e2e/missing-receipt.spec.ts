import { expect, test } from "@playwright/test";

const fixture = {
  email: process.env.E2E_FINANCE_EMAIL,
  password: process.env.E2E_FINANCE_PASSWORD,
  reference: process.env.E2E_RECEIPT_REF,
  receiptNo: process.env.E2E_RECEIPT_NO,
  studentSearch: process.env.E2E_STUDENT_SEARCH,
  studentName: process.env.E2E_STUDENT_NAME,
  studentAdmissionNo: process.env.E2E_STUDENT_ADMISSION_NO,
  applicationName: process.env.E2E_APPLICATION_NAME,
  applicationDob: process.env.E2E_APPLICATION_DOB,
  applicationParentName: process.env.E2E_APPLICATION_PARENT_NAME,
};
const hasFixture = Object.values(fixture).every((value) => !!value);

if (process.env.CI && !hasFixture) {
  throw new Error("Receipt repair E2E requires the local-stack finance credentials and seeded receipt/student fixture variables.");
}

test.skip(!hasFixture, "Set the local-stack finance credentials and seeded receipt/student fixture variables to run this flow.");

test("finance repairs an existing receipt link and the student panel shows that same receipt", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Dev sign in" }).click();
  await page.getByPlaceholder("Email").fill(fixture.email!);
  await page.getByPlaceholder("Password").fill(fixture.password!);
  await page.getByRole("button", { name: "Sign In (Dev)" }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto(`/finance?tab=receipts&receipt_ref=${encodeURIComponent(fixture.reference!)}`);
  const search = page.getByPlaceholder("Search student, admission no, receipt or reference...");
  await expect(search).toHaveValue(fixture.reference!);
  await expect(page.getByText("All time", { exact: true })).toBeVisible();

  const existingReceiptRow = page.getByRole("row").filter({ hasText: fixture.receiptNo! });
  await expect(existingReceiptRow).toBeVisible();
  await existingReceiptRow.getByRole("button", { name: "Review existing receipt" }).click();
  await expect(page.getByRole("heading", { name: "Review existing receipt" })).toBeVisible();
  await page.getByRole("textbox", { name: "Find target student" }).fill(fixture.studentSearch!);
  const targetStudent = page.getByRole("button").filter({ hasText: fixture.studentAdmissionNo! }).first();
  await expect(targetStudent).toBeVisible();
  await targetStudent.click();
  await expect(page.getByRole("heading", { name: "Application identity details match" })).toBeVisible();
  await expect(page.getByText(/The target student is not directly linked to this receipt lead/)).toBeVisible();
  await expect(page.getByText(fixture.studentName!, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(fixture.applicationName!, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(fixture.applicationDob!, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(fixture.applicationParentName!, { exact: true }).first()).toBeVisible();
  await page.getByLabel("Reason for correction").fill("Verified against original bank transaction");
  const identityConfirmation = page.getByLabel("I verified the receipt reference and the student identity details above.");
  const linkReceiptButton = page.getByRole("button", { name: "Link existing receipt" });

  let shouldSimulateStaleConflict = true;
  await page.route("**/rest/v1/rpc/repair_confirmed_lead_payment_student_link", async (route) => {
    if (shouldSimulateStaleConflict) {
      shouldSimulateStaleConflict = false;
      await route.fulfill({
        status: 400,
        json: { code: "40001", message: "serialization conflict", details: null, hint: null },
      });
      return;
    }
    await route.continue();
  });

  await identityConfirmation.check();
  await linkReceiptButton.click();
  await expect(page.getByText("Could not link receipt")).toBeVisible();
  await page.getByRole("button", { name: "Reload receipt" }).click();
  await expect(page.getByRole("heading", { name: "Application identity details match" })).toBeVisible();
  await expect(identityConfirmation).not.toBeChecked();
  await expect(linkReceiptButton).toBeDisabled();

  await identityConfirmation.check();
  await linkReceiptButton.click();

  await page.goto(`/students/${encodeURIComponent(fixture.studentAdmissionNo!)}`);
  await expect(page.getByText(fixture.receiptNo!, { exact: true })).toBeVisible();
});
