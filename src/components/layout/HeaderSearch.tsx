import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Search, Loader2, User, GraduationCap, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SearchResult {
  type: "lead" | "student";
  id: string;
  name: string;
  phone: string;
  identifier?: string;
  identifierLabel?: string;
  stage?: string;
  status?: string;
}

const stageLabels: Record<string, string> = {
  new_lead: "New", ai_called: "AI Called", counsellor_call: "In Follow Up",
  visit_scheduled: "Visit", interview: "Interview", offer_sent: "Offer",
  token_paid: "Token", pre_admitted: "Pre-Admit", admitted: "Admitted",
  rejected: "Rejected", not_interested: "Not Int.", ineligible: "Ineligible", dnc: "DNC", deferred: "Deferred",
};

export function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const debounceRef = useRef<number | null>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keyboard shortcut: Ctrl+K or Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const search = async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);

    const [leadsRes, studentsRes] = await Promise.all([
      supabase.from("leads").select("id, name, phone, application_id, pre_admission_no, admission_no, stage")
        .or(`phone.ilike.%${q}%,name.ilike.%${q}%,application_id.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(8),
      supabase.from("students").select("id, name, phone, admission_no, pre_admission_no, status")
        .or(`phone.ilike.%${q}%,name.ilike.%${q}%,admission_no.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(5),
    ]);

    const all: SearchResult[] = [];
    (leadsRes.data || []).forEach(l => {
      all.push({
        type: "lead", id: l.id, name: l.name, phone: l.phone,
        identifier: l.application_id || l.pre_admission_no || l.admission_no || undefined,
        identifierLabel: l.admission_no ? "AN" : l.pre_admission_no ? "PAN" : l.application_id ? "App" : undefined,
        stage: l.stage,
      });
    });
    (studentsRes.data || []).forEach(s => {
      all.push({
        type: "student", id: s.id, name: s.name, phone: s.phone || "",
        identifier: s.admission_no || s.pre_admission_no || undefined,
        identifierLabel: s.admission_no ? "AN" : s.pre_admission_no ? "PAN" : undefined,
        status: s.status,
      });
    });
    setResults(all);
    setLoading(false);
  };

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => search(val), 300);
  };

  const handleClick = (r: SearchResult) => {
    setOpen(false);
    setQuery("");
    setResults([]);
    if (r.type === "lead") navigate(`/admissions/${r.id}`);
    else navigate(`/students/${r.identifier || r.id}`);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
        className="flex items-center gap-2 rounded-xl border border-input bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="hidden sm:inline text-[10px] font-mono bg-muted rounded px-1.5 py-0.5 border border-border/60">⌘K</kbd>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[420px] rounded-xl border border-border bg-card shadow-lg z-50 overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => handleInput(e.target.value)}
              placeholder="Search leads, students, phone, email..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
            {query && !loading && (
              <button onClick={() => { setQuery(""); setResults([]); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Results */}
          <div className="max-h-[320px] overflow-y-auto">
            {results.length === 0 && query.trim() && !loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No results found</div>
            ) : (
              results.map(r => (
                <button
                  key={`${r.type}-${r.id}`}
                  onClick={() => handleClick(r)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${r.type === "lead" ? "bg-blue-100 text-blue-600" : "bg-emerald-100 text-emerald-600"}`}>
                    {r.type === "lead" ? <User className="h-3.5 w-3.5" /> : <GraduationCap className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                      {r.identifierLabel && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 shrink-0">{r.identifierLabel}: {r.identifier}</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{r.phone}</p>
                  </div>
                  {r.stage && (
                    <Badge className="text-[9px] border-0 bg-muted shrink-0">{stageLabels[r.stage] || r.stage}</Badge>
                  )}
                  {r.status && (
                    <Badge className={`text-[9px] border-0 shrink-0 ${r.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-muted"}`}>{r.status}</Badge>
                  )}
                </button>
              ))
            )}
          </div>

          {!query.trim() && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Type to search across leads, students, phone numbers, emails...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
