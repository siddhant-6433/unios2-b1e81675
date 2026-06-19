import { supabase } from "@/integrations/supabase/client";

export interface ApplicationPhotoDoc {
  name: string;
  url: string;
  path?: string;
}

export const isApplicationPhotoDocument = (name?: string | null) =>
  !!name && /^(applicant|student)_photo|passport_photo|^photo[-_]/i.test(name);

export const findApplicationPhotoDoc = (docs: ApplicationPhotoDoc[]) =>
  docs.find((doc) => isApplicationPhotoDocument(doc.name)) || null;

export async function getApplicationPhotoUrl(applicationId: string | null | undefined) {
  if (!applicationId) return null;
  try {
    const { data, error } = await supabase.functions.invoke("list-app-docs", {
      body: { application_id: applicationId },
    });
    if (error) {
      console.error("[application-photos] list-app-docs failed", error);
      return null;
    }
    return findApplicationPhotoDoc(((data as any)?.docs || []) as ApplicationPhotoDoc[])?.url || null;
  } catch (err) {
    console.error("[application-photos] list-app-docs threw", err);
    return null;
  }
}

export async function getApplicationPhotoUrlsByLeadId(leadIds: string[]) {
  const uniqueLeadIds = Array.from(new Set(leadIds.filter(Boolean)));
  if (uniqueLeadIds.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from("applications")
    .select("lead_id, application_id, created_at")
    .in("lead_id", uniqueLeadIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[application-photos] application lookup failed", error);
    return new Map<string, string>();
  }

  const latestAppByLead = new Map<string, string>();
  ((data || []) as Array<{ lead_id: string | null; application_id: string | null }>).forEach((row) => {
    if (row.lead_id && row.application_id && !latestAppByLead.has(row.lead_id)) {
      latestAppByLead.set(row.lead_id, row.application_id);
    }
  });

  const photoByLead = new Map<string, string>();
  const entries = Array.from(latestAppByLead.entries());
  for (let index = 0; index < entries.length; index += 8) {
    const batch = entries.slice(index, index + 8);
    const results = await Promise.all(batch.map(async ([leadId, applicationId]) => ({
      leadId,
      url: await getApplicationPhotoUrl(applicationId),
    })));
    results.forEach(({ leadId, url }) => {
      if (url) photoByLead.set(leadId, url);
    });
  }

  return photoByLead;
}
