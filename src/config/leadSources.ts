/** Single source of truth for all lead sources.
 *  When adding a new source, update this file AND run:
 *  ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'new_source';
 */
export const LEAD_SOURCES = [
  { value: "website", label: "Website" },
  { value: "mirai_website", label: "Website (miraischool.in)" },
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
  website: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  mirai_website: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  meta_ads: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
  google_ads: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  shiksha: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  collegedunia: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  collegehai: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  walk_in: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
  consultant: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200",
  justdial: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  referral: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  education_fair: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  other: "bg-muted text-muted-foreground",
};
