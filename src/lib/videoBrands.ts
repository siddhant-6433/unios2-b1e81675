// Shared brand & content-type labels for the video approval system.
// Keep enum keys aligned with public.video_brand / public.video_content_type.

export type VideoBrand =
  | "nimt_educational_institutions"
  | "nimt_beacon_school"
  | "mirai_experiential_school"
  | "seralis_lab";

export type VideoContentType = "video" | "post" | "repost" | "repost_with_edit";

export type VideoStatus = "pending_approval" | "approved" | "rejected" | "published";

export const VIDEO_BRANDS: { value: VideoBrand; label: string }[] = [
  { value: "nimt_educational_institutions", label: "NIMT Educational Institutions" },
  { value: "nimt_beacon_school",            label: "NIMT Beacon School" },
  { value: "mirai_experiential_school",     label: "Mirai Experiential School" },
  { value: "seralis_lab",                   label: "Seralis Lab" },
];

export const VIDEO_BRAND_LABEL: Record<VideoBrand, string> = Object.fromEntries(
  VIDEO_BRANDS.map(b => [b.value, b.label]),
) as Record<VideoBrand, string>;

export const CONTENT_TYPES: { value: VideoContentType; label: string }[] = [
  { value: "video",              label: "Video" },
  { value: "post",               label: "Post (image)" },
  { value: "repost",             label: "Repost" },
  { value: "repost_with_edit",   label: "Repost with edit" },
];

export const CONTENT_TYPE_LABEL: Record<VideoContentType, string> = Object.fromEntries(
  CONTENT_TYPES.map(c => [c.value, c.label]),
) as Record<VideoContentType, string>;

export const STATUS_BADGE: Record<VideoStatus, { label: string; color: string }> = {
  pending_approval: { label: "Pending Approval", color: "bg-amber-100 text-amber-700" },
  approved:         { label: "Approved",         color: "bg-blue-100 text-blue-700" },
  rejected:         { label: "Needs Correction", color: "bg-red-100 text-red-700" },
  published:        { label: "Published",        color: "bg-emerald-100 text-emerald-700" },
};
