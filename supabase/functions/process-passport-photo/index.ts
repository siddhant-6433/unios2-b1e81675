// Passport-photo background remover.
//
// Calls Google Gemini's image-preview model with GEMINI_API_KEY to swap
// the background of an uploaded selfie for a clean white passport-photo
// background. Returns the regenerated image as a base64 data URL the
// client (PhotoUpload.tsx) re-uploads via apply-portal-upload-doc.
//
// On failure we bubble the actual Gemini status/body up to the client
// in `error` so the toast can surface what really went wrong instead of
// the generic "AI processing unavailable" fallback.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Try the current image model first, then fall back to the older one if
// the project's API key is provisioned for one but not the other. Both
// names have been in use during the past year of API releases.
const GEMINI_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-exp-image-generation",
];

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

type TryResult =
  | { ok: true; image: string; model: string }
  | { ok: false; status: number; body: string; model: string };

async function tryModel(model: string, apiKey: string, mimeType: string, base64: string): Promise<TryResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{
      role: "user",
      parts: [
        {
          text:
            "Create an official student ID/passport style photo from this image. " +
            "Remove the current background and replace it with a plain pure-white (#FFFFFF) background. " +
            "Correct exposure, white balance, shadows, and color cast so the image looks natural and evenly lit. " +
            "Preserve the student's real identity exactly: do not change facial features, face shape, age, skin tone, expression, hair, clothing, marks, or accessories. " +
            "Do not beautify, retouch the face, smooth skin, add makeup, change gaze, change hairstyle, add text, add borders, or add decorative elements. " +
            "Crop / frame as a formal passport photograph: bust level up, head centered, eyes near the upper third. " +
            "Return only the regenerated image.",
        },
        {
          inline_data: { mime_type: mimeType, data: base64 },
        },
      ],
    }],
    generationConfig: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`[process-passport-photo] ${model} → ${resp.status}: ${text.slice(0, 400)}`);
    return { ok: false, status: resp.status, body: text.slice(0, 400), model };
  }

  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part?.inline_data || part?.inlineData;
    if (inline?.data) {
      const mime = inline.mime_type || inline.mimeType || "image/png";
      return { ok: true, image: `data:${mime};base64,${inline.data}`, model };
    }
  }
  // No image part — could be a refusal. Log the textual response.
  const finishReason = data?.candidates?.[0]?.finishReason;
  const textParts = parts.map((p: any) => p?.text).filter(Boolean).join(" ").slice(0, 400);
  console.error(`[process-passport-photo] ${model} returned no image. finishReason=${finishReason} text="${textParts}"`);
  return {
    ok: false,
    status: 200,
    body: `No image part returned. finishReason=${finishReason}. ${textParts}`,
    model,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured", processedImage: null }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { image } = await req.json();
    if (!image || typeof image !== "string") {
      return new Response(
        JSON.stringify({ error: "image (data URL) is required", processedImage: null }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const parsed = parseDataUrl(image);
    if (!parsed) {
      return new Response(
        JSON.stringify({ error: "image must be a base64 data URL", processedImage: null }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const attempts: Array<{ model: string; status: number; body: string }> = [];
    for (const model of GEMINI_MODELS) {
      const res = await tryModel(model, apiKey, parsed.mimeType, parsed.base64);
      if (res.ok) {
        return new Response(
          JSON.stringify({ processedImage: res.image, model: res.model }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      attempts.push({ model: res.model, status: res.status, body: res.body });
      // Stop trying further models on quota / safety errors — they'll
      // hit the same wall. Only retry on 404 "model not found" type errors.
      if (res.status !== 404 && !res.body.toLowerCase().includes("not found") && !res.body.toLowerCase().includes("does not exist")) {
        break;
      }
    }

    const last = attempts[attempts.length - 1];
    return new Response(
      JSON.stringify({
        error: `Gemini call failed (${last.model}, ${last.status}): ${last.body}`,
        attempts,
        processedImage: null,
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[process-passport-photo] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", processedImage: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
