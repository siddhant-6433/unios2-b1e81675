import { maskExportRows } from "./maskContact";

type ExportValue = string | number | boolean | null | undefined;

export type ExportRow = Record<string, ExportValue>;

// Contact-list exports mask phone/email unless the caller is a super_admin
// (pass { unmask: true }). Masked by default — fail-closed.
export type ExportOptions = { unmask?: boolean };

export const formatExportDateTime = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN");
};

export async function exportRowsXlsx(rows: ExportRow[], sheetName: string, filePrefix: string, opts?: ExportOptions) {
  if (rows.length === 0) return { count: 0 };

  const out = maskExportRows(rows, !!opts?.unmask);
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(out);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `${filePrefix}-${today}.xlsx`);

  return { count: rows.length };
}

const csvCell = (value: ExportValue) => {
  const stringValue = value == null ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
};

export function exportRowsCsv(rows: ExportRow[], filePrefix: string, opts?: ExportOptions) {
  if (rows.length === 0) return { count: 0 };

  const out = maskExportRows(rows, !!opts?.unmask);
  const headers = Array.from(
    out.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  );
  const csv = [
    headers.map(csvCell).join(","),
    ...out.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");

  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return { count: rows.length };
}
