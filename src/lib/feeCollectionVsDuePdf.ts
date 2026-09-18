import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";
import type { FeeStructureMetadata } from "@/lib/feeTermLabels";
import type { PdfBrand } from "@/lib/pdfExport";
import {
  filterLinesForPdfSelection,
  groupByProgrammeBatch,
  pivotStudents,
  type CollectionVsDueLine,
  type PdfFeeHeadOption,
  type ProgrammeBatchSection,
  type PdfPart,
  type SummaryStudentRow,
} from "@/lib/feeCollectionVsDue";

export type CollectionVsDuePdfOptions = {
  brand?: PdfBrand;
  filePrefix: string;
  title?: string;
  subtitle?: string;
  metaByCourse: Record<string, FeeStructureMetadata>;
};

const inr = (n: number) => Number(n || 0).toLocaleString("en-IN");

type BalanceStatus = "paid" | "overdue" | "upcoming" | "neutral";

type AmountTotals = {
  due: number;
  collected: number;
  balance: number;
  overdueBalance: number;
  upcomingBalance: number;
};

type StudentTotals = AmountTotals & {
  headTotals: AmountTotals[];
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

export async function exportCollectionVsDuePdf(
  lines: CollectionVsDueLine[],
  parts: PdfPart[],
  opts: CollectionVsDuePdfOptions,
) {
  if (lines.length === 0 || parts.length === 0) return { count: 0, parts: 0 };

  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  const title = opts.title || "Fee Collection vs Due";
  const brand = opts.brand;
  const fixedCols = [
    { key: "serial", label: "S. No.", width: 9, align: "left" as const },
    { key: "student", label: "Student", width: 39, align: "left" as const },
    { key: "admission", label: "Adm. No", width: 20, align: "left" as const },
    { key: "course", label: "Class/Course", width: 27, align: "left" as const },
    { key: "batch", label: "Batch", width: 17, align: "left" as const },
  ];
  const totalCols = [
    { key: "partDue", label: "Part Due", width: 16 },
    { key: "partCollected", label: "Part Collected", width: 18 },
    { key: "partBalance", label: "Part Balance", width: 17 },
  ];
  const fixedW = fixedCols.reduce((a, c) => a + c.width, 0);
  const totalW = totalCols.reduce((a, c) => a + c.width, 0);
  const usableW = pageW - margin * 2;
  const rowH = 7;
  const headerH = 22;
  const monthBandH = 10;
  const sectionH = 7;
  const totalRowH = 7;
  const monthFills: Array<[number, number, number]> = [
    [229, 239, 255],
    [231, 247, 237],
    [255, 242, 218],
    [242, 235, 255],
    [225, 245, 250],
    [255, 232, 230],
  ];
  const balanceColors: Record<BalanceStatus, [number, number, number]> = {
    paid: [22, 101, 52],
    overdue: [185, 28, 28],
    upcoming: [146, 64, 14],
    neutral: [25, 25, 25],
  };
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  let logo: { dataUrl: string; aspect: number } | null = null;
  try {
    logo = await imageAssetToPng(brand?.logoSrc || nimtLogo);
  } catch {
    logo = null;
  }

  const text = (
    value: string,
    x: number,
    y: number,
    width: number,
    align: "left" | "right" = "left",
    maxLines = 2,
  ) => {
    const linesToDraw = doc.splitTextToSize(value, Math.max(4, width - 2)).slice(0, maxLines);
    doc.text(linesToDraw, align === "right" ? x + width - 1 : x + 1, y, { align });
  };

  const rectText = (
    value: string,
    x: number,
    y: number,
    width: number,
    height: number,
    align: "left" | "center" | "right" = "left",
    maxLines = 2,
  ) => {
    doc.rect(x, y, width, height);
    const linesToDraw = doc.splitTextToSize(value, Math.max(4, width - 2)).slice(0, maxLines);
    doc.text(linesToDraw, align === "right" ? x + width - 1 : align === "center" ? x + width / 2 : x + 1, y + 4.7, { align });
  };

  const statusForBalance = (balance: number, overdueBalance: number, upcomingBalance: number): BalanceStatus => {
    if (balance <= 0) return "paid";
    if (overdueBalance > 0) return "overdue";
    if (upcomingBalance > 0) return "upcoming";
    return "neutral";
  };

  const statusForLines = (statusLines: CollectionVsDueLine[]): BalanceStatus => {
    const balance = statusLines.reduce((sum, line) => sum + Number(line.balance || 0), 0);
    if (balance <= 0) return "paid";
    if (statusLines.some((line) => line.is_overdue && Number(line.balance || 0) > 0)) return "overdue";
    return "upcoming";
  };

  const colorText = (
    value: string,
    x: number,
    y: number,
    width: number,
    status: BalanceStatus,
    align: "left" | "right" = "right",
    bold = false,
  ) => {
    const color = balanceColors[status];
    doc.setTextColor(color[0], color[1], color[2]);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    text(value, x, y, width, align);
    doc.setTextColor(20);
  };

  const monthIndexForPart = (part: PdfPart) => {
    const keys = [...new Set(parts.map((p) => p.periodKey))];
    return Math.max(0, keys.indexOf(part.periodKey));
  };

  const partMonthLabel = (part: PdfPart) => part.periodLabel.toUpperCase();

  const totalsForStudents = (students: SummaryStudentRow[], heads: PdfFeeHeadOption[]): StudentTotals => {
    const headTotals = heads.map(() => ({
      due: 0,
      collected: 0,
      balance: 0,
      overdueBalance: 0,
      upcomingBalance: 0,
    }));
    for (const student of students) {
      heads.forEach((head, index) => {
        const amount = student.amounts[head.amountKey];
        const due = Number(amount?.due || 0);
        const collected = Number(amount?.collected || 0);
        const balance = Number(amount?.balance ?? due - collected);
        headTotals[index].due += due;
        headTotals[index].collected += collected;
        headTotals[index].balance += balance;
        if (amount?.overdue && balance > 0) headTotals[index].overdueBalance += balance;
        else if (amount?.upcoming && balance > 0) headTotals[index].upcomingBalance += balance;
      });
    }
    const due = headTotals.reduce((sum, h) => sum + h.due, 0);
    const collected = headTotals.reduce((sum, h) => sum + h.collected, 0);
    const balance = headTotals.reduce((sum, h) => sum + h.balance, 0);
    const overdueBalance = headTotals.reduce((sum, h) => sum + h.overdueBalance, 0);
    const upcomingBalance = headTotals.reduce((sum, h) => sum + h.upcomingBalance, 0);
    return { due, collected, balance, overdueBalance, upcomingBalance, headTotals };
  };

  const drawBrand = (part: PdfPart, students: number) => {
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
    doc.text(brand?.org || "NIMT Educational Institutions", textX, y + 4.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    if (brand?.contactLine) doc.text(brand.contactLine, textX, y + 9.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20);
    doc.text(title, pageW - margin, y + 4.5, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(`${part.title} of ${parts.length} - ${part.periodLabel}`, pageW - margin, y + 9.5, { align: "right" });
    const subtitle = [opts.subtitle, `${students} students`, today].filter(Boolean).join(" - ");
    doc.text(doc.splitTextToSize(subtitle, usableW / 2).slice(0, 1), pageW - margin, y + 13.5, { align: "right" });
    y += 16;
    doc.setDrawColor(210);
    doc.line(margin, y, pageW - margin, y);
    return y + 3;
  };

  const drawMonthBand = (y: number, part: PdfPart) => {
    const fill = monthFills[monthIndexForPart(part) % monthFills.length];
    doc.setDrawColor(171, 190, 220);
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.rect(margin, y, usableW, monthBandH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(22, 43, 77);
    doc.text(partMonthLabel(part), margin + 3, y + 6.6);
    doc.setFontSize(7.4);
    doc.setTextColor(70, 85, 105);
    const partText = part.periodPartCount > 1
      ? `Month part ${part.periodPartNo} of ${part.periodPartCount} | Report part ${part.partNo} of ${parts.length}`
      : `Report part ${part.partNo} of ${parts.length}`;
    doc.text(partText, pageW - margin - 3, y + 6.4, { align: "right" });
    return y + monthBandH + 2;
  };

  const drawHeader = (y: number, part: PdfPart, headPairW: number) => {
    let x = margin;
    doc.setDrawColor(215);
    doc.setFillColor(248, 250, 252);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    doc.setTextColor(55);
    for (const col of fixedCols) {
      doc.rect(x, y, col.width, headerH, "S");
      text(col.label, x, y + 10.5, col.width, col.align);
      x += col.width;
    }
    for (const head of part.heads) {
      rectText(head.label, x, y, headPairW, 14, "center", 3);
      rectText("Due", x, y + 14, headPairW / 2, 8, "right");
      rectText("Collected", x + headPairW / 2, y + 14, headPairW / 2, 8, "right");
      x += headPairW;
    }
    for (const col of totalCols) {
      doc.rect(x, y, col.width, headerH, "S");
      text(col.label, x, y + 10.5, col.width, "right");
      x += col.width;
    }
    return y + headerH;
  };

  const drawSection = (y: number, section: ProgrammeBatchSection, count: number) => {
    doc.setFillColor(244, 247, 251);
    doc.setDrawColor(220);
    doc.rect(margin, y, usableW, sectionH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(30);
    const heading = [section.course_name, section.batch_name, section.campus_name]
      .filter((value) => value && value !== "—")
      .join(" - ");
    doc.text(heading || "Programme / Batch", margin + 2, y + 4.8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(105);
    doc.text(`${count} ${count === 1 ? "student" : "students"}`, pageW - margin - 2, y + 4.8, { align: "right" });
    return y + sectionH;
  };

  const drawSectionTotal = (
    y: number,
    students: SummaryStudentRow[],
    part: PdfPart,
    headPairW: number,
  ) => {
    const totals = totalsForStudents(students, part.heads);
    doc.setDrawColor(210);
    doc.setFillColor(235, 239, 245);
    doc.rect(margin, y, usableW, totalRowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(20);
    let x = margin;
    doc.text("Section total", x + 2, y + 4.9);
    x += fixedW;
    totals.headTotals.forEach((headTotal) => {
      text(inr(headTotal.due), x, y + 4.9, headPairW / 2, "right");
      text(inr(headTotal.collected), x + headPairW / 2, y + 4.9, headPairW / 2, "right");
      x += headPairW;
    });
    text(inr(totals.due), x, y + 4.9, totalCols[0].width, "right");
    x += totalCols[0].width;
    text(inr(totals.collected), x, y + 4.9, totalCols[1].width, "right");
    x += totalCols[1].width;
    colorText(
      inr(totals.balance),
      x,
      y + 4.9,
      totalCols[2].width,
      statusForBalance(totals.balance, totals.overdueBalance, totals.upcomingBalance),
      "right",
      true,
    );
    x += totalCols[2].width;
    return y + totalRowH;
  };

  const drawContinuationTop = (part: PdfPart, headPairW: number) => {
    let y = margin;
    y = drawMonthBand(y, part);
    return drawHeader(y, part, headPairW);
  };

  let totalRows = 0;
  parts.forEach((part, partIndex) => {
    if (partIndex > 0) doc.addPage();
    const partLines = filterLinesForPdfSelection(lines, {
      periodKeys: Array.from(new Set(part.heads.map((h) => h.periodKey))),
      headKeys: part.heads.map((h) => h.key),
    }, opts.metaByCourse);
    const sections = groupByProgrammeBatch(partLines);
    const partStudentCount = sections.reduce((count, section) => count + pivotStudents(section.lines).length, 0);
    totalRows += partStudentCount;
    const dynamicW = usableW - fixedW - totalW;
    const headPairW = part.heads.length > 0 ? dynamicW / part.heads.length : dynamicW;
    let y = drawBrand(part, partStudentCount);
    y = drawMonthBand(y, part);
    y = drawHeader(y, part, headPairW);

    sections.forEach((section) => {
      const students = pivotStudents(section.lines);
      if (y + sectionH + rowH + totalRowH > pageH - margin) {
        doc.addPage();
        y = drawContinuationTop(part, headPairW);
      }
      y = drawSection(y, section, students.length);
      students.forEach((student, idx) => {
        if (y + rowH > pageH - margin) {
          doc.addPage();
          y = drawContinuationTop(part, headPairW);
          y = drawSection(y, section, students.length);
        }
        if (idx % 2 === 1) {
          doc.setFillColor(249, 250, 251);
          doc.rect(margin, y, usableW, rowH, "F");
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.7);
        doc.setTextColor(20);
        let x = margin;
        const fixedValues = [
          String(idx + 1),
          student.name,
          student.admission_no === "—" ? "" : student.admission_no,
          student.course_name === "—" ? "" : student.course_name,
          student.batch_name === "—" ? "" : student.batch_name,
        ];
        fixedValues.forEach((value, i) => {
          text(value, x, y + 4.8, fixedCols[i].width, fixedCols[i].align);
          x += fixedCols[i].width;
        });
        let partDue = 0;
        let partCollected = 0;
        let partBalance = 0;
        let partOverdueBalance = 0;
        let partUpcomingBalance = 0;
        for (const head of part.heads) {
          const amount = student.amounts[head.amountKey];
          const due = Number(amount?.due || 0);
          const collected = Number(amount?.collected || 0);
          const balance = Number(amount?.balance ?? due - collected);
          partDue += due;
          partCollected += collected;
          partBalance += balance;
          if (amount?.overdue && balance > 0) partOverdueBalance += balance;
          else if (amount?.upcoming && balance > 0) partUpcomingBalance += balance;
          text(inr(due), x, y + 4.8, headPairW / 2, "right");
          text(inr(collected), x + headPairW / 2, y + 4.8, headPairW / 2, "right");
          x += headPairW;
        }
        text(inr(partDue), x, y + 4.8, totalCols[0].width, "right");
        x += totalCols[0].width;
        text(inr(partCollected), x, y + 4.8, totalCols[1].width, "right");
        x += totalCols[1].width;
        colorText(
          inr(partBalance),
          x,
          y + 4.8,
          totalCols[2].width,
          statusForBalance(partBalance, partOverdueBalance, partUpcomingBalance),
        );
        x += totalCols[2].width;
        y += rowH;
      });
      if (y + totalRowH > pageH - margin) {
        doc.addPage();
        y = drawContinuationTop(part, headPairW);
        y = drawSection(y, section, students.length);
      }
      y = drawSectionTotal(y, students, part, headPairW);
    });

    if (partStudentCount === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(110);
      doc.text("No students for this part", margin, y + 6);
    }
  });

  const drawOverallTotals = () => {
    doc.addPage();
    let y = margin;
    doc.setTextColor(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(brand?.org || "NIMT Educational Institutions", margin, y + 4.5);
    doc.setFontSize(12);
    doc.text(`${title} - Overall Totals`, pageW - margin, y + 4.5, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text([opts.subtitle, today].filter(Boolean).join(" - "), pageW - margin, y + 9.5, { align: "right" });
    y += 16;

    doc.setDrawColor(171, 190, 220);
    doc.setFillColor(229, 239, 255);
    doc.rect(margin, y, usableW, monthBandH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(22, 43, 77);
    doc.text("OVERALL TOTALS", margin + 3, y + 6.6);
    doc.setFontSize(7.4);
    doc.setTextColor(70, 85, 105);
    doc.text(`${parts.length} report ${parts.length === 1 ? "part" : "parts"}`, pageW - margin - 3, y + 6.4, { align: "right" });
    y += monthBandH + 4;

    const periodKeys = [...new Set(parts.map((p) => p.periodKey))];
    const periodLinesFor = (periodKey: string) => parts
      .filter((part) => part.periodKey === periodKey)
      .flatMap((part) => part.heads)
      .flatMap((head) => filterLinesForPdfSelection(lines, {
        periodKeys: [head.periodKey],
        headKeys: [head.key],
      }, opts.metaByCourse));
    const periodSummaries = periodKeys.map((periodKey) => {
      const periodParts = parts.filter((part) => part.periodKey === periodKey);
      const periodLines = periodLinesFor(periodKey);
      const due = periodLines.reduce((sum, line) => sum + Number(line.due_amount || 0), 0);
      const collected = periodLines.reduce((sum, line) => sum + Number(line.collected_amount || 0), 0);
      return {
        periodKey,
        label: periodParts[0]?.periodLabel || "Period",
        due,
        collected,
        balance: due - collected,
        status: statusForLines(periodLines),
      };
    });
    const allSummaryLines = periodKeys.flatMap((periodKey) => periodLinesFor(periodKey));
    const summaryGrandDue = periodSummaries.reduce((sum, row) => sum + row.due, 0);
    const summaryGrandCollected = periodSummaries.reduce((sum, row) => sum + row.collected, 0);

    const summaryCols = [
      { label: "Month / Term", width: 92, align: "left" as const },
      { label: "Due", width: 48, align: "right" as const },
      { label: "Collected", width: 48, align: "right" as const },
      { label: "Balance", width: 48, align: "right" as const },
    ];
    const summaryW = summaryCols.reduce((sum, col) => sum + col.width, 0);
    const summaryX = margin;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(30);
    doc.text("Month Wise Summary", summaryX, y + 4.8);
    y += 7;
    let sx = summaryX;
    doc.setDrawColor(205);
    doc.setFillColor(248, 250, 252);
    doc.rect(summaryX, y, summaryW, rowH, "F");
    summaryCols.forEach((col) => {
      doc.rect(sx, y, col.width, rowH);
      text(col.label, sx, y + 4.9, col.width, col.align);
      sx += col.width;
    });
    y += rowH;
    periodSummaries.forEach((row) => {
      sx = summaryX;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(25);
      const values = [row.label, inr(row.due), inr(row.collected)];
      summaryCols.slice(0, 3).forEach((col, index) => {
        doc.rect(sx, y, col.width, rowH);
        text(values[index], sx, y + 4.9, col.width, col.align, 1);
        sx += col.width;
      });
      doc.rect(sx, y, summaryCols[3].width, rowH);
      colorText(inr(row.balance), sx, y + 4.9, summaryCols[3].width, row.status);
      y += rowH;
    });
    sx = summaryX;
    doc.setFillColor(221, 230, 242);
    doc.rect(summaryX, y, summaryW, rowH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(25);
    const summaryGrandBalance = summaryGrandDue - summaryGrandCollected;
    const grandValues = ["GRAND TOTAL", inr(summaryGrandDue), inr(summaryGrandCollected)];
    summaryCols.slice(0, 3).forEach((col, index) => {
      doc.rect(sx, y, col.width, rowH);
      text(grandValues[index], sx, y + 4.9, col.width, col.align, 1);
      sx += col.width;
    });
    doc.rect(sx, y, summaryCols[3].width, rowH);
    colorText(inr(summaryGrandBalance), sx, y + 4.9, summaryCols[3].width, statusForLines(allSummaryLines), "right", true);
    y += rowH + 7;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(30);
    doc.text("Fee Head Detail", margin, y + 4.8);
    y += 7;

    const cols = [
      { label: "Month / Term", width: 62, align: "left" as const },
      { label: "Fee Head", width: 102, align: "left" as const },
      { label: "Due", width: 36, align: "right" as const },
      { label: "Collected", width: 36, align: "right" as const },
      { label: "Balance", width: 36, align: "right" as const },
    ];
    const tableW = cols.reduce((sum, col) => sum + col.width, 0);
    const tableX = margin;
    const drawTotalsHeader = () => {
      let x = tableX;
      doc.setDrawColor(205);
      doc.setFillColor(248, 250, 252);
      doc.rect(tableX, y, tableW, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(45);
      cols.forEach((col) => {
        doc.rect(x, y, col.width, rowH);
        text(col.label, x, y + 4.9, col.width, col.align);
        x += col.width;
      });
      y += rowH;
    };
    const ensureTotalsSpace = (height = rowH) => {
      if (y + height <= pageH - margin) return;
      doc.addPage();
      y = margin;
      drawTotalsHeader();
    };
    const drawTotalsRow = (
      values: [string, string, number, number, number],
      fill: [number, number, number] | null,
      bold = false,
      balanceStatus: BalanceStatus = "neutral",
    ) => {
      ensureTotalsSpace(rowH);
      let x = tableX;
      if (fill) {
        doc.setFillColor(fill[0], fill[1], fill[2]);
        doc.rect(tableX, y, tableW, rowH, "F");
      }
      doc.setDrawColor(220);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(7);
      doc.setTextColor(25);
      const displayValues = [values[0], values[1], inr(values[2]), inr(values[3])];
      cols.slice(0, 4).forEach((col, index) => {
        doc.rect(x, y, col.width, rowH);
        text(displayValues[index], x, y + 4.9, col.width, col.align, 1);
        x += col.width;
      });
      doc.rect(x, y, cols[4].width, rowH);
      colorText(inr(values[4]), x, y + 4.9, cols[4].width, balanceStatus, "right", bold);
      y += rowH;
    };
    const drawPeriodHeaderRow = (label: string, fill: [number, number, number]) => {
      ensureTotalsSpace(rowH);
      doc.setDrawColor(210);
      doc.setFillColor(fill[0], fill[1], fill[2]);
      doc.rect(tableX, y, tableW, rowH, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.3);
      doc.setTextColor(22, 43, 77);
      doc.text(label, tableX + 2, y + 4.9);
      y += rowH;
    };

    drawTotalsHeader();
    let grandDue = 0;
    let grandCollected = 0;
    const grandLines: CollectionVsDueLine[] = [];
    periodKeys.forEach((periodKey, periodIndex) => {
      const periodParts = parts.filter((part) => part.periodKey === periodKey);
      const periodLabel = periodParts[0]?.periodLabel || "Period";
      const periodHeads = periodParts.flatMap((part) => part.heads);
      let periodDue = 0;
      let periodCollected = 0;
      const periodDetailLines: CollectionVsDueLine[] = [];
      const fill = monthFills[periodIndex % monthFills.length];
      drawPeriodHeaderRow(periodLabel.toUpperCase(), fill);
      periodHeads.forEach((head) => {
        const headLines = filterLinesForPdfSelection(lines, {
          periodKeys: [head.periodKey],
          headKeys: [head.key],
        }, opts.metaByCourse);
        const due = headLines.reduce((sum, line) => sum + Number(line.due_amount || 0), 0);
        const collected = headLines.reduce((sum, line) => sum + Number(line.collected_amount || 0), 0);
        periodDue += due;
        periodCollected += collected;
        periodDetailLines.push(...headLines);
        drawTotalsRow(["", head.label, due, collected, due - collected], null, false, statusForLines(headLines));
      });
      grandDue += periodDue;
      grandCollected += periodCollected;
      grandLines.push(...periodDetailLines);
      drawTotalsRow(
        ["", "Month total", periodDue, periodCollected, periodDue - periodCollected],
        [238, 241, 245],
        true,
        statusForLines(periodDetailLines),
      );
    });
    drawTotalsRow(["GRAND TOTAL", "", grandDue, grandCollected, grandDue - grandCollected], [221, 230, 242], true, statusForLines(grandLines));
  };

  drawOverallTotals();

  doc.save(`${opts.filePrefix}-${new Date().toISOString().slice(0, 10)}.pdf`);
  return { count: totalRows, parts: parts.length };
}
