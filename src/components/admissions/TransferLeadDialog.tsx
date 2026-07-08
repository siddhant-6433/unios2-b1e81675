import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowRightLeft, Shuffle } from "lucide-react";

interface TransferLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  leadNames?: string[];
  onSuccess: () => void;
  pageSize?: number;
  totalMatchingLeads?: number;
  fetchLeadIdsForTransfer?: (scope: { mode: "pages" | "all"; pageCount?: number }) => Promise<string[]>;
}

type TransferScope = "selected" | `pages:${number}` | "all";
type TransferMode = "single" | "round_robin";

export function TransferLeadDialog({
  open,
  onOpenChange,
  leadIds,
  leadNames,
  onSuccess,
  pageSize = 50,
  totalMatchingLeads,
  fetchLeadIdsForTransfer,
}: TransferLeadDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [counsellors, setCounsellors] = useState<{ id: string; display_name: string }[]>([]);
  const [selectedCounsellor, setSelectedCounsellor] = useState("");
  const [selectedCounsellors, setSelectedCounsellors] = useState<string[]>([]);
  const [transferScope, setTransferScope] = useState<TransferScope>("selected");
  const [transferMode, setTransferMode] = useState<TransferMode>("single");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedCounsellor("");
      setSelectedCounsellors([]);
      setTransferScope("selected");
      setTransferMode("single");
      fetchCounsellors();
    }
  }, [open]);

  const fetchCounsellors = async () => {
    setFetching(true);
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["counsellor", "admission_head", "campus_admin", "super_admin"]);

    if (roleData && roleData.length > 0) {
      const userIds = roleData.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("user_id", userIds)
        .eq("login_disabled", false);
      setCounsellors(profiles || []);
    }
    setFetching(false);
  };

  const toggleCounsellor = (id: string) => {
    setSelectedCounsellors(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const isBulk = leadIds.length > 1;
  const canTransferFilteredScope = !!fetchLeadIdsForTransfer && typeof totalMatchingLeads === "number" && totalMatchingLeads > 0;
  const totalPages = canTransferFilteredScope ? Math.ceil((totalMatchingLeads || 0) / pageSize) : 0;
  const pageOptions = Array.from({ length: Math.min(totalPages, 20) }, (_, i) => i + 1);
  const scopeDescription = (mode: TransferMode) => {
    const count = transferScope === "selected"
      ? leadIds.length
      : transferScope === "all"
        ? (totalMatchingLeads || 0)
        : Math.min(Number(transferScope.split(":")[1] || "1") * pageSize, totalMatchingLeads || Number(transferScope.split(":")[1] || "1") * pageSize);
    return mode === "round_robin"
      ? `${count} lead${count === 1 ? "" : "s"} (round-robin across ${selectedCounsellors.length} counsellor${selectedCounsellors.length === 1 ? "" : "s"})`
      : `${count} lead${count === 1 ? "" : "s"}`;
  };

  const resolveLeadIds = async () => {
    if (transferScope === "selected" || !fetchLeadIdsForTransfer) return leadIds;
    if (transferScope === "all") return fetchLeadIdsForTransfer({ mode: "all" });
    const pageCount = Number(transferScope.split(":")[1] || "1");
    return fetchLeadIdsForTransfer({ mode: "pages", pageCount });
  };

  const handleTransfer = async () => {
    if (transferMode === "single" && !selectedCounsellor) return;
    if (transferMode === "round_robin" && selectedCounsellors.length === 0) return;
    setLoading(true);

    try {
      const idsToTransfer = await resolveLeadIds();
      if (idsToTransfer.length === 0) {
        toast({ title: "No leads selected", description: "Choose at least one lead to transfer.", variant: "destructive" });
        setLoading(false);
        return;
      }

      let profileId: string | null = null;
      if (user?.id) {
        const { data } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
        profileId = data?.id || null;
      }

      const isRR = transferMode === "round_robin";

      if (isRR) {
        const counsellorsCount = selectedCounsellors.length;
        const nameById = new Map(counsellors.map(c => [c.id, c.display_name || "Unknown"]));
        const oldLeadRows: { id: string; name: string | null; counsellor_id: string | null }[] = [];

        for (let i = 0; i < idsToTransfer.length; i += 500) {
          const chunk = idsToTransfer.slice(i, i + 500);
          const { data, error } = await supabase
            .from("leads")
            .select("id, name, counsellor_id")
            .in("id", chunk);
          if (error) throw error;
          oldLeadRows.push(...((data || []) as any[]));
        }

        const oldCounsellorIds = Array.from(new Set(oldLeadRows.map(l => l.counsellor_id).filter(Boolean) as string[]));
        const oldNamesById = new Map<string, string>();
        if (oldCounsellorIds.length > 0) {
          const { data: oldProfiles } = await supabase
            .from("profiles")
            .select("id, display_name")
            .in("id", oldCounsellorIds);
          (oldProfiles || []).forEach((p: any) => oldNamesById.set(p.id, p.display_name || "Unknown"));
        }

        let transferredCount = 0;
        for (let i = 0; i < idsToTransfer.length; i += 500) {
          const chunk = idsToTransfer.slice(i, i + 500);
          for (let j = 0; j < chunk.length; j++) {
            const targetId = selectedCounsellors[(i + j) % counsellorsCount];
            const { error } = await supabase
              .from("leads")
              .update({ counsellor_id: targetId })
              .eq("id", chunk[j]);
            if (error) throw error;
            transferredCount++;
          }
        }

        const activities = oldLeadRows.map((lead) => {
          const oldName = lead.counsellor_id ? (oldNamesById.get(lead.counsellor_id) || "Unknown") : "Unassigned";
          return {
            lead_id: lead.id,
            user_id: profileId,
            type: "info_update",
            description: `Primary counsellor transferred from "${oldName}" via round-robin`,
          };
        });
        for (let i = 0; i < activities.length; i += 500) {
          await supabase.from("lead_activities").insert(activities.slice(i, i + 500));
        }

        const counsellorNames = selectedCounsellors.map(id => nameById.get(id) || "Unknown").join(", ");
        toast({ title: "Leads transferred", description: `${transferredCount} lead(s) distributed round-robin to: ${counsellorNames}` });
      } else {
        const newCounsellorName = counsellors.find(c => c.id === selectedCounsellor)?.display_name || "Unknown";
        const oldLeadRows: { id: string; name: string | null; counsellor_id: string | null }[] = [];

        for (let i = 0; i < idsToTransfer.length; i += 500) {
          const chunk = idsToTransfer.slice(i, i + 500);
          const { data, error } = await supabase
            .from("leads")
            .select("id, name, counsellor_id")
            .in("id", chunk);
          if (error) throw error;
          oldLeadRows.push(...((data || []) as any[]));
        }

        const oldCounsellorIds = Array.from(new Set(oldLeadRows.map(l => l.counsellor_id).filter(Boolean) as string[]));
        const oldNamesById = new Map<string, string>();
        if (oldCounsellorIds.length > 0) {
          const { data: oldProfiles } = await supabase
            .from("profiles")
            .select("id, display_name")
            .in("id", oldCounsellorIds);
          (oldProfiles || []).forEach((p: any) => oldNamesById.set(p.id, p.display_name || "Unknown"));
        }

        let transferredCount = 0;
        for (let i = 0; i < idsToTransfer.length; i += 500) {
          const chunk = idsToTransfer.slice(i, i + 500);
          const { error } = await supabase
            .from("leads")
            .update({ counsellor_id: selectedCounsellor })
            .in("id", chunk);
          if (error) throw error;
          transferredCount += chunk.length;
        }

        const activities = oldLeadRows.map((lead) => {
          const oldName = lead.counsellor_id ? (oldNamesById.get(lead.counsellor_id) || "Unknown") : "Unassigned";
          return {
            lead_id: lead.id,
            user_id: profileId,
            type: "info_update",
            description: `Primary counsellor transferred from "${oldName}" to "${newCounsellorName}"`,
          };
        });
        for (let i = 0; i < activities.length; i += 500) {
          await supabase.from("lead_activities").insert(activities.slice(i, i + 500));
        }

        toast({ title: "Leads transferred", description: `${transferredCount} lead(s) transferred to ${newCounsellorName}` });
      }

      onOpenChange(false);
      onSuccess();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to transfer leads.";
      toast({ title: "Transfer failed", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Transfer Lead{isBulk || (transferMode === "round_robin" && leadIds.length > 0) ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            {transferMode === "round_robin"
              ? `Distribute ${scopeDescription("round_robin")} equally across selected counsellors.`
              : isBulk
                ? `Transfer ${scopeDescription("single")} to a new primary counsellor.`
                : `Transfer${leadNames?.[0] ? ` "${leadNames[0]}"` : ""} to a new primary counsellor.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {canTransferFilteredScope && (
            <div className="space-y-2">
              <Label>Transfer Scope</Label>
              <Select value={transferScope} onValueChange={(v) => setTransferScope(v as TransferScope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="selected">{leadIds.length} selected lead{leadIds.length === 1 ? "" : "s"}</SelectItem>
                  {pageOptions.map((pages) => {
                    const count = Math.min(pages * pageSize, totalMatchingLeads || pages * pageSize);
                    return (
                      <SelectItem key={pages} value={`pages:${pages}`}>
                        First {count} filtered lead{count === 1 ? "" : "s"} ({pages} page{pages === 1 ? "" : "s"})
                      </SelectItem>
                    );
                  })}
                  <SelectItem value="all">All filtered leads ({totalMatchingLeads})</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Scope uses the current dashboard filters and transfers in batches of {pageSize}.
              </p>
            </div>
          )}

          {isBulk && (
            <div className="space-y-2">
              <Label>Transfer Mode</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTransferMode("single")}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    transferMode === "single"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  Single counsellor
                </button>
                <button
                  type="button"
                  onClick={() => setTransferMode("round_robin")}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    transferMode === "round_robin"
                      ? "border-violet-300 bg-violet-50 text-violet-700"
                      : "border-input bg-background text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <Shuffle className="inline h-3 w-3 mr-1" />
                  Round-robin
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>
              {transferMode === "round_robin" ? "Select Counsellors (round-robin)" : "New Primary Counsellor"}
            </Label>
            {transferMode === "round_robin" ? (
              fetching ? (
                <div className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading counsellors...
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1 rounded-md border border-input p-1">
                  {counsellors.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCounsellor(c.id)}
                      className={`w-full text-left rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                        selectedCounsellors.includes(c.id)
                          ? "bg-violet-100 text-violet-800"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {c.display_name || "Unnamed"}
                    </button>
                  ))}
                  {counsellors.length === 0 && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">No counsellors found</p>
                  )}
                </div>
              )
            ) : (
              <Select value={selectedCounsellor} onValueChange={setSelectedCounsellor} disabled={fetching}>
                <SelectTrigger>
                  <SelectValue placeholder={fetching ? "Loading counsellors..." : "Select counsellor"} />
                </SelectTrigger>
                <SelectContent>
                  {counsellors.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.display_name || "Unnamed"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleTransfer}
            disabled={loading || (transferMode === "single" ? !selectedCounsellor : selectedCounsellors.length === 0)}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {transferMode === "round_robin" ? (
              <><Shuffle className="h-3.5 w-3.5 mr-1.5" /> Distribute {scopeDescription("round_robin")}</>
            ) : (
              <>Transfer {scopeDescription("single")}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
