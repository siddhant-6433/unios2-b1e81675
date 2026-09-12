import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ListPlus } from "lucide-react";
import { insertLeadListMembers, uniqueLeadIds } from "@/lib/leadListMembers";

interface AddToListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onSuccess?: () => void;
}

/**
 * Creates a named lead_lists row from a set of lead ids and links them via the
 * lead_list_members join table — which never touches leads.counsellor_id, so the
 * batch stays grouped without disturbing per-lead ownership or stage. Optionally
 * hands the list to counsellors as a live Cloud Dialer call list.
 *
 * Distilled from Admissions.tsx handleAddSelectedToList (new-list path only).
 */
export function AddToListDialog({ open, onOpenChange, leadIds, onSuccess }: AddToListDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [counsellors, setCounsellors] = useState<{ id: string; display_name: string }[]>([]);
  const [assignAfterCreate, setAssignAfterCreate] = useState(false);
  const [assignCounsellorIds, setAssignCounsellorIds] = useState<string[]>([]);
  const [assignNote, setAssignNote] = useState("");
  const [assignDueDate, setAssignDueDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setAssignAfterCreate(false);
    setAssignCounsellorIds([]);
    setAssignNote("");
    setAssignDueDate("");
    fetchCounsellors();
  }, [open]);

  // Same RPC as LeadLists — assign_lead_list_round_robin only accepts the
  // counsellor role, so mixing in admission heads / admins 400s the hand-off.
  const fetchCounsellors = async () => {
    const { data, error } = await supabase.rpc("assignable_counsellors" as any);
    if (error) {
      console.error("Could not load counsellors:", error);
      setCounsellors([]);
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    setCounsellors(rows.map((item: any) => ({
      id: item.id,
      display_name: item.name || item.display_name || "Unnamed",
    })));
  };

  const uniqueCount = uniqueLeadIds(leadIds).length;

  const toggleCounsellor = (id: string) =>
    setAssignCounsellorIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleCreate = async () => {
    const listName = name.trim();
    if (!listName) {
      toast({ title: "Name required", description: "Give the list a name first.", variant: "destructive" });
      return;
    }

    const targetIds = uniqueLeadIds(leadIds);
    if (targetIds.length === 0) {
      toast({ title: "No leads to add", description: "The current view has no CRM leads to put on a list.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      // Profile id for created_by (auth user id → profiles.id).
      let profileId: string | null = null;
      if (user?.id) {
        const { data } = await supabase.from("profiles").select("id").eq("user_id", user.id).single();
        profileId = data?.id || null;
      }

      const { data: list, error: listErr } = await supabase
        .from("lead_lists" as any)
        .insert({
          name: listName,
          source: "manual",
          description: `Saved from WhatsApp inbox — ${targetIds.length} lead${targetIds.length === 1 ? "" : "s"}`,
          created_by: profileId,
        })
        .select("id, name")
        .single();

      if (listErr || !list) {
        toast({ title: "Could not create list", description: listErr?.message || "Unknown error", variant: "destructive" });
        setSaving(false);
        return;
      }

      const listId = (list as any).id as string;

      // Prefer the server helper (uniques + lead/contact split + skip bad ids).
      // Fall back to the client insert if the RPC is not on this database yet.
      let added = 0;
      let memberErrorMessage = "";
      const { data: rpcData, error: rpcErr } = await supabase.rpc("add_lead_list_members" as any, {
        _list_id: listId,
        _target_ids: targetIds,
      });
      if (!rpcErr) {
        const payload = typeof rpcData === "string" ? JSON.parse(rpcData) : rpcData;
        added = Number(payload?.added || 0);
      } else {
        try {
          const result = await insertLeadListMembers(supabase, listId, targetIds);
          added = result.added;
          memberErrorMessage = result.error || rpcErr.message;
        } catch (insertErr) {
          memberErrorMessage = insertErr instanceof Error ? insertErr.message : rpcErr.message;
        }
      }
      if (added === 0) {
        toast({
          title: "List partially created",
          description: `"${listName}" saved, but no leads could be added${memberErrorMessage ? `: ${memberErrorMessage}` : "."}`,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      // Optional: hand it straight to counsellors as a dialable call list.
      if (assignAfterCreate && assignCounsellorIds.length > 0) {
        const { data: rows, error: assignErr } = await supabase.rpc("assign_lead_list_round_robin" as any, {
          _list_id: listId,
          _counsellor_ids: assignCounsellorIds,
          _only_unassigned: false,
          _priority_note: assignNote.trim() || null,
          _due_date: assignDueDate || null,
          _include_terminal: false,
        });
        if (assignErr) {
          toast({ title: "List created, assignment failed", description: assignErr.message, variant: "destructive" });
          setSaving(false);
          return;
        }
        const assigned = ((rows as any[]) || []).reduce((sum, r) => sum + Number(r.assigned_count || 0), 0);
        toast({
          title: "Call list assigned",
          description: `"${listName}" — ${assigned} lead${assigned === 1 ? "" : "s"} across ${assignCounsellorIds.length} counsellor${assignCounsellorIds.length === 1 ? "" : "s"}. It's live in their Cloud Dialer.`,
        });
      } else {
        toast({
          title: "List created",
          description: `"${listName}" — ${added} lead${added === 1 ? "" : "s"} added.`,
        });
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create list.";
      toast({ title: "Could not create list", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListPlus className="h-5 w-5 text-primary" />
            Create List
          </DialogTitle>
          <DialogDescription>
            Group {uniqueCount} lead{uniqueCount === 1 ? "" : "s"} from the current view into a named
            list. This does not change who each lead is assigned to — it keeps the batch together.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="new-list-name">List name</Label>
            <Input
              id="new-list-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BPT engaged — Sep"
              autoFocus
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="assign-after-create"
              checked={assignAfterCreate}
              onCheckedChange={(v) => setAssignAfterCreate(v === true)}
            />
            <Label htmlFor="assign-after-create" className="cursor-pointer">
              Assign to counsellors as a Cloud Dialer call list
            </Label>
          </div>

          {assignAfterCreate && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="space-y-2">
                <Label>Counsellors (round-robin)</Label>
                <div className="max-h-40 overflow-y-auto space-y-1.5">
                  {counsellors.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={assignCounsellorIds.includes(c.id)}
                        onCheckedChange={() => toggleCounsellor(c.id)}
                      />
                      {c.display_name || "Unnamed"}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="assign-note">Priority note (optional)</Label>
                <Textarea
                  id="assign-note"
                  value={assignNote}
                  onChange={(e) => setAssignNote(e.target.value)}
                  rows={2}
                  placeholder="Why these leads matter / what to say"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assign-due">Due date (optional)</Label>
                <Input
                  id="assign-due"
                  type="date"
                  value={assignDueDate}
                  onChange={(e) => setAssignDueDate(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={saving || !name.trim() || (assignAfterCreate && assignCounsellorIds.length === 0)}
          >
            {saving && <ButtonOrb state="working" onFilled />}
            Create list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
