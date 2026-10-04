import { describe, expect, it, vi } from "vitest";
import {
  campaignMemberToLead,
  filterCampaignRecipients,
} from "./campaignEligibility";
import {
  campaignTarget,
  canAccessDirectoryAudience,
  fetchCampaignListMembers,
  fetchFailedCampaignRecipients,
  fetchLastWhatsAppMarketingAtByRecipients,
  withLiveDirectoryCounts,
} from "./directoryCommunicationLists";
import {
  directoryCampaignAccess,
  directoryRecipientAllowed,
  directoryRecipientSnapshot,
} from "../../supabase/functions/_shared/directory-campaign";

const directoryMember = (
  id: string,
  phone: string | null,
  email: string | null,
  kind: "consultant" | "academic_partner" = "consultant",
) => ({
  directory_recipient: {
    member_id: id,
    stage: null,
    target_id: id,
    kind,
    name: "Partner Name",
    phone,
    email,
  },
});

describe("directory communication audiences", () => {
  it("retains native identities and recipient names for both channels", () => {
    const consultant = campaignMemberToLead(
      directoryMember("c1", "9876543210", "c@example.com"),
      "whatsapp",
    )!;
    expect(campaignTarget(consultant)).toEqual({
      lead_id: null,
      contact_id: null,
      consultant_id: "c1",
      academic_partner_id: null,
      recipient_name: "Partner Name",
      recipient_phone: "9876543210",
      recipient_email: "c@example.com",
    });
    const partner = campaignMemberToLead(
      directoryMember("p1", null, "p@example.com", "academic_partner"),
      "email",
    )!;
    expect(campaignTarget(partner).academic_partner_id).toBe("p1");
    expect(campaignTarget({ id: "l1" }).lead_id).toBe("l1");
    expect(campaignTarget({ id: "m1", isContact: true }).contact_id).toBe("m1");
  });

  it("excludes invalid destinations and deduplicates normalized phones/emails", () => {
    const members = [
      directoryMember("1", "9876543210", " PARTNER@example.com "),
      directoryMember("2", "+91 98765 43210", "partner@EXAMPLE.com"),
      directoryMember("3", null, "broken@"),
      directoryMember("4", "abcdefghi", null),
    ];
    const recipients = members.map((m) => campaignMemberToLead(m, "whatsapp")!);
    const wa = filterCampaignRecipients(recipients, { channel: "whatsapp" });
    expect(wa.counts).toMatchObject({
      total: 4,
      eligible: 1,
      duplicate: 1,
      noContact: 2,
    });
    expect(wa.eligible[0].phone).toBe("919876543210");
    const email = filterCampaignRecipients(recipients, { channel: "email" });
    expect(email.counts).toMatchObject({
      eligible: 1,
      duplicate: 1,
      noContact: 2,
    });
    expect(email.eligible[0].email).toBe("partner@example.com");
  });

  it("resolves every page and re-reads directory membership on the next campaign", async () => {
    let records = Array.from(
      { length: 1205 },
      (_, i) => ({
        member_id: `${i}`,
        target_id: `${i}`,
        kind: "consultant",
        name: "Original",
        total_count: 1205,
      }),
    );
    const rpc = vi.fn(async (
      _: string,
      args: { _offset?: number; _limit?: number; _audience?: string },
    ) => ({
      data: records.slice(args._offset, args._offset + args._limit),
      error: null,
    }));
    const client = {
      rpc,
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { audience_type: "consultants" },
              error: null,
            }),
          }),
        }),
      }),
    };
    const first = await fetchCampaignListMembers(client, "list", "");
    expect(first).toHaveLength(1205);
    expect(rpc).toHaveBeenCalledTimes(3);
    records = records.slice(1).map((r) => ({ ...r, name: "Edited" }));
    records.push({
      member_id: "new",
      target_id: "new",
      kind: "consultant",
      name: "New",
      total_count: 1205,
    });
    const second = await fetchCampaignListMembers(client, "list", "");
    expect(second[0].directory_recipient.name).toBe("Edited");
    expect(second.at(-1)?.directory_recipient.target_id).toBe("new");
    const counts = await withLiveDirectoryCounts(client, [{
      id: "list",
      audience_type: "consultants",
      member_count: 0,
    }]);
    expect(counts[0].member_count).toBe(1205);
  });

  it("fails closed when directory resolution is denied", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { audience_type: "academic_partners" },
              error: null,
            }),
          }),
        }),
      }),
      rpc: async () => ({ error: new Error("access denied") }),
    };
    await expect(fetchCampaignListMembers(client, "list", "")).rejects.toThrow(
      "access denied",
    );
    expect(canAccessDirectoryAudience("consultants", "counsellor", [])).toBe(
      false,
    );
    expect(
      canAccessDirectoryAudience("consultants", "counsellor", [
        "consultants:view",
      ]),
    ).toBe(true);
    expect(
      canAccessDirectoryAudience("academic_partners", "counsellor", [
        "consultants:view",
      ]),
    ).toBe(false);
    expect(
      canAccessDirectoryAudience("academic_partners", "academic_partner", []),
    ).toBe(false);
  });

  it("checks original campaign creator permissions and uses the queued snapshot", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { user_id: "creator" } }),
          }),
        }),
      }),
      rpc: vi.fn(async (
        _: string,
        args: { _offset?: number; _limit?: number; _audience?: string },
      ) => ({
        data: args._audience === "consultants",
      })),
    };
    const access = await directoryCampaignAccess(client, "profile");
    expect(client.rpc).toHaveBeenCalledWith("can_access_directory_audience", {
      _audience: "consultants",
      _user_id: "creator",
    });
    expect(directoryRecipientAllowed({ consultant_id: "1" }, access)).toBe(
      true,
    );
    expect(directoryRecipientAllowed({ academic_partner_id: "2" }, access))
      .toBe(false);
    expect(directoryRecipientAllowed({ lead_id: "3" }, access)).toBe(true);
    expect(
      directoryRecipientSnapshot({
        consultant_id: "1",
        recipient_name: "Queued Name",
        to_email: "queued@example.com",
      }),
    ).toMatchObject({
      name: "Queued Name",
      email: "queued@example.com",
      stage: null,
    });
  });

  it("uses destination history for the directory quiet period", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: Record<string, any> = {};
    for (const name of ["select", "in", "eq", "not", "gte", "order"]) {
      query[name] = vi.fn(() => query);
    }
    query.range = vi.fn(async () => ({
      data: [{ phone: "919876543210", created_at: "2026-10-03T09:00:00Z" }],
      error: null,
    }));
    const client = { from: () => query, rpc: vi.fn() };
    const map = await fetchLastWhatsAppMarketingAtByRecipients(client, [{
      id: "c",
      phone: "9876543210",
      directoryKind: "consultant",
    }]);
    expect(map.get("c")).toBe("2026-10-03T09:00:00Z");
    expect(query.in).toHaveBeenCalledWith(
      "phone",
      expect.arrayContaining(["919876543210", "9876543210"]),
    );
  });
  it("retains cross-channel contact fields for queued templates and failed-recipient resend", async () => {
    const original = campaignMemberToLead(
      directoryMember("c1", "9876543210", "c@example.com"),
      "email",
    )!;
    const snapshot = campaignTarget(original);
    expect(
      directoryRecipientSnapshot({ ...snapshot, to_email: "c@example.com" }),
    ).toMatchObject({ phone: "9876543210", email: "c@example.com" });
    expect(directoryRecipientSnapshot({ ...snapshot, phone: "919876543210" }))
      .toMatchObject({ phone: "919876543210", email: "c@example.com" });
    const records = Array.from(
      { length: 1205 },
      () => ({ ...snapshot, to_email: "c@example.com" }),
    );
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn(async (from: number, to: number) => ({
        data: records.slice(from, to + 1),
        error: null,
      })),
    };
    const rows = await fetchFailedCampaignRecipients(
      { from: () => query, rpc: vi.fn() },
      "email_campaign_recipients",
      "campaign",
      "to_email",
    );
    expect(rows).toHaveLength(1205);
    expect(query.range).toHaveBeenCalledTimes(3);
    expect(rows[1204]).toMatchObject({
      consultant_id: "c1",
      lead_id: null,
      contact_id: null,
      recipient_phone: "9876543210",
      recipient_email: "c@example.com",
      recipient_name: "Partner Name",
    });
  });
});
