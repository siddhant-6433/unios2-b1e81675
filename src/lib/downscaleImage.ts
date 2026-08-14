// Downscale an image in the browser before uploading it.
//
// Deliberately NOT done with Supabase image transformations: that quota is
// metered (100 per billing cycle) and blowing through it once put the whole
// project under a spend-cap restriction that looked like an unhealthy database.
// Shrinking on the way in costs nothing and the original is never needed —
// these are 40px avatars and 200px profile headers.

export interface DownscaleOptions {
  /** Longest edge of the output, in pixels. */
  maxEdge?: number;
  quality?: number;
  type?: "image/jpeg" | "image/webp";
}

export async function downscaleImage(
  file: File | Blob,
  { maxEdge = 800, quality = 0.85, type = "image/jpeg" }: DownscaleOptions = {},
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read the image — your browser blocked canvas access.");
    // JPEG has no alpha; without this, transparent PNGs come out with black edges.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image conversion failed."))),
        type,
        quality,
      );
    });
  } finally {
    bitmap.close();
  }
}
