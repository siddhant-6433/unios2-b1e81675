import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  onSuccess: () => void;
}

export function AddSecondaryCounsellorDialog({ open, onOpenChange, leadId, leadName, onSuccess }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [counsellors, setCounsellors] = useState<any[]>([]);
  const [existing, setExisting] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) fetchData();
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    const [profilesRes, existingRes] = await Promise.all([
      supabase.from("profiles").select("id, display_name"),
      supabase.from("lead_counsellors").select("*, profiles:counsellor_id(display_name)").eq("lead_id", leadId),
    ]);
    if (profilesRes.data) setCounsellors(profilesRes.data);
    if (existingRes.data) setExisting(existingRes.data);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!selectedId) return;
    setSaving(true);
    const { error } = await supabase.from("lead_counsellors").insert({
      lead_id: leadId,
      counsellor_id: selectedId,
      role: "secondary",
      added_by: user?.id || null,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      await supabase.from("lead_activities").insert({
        lead_id: leadId, user_id: user?.id || null, type: "info_update",
        description: `Secondary counsellor added: ${counsellors.find(c => c.id === selectedId)?.display_name || "Unknown"}`,
      });
      toast({ title: "Secondary counsellor added" });
      setSelectedId("");
      onSuccess();
      fetchData();
    }
    setSaving(false);
  };

  const handleRemove = async (id: string) => {
    await supabase.from("lead_counsellors").delete().eq("id", id);
    toast({ title: "Counsellor removed" });
    onSuccess();
    fetchData();
  };

  const existingIds = existing.map(e => e.counsellor_id);
  const available = counsellors.filter(c => !existingIds.includes(c.id));

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Secondary Counsellors — {leadName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4 mt-2">
            {existing.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-2">Currently assigned</label>
                <div className="flex flex-wrap gap-2">
                  {existing.map(e => (
                    <Badge key={e.id} variant="secondary" className="gap-1.5 pr-1">
                      {(e.profiles as any)?.display_name || "Unknown"}
                      <button onClick={() => handleRemove(e.id)} className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Add counsellor</label>
              <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className={inputCls}>
                <option value="">Select a counsellor...</option>
                {available.map(c => (
                  <option key={c.id} value={c.id}>{c.display_name || "Unnamed"}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={handleAdd} disabled={saving || !selectedId} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
