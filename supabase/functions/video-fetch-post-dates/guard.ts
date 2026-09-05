// Pure posting-date guards. Used by video-fetch-post-dates and by unit tests.
// Keep this file free of Deno / npm imports so vitest can load it directly.

export type PostingGuardReason = "before_approval" | "not_published";

export type PostingGuardVerdict =
  | { ok: true }
  | { ok: false; reason: PostingGuardReason };

export type Rejection = {
  video_id: string;
  platform: string;
  reason: PostingGuardReason;
  message: string;
  posted_on?: string | null;
  approved_at?: string | null;
};

export function igShortcode(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function ytVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:v=|\/shorts\/|\/embed\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** LinkedIn post time from the activity id in the URL (id >> 22 = Unix ms). */
export function linkedinDate(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/activity[:-](\d{6,})/);
  if (!m) return null;
  try {
    const d = new Date(Number(BigInt(m[1]) >> 22n));
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/** Encode a Unix-ms timestamp as a LinkedIn activity id (inverse of linkedinDate). */
export function linkedinActivityId(unixMs: number): string {
  return String(BigInt(unixMs) << 22n);
}

export function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** True when the platform post went live at or after approval. */
export function postedAfterApproval(
  postedOn: string | null | undefined,
  approvedAt: string | null | undefined,
): boolean {
  const postedMs = parseTimestamp(postedOn);
  const approvedMs = parseTimestamp(approvedAt);
  if (postedMs == null || approvedMs == null) return false;
  return postedMs >= approvedMs;
}

export function postingGuardVerdict(
  postedOn: string | null | undefined,
  approvedAt: string | null | undefined,
): PostingGuardVerdict {
  if (!postedOn) return { ok: false, reason: "not_published" };
  if (!postedAfterApproval(postedOn, approvedAt)) {
    return { ok: false, reason: "before_approval" };
  }
  return { ok: true };
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
};

function fmtIst(iso: string | null | undefined): string {
  const ms = parseTimestamp(iso);
  if (ms == null) return "";
  return new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function postingGuardMessage(
  platform: string,
  reason: PostingGuardReason,
  postedOn?: string | null,
  approvedAt?: string | null,
): string {
  const label = PLATFORM_LABEL[platform] ?? platform;
  if (reason === "not_published") {
    if (platform === "instagram") {
      return `${label} link is not a live post on the brand account. Draft / preview links are not accepted — publish the reel, then paste the public URL.`;
    }
    return `${label} link is not a live published post. Paste the public URL after it goes live.`;
  }
  const posted = fmtIst(postedOn);
  const approved = fmtIst(approvedAt);
  const when = posted && approved
    ? ` It went live at ${posted}, but approval was at ${approved}.`
    : "";
  return `${label} post went live before this video was approved.${when} Post it after approval and paste the live link.`;
}

export type ApplyGuardInput = {
  videoId: string;
  approvedAt: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  linkedinUrl: string | null;
  instagramPostedOn: string | null;
  youtubePostedOn: string | null;
  linkedinPostedOn: string | null;
  force: boolean;
  /** Graph timestamp for this video's shortcode, if the published-media list found it. */
  igTimestamp: string | null;
  /** We attempted a Graph lookup for this video (brand mapped, shortcode present). */
  igLookedUp: boolean;
  /** Published-media listing finished without API errors. */
  igListingComplete: boolean;
  ytTimestamp: string | null;
  ytLookedUp: boolean;
  ytListingComplete: boolean;
};

export type ApplyGuardResult = {
  patch: Record<string, string | null>;
  rejected: Rejection[];
};

function pushReject(
  rejected: Rejection[],
  videoId: string,
  approvedAt: string | null,
  platform: string,
  reason: PostingGuardReason,
  postedOn?: string | null,
) {
  rejected.push({
    video_id: videoId,
    platform,
    reason,
    message: postingGuardMessage(platform, reason, postedOn, approvedAt),
    posted_on: postedOn ?? null,
    approved_at: approvedAt,
  });
}

/**
 * Decide the videos-row patch after platform timestamps have been fetched.
 * Draft / unparseable Instagram links and any timestamp before approved_at
 * are cleared so they cannot stay attached as published.
 */
export function applySocialDateGuard(input: ApplyGuardInput): ApplyGuardResult {
  const patch: Record<string, string | null> = {};
  const rejected: Rejection[] = [];
  const {
    videoId, approvedAt, force,
    instagramUrl, youtubeUrl, linkedinUrl,
    instagramPostedOn, youtubePostedOn, linkedinPostedOn,
  } = input;

  if (instagramUrl && (force || !instagramPostedOn) && !igShortcode(instagramUrl)) {
    patch.instagram_url = null;
    patch.instagram_posted_on = null;
    pushReject(rejected, videoId, approvedAt, "instagram", "not_published");
  } else if (input.igLookedUp) {
    const ts = input.igTimestamp;
    if (ts) {
      if (!postedAfterApproval(ts, approvedAt)) {
        patch.instagram_url = null;
        patch.instagram_posted_on = null;
        pushReject(rejected, videoId, approvedAt, "instagram", "before_approval", ts);
      } else {
        patch.instagram_posted_on = ts;
      }
    } else if (input.igListingComplete) {
      patch.instagram_url = null;
      patch.instagram_posted_on = null;
      pushReject(rejected, videoId, approvedAt, "instagram", "not_published");
    }
  }

  if (input.ytLookedUp) {
    const ts = input.ytTimestamp;
    if (ts) {
      if (!postedAfterApproval(ts, approvedAt)) {
        patch.youtube_url = null;
        patch.youtube_posted_on = null;
        pushReject(rejected, videoId, approvedAt, "youtube", "before_approval", ts);
      } else {
        patch.youtube_posted_on = ts;
      }
    } else if (input.ytListingComplete) {
      patch.youtube_url = null;
      patch.youtube_posted_on = null;
      pushReject(rejected, videoId, approvedAt, "youtube", "not_published");
    }
  }

  if (force || !linkedinPostedOn) {
    const ts = linkedinDate(linkedinUrl);
    if (ts) {
      if (!postedAfterApproval(ts, approvedAt)) {
        patch.linkedin_url = null;
        patch.linkedin_posted_on = null;
        pushReject(rejected, videoId, approvedAt, "linkedin", "before_approval", ts);
      } else {
        patch.linkedin_posted_on = ts;
      }
    }
  }

  return { patch, rejected };
}

export type VideoStatus = "pending_approval" | "approved" | "rejected" | "published";

function present(url: string | null | undefined): boolean {
  return url != null && url !== "";
}

/**
 * Mirrors videos_before_change derived columns: published + billable only when
 * all three live timestamps exist and each is >= approved_at.
 */
export function deriveVideoPublishState(row: {
  status: VideoStatus;
  approvedAt: string | null;
  instagramUrl: string | null;
  linkedinUrl: string | null;
  youtubeUrl: string | null;
  instagramPostedOn: string | null;
  linkedinPostedOn: string | null;
  youtubePostedOn: string | null;
}): { status: VideoStatus; isBillable: boolean; postedMonth: string | null } {
  const allUrls = present(row.instagramUrl) && present(row.linkedinUrl) && present(row.youtubeUrl);
  const allPosted = !!(row.instagramPostedOn && row.linkedinPostedOn && row.youtubePostedOn);
  const allAfterApproval = !!(
    row.approvedAt
    && allPosted
    && postedAfterApproval(row.instagramPostedOn, row.approvedAt)
    && postedAfterApproval(row.linkedinPostedOn, row.approvedAt)
    && postedAfterApproval(row.youtubePostedOn, row.approvedAt)
  );

  let status = row.status;
  if (status === "approved" || status === "published") {
    status = allUrls && allAfterApproval ? "published" : "approved";
  }

  const isBillable = (status === "approved" || status === "published") && allUrls && allAfterApproval;

  let postedMonth: string | null = null;
  if (isBillable) {
    const least = Math.min(
      parseTimestamp(row.instagramPostedOn)!,
      parseTimestamp(row.linkedinPostedOn)!,
      parseTimestamp(row.youtubePostedOn)!,
    );
    const d = new Date(least);
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    postedMonth = `${d.getUTCFullYear()}-${m}-01`;
  }

  return { status, isBillable, postedMonth };
}
