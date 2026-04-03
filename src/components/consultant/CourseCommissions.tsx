import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, Trash2, IndianRupee, Save } from "lucide-react";

interface Commission {
  id: string;
  course_id: string;
  commission_type: string;
  commission_value: number;
  course_name?: string;
}

interface Props {
  consultantId: string;
}

export function CourseCommissions({ consultantId }: Props) {
  const { toast } = useToast();
  const { coursesByDepartment } = useCourseCampusLink();
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newCourseId, setNewCourseId] = useState("");
  const [newType, setNewType] = useState("percentage");
  const [newValue, setNewValue] = useState("");

  const fetchCommissions = async () => {
    const { data } = await supabase
      .from("consultant_commissions" as any)
      .select("*, courses:course_id(name)")
      .eq("consultant_id", consultantId)
      .order("created_at");
    if (data) {
      setCommissions((data as any[]).map(c => ({
        ...c,
        course_name: (c.courses as any)?.name,
      })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchCommissions(); }, [consultantId]);

  const handleAdd = async () => {
    if (!newCourseId || !newValue) return;
    setSaving(true);
    const { error } = await supabase.from("consultant_commissions" as any).insert({
      consultant_id: consultantId,
      course_id: newCourseId,
      commission_type: newType,
      commission_value: parseFloat(newValue),
    } as any);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setNewCourseId(""); setNewValue("");
      fetchCommissions();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("consultant_commissions" as any).delete().eq("id", id);
    fetchCommissions();
  };

  const handleUpdate = async (id: string, type: string, value: number) => {
    await supabase.from("consultant_commissions" as any)
      .update({ commission_type: type, commission_value: value } as any)
      .eq("id", id);
    fetchCommissions();
  };

  // Courses not already assigned
  const assignedCourseIds = new Set(commissions.map(c => c.course_id));
  const inputCls = "rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/20";

  if (loading) return <div className="flex h-10 items-center justify-center"><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Course-wise Commissions</h4>

      {commissions.length > 0 && (
        <div className="space-y-1.5">
          {commissions.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
              <span className="text-xs font-medium text-foreground flex-1 truncate">{c.course_name || c.course_id}</span>
              <select
                value={c.commission_type}
                onChange={(e) => handleUpdate(c.id, e.target.value, c.commission_value)}
                className={`${inputCls} w-24`}
              >
                <option value="percentage">%</option>
                <option value="fixed">Fixed ₹</option>
              </select>
              <input
                type="number"
                value={c.commission_value}
                onChange={(e) => handleUpdate(c.id, c.commission_type, parseFloat(e.target.value) || 0)}
                className={`${inputCls} w-20 text-right`}
              />
              <button onClick={() => handleDelete(c.id)} className="text-muted-foreground hover:text-red-600 p-1">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <select value={newCourseId} onChange={(e) => setNewCourseId(e.target.value)} className={`${inputCls} w-full`}>
            <option value="">Add course...</option>
            {coursesByDepartment.map(g => (
              <optgroup key={g.department} label={g.department}>
                {g.courses.filter(c => !assignedCourseIds.has(c.id)).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <select value={newType} onChange={(e) => setNewType(e.target.value)} className={`${inputCls} w-20`}>
          <option value="percentage">%</option>
          <option value="fixed">Fixed ₹</option>
        </select>
        <input
          type="number"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value"
          className={`${inputCls} w-20 text-right`}
        />
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleAdd} disabled={!newCourseId || !newValue || saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
        </Button>
      </div>

      {commissions.length === 0 && (
        <p className="text-[10px] text-muted-foreground">No course-specific commissions set. The default commission rate from the consultant profile will be used.</p>
      )}
    </div>
  );
}
