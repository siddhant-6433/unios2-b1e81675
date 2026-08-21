// Generate and re-read HR letters for one employee.
//
// The rendered text is stored at issue time, not re-rendered on view. An experience
// letter is a legal statement about someone's employment — if the employee's record
// changes next year, the letter they hold must still say what it said.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { FileText, Printer } from "lucide-react";

interface Template { code: string; name: string }
type LetterStatus = "draft" | "pending_approval" | "approved" | "rejected" | "issued";
interface Letter {
  id: string; letter_name: string; subject: string | null; body: string;
  reference_no: string | null; issued_on: string;
  status: LetterStatus; rejection_reason: string | null;
}

const STATUS_BADGE: Record<LetterStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  issued: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};
const STATUS_LABEL: Record<LetterStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  issued: "Issued",
  rejected: "Rejected",
};

export function LettersPanel({ employeeProfileId }: { employeeProfileId: string }) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Letter | null>(null);

  const fetchLetters = useCallback(async () => {
    const { data } = await (supabase.from("hr_letters" as any) as any)
      .select("id, letter_name, subject, body, reference_no, issued_on, status, rejection_reason")
      .eq("employee_profile_id", employeeProfileId)
      .order("issued_on", { ascending: false });
    setLetters((data as Letter[]) ?? []);
  }, [employeeProfileId]);

  useEffect(() => {
    supabase.from("hr_letter_templates").select("code, name").eq("is_active", true).order("name")
      .then(({ data }) => {
        const list = (data as Template[]) ?? [];
        setTemplates(list);
        setCode((c) => c || list[0]?.code || "");
      });
    fetchLetters();
  }, [fetchLetters]);

  const generate = async () => {
    if (!code) return;
    setBusy(true);
    const { data, error } = await (supabase as any).rpc("generate_hr_letter", {
      _employee_profile_id: employeeProfileId, _template_code: code,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not generate the letter", description: error.message, variant: "destructive" });
      return;
    }
    // ponytail: don't trust the RPC's return shape for status — refetch and let the badge drive it
    const status = (data && typeof data === "object" ? (data as any).status : null) as LetterStatus | null;
    const ready = status === "approved" || status === "issued";
    toast({ title: ready ? "Letter ready to issue" : "Submitted for approval",
      description: ready ? undefined : "A super admin needs to approve this document before it can be printed." });
    await fetchLetters();
  };

  // Printing opens the stored text in its own window: no PDF pipeline needed for a
  // plain letter, and the browser's print dialog already saves as PDF.
  const openPrintWindow = (l: Letter, body: string) => {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    w.document.write(`<html><head><title>${l.reference_no || l.letter_name}</title>
      <style>body{font-family:Georgia,serif;line-height:1.7;padding:56px;white-space:pre-wrap;max-width:42em}
      h1{font-size:15px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}
      .ref{color:#666;font-size:12px;margin-bottom:32px}</style></head><body>
      <h1>${l.letter_name}</h1><div class="ref">Ref: ${l.reference_no ?? "—"} · ${l.issued_on}</div>
      ${body.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))}
      </body></html>`);
    w.document.close();
    w.print();
  };

  // Print/download must go through issue_hr_document: it enforces the approval gate
  // server-side and flips the row to "issued" on success.
  const print = async (l: Letter) => {
    const { data, error } = await (supabase as any).rpc("issue_hr_document", { _letter_id: l.id });
    if (error) {
      toast({ title: "Could not issue the document", description: error.message, variant: "destructive" });
      return;
    }
    const body = typeof data === "string" ? data : l.body;
    openPrintWindow(l, body);
    await fetchLetters();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[11px] font-medium text-muted-foreground mb-1">Letter type</label>
          <select value={code} onChange={(e) => setCode(e.target.value)}
            className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
            {templates.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </div>
        <Button size="sm" disabled={busy || !code} onClick={generate}>
          <FileText className="h-4 w-4 mr-1.5" /> Generate
        </Button>
      </div>

      {letters.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No letters issued yet. Generating one fills in the employee's name, designation,
          joining date, legal entity and current salary.
        </p>
      ) : (
        <div className="rounded-xl border border-border divide-y divide-border">
          {letters.map((l) => (
            <div key={l.id} className="flex items-center gap-3 p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-foreground">{l.letter_name}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_BADGE[l.status] ?? STATUS_BADGE.draft}`}>
                    {STATUS_LABEL[l.status] ?? "Draft"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {l.reference_no} · issued {l.issued_on}
                </p>
                {l.status === "rejected" && l.rejection_reason && (
                  <p className="text-[11px] text-red-700 mt-0.5">{l.rejection_reason}</p>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(open?.id === l.id ? null : l)}>
                {open?.id === l.id ? "Hide" : "View"}
              </Button>
              {(l.status === "approved" || l.status === "issued") && (
                <Button size="sm" variant="outline" onClick={() => print(l)}>
                  <Printer className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <pre className="rounded-xl border border-border bg-muted/30 p-4 text-xs whitespace-pre-wrap font-serif leading-relaxed">
          {open.body}
        </pre>
      )}
    </div>
  );
}

export default LettersPanel;
