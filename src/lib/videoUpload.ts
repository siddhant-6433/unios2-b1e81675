import { supabase } from "@/integrations/supabase/client";

// Upload images to the public application-documents bucket under a namespaced
// prefix and return their public URLs. Throws on the first failed upload.
// Shared by correction screenshots, submission thumbnails, and comment images.
export async function uploadVideoImages(prefix: string, videoId: string, files: File[]): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) {
    const ext = f.name.split(".").pop() || "jpg";
    const path = `${prefix}/${videoId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
      .from("application-documents")
      .upload(path, f, { contentType: f.type, upsert: false });
    if (error) throw error;
    urls.push(supabase.storage.from("application-documents").getPublicUrl(path).data.publicUrl);
  }
  return urls;
}

// ponytail: client-only dimension check; good enough to stop wrong-orientation
// uploads. Resolves true when the image's width/height ratio is within `tol`
// of ratioW/ratioH. Returns true (skip) if the image can't be measured.
export function checkAspectRatio(file: File, ratioW: number, ratioH: number, tol = 0.06): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.width || !img.height) { resolve(true); return; }
      const target = ratioW / ratioH;
      const actual = img.width / img.height;
      resolve(Math.abs(actual - target) / target <= tol);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(true); };
    img.src = url;
  });
}
