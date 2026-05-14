import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sanitize = (n: string) =>
  n
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const makeKey = (filename: string, prefix: string) => {
  const safe = sanitize(filename || "file");
  const stamp = Date.now().toString(36);
  return `${prefix.replace(/^\/+|\/+$/g, "")}/${stamp}-${safe}`;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const accountId = Deno.env.get("R2_ACCOUNT_ID");
    const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY");
    const bucket = Deno.env.get("R2_BUCKET");
    const publicBase = (Deno.env.get("R2_PUBLIC_BASE_URL") || "").replace(/\/+$/, "");

    if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
      return json({ error: "R2 env not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL)" }, 500);
    }

    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

    const contentType = req.headers.get("content-type") || "";

    // Mode 1: JSON { source_url, filename?, prefix? } → server-side fetch + upload
    if (contentType.includes("application/json")) {
      const { source_url, filename, prefix = "letters" } = await req.json();
      if (!source_url || typeof source_url !== "string") {
        return json({ error: "source_url required" }, 400);
      }
      const resp = await fetch(source_url);
      if (!resp.ok) return json({ error: `fetch failed: ${resp.status}` }, 400);

      const bytes = new Uint8Array(await resp.arrayBuffer());
      const ct = resp.headers.get("content-type") || "application/octet-stream";
      const nameGuess = filename || (() => {
        try { return new URL(source_url).pathname.split("/").pop() || "file"; }
        catch { return "file"; }
      })();
      const key = makeKey(decodeURIComponent(nameGuess), prefix);

      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: ct }));
      return json({ url: `${publicBase}/${key}`, key });
    }

    // Mode 2: FormData { file, filename?, prefix? } → direct upload
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const filename = (formData.get("filename") as string) || file?.name || "file";
    const prefix = (formData.get("prefix") as string) || "letters";
    if (!file) return json({ error: "file required" }, 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = makeKey(filename, prefix);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: file.type || "application/octet-stream",
    }));
    return json({ url: `${publicBase}/${key}`, key });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[r2-upload] Error:", message);
    return json({ error: message }, 500);
  }
});
