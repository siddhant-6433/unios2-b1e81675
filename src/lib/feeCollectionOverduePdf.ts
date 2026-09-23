import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";
import type { FeeStructureMetadata } from "@/lib/feeTermLabels";
import { feeTermLabel } from "@/lib/feeTermLabels";
import type { PdfBrand } from "@/lib/pdfExport";
import { displayVal, groupByProgrammeBatch, type CollectionVsDueLine } from "@/lib/feeCollectionVsDue";

export type OverduePdfOptions = {
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

const monthKey = (date: string | null | undefined) => date ? date.slice(0, 7) : "0000-00";

const monthLabel = (keyOrDate: string | null | undefined) => {
  if (!keyOrDate || keyOrDate === "0000-00") return "No due date";
  const key = keyOrDate.length === 7 ? keyOrDate : keyOrDate.slice(0, 7);
  const [year, month] = key.split("-");
  const monthIndex = Math.max(0, Math.min(11, Number(month || "1") - 1));
  return new Date(Number(year), monthIndex, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

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

export async function exportOverdueFeesPdf(lines: CollectionVsDueLine[], opts: OverduePdfOptions) {
  const overdueLines = lines.filter((line) => Number(line.balance || 0) > 0);
  if (overdueLines.length === 0) return { count: 0 };

  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  const usableW = pageW - margin * 2;
  const title = opts.title || "Fee Collection - Overdue";
  const rowH = 7;
  const headerH = 9;
  const sectionH = 7;
  const monthBandH = 10;
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  let logo: { dataUrl: string; aspect: number } | null = null;
  try {
    logo = await imageAssetToPng(opts.brand?.logoSrc || nimtLogo);
  } catch {
    logo = null;
  }

  const cols = [
    { label: "S. No.", width: 10, align: "left" as const },
    { label: "Student", width: 38, align: "left" as const },
    { label: "Adm. No", width: 22, align: "left" as const },
    { label: "Class/Course", width: 29, align: "left" as const },
    { label: "Batch", width: 22, align: "left" as const },
    { label: "Fee Head", width: 44, align: "left" as const },
    { label: "Due Date", width: 22, align: "left" as const },
    { label: "Due", width: 25, align: "right" as const },
    { label: "Collected", width: 25, align: "right" as const },
    { label: "Overdue", width: 30, align: "right" as const },
  ];
  const tableW = cols.reduce((sum, col) => sum + col.width, 0);

  const text = (value: string, x: number, y: number, width: number, align: "left" | "right" = "left", maxLines = 1) => {
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

  const drawMonthBand = (y: number, label: string, due: number, collected: number, balance: number) => {
    doc.setDrawColor(248, 113, 113);
    doc.setFillColor(254, 242, 242);
    doc.rect(margin, y, tableW, monthBandH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(127, 29, 29);
    doc.text(label.toUpperCase(), margin + 3, y + 6.4);
    doc.setFontSize(7.2);
    doc.text(`Due ${inr(due)} | Collected ${inr(collected)} | Overdue ${inr(balance)}`, margin + tableW - 2, y + 6.2, { align: "right" });
    return y + monthBandH + 2;
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

  const drawSection = (y: number, heading: string, total: number) => {
    doc.setFillColor(255, 247, 237);
    doc.rect(margin, y, tableW, sectionH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.3);
    doc.setTextColor(124, 45, 18);
    doc.text(heading, margin + 2, y + 4.8);
    doc.text(`Section overdue ${inr(total)}`, margin + tableW - 2, y + 4.8, { align: "right" });
    return y + sectionH;
  };

  const byMonth = new Map<string, CollectionVsDueLine[]>();
  overdueLines.forEach((line) => {
    const key = monthKey(line.due_date);
    byMonth.set(key, [...(byMonth.get(key) || []), line]);
  });

  let totalRows = 0;
  let y = drawBrand(`${overdueLines.length} overdue rows`);
  [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([key, monthLines], monthIndex) => {
    if (monthIndex > 0) {
      doc.addPage();
      y = drawBrand("continued");
    }
    const monthDue = monthLines.reduce((sum, line) => sum + Number(line.due_amount || 0), 0);
    const monthCollected = monthLines.reduce((sum, line) => sum + Number(line.collected_amount || 0), 0);
    const monthBalance = monthLines.reduce((sum, line) => sum + Number(line.balance || 0), 0);
    y = drawMonthBand(y, monthLabel(key), monthDue, monthCollected, monthBalance);
    y = drawHeader(y);
    const sections = groupByProgrammeBatch(monthLines);
    sections.forEach((section) => {
      const rows = [...section.lines].sort((a, b) =>
        displayVal(a.name).localeCompare(displayVal(b.name))
        || displayVal(a.fee_name).localeCompare(displayVal(b.fee_name)),
      );
      const sectionTotal = rows.reduce((sum, line) => sum + Number(line.balance || 0), 0);
      if (y + sectionH + rowH > pageH - margin) {
        doc.addPage();
        y = drawBrand("continued");
        y = drawMonthBand(y, monthLabel(key), monthDue, monthCollected, monthBalance);
        y = drawHeader(y);
      }
      const heading = [section.course_name, section.batch_name, section.campus_name]
        .filter((value) => value && value !== "—")
        .join(" - ");
      y = drawSection(y, heading || "Programme / Batch", sectionTotal);
      rows.forEach((line, index) => {
        if (y + rowH > pageH - margin) {
          doc.addPage();
          y = drawBrand("continued");
          y = drawMonthBand(y, monthLabel(key), monthDue, monthCollected, monthBalance);
          y = drawHeader(y);
          y = drawSection(y, heading || "Programme / Batch", sectionTotal);
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
          line.course_name || "",
          line.batch_name || "",
          compactFeeHead(line.fee_name, line.fee_code),
          line.due_date || "",
          inr(line.due_amount),
          inr(line.collected_amount),
          inr(line.balance),
        ];
        let x = margin;
        cols.forEach((col, colIndex) => {
          if (colIndex === 9) doc.setTextColor(185, 28, 28);
          text(values[colIndex], x, y + 4.8, col.width, col.align, 1);
          doc.setTextColor(20);
          x += col.width;
        });
        y += rowH;
        totalRows += 1;
      });
    });
  });

  const drawSummary = () => {
    doc.addPage();
    let sy = drawBrand("month wise overdue summary");
    doc.setDrawColor(248, 113, 113);
    doc.setFillColor(254, 242, 242);
    doc.rect(margin, sy, usableW, 10, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(127, 29, 29);
    doc.text("MONTH WISE OVERDUE SUMMARY", margin + 3, sy + 6.6);
    sy += 14;
    const summaryCols = [
      { label: "Month", width: 70, align: "left" as const },
      { label: "Due", width: 45, align: "right" as const },
      { label: "Collected", width: 45, align: "right" as const },
      { label: "Overdue", width: 45, align: "right" as const },
      { label: "Rows", width: 25, align: "right" as const },
    ];
    const summaryW = summaryCols.reduce((sum, col) => sum + col.width, 0);
    const drawSummaryHeader = () => {
      let x = margin;
      doc.setDrawColor(205);
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, sy, summaryW, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(45);
      summaryCols.forEach((col) => {
        doc.rect(x, sy, col.width, rowH);
        text(col.label, x, sy + 4.9, col.width, col.align);
        x += col.width;
      });
      sy += rowH;
    };
    drawSummaryHeader();
    let grandDue = 0;
    let grandCollected = 0;
    let grandBalance = 0;
    let grandRows = 0;
    [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([key, monthLines]) => {
      const due = monthLines.reduce((sum, line) => sum + Number(line.due_amount || 0), 0);
      const collected = monthLines.reduce((sum, line) => sum + Number(line.collected_amount || 0), 0);
      const balance = monthLines.reduce((sum, line) => sum + Number(line.balance || 0), 0);
      grandDue += due;
      grandCollected += collected;
      grandBalance += balance;
      grandRows += monthLines.length;
      let x = margin;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(25);
      const values = [monthLabel(key), inr(due), inr(collected), inr(balance), String(monthLines.length)];
      summaryCols.forEach((col, index) => {
        doc.rect(x, sy, col.width, rowH);
        if (index === 3) doc.setTextColor(185, 28, 28);
        text(values[index], x, sy + 4.9, col.width, col.align);
        doc.setTextColor(25);
        x += col.width;
      });
      sy += rowH;
    });
    let x = margin;
    doc.setFillColor(254, 226, 226);
    doc.rect(margin, sy, summaryW, rowH, "F");
    doc.setFont("helvetica", "bold");
    const values = ["GRAND TOTAL", inr(grandDue), inr(grandCollected), inr(grandBalance), String(grandRows)];
    summaryCols.forEach((col, index) => {
      doc.rect(x, sy, col.width, rowH);
      if (index === 3) doc.setTextColor(185, 28, 28);
      else doc.setTextColor(25);
      text(values[index], x, sy + 4.9, col.width, col.align);
      x += col.width;
    });
  };
  drawSummary();
  doc.save(`${opts.filePrefix}-${new Date().toISOString().slice(0, 10)}.pdf`);
  return { count: totalRows };
}
