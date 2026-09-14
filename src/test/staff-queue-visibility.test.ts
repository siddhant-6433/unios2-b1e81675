import { describe, expect, it } from "vitest";
import { isHiddenFromStaffQueues, nestedOfferLeadId } from "@/lib/staffQueueVisibility";

describe("isHiddenFromStaffQueues", () => {
  it("hides login-disabled, archived, and deleted students", () => {
    expect(isHiddenFromStaffQueues({ login_disabled: true })).toBe(true);
    expect(isHiddenFromStaffQueues({ archived_at: "2026-09-14T00:00:00Z" })).toBe(true);
    expect(isHiddenFromStaffQueues({ deleted_at: "2026-09-14T00:00:00Z" })).toBe(true);
  });

  it("leaves active students visible", () => {
    expect(isHiddenFromStaffQueues(null)).toBe(false);
    expect(isHiddenFromStaffQueues({ login_disabled: false, archived_at: null, deleted_at: null })).toBe(false);
  });
});

describe("nestedOfferLeadId", () => {
  it("reads lead_id from an object or array offer_letters embed", () => {
    expect(nestedOfferLeadId({ offer_letters: { lead_id: "abc" } })).toBe("abc");
    expect(nestedOfferLeadId({ offer_letters: [{ lead_id: "abc" }] })).toBe("abc");
    expect(nestedOfferLeadId({ offer_letters: null })).toBeNull();
  });
});
