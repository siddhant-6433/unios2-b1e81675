import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";

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

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const key = formData.get("key") as string;
    const bucket = (formData.get("bucket") as string) || "unios-selfies";

    if (!file || !key) {
      return new Response(JSON.stringify({ error: "file and key required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!ALLOWED_BUCKETS.has(bucket)) {
      return new Response(JSON.stringify({ error: `Invalid bucket: ${bucket}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }));

    // Public buckets get direct URL, private buckets just return the key
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
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
