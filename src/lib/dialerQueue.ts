export interface QueueLead {
  id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  course_id: string | null;
  course_name: string;
  campus_name: string;
  bucket: string; // bucket label in smart queue
  attempt_count: number;
  course_fee?: string;
  // Type of follow-up that placed this lead in the queue: call (default), whatsapp, email, visit.
  // Drives quick-action button next to the call bar for non-call follow-ups.
  followup_type?: "call" | "whatsapp" | "email" | "visit";
  followup_id?: string;
  // SLA fields — used to compute "will reclaim soon" badges. assigned_at +
  // source_sla_hours is when the cron will unassign this lead if first_contact_at
  // is still null.
  assigned_at?: string | null;
  first_contact_at?: string | null;
}

/**
 * Name / phone / course search over the dialer queue. Kept pure so the queue
 * pane can render the filtered list *and* an honest "x of y" count — the old
 * inline `return null` inside .map() left the counter reporting the unfiltered
 * length.
 */
export function filterQueue<T extends Pick<QueueLead, "name" | "phone" | "course_name">>(
  queue: T[],
  search: string,
): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return queue;
  return queue.filter(lead =>
    lead.name.toLowerCase().includes(q) ||
    lead.phone.includes(q) ||
    lead.course_name.toLowerCase().includes(q)
  );
}
