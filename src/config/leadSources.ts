/** Single source of truth for all lead sources.
 *  When adding a new source, update this file AND run:
 *  ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'new_source';
 */
export const LEAD_SOURCES = [
  { value: "website", label: "Website" },
  { value: "meta_ads", label: "Meta Ads" },
  { value: "google_ads", label: "Google Ads" },
  { value: "shiksha", label: "Shiksha" },
  { value: "collegedunia", label: "Collegedunia" },
  { value: "collegehai", label: "CollegeHai" },
  { value: "walk_in", label: "Walk-in" },
  { value: "consultant", label: "Consultant" },
  { value: "justdial", label: "JustDial" },
  { value: "referral", label: "Referral" },
  { value: "education_fair", label: "Education Fair" },
  { value: "other", label: "Other" },
] as const;

export const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  LEAD_SOURCES.map((s) => [s.value, s.label])
);

export const SOURCE_BADGE_COLORS: Record<string, string> = {
  website: "bg-pastel-blue", meta_ads: "bg-pastel-purple", google_ads: "bg-pastel-green",
  shiksha: "bg-pastel-orange", collegedunia: "bg-pastel-mint", collegehai: "bg-pastel-teal",
  walk_in: "bg-pastel-yellow", consultant: "bg-pastel-pink",
  justdial: "bg-pastel-mint", referral: "bg-pastel-red",
  education_fair: "bg-pastel-purple", other: "bg-muted",
};
