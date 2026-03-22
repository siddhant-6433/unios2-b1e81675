import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePaymentGateways, PaymentGateway } from "@/hooks/usePaymentGateways";
import { Loader2, CreditCard, ToggleLeft, ToggleRight, Info } from "lucide-react";

const GATEWAY_LOGOS: Record<string, string> = {
  cashfree: "https://cashfree.com/favicon.ico",
  easebuzz: "https://easebuzz.in/favicon.ico",
};

export default function PaymentGatewaysPanel() {
  const { gateways, loading, refetch } = usePaymentGateways();
  const [saving, setSaving] = useState<string | null>(null);
  const { toast } = useToast();

  const toggle = async (
    gateway: string,
    field: "is_enabled_fee_collection" | "is_enabled_portal_payment",
    current: boolean
  ) => {
    setSaving(`${gateway}-${field}`);
    const { error } = await (supabase as any)
      .from("payment_gateway_config")
      .update({ [field]: !current, updated_at: new Date().toISOString() })
      .eq("gateway", gateway);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      await refetch();
    }
    setSaving(null);
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
      <div>
        <h2 className="text-base font-semibold text-foreground">Payment Gateways</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Control which gateways are available for each payment context.
        </p>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_180px_180px] gap-4 items-center px-4">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gateway</span>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">
          Student Fee Collection
        </span>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">
          Portal Application Payment
        </span>
      </div>

      <div className="space-y-3">
        {gateways.map((gw) => (
          <GatewayRow
            key={gw.gateway}
            gw={gw}
            saving={saving}
            onToggle={toggle}
          />
        ))}

        {gateways.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <CreditCard className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No gateways configured</p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 flex gap-3">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Student Fee Collection</strong> — shown when accountants record or students/parents pay tuition, hostel, and other institutional fees.</p>
          <p><strong>Portal Application Payment</strong> — shown to applicants paying the application processing fee on /apply portals.</p>
          <p>At least one gateway must be active for each context, or payments will be unavailable.</p>
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

function GatewayRow({
  gw,
  saving,
  onToggle,
}: {
  gw: PaymentGateway;
  saving: string | null;
  onToggle: (
    gateway: string,
    field: "is_enabled_fee_collection" | "is_enabled_portal_payment",
    current: boolean
  ) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_180px_180px] gap-4 items-center rounded-xl border border-border bg-card px-4 py-4">
      {/* Gateway identity */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted shrink-0">
          <CreditCard className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{gw.display_name}</p>
          <p className="text-xs text-muted-foreground font-mono">{gw.gateway}</p>
        </div>
      </div>

      {/* Fee collection toggle */}
      <div className="flex justify-center">
        <ToggleButton
          enabled={gw.is_enabled_fee_collection}
          loading={saving === `${gw.gateway}-is_enabled_fee_collection`}
          onClick={() => onToggle(gw.gateway, "is_enabled_fee_collection", gw.is_enabled_fee_collection)}
        />
      </div>

      {/* Portal payment toggle */}
      <div className="flex justify-center">
        <ToggleButton
          enabled={gw.is_enabled_portal_payment}
          loading={saving === `${gw.gateway}-is_enabled_portal_payment`}
          onClick={() => onToggle(gw.gateway, "is_enabled_portal_payment", gw.is_enabled_portal_payment)}
        />
      </div>
    </div>
  );
}
