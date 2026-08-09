// Parsing helpers for library accession-register imports (CSV/Excel).
// Registers repeat values down the page with ditto marks or blank cells, use
// combined "Place & Publisher" columns, and write costs like "460/-". These are
// pure functions so the messy parsing is unit-tested independently of the page.

export function normalizeHeader(value: string): string {
  return (value ?? "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Explicit "same as row above" tokens. NOTE bare "-" is deliberately excluded —
// in these registers it usually means "none/NA" (e.g. no edition), not ditto.
const DITTO_TOKENS = new Set([",,", '"', "”", "″", "〃", "''", "-do-", "do", "--"]);

export function isDitto(value: unknown): boolean {
  const v = (value ?? "").toString().trim().toLowerCase();
  if (v === "") return false; // blanks are handled by forwardFill, not here
  return DITTO_TOKENS.has(v);
}

// Carry the previous resolved value forward when a cell is a ditto token OR blank
// (aggressive fill, per product decision). Columns in `exempt` are left untouched
// and never propagate — used for per-row keys like the accession number.
export function forwardFill(body: string[][], width: number, exempt: Set<number> = new Set()): string[][] {
  const last: (string | undefined)[] = [];
  return body.map((row) => {
    const out: string[] = [];
    for (let c = 0; c < width; c++) {
      const cell = (row[c] ?? "").toString().trim();
      if (exempt.has(c)) {
        out[c] = cell;
        continue;
      }
      if (cell === "" || isDitto(cell)) {
        out[c] = last[c] ?? "";
      } else {
        last[c] = cell;
        out[c] = cell;
      }
    }
    return out;
  });
}

// The real header row isn't always row 0 (files carry title/institution banners).
// Pick the first row that looks like a header: has both an author-ish and title-ish cell.
export function detectHeaderRow(rows: string[][]): number {
  const hasAuthor = (r: string[]) => r.some((c) => /author|writer/i.test((c ?? "").toString()));
  const hasTitle = (r: string[]) => r.some((c) => /\btitle\b|book\s*name|name\s*of\s*book/i.test((c ?? "").toString()));
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    if (hasAuthor(rows[i]) && hasTitle(rows[i])) return i;
  }
  return 0;
}

// "460/-", "575/", "1,250/-", "845" -> number. Junk -> null.
export function parseAmount(value: unknown): number | null {
  const s = (value ?? "").toString().replace(/[^0-9.]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// First integer run in the string: "13.1" -> 13, "2025 " -> 2025, "Re" -> null.
export function parseIntLoose(value: unknown): number | null {
  const m = (value ?? "").toString().match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

// Strip editorial "and others" markers ("et al", "et al.", "etal", "and others", "& others")
// from an author string — they mean "and others", not a real author, and must not become entities.
// Works on a single name or a comma-joined list ("Taylor, et al" -> "Taylor").
export function cleanAuthorName(value: unknown): string {
  return (value ?? "").toString()
    .replace(/[,\s]*\bet\.?\s*al\b\.?/gi, "")
    .replace(/[,\s]*(?:and|&)\s+others\b/gi, "")
    .replace(/[\s,]+$/g, "")
    .trim();
}

// Publisher matching key — mirrors the SQL library_normalize_publisher(): drop place names and
// publishing boilerplate, sort the remaining tokens, so "jaypee bro Pub Delhi", "N. Delhi jaypee
// Pub" and "Jaypee" all collapse to "jaypee". Keep this in sync with the SQL stop-word list.
const PUBLISHER_STOPWORDS = new Set([
  "pub", "pubs", "publication", "publications", "publisher", "publishers", "publishing", "pvt", "ltd", "limited",
  "bro", "bros", "brother", "brothers", "house", "book", "books", "co", "company", "and", "the", "of", "inc", "press", "media",
  "new", "delhi", "ndelhi", "n", "newdelhi", "jaipur", "mumbai", "bombay", "kolkata", "calcutta", "chennai",
  "madras", "bangalore", "bengaluru", "hyderabad", "lucknow", "agra", "noida", "india", "indian",
]);
export function normalizePublisher(name: unknown): string {
  return (name ?? "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .split(/\s+/)
    .filter((t) => t && !PUBLISHER_STOPWORDS.has(t))
    .sort()
    .join(" ");
}

// Combined "Place & Publisher" cell. Split on the first ':' or ';' (the delimiters
// actually seen: "N.Delhi: Pearson", "New Delhi; CBS Pub"). No delimiter -> the whole
// value is the publisher (lossless); we do NOT split on comma (mangles "Jain Pub. Jaipur").
export function splitPlacePublisher(value: unknown): { place: string | null; publisher: string | null } {
  const v = (value ?? "").toString().trim();
  if (!v) return { place: null, publisher: null };
  const m = v.match(/^(.*?)\s*[:;]\s*(.+)$/);
  if (m) return { place: m[1].trim() || null, publisher: m[2].trim() || null };
  return { place: null, publisher: v };
}

// Field -> accepted header names (matched after normalizeHeader).
export const COLUMN_ALIASES: Record<string, string[]> = {
  date: ["Date"],
  accession: ["Accession No", "Accession Number", "Accession", "Acc No", "Acc.No.", "Acc no.", "Acc.N.", "Acc No.", "Accession No."],
  author: ["Author", "Authors", "Writer"],
  title: ["Title", "Book Title", "Name of Book", "Name"],
  edition: ["Edition", "Edi.", "Edi", "Ed", "Ed."],
  placePublisher: ["Place & Publisher", "Place and Publisher", "Publisher & Place", "Publisher", "Place"],
  year: ["Year", "Year Pub", "Published Year", "Publication Year"],
  pages: ["Pages", "Page", "No of Pages", "No. of Pages", "Page No"],
  volume: ["Volume", "Vol.", "Vol"],
  cost: ["Cost", "Price", "Purchase Price", "Amount"],
  remark: ["Remark", "Remarks", "Note", "Notes"],
  isbn: ["ISBN", "ISBN13", "ISBN 13", "ISBN10", "Book ISBN"],
  barcode: ["Barcode", "Book Barcode"],
  category: ["Category", "Class", "Classification"],
  subject: ["Subject"],
  language: ["Language"],
  shelf: ["Shelf", "Shelf Location", "Location"],
  rack: ["Rack", "Rack No"],
};

// Resolve each field to a column index in the detected header row (-1 absent -> omitted).
export function resolveColumns(headerRow: string[], aliases: Record<string, string[]> = COLUMN_ALIASES): Record<string, number> {
  const normHeaders = headerRow.map((h) => normalizeHeader((h ?? "").toString()));
  const out: Record<string, number> = {};
  for (const [field, names] of Object.entries(aliases)) {
    for (const name of names) {
      const idx = normHeaders.indexOf(normalizeHeader(name));
      if (idx !== -1) {
        out[field] = idx;
        break;
      }
    }
  }
  return out;
}
