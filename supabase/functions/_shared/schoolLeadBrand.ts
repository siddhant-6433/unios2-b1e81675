/** GZ2 / Avantika. Shared with College of Education, so campus alone is not Mirai. */
export const MIRAI_CAMPUS_ID = "c0000002-0000-0000-0000-000000000001";

export type SchoolLeadBrand = "mirai" | "nimt";

export type SchoolBrandLeadFields = {
  portal_brand?: string | null;
  campus_id?: string | null;
  lead_institution_type?: string | null;
  is_mirror?: boolean | null;
};

/**
 * Two CRM pipelines share phones: Mirai school vs everyone else (NIMT college
 * and NIMT Beacon). Beacon/college stay one-lead-per-phone.
 */
export function schoolLeadBrand(lead: SchoolBrandLeadFields | null | undefined): SchoolLeadBrand {
  if (!lead) return "nimt";
  if ((lead.portal_brand || "").toLowerCase() === "mirai") return "mirai";
  if (lead.campus_id === MIRAI_CAMPUS_ID && (lead.lead_institution_type || "") === "school") {
    return "mirai";
  }
  return "nimt";
}

export function schoolLeadBrandForPortal(portalId: string | null | undefined): SchoolLeadBrand {
  return portalId === "mirai" ? "mirai" : "nimt";
}

export function pickLeadForSchoolBrand<T extends SchoolBrandLeadFields>(
  leads: T[] | null | undefined,
  brand: SchoolLeadBrand,
): T | null {
  const rows = (leads || []).filter((lead) => lead.is_mirror !== true);
  return rows.find((lead) => schoolLeadBrand(lead) === brand) ?? null;
}

export function pickLeadForPortal<T extends SchoolBrandLeadFields>(
  leads: T[] | null | undefined,
  portalId: string | null | undefined,
): T | null {
  return pickLeadForSchoolBrand(leads, schoolLeadBrandForPortal(portalId));
}

/** Meta WhatsApp phone_number_id → CRM brand for school numbers. */
export const WHATSAPP_SCHOOL_CHANNEL_BRAND: Record<string, SchoolLeadBrand> = {
  "1274023025796842": "nimt", // NIMT Beacon School Avantika II
  "1110238142172240": "mirai",
};
