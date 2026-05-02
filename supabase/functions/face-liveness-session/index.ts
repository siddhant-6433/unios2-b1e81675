import { RekognitionClient, CreateFaceLivenessSessionCommand, GetFaceLivenessSessionResultsCommand, SearchFacesByImageCommand } from "npm:@aws-sdk/client-rekognition";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COLLECTION_ID = "unios-employee-faces";
const SELFIE_BUCKET = "unios-selfies";

function getS3Client() {
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const region = Deno.env.get("AWS_REGION") || "ap-south-1";
  if (!accessKeyId || !secretAccessKey) return null;
  return new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
}

async function uploadSelfieBytes(bytes: Uint8Array, userId: string): Promise<string | null> {
  const s3 = getS3Client();
  if (!s3) return null;
  const region = Deno.env.get("AWS_REGION") || "ap-south-1";
  const key = `${userId}/punches/liveness-${Date.now()}.jpg`;
  await s3.send(new PutObjectCommand({
    Bucket: SELFIE_BUCKET,
    Key: key,
    Body: bytes,
    ContentType: "image/jpeg",
  }));
  return `https://${SELFIE_BUCKET}.s3.${region}.amazonaws.com/${key}`;
}

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
    const { action, session_id, user_id } = body;

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
      // AWS recommends 80 as the default liveness threshold for typical use cases.
      const isLive = confidence >= 80;

      // Identity check: the LIVE reference frame must match the registered employee.
      // Without this, anyone could pass liveness after a different person provided the pre-liveness selfie.
      let faceMatched: boolean | null = null;
      let matchSimilarity = 0;
      let matchReason = "";
      let matchedUserId = "";

      if (isLive && user_id) {
        const referenceBytes = res.ReferenceImage?.Bytes as Uint8Array | undefined;
        if (!referenceBytes) {
          faceMatched = false;
          matchReason = "AWS did not return a live reference image";
        } else {
          try {
            const searchRes = await client.send(new SearchFacesByImageCommand({
              CollectionId: COLLECTION_ID,
              Image: { Bytes: referenceBytes },
              FaceMatchThreshold: 70,
              MaxFaces: 1,
            }));
            const top = searchRes.FaceMatches?.[0];
            if (!top) {
              faceMatched = false;
              matchReason = "Live face not registered as any employee";
            } else {
              matchedUserId = top.Face?.ExternalImageId || "";
              matchSimilarity = Math.round(top.Similarity || 0);
              if (matchedUserId !== user_id) {
                faceMatched = false;
                matchReason = "Live face matches a different employee";
              } else if (matchSimilarity < 80) {
                faceMatched = false;
                matchReason = `Live face similarity too low (${matchSimilarity}%)`;
              } else {
                faceMatched = true;
                matchReason = `Live face verified (${matchSimilarity}%)`;
              }
            }
          } catch (matchErr: any) {
            if (matchErr.name === "InvalidParameterException") {
              faceMatched = false;
              matchReason = "No face detected in live reference image";
            } else {
              console.error("[liveness] face match error:", matchErr.message);
              faceMatched = false;
              matchReason = `Face match error: ${matchErr.message}`;
            }
          }
        }
      }

      const passed = isLive && (faceMatched === null ? true : faceMatched);

      // If the punch is verified, upload the live reference frame as the attendance selfie.
      // This replaces the pre-liveness selfie capture: we get the photo for free from AWS's
      // verified live frame, and there's no separate camera step on the client.
      let selfieUrl: string | null = null;
      if (passed && user_id && res.ReferenceImage?.Bytes) {
        try {
          selfieUrl = await uploadSelfieBytes(res.ReferenceImage.Bytes as Uint8Array, user_id);
        } catch (uploadErr: any) {
          console.error("[liveness] Selfie upload failed:", uploadErr.message);
        }
      }

      console.log(`[liveness] Session ${session_id}: confidence=${confidence}%, status=${res.Status}, live=${isLive}, faceMatched=${faceMatched}, similarity=${matchSimilarity}%, passed=${passed}, selfie=${selfieUrl ? 'uploaded' : 'none'}`);

      return json({
        session_id,
        confidence,
        status: res.Status,
        is_live: isLive,
        face_matched: faceMatched,
        match_similarity: matchSimilarity,
        match_reason: matchReason,
        matched_user_id: matchedUserId,
        passed,
        selfie_url: selfieUrl,
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
