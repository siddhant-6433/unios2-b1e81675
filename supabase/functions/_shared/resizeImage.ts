/**
 * Downscale + re-encode a display photo before storing it.
 *
 * Student profile photos are shown at <=320px everywhere (ID cards, avatars),
 * but the Gemini output we store is a ~1024px 1-2MB PNG. Serving that raw is
 * why the app was leaning on the metered Storage Image Transformation API.
 * Storing a small JPEG instead lets every screen serve the origin directly —
 * zero image-transform quota, ~20-40x less egress.
 *
 * ponytail: fixed 512px ceiling + JPEG. Bump MAX_DIM if print DPI ever needs more.
 */
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const MAX_DIM = 512; // longest side; 320px display source needs no more
const JPEG_QUALITY = 82; // faces stay clean, bytes stay tiny

export interface ResizedImage {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Returns a downscaled JPEG. On any decode/encode failure (e.g. an unsupported
 * format) the original bytes/mime are returned unchanged so uploads never break.
 */
export async function downscaleForDisplay(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ResizedImage> {
  try {
    const img = await Image.decode(bytes);
    const longest = Math.max(img.width, img.height);
    if (longest > MAX_DIM) {
      if (img.width >= img.height) img.resize(MAX_DIM, Image.RESIZE_AUTO);
      else img.resize(Image.RESIZE_AUTO, MAX_DIM);
    }
    const out = await img.encodeJPEG(JPEG_QUALITY);
    // Only keep it if we actually shrank the payload.
    if (out.byteLength < bytes.byteLength) {
      return { bytes: out, mimeType: "image/jpeg" };
    }
    return { bytes, mimeType };
  } catch (err) {
    console.warn("[resizeImage] downscale skipped:", err instanceof Error ? err.message : err);
    return { bytes, mimeType };
  }
}
