/**
 * Resize Supabase Storage public object URLs via the Image Transformation API.
 * Full-size student photos are often 1–2MB PNGs; list avatars only need ~12KB thumbs.
 *
 * Input:  …/storage/v1/object/public/<bucket>/<path>
 * Output: …/storage/v1/render/image/public/<bucket>/<path>?width=&height=&resize=cover
 */

export type StorageImageResize = "cover" | "contain" | "fill";

export interface StorageImageOptions {
  width: number;
  height?: number;
  /** Default cover — crops to fill the box. */
  resize?: StorageImageResize;
  quality?: number;
}

const OBJECT_PUBLIC_RE = /\/storage\/v1\/object\/public\//i;

export function isSupabasePublicObjectUrl(url: string): boolean {
  return OBJECT_PUBLIC_RE.test(url);
}

/** Map a public object URL to a transformed image URL. Non-Supabase URLs pass through. */
export function storageImageUrl(
  url: string | null | undefined,
  options: StorageImageOptions,
): string | null {
  if (!url) return null;
  if (!isSupabasePublicObjectUrl(url)) return url;

  try {
    const parsed = new URL(url);
    // Swap object/public → render/image/public (preserve bucket + path + query noise)
    parsed.pathname = parsed.pathname.replace(
      /\/storage\/v1\/object\/public\//i,
      "/storage/v1/render/image/public/",
    );
    parsed.searchParams.set("width", String(Math.max(1, Math.round(options.width))));
    if (options.height != null) {
      parsed.searchParams.set("height", String(Math.max(1, Math.round(options.height))));
    }
    parsed.searchParams.set("resize", options.resize ?? "cover");
    if (options.quality != null) {
      parsed.searchParams.set("quality", String(options.quality));
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/** List-row avatars (h-11 / ~44px CSS → 2× retina). */
export function avatarThumbUrl(url: string | null | undefined): string | null {
  return storageImageUrl(url, { width: 96, height: 96, resize: "cover", quality: 70 });
}

/** Print / ID card face photo (~80–100mm display → roomy 2×). */
export function idCardPhotoUrl(url: string | null | undefined): string | null {
  return storageImageUrl(url, { width: 320, height: 320, resize: "cover", quality: 80 });
}
