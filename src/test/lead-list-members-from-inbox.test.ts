import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  filterExistingLeadIds,
  insertLeadListMembers,
  uniqueLeadIds,
} from "@/lib/leadListMembers";
import { normalizeCampaignPhoneDigits } from "@/lib/campaignEngaged";

const leadA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const leadB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const contactC = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const orphan = "dddddddd-dddd-dddd-dddd-dddddddddddd";

describe("uniqueLeadIds", () => {
  it("drops blanks and non-uuids and collapses duplicate conversations to one id", () => {
    expect(uniqueLeadIds([leadA, null, leadA, "", undefined, "222", leadB])).toEqual([leadA, leadB]);
  });
});

describe("filterExistingLeadIds", () => {
  it("keeps only ids that exist in leads, in original unique order", async () => {
    const client = {
      from: () => ({
        select: () => ({
          in: async (_col: string, ids: string[]) => ({
            data: ids.filter((id) => id === leadA || id === leadB).map((id) => ({ id })),
            error: null,
          }),
        }),
      }),
    };
    expect(await filterExistingLeadIds(client, [leadB, leadA, orphan, leadB])).toEqual([leadB, leadA]);
  });
});

describe("insertLeadListMembers", () => {
  it("splits leads vs contacts and retries per row when a chunk 23505s", async () => {
    const inserted: Array<Record<string, string>> = [];
    const client = {
      from: (table: string) => ({
        select: () => ({
          in: async (_col: string, ids: string[]) => {
            const known = table === "leads" ? [leadA, leadB] : table === "marketing_contacts" ? [contactC] : [];
            return { data: ids.filter((id) => known.includes(id)).map((id) => ({ id })), error: null };
          },
        }),
        insert: async (rows: Record<string, string> | Record<string, string>[]) => {
          const list = Array.isArray(rows) ? rows : [rows];
          if (list.length > 1) return { error: { message: "duplicate key value violates unique constraint" } };
          inserted.push(list[0]);
          return { error: null };
        },
      }),
    };
    const result = await insertLeadListMembers(client, "list-1", [leadA, leadA, leadB, contactC, orphan]);
    expect(result.added).toBe(3);
    expect(result.leadCount).toBe(2);
    expect(result.contactCount).toBe(1);
    expect(result.failed).toBe(0);
    expect(inserted).toEqual([
      { list_id: "list-1", lead_id: leadA },
      { list_id: "list-1", lead_id: leadB },
      { list_id: "list-1", contact_id: contactC },
    ]);
  });
});

describe("normalizeCampaignPhoneDigits", () => {
  it("treats 91-prefixed and 10-digit numbers as the same person", () => {
    expect(normalizeCampaignPhoneDigits("+91 98765 43210")).toBe("9876543210");
    expect(normalizeCampaignPhoneDigits("919876543210")).toBe("9876543210");
    expect(normalizeCampaignPhoneDigits("9876543210")).toBe("9876543210");
  });
});

describe("add_lead_list_members migration", () => {
  it("installs a server helper that skips duplicates and contact/lead mismatches", () => {
    const migration = readFileSync("supabase/migrations/20260911075105_add_lead_list_members_from_ids.sql", "utf8");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.add_lead_list_members");
    expect(migration).toContain("JOIN public.leads");
    expect(migration).toContain("JOIN public.marketing_contacts");
    expect(migration).toContain("NOT EXISTS");
  });
});
