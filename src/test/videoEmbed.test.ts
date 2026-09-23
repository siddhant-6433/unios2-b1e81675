import { describe, expect, it } from "vitest";
import { toVideoEmbedUrl, videoSourceLabel } from "@/lib/videoEmbed";

describe("toVideoEmbedUrl", () => {
  it("embeds a Google Drive file link as a preview", () => {
    expect(toVideoEmbedUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view?usp=sharing"))
      .toBe("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/preview");
  });

  it("embeds Drive open?id= and uc?id= forms", () => {
    expect(toVideoEmbedUrl("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQr"))
      .toBe("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/preview");
    expect(toVideoEmbedUrl("https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOpQr"))
      .toBe("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/preview");
  });

  it("embeds every YouTube URL shape", () => {
    expect(toVideoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(toVideoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(toVideoEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(toVideoEmbedUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("returns null for links it cannot embed, so callers fall back to a link", () => {
    expect(toVideoEmbedUrl("")).toBeNull();
    expect(toVideoEmbedUrl(null)).toBeNull();
    expect(toVideoEmbedUrl(undefined)).toBeNull();
    expect(toVideoEmbedUrl("https://drive.google.com/file/d/tooShort/view")).toBeNull();
    expect(toVideoEmbedUrl("https://example.com/some-video.mp4")).toBeNull();
    expect(toVideoEmbedUrl("not a url")).toBeNull();
  });
});

describe("videoSourceLabel", () => {
  it("labels the host correctly", () => {
    expect(videoSourceLabel("https://drive.google.com/file/d/abc/view")).toBe("Drive");
    expect(videoSourceLabel("https://youtu.be/abc")).toBe("YouTube");
    expect(videoSourceLabel("")).toBe("Drive");
  });
});
