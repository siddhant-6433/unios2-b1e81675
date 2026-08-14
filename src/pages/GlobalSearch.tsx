import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useNavigate } from "react-router-dom";
import { Search as SearchIcon, User, FileText, GraduationCap, Briefcase, Phone, Hash } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Badge } from "@/components/ui/badge";

/** Exactly what employee_directory_card is allowed to return. */
type DirectoryCard = Database["public"]["Functions"]["employee_directory_card"]["Returns"][number];

interface SearchResult {
  type: "lead" | "student" | "employee";
  id: string;
  name: string;
  phone: string;
  identifier?: string;
  identifierLabel?: string;
  stage?: string;
  status?: string;
  /** Employees only: "Nursing Tutor · NIMT School". */
  subtitle?: string;
}

const GlobalSearch = () => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const navigate = useNavigate();

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);

    // Colleagues come from employee_directory_card, whose return signature is the
    // privacy boundary — name, designation, location, employee number, contact.
    const [leadsRes, studentsRes, employeesRes] = await Promise.all([
      supabase.from("leads").select("id, name, phone, email, application_id, pre_admission_no, admission_no, stage")
        .or(`phone.ilike.%${q}%,name.ilike.%${q}%,application_id.ilike.%${q}%,pre_admission_no.ilike.%${q}%,admission_no.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(20),
      supabase.from("students").select("id, name, phone, email, admission_no, pre_admission_no, status")
        .or(`phone.ilike.%${q}%,name.ilike.%${q}%,admission_no.ilike.%${q}%,pre_admission_no.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(20),
      supabase.rpc("employee_directory_card", { _q: q }),
    ]);

    const allResults: SearchResult[] = [];

    (leadsRes.data || []).forEach((l) => {
      allResults.push({
        type: "lead", id: l.id, name: l.name, phone: l.phone,
        identifier: l.application_id || l.pre_admission_no || l.admission_no || undefined,
        identifierLabel: l.admission_no ? "AN" : l.pre_admission_no ? "PAN" : l.application_id ? "App" : undefined,
        stage: l.stage,
      });
    });

    (studentsRes.data || []).forEach((s) => {
      // Avoid duplicates if same person exists as lead and student
      if (!allResults.find(r => r.type === "student" && r.name === s.name && r.phone === s.phone)) {
        allResults.push({
          type: "student", id: s.id, name: s.name, phone: s.phone || "",
          identifier: s.admission_no || s.pre_admission_no || undefined,
          identifierLabel: s.admission_no ? "AN" : s.pre_admission_no ? "PAN" : undefined,
          status: s.status,
        });
      }
    });

    (employeesRes.data || []).forEach((e: DirectoryCard) => {
      allResults.push({
        type: "employee", id: e.employee_profile_id, name: e.display_name || "(no name)",
        phone: e.mobile_number || "",
        identifier: e.employee_number || undefined,
        identifierLabel: e.employee_number ? "ID" : undefined,
        subtitle: [e.job_title, e.work_location].filter(Boolean).join(" \u00b7 "),
      });
    });

    setResults(allResults);
    setLoading(false);
  };

  const handleClick = (r: SearchResult) => {
    if (r.type === "lead") navigate(`/admissions/${r.id}`);
    else if (r.type === "employee") navigate(`/employee/${r.id}`);
    else navigate("/students");
  };

  const stageLabels: Record<string, string> = {
    new_lead: "New Lead", ai_called: "AI Called", counsellor_call: "In Follow Up",
    visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
    token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected", ineligible: "Ineligible", dnc: "Do Not Contact", deferred: "Deferred (Next Session)",
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Global Search</h1>
        <p className="text-sm text-muted-foreground mt-1">Search across leads, applications, and students</p>
      </div>

      <div className="flex gap-2 max-w-2xl">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, phone, application ID, PAN, admission number..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-full rounded-xl border border-input bg-card py-3 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="rounded-xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <ButtonOrb state="working" onFilled /> : <SearchIcon className="h-4 w-4" />}
          Search
        </button>
      </div>

      {searched && (
        <div>
          <p className="text-sm text-muted-foreground mb-3">{results.length} result{results.length !== 1 ? "s" : ""} found</p>
          {results.length === 0 ? (
            <Card className="border-border/60"><CardContent className="py-16 text-center">
              <SearchIcon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No records found for "{query}"</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {results.map((r) => (
                <Card key={`${r.type}-${r.id}`} className="border-border/60 hover:shadow-sm transition-shadow cursor-pointer" onClick={() => handleClick(r)}>
                  <CardContent className="p-4 flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                      r.type === "lead" ? "bg-pastel-orange" : r.type === "employee" ? "bg-pastel-green" : "bg-pastel-blue"}`}>
                      {r.type === "lead" ? <User className="h-5 w-5 text-foreground/70" />
                        : r.type === "employee" ? <Briefcase className="h-5 w-5 text-foreground/70" />
                        : <GraduationCap className="h-5 w-5 text-foreground/70" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{r.name}</p>
                        <Badge variant="outline" className="text-[10px] capitalize">{r.type}</Badge>
                        {r.stage && <Badge className="text-[10px] border-0 bg-muted text-muted-foreground">{stageLabels[r.stage] || r.stage}</Badge>}
                        {r.status && <Badge className="text-[10px] border-0 bg-muted text-muted-foreground capitalize">{r.status}</Badge>}
                      </div>
                      {r.subtitle && <p className="mt-0.5 text-xs text-muted-foreground truncate">{r.subtitle}</p>}
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        {r.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone}</span>}
                        {r.identifier && (
                          <span className="flex items-center gap-1 font-mono text-primary">
                            <Hash className="h-3 w-3" />{r.identifierLabel}: {r.identifier}
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
