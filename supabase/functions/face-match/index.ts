import { RekognitionClient, CreateCollectionCommand, IndexFacesCommand, SearchFacesByImageCommand, DeleteFacesCommand, ListFacesCommand } from "npm:@aws-sdk/client-rekognition";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COLLECTION_ID = "unios-employee-faces";

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchImageBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith("file://") || url.startsWith("content://")) {
    throw new Error("Cannot fetch local file URI");
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function getRekognitionClient() {
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  const region = Deno.env.get("AWS_REGION") || "ap-south-1";

  if (!accessKeyId || !secretAccessKey) return null;

  return new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function ensureCollection(client: RekognitionClient) {
  try {
    await client.send(new CreateCollectionCommand({ CollectionId: COLLECTION_ID }));
  } catch (e: any) {
    if (!e.name?.includes("ResourceAlreadyExists")) throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const client = getRekognitionClient();
    const body = await req.json();
    const { action, registered_image_url, punch_image_url, user_id } = body;

    if (!client) {
      // Fallback to Gemini
      return handleGeminiFallback(body);
    }

    // ── Setup: create collection ──
    if (action === "setup") {
      await ensureCollection(client);
      return jsonResponse({ success: true, message: "Collection ready" });
    }

    // ── Register face ──
    if (action === "register") {
      if (!registered_image_url || !user_id) {
        return jsonResponse({ error: "registered_image_url and user_id required" }, 400);
      }

      await ensureCollection(client);
      const imageBytes = await fetchImageBytes(registered_image_url);

      // Delete existing faces for this user
      try {
        const listRes = await client.send(new ListFacesCommand({
          CollectionId: COLLECTION_ID, MaxResults: 100,
        }));
        const userFaceIds = (listRes.Faces || [])
          .filter(f => f.ExternalImageId === user_id)
          .map(f => f.FaceId!)
          .filter(Boolean);

        if (userFaceIds.length > 0) {
          await client.send(new DeleteFacesCommand({
            CollectionId: COLLECTION_ID, FaceIds: userFaceIds,
          }));
          console.log(`[face-match] Deleted ${userFaceIds.length} old faces for user ${user_id}`);
        }
      } catch (e) {
        console.warn("[face-match] Cleanup error:", e);
      }

      // Index the new face
      const indexRes = await client.send(new IndexFacesCommand({
        CollectionId: COLLECTION_ID,
        Image: { Bytes: imageBytes },
        ExternalImageId: user_id,
        DetectionAttributes: ["ALL"],
        MaxFaces: 1,
        QualityFilter: "AUTO",
      }));

      const indexed = indexRes.FaceRecords?.[0];
      if (!indexed) {
        const reasons = indexRes.UnindexedFaces?.[0]?.Reasons?.join(", ") || "No face detected";
        return jsonResponse({
          error: `Face registration failed: ${reasons}. Take a clear, well-lit, front-facing photo.`,
        }, 400);
      }

      console.log(`[face-match] Indexed face for ${user_id}, confidence: ${indexed.Face?.Confidence}`);

      return jsonResponse({
        success: true,
        face_id: indexed.Face?.FaceId,
        confidence: Math.round(indexed.Face?.Confidence || 0),
        quality: {
          brightness: Math.round(indexed.FaceDetail?.Quality?.Brightness || 0),
          sharpness: Math.round(indexed.FaceDetail?.Quality?.Sharpness || 0),
        },
      });
    }

    // ── Match face (punch verification) ──
    const imageUrl = punch_image_url || registered_image_url;
    if (!imageUrl) {
      return jsonResponse({ error: "punch_image_url required" }, 400);
    }

    await ensureCollection(client);
    const punchBytes = await fetchImageBytes(imageUrl);

    const searchRes = await client.send(new SearchFacesByImageCommand({
      CollectionId: COLLECTION_ID,
      Image: { Bytes: punchBytes },
      FaceMatchThreshold: 70,
      MaxFaces: 1,
    }));

    const topMatch = searchRes.FaceMatches?.[0];

    if (!topMatch) {
      return jsonResponse({
        match: false,
        confidence: 0,
        reason: "No matching face found among registered employees",
      });
    }

    const matchedUserId = topMatch.Face?.ExternalImageId || "";
    const similarity = Math.round(topMatch.Similarity || 0);
    const isCorrectUser = !user_id || matchedUserId === user_id;

    console.log(`[face-match] Match: ${similarity}% similarity, user: ${matchedUserId}, expected: ${user_id}`);

    return jsonResponse({
      match: isCorrectUser && similarity >= 80,
      confidence: similarity,
      reason: isCorrectUser
        ? `Face matched (${similarity}% similarity)`
        : `Warning: matched different employee`,
      matched_user_id: matchedUserId,
    });

  } catch (err: any) {
    console.error("[face-match] Error:", err.message || err);
    return jsonResponse({ error: err.message || "Face matching failed" }, 500);
  }
});

// ── Gemini fallback ──
async function handleGeminiFallback(body: any) {
  const googleApiKey = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!googleApiKey) {
    return jsonResponse({ error: "Neither AWS nor Google AI configured" }, 503);
  }

  const { registered_image_url, punch_image_url } = body;
  if (!registered_image_url || !punch_image_url) {
    return jsonResponse({ error: "Both image URLs required for Gemini fallback" }, 400);
  }

  const [regBytes, punchBytes] = await Promise.all([
    fetchImageBytes(registered_image_url),
    fetchImageBytes(punch_image_url),
  ]);

  const toBase64 = (bytes: Uint8Array) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.slice(i, i + 8192));
    }
    return btoa(binary);
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Compare faces. Same person? Reply ONLY valid JSON: {"match":true,"confidence":85,"reason":"same person"}' },
            { inline_data: { mime_type: "image/jpeg", data: toBase64(regBytes) } },
            { inline_data: { mime_type: "image/jpeg", data: toBase64(punchBytes) } },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 100 },
      }),
    }
  );

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  try {
    return jsonResponse(JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()));
  } catch {
    const isMatch = text.toLowerCase().includes('"match":true') || text.toLowerCase().includes('"match": true');
    return jsonResponse({ match: isMatch, confidence: isMatch ? 75 : 20, reason: isMatch ? "Same person" : "Different" });
  }
}
