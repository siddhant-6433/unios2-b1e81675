import { RekognitionClient, CreateFaceLivenessSessionCommand, GetFaceLivenessSessionResultsCommand } from "npm:@aws-sdk/client-rekognition";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getClient() {
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const region = Deno.env.get("AWS_REGION") || "ap-south-1";
  if (!accessKeyId || !secretAccessKey) return null;
  return new RekognitionClient({ region, credentials: { accessKeyId, secretAccessKey } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const client = getClient();
    if (!client) return json({ error: "AWS not configured" }, 503);

    const body = await req.json();
    const { action, session_id } = body;

    if (action === "create") {
      const res = await client.send(new CreateFaceLivenessSessionCommand({
        Settings: {
          AuditImagesLimit: 2,
        },
      }));

      console.log(`[liveness] Session created: ${res.SessionId}`);
      return json({ session_id: res.SessionId });
    }

    if (action === "get_results") {
      if (!session_id) return json({ error: "session_id required" }, 400);

      const res = await client.send(new GetFaceLivenessSessionResultsCommand({
        SessionId: session_id,
      }));

      const confidence = Math.round(res.Confidence || 0);
      const isLive = confidence >= 85;

      console.log(`[liveness] Session ${session_id}: confidence=${confidence}%, status=${res.Status}, live=${isLive}`);

      return json({
        session_id,
        confidence,
        status: res.Status,
        is_live: isLive,
        reference_image: res.ReferenceImage?.S3Object ? {
          bucket: res.ReferenceImage.S3Object.Bucket,
          key: res.ReferenceImage.S3Object.Name,
        } : null,
      });
    }

    return json({ error: "action must be 'create' or 'get_results'" }, 400);
  } catch (err: any) {
    console.error("[liveness] Error:", err.message);
    return json({ error: err.message }, 500);
  }
});
