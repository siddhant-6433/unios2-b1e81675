import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowRightLeft } from "lucide-react";

interface TransferLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  leadNames?: string[];
  onSuccess: () => void;
}

export function TransferLeadDialog({ open, onOpenChange, leadIds, leadNames, onSuccess }: TransferLeadDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [counsellors, setCounsellors] = useState<{ id: string; display_name: string }[]>([]);
  const [selectedCounsellor, setSelectedCounsellor] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedCounsellor("");
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
        .in("user_id", userIds);
      setCounsellors(profiles || []);
    }
    setFetching(false);
  };

  const handleTransfer = async () => {
    if (!selectedCounsellor) return;
    setLoading(true);

    // Get profile id for activity logging
    let profileId: string | null = null;
    if (user?.id) {
      const { data } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
      profileId = data?.id || null;
    }

    const newCounsellorName = counsellors.find(c => c.id === selectedCounsellor)?.display_name || "Unknown";

    for (const leadId of leadIds) {
      // Get old counsellor name
      const { data: leadData } = await supabase.from("leads").select("counsellor_id, name").eq("id", leadId).single();
      let oldName = "Unassigned";
      if (leadData?.counsellor_id) {
        const { data: oldProfile } = await supabase.from("profiles").select("display_name").eq("id", leadData.counsellor_id).single();
        oldName = oldProfile?.display_name || "Unknown";
      }

      // Update counsellor
      const { error } = await supabase.from("leads").update({ counsellor_id: selectedCounsellor }).eq("id", leadId);
      if (error) {
        toast({ title: "Error", description: `Failed to transfer ${leadData?.name || leadId}: ${error.message}`, variant: "destructive" });
        continue;
      }

      // Log activity
      await supabase.from("lead_activities").insert({
        lead_id: leadId,
        user_id: profileId,
        type: "info_update",
        description: `Primary counsellor transferred from "${oldName}" to "${newCounsellorName}"`,
      });
    }

    toast({ title: "Leads transferred", description: `${leadIds.length} lead(s) transferred to ${newCounsellorName}` });
    setLoading(false);
    onOpenChange(false);
    onSuccess();
  };

  const isBulk = leadIds.length > 1;

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
              ? `Transfer ${leadIds.length} selected leads to a new primary counsellor.`
              : `Transfer${leadNames?.[0] ? ` "${leadNames[0]}"` : ""} to a new primary counsellor.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>New Primary Counsellor</Label>
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
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleTransfer} disabled={!selectedCounsellor || loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
