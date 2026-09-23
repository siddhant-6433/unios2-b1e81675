import { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchFamilyCbseReports } from "@/lib/cbseExamsClient";
import type { FamilyReport } from "@/lib/cbseExams";
import { isBeaconCourseCode } from "@/lib/cbseExams";

const statusCopy: Record<FamilyReport["status"], { label: string; description: string }> = {
  awaiting_release: { label: "Awaiting release", description: "Your school has not released this report yet." },
  fee_hold: { label: "Fee clearance pending", description: "Please clear outstanding fees or contact the school office." },
  available: { label: "Available", description: "Your report is ready to download." },
  withdrawn: { label: "Correction in progress", description: "The school is reviewing this report. The updated report will appear after release." },
  unavailable: { label: "Temporarily unavailable", description: "Please try again later or contact the school office." },
};

type LinkedChild = { id: string; name: string; admission_no: string | null };

/** Child selection only affects academic reports, never the existing fee/payment context. */
export function FamilyReports({ studentId, selectChild = false }: { studentId: string; selectChild?: boolean }) {
  const { user } = useAuth();
  const [children, setChildren] = useState<LinkedChild[]>([]);
  const [selectedId, setSelectedId] = useState(studentId);
  const [reports, setReports] = useState<FamilyReport[]>([]);
  const [loadedIdentity, setLoadedIdentity] = useState("");
  const [loading, setLoading] = useState(true);
  const [childrenLoading, setChildrenLoading] = useState(selectChild);
  const [error, setError] = useState<string | null>(null);
  const [childrenError, setChildrenError] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const requestIdentity = `${user?.id ?? ""}:${selectedId}`;
  const currentIdentity = useRef(requestIdentity);
  currentIdentity.current = requestIdentity;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => { setSelectedId(studentId); }, [studentId]);

  useEffect(() => {
    let cancelled = false;
    setChildren([]);
    setChildrenError(false);
    if (!selectChild || !user?.id) { setChildrenLoading(false); return; }
    setChildrenLoading(true);
    void (async () => {
      const { data, error: queryError } = await supabase.from("students")
        .select("id,name,admission_no,campuses:campus_id(name),courses:course_id(name,code)")
        .or(`father_user_id.eq.${user.id},mother_user_id.eq.${user.id},guardian_user_id.eq.${user.id},user_id.eq.${user.id}`)
        .order("name");
      if (cancelled) return;
      if (queryError) setChildrenError(true);
      else {
        const linked = (data ?? []).filter(child => isBeaconCourseCode(child.courses?.code));
        setChildren(linked);
        setSelectedId(current => linked.some(child => child.id === current) ? current : linked[0]?.id ?? "");
      }
      setChildrenLoading(false);
    })().catch(() => { if (!cancelled) { setChildrenError(true); setChildrenLoading(false); } });
    return () => { cancelled = true; };
  }, [selectChild, user?.id, refresh]);

  useEffect(() => {
    let cancelled = false;
    setReports([]);
    setError(null);
    setDownloading(null);
    setLoading(true);
    if (!user?.id || !selectedId) { setLoading(false); return; }
    void fetchFamilyCbseReports(selectedId).then(({ data, error: queryError }) => {
      if (cancelled) return;
      if (queryError) setError("Reports could not be loaded. Please retry or contact the school office.");
      else { setReports(data ?? []); setLoadedIdentity(`${user.id}:${selectedId}`); }
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setError("Reports could not be loaded. Please retry."); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [selectedId, user?.id, refresh]);

  const download = async (report: FamilyReport) => {
    const identity = requestIdentity;
    setDownloading(report.id);
    setError(null);
    try {
      const { data, error: downloadError } = await supabase.functions.invoke<Blob>("beacon-report-pdf", {
        body: { report_id: report.id },
      });
      if (!mounted.current || identity !== currentIdentity.current) return;
      if (downloadError || !(data instanceof Blob) || data.type !== "application/pdf") {
        setError("This report is not available for download right now. Refresh to check its latest status.");
        return;
      }
      const url = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `academic-report-${report.id}-r${report.revision}.pdf`;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch {
      if (mounted.current && identity === currentIdentity.current) setError("Download failed. Please retry.");
    } finally {
      if (mounted.current && identity === currentIdentity.current) setDownloading(null);
    }
  };

  return (
    <section aria-label="Academic reports" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-gray-900">Academic reports</h2><p className="text-sm text-gray-500">School examination and annual progress reports</p></div>
        <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading || !!downloading} className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>
      {selectChild && childrenLoading && <p role="status" className="text-sm text-gray-500">Loading linked children…</p>}
      {childrenError && <p role="alert" className="text-sm text-red-700">Linked children could not be loaded. Refresh to try again.</p>}
      {selectChild && children.length > 1 && <div className="space-y-1">
        <label htmlFor="academic-report-child" className="text-sm font-medium">Reports for</label>
        <select id="academic-report-child" value={selectedId} onChange={event => { setSelectedId(event.target.value); setReports([]); setLoading(true); }} className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 sm:max-w-sm">
          {children.map(child => <option value={child.id} key={child.id}>{child.name}{child.admission_no ? ` · ${child.admission_no}` : ""}</option>)}
        </select>
      </div>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading reports…</p> : !error && reports.length === 0 ? <div className="rounded-xl border bg-white p-8 text-center"><FileText className="mx-auto mb-3 h-8 w-8 text-gray-400" /><p className="text-sm text-gray-500">No academic reports are available yet.</p></div> : <ul className="space-y-3">
        {(loadedIdentity === requestIdentity ? reports : []).map(report => {
          const status = statusCopy[report.status] ?? statusCopy.unavailable;
          return <li key={report.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-medium text-gray-900">{report.title}</h3><p className="mt-1 text-xs text-gray-500">{report.academic_year}{report.revision > 0 ? ` · Revision ${report.revision}` : ""}</p></div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${report.status === "available" ? "bg-green-50 text-green-800" : "bg-gray-100 text-gray-700"}`}>{status.label}</span>
            </div>
            <p className="mt-3 text-sm text-gray-600">{status.description}</p>
            {report.status === "available" && <button type="button" disabled={!!downloading} onClick={() => void download(report)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{downloading === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download PDF</button>}
          </li>;
        })}
      </ul>}
    </section>
  );
}
