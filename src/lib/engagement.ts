// Engagement & Helpdesk — types and pure helpers.
//
// Kept free of Supabase on purpose: the panels that render these run against
// `announcements`, `helpdesk_tickets`, `helpdesk_ticket_messages`,
// `announcement_reads` and `recognitions`, none of which are in generated
// types.ts yet, so the panels cast the reads. The decisions that actually need
// to be right — is an announcement live, who can see it, how do we order them,
// how do we colour a ticket — live here where they can be unit-tested without a
// database.

export type TicketCategory =
  | "general"
  | "payroll"
  | "attendance"
  | "leave"
  | "documents"
  | "it"
  | "facilities"
  | "grievance";

export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export const TICKET_CATEGORIES: readonly { value: TicketCategory; label: string }[] = [
  { value: "general", label: "General" },
  { value: "payroll", label: "Payroll" },
  { value: "attendance", label: "Attendance" },
  { value: "leave", label: "Leave" },
  { value: "documents", label: "Documents" },
  { value: "it", label: "IT" },
  { value: "facilities", label: "Facilities" },
  { value: "grievance", label: "Grievance" },
];

export const TICKET_PRIORITIES: readonly TicketPriority[] = ["low", "normal", "high", "urgent"];
export const TICKET_STATUSES: readonly TicketStatus[] = ["open", "in_progress", "resolved", "closed"];

/** Recognition value tags offered to employees when praising a colleague. */
export const RECOGNITION_VALUES: readonly { value: string; label: string }[] = [
  { value: "teamwork", label: "Teamwork" },
  { value: "ownership", label: "Ownership" },
  { value: "customer_first", label: "Student / Customer first" },
  { value: "innovation", label: "Innovation" },
  { value: "integrity", label: "Integrity" },
  { value: "above_and_beyond", label: "Above & beyond" },
];

export interface Announcement {
  id: string;
  title: string;
  body: string;
  /** null (or empty) means everyone; otherwise only these app_roles see it. */
  audience_roles: string[] | null;
  institution_id: string | null;
  campus_id: string | null;
  is_pinned: boolean;
  /** null = draft. A future value = scheduled, also treated as not-yet-live. */
  published_at: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at?: string;
}

export interface HelpdeskTicket {
  id: string;
  ticket_no: string | null;
  employee_profile_id: string | null;
  submitted_by: string | null;
  category: string;
  subject: string;
  description: string | null;
  priority: string;
  status: string;
  assigned_to: string | null;
  assigned_to_name?: string | null;
  employee_name?: string | null;
  message_count?: number | null;
  created_at: string;
  resolved_at?: string | null;
}

export interface HelpdeskMessage {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_name?: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface Recognition {
  id: string;
  from_user_id: string;
  to_employee_profile_id: string;
  message: string;
  value_tag: string | null;
  is_public: boolean;
  created_at: string;
}

export interface BadgeDescriptor {
  label: string;
  /** Tailwind classes matching the pastel badge idiom used across the HR module. */
  className: string;
}

/**
 * Higher rank = more urgent. Given a list, sort with `priorityRank(b) -
 * priorityRank(a)` for the triage view. Unknown values rank below "low" so they
 * sink to the bottom rather than masquerading as low priority.
 */
export const PRIORITY_RANK: Record<TicketPriority, number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
};

export function priorityRank(priority: string | null | undefined): number {
  if (!priority) return -1;
  return PRIORITY_RANK[priority as TicketPriority] ?? -1;
}

const TICKET_STATUS_BADGES: Record<TicketStatus, BadgeDescriptor> = {
  open: { label: "Open", className: "bg-pastel-blue text-foreground/80" },
  in_progress: { label: "In progress", className: "bg-pastel-yellow text-foreground/80" },
  resolved: { label: "Resolved", className: "bg-pastel-green text-foreground/80" },
  closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
};

const TICKET_PRIORITY_BADGES: Record<TicketPriority, BadgeDescriptor> = {
  low: { label: "Low", className: "bg-muted text-muted-foreground" },
  normal: { label: "Normal", className: "bg-pastel-blue text-foreground/80" },
  high: { label: "High", className: "bg-pastel-orange text-foreground/80" },
  urgent: { label: "Urgent", className: "bg-pastel-red text-foreground/80" },
};

/** Presentational descriptor for a ticket status — label + badge classes. */
export function ticketStatusBadge(status: string | null | undefined): BadgeDescriptor {
  if (status && status in TICKET_STATUS_BADGES) {
    return TICKET_STATUS_BADGES[status as TicketStatus];
  }
  return { label: status ? status.replace(/_/g, " ") : "Unknown", className: "bg-muted text-muted-foreground" };
}

/** Presentational descriptor for a ticket priority — label + badge classes. */
export function ticketPriorityBadge(priority: string | null | undefined): BadgeDescriptor {
  if (priority && priority in TICKET_PRIORITY_BADGES) {
    return TICKET_PRIORITY_BADGES[priority as TicketPriority];
  }
  return { label: priority || "—", className: "bg-muted text-muted-foreground" };
}

function toMillis(value: Date | number | string): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * An announcement is live when it has been published, and either never expires
 * or expires strictly in the future. Drafts (published_at null) and scheduled
 * announcements (published_at in the future) are not live.
 */
export function announcementIsLive(
  announcement: Pick<Announcement, "published_at" | "expires_at">,
  now: Date | number | string = new Date(),
): boolean {
  if (!announcement.published_at) return false;
  const at = toMillis(now);
  const published = Date.parse(announcement.published_at);
  if (!Number.isFinite(published) || published > at) return false;
  if (announcement.expires_at) {
    const expires = Date.parse(announcement.expires_at);
    // An unparseable expiry must not silently hide a live announcement.
    if (Number.isFinite(expires) && expires <= at) return false;
  }
  return true;
}

/**
 * Can this viewer see the announcement? A null/empty audience is broadcast to
 * everyone; otherwise the viewer's role must be listed.
 */
export function announcementVisibleTo(
  announcement: Pick<Announcement, "audience_roles">,
  role: string | null | undefined,
): boolean {
  const roles = announcement.audience_roles;
  if (!roles || roles.length === 0) return true;
  if (!role) return false;
  return roles.includes(role);
}

/**
 * Lifecycle bucket for the HR list: live first, then work-in-progress drafts,
 * then scheduled, then the expired graveyard — so actionable items never sit
 * beneath a wall of dead ones.
 */
export function announcementLifecycleRank(
  announcement: Pick<Announcement, "published_at" | "expires_at">,
  now: Date | number | string = new Date(),
): number {
  if (announcementIsLive(announcement, now)) return 0;
  if (!announcement.published_at) return 1;
  if (Date.parse(announcement.published_at) > toMillis(now)) return 2;
  return 3;
}

/**
 * Pinned first, then by lifecycle (live → draft → scheduled → expired), then
 * newest first. Non-mutating — the caller's array is left alone.
 */
export function sortAnnouncements<T extends Announcement>(
  list: readonly T[],
  now: Date | number | string = new Date(),
): T[] {
  return [...list].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;

    const aRank = announcementLifecycleRank(a, now);
    const bRank = announcementLifecycleRank(b, now);
    if (aRank !== bRank) return aRank - bRank;

    const aTime = Date.parse(a.published_at ?? a.created_at) || 0;
    const bTime = Date.parse(b.published_at ?? b.created_at) || 0;
    return bTime - aTime;
  });
}
