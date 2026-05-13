import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ArrowRightLeft } from "lucide-react";

interface StaffOption {
  profile_id: string;
  user_id: string;
  name: string;
  role: string | null;
}

interface Props {
  source: { profileId: string; userId: string; name: string } | null;
  allUsers: StaffOption[];
  onClose: () => void;
  onDone: () => void;
}

export function TransferAccountDialog({ source, allUsers, onClose, onDone }: Props) {
  const { toast } = useToast();
  const [targetProfileId, setTargetProfileId] = useState("");
  const [disableSource, setDisableSource] = useState(true);
  const [leadCount, setLeadCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const [saving, setSaving] = useState(false);

  const targets = allUsers.filter(
    (u) => u.profile_id !== source?.profileId && !u.name.startsWith("Guardian of")
  );

  useEffect(() => {
    if (!source) return;
    setTargetProfileId("");
    setLeadCount(null);
    (async () => {
      setLoadingCount(true);
      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("counsellor_id", source.profileId);
      setLeadCount(count ?? 0);
      setLoadingCount(false);
    })();
  }, [source?.profileId]);

  const handleTransfer = async () => {
    if (!source || !targetProfileId) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("transfer_counsellor_account" as any, {
      source_profile_id: source.profileId,
      target_profile_id: targetProfileId,
      disable_source: disableSource,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Transfer failed", description: error.message, variant: "destructive" });
      return;
    }
    const transferred = (data as any)?.leads_transferred ?? 0;
    const targetName = targets.find((t) => t.profile_id === targetProfileId)?.name ?? "the target";
    toast({
      title: "Transfer complete",
      description: `${transferred} lead${transferred !== 1 ? "s" : ""} moved to ${targetName}.${disableSource ? " Source login disabled." : ""}`,
    });
    onDone();
  };

  return (
    <Dialog open={!!source} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Transfer Account
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
            <p className="text-muted-foreground">Transferring all data from</p>
            <p className="font-semibold text-foreground mt-0.5">{source?.name}</p>
            {loadingCount ? (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Counting leads…</p>
            ) : leadCount !== null ? (
              <p className="text-xs text-muted-foreground mt-1">
                <span className="font-medium text-foreground">{leadCount}</span> lead{leadCount !== 1 ? "s" : ""} will be transferred
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Transfer to</label>
            <select
              value={targetProfileId}
              onChange={(e) => setTargetProfileId(e.target.value)}
              className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <option value="">— Select staff member —</option>
              {targets.map((t) => (
                <option key={t.profile_id} value={t.profile_id}>
                  {t.name}{t.role ? ` (${t.role.replace(/_/g, " ")})` : ""}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={disableSource}
              onChange={(e) => setDisableSource(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <span className="text-sm text-foreground">
              Disable <span className="font-medium">{source?.name}</span>'s login after transfer
            </span>
          </label>
        </div>

        <DialogFooter className="gap-2">
          <button onClick={onClose} disabled={saving}
            className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleTransfer}
            disabled={saving || !targetProfileId}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Transfer
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
