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

  const photoByLead = new Map<string, string>();

  // Fast path: one bulk RPC resolves the ~80% of leads whose photo is recorded in
  // application_documents, avoiding a list-app-docs edge call per lead. SECURITY
  // DEFINER so it works for teacher/faculty too (they can't read that table directly).
  const { data: bulk, error: bulkErr } = await supabase
    .rpc("application_photo_urls_by_lead" as never, { _lead_ids: uniqueLeadIds } as never);
  if (bulkErr) {
    console.error("[application-photos] bulk rpc failed", bulkErr);
  } else {
    ((bulk || []) as Array<{ lead_id: string | null; url: string | null }>).forEach((row) => {
      if (row.lead_id && row.url) photoByLead.set(row.lead_id, row.url);
    });
  }

  // Slow path: only the leads the bulk query missed (storage-only older uploads).
  const unresolvedLeadIds = uniqueLeadIds.filter((id) => !photoByLead.has(id));
  if (unresolvedLeadIds.length === 0) return photoByLead;

  const { data, error } = await supabase
    .from("applications")
    .select("lead_id, application_id, created_at")
    .in("lead_id", unresolvedLeadIds)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[application-photos] application lookup failed", error);
    return photoByLead;
  }

  const latestAppByLead = new Map<string, string>();
  ((data || []) as Array<{ lead_id: string | null; application_id: string | null }>).forEach((row) => {
    if (row.lead_id && row.application_id && !latestAppByLead.has(row.lead_id)) {
      latestAppByLead.set(row.lead_id, row.application_id);
    }
  });

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
