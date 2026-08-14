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
interface Letter {
  id: string; letter_name: string; subject: string | null; body: string;
  reference_no: string | null; issued_on: string;
}

export function LettersPanel({ employeeProfileId }: { employeeProfileId: string }) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Letter | null>(null);

  const fetchLetters = useCallback(async () => {
    const { data } = await supabase
      .from("hr_letters")
      .select("id, letter_name, subject, body, reference_no, issued_on")
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
    const { error } = await supabase.rpc("generate_hr_letter", {
      _employee_profile_id: employeeProfileId, _template_code: code,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Could not generate the letter", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Letter generated" });
    await fetchLetters();
  };

  // Printing opens the stored text in its own window: no PDF pipeline needed for a
  // plain letter, and the browser's print dialog already saves as PDF.
  const print = (l: Letter) => {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    w.document.write(`<html><head><title>${l.reference_no || l.letter_name}</title>
      <style>body{font-family:Georgia,serif;line-height:1.7;padding:56px;white-space:pre-wrap;max-width:42em}
      h1{font-size:15px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}
      .ref{color:#666;font-size:12px;margin-bottom:32px}</style></head><body>
      <h1>${l.letter_name}</h1><div class="ref">Ref: ${l.reference_no ?? "—"} · ${l.issued_on}</div>
      ${l.body.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))}
      </body></html>`);
    w.document.close();
    w.print();
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
                <p className="text-sm text-foreground">{l.letter_name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {l.reference_no} · issued {l.issued_on}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(open?.id === l.id ? null : l)}>
                {open?.id === l.id ? "Hide" : "View"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => print(l)}>
                <Printer className="h-3.5 w-3.5" />
              </Button>
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
