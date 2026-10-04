type DirectoryCampaignClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: unknown }>;
};
type DirectoryRecipient = {
  lead_id?: string | null;
  consultant_id?: string | null;
  academic_partner_id?: string | null;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  recipient_email?: string | null;
  phone?: string | null;
  to_email?: string | null;
};

/** Service workers recheck the campaign creator's directory permissions. */
export async function directoryCampaignAccess(
  client: DirectoryCampaignClient,
  createdBy: string | null,
) {
  if (!createdBy) return { consultants: false, academic_partners: false };
  const { data: profile, error } = await client.from("profiles").select(
    "user_id",
  ).eq("id", createdBy).maybeSingle();
  if (error || !profile?.user_id) {
    return { consultants: false, academic_partners: false };
  }
  const check = async (_audience: string) => {
    const { data, error } = await client.rpc("can_access_directory_audience", {
      _audience,
      _user_id: profile.user_id,
    });
    return !error && data === true;
  };
  const [consultants, academic_partners] = await Promise.all([
    check("consultants"),
    check("academic_partners"),
  ]);
  return { consultants, academic_partners };
}
export function directoryRecipientAllowed(
  recipient: DirectoryRecipient,
  access: { consultants: boolean; academic_partners: boolean },
) {
  return (!recipient.consultant_id || access.consultants) &&
    (!recipient.academic_partner_id || access.academic_partners);
}
export function directoryRecipientSnapshot(recipient: DirectoryRecipient) {
  if (!recipient.consultant_id && !recipient.academic_partner_id) return null;
  return {
    name: recipient.recipient_name || "",
    phone: recipient.phone || recipient.recipient_phone || "",
    email: recipient.to_email || recipient.recipient_email || "",
    stage: null,
    shared_with_nimt: null,
  };
}
