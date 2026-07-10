import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldCheck, ChevronRight } from "lucide-react";

interface PendingItem {
  kind: "concession" | "offer_letter" | "offer_edit" | "lead_deletion";
  id: string;
  status: string;
  subject_id: string;
  subject_name: string | null;
  detail_type: string | null;
  detail_value: number | null;
  reason: string | null;
  created_at: string;
  pending_role: string | null;
}


export function PendingApprovalsPanel() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const canApprove = ["super_admin", "principal", "campus_admin", "admission_head"].includes(role || "");

  const fetch = async () => {
    if (!canApprove) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("pending_approvals" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    // Client-side filter: only show items the current role can act on
    const filtered = (data || []).filter((item: any) => {
      if (role === "super_admin") return true;
      if (role === "principal") return item.pending_role === "principal";
      if (role === "admission_head") return item.pending_role === "principal";
      if (role === "campus_admin") return item.pending_role === "super_admin";
      return false;
    });

    setItems(filtered as PendingItem[]);
    setLoading(false);
  };

  useEffect(() => {
    fetch();
    // Refresh on concession/offer_letter changes
    const channel = supabase
      .channel("pending-approvals-panel")
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "concessions" }, fetch)
      .on("postgres_changes" as any, { event: "*", schema: "public", table: "offer_letters" }, fetch)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [role]);

  if (!canApprove) return null;
  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <button
      onClick={() => navigate("/inbox")}
      className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg bg-warning/5/60 dark:bg-warning/90/10 border border-warning/20/60 hover:bg-warning/10/50 dark:hover:bg-warning/90/20 transition-colors text-left"
    >
      <ShieldCheck className="h-4 w-4 text-warning-foreground shrink-0" />
      <span className="flex-1 text-sm">
        <span className="font-semibold text-foreground">{items.length} pending approval{items.length !== 1 ? "s" : ""}</span>
        <span className="text-muted-foreground"> — view in Inbox</span>
      </span>
      <ChevronRight className="h-4 w-4 text-warning-foreground/60 shrink-0" />
    </button>
  );
}
