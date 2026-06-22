import { describe, expect, it, vi } from "vitest";
import { resolveGatewayRules, type GatewayRule } from "./paymentGatewayResolver";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: null }) }));

const rule = (partial: Partial<GatewayRule>): GatewayRule => ({
  payment_context: "application_fee",
  scope_type: "global",
  scope_id: null,
  gateway: "easebuzz",
  is_enabled: true,
  is_staff_pilot_only: false,
  priority: 10,
  payment_gateway_config: {
    gateway: partial.gateway || "easebuzz",
    display_name: partial.gateway || "EaseBuzz",
    supports_application_fee: true,
    supports_token_fee: true,
    supports_student_fee: true,
    supports_alumni_service: true,
  },
  ...partial,
});

describe("resolveGatewayRules", () => {
  it("uses the most specific visible matching scope", () => {
    const gateways = resolveGatewayRules([
      rule({ gateway: "easebuzz", scope_type: "global", is_enabled: true }),
      rule({ gateway: "easebuzz", scope_type: "institution_type", scope_id: "college", is_enabled: true }),
      rule({ gateway: "easebuzz", scope_type: "institution", scope_id: "inst-1", is_enabled: false }),
      rule({ gateway: "icici", scope_type: "global", is_enabled: true, priority: 30 }),
    ], {
      institutionId: "inst-1",
      institutionType: "college",
    }, "application_fee", true);

    expect(gateways.map((g) => g.gateway)).toEqual(["easebuzz"]);
  });

  it("hides staff-pilot gateways from public users", () => {
    const publicGateways = resolveGatewayRules([
      rule({ gateway: "easebuzz", scope_type: "global", is_enabled: true, priority: 10 }),
      rule({ gateway: "icici", scope_type: "global", is_enabled: true, is_staff_pilot_only: true, priority: 20 }),
    ], {}, "application_fee", false);

    const staffGateways = resolveGatewayRules([
      rule({ gateway: "easebuzz", scope_type: "global", is_enabled: true, priority: 10 }),
      rule({ gateway: "icici", scope_type: "global", is_enabled: true, is_staff_pilot_only: true, priority: 20 }),
    ], {}, "application_fee", true);

    expect(publicGateways.map((g) => g.gateway)).toEqual(["easebuzz"]);
    expect(staffGateways.map((g) => g.gateway)).toEqual(["easebuzz", "icici"]);
  });

  it("orders public gateways by configured priority", () => {
    const gateways = resolveGatewayRules([
      rule({ payment_context: "student_fee", gateway: "easebuzz", scope_type: "global", is_enabled: true, priority: 30 }),
      rule({ payment_context: "student_fee", gateway: "razorpay", scope_type: "global", is_enabled: true, priority: 10 }),
      rule({ payment_context: "student_fee", gateway: "icici", scope_type: "global", is_enabled: true, priority: 20 }),
    ], {}, "student_fee", false);

    expect(gateways.map((g) => g.gateway)).toEqual(["razorpay", "icici", "easebuzz"]);
  });

  it("matches institution group rules between campus and institution type specificity", () => {
    const gateways = resolveGatewayRules([
      rule({ gateway: "easebuzz", scope_type: "institution_type", scope_id: "school", is_enabled: true }),
      rule({ gateway: "icici", scope_type: "institution_group", scope_id: "group-1", is_enabled: true, priority: 5 }),
      rule({ gateway: "cashfree", scope_type: "campus", scope_id: "campus-1", is_enabled: true, priority: 7 }),
    ], {
      campusId: "campus-1",
      institutionType: "school",
      institutionGroupIds: ["group-1"],
    }, "application_fee", true);

    expect(gateways.map((g) => g.gateway)).toEqual(["cashfree"]);
  });

  it("falls back to global rules when a scoped pilot rule is hidden from public users", () => {
    const gateways = resolveGatewayRules([
      rule({ gateway: "easebuzz", scope_type: "global", is_enabled: true, priority: 10 }),
      rule({
        gateway: "icici",
        scope_type: "institution_type",
        scope_id: "school",
        is_enabled: true,
        is_staff_pilot_only: true,
        priority: 1,
      }),
    ], {
      institutionType: "school",
    }, "application_fee", false);

    expect(gateways.map((g) => g.gateway)).toEqual(["easebuzz"]);
  });
});
