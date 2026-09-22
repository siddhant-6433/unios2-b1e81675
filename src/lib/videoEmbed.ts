/**
 * Turn a submitted video link (Google Drive file or YouTube) into an
 * embeddable URL for the in-app inline player.
 *
 * Pure so it can be unit-tested; returns null when the URL can't be embedded,
 * in which case callers fall back to an "open in new tab" link.
 */

export function videoSourceLabel(url: string | null | undefined): "YouTube" | "Drive" {
  return /youtube\.com|youtu\.be/i.test(String(url || "")) ? "YouTube" : "Drive";
}

export function toVideoEmbedUrl(url: string | null | undefined): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;

  // YouTube: watch?v=<id>, youtu.be/<id>, /embed/<id>, /shorts/<id>
  const yt = raw.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i,
  );
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;

  // Google Drive: /file/d/<id>/…, open?id=<id>, uc?id=<id>, uc?export=…&id=<id>
  if (/drive\.google\.com/i.test(raw)) {
    const drive = raw.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) || raw.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
    if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  }

  return null;
}
