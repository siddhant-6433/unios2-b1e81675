import type { DirectoryListRow } from "./directoryCommunicationLists";

/**
 * WhatsApp (and email) campaign recipient eligibility.
 * DNC is always hard-excluded — stage "dnc" means stop all further outreach.
 * Optional quality filters reduce Meta blocks/reports (cold lists, recent blast fatigue).
 */

export type CampaignLeadLike = {
  id: string;
  name?: string | null;
  directoryKind?: string;
  phone?: string | null;
  email?: string | null;
  stage?: string | null;
  /** Academic-partner private leads (false) are never eligible for NIMT campaigns. */
  shared_with_nimt?: boolean | null;
};

export type CampaignEligibilityOptions = {
  /** Channel used to decide required contact field. */
  channel: "whatsapp" | "email";
  /** Skip leads messaged with a template/campaign within this many days. 0 = off. */
  quietDays?: number;
  /** Map lead_id → ISO last outbound marketing/template contact. */
  lastMarketingAtByLeadId?: Map<string, string> | Record<string, string>;
  /** Exclude stage "cold" (low-engagement CRM segment). Default true for quality. */
  excludeCold?: boolean;
  /** Extra terminal stages to skip (beyond hard DNC). */
  extraExcludeStages?: string[];
  /** Reference "now" for quiet-period math (tests). */
  now?: Date;
};

export type CampaignSkipReason =
  | "dnc"
  | "not_shared"
  | "no_phone"
  | "no_email"
  | "cold"
  | "recent_contact"
  | "excluded_stage"
  | "duplicate";

export type CampaignEligibilityResult<T extends CampaignLeadLike> = {
  eligible: T[];
  skipped: Array<{ lead: T; reason: CampaignSkipReason }>;
  counts: {
    total: number;
    eligible: number;
    dnc: number;
    notShared: number;
    noContact: number;
    cold: number;
    recentContact: number;
    excludedStage: number;
    duplicate: number;
  };
  /** One-line UI summary. */
  preview: string;
};

/** Hard block — never message these stages in bulk or 1:1 marketing. */
export const HARD_EXCLUDE_STAGES = new Set(["dnc"]);

/** Default quality exclusions for bulk campaigns. */
export const DEFAULT_QUALITY_EXCLUDE_STAGES = new Set(["cold"]);

export const DEFAULT_QUIET_DAYS = 3;

function normalizeStage(stage: string | null | undefined): string {
  return String(stage || "").trim().toLowerCase();
}

function hasPhone(lead: CampaignLeadLike): boolean {
  if (lead.directoryKind) return /^\+?[\d\s().-]+$/.test(String(lead.phone || "")) && /^[1-9]\d{7,14}$/.test(String(lead.phone || "").replace(/\D/g, ""));
  return Boolean(lead.phone && String(lead.phone).replace(/\D/g, "").length >= 8);
}

function hasEmail(lead: CampaignLeadLike): boolean {
  if (lead.directoryKind) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(lead.email || "").trim());
  const email = String(lead.email || "").trim();
  return email.includes("@") && email.length > 3;
}

function lastContactMap(
  input?: Map<string, string> | Record<string, string>,
): Map<string, string> {
  if (!input) return new Map();
  if (input instanceof Map) return input;
  return new Map(Object.entries(input));
}

/** A polymorphic `lead_list_members` row with its embeds. */
export type CampaignListMember = {
  directory_recipient?: DirectoryListRow;
  lead_id?: string | null;
  contact_id?: string | null;
  leads?: (CampaignLeadLike & Record<string, unknown>) | null;
  marketing_contacts?: {
    id?: string | null;
    phone?: string | null;
    email?: string | null;
    opted_out?: boolean | null;
    promoted_lead_id?: string | null;
  } | null;
};

/** Marketing-contact-backed members carry this so callers write the right column. */
export type CampaignRecipientLead = CampaignLeadLike & { isContact?: boolean };

/**
 * Normalise one polymorphic list member into the lead shape this filter expects.
 * Returns null for members that must not be messaged at all.
 *
 * `lead_list_members` became polymorphic in the marketing_contacts split — a member
 * targets either a real lead or a bulk-imported contact. Every campaign path needs
 * the same mapping, so it lives here rather than being re-derived per caller.
 *
 * CRITICAL: a marketing contact has no academic partner, so it must NOT carry
 * `shared_with_nimt: false`. That value means "partner-private" and is a hard
 * exclusion below — setting it on contacts silently dropped every bulk-imported
 * member of every campaign. Covered by campaign-eligibility.test.ts.
 */
export function campaignMemberToLead(
  member: CampaignListMember,
  channel: "whatsapp" | "email",
): CampaignRecipientLead | null {
  if (member.directory_recipient) {
    const row = member.directory_recipient;
    return { id: row.target_id, name: row.name, phone: row.phone, email: row.email, directoryKind: row.kind, stage: null, shared_with_nimt: null };
  }
  if (member?.leads?.id) return member.leads;

  const contact = member?.marketing_contacts;
  if (!contact?.id) return null;
  // Opted out, or already promoted to a lead (the lead-backed member covers that
  // person — sending to both would message them twice).
  if (contact.opted_out || contact.promoted_lead_id) return null;

  return {
    id: contact.id,
    ...(channel === "email" ? { email: contact.email } : { phone: contact.phone }),
    stage: null,
    shared_with_nimt: null,
    isContact: true,
  };
}

/**
 * Filter list members for a campaign. DNC is never optional.
 */
export function filterCampaignRecipients<T extends CampaignLeadLike>(
  leads: T[],
  opts: CampaignEligibilityOptions,
): CampaignEligibilityResult<T> {
  const now = opts.now ?? new Date();
  const quietDays = Math.max(0, Math.floor(Number(opts.quietDays ?? 0)));
  const quietMs = quietDays > 0 ? quietDays * 24 * 60 * 60 * 1000 : 0;
  const lastByLead = lastContactMap(opts.lastMarketingAtByLeadId);
  const excludeCold = opts.excludeCold !== false;
  const extra = new Set(
    (opts.extraExcludeStages || []).map((s) => normalizeStage(s)).filter(Boolean),
  );

  const eligible: T[] = [];
  const skipped: Array<{ lead: T; reason: CampaignSkipReason }> = [];
  let dnc = 0;
  let notShared = 0;
  let noContact = 0;
  let cold = 0;
  let recentContact = 0;
  let excludedStage = 0;
  let duplicate = 0;
  const destinations = new Set<string>();

  for (let lead of leads) {
    if (!lead || !lead.id) continue;
    const stage = normalizeStage(lead.stage);

    if (HARD_EXCLUDE_STAGES.has(stage) || stage === "dnc") {
      skipped.push({ lead, reason: "dnc" });
      dnc += 1;
      continue;
    }

    // Academic-partner private leads are never part of NIMT outreach.
    if (lead.shared_with_nimt === false) {
      skipped.push({ lead, reason: "not_shared" });
      notShared += 1;
      continue;
    }

    if (opts.channel === "whatsapp" && !hasPhone(lead)) {
      skipped.push({ lead, reason: "no_phone" });
      noContact += 1;
      continue;
    }
    if (opts.channel === "email" && !hasEmail(lead)) {
      skipped.push({ lead, reason: "no_email" });
      noContact += 1;
      continue;
    }

    if (excludeCold && (stage === "cold" || DEFAULT_QUALITY_EXCLUDE_STAGES.has(stage))) {
      skipped.push({ lead, reason: "cold" });
      cold += 1;
      continue;
    }

    if (extra.has(stage)) {
      skipped.push({ lead, reason: "excluded_stage" });
      excludedStage += 1;
      continue;
    }

    if (quietMs > 0) {
      const lastIso = lastByLead.get(lead.id);
      if (lastIso) {
        const lastAt = new Date(lastIso).getTime();
        if (!Number.isNaN(lastAt) && now.getTime() - lastAt < quietMs) {
          skipped.push({ lead, reason: "recent_contact" });
          recentContact += 1;
          continue;
        }
      }
    }

    {
      const destination = opts.channel === 'email' ? String(lead.email).trim().toLowerCase() : String(lead.phone).replace(/\D/g, '');
      const normalized = opts.channel === 'whatsapp'
        ? destination.length === 10 ? '91' + destination : destination.length === 11 && destination.startsWith('0') ? '91' + destination.slice(1) : destination
        : destination;
      if (destinations.has(normalized)) { skipped.push({ lead, reason: 'duplicate' }); duplicate++; continue; }
      destinations.add(normalized);
      if (opts.channel === 'email') lead = { ...lead, email: normalized };
      else lead = { ...lead, phone: normalized };
    }
    eligible.push(lead);
  }

  const total = leads.filter((l) => l && l.id).length;
  const counts = {
    total,
    eligible: eligible.length,
    dnc,
    notShared,
    noContact,
    cold,
    recentContact,
    excludedStage,
    duplicate,
  };

  const parts: string[] = [
    `${counts.eligible.toLocaleString("en-IN")} will receive`,
  ];
  if (dnc) parts.push(`${dnc} DNC excluded`);
  if (notShared) parts.push(`${notShared} not shared with NIMT`);
  if (noContact) parts.push(`${noContact} missing ${opts.channel === "email" ? "email" : "phone"}`);
  if (duplicate) parts.push(`${duplicate} duplicate destinations`);
  if (cold) parts.push(`${cold} cold`);
  if (recentContact) parts.push(`${recentContact} recent contact (<${quietDays}d)`);
  if (excludedStage) parts.push(`${excludedStage} other stage`);

  return {
    eligible,
    skipped,
    counts,
    preview: parts.join(" · "),
  };
}

export function isHardBlockedStage(stage: string | null | undefined): boolean {
  return HARD_EXCLUDE_STAGES.has(normalizeStage(stage));
}
