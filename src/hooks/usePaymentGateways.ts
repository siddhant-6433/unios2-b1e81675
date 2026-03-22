import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PaymentGateway {
  gateway: string;
  display_name: string;
  is_enabled_fee_collection: boolean;
  is_enabled_portal_payment: boolean;
}

export function usePaymentGateways() {
  const [gateways, setGateways] = useState<PaymentGateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await (supabase as any)
      .from("payment_gateway_config")
      .select("gateway, display_name, is_enabled_fee_collection, is_enabled_portal_payment")
      .order("gateway");
    if (qErr) setError(qErr.message);
    setGateways((data as PaymentGateway[]) || []);
    setLoading(false);
  };

  useEffect(() => { refetch(); }, []);

  return {
    gateways,
    loading,
    error,
    refetch,
    portalGateways: gateways.filter((g) => g.is_enabled_portal_payment),
    feeGateways:    gateways.filter((g) => g.is_enabled_fee_collection),
  };
}
