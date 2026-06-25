import { readFileSync } from "node:fs";
import { combineIndiaDateTimeInput, splitToIndiaDateTimeInput } from "@/lib/indiaDateTime";

const offlinePaymentDialog = readFileSync("src/components/finance/OfflinePaymentDialog.tsx", "utf8");
const paymentEditDialog = readFileSync("src/components/finance/PaymentEditDialog.tsx", "utf8");
const paymentReceiptFunction = readFileSync("supabase/functions/generate-payment-receipt/index.ts", "utf8");
const applicationReceiptFunction = readFileSync("supabase/functions/generate-application-fee-receipt/index.ts", "utf8");

describe("offline receipt timestamps", () => {
  it("stores an explicit IST transaction time instead of forcing midnight", () => {
    expect(combineIndiaDateTimeInput("2026-04-03", "14:37")).toBe("2026-04-03T14:37:00+05:30");

    expect(offlinePaymentDialog).toContain("Transaction Time");
    expect(offlinePaymentDialog).toContain("combineIndiaDateTimeInput(date, time)");
    expect(paymentEditDialog).toContain("Payment Time");
    expect(paymentEditDialog).toContain("combineIndiaDateTimeInput(date, time)");
    expect(`${offlinePaymentDialog}\n${paymentEditDialog}`).not.toContain("`${date}T00:00:00+05:30`");
  });

  it("round-trips persisted timestamps into IST date and time inputs", () => {
    expect(splitToIndiaDateTimeInput("2026-04-03T09:07:00+05:30")).toEqual({
      date: "2026-04-03",
      time: "09:07",
    });
  });

  it("renders receipt header dates in IST in both PDF generators", () => {
    for (const source of [paymentReceiptFunction, applicationReceiptFunction]) {
      expect(source).toContain('timeZone: "Asia/Kolkata"');
      expect(source).toContain("toLocaleDateString");
    }
  });
});
