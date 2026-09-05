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

  // Same role/profile shape as TransferLeadDialog.fetchCounsellors.
  const fetchCounsellors = async () => {
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["counsellor", "admission_head", "campus_admin", "super_admin"]);
    if (roleData && roleData.length > 0) {
      const userIds = roleData.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("user_id", userIds)
        .eq("login_disabled", false);
      setCounsellors(profiles || []);
    }
  };

  const toggleCounsellor = (id: string) =>
    setAssignCounsellorIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleCreate = async () => {
    const listName = name.trim();
    if (!listName) {
      toast({ title: "Name required", description: "Give the list a name first.", variant: "destructive" });
      return;
    }
    if (leadIds.length === 0) {
      toast({ title: "No leads to add", description: "The current view has no leads.", variant: "destructive" });
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
          description: `Saved from WhatsApp inbox — ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"}`,
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

      // Brand-new list — all ids are fresh, so a plain chunked insert is safe
      // (the (list_id, lead_id) unique index is partial and can't be an upsert
      // conflict target; see Admissions.tsx:1148-1157).
      const members = leadIds.map((lead_id) => ({ list_id: listId, lead_id }));
      let memberErrors = 0;
      for (let i = 0; i < members.length; i += 500) {
        const { error: memberErr } = await supabase
          .from("lead_list_members" as any)
          .insert(members.slice(i, i + 500));
        if (memberErr) {
          memberErrors++;
          console.error("List member insert failed:", memberErr);
        }
      }
      if (memberErrors > 0) {
        toast({
          title: "List partially created",
          description: `"${listName}" saved, but up to ${memberErrors * 500} lead(s) could not be added. Check console.`,
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
          description: `"${listName}" — ${leadIds.length} lead${leadIds.length === 1 ? "" : "s"} added.`,
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
            Group {leadIds.length} lead{leadIds.length === 1 ? "" : "s"} from the current view into a named
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
