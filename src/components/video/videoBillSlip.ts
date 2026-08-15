import jsPDF from "jspdf";
import { VIDEO_BRAND_LABEL, type VideoBrand } from "@/lib/videoBrands";

// Editor + bill fields needed for the payout slip. Mirrors payoutActions.tsx
// buildSlipDoc, adapted for a monthly video bill (count × rate).
export type VideoBillSlipEditor = {
  name: string;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  bank_name?: string | null;
  bank_upi?: string | null;
  bank_verified_name?: string | null;
  bank_verification_status?: string | null;
};

export type VideoBillSlipBill = {
  brand: VideoBrand;
  bill_month: string;
  video_count: number;
  per_video_rate: number;
  total_amount: number;
  status: string;
};

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (d: string) => {
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

function buildDoc(editor: VideoBillSlipEditor, bill: VideoBillSlipBill): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const M = 48;
  let y = 56;
  const line = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110);
    doc.text(label, M, y);
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(10); doc.setTextColor(20);
    doc.text(value || "—", M + 150, y);
    y += 20;
  };
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(20);
  doc.text("NIMT Educational Institutions", M, y); y += 18;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(90);
  doc.text("Video Editor Payout Slip", M, y); y += 10;
  doc.setDrawColor(200); doc.line(M, y, 547, y); y += 26;

  line("Editor", editor.name, true);
  line("Bank Account", editor.bank_account_number ? `${editor.bank_account_name || ""}  ${editor.bank_account_number}` : "Not on file");
  line("IFSC / Bank", [editor.bank_ifsc, editor.bank_name].filter(Boolean).join(" / ") || "—");
  if (editor.bank_upi) line("UPI", editor.bank_upi);
  if (editor.bank_verification_status === "verified") line("Verified As", editor.bank_verified_name || "—");
  y += 6; doc.setDrawColor(230); doc.line(M, y - 12, 547, y - 12);
  line("Brand", VIDEO_BRAND_LABEL[bill.brand] || bill.brand, true);
  line("Bill Month", monthLabel(bill.bill_month));
  line("Videos", `${bill.video_count} × ${inr(Number(bill.per_video_rate))}`);
  line("Total Payout", inr(Number(bill.total_amount)), true);
  line("Status", bill.status.toUpperCase());
  y += 34;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110);
  doc.text("Prepared by: __________________", M, y);
  doc.text("Approved by: __________________", 320, y);
  doc.setFontSize(7.5); doc.setTextColor(150);
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, M, 800);
  return doc;
}

// Base64 of the slip PDF (for attaching to a Zoho bill).
export function videoBillSlipBase64(editor: VideoBillSlipEditor, bill: VideoBillSlipBill): string {
  const uri = buildDoc(editor, bill).output("datauristring");
  return uri.slice(uri.indexOf(",") + 1);
}
