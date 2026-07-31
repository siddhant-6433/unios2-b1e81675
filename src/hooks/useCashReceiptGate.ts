import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Mirrors the DB predicate can_create_cash_receipt() so a cash receipt shows the
// reason (outside 9 AM–6 PM, or the day is closed for the campus) up front,
// instead of failing on the insert. The BEFORE INSERT trigger is the real gate;
// this only fails open for UX, so a query hiccup never wrongly blocks a receipt.
export function useCashReceiptGate(
  open: boolean,
  leadId: string | null | undefined,
  mode: string,
): { blocked: boolean; reason: string | null } {
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (!open || mode !== "cash" || !leadId) { setReason(null); return; }
    let cancelled = false;
    (async () => {
      const { data: lead } = await supabase
        .from("leads").select("campus_id").eq("id", leadId).maybeSingle();
      const { data, error } = await supabase.rpc("can_create_cash_receipt" as any, {
        _campus_id: (lead as { campus_id?: string | null } | null)?.campus_id ?? null,
      });
      if (cancelled) return;
      if (error) { setReason(null); return; }
      const r = data as { allowed: boolean; reason: string | null } | null;
      setReason(r && !r.allowed ? (r.reason || "Cash receipts are currently disabled.") : null);
    })();
    return () => { cancelled = true; };
  }, [open, leadId, mode]);

  return { blocked: !!reason, reason };
}
