import { PageLoader } from "@/components/ui/page-loader";
import { ButtonOrb } from "@/components/ui/thinking-orb";
// ConsultantFeeManagementPanel — admin enables/disables (per consultant +
// course + session) the ability for a consultant to hide the fee structure
// from their linked students' logins. Disabling instantly restores the normal
// student view (is_fee_hidden_for_student fails open).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/state-fields";
import { RefreshCw, ToggleLeft, ToggleRight, ShieldCheck, Plus } from "lucide-react";

interface Option { id: string; name: string }
interface ConfigRow {
  id: string;
  consultant_id: string;
  course_id: string;
  session_id: string;
  enabled: boolean;
  enabled_at: string;
  consultant_name: string;
  course_name: string;
  session_name: string;
}

export default function ConsultantFeeManagementPanel() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [consultants, setConsultants] = useState<Option[]>([]);
  const [courses, setCourses] = useState<Option[]>([]);
  const [sessions, setSessions] = useState<Option[]>([]);
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [consultantId, setConsultantId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [sessionId, setSessionId] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    const [cRes, courseRes, sessRes, cfgRes] = await Promise.all([
      supabase.from("consultants").select("id, name").order("name"),
      supabase.from("courses").select("id, name").order("name"),
      supabase.from("admission_sessions").select("id, name").order("start_date", { ascending: false }),
      (supabase.from("consultant_fee_management") as any)
        .select(`id, consultant_id, course_id, session_id, enabled, enabled_at,
          consultants:consultant_id(name), courses:course_id(name), admission_sessions:session_id(name)`)
        .order("enabled_at", { ascending: false }),
    ]);
    setConsultants((cRes.data as Option[]) || []);
    setCourses((courseRes.data as Option[]) || []);
    setSessions((sessRes.data as Option[]) || []);
    setRows(((cfgRes.data as any[]) || []).map((r) => ({
      id: r.id,
      consultant_id: r.consultant_id,
      course_id: r.course_id,
      session_id: r.session_id,
      enabled: r.enabled,
      enabled_at: r.enabled_at,
      consultant_name: r.consultants?.name || "—",
      course_name: r.courses?.name || "—",
      session_name: r.admission_sessions?.name || "—",
    })));
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const addConfig = async () => {
    if (!consultantId || !courseId || !sessionId) {
      toast({ title: "Pick a consultant, course and session", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase.from("consultant_fee_management") as any)
      .upsert({
        consultant_id: consultantId,
        course_id: courseId,
        session_id: sessionId,
        enabled: true,
        enabled_by: profile?.id,
        enabled_at: new Date().toISOString(),
      }, { onConflict: "consultant_id,course_id,session_id" });
    setSaving(false);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Consultant fee management enabled" });
    setConsultantId(""); setCourseId(""); setSessionId("");
    fetchAll();
  };

  const toggle = async (row: ConfigRow) => {
    const { error } = await (supabase.from("consultant_fee_management") as any)
      .update({ enabled: !row.enabled }).eq("id", row.id);
    if (error) { toast({ title: "Could not update", description: error.message, variant: "destructive" }); return; }
    toast({ title: row.enabled ? "Disabled — students see full fees again" : "Enabled" });
    fetchAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4">
        <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          Enable a consultant to hide the fee <span className="font-medium text-foreground">structure</span> from
          their linked students&rsquo; logins, scoped to a course + session. Students still see receipts, a due
          amount, and a Pay button. Disabling instantly restores the normal student view.
        </div>
      </div>

      {/* Add config */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Enable for a consultant</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SelectField
            value={consultantId} onValueChange={setConsultantId}
            options={[{ value: "", label: "Select consultant" }, ...consultants.map((c) => ({ value: c.id, label: c.name }))]}
            label="Consultant" placeholder="Select consultant"
          />
          <SelectField
            value={courseId} onValueChange={setCourseId}
            options={[{ value: "", label: "Select course" }, ...courses.map((c) => ({ value: c.id, label: c.name }))]}
            label="Course" placeholder="Select course"
          />
          <SelectField
            value={sessionId} onValueChange={setSessionId}
            options={[{ value: "", label: "Select session" }, ...sessions.map((s) => ({ value: s.id, label: s.name }))]}
            label="Session" placeholder="Select session"
          />
        </div>
        <Button className="mt-3 gap-2" onClick={addConfig} disabled={saving}>
          {saving ? <ButtonOrb state="working" onFilled /> : <Plus className="h-4 w-4" />}
          Enable
        </Button>
      </div>

      {/* Existing config */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-sm font-semibold text-foreground">Enabled consultants</h3>
          <button onClick={fetchAll} className="text-muted-foreground hover:text-foreground" title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        {loading ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No consultant fee management configured yet.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Consultant</th>
                <th className="px-4 py-2 font-medium">Course</th>
                <th className="px-4 py-2 font-medium">Session</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-medium text-foreground">{r.consultant_name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.course_name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{r.session_name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      r.enabled ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                    }`}>{r.enabled ? "Enabled" : "Disabled"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => toggle(r)}>
                      {r.enabled ? <ToggleRight className="h-4 w-4 text-success" /> : <ToggleLeft className="h-4 w-4" />}
                      {r.enabled ? "Disable" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
