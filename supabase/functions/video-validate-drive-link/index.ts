// Validates that a pasted video link is publicly viewable. We accept two
// kinds of source:
//   • Google Drive / Docs — must be shared "Anyone with the link → Viewer".
//   • YouTube (incl. unlisted) — must not be private/removed.
// Without this check, an editor could submit a private link that the
// approver can't open. For Drive we follow the URL with no credentials — if
// it redirects to accounts.google.com it's private; otherwise accessible.
// For YouTube we hit the public oEmbed endpoint, which returns 200 for
// public AND unlisted videos but 401/404 for private/removed ones.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Drive URLs come in many shapes; we extract the file ID and probe the
// canonical preview URL because it's the most reliable public-access signal.
function extractDriveFileId(url: string): string | null {
  const patterns = [
    /\/file\/d\/([A-Za-z0-9_-]+)/,
    /[?&]id=([A-Za-z0-9_-]+)/,
    /\/folders\/([A-Za-z0-9_-]+)/,
    /\/document\/d\/([A-Za-z0-9_-]+)/,
    /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/,
    /\/presentation\/d\/([A-Za-z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function isYouTubeHost(hostname: string): boolean {
  return /(?:^|\.)youtube\.com$|(?:^|\.)youtu\.be$/.test(hostname);
}

// Validate a YouTube link (public or unlisted) via the public oEmbed endpoint.
// oEmbed returns 200 for watchable videos — including unlisted ones, since
// they're viewable by anyone with the link — and 401/404 for private/removed.
async function validateYouTube(url: string): Promise<Response> {
  const oembed = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  let res: Response;
  try {
    res = await fetch(oembed, { headers: { "User-Agent": "NIMT-VideoApprovalBot/1.0" } });
  } catch (e) {
    return json({ valid: false, reason: `Couldn't reach YouTube: ${(e as Error).message}` });
  }

  if (res.status === 401 || res.status === 403) {
    return json({
      valid: false,
      reason: "This video is private. Set it to 'Unlisted' (or Public) so the approver can open it, then paste again.",
    });
  }
  if (res.status === 404) {
    return json({
      valid: false,
      reason: "This YouTube video couldn't be found. Check the link and try again.",
    });
  }
  if (!res.ok) {
    return json({ valid: false, reason: `YouTube returned status ${res.status}. Check the link and try again.` });
  }
  return json({ valid: true, source: "youtube" });
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (typeof url !== "string" || !url.trim()) {
      return json({ valid: false, reason: "Missing url" }, 400);
    }

    let parsed: URL;
    try { parsed = new URL(url); } catch {
      return json({ valid: false, reason: "Invalid URL" });
    }

    if (isYouTubeHost(parsed.hostname)) {
      return await validateYouTube(url);
    }

    if (!/(?:^|\.)drive\.google\.com$|(?:^|\.)docs\.google\.com$/.test(parsed.hostname)) {
      return json({
        valid: false,
        reason: "Please use a Google Drive (or Docs) or YouTube link",
      });
    }

    const fileId = extractDriveFileId(url);
    if (!fileId) {
      return json({ valid: false, reason: "Couldn't find a file ID in this link" });
    }

    // The /preview endpoint serves the iframe player for public files and
    // 302s to accounts.google.com for private ones.
    const probeUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    const res = await fetch(probeUrl, {
      redirect: "follow",
      headers: { "User-Agent": "NIMT-VideoApprovalBot/1.0" },
    });

    const finalHost = new URL(res.url).hostname;
    if (finalHost.includes("accounts.google.com") || res.status === 401 || res.status === 403) {
      return json({
        valid: false,
        reason: "This link is private. Open the file in Drive → Share → 'Anyone with the link → Viewer', then paste again.",
        file_id: fileId,
      });
    }

    if (!res.ok) {
      return json({
        valid: false,
        reason: `Drive returned status ${res.status}. Check the link and try again.`,
        file_id: fileId,
      });
    }

    return json({ valid: true, source: "drive", file_id: fileId });
  } catch (e) {
    return json({ valid: false, reason: `Validation failed: ${(e as Error).message}` });
  }
});
