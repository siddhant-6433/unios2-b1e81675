export interface CahetRegistrationDetails {
  id: string;
  lead_id: string;
  registration_no: string;
  document_url: string | null;
  notes: string | null;
  registered_at: string | null;
  document_signed_url?: string | null;
}

export function isBptOrBmritCourseName(courseName: string | null | undefined): boolean {
  if (!courseName) return false;
  const c = courseName.toLowerCase();
  return (
    c.includes("bpt") ||
    c.includes("physiotherapy") ||
    c.includes("bmrit") ||
    (c.includes("radiology") && c.includes("b.sc")) ||
    (c.includes("radiology") && c.includes("imaging"))
  );
}

export function formatCahetRegisteredAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function fetchCahetRegistration(
  supabase: any,
  leadId: string | null | undefined,
): Promise<CahetRegistrationDetails | null> {
  if (!leadId) return null;
  const { data } = await supabase
    .from("cahet_registrations")
    .select("id, lead_id, registration_no, document_url, notes, registered_at")
    .eq("lead_id", leadId)
    .maybeSingle();

  if (!data) return null;

  let documentSignedUrl: string | null = null;
  if (data.document_url) {
    const { data: signed } = await supabase.storage
      .from("cahet-registrations")
      .createSignedUrl(data.document_url, 60 * 60);
    documentSignedUrl = signed?.signedUrl || null;
  }

  return {
    ...(data as CahetRegistrationDetails),
    document_signed_url: documentSignedUrl,
  };
}
