import { expect, test } from "@playwright/test";

const fixture = {
  email: process.env.E2E_FINANCE_EMAIL,
  password: process.env.E2E_FINANCE_PASSWORD,
  reference: process.env.E2E_RECEIPT_REF,
  receiptNo: process.env.E2E_RECEIPT_NO,
  studentSearch: process.env.E2E_STUDENT_SEARCH,
  studentAdmissionNo: process.env.E2E_STUDENT_ADMISSION_NO,
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
  await expect(page.getByText("Identity matches")).toBeVisible();
  await page.getByLabel("Reason for correction").fill("Verified against original bank transaction");
  await page.getByLabel("I verified the receipt reference and the student identity above.").check();
  await page.getByRole("button", { name: "Link existing receipt" }).click();

  await page.goto(`/students/${encodeURIComponent(fixture.studentAdmissionNo!)}`);
  await expect(page.getByText(fixture.receiptNo!, { exact: true })).toBeVisible();
});
