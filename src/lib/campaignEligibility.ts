/**
 * WhatsApp (and email) campaign recipient eligibility.
 * DNC is always hard-excluded — stage "dnc" means stop all further outreach.
 * Optional quality filters reduce Meta blocks/reports (cold lists, recent blast fatigue).
 */

export type CampaignLeadLike = {
  id: string;
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
  | "excluded_stage";

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
  return Boolean(lead.phone && String(lead.phone).replace(/\D/g, "").length >= 8);
}

function hasEmail(lead: CampaignLeadLike): boolean {
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

  for (const lead of leads) {
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
  };

  const parts: string[] = [
    `${counts.eligible.toLocaleString("en-IN")} will receive`,
  ];
  if (dnc) parts.push(`${dnc} DNC excluded`);
  if (notShared) parts.push(`${notShared} not shared with NIMT`);
  if (noContact) parts.push(`${noContact} missing ${opts.channel === "email" ? "email" : "phone"}`);
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
