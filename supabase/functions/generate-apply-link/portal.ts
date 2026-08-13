export type ApplyPortalId = "nimt" | "beacon" | "mirai";

type PortalLead = {
  portal_brand?: string | null;
  lead_institution_type?: string | null;
  source?: string | null;
  origin_domain?: string | null;
  landing_page?: string | null;
  campus_id?: string | null;
};

type PortalApplication = {
  flags?: string[] | null;
  program_category?: string | null;
  course_selections?: unknown;
};

const VALID_PORTALS = new Set<ApplyPortalId>(["nimt", "beacon", "mirai"]);

export function normalizeApplyPortalId(value: unknown): ApplyPortalId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/^portal:/, "");
  return VALID_PORTALS.has(normalized as ApplyPortalId) ? normalized as ApplyPortalId : null;
}

function portalFromApplicationFlags(applications: PortalApplication[]): ApplyPortalId | null {
  for (const app of applications) {
    const flags = Array.isArray(app.flags) ? app.flags : [];
    for (const flag of flags) {
      const portal = normalizeApplyPortalId(flag);
      if (portal) return portal;
    }
  }
  return null;
}

function hasSchoolApplication(applications: PortalApplication[]) {
  return applications.some((app) => (app.program_category || "").toLowerCase() === "school");
}

function includesMirai(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return /mirai|mes-|miraischool\.in/i.test(value);
  try {
    return /mirai|mes-|miraischool\.in/i.test(JSON.stringify(value));
  } catch {
    return false;
  }
}

function isMiraiLead(
  lead: PortalLead | null | undefined,
  applications: PortalApplication[],
  isMiraiInstitution: boolean,
): boolean {
  // Authoritative signal: the selected course's owning institution is Mirai.
  // Campus alone can NOT single Mirai out — the GZ2/Avantika campus is shared
  // with the College of Education (B.Ed), so a campus-id check misroutes every
  // B.Ed–Avantika lead. Same reasoning as generate-offer-letter/index.ts.
  if (isMiraiInstitution) return true;
  if (!lead) return false;
  if ((lead.source || "").toLowerCase() === "mirai_website") return true;
  if (includesMirai(lead.origin_domain) || includesMirai(lead.landing_page)) return true;
  return applications.some((app) => includesMirai(app.course_selections));
}

export function resolveApplyPortal(
  lead: PortalLead | null | undefined,
  applications: PortalApplication[] = [],
  opts: { isMiraiInstitution?: boolean } = {},
): ApplyPortalId {
  const explicitAppPortal = portalFromApplicationFlags(applications);
  if (explicitAppPortal) return explicitAppPortal;

  const leadBrand = normalizeApplyPortalId(lead?.portal_brand);
  if (leadBrand && leadBrand !== "nimt") return leadBrand;

  if (isMiraiLead(lead, applications, opts.isMiraiInstitution === true)) return "mirai";

  if (hasSchoolApplication(applications)) return "beacon";
  if ((lead?.lead_institution_type || "").toLowerCase() === "school") return "beacon";

  return leadBrand || "nimt";
}

export function buildApplyPortalUrl(base: string, portal: ApplyPortalId, token: string): string {
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, "");
  const segments = path.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1]?.toLowerCase();

  if (lastSegment === "apply") {
    segments.push(portal);
  } else if (normalizeApplyPortalId(lastSegment)) {
    segments[segments.length - 1] = portal;
  } else {
    segments.push("apply", portal);
  }

  url.pathname = `/${segments.join("/")}`;
  url.searchParams.set("token", token);
  return url.toString();
}
