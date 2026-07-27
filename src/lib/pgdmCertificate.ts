import jsPDF from "jspdf";
import templateUrl from "@/assets/pgdm/pgdm-certificate-template.png";

export type PgdmCertificateDetails = {
  studentName: string;
  completedYear: string;
  fileNo: string;
  enrollmentNo: string;
  cgpa: string;
  equivalentPercentage: string;
  issueDay: string;
  issueMonthYear: string;
};

export const PGDM_CERTIFICATE_TEMPLATE_URL = templateUrl;
export const PGDM_CERTIFICATE_NAME_FONT_FAMILY = '"La Luxes Script", "Times New Roman", Georgia, serif';

export const emptyPgdmCertificateDetails = (): PgdmCertificateDetails => ({
  studentName: "",
  completedYear: "",
  fileNo: "",
  enrollmentNo: "",
  cgpa: "",
  equivalentPercentage: "",
  issueDay: "",
  issueMonthYear: "",
});

export const normalizePgdmCertificateDetails = (value: any): PgdmCertificateDetails => ({
  studentName: String(value?.studentName || value?.student_name || ""),
  completedYear: String(value?.completedYear || value?.completed_year || ""),
  fileNo: String(value?.fileNo || value?.file_no || ""),
  enrollmentNo: String(value?.enrollmentNo || value?.enrollment_no || ""),
  cgpa: String(value?.cgpa || ""),
  equivalentPercentage: String(value?.equivalentPercentage || value?.equivalent_percentage || ""),
  issueDay: String(value?.issueDay || value?.issue_day || ""),
  issueMonthYear: String(value?.issueMonthYear || value?.issue_month_year || ""),
});

const assetToDataUrl = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Unable to load certificate asset: ${url}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

const drawText = (
  doc: jsPDF,
  text: string,
  x: number,
  baselineY: number,
  maxWidth: number,
  fontSize: number,
  align: "left" | "center" = "left",
  fontName = "helvetica",
  style: "normal" | "bold" | "italic" | "bolditalic" = "bold",
) => {
  if (!text) return;
  doc.setFont(fontName, style);
  let size = fontSize;
  doc.setFontSize(size);
  // ponytail: shrink-to-fit — the enrollment/day blanks are narrow by template
  // design, so long values scale down instead of colliding with adjacent labels.
  while (size > 6 && doc.getTextWidth(text) > maxWidth) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  doc.text(text, x, baselineY, { align, baseline: "alphabetic" });
};

export async function generatePgdmCertificatePdf(details: PgdmCertificateDetails): Promise<Blob> {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const templateDataUrl = await assetToDataUrl(templateUrl);

  doc.addImage(templateDataUrl, "PNG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
  doc.setTextColor("#333333");

  // Coordinates calibrated against the 1324x1872 template (pt = px * 595.28/1324),
  // left-aligned on each printed label's baseline. La Luxes isn't fully embeddable
  // (see PGDM_CERTIFICATE_NAME_FONT_FAMILY), so the name uses Times italic.
  drawText(doc, details.studentName, 356, 284, 270, 30, "center", "times", "italic");
  // Values use bold-italic serif to match the certificate's printed italic-serif
  // labels while staying visually distinct as filled-in data.
  const V = ["left", "times", "bolditalic"] as const;
  drawText(doc, details.completedYear, 418, 504.6, 90, 11, ...V);
  drawText(doc, details.fileNo, 342, 519.0, 155, 11, ...V);
  drawText(doc, details.enrollmentNo, 353, 536.1, 95, 11, ...V);
  drawText(doc, details.cgpa, 444, 536.1, 42, 11, ...V);
  drawText(doc, details.equivalentPercentage, 418, 550.9, 70, 11, ...V);
  drawText(doc, details.issueDay, 315, 585.0, 40, 11, ...V);
  drawText(doc, details.issueMonthYear, 384, 585.0, 112, 11, ...V);

  return doc.output("blob");
}

export const pgdmCertificateFileName = (requestNumber?: string, studentName?: string) => {
  const safeRequest = (requestNumber || "PGDM-Certificate").replace(/[^a-z0-9-]+/gi, "-");
  const safeName = (studentName || "Student").replace(/[^a-z0-9-]+/gi, "-");
  return `${safeRequest}-${safeName}.pdf`;
};
