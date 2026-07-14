/**
 * Shared Gemini passport / ID-photo background removal.
 * Used by student-photo workers and legacy upload paths.
 */

export const PASSPORT_PHOTO_GEMINI_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
  "gemini-2.0-flash-exp-image-generation",
] as const;

export const PASSPORT_PHOTO_PROMPT =
  "Create an official student ID/passport style photo from this image. " +
  "Remove the current background and replace it with a plain pure-white (#FFFFFF) background. " +
  "Correct exposure, white balance, shadows, and color cast so the image looks natural and evenly lit. " +
  "Preserve the student's real identity exactly: do not change facial features, face shape, age, skin tone, expression, hair, clothing, marks, or accessories. " +
  "Do not beautify, retouch the face, smooth skin, add makeup, change gaze, change hairstyle, add text, add borders, or add decorative elements. " +
  "Frame the student front-facing from bust level upward, with the head centered and eyes near the upper third. " +
  "Return only the regenerated image.";

export type PassportPhotoOk = { ok: true; mimeType: string; base64: string; model: string };
export type PassportPhotoFail = { ok: false; status: number; body: string; model: string };
export type PassportPhotoResult = PassportPhotoOk | PassportPhotoFail;

export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

export function base64ToBytes(base64: string): Uint8Array {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function extForMime(mimeType: string): "jpg" | "png" | "webp" {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

async function tryModel(
  model: string,
  apiKey: string,
  mimeType: string,
  base64: string,
): Promise<PassportPhotoResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: PASSPORT_PHOTO_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, status: response.status, body: body.slice(0, 400), model };
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part?.inline_data || part?.inlineData;
    if (inline?.data) {
      return {
        ok: true,
        mimeType: inline.mime_type || inline.mimeType || "image/png",
        base64: inline.data,
        model,
      };
    }
  }

  const finishReason = data?.candidates?.[0]?.finishReason;
  const text = parts.map((part: { text?: string }) => part?.text).filter(Boolean).join(" ").slice(0, 400);
  return {
    ok: false,
    status: 200,
    body: `No image part returned. finishReason=${finishReason}. ${text}`,
    model,
  };
}

/** Try configured Gemini image models until one returns an image. */
export async function processPassportPhoto(
  apiKey: string,
  mimeType: string,
  base64: string,
  models: readonly string[] = PASSPORT_PHOTO_GEMINI_MODELS,
): Promise<PassportPhotoResult & { attempts: Array<{ model: string; status: number; body: string }> }> {
  const attempts: Array<{ model: string; status: number; body: string }> = [];

  for (const model of models) {
    const result = await tryModel(model, apiKey, mimeType, base64);
    if (result.ok) {
      return { ...result, attempts };
    }
    attempts.push({ model: result.model, status: result.status, body: result.body });
    // Stop early on hard auth/quota errors; continue only for missing-model style 404s
    if (
      result.status !== 404 &&
      !result.body.toLowerCase().includes("not found") &&
      !result.body.toLowerCase().includes("does not exist")
    ) {
      break;
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    status: last?.status ?? 502,
    body: last?.body ?? "No models attempted",
    model: last?.model ?? "none",
    attempts,
  };
}
