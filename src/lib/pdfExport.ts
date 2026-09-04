import { maskExportRows } from "./maskContact";
import type { ExportRow, ExportOptions } from "./xlsxExport";

export type PdfBrand = {
  logoSrc?: string;   // bundled asset URL (png or svg); rasterized to PNG for jsPDF
  org?: string;       // institution name shown next to the logo
  contactLine?: string; // phone · email · website
  subtitle?: string;  // active-filter context under the report title
};

export type PdfExportOptions = ExportOptions & { brand?: PdfBrand };

// Fetch a bundled image asset and return a PNG data URL + aspect ratio. SVGs are
// rasterized through a canvas (jsPDF can't embed SVG directly). Mirrors the
// helper in SchoolFeeProposalDialog.tsx.
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

// Landscape-A4 table PDF from the same object-keyed rows the Excel exporter takes.
// Raw jsPDF (the repo has no jspdf-autotable) — a compact paginated grid with an
// optional branded header. Contact columns are masked unless { unmask: true },
// mirroring exportRowsXlsx.
export async function exportRowsPdf(
  rows: ExportRow[],
  title: string,
  filePrefix: string,
  opts?: PdfExportOptions,
) {
  if (rows.length === 0) return { count: 0 };

  const out = maskExportRows(rows, !!opts?.unmask);
  const headers = Array.from(
    out.reduce((keys, row) => {
      Object.keys(row).forEach((k) => keys.add(k));
      return keys;
    }, new Set<string>()),
  );

  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const usableW = pageW - margin * 2;
  const colW = usableW / headers.length;
  const rowH = 7;
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  // Branded logo is best-effort — if it fails to load we still render the report.
  let logo: { dataUrl: string; aspect: number } | null = null;
  if (opts?.brand?.logoSrc) {
    try { logo = await imageAssetToPng(opts.brand.logoSrc); } catch { logo = null; }
  }

  const clip = (text: string, width = colW) => {
    let t = text;
    while (t.length > 3 && doc.getTextWidth(t) > width - 3) t = t.slice(0, -1);
    return t === text ? t : t.slice(0, -1) + "…";
  };

  let y = margin;

  const drawBrandBand = () => {
    const brand = opts?.brand;
    const logoH = 11;
    let textX = margin;
    if (logo) {
      const logoW = Math.min(logo.aspect * logoH, 46);
      doc.addImage(logo.dataUrl, "PNG", margin, y, logoW, logoH, undefined, "FAST");
      textX = margin + logoW + 4;
    }
    doc.setTextColor(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(brand?.org || title, textX, y + 4.5);
    if (brand?.contactLine) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(110);
      doc.text(brand.contactLine, textX, y + 9.5);
    }
    // Right-aligned report title + as-of + subtitle.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20);
    doc.text(title, pageW - margin, y + 4.5, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(`As of ${today} · ${out.length} rows`, pageW - margin, y + 9.5, { align: "right" });
    if (brand?.subtitle) doc.text(clip(brand.subtitle, usableW / 2), pageW - margin, y + 13.5, { align: "right" });

    y += logoH + 3;
    doc.setDrawColor(210);
    doc.line(margin, y, pageW - margin, y);
    y += 3;
    drawColumnHeader();
  };

  const drawColumnHeader = () => {
    doc.setFillColor(241, 243, 245);
    doc.rect(margin, y, usableW, rowH, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60);
    headers.forEach((h, i) => doc.text(clip(h), margin + i * colW + 1.5, y + 4.8));
    y += rowH;
  };

  drawBrandBand();

  doc.setFont("helvetica", "normal");
  doc.setTextColor(20);
  out.forEach((row, idx) => {
    if (y + rowH > pageH - margin) {
      doc.addPage();
      y = margin;
      drawColumnHeader();
      doc.setFont("helvetica", "normal");
      doc.setTextColor(20);
    }
    if (idx % 2 === 1) {
      doc.setFillColor(249, 250, 251);
      doc.rect(margin, y, usableW, rowH, "F");
    }
    doc.setFontSize(8);
    headers.forEach((h, i) => {
      const v = row[h];
      doc.text(clip(v == null ? "" : String(v)), margin + i * colW + 1.5, y + 4.8);
    });
    y += rowH;
  });

  doc.save(`${filePrefix}-${new Date().toISOString().slice(0, 10)}.pdf`);
  return { count: out.length };
}
