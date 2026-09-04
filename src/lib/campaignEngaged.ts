/**
 * Campaign "engaged" leads: anyone who replied, took a call, or clicked a
 * link/button after the send. Used by Marketing Hub export and the WhatsApp
 * inbox deep link so both surfaces agree on the same set.
 */

export const CAMPAIGN_ENGAGED_OR =
  "responded_at.not.is.null,called_at.not.is.null,clicked_link_at.not.is.null,clicked_button_at.not.is.null";

export type RecipientEngagementFilter = "all" | "engaged" | "responded" | "called" | "clicked" | "needs_attention";

export type CampaignEngagedSignals = {
  respondedAt?: string | null;
  calledAt?: string | null;
  clickedLinkAt?: string | null;
  clickedButtonAt?: string | null;
};

export function isCampaignEngaged(row: CampaignEngagedSignals): boolean {
  return Boolean(row.respondedAt || row.calledAt || row.clickedLinkAt || row.clickedButtonAt);
}

export function campaignHasEngaged(campaign: {
  responded: number;
  called: number;
  clickedLink: number;
  clickedButton: number;
}): boolean {
  return campaign.responded + campaign.called + campaign.clickedLink + campaign.clickedButton > 0;
}

export function matchesRecipientEngagementFilter(
  row: CampaignEngagedSignals,
  filter: RecipientEngagementFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "responded") return Boolean(row.respondedAt);
  if (filter === "called") return Boolean(row.calledAt);
  if (filter === "clicked") return Boolean(row.clickedLinkAt || row.clickedButtonAt);
  return isCampaignEngaged(row);
}

export function recipientEngagementOrFilter(
  filter: Exclude<RecipientEngagementFilter, "all">,
): string {
  if (filter === "responded") return "responded_at.not.is.null";
  if (filter === "called") return "called_at.not.is.null";
  if (filter === "clicked") return "clicked_link_at.not.is.null,clicked_button_at.not.is.null";
  return CAMPAIGN_ENGAGED_OR;
}

/** Inbox deep link: campaign id in the query, not a phone list. */
export function campaignEngagedInboxPath(campaignId: string): string {
  return `/whatsapp-inbox?campaign=${encodeURIComponent(campaignId)}&engaged=1&inbox=all`;
}

export function campaignPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Recipient phones and conversation phones may differ by 91-prefix / punctuation. */
export function campaignPhoneLookupValues(phone: string): string[] {
  const digits = campaignPhoneDigits(phone);
  const values = new Set<string>();
  if (phone) values.add(phone);
  if (digits) values.add(digits);
  if (digits.startsWith("91") && digits.length === 12) values.add(digits.slice(2));
  if (digits.length === 10) values.add(`91${digits}`);
  return [...values];
}

export function engagedPhoneDigitSet(phones: string[]): Set<string> {
  const set = new Set<string>();
  for (const phone of phones) {
    for (const value of campaignPhoneLookupValues(phone)) {
      const digits = campaignPhoneDigits(value);
      if (digits) set.add(digits);
    }
  }
  return set;
}

export function conversationMatchesEngagedPhones(
  conversationPhone: string,
  engagedDigits: Set<string>,
): boolean {
  const digits = campaignPhoneDigits(conversationPhone);
  if (!digits) return false;
  if (engagedDigits.has(digits)) return true;
  if (digits.startsWith("91") && digits.length === 12 && engagedDigits.has(digits.slice(2))) return true;
  if (digits.length === 10 && engagedDigits.has(`91${digits}`)) return true;
  return false;
}

export function campaignRecipientQuery(channel: "whatsapp" | "email") {
  const destinationColumn = channel === "whatsapp" ? "phone" : "to_email";
  const providerColumn = channel === "whatsapp" ? "message_id" : "provider_id";
  const funnelColumns = channel === "whatsapp"
    ? ",delivered_at,read_at,failed_at,last_error_code,retry_count"
    : "";
  return {
    table: channel === "whatsapp" ? "whatsapp_campaign_recipients" : "email_campaign_recipients",
    destinationColumn,
    providerColumn,
    select: `id,status,error_message,${providerColumn},sent_at,${destinationColumn},responded_at,called_at,call_disposition,clicked_link_at,clicked_url,clicked_button_at,clicked_button_title${funnelColumns},leads(name)`,
  };
}

const PAGE = 500;
const PHONE_IN_CHUNK = 80;

export async function fetchCampaignRecipientsByEngagement(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (t: string) => any },
  channel: "whatsapp" | "email",
  campaignId: string,
  filter: Exclude<RecipientEngagementFilter, "all">,
): Promise<any[]> {
  const { table, select } = campaignRecipientQuery(channel);
  const orFilter = recipientEngagementOrFilter(filter);
  const all: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(table as any)
      .select(select)
      .eq("campaign_id", campaignId)
      .or(orFilter)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data as any[]) || [];
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return all;
}

export async function fetchEngagedCampaignPhones(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (t: string) => any },
  campaignId: string,
): Promise<{ phones: string[]; campaignName: string | null }> {
  const [{ data: campaign }, recipients] = await Promise.all([
    client.from("whatsapp_campaigns").select("name").eq("id", campaignId).maybeSingle(),
    fetchCampaignRecipientsByEngagement(client, "whatsapp", campaignId, "engaged"),
  ]);
  const phones = recipients
    .map((row) => String(row.phone || ""))
    .filter(Boolean);
  return {
    phones,
    campaignName: typeof campaign?.name === "string" ? campaign.name : null,
  };
}

export function chunkValues<T>(values: T[], size = PHONE_IN_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

// ---------- "Needs attention" filter ----------
// ponytail: AI-handled/dismissed states — everything NOT in this set is
//           potentially interesting (including phones with no state at all).
const AI_HANDLED_STATES = new Set(["answered_by_ai", "not_interested", "dnc"]);

/**
 * Given a list of engaged-recipient phones, returns the digit-set of those
 * whose conversation state says the AI already handled / dismissed them.
 * Phones absent from `whatsapp_conversation_state` are NOT in the returned
 * set — they count as "needs attention" (no AI is watching).
 */
export async function fetchHandledPhoneDigits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (t: string) => any },
  phones: string[],
): Promise<Set<string>> {
  const allVariants: string[] = [];
  for (const p of phones) allVariants.push(...campaignPhoneLookupValues(p));
  const handled = new Set<string>();
  for (const chunk of chunkValues(allVariants)) {
    const { data } = await client
      .from("whatsapp_conversation_state")
      .select("phone,mode,state")
      .in("phone", chunk);
    if (!data) continue;
    for (const row of data as { phone: string; mode: string; state: string }[]) {
      if (row.mode === "ai" && AI_HANDLED_STATES.has(row.state)) {
        for (const v of campaignPhoneLookupValues(row.phone)) {
          handled.add(campaignPhoneDigits(v));
        }
      }
    }
  }
  return handled;
}
