import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inbox = readFileSync("src/pages/Inbox.tsx", "utf8");
const approvalsPage = readFileSync("src/pages/VideoApprovals.tsx", "utf8");
const panel = readFileSync("src/components/video/VideoReviewPanel.tsx", "utf8");
const embed = readFileSync("src/components/video/VideoEmbed.tsx", "utf8");

/**
 * The video review experience (inline embed, history, corrections) lives in one
 * component so the Inbox and the Video Approvals page can't drift apart.
 */
describe("Video review is shared between Inbox and the Video Approvals page", () => {
  it("renders the shared panel on both surfaces", () => {
    expect(inbox).toContain("VideoReviewPanel");
    expect(inbox).toContain('onDone={() => { loadItems("video_approvals"); fetchCounts(); }}');
    expect(approvalsPage).toContain("VideoReviewPanel");
    expect(approvalsPage).toContain("onDone={() => { setSelected(null); fetchAll(); }}");
  });

  it("keeps one implementation of the approval actions, not a second in the Inbox", () => {
    expect(panel).toContain('from("videos" as any).update');
    expect(panel).toContain('supabase.functions');
    expect(panel).toContain('event, video_id: video.id');
    // The old Inbox-local approve/reject is gone.
    expect(inbox).not.toContain("const decideVideo");
  });

  it("shows the video inline rather than only an external link", () => {
    expect(panel).toContain("<VideoEmbed");
    expect(embed).toContain("<iframe");
    expect(embed).toContain("toVideoEmbedUrl(url)");
  });

  it("sends the full video row to the Inbox panel", () => {
    expect(inbox).toContain("video: v as VideoRow");
    expect(inbox).toContain("video={v.video}");
  });
});
