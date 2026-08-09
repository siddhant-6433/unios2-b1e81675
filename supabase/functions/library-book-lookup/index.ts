/* eslint-disable @typescript-eslint/no-explicit-any */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type BookMatch = {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  published_year?: number;
  isbn_10?: string | null;
  isbn_13?: string | null;
  language?: string;
  category?: string;
  subject?: string;
  description?: string;
  cover_url?: string;
  source: "google_books" | "open_library";
  raw?: unknown;
};

function normalizeIsbn(value: string) {
  return String(value || "").replace(/[^0-9Xx]/g, "");
}

function splitYear(value?: string) {
  const match = value?.match(/\d{4}/);
  return match ? Number(match[0]) : undefined;
}

// Optional Google Books API key — without it Google shares a tiny anonymous quota and 429s fast,
// so covers/metadata fall back to Open Library. Set GOOGLE_BOOKS_API_KEY to make Google reliable.
const GBOOKS_KEY = Deno.env.get("GOOGLE_BOOKS_API_KEY") || "";
const gbKeyParam = GBOOKS_KEY ? `&key=${GBOOKS_KEY}` : "";

// Open Library serves an ISBN cover directly; default=false makes it 404 (not a 1px placeholder)
// when no cover exists, so downstream fetch can tell "no cover" from "blank image".
function openLibraryIsbnCover(isbn?: string | null): string | undefined {
  const clean = normalizeIsbn(isbn || "");
  return clean.length === 10 || clean.length === 13
    ? `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg?default=false`
    : undefined;
}

// Google Books' keyless cover endpoint — has many Indian textbook covers Open Library lacks.
// It returns a small (~1.3KB) placeholder when absent; library-cover-capture drops tiny images.
function googleIsbnCover(isbn?: string | null): string | undefined {
  const clean = normalizeIsbn(isbn || "");
  return clean.length === 10 || clean.length === 13
    ? `https://books.google.com/books/content?vid=ISBN${clean}&printsec=frontcover&img=1&zoom=1`
    : undefined;
}

async function lookupGoogleBooks(isbn: string): Promise<BookMatch | null> {
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}${gbKeyParam}`);
  if (!res.ok) return null;
  const json = await res.json();
  const volume = json?.items?.[0]?.volumeInfo;
  if (!volume?.title) return null;
  const identifiers = volume.industryIdentifiers || [];
  const isbn10 = identifiers.find((id: any) => id.type === "ISBN_10")?.identifier || null;
  const isbn13 = identifiers.find((id: any) => id.type === "ISBN_13")?.identifier || null;
  return {
    title: volume.title,
    subtitle: volume.subtitle,
    authors: volume.authors || [],
    publisher: volume.publisher,
    published_year: splitYear(volume.publishedDate),
    isbn_10: isbn10,
    isbn_13: isbn13,
    language: volume.language,
    category: volume.categories?.[0],
    subject: volume.categories?.join(", "),
    description: volume.description,
    cover_url: volume.imageLinks?.thumbnail?.replace(/^http:/, "https:"),
    source: "google_books",
    raw: volume,
  };
}

async function lookupOpenLibrary(isbn: string): Promise<BookMatch | null> {
  const res = await fetch(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json?.title) return null;

  let authors: string[] = [];
  const authorKeys = Array.isArray(json.authors) ? json.authors.map((a: any) => a.key).filter(Boolean).slice(0, 5) : [];
  if (authorKeys.length > 0) {
    const fetched = await Promise.all(authorKeys.map(async (key: string) => {
      try {
        const authorRes = await fetch(`https://openlibrary.org${key}.json`);
        if (!authorRes.ok) return null;
        const author = await authorRes.json();
        return author?.name || null;
      } catch {
        return null;
      }
    }));
    authors = fetched.filter(Boolean) as string[];
  }

  const coverId = json.covers?.[0];
  return {
    title: json.title,
    subtitle: json.subtitle,
    authors,
    publisher: json.publishers?.[0],
    published_year: splitYear(json.publish_date),
    isbn_10: json.isbn_10?.[0] || (isbn.length === 10 ? isbn : null),
    isbn_13: json.isbn_13?.[0] || (isbn.length === 13 ? isbn : null),
    language: json.languages?.[0]?.key?.split("/").pop(),
    category: json.subjects?.[0],
    subject: json.subjects?.slice(0, 5).join(", "),
    description: typeof json.description === "string" ? json.description : json.description?.value,
    // Only a real cover id is a guaranteed image; leave undefined otherwise so withCover() can try
    // Google's keyless endpoint (a bare /b/isbn/ URL returns a 1px placeholder, not a 404).
    cover_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
    source: "open_library",
    raw: json,
  };
}

async function searchGoogleBooksByText(title: string, author?: string): Promise<BookMatch | null> {
  // Space-separated terms (encodeURIComponent turns a literal "+" into %2B, which Google treats
  // as a literal plus, not a term separator).
  const q = [`intitle:${title}`, author ? `inauthor:${author}` : ""].filter(Boolean).join(" ");
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1${gbKeyParam}`);
  if (!res.ok) return null;
  const json = await res.json();
  const volume = json?.items?.[0]?.volumeInfo;
  if (!volume?.title) return null;
  const identifiers = volume.industryIdentifiers || [];
  return {
    title: volume.title,
    subtitle: volume.subtitle,
    authors: volume.authors || [],
    publisher: volume.publisher,
    published_year: splitYear(volume.publishedDate),
    isbn_10: identifiers.find((id: any) => id.type === "ISBN_10")?.identifier || null,
    isbn_13: identifiers.find((id: any) => id.type === "ISBN_13")?.identifier || null,
    language: volume.language,
    category: volume.categories?.[0],
    subject: volume.categories?.join(", "),
    description: volume.description,
    cover_url: volume.imageLinks?.thumbnail?.replace(/^http:/, "https:"),
    source: "google_books",
    raw: volume,
  };
}

async function searchOpenLibraryByText(title: string, author?: string): Promise<BookMatch | null> {
  const params = new URLSearchParams({ title, limit: "1" });
  if (author) params.set("author", author);
  // Without an explicit fields list, search.json omits isbn/subject/language — request them.
  params.set("fields", "title,author_name,publisher,first_publish_year,isbn,language,subject,cover_i");
  const res = await fetch(`https://openlibrary.org/search.json?${params.toString()}`);
  if (!res.ok) return null;
  const json = await res.json();
  const doc = json?.docs?.[0];
  if (!doc?.title) return null;
  const isbns: string[] = Array.isArray(doc.isbn) ? doc.isbn.map((x: string) => normalizeIsbn(x)) : [];
  return {
    title: doc.title,
    authors: doc.author_name || [],
    publisher: doc.publisher?.[0],
    published_year: doc.first_publish_year,
    isbn_10: isbns.find((x) => x.length === 10) || null,
    isbn_13: isbns.find((x) => x.length === 13) || null,
    language: doc.language?.[0],
    subject: doc.subject?.slice(0, 5).join(", "),
    cover_url: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : undefined,
    source: "open_library",
    raw: doc,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { isbn, barcode, title, author, prefer } = await req.json();
    const normalized = normalizeIsbn(isbn || barcode);
    const hasIsbn = normalized && (normalized.length === 10 || normalized.length === 13);
    const titleText = String(title || "").trim();

    if (!hasIsbn && !titleText) {
      return new Response(JSON.stringify({ error: "A valid ISBN-10/13 or a title is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Bulk callers pass prefer:"open_library" — Google has no API key here (shared anonymous quota,
    // rate-limits fast), so preferring Open Library avoids 429 noise and wasted calls at volume.
    const openFirst = prefer === "open_library";
    const authorText = String(author || "").trim() || undefined;

    // Merge two source results: keep the primary's metadata, but backfill a cover from the
    // secondary (or an ISBN-based Open Library cover) when the primary has none.
    const withCover = (primary: BookMatch | null, secondary: BookMatch | null): BookMatch | null => {
      const book = primary || secondary;
      if (!book) return null;
      if (!book.cover_url) {
        const isbnForCover = book.isbn_13 || book.isbn_10 || (hasIsbn ? normalized : null);
        book.cover_url = (primary && secondary && secondary.cover_url) ? secondary.cover_url
          : googleIsbnCover(isbnForCover) || openLibraryIsbnCover(isbnForCover);
      }
      return book;
    };

    if (hasIsbn) {
      const g = () => lookupGoogleBooks(normalized);
      const o = () => lookupOpenLibrary(normalized);
      const first = await (openFirst ? o() : g());
      // Fetch the other source when the first missed OR returned no cover.
      const second = (!first || !first.cover_url) ? await (openFirst ? g() : o()) : null;
      const book = withCover(first, second);
      if (book) return new Response(JSON.stringify({ book, confidence: (book.source === "google_books") ? 0.92 : 0.82 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (titleText) {
      const g = () => searchGoogleBooksByText(titleText, authorText);
      const o = () => searchOpenLibraryByText(titleText, authorText);
      const first = await (openFirst ? o() : g());
      const second = (!first || !first.cover_url) ? await (openFirst ? g() : o()) : null;
      const book = withCover(first, second);
      if (book) return new Response(JSON.stringify({ book, confidence: 0.5 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ book: null, confidence: 0, error: "No metadata match found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Lookup failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
