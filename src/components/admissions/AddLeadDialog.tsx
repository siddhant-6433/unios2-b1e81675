import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";

const SOURCES = [
  { value: "website", label: "Website" }, { value: "meta_ads", label: "Meta Ads" },
  { value: "google_ads", label: "Google Ads" }, { value: "shiksha", label: "Shiksha" },
  { value: "walk_in", label: "Walk-in" }, { value: "consultant", label: "Consultant" },
  { value: "justdial", label: "JustDial" }, { value: "referral", label: "Referral" },
  { value: "education_fair", label: "Education Fair" }, { value: "other", label: "Other" },
] as const;

interface AddLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddLeadDialog({ open, onOpenChange, onSuccess }: AddLeadDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [counsellors, setCounsellors] = useState<{ id: string; display_name: string }[]>([]);

  const [form, setForm] = useState({
    name: "", phone: "", email: "", guardian_name: "", guardian_phone: "",
    source: "website" as string, course_id: "", campus_id: "", counsellor_id: "", notes: "",
  });

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("courses").select("id, name"),
      supabase.from("campuses").select("id, name"),
      supabase.from("profiles").select("id, display_name"),
    ]).then(([c, ca, co]) => {
      if (c.data) setCourses(c.data);
      if (ca.data) setCampuses(ca.data);
      if (co.data) setCounsellors(co.data.filter((p: any) => p.display_name));
    });
  }, [open]);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast({ title: "Required", description: "Name and phone are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("leads").insert({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      guardian_name: form.guardian_name.trim() || null,
      guardian_phone: form.guardian_phone.trim() || null,
      source: form.source as any,
      course_id: form.course_id || null,
      campus_id: form.campus_id || null,
      counsellor_id: form.counsellor_id || null,
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Lead added" });
      setForm({ name: "", phone: "", email: "", guardian_name: "", guardian_phone: "", source: "website", course_id: "", campus_id: "", counsellor_id: "", notes: "" });
      onOpenChange(false);
      onSuccess();
    }
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Name *</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Student name" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Phone *</label>
              <PhoneInput value={form.phone} onChange={phone => setForm(p => ({ ...p, phone }))} required />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Guardian Name</label>
              <input value={form.guardian_name} onChange={e => setForm(p => ({ ...p, guardian_name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Guardian Phone</label>
              <PhoneInput value={form.guardian_phone} onChange={phone => setForm(p => ({ ...p, guardian_phone: phone }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Source</label>
              <select value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value }))} className={inputCls}>
                {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Course</label>
              <select value={form.course_id} onChange={e => setForm(p => ({ ...p, course_id: e.target.value }))} className={inputCls}>
                <option value="">Select course</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Campus</label>
              <select value={form.campus_id} onChange={e => setForm(p => ({ ...p, campus_id: e.target.value }))} className={inputCls}>
                <option value="">Select campus</option>
                {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1">Counsellor</label>
              <select value={form.counsellor_id} onChange={e => setForm(p => ({ ...p, counsellor_id: e.target.value }))} className={inputCls}>
                <option value="">Unassigned</option>
                {counsellors.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Lead
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
