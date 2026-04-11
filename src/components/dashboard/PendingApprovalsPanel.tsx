import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, HandCoins, FileText, Trash2, Loader2, ChevronRight } from "lucide-react";

interface PendingItem {
  kind: "concession" | "offer_letter" | "lead_deletion";
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

const KIND_META: Record<string, { label: string; icon: any; color: string; getLink: (i: PendingItem) => string }> = {
  concession: {
    label: "Concession",
    icon: HandCoins,
    color: "text-purple-600 bg-purple-100 dark:bg-purple-900/30",
    getLink: () => "/finance?tab=concessions",
  },
  offer_letter: {
    label: "Offer Letter",
    icon: FileText,
    color: "text-teal-600 bg-teal-100 dark:bg-teal-900/30",
    getLink: (i) => `/admissions/${i.subject_id}`,
  },
  lead_deletion: {
    label: "Lead Deletion",
    icon: Trash2,
    color: "text-red-600 bg-red-100 dark:bg-red-900/30",
    getLink: () => "/admin?tab=deletion-requests",
  },
};

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
  // Hide entirely when nothing is pending
  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <Card className="border-amber-200/60 shadow-none bg-amber-50/30 dark:bg-amber-950/10">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-amber-600" />
          Pending Approvals
          <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/40">
            {items.slice(0, 8).map(item => {
              const meta = KIND_META[item.kind];
              const Icon = meta.icon;
              return (
                <button
                  key={`${item.kind}-${item.id}`}
                  onClick={() => navigate(meta.getLink(item))}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{item.subject_name || "—"}</p>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">{meta.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {item.detail_value && `₹${Number(item.detail_value).toLocaleString("en-IN")}`}
                      {item.reason && ` · ${item.reason}`}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {new Date(item.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                </button>
              );
            })}
            {items.length > 8 && (
              <div className="px-4 py-2 text-center">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                  +{items.length - 8} more
                </Button>
              </div>
            )}
        </div>
      </CardContent>
    </Card>
  );
}
