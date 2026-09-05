import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  applySocialDateGuard,
  deriveVideoPublishState,
  igShortcode,
  linkedinActivityId,
  linkedinDate,
  postedAfterApproval,
  postingGuardMessage,
  postingGuardVerdict,
  ytVideoId,
} from "./videoPostingGuard";

const APPROVED_AT = "2026-09-05T05:30:00.000Z"; // 11:00 IST
const SAME_DAY_BEFORE = "2026-09-05T03:30:00.000Z"; // 09:00 IST
const SAME_DAY_AFTER = "2026-09-05T05:35:00.000Z"; // 11:05 IST
const GRAPH_TS_BEFORE = "2026-09-05T03:30:00+0000"; // Instagram Graph format
const VIDEO_ID = "vid-1";

function baseApply(over: Partial<Parameters<typeof applySocialDateGuard>[0]> = {}) {
  return applySocialDateGuard({
    videoId: VIDEO_ID,
    approvedAt: APPROVED_AT,
    instagramUrl: "https://www.instagram.com/reel/AbC123xyz/",
    youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    linkedinUrl: `https://www.linkedin.com/feed/update/urn:li:activity:${linkedinActivityId(Date.parse(SAME_DAY_AFTER))}/`,
    instagramPostedOn: null,
    youtubePostedOn: null,
    linkedinPostedOn: null,
    force: true,
    igTimestamp: null,
    igLookedUp: true,
    igListingComplete: true,
    ytTimestamp: null,
    ytLookedUp: true,
    ytListingComplete: true,
    ...over,
  });
}

describe("postedAfterApproval", () => {
  it("rejects a post timestamp before approval on the same calendar day", () => {
    expect(postedAfterApproval(SAME_DAY_BEFORE, APPROVED_AT)).toBe(false);
  });

  it("accepts a post timestamp after approval on the same calendar day", () => {
    expect(postedAfterApproval(SAME_DAY_AFTER, APPROVED_AT)).toBe(true);
  });

  it("accepts equal timestamps", () => {
    expect(postedAfterApproval(APPROVED_AT, APPROVED_AT)).toBe(true);
  });

  it("parses Instagram Graph API timestamps without a colon in the offset", () => {
    expect(postedAfterApproval(GRAPH_TS_BEFORE, APPROVED_AT)).toBe(false);
    expect(postedAfterApproval("2026-09-05T05:35:00+0000", APPROVED_AT)).toBe(true);
  });

  it("rejects missing posting or approval timestamps (draft / unpublished)", () => {
    expect(postedAfterApproval(null, APPROVED_AT)).toBe(false);
    expect(postedAfterApproval(SAME_DAY_AFTER, null)).toBe(false);
  });
});

describe("postingGuardVerdict / messages", () => {
  it("flags unpublished drafts separately from pre-approval posts", () => {
    expect(postingGuardVerdict(null, APPROVED_AT)).toEqual({ ok: false, reason: "not_published" });
    expect(postingGuardVerdict(SAME_DAY_BEFORE, APPROVED_AT)).toEqual({ ok: false, reason: "before_approval" });
    expect(postingGuardVerdict(SAME_DAY_AFTER, APPROVED_AT)).toEqual({ ok: true });
  });

  it("calls out Instagram draft / preview links", () => {
    const msg = postingGuardMessage("instagram", "not_published");
    expect(msg).toContain("Draft / preview");
    expect(msg).toContain("brand account");
  });

  it("includes both timestamps for a pre-approval post", () => {
    const msg = postingGuardMessage("instagram", "before_approval", SAME_DAY_BEFORE, APPROVED_AT);
    expect(msg).toContain("before this video was approved");
    expect(msg).toMatch(/went live at .+, but approval was at .+/);
  });
});

describe("Instagram draft / preview links", () => {
  it("strips a temporary share URL that is not a reel/p permalink", () => {
    const { patch, rejected } = baseApply({
      instagramUrl: "https://www.instagram.com/share/ABC_DRAFT_PREVIEW",
      igLookedUp: false,
      igListingComplete: false,
      ytLookedUp: false,
      linkedinUrl: null,
    });
    expect(patch.instagram_url).toBeNull();
    expect(patch.instagram_posted_on).toBeNull();
    expect(rejected).toEqual([
      expect.objectContaining({ platform: "instagram", reason: "not_published" }),
    ]);
  });

  it("strips a reel shortcode that is not on the brand's published media list", () => {
    const { patch, rejected } = baseApply({
      igTimestamp: null,
      igLookedUp: true,
      igListingComplete: true,
    });
    expect(patch.instagram_url).toBeNull();
    expect(rejected[0]).toMatchObject({ platform: "instagram", reason: "not_published" });
    expect(rejected[0].message).toContain("Draft / preview");
  });

  it("leaves the URL in place when Graph pagination did not finish (do not false-reject)", () => {
    const { patch, rejected } = baseApply({
      igTimestamp: null,
      igLookedUp: true,
      igListingComplete: false,
      ytLookedUp: false,
      linkedinUrl: null,
    });
    expect(patch.instagram_url).toBeUndefined();
    expect(rejected.filter(r => r.platform === "instagram")).toHaveLength(0);
  });
});

describe("same-day post before approval is rejected", () => {
  it("clears Instagram when Graph timestamp is 09:00 and approval is 11:00 IST", () => {
    const { patch, rejected } = baseApply({
      igTimestamp: GRAPH_TS_BEFORE,
      ytLookedUp: false,
      linkedinUrl: null,
    });
    expect(patch.instagram_url).toBeNull();
    expect(patch.instagram_posted_on).toBeNull();
    expect(rejected[0]).toMatchObject({ platform: "instagram", reason: "before_approval" });
  });

  it("clears YouTube when publishedAt is before approval", () => {
    const { patch, rejected } = baseApply({
      igLookedUp: false,
      ytTimestamp: SAME_DAY_BEFORE,
      linkedinUrl: null,
    });
    expect(patch.youtube_url).toBeNull();
    expect(rejected[0]).toMatchObject({ platform: "youtube", reason: "before_approval" });
  });

  it("clears LinkedIn when the activity id encodes a pre-approval time", () => {
    const url = `https://www.linkedin.com/posts/nimt_activity-${linkedinActivityId(Date.parse(SAME_DAY_BEFORE))}-share/`;
    expect(linkedinDate(url)).toBe(new Date(SAME_DAY_BEFORE).toISOString());
    const { patch, rejected } = baseApply({
      linkedinUrl: url,
      igLookedUp: false,
      ytLookedUp: false,
    });
    expect(patch.linkedin_url).toBeNull();
    expect(rejected[0]).toMatchObject({ platform: "linkedin", reason: "before_approval" });
  });
});

describe("live posts after approval are accepted", () => {
  it("keeps all three timestamps when each is after approved_at", () => {
    const { patch, rejected } = baseApply({
      igTimestamp: SAME_DAY_AFTER,
      ytTimestamp: SAME_DAY_AFTER,
    });
    expect(rejected).toEqual([]);
    expect(patch.instagram_posted_on).toBe(SAME_DAY_AFTER);
    expect(patch.youtube_posted_on).toBe(SAME_DAY_AFTER);
    expect(patch.linkedin_posted_on).toBe(new Date(SAME_DAY_AFTER).toISOString());
    expect(patch.instagram_url).toBeUndefined();
  });
});

describe("URL parsers", () => {
  it("reads reel, p, and tv Instagram shortcodes", () => {
    expect(igShortcode("https://www.instagram.com/reel/AbC123xyz/")).toBe("AbC123xyz");
    expect(igShortcode("https://www.instagram.com/p/AbC123xyz/?igsh=xyz")).toBe("AbC123xyz");
    expect(igShortcode("https://www.instagram.com/share/draft-preview")).toBeNull();
  });

  it("reads YouTube watch / shorts / youtu.be ids", () => {
    expect(ytVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(ytVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(ytVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("round-trips a LinkedIn activity timestamp", () => {
    const ms = Date.parse("2026-09-05T10:15:00.000Z");
    const url = `https://www.linkedin.com/feed/update/urn:li:activity:${linkedinActivityId(ms)}`;
    expect(Date.parse(linkedinDate(url)!)).toBe(ms);
  });
});

describe("deriveVideoPublishState (DB trigger mirror)", () => {
  const urls = {
    instagramUrl: "https://instagram.com/reel/aaa",
    linkedinUrl: "https://linkedin.com/x",
    youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
  };

  it("does not publish or bill a video that only has URLs (Instagram draft)", () => {
    const out = deriveVideoPublishState({
      status: "approved",
      approvedAt: APPROVED_AT,
      ...urls,
      instagramPostedOn: null,
      linkedinPostedOn: SAME_DAY_AFTER,
      youtubePostedOn: SAME_DAY_AFTER,
    });
    expect(out.status).toBe("approved");
    expect(out.isBillable).toBe(false);
    expect(out.postedMonth).toBeNull();
  });

  it("does not bill a same-day post that went live before approval", () => {
    const out = deriveVideoPublishState({
      status: "published",
      approvedAt: APPROVED_AT,
      ...urls,
      instagramPostedOn: SAME_DAY_BEFORE,
      linkedinPostedOn: SAME_DAY_AFTER,
      youtubePostedOn: SAME_DAY_AFTER,
    });
    expect(out.status).toBe("approved");
    expect(out.isBillable).toBe(false);
  });

  it("publishes and bills when every platform timestamp is at or after approval", () => {
    const out = deriveVideoPublishState({
      status: "approved",
      approvedAt: APPROVED_AT,
      ...urls,
      instagramPostedOn: SAME_DAY_AFTER,
      linkedinPostedOn: SAME_DAY_AFTER,
      youtubePostedOn: SAME_DAY_AFTER,
    });
    expect(out.status).toBe("published");
    expect(out.isBillable).toBe(true);
    expect(out.postedMonth).toBe("2026-09-01");
  });

  it("leaves pending_approval alone even if URLs are filled", () => {
    const out = deriveVideoPublishState({
      status: "pending_approval",
      approvedAt: null,
      ...urls,
      instagramPostedOn: SAME_DAY_AFTER,
      linkedinPostedOn: SAME_DAY_AFTER,
      youtubePostedOn: SAME_DAY_AFTER,
    });
    expect(out.status).toBe("pending_approval");
    expect(out.isBillable).toBe(false);
  });
});

describe("wired into fetch-post-dates and the migration", () => {
  const src = readFileSync("supabase/functions/video-fetch-post-dates/index.ts", "utf8");
  const portal = readFileSync("src/pages/VideoEditorPortal.tsx", "utf8");
  const file = readdirSync("supabase/migrations").find((f) =>
    f.endsWith("_video_post_after_approval.sql"),
  );

  it("edge function applies the shared guard after fetching platform dates", () => {
    expect(src).toContain("applySocialDateGuard");
    expect(src).toContain("approved_at");
  });

  it("editor portal surfaces rejected draft / pre-approval links", () => {
    expect(portal).toContain("Some links were rejected");
    expect(portal).toContain("Draft / preview Instagram links are not accepted");
  });

  it("migration requires platform timestamps at or after approved_at", () => {
    expect(file).toBeTruthy();
    const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
    expect(sql).toContain("all_after_approval");
    expect(sql).toContain("NEW.instagram_posted_on >= NEW.approved_at");
    expect(sql).toContain("AND all_after_approval");
  });
});
