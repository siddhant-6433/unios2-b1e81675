import { describe, expect, it } from "vitest";
import { avatarThumbUrl, idCardPhotoUrl, isSupabasePublicObjectUrl, storageImageUrl } from "@/lib/storageImage";

const SAMPLE =
  "https://deylhigsisuexszsmypq.supabase.co/storage/v1/object/public/student-profile-photos/abc/photo.png";

describe("storageImageUrl", () => {
  it("detects supabase public object urls", () => {
    expect(isSupabasePublicObjectUrl(SAMPLE)).toBe(true);
    expect(isSupabasePublicObjectUrl("https://cdn.example.com/a.png")).toBe(false);
  });

  it("rewrites to render/image with size params", () => {
    const out = storageImageUrl(SAMPLE, { width: 88, height: 88, resize: "cover", quality: 70 });
    expect(out).toContain("/storage/v1/render/image/public/student-profile-photos/abc/photo.png");
    expect(out).toContain("width=88");
    expect(out).toContain("height=88");
    expect(out).toContain("resize=cover");
    expect(out).toContain("quality=70");
    expect(out).not.toContain("/object/public/");
  });

  it("passes through non-supabase urls", () => {
    expect(storageImageUrl("https://cdn.example.com/a.png", { width: 40 })).toBe("https://cdn.example.com/a.png");
  });

  it("returns null for empty input", () => {
    expect(storageImageUrl(null, { width: 40 })).toBeNull();
    expect(storageImageUrl("", { width: 40 })).toBeNull();
  });

  it("builds list and id-card presets", () => {
    expect(avatarThumbUrl(SAMPLE)).toContain("width=96");
    expect(idCardPhotoUrl(SAMPLE)).toContain("width=320");
  });
});
