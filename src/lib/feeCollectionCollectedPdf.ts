import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";
import type { FeeStructureMetadata } from "@/lib/feeTermLabels";
import { feeTermLabel } from "@/lib/feeTermLabels";
import type { PdfBrand } from "@/lib/pdfExport";
import {
  displayVal,
  groupByProgrammeBatch,
  type CollectionVsDueLine,
  type ProgrammeBatchSection,
} from "@/lib/feeCollectionVsDue";

export type CollectedPdfOptions = {
  brand?: PdfBrand;
  filePrefix: string;
  title?: string;
  subtitle?: string;
  metaByCourse: Record<string, FeeStructureMetadata>;
};

const inr = (n: number) => Number(n || 0).toLocaleString("en-IN");

const compactFeeHead = (name: string | null | undefined, code: string | null | undefined) => {
  const raw = String(name || code || "");
  return raw
    .replace(/^NIMT\s+School\s+Arthala\s+/i, "")
    .replace(/^NIMT\s+/i, "")
    .replace(/\s*\(Rs\s*[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim() || "Fee";
};

const modeLabel = (mode: string | null | undefined) => {
  const value = String(mode || "unknown");
  const labels: Record<string, string> = {
    cash: "Cash",
    upi: "UPI",
    bank_transfer: "Bank Transfer",
    cheque: "Cheque",
    online: "Online",
    gateway: "Gateway",
    consultant_credit_note: "Consultant Credit Note",
  };
  return labels[value] || value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

const monthLabel = (date: string | null | undefined) => {
  if (!date) return "No payment date";
  const [year, month] = date.split("-");
  const monthIndex = Math.max(0, Math.min(11, Number(month || "1") - 1));
  return new Date(Number(year), monthIndex, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

const monthKey = (date: string | null | undefined) => date ? date.slice(0, 7) : "0000-00";

async function imageAssetToPng(src: string): Promise<{ dataUrl: string; aspect: number }> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Logo fetch failed: ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.includes("svg")) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    const img = await loadImage(dataUrl);
    return { dataUrl, aspect: (img.naturalWidth || 1) / (img.naturalHeight || 1) };
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    const w = img.naturalWidth || 360;
    const h = img.naturalHeight || 120;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL("image/png"), aspect: w / h };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function exportCollectedReceiptsPdf(
  lines: CollectionVsDueLine[],
  opts: CollectedPdfOptions,
) {
  if (lines.length === 0) return { count: 0 };

  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  const usableW = pageW - margin * 2;
  const title = opts.title || "Fee Collection - Collected";
  const rowH = 7;
  const headerH = 9;
  const sectionH = 7;
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  let logo: { dataUrl: string; aspect: number } | null = null;
  try {
    logo = await imageAssetToPng(opts.brand?.logoSrc || nimtLogo);
  } catch {
    logo = null;
  }

  const cols = [
    { label: "S. No.", width: 10, align: "left" as const },
    { label: "Student", width: 36, align: "left" as const },
    { label: "Adm. No", width: 24, align: "left" as const },
    { label: "Receipt No", width: 34, align: "left" as const },
    { label: "Date", width: 24, align: "left" as const },
    { label: "Fee Head", width: 34, align: "left" as const },
    { label: "Term", width: 24, align: "left" as const },
    { label: "Mode", width: 30, align: "left" as const },
    { label: "Txn Ref", width: 24, align: "left" as const },
    { label: "Collected", width: 27, align: "right" as const },
  ];
  const tableW = cols.reduce((sum, col) => sum + col.width, 0);

  const text = (
    value: string,
    x: number,
    y: number,
    width: number,
    align: "left" | "right" = "left",
    maxLines = 1,
  ) => {
    const linesToDraw = doc.splitTextToSize(value, Math.max(4, width - 2)).slice(0, maxLines);
    doc.text(linesToDraw, align === "right" ? x + width - 1 : x + 1, y, { align });
  };

  const drawBrand = (subtitleExtra?: string) => {
    let y = margin;
    let textX = margin;
    if (logo) {
      const logoH = 11;
      const logoW = Math.min(logo.aspect * logoH, 42);
      doc.addImage(logo.dataUrl, "PNG", margin, y, logoW, logoH, undefined, "FAST");
      textX = margin + logoW + 4;
    }
    doc.setTextColor(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(opts.brand?.org || "NIMT Educational Institutions", textX, y + 4.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    if (opts.brand?.contactLine) doc.text(opts.brand.contactLine, textX, y + 9.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20);
    doc.text(title, pageW - margin, y + 4.5, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    const subtitle = [opts.subtitle, subtitleExtra, today].filter(Boolean).join(" - ");
    doc.text(doc.splitTextToSize(subtitle, usableW / 2).slice(0, 1), pageW - margin, y + 9.5, { align: "right" });
    y += 16;
    doc.setDrawColor(210);
    doc.line(margin, y, pageW - margin, y);
    return y + 3;
  };

  const drawHeader = (y: number) => {
    let x = margin;
    doc.setDrawColor(205);
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, tableW, headerH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(45);
    cols.forEach((col) => {
      doc.rect(x, y, col.width, headerH);
      text(col.label, x, y + 5.7, col.width, col.align);
      x += col.width;
    });
    return y + headerH;
  };

  const drawSection = (y: number, section: ProgrammeBatchSection, total: number) => {
    doc.setFillColor(244, 247, 251);
    doc.rect(margin, y, tableW, sectionH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(30);
    const heading = [section.course_name, section.batch_name, section.campus_name]
      .filter((value) => value && value !== "—")
      .join(" - ");
    doc.text(heading || "Programme / Batch", margin + 2, y + 4.8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(105);
    doc.text(`Section collected ${inr(total)}`, margin + tableW - 2, y + 4.8, { align: "right" });
    return y + sectionH;
  };

  const sortedSections = groupByProgrammeBatch(lines);
  let totalRows = 0;
  let y = drawBrand(`${lines.length} receipt allocation rows`);
  y = drawHeader(y);

  sortedSections.forEach((section) => {
    const sectionLines = [...section.lines].sort((a, b) =>
      (a.payment_date || a.collected_date || "").localeCompare(b.payment_date || b.collected_date || "")
      || displayVal(a.name).localeCompare(displayVal(b.name))
      || displayVal(a.receipt_no).localeCompare(displayVal(b.receipt_no)),
    );
    const sectionTotal = sectionLines.reduce((sum, line) => sum + Number(line.collected_amount || 0), 0);
    if (y + sectionH + rowH > pageH - margin) {
      doc.addPage();
      y = drawBrand("continued");
      y = drawHeader(y);
    }
    y = drawSection(y, section, sectionTotal);
    sectionLines.forEach((line, index) => {
      if (y + rowH > pageH - margin) {
        doc.addPage();
        y = drawBrand("continued");
        y = drawHeader(y);
        y = drawSection(y, section, sectionTotal);
      }
      if (index % 2 === 1) {
        doc.setFillColor(249, 250, 251);
        doc.rect(margin, y, tableW, rowH, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.7);
      doc.setTextColor(20);
      const values = [
        String(index + 1),
        line.name || "",
        line.admission_no || "",
        line.receipt_no || "",
        line.payment_date || line.collected_date || "",
        compactFeeHead(line.fee_name, line.fee_code),
        feeTermLabel(line.term || "", opts.metaByCourse[line.course_id || ""]),
        modeLabel(line.payment_mode),
        line.transaction_ref || "",
        inr(line.collected_amount),
      ];
      let x = margin;
      cols.forEach((col, colIndex) => {
        text(values[colIndex], x, y + 4.8, col.width, col.align, 1);
        x += col.width;
      });
      y += rowH;
      totalRows += 1;
    });
  });

  const drawSummary = () => {
    doc.addPage();
    let sy = drawBrand("month wise mode summary");
    doc.setDrawColor(171, 190, 220);
    doc.setFillColor(229, 239, 255);
    doc.rect(margin, sy, usableW, 10, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(22, 43, 77);
    doc.text("MONTH WISE COLLECTION SUMMARY", margin + 3, sy + 6.6);
    sy += 14;

    const modes = [...new Set(lines.map((line) => modeLabel(line.payment_mode)))].sort();
    const summaryCols = [
      { label: "Month", width: 54, align: "left" as const },
      ...modes.map((mode) => ({ label: mode, width: Math.max(26, Math.min(40, 170 / Math.max(1, modes.length))), align: "right" as const })),
      { label: "Total Collected", width: 38, align: "right" as const },
    ];
    const summaryW = summaryCols.reduce((sum, col) => sum + col.width, 0);
    const drawSummaryHeader = () => {
      let x = margin;
      doc.setDrawColor(205);
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, sy, summaryW, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.setTextColor(45);
      summaryCols.forEach((col) => {
        doc.rect(x, sy, col.width, rowH);
        text(col.label, x, sy + 4.9, col.width, col.align, 1);
        x += col.width;
      });
      sy += rowH;
    };
    const ensureSummarySpace = () => {
      if (sy + rowH <= pageH - margin) return;
      doc.addPage();
      sy = margin;
      drawSummaryHeader();
    };
    drawSummaryHeader();
    const byMonth = new Map<string, CollectionVsDueLine[]>();
    lines.forEach((line) => {
      const key = monthKey(line.payment_date || line.collected_date);
      byMonth.set(key, [...(byMonth.get(key) || []), line]);
    });
    let grandTotal = 0;
    const grandByMode = new Map<string, number>();
    [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([key, monthLines]) => {
      ensureSummarySpace();
      let x = margin;
      const monthTotal = monthLines.reduce((sum, line) => sum + Number(line.collected_amount || 0), 0);
      grandTotal += monthTotal;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(25);
      const values = [monthLabel(key === "0000-00" ? null : `${key}-01`)];
      modes.forEach((mode) => {
        const modeTotal = monthLines
          .filter((line) => modeLabel(line.payment_mode) === mode)
          .reduce((sum, line) => sum + Number(line.collected_amount || 0), 0);
        grandByMode.set(mode, (grandByMode.get(mode) || 0) + modeTotal);
        values.push(inr(modeTotal));
      });
      values.push(inr(monthTotal));
      summaryCols.forEach((col, index) => {
        doc.rect(x, sy, col.width, rowH);
        text(values[index], x, sy + 4.9, col.width, col.align, 1);
        x += col.width;
      });
      sy += rowH;
    });
    ensureSummarySpace();
    let x = margin;
    doc.setFillColor(221, 230, 242);
    doc.rect(margin, sy, summaryW, rowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    const grandValues = ["GRAND TOTAL", ...modes.map((mode) => inr(grandByMode.get(mode) || 0)), inr(grandTotal)];
    summaryCols.forEach((col, index) => {
      doc.rect(x, sy, col.width, rowH);
      text(grandValues[index], x, sy + 4.9, col.width, col.align, 1);
      x += col.width;
    });
  };

  drawSummary();

  doc.save(`${opts.filePrefix}-${new Date().toISOString().slice(0, 10)}.pdf`);
  return { count: totalRows };
}
