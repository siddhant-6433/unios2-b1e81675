import {
  fetchLastWhatsAppMarketingAtByLeadIds,
  fetchListMembers,
} from "./campaignEligibilityFetch";
import type {
  CampaignLeadLike,
  CampaignListMember,
} from "./campaignEligibility";

export type DirectoryListRow = {
  member_id: string;
  kind: "consultant" | "academic_partner";
  target_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  stage: string | null;
  total_count?: number;
};
// The legacy list projection is supplied dynamically by each campaign channel.
export type DirectoryListClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: unknown }>;
};

export type DirectoryAudience = "consultants" | "academic_partners";
export type AudienceType = "leads" | DirectoryAudience;
export const audienceLabel = (audience?: string) =>
  audience === "consultants"
    ? "Consultants"
    : audience === "academic_partners"
    ? "Academic partners"
    : "Leads / contacts";
export const isDirectoryList = (list: { audience_type?: string }) =>
  !!list.audience_type && list.audience_type !== "leads";
export function canAccessDirectoryAudience(
  audience: DirectoryAudience,
  role: string | null,
  permissions: string[],
) {
  if (["super_admin", "campus_admin", "admission_head"].includes(role || "")) {
    return true;
  }
  return audience === "consultants" &&
    ["principal", "counsellor"].includes(role || "") &&
    permissions.includes("consultants:view");
}

// Shared by the Lists and Marketing send flows. Existing list fetching stays unchanged.
export async function fetchCampaignListMembers(
  client: DirectoryListClient,
  listId: string,
  select: string,
): Promise<CampaignListMember[]> {
  const { data: list, error } = await client.from("lead_lists").select(
    "audience_type",
  ).eq("id", listId).single();
  if (error) throw error;
  if (!isDirectoryList(list)) return fetchListMembers(client, listId, select);
  const all: CampaignListMember[] = [];
  for (let offset = 0;; offset += 500) {
    const { data, error: pageError } = await client.rpc(
      "directory_list_members_page",
      { _list_id: listId, _limit: 500, _offset: offset },
    );
    if (pageError) throw pageError;
    const page = (data || []) as DirectoryListRow[];
    all.push(...page.map((row) => ({ directory_recipient: row })));
    if (page.length < 500) return all;
  }
}
export function campaignTarget(
  recipient: CampaignLeadLike & {
    isContact?: boolean;
    directoryKind?: string;
    name?: string | null;
  },
) {
  return {
    lead_id: !recipient.isContact && !recipient.directoryKind
      ? recipient.id
      : null,
    contact_id: recipient.isContact ? recipient.id : null,
    consultant_id: recipient.directoryKind === "consultant"
      ? recipient.id
      : null,
    academic_partner_id: recipient.directoryKind === "academic_partner"
      ? recipient.id
      : null,
    recipient_name: recipient.directoryKind ? recipient.name : null,
    recipient_phone: recipient.directoryKind ? recipient.phone : null,
    recipient_email: recipient.directoryKind ? recipient.email : null,
  };
}
export async function withLiveDirectoryCounts<
  T extends { id: string; audience_type?: string; member_count: number },
>(client: DirectoryListClient, lists: T[]): Promise<T[]> {
  return Promise.all(lists.map(async (list) => {
    if (!isDirectoryList(list)) return list;
    const { data, error } = await client.rpc("directory_list_members_page", {
      _list_id: list.id,
      _limit: 1,
      _offset: 0,
    });
    if (error) throw error;
    const rows = data as DirectoryListRow[] | null;
    return { ...list, member_count: Number(rows?.[0]?.total_count || 0) };
  }));
}

/** Directory recipients use destination history because they have no lead ID. */
export async function fetchLastWhatsAppMarketingAtByRecipients(
  client: DirectoryListClient,
  recipients: Array<
    { id: string; phone?: string | null; directoryKind?: string }
  >,
  lookbackDays = 30,
) {
  const map = await fetchLastWhatsAppMarketingAtByLeadIds(
    client,
    recipients.filter((r) => !r.directoryKind).map((r) => r.id),
    lookbackDays,
  );
  const normalize = (phone: string) => {
    const digits = phone.replace(/\D/g, "");
    return digits.length === 10 ? "91" + digits : digits;
  };
  const byPhone = new Map<string, string[]>();
  for (const r of recipients.filter((r) => r.directoryKind && r.phone)) {
    const phone = normalize(r.phone!);
    byPhone.set(phone, [...(byPhone.get(phone) || []), r.id]);
  }
  const phones = [...byPhone.keys()].flatMap(
    (phone) => [
      phone,
      "+" + phone,
      ...(phone.startsWith("91") && phone.length === 12
        ? [phone.slice(2)]
        : []),
    ],
  );
  const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  for (let i = 0; i < phones.length; i += 200) {
    for (let offset = 0;; offset += 500) {
      const { data, error } = await client.from("whatsapp_messages").select(
        "phone,created_at",
      ).in("phone", phones.slice(i, i + 200)).eq("direction", "outbound").not(
        "template_key",
        "is",
        null,
      ).gte("created_at", since).order("created_at", { ascending: false })
        .order("id").range(offset, offset + 499);
      if (error) throw error;
      for (const row of data || []) {
        for (const id of byPhone.get(normalize(row.phone)) || []) {
          if (!map.has(id) || row.created_at > map.get(id)!) {
            map.set(id, row.created_at);
          }
        }
      }
      if ((data || []).length < 500) break;
    }
  }
  return map;
}

/** Preserve all failed recipients and their original snapshots when retrying. */
export async function fetchFailedCampaignRecipients(
  client: DirectoryListClient,
  table: "whatsapp_campaign_recipients" | "email_campaign_recipients",
  campaignId: string,
  destination: "phone" | "to_email",
): Promise<
  Array<
    ReturnType<typeof campaignTarget> & { phone?: string; to_email?: string }
  >
> {
  const all: Array<
    ReturnType<typeof campaignTarget> & { phone?: string; to_email?: string }
  > = [];
  for (let offset = 0;; offset += 500) {
    const { data, error } = await client.from(table)
      .select(
        `lead_id,contact_id,consultant_id,academic_partner_id,recipient_name,recipient_phone,recipient_email,${destination}`,
      )
      .eq("campaign_id", campaignId).eq("status", "failed")
      .order("id").range(offset, offset + 499);
    if (error) throw error;
    all.push(...(data || []));
    if ((data || []).length < 500) return all;
  }
}
