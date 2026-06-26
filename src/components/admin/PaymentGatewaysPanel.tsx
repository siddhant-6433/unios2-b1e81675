import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CreditCard, Info, Loader2, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react";
import { DEFAULT_GATEWAY_PRIORITY } from "@/lib/paymentGatewayResolver";
import type { GatewayScopeType, PaymentContext, PaymentGateway } from "@/lib/paymentGatewayResolver";

type Rule = {
  id: string;
  payment_context: PaymentContext;
  scope_type: GatewayScopeType;
  scope_id: string | null;
  gateway: string;
  is_enabled: boolean;
  is_staff_pilot_only: boolean;
  priority: number;
};

type Option = { id: string; label: string };

const CONTEXTS: Array<{ value: PaymentContext; label: string }> = [
  { value: "application_fee", label: "Application Fee" },
  { value: "token_fee", label: "Token Fee" },
  { value: "student_fee", label: "Student Fee" },
  { value: "alumni_service", label: "Alumni Service" },
];

const SCOPES: Array<{ value: GatewayScopeType; label: string }> = [
  { value: "global", label: "Global" },
  { value: "institution_group", label: "Institution Group" },
  { value: "campus", label: "Campus" },
  { value: "institution", label: "Institution" },
  { value: "institution_type", label: "School / College" },
];

const TYPE_OPTIONS: Option[] = [
  { id: "school", label: "School" },
  { id: "college", label: "College" },
];

const DEFAULT_GATEWAYS = [
  {
    gateway: "cashfree",
    display_name: "Cashfree Payments",
    is_enabled_fee_collection: true,
    is_enabled_portal_payment: true,
    supports_application_fee: true,
    supports_token_fee: false,
    supports_student_fee: true,
    supports_alumni_service: false,
  },
  {
    gateway: "easebuzz",
    display_name: "EaseBuzz",
    is_enabled_fee_collection: true,
    is_enabled_portal_payment: true,
    supports_application_fee: true,
    supports_token_fee: true,
    supports_student_fee: true,
    supports_alumni_service: true,
  },
  {
    gateway: "icici",
    display_name: "ICICI Bank PG",
    is_enabled_fee_collection: true,
    is_enabled_portal_payment: true,
    supports_application_fee: true,
    supports_token_fee: true,
    supports_student_fee: true,
    supports_alumni_service: true,
  },
  {
    gateway: "razorpay",
    display_name: "Razorpay",
    is_enabled_fee_collection: true,
    is_enabled_portal_payment: true,
    supports_application_fee: true,
    supports_token_fee: true,
    supports_student_fee: true,
    supports_alumni_service: false,
  },
];

export default function PaymentGatewaysPanel() {
  const [context, setContext] = useState<PaymentContext>("application_fee");
  const [scopeType, setScopeType] = useState<GatewayScopeType>("global");
  const [scopeId, setScopeId] = useState<string>("");
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [campuses, setCampuses] = useState<Option[]>([]);
  const [institutions, setInstitutions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const scopeOptions = useMemo(() => {
    if (scopeType === "institution_group") return groups;
    if (scopeType === "campus") return campuses;
    if (scopeType === "institution") return institutions;
    if (scopeType === "institution_type") return TYPE_OPTIONS;
    return [];
  }, [scopeType, groups, campuses, institutions]);

  const normalizedScopeId = scopeType === "global" ? null : scopeId || null;

  const visibleRules = useMemo(
    () => rules.filter((r) => r.payment_context === context && r.scope_type === scopeType && r.scope_id === normalizedScopeId),
    [rules, context, scopeType, normalizedScopeId],
  );

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [gwRes, ruleRes, groupRes, campusRes, instRes] = await Promise.all([
        (supabase as any)
          .from("payment_gateway_config")
          .select("gateway, display_name, is_enabled_fee_collection, is_enabled_portal_payment, supports_application_fee, supports_token_fee, supports_student_fee, supports_alumni_service")
          .order("gateway"),
        (supabase as any)
          .from("payment_gateway_rules")
          .select("id, payment_context, scope_type, scope_id, gateway, is_enabled, is_staff_pilot_only, priority")
          .order("priority"),
        (supabase as any).from("institution_groups").select("id, name, code").order("name"),
        (supabase as any).from("campuses").select("id, name, code").order("name"),
        (supabase as any).from("institutions").select("id, name, code, type").order("name"),
      ]);
      if (gwRes.error) throw gwRes.error;
      if (ruleRes.error) throw ruleRes.error;
      setGateways((gwRes.data || []) as PaymentGateway[]);
      setRules((ruleRes.data || []) as Rule[]);
      setGroups((groupRes.data || []).map((g: any) => ({ id: g.id, label: `${g.name} (${g.code})` })));
      setCampuses((campusRes.data || []).map((c: any) => ({ id: c.id, label: `${c.name} (${c.code})` })));
      setInstitutions((instRes.data || []).map((i: any) => ({ id: i.id, label: `${i.name} (${i.code} · ${i.type})` })));
    } catch (e: any) {
      setError(e?.message || "Failed to load payment gateway rules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    setScopeId("");
  }, [scopeType]);

  const seedGateways = async () => {
    setSaving("seed");
    try {
      for (const gw of DEFAULT_GATEWAYS) {
        const { error } = await (supabase as any)
          .from("payment_gateway_config")
          .upsert(gw, { onConflict: "gateway" });
        if (error) throw error;
      }
      await fetchAll();
      toast({ title: "Gateways seeded", description: "Gateway catalog has been refreshed." });
    } catch (e: any) {
      toast({ title: "Seed failed", description: e?.message || "Could not seed gateways", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const ensureRule = async (gateway: string): Promise<Rule> => {
    const existing = visibleRules.find((r) => r.gateway === gateway);
    if (existing) return existing;
    const { data, error } = await (supabase as any)
      .from("payment_gateway_rules")
      .insert({
        payment_context: context,
        scope_type: scopeType,
        scope_id: normalizedScopeId,
        gateway,
        is_enabled: false,
        is_staff_pilot_only: gateway === "icici",
        priority: DEFAULT_GATEWAY_PRIORITY[gateway] ?? 100,
      })
      .select("id, payment_context, scope_type, scope_id, gateway, is_enabled, is_staff_pilot_only, priority")
      .single();
    if (error) throw error;
    return data as Rule;
  };

  const updateRule = async (
    gateway: string,
    patch: Partial<Pick<Rule, "is_enabled" | "is_staff_pilot_only">>,
  ) => {
    if (scopeType !== "global" && !scopeId) {
      toast({ title: "Choose a scope", description: "Select the group, campus, institution, or type first.", variant: "destructive" });
      return;
    }
    setSaving(`${gateway}-${Object.keys(patch).join("-")}`);
    try {
      const rule = await ensureRule(gateway);
      const { error } = await (supabase as any)
        .from("payment_gateway_rules")
        .update(patch)
        .eq("id", rule.id);
      if (error) throw error;
      await fetchAll();
    } catch (e: any) {
      toast({ title: "Update failed", description: e?.message || "Could not update gateway rule", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Payment Gateways</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure gateways by fee context and organisation scope.
          </p>
        </div>
        <button onClick={fetchAll} className="rounded-lg p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Failed to load scoped gateway rules</p>
            <p className="text-xs text-muted-foreground font-mono">{error}</p>
            <button onClick={seedGateways} disabled={saving === "seed"} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60">
              {saving === "seed" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Seed Gateway Catalog
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {CONTEXTS.map((item) => (
            <button
              key={item.value}
              onClick={() => setContext(item.value)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${context === item.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/50"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Scope</span>
            <select value={scopeType} onChange={(e) => setScopeType(e.target.value as GatewayScopeType)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              {SCOPES.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
            </select>
          </label>

          {scopeType !== "global" && (
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Scope value</span>
              <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                <option value="">Select {SCOPES.find((s) => s.value === scopeType)?.label}</option>
                {scopeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_140px_150px] gap-4 items-center px-4">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gateway</span>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">Enabled</span>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">Staff Pilot</span>
      </div>

      <div className="space-y-3">
        {gateways.map((gw) => {
          const rule = visibleRules.find((r) => r.gateway === gw.gateway);
          const enabled = rule?.is_enabled ?? false;
          const pilotOnly = rule?.is_staff_pilot_only ?? gw.gateway === "icici";
          return (
            <div key={gw.gateway} className="grid grid-cols-[1fr_140px_150px] gap-4 items-center rounded-xl border border-border bg-card px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted shrink-0">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{gw.display_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{gw.gateway}</p>
                </div>
              </div>
              <div className="flex justify-center">
                <ToggleButton
                  enabled={enabled}
                  loading={saving === `${gw.gateway}-is_enabled`}
                  onClick={() => updateRule(gw.gateway, { is_enabled: !enabled })}
                />
              </div>
              <div className="flex justify-center">
                <ToggleButton
                  enabled={pilotOnly}
                  loading={saving === `${gw.gateway}-is_staff_pilot_only`}
                  onClick={() => updateRule(gw.gateway, { is_staff_pilot_only: !pilotOnly })}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 flex gap-3">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Resolution order: institution, campus, institution group, school/college type, then global.</p>
          <p>Staff pilot gateways are visible only to super admins, admission heads, campus admins, and accountants.</p>
          <p>If no matching scoped rule is enabled, the payment UI falls back to global EaseBuzz.</p>
        </div>
      </div>
    </div>
  );
}

function ToggleButton({
  enabled,
  loading,
  onClick,
}: {
  enabled: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        enabled
          ? "bg-primary/10 text-primary hover:bg-primary/20"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : enabled ? (
        <ToggleRight className="h-4 w-4" />
      ) : (
        <ToggleLeft className="h-4 w-4" />
      )}
      {enabled ? "Enabled" : "Disabled"}
    </button>
  );
}
