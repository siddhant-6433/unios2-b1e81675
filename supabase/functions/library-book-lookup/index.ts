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

async function lookupGoogleBooks(isbn: string): Promise<BookMatch | null> {
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`);
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
    cover_url: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
    source: "open_library",
    raw: json,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { isbn, barcode } = await req.json();
    const normalized = normalizeIsbn(isbn || barcode);
    if (!normalized || (normalized.length !== 10 && normalized.length !== 13)) {
      return new Response(JSON.stringify({ error: "A valid ISBN-10 or ISBN-13 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const google = await lookupGoogleBooks(normalized);
    if (google) {
      return new Response(JSON.stringify({ book: google, confidence: 0.92 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openLibrary = await lookupOpenLibrary(normalized);
    if (openLibrary) {
      return new Response(JSON.stringify({ book: openLibrary, confidence: 0.82 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
