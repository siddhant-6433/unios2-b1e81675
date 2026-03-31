import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PendingMapping {
  id: string;
  category: string;
  created_at: string;
}

interface Course {
  id: string;
  name: string;
  code: string;
}

/**
 * Shown only to super_admin on the dashboard.
 * Lists JustDial categories that arrived but couldn't be auto-mapped.
 * Admin selects the matching course (or marks as School / Ignore).
 */
export function JdCategoryMappingPanel() {
  const { toast } = useToast();
  const [pending,  setPending]  = useState<PendingMapping[]>([]);
  const [courses,  setCourses]  = useState<Course[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({}); // id → course_id | "__school__" | "__ignore__"
  const [saving,   setSaving]   = useState<Record<string, boolean>>({});
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    Promise.all([
      supabase
        .from("jd_category_mappings")
        .select("id, category, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabase
        .from("courses")
        .select("id, name, code")
        .order("name"),
    ]).then(([pRes, cRes]) => {
      if (pRes.data) setPending(pRes.data);
      if (cRes.data) setCourses(cRes.data);
      setLoading(false);
    });
  }, []);

  const handleSave = async (mapping: PendingMapping) => {
    const val = selected[mapping.id];
    if (!val) {
      toast({ title: "Select an option first", variant: "destructive" });
      return;
    }

    setSaving(s => ({ ...s, [mapping.id]: true }));

    const update =
      val === "__school__"
        ? { is_school: true,  course_id: null, status: "resolved", resolved_at: new Date().toISOString() }
      : val === "__ignore__"
        ? { is_school: false, course_id: null, status: "ignored",  resolved_at: new Date().toISOString() }
        : { is_school: false, course_id: val,  status: "resolved", resolved_at: new Date().toISOString() };

    const { error } = await supabase
      .from("jd_category_mappings")
      .update({ ...update, resolved_by: (await supabase.auth.getUser()).data.user?.id })
      .eq("id", mapping.id);

    setSaving(s => ({ ...s, [mapping.id]: false }));

    if (error) {
      toast({ title: "Error saving mapping", description: error.message, variant: "destructive" });
      return;
    }

    setPending(p => p.filter(m => m.id !== mapping.id));
    toast({
      title: "Mapping saved",
      description:
        val === "__school__" ? `"${mapping.category}" marked as School`
        : val === "__ignore__" ? `"${mapping.category}" ignored`
        : `"${mapping.category}" mapped to ${courses.find(c => c.id === val)?.name}`,
    });
  };

  if (loading || pending.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-amber-200">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-800">
            JustDial: {pending.length} unknown categor{pending.length === 1 ? "y" : "ies"} need mapping
          </p>
          <p className="text-[11px] text-amber-700 mt-0.5">
            These categories arrived via JustDial but couldn't be auto-matched to a course.
            Map them so future leads from the same category are resolved automatically.
          </p>
        </div>
      </div>

      <div className="divide-y divide-amber-100">
        {pending.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3 flex-wrap sm:flex-nowrap">
            {/* Category badge */}
            <div className="shrink-0 min-w-[180px]">
              <p className="text-xs font-semibold text-foreground">{m.category}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                First seen {new Date(m.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
            </div>

            {/* Course selector */}
            <select
              className="flex-1 min-w-[200px] rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-400/30"
              value={selected[m.id] || ""}
              onChange={e => setSelected(s => ({ ...s, [m.id]: e.target.value }))}>
              <option value="">— Select mapping —</option>
              <optgroup label="Courses">
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </optgroup>
              <optgroup label="Other">
                <option value="__school__">School / Grade not applicable</option>
                <option value="__ignore__">Ignore (not relevant)</option>
              </optgroup>
            </select>

            {/* Save / dismiss */}
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                disabled={!selected[m.id] || saving[m.id]}
                onClick={() => handleSave(m)}
                className="gap-1.5 h-8 text-xs bg-amber-600 hover:bg-amber-700">
                {saving[m.id]
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Check className="h-3.5 w-3.5" />}
                Save
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
