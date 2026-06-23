import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type PaymentContext =
  | "application_fee"
  | "token_fee"
  | "student_fee"
  | "alumni_service";

export type GatewayScopeType =
  | "global"
  | "institution_group"
  | "campus"
  | "institution"
  | "institution_type";

export interface PaymentGateway {
  gateway: string;
  display_name: string;
  is_enabled_fee_collection?: boolean;
  is_enabled_portal_payment?: boolean;
  supports_application_fee?: boolean;
  supports_token_fee?: boolean;
  supports_student_fee?: boolean;
  supports_alumni_service?: boolean;
  is_staff_pilot_only?: boolean;
  priority?: number;
}

export interface GatewayRule {
  payment_context: PaymentContext;
  scope_type: GatewayScopeType;
  scope_id: string | null;
  gateway: string;
  is_enabled: boolean;
  is_staff_pilot_only: boolean;
  priority: number;
  payment_gateway_config?: PaymentGateway | null;
}

export interface GatewayOwnerScope {
  institutionId?: string | null;
  campusId?: string | null;
  institutionType?: "school" | "college" | string | null;
  institutionGroupIds?: string[];
}

const SPECIFICITY: Record<GatewayScopeType, number> = {
  global: 0,
  institution_type: 1,
  institution_group: 2,
  campus: 3,
  institution: 4,
};

const SUPPORT_FIELD: Record<PaymentContext, keyof PaymentGateway> = {
  application_fee: "supports_application_fee",
  token_fee: "supports_token_fee",
  student_fee: "supports_student_fee",
  alumni_service: "supports_alumni_service",
};

const PILOT_ROLES = new Set(["super_admin", "admission_head", "campus_admin", "accountant"]);
const DEFAULT_GATEWAY_ORDER: Record<string, number> = {
  icici: 10,
  razorpay: 20,
  easebuzz: 30,
  cashfree: 40,
};

function ruleMatchesOwner(rule: GatewayRule, owner: GatewayOwnerScope): boolean {
  if (rule.scope_type === "global") return rule.scope_id == null;
  if (rule.scope_type === "institution") return !!owner.institutionId && rule.scope_id === owner.institutionId;
  if (rule.scope_type === "campus") return !!owner.campusId && rule.scope_id === owner.campusId;
  if (rule.scope_type === "institution_type") return !!owner.institutionType && rule.scope_id === owner.institutionType;
  if (rule.scope_type === "institution_group") return !!rule.scope_id && (owner.institutionGroupIds || []).includes(rule.scope_id);
  return false;
}

export function resolveGatewayRules(
  rules: GatewayRule[],
  owner: GatewayOwnerScope,
  context: PaymentContext,
  canSeePilotGateways: boolean,
): PaymentGateway[] {
  const visibleMatches = rules
    .filter((rule) => rule.payment_context === context)
    .filter((rule) => ruleMatchesOwner(rule, owner))
    .filter((rule) => rule.is_enabled)
    .filter((rule) => !rule.is_staff_pilot_only || canSeePilotGateways)
    .map((rule) => {
      const config = rule.payment_gateway_config || {};
      return {
        gateway: rule.gateway,
        display_name: config.display_name || rule.gateway,
        is_staff_pilot_only: rule.is_staff_pilot_only,
        priority: rule.priority,
        supports_application_fee: config.supports_application_fee,
        supports_token_fee: config.supports_token_fee,
        supports_student_fee: config.supports_student_fee,
        supports_alumni_service: config.supports_alumni_service,
        scope_type: rule.scope_type,
      };
    })
    .filter((gateway) => gateway[SUPPORT_FIELD[context]] !== false);

  const bestSpecificity = Math.max(
    -1,
    ...visibleMatches.map((gateway) => SPECIFICITY[gateway.scope_type]),
  );

  return visibleMatches
    .filter((gateway) => SPECIFICITY[gateway.scope_type] === bestSpecificity)
    .sort((a, b) => {
      const aPriority = a.priority ?? DEFAULT_GATEWAY_ORDER[a.gateway] ?? 100;
      const bPriority = b.priority ?? DEFAULT_GATEWAY_ORDER[b.gateway] ?? 100;
      return aPriority - bPriority ||
        (DEFAULT_GATEWAY_ORDER[a.gateway] ?? 100) - (DEFAULT_GATEWAY_ORDER[b.gateway] ?? 100) ||
        a.display_name.localeCompare(b.display_name);
    });
}

async function resolveCourseOwner(courseId?: string | null): Promise<GatewayOwnerScope> {
  if (!courseId) return {};
  const { data } = await (supabase as any)
    .from("courses")
    .select("id, departments!inner(institutions!inner(id, campus_id, type))")
    .eq("id", courseId)
    .maybeSingle();
  const inst = data?.departments?.institutions;
  if (!inst) return {};
  return {
    institutionId: inst.id,
    campusId: inst.campus_id,
    institutionType: inst.type,
  };
}

async function resolveApplicationOwner(applicationId?: string | null): Promise<GatewayOwnerScope> {
  if (!applicationId) return {};
  const { data } = await (supabase as any)
    .from("applications")
    .select("institution_id, program_category, course_selections")
    .eq("application_id", applicationId)
    .maybeSingle();

  const firstSelection = Array.isArray(data?.course_selections) ? data.course_selections[0] : null;
  const courseOwner = await resolveCourseOwner(firstSelection?.course_id || null);
  return {
    institutionId: data?.institution_id || firstSelection?.institution_id || courseOwner.institutionId || null,
    campusId: firstSelection?.campus_id || courseOwner.campusId || null,
    institutionType: courseOwner.institutionType || (data?.program_category === "school" ? "school" : null),
  };
}

async function resolveStudentOwner(studentId?: string | null): Promise<GatewayOwnerScope> {
  if (!studentId) return {};
  const { data } = await (supabase as any)
    .from("students")
    .select("campus_id, course_id, courses:course_id(departments!inner(institutions!inner(id, campus_id, type)))")
    .eq("id", studentId)
    .maybeSingle();
  const inst = data?.courses?.departments?.institutions;
  return {
    institutionId: inst?.id || null,
    campusId: data?.campus_id || inst?.campus_id || null,
    institutionType: inst?.type || null,
  };
}

async function withInstitutionGroups(owner: GatewayOwnerScope): Promise<GatewayOwnerScope> {
  if (!owner.institutionId) return owner;
  const { data } = await (supabase as any)
    .from("institution_group_members")
    .select("group_id")
    .eq("institution_id", owner.institutionId);
  return {
    ...owner,
    institutionGroupIds: (data || []).map((row: any) => row.group_id).filter(Boolean),
  };
}

export interface UseScopedGatewaysArgs extends GatewayOwnerScope {
  context: PaymentContext;
  applicationId?: string | null;
  studentId?: string | null;
  courseId?: string | null;
  enabled?: boolean;
}

export function useScopedPaymentGateways(args: UseScopedGatewaysArgs) {
  const { role } = useAuth();
  const canSeePilotGateways = !!role && PILOT_ROLES.has(role);
  const [rules, setRules] = useState<GatewayRule[]>([]);
  const [owner, setOwner] = useState<GatewayOwnerScope>(args);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify({
    context: args.context,
    applicationId: args.applicationId,
    studentId: args.studentId,
    courseId: args.courseId,
    institutionId: args.institutionId,
    campusId: args.campusId,
    institutionType: args.institutionType,
    enabled: args.enabled,
  });

  const refetch = async () => {
    if (args.enabled === false) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let resolvedOwner: GatewayOwnerScope = {
        institutionId: args.institutionId,
        campusId: args.campusId,
        institutionType: args.institutionType,
        institutionGroupIds: args.institutionGroupIds,
      };

      if (!resolvedOwner.institutionId && args.applicationId) {
        resolvedOwner = { ...resolvedOwner, ...(await resolveApplicationOwner(args.applicationId)) };
      }
      if (!resolvedOwner.institutionId && args.studentId) {
        resolvedOwner = { ...resolvedOwner, ...(await resolveStudentOwner(args.studentId)) };
      }
      if (!resolvedOwner.institutionId && args.courseId) {
        resolvedOwner = { ...resolvedOwner, ...(await resolveCourseOwner(args.courseId)) };
      }
      resolvedOwner = await withInstitutionGroups(resolvedOwner);

      const { data, error: qErr } = await (supabase as any)
        .from("payment_gateway_rules")
        .select(`
          payment_context,
          scope_type,
          scope_id,
          gateway,
          is_enabled,
          is_staff_pilot_only,
          priority,
          payment_gateway_config (
            gateway,
            display_name,
            is_enabled_fee_collection,
            is_enabled_portal_payment,
            supports_application_fee,
            supports_token_fee,
            supports_student_fee,
            supports_alumni_service
          )
        `)
        .eq("payment_context", args.context);
      if (qErr) throw qErr;
      setOwner(resolvedOwner);
      setRules((data || []) as GatewayRule[]);
    } catch (e: any) {
      setError(e?.message || "Failed to load payment gateways");
      setOwner(args);
      setRules([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refetch(); }, [key, role]);

  const gateways = useMemo(
    () => resolveGatewayRules(rules, owner, args.context, canSeePilotGateways),
    [rules, owner, args.context, canSeePilotGateways],
  );

  const fallbackGateways = useMemo<PaymentGateway[]>(() => {
    if (gateways.length > 0 || loading) return gateways;
    return [{
      gateway: "icici",
      display_name: "ICICI Bank PG",
      is_staff_pilot_only: false,
      priority: DEFAULT_GATEWAY_ORDER.icici,
    }, {
      gateway: "razorpay",
      display_name: "Razorpay",
      is_staff_pilot_only: false,
      priority: DEFAULT_GATEWAY_ORDER.razorpay,
    }, {
      gateway: "easebuzz",
      display_name: "EaseBuzz",
      is_staff_pilot_only: false,
      priority: DEFAULT_GATEWAY_ORDER.easebuzz,
    }];
  }, [gateways, loading, error]);

  return {
    gateways: fallbackGateways,
    loading,
    error,
    refetch,
    owner,
  };
}
