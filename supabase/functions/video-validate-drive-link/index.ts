// Validates that a pasted Google Drive link is publicly viewable
// ("Anyone with the link → Viewer"). Without this check, an editor could
// submit a private link that the approver can't open. We follow the URL
// with no credentials — if Drive redirects to accounts.google.com, it's
// private; otherwise it's accessible.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (typeof url !== "string" || !url.trim()) {
      return new Response(JSON.stringify({ valid: false, reason: "Missing url" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: URL;
    try { parsed = new URL(url); } catch {
      return new Response(JSON.stringify({ valid: false, reason: "Invalid URL" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!/(?:^|\.)drive\.google\.com$|(?:^|\.)docs\.google\.com$/.test(parsed.hostname)) {
      return new Response(JSON.stringify({
        valid: false,
        reason: "Please use a Google Drive (or Docs) link",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fileId = extractDriveFileId(url);
    if (!fileId) {
      return new Response(JSON.stringify({
        valid: false,
        reason: "Couldn't find a file ID in this link",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      return new Response(JSON.stringify({
        valid: false,
        reason: "This link is private. Open the file in Drive → Share → 'Anyone with the link → Viewer', then paste again.",
        file_id: fileId,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!res.ok) {
      return new Response(JSON.stringify({
        valid: false,
        reason: `Drive returned status ${res.status}. Check the link and try again.`,
        file_id: fileId,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ valid: true, file_id: fileId }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({
      valid: false,
      reason: `Validation failed: ${(e as Error).message}`,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
