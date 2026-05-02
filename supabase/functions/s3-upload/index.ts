import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_BUCKETS = new Set(["unios-selfies", "unios-student-documents", "unios-application-forms"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID")!;
    const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY")!;
    const region = Deno.env.get("AWS_REGION") || "ap-south-1";
    const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });

    const contentType = req.headers.get("content-type") || "";

    // Mode 1: JSON request → return presigned upload URL
    if (contentType.includes("application/json")) {
      const { key, bucket = "unios-selfies", content_type = "image/jpeg" } = await req.json();
      if (!key) {
        return new Response(JSON.stringify({ error: "key required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!ALLOWED_BUCKETS.has(bucket)) {
        return new Response(JSON.stringify({ error: `Invalid bucket: ${bucket}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: content_type,
      });
      const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

      const isPublic = bucket === "unios-selfies";
      const publicUrl = isPublic
        ? `https://${bucket}.s3.${region}.amazonaws.com/${key}`
        : `s3://${bucket}/${key}`;

      return new Response(JSON.stringify({ presigned_url: presignedUrl, url: publicUrl, bucket, key }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mode 2: FormData → direct upload (for web/curl)
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const key = formData.get("key") as string;
    const bucket = (formData.get("bucket") as string) || "unios-selfies";

    if (!file || !key) {
      return new Response(JSON.stringify({ error: "file and key required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_BUCKETS.has(bucket)) {
      return new Response(JSON.stringify({ error: `Invalid bucket: ${bucket}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: file.type || "application/octet-stream",
    }));

    const isPublic = bucket === "unios-selfies";
    const url = isPublic
      ? `https://${bucket}.s3.${region}.amazonaws.com/${key}`
      : `s3://${bucket}/${key}`;

    return new Response(JSON.stringify({ url, bucket, key }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[s3-upload] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
