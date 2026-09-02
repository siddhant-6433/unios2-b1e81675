import { isSampleHeaderHandle, sendableHeaderMediaUrl } from "@/components/templates/WhatsAppTemplatePreviewBubble";

export type PublicMediaProbe = {
  ok: boolean;
  reason: string | null;
};

/**
 * Syntax-only check. Meta fetches this URL itself, so it has to be https and
 * must not be the sample scontent/lookaside handle from template approval.
 */
export function classifyHeaderMediaUrl(url: string): PublicMediaProbe & { url?: string } {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, reason: "Enter a public HTTPS URL." };
  if (!/^https:\/\//i.test(trimmed)) {
    return { ok: false, reason: "Must be an https:// URL. Meta cannot fetch http." };
  }
  if (isSampleHeaderHandle(trimmed)) {
    return {
      ok: false,
      reason: "That's Meta's sample link. Upload the file somewhere public (or Template Manager) and paste that URL.",
    };
  }
  if (!sendableHeaderMediaUrl(trimmed)) return { ok: false, reason: "Not a usable send URL." };
  return { ok: true, reason: null, url: trimmed };
}

const probeFetch = async (url: string, method: "HEAD" | "GET"): Promise<PublicMediaProbe | null> => {
  const res = await fetch(url, { method, mode: "cors", cache: "no-store", redirect: "follow" });
  if (res.status === 404) return { ok: false, reason: "URL returned 404 — file not found." };
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "URL is not public (login required or 403)." };
  if (res.ok) return { ok: true, reason: null };
  return null;
};

const probeAsImage = (url: string, timeoutMs = 8000): Promise<boolean> =>
  new Promise((resolve) => {
    if (typeof Image === "undefined") {
      resolve(false);
      return;
    }
    const img = new Image();
    const timer = window.setTimeout(() => resolve(false), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    img.referrerPolicy = "no-referrer";
    img.src = url;
  });

/**
 * Confirm Meta (and a browser) can actually fetch the file. CORS may block
 * HEAD/GET; a public image still loads via Image(), which is enough — Meta
 * does not use CORS.
 */
export async function probePublicMediaUrl(url: string): Promise<PublicMediaProbe> {
  const classified = classifyHeaderMediaUrl(url);
  if (!classified.ok || !classified.url) return classified;

  try {
    const head = await probeFetch(classified.url, "HEAD");
    if (head) return head;
  } catch {
    /* CORS or network — try GET / image */
  }

  try {
    const get = await probeFetch(classified.url, "GET");
    if (get) return get;
  } catch {
    /* CORS */
  }

  if (await probeAsImage(classified.url)) return { ok: true, reason: null };

  return {
    ok: false,
    reason: "Could not fetch this URL. It must load in a private window without login.",
  };
}
