/**
 * Admin → Users → "Data Access".
 *
 * Assigns the three axes a staff member's data visibility is built from:
 *   • Campus      — stored on profiles.campus (comma-separated names/codes)
 *   • Institution — user_institution_access rows
 *   • Course      — user_course_access rows
 *
 * The values are read back by RLS: user_assigned_campus_ids() for campus and
 * user_can_access_course_scope() for institution/course. Saving replaces the
 * user's institution/course grants with the current selection.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgUnits } from "@/hooks/useOrgUnits";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Check } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** auth.users id — user_institution_access / user_course_access key off this. */
  userId: string;
  /** profiles.id — profiles.campus is keyed off this. */
  profileId: string;
  userName: string;
  userRole: string | null;
  onSaved?: () => void;
}

function CheckRow({ label, checked, onToggle, indent = 0 }: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  indent?: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{ paddingLeft: 12 + indent }}
      className="flex w-full items-center gap-3 rounded-lg py-2 pr-3 text-left text-sm hover:bg-muted/50"
    >
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>
        {checked && <Check className="h-3 w-3" />}
      </span>
      <span className="text-foreground">{label}</span>
    </button>
  );
}

export default function DataAccessDialog({
  open, onClose, userId, profileId, userName, userRole, onSaved,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const org = useOrgUnits();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [campusNames, setCampusNames] = useState<string[]>([]);
  const [institutionIds, setInstitutionIds] = useState<string[]>([]);
  const [courseIds, setCourseIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [profileRes, instRes, courseRes] = await Promise.all([
        supabase.from("profiles").select("campus").eq("id", profileId).maybeSingle(),
        supabase.from("user_institution_access" as any).select("institution_id").eq("user_id", userId),
        supabase.from("user_course_access" as any).select("course_id").eq("user_id", userId),
      ]);
      if (cancelled) return;
      const campus = (profileRes.data as { campus?: string } | null)?.campus || "";
      setCampusNames(campus.split(",").map((s) => s.trim()).filter(Boolean));
      setInstitutionIds(((instRes.data as any[]) || []).map((r) => r.institution_id));
      setCourseIds(((courseRes.data as any[]) || []).map((r) => r.course_id));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, profileId, userId]);

  const toggle = (list: string[], value: string, setter: (v: string[]) => void) =>
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const coursesByInstitution = useMemo(() => {
    return org.institutions.map((inst) => ({
      inst,
      courses: org.coursesForInstitution(inst.id),
    }));
  }, [org.institutions, org.departments, org.courses]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const campusValue = campusNames.length > 0 ? campusNames.join(", ") : null;
      const { error: campusErr } = await supabase.from("profiles").update({ campus: campusValue }).eq("id", profileId);
      if (campusErr) throw campusErr;

      if (userRole) {
        const { error: delInst } = await supabase.from("user_institution_access" as any).delete().eq("user_id", userId);
        if (delInst) throw delInst;
        const { error: delCourse } = await supabase.from("user_course_access" as any).delete().eq("user_id", userId);
        if (delCourse) throw delCourse;

        if (institutionIds.length > 0) {
          const { error } = await supabase.from("user_institution_access" as any).insert(
            institutionIds.map((id) => ({ user_id: userId, institution_id: id, role: userRole, granted_by: user?.id ?? null })),
          );
          if (error) throw error;
        }
        if (courseIds.length > 0) {
          const { error } = await supabase.from("user_course_access" as any).insert(
            courseIds.map((id) => ({ user_id: userId, course_id: id, role: userRole, mode: "allow", granted_by: user?.id ?? null })),
          );
          if (error) throw error;
        }
      }

      toast({ title: "Data access updated", description: `Saved for ${userName}.` });
      onSaved?.();
      onClose();
    } catch (error: any) {
      toast({ title: "Could not save data access", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Data Access — {userName}</DialogTitle>
          <DialogDescription>
            Campuses, institutions and courses this user can see. A campus-admin is scoped to
            campuses; a principal is scoped to campuses, institutions and courses.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading access…</div>
        ) : (
          <div className="grid max-h-[60vh] gap-5 overflow-y-auto py-1 md:grid-cols-2">
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campuses</h4>
              <div className="rounded-xl border border-border/50">
                {org.allCampuses.length === 0 && <p className="p-3 text-sm text-muted-foreground">No campuses</p>}
                {org.allCampuses.map((c) => (
                  <CheckRow key={c.id} label={c.name} checked={campusNames.includes(c.name)}
                    onToggle={() => toggle(campusNames, c.name, setCampusNames)} />
                ))}
              </div>
            </section>

            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Institutions</h4>
              <div className="rounded-xl border border-border/50">
                {org.institutions.length === 0 && <p className="p-3 text-sm text-muted-foreground">No institutions</p>}
                {org.institutions.map((i) => (
                  <CheckRow key={i.id} label={i.name} checked={institutionIds.includes(i.id)}
                    onToggle={() => toggle(institutionIds, i.id, setInstitutionIds)} />
                ))}
              </div>
            </section>

            <section className="md:col-span-2">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Courses</h4>
              <div className="rounded-xl border border-border/50">
                {org.courses.length === 0 && <p className="p-3 text-sm text-muted-foreground">No courses</p>}
                {coursesByInstitution.map(({ inst, courses }) => (
                  <div key={inst.id}>
                    <p className="bg-muted/40 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">{inst.name}</p>
                    {courses.length === 0 && <p className="px-6 py-2 text-xs text-muted-foreground">No courses</p>}
                    {courses.map((c) => (
                      <CheckRow key={c.id} indent={12} label={c.name} checked={courseIds.includes(c.id)}
                        onToggle={() => toggle(courseIds, c.id, setCourseIds)} />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving…" : "Save access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
