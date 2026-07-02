type ExportValue = string | number | boolean | null | undefined;

export type ExportRow = Record<string, ExportValue>;

export const formatExportDateTime = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN");
};

export async function exportRowsXlsx(rows: ExportRow[], sheetName: string, filePrefix: string) {
  if (rows.length === 0) return { count: 0 };

  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `${filePrefix}-${today}.xlsx`);

  return { count: rows.length };
}

const csvCell = (value: ExportValue) => {
  const stringValue = value == null ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
};

export function exportRowsCsv(rows: ExportRow[], filePrefix: string) {
  if (rows.length === 0) return { count: 0 };

  const headers = Array.from(
    rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  );
  const csv = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
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
