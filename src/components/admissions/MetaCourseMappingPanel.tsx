import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PendingMapping {
  id: string;
  answer_value: string;
  sample_form_name: string | null;
  created_at: string;
}

interface Course {
  id: string;
  name: string;
  code: string;
}

/**
 * Shown only to super_admin on the dashboard. Lists Meta lead-form course
 * answers (e.g. "llb (3 years)") that arrived but couldn't be auto-matched to a
 * course. Admin picks the matching course (or marks Ignore). Mirrors the
 * JustDial category panel — once mapped, future leads with the same answer
 * resolve automatically.
 */
export function MetaCourseMappingPanel() {
  const { toast } = useToast();
  const [pending, setPending] = useState<PendingMapping[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({}); // id → course_id | "__ignore__"
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase
        .from("meta_course_mappings" as any)
        .select("id, answer_value, sample_form_name, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabase.from("courses").select("id, name, code").order("name"),
    ]).then(([pRes, cRes]) => {
      if (pRes.data) setPending(pRes.data as any);
      if (cRes.data) setCourses(cRes.data);
      setLoading(false);
    });
  }, []);

  const handleSave = async (m: PendingMapping) => {
    const val = selected[m.id];
    if (!val) {
      toast({ title: "Select a course first", variant: "destructive" });
      return;
    }
    setSaving((s) => ({ ...s, [m.id]: true }));

    const update =
      val === "__ignore__"
        ? { course_id: null, status: "ignored" as const }
        : { course_id: val, status: "resolved" as const };

    const { error } = await supabase
      .from("meta_course_mappings" as any)
      .update({
        ...update,
        resolved_at: new Date().toISOString(),
        resolved_by: (await supabase.auth.getUser()).data.user?.id,
      })
      .eq("id", m.id);

    setSaving((s) => ({ ...s, [m.id]: false }));
    if (error) {
      toast({ title: "Error saving mapping", description: error.message, variant: "destructive" });
      return;
    }

    setPending((p) => p.filter((x) => x.id !== m.id));
    toast({
      title: "Mapping saved",
      description:
        val === "__ignore__"
          ? `"${m.answer_value}" ignored`
          : `"${m.answer_value}" → ${courses.find((c) => c.id === val)?.name}`,
    });
  };

  if (loading || pending.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-amber-200">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-800">
            Meta Ads: {pending.length} course answer{pending.length === 1 ? "" : "s"} need mapping
          </p>
          <p className="text-[11px] text-amber-700 mt-0.5">
            These course selections came in via Meta lead forms but couldn't be auto-matched to a course.
            Map them so future leads with the same answer resolve automatically.
          </p>
        </div>
      </div>

      <div className="divide-y divide-amber-100">
        {pending.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3 flex-wrap sm:flex-nowrap">
            <div className="shrink-0 min-w-[180px]">
              <p className="text-xs font-semibold text-foreground">{m.answer_value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {m.sample_form_name ? `${m.sample_form_name} · ` : ""}
                First seen {new Date(m.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
            </div>

            <select
              className="flex-1 min-w-[200px] rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-400/30"
              value={selected[m.id] || ""}
              onChange={(e) => setSelected((s) => ({ ...s, [m.id]: e.target.value }))}
            >
              <option value="">— Select course —</option>
              <optgroup label="Courses">
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </optgroup>
              <optgroup label="Other">
                <option value="__ignore__">Ignore (not a course)</option>
              </optgroup>
            </select>

            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                disabled={!selected[m.id] || saving[m.id]}
                onClick={() => handleSave(m)}
                className="gap-1.5 h-8 text-xs bg-amber-600 hover:bg-amber-700"
              >
                {saving[m.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Save
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
