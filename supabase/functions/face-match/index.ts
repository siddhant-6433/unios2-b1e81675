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
    const { action, registered_image_url, registered_image_urls, punch_image_url, user_id } = body;

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
      const urls: string[] = registered_image_urls || (registered_image_url ? [registered_image_url] : []);
      if (urls.length === 0 || !user_id) {
        return jsonResponse({ error: "registered_image_url(s) and user_id required" }, 400);
      }

      await ensureCollection(client);

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

      let indexedCount = 0;
      let lastIndexed: any = null;

      for (const url of urls) {
        const imageBytes = await fetchImageBytes(url);
        const indexRes = await client.send(new IndexFacesCommand({
          CollectionId: COLLECTION_ID,
          Image: { Bytes: imageBytes },
          ExternalImageId: user_id,
          DetectionAttributes: ["ALL"],
          MaxFaces: 1,
          QualityFilter: "AUTO",
        }));

        const indexed = indexRes.FaceRecords?.[0];
        if (indexed) {
          indexedCount++;
          lastIndexed = indexed;
          console.log(`[face-match] Indexed face ${indexedCount} for ${user_id}, confidence: ${indexed.Face?.Confidence}`);
        } else {
          const reasons = indexRes.UnindexedFaces?.[0]?.Reasons?.join(", ") || "No face detected";
          console.warn(`[face-match] Failed to index face from URL ${url}: ${reasons}`);
        }
      }

      if (indexedCount === 0) {
        return jsonResponse({
          error: "Face registration failed: No face detected in any photo. Take clear, well-lit, front-facing photos.",
        }, 400);
      }

      return jsonResponse({
        success: true,
        indexed_count: indexedCount,
        total_photos: urls.length,
        face_id: lastIndexed?.Face?.FaceId,
        confidence: Math.round(lastIndexed?.Face?.Confidence || 0),
        quality: {
          brightness: Math.round(lastIndexed?.FaceDetail?.Quality?.Brightness || 0),
          sharpness: Math.round(lastIndexed?.FaceDetail?.Quality?.Sharpness || 0),
        },
      });
    }

    // ── Match face (punch verification) ──
    const { liveness_image_url, liveness_challenge } = body;
    const imageUrl = punch_image_url || registered_image_url;
    if (!imageUrl) {
      return jsonResponse({ error: "punch_image_url required" }, 400);
    }

    await ensureCollection(client);
    const punchBytes = await fetchImageBytes(imageUrl);

    let searchRes;
    try {
      searchRes = await client.send(new SearchFacesByImageCommand({
        CollectionId: COLLECTION_ID,
        Image: { Bytes: punchBytes },
        FaceMatchThreshold: 70,
        MaxFaces: 1,
      }));
    } catch (searchErr: any) {
      if (searchErr.name === "InvalidParameterException" || searchErr.message?.includes("no face")) {
        return jsonResponse({
          match: false,
          confidence: 0,
          reason: "No face detected in photo",
        });
      }
      throw searchErr;
    }

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
    const faceMatched = isCorrectUser && similarity >= 80;

    console.log(`[face-match] Match: ${similarity}% similarity, user: ${matchedUserId}, expected: ${user_id}`);

    // ── Liveness detection via Gemini ──
    if (faceMatched && liveness_image_url) {
      const livenessResult = await checkLiveness(imageUrl, liveness_image_url, liveness_challenge);
      console.log(`[face-match] Liveness: ${livenessResult.live ? 'PASS' : 'FAIL'} — ${livenessResult.reason}`);

      return jsonResponse({
        match: true,
        confidence: similarity,
        reason: `Face matched (${similarity}% similarity)`,
        matched_user_id: matchedUserId,
        liveness: livenessResult.live,
        liveness_reason: livenessResult.reason,
      });
    }

    return jsonResponse({
      match: faceMatched,
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

// ── Liveness detection via Gemini ──
async function checkLiveness(
  neutralUrl: string,
  challengeUrl: string,
  challenge?: string,
): Promise<{ live: boolean; reason: string }> {
  const googleApiKey = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!googleApiKey) {
    console.warn("[liveness] No Google AI key — skipping liveness check");
    return { live: true, reason: "Liveness check skipped (no API key)" };
  }

  try {
    const [neutralBytes, challengeBytes] = await Promise.all([
      fetchImageBytes(neutralUrl),
      fetchImageBytes(challengeUrl),
    ]);

    const toBase64 = (bytes: Uint8Array) => {
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.slice(i, i + 8192));
      }
      return btoa(binary);
    };

    const challengeDesc = challenge
      ? `The person was asked to "${challenge}" between the two photos.`
      : "The two photos were taken ~2 seconds apart.";

    const prompt = `You are an anti-spoofing liveness detector for a face-based attendance system. Analyze these two selfie photos taken ~2 seconds apart from a phone's front camera.

${challengeDesc}

Detect if this is a REAL LIVE person or a SPOOF ATTACK (photo of a photo, phone screen showing a face, printed photo, mask, video replay).

Check for these spoof indicators:
1. SCREEN ARTIFACTS: Moire patterns, pixel grid, screen bezels, reflections on glass, LCD color banding
2. PAPER/PRINT: Paper edges, flat texture, no depth, print dots, creases, glossy reflection
3. NO MOVEMENT: Both frames nearly identical (a real face always has micro-movements, slight pose shifts, lighting changes)
4. FLAT LIGHTING: Uniform illumination with no 3D depth cues, no natural shadows
5. BACKGROUND: Static/artificial background that doesn't match a real environment
6. CHALLENGE RESPONSE: If a challenge was given, did the face actually perform it? (e.g., smile, blink, turn head)

Respond ONLY in valid JSON:
{"live": true, "confidence": 92, "reason": "Real person - natural micro-movements detected, 3D depth present, challenge performed"}
or
{"live": false, "confidence": 85, "reason": "Photo of a screen - moire pattern visible, no micro-movements between frames"}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "image/jpeg", data: toBase64(neutralBytes) } },
              { inline_data: { mime_type: "image/jpeg", data: toBase64(challengeBytes) } },
            ],
          }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
        }),
      }
    );

    if (!res.ok) {
      console.error("[liveness] Gemini API error:", res.status);
      return { live: true, reason: "Liveness check unavailable" };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    try {
      const parsed = JSON.parse(cleaned);
      return {
        live: !!parsed.live,
        reason: parsed.reason || (parsed.live ? "Live person" : "Spoof detected"),
      };
    } catch {
      const isLive = text.toLowerCase().includes('"live": true') || text.toLowerCase().includes('"live":true');
      return { live: isLive, reason: isLive ? "Live person detected" : "Possible spoof detected" };
    }
  } catch (e: any) {
    console.error("[liveness] Error:", e.message);
    return { live: true, reason: "Liveness check error — allowed" };
  }
}

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
