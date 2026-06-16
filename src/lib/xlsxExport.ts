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
