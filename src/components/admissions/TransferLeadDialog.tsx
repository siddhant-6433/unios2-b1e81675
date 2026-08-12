import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ArrowRightLeft } from "lucide-react";

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

/** Sentinel select value — Radix SelectItem cannot use empty string. */
const UNASSIGN_VALUE = "__unassigned__";

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
  const [transferScope, setTransferScope] = useState<TransferScope>("selected");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const isUnassign = selectedCounsellor === UNASSIGN_VALUE;

  useEffect(() => {
    if (open) {
      setSelectedCounsellor("");
      setTransferScope("selected");
      fetchCounsellors();
    }
  }, [open]);

  const fetchCounsellors = async () => {
    setFetching(true);
    // Get all profiles that have counsellor, admission_head, or campus_admin roles
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

  const handleTransfer = async () => {
    if (!selectedCounsellor) return;
    setLoading(true);

    try {
      const idsToTransfer = await resolveLeadIds();
      if (idsToTransfer.length === 0) {
        toast({ title: "No leads selected", description: "Choose at least one lead to transfer.", variant: "destructive" });
        setLoading(false);
        return;
      }

      // Get profile id for activity logging
      let profileId: string | null = null;
      if (user?.id) {
        const { data } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
        profileId = data?.id || null;
      }

      const targetCounsellorId = isUnassign ? null : selectedCounsellor;
      const newCounsellorName = isUnassign
        ? "Unassigned"
        : (counsellors.find(c => c.id === selectedCounsellor)?.display_name || "Unknown");
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
          .update({ counsellor_id: targetCounsellorId })
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
          description: isUnassign
            ? `Primary counsellor unassigned (was "${oldName}")`
            : `Primary counsellor transferred from "${oldName}" to "${newCounsellorName}"`,
        };
      });
      for (let i = 0; i < activities.length; i += 500) {
        await supabase.from("lead_activities").insert(activities.slice(i, i + 500));
      }

      toast({
        title: isUnassign ? "Leads unassigned" : "Leads transferred",
        description: isUnassign
          ? `${transferredCount} lead(s) moved to unassigned (pool / buckets).`
          : `${transferredCount} lead(s) transferred to ${newCounsellorName}`,
      });
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to transfer leads.";
      toast({ title: "Transfer failed", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const isBulk = leadIds.length > 1;
  const canTransferFilteredScope = !!fetchLeadIdsForTransfer && typeof totalMatchingLeads === "number" && totalMatchingLeads > 0;
  const totalPages = canTransferFilteredScope ? Math.ceil((totalMatchingLeads || 0) / pageSize) : 0;
  const pageOptions = Array.from({ length: Math.min(totalPages, 20) }, (_, i) => i + 1);
  const scopeDescription = transferScope === "selected"
    ? `${leadIds.length} selected lead${leadIds.length === 1 ? "" : "s"}`
    : transferScope === "all"
      ? `${totalMatchingLeads || 0} filtered lead${totalMatchingLeads === 1 ? "" : "s"}`
      : (() => {
          const pageCount = Number(transferScope.split(":")[1] || "1");
          const count = Math.min(pageCount * pageSize, totalMatchingLeads || pageCount * pageSize);
          return `First ${count} filtered lead${count === 1 ? "" : "s"}`;
        })();

  const resolveLeadIds = async () => {
    if (transferScope === "selected" || !fetchLeadIdsForTransfer) return leadIds;
    if (transferScope === "all") return fetchLeadIdsForTransfer({ mode: "all" });
    const pageCount = Number(transferScope.split(":")[1] || "1");
    return fetchLeadIdsForTransfer({ mode: "pages", pageCount });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Transfer Lead{isBulk ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            {isBulk
              ? `Transfer ${leadIds.length} selected leads to a new primary counsellor, or unassign them.`
              : `Transfer${leadNames?.[0] ? ` "${leadNames[0]}"` : ""} to a new primary counsellor, or unassign.`}
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
          <div className="space-y-2">
            <Label>New Primary Counsellor</Label>
            <Select value={selectedCounsellor} onValueChange={setSelectedCounsellor} disabled={fetching}>
              <SelectTrigger>
                <SelectValue placeholder={fetching ? "Loading counsellors..." : "Select counsellor or unassign"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGN_VALUE}>
                  Unassign lead{isBulk ? "s" : ""} (no counsellor)
                </SelectItem>
                {counsellors.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.display_name || "Unnamed"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isUnassign && (
              <p className="text-xs text-muted-foreground">
                Clears the primary counsellor. Leads return to the unassigned pool / buckets for others to claim.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button
            onClick={handleTransfer}
            disabled={!selectedCounsellor || loading}
            variant={isUnassign ? "destructive" : "default"}
          >
            {loading && <ButtonOrb state="working" onFilled />}
            {isUnassign ? `Unassign ${scopeDescription}` : `Transfer ${scopeDescription}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
