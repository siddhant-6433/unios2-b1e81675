import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, ExternalLink, Phone, Mail, User, ShieldAlert } from "lucide-react";

interface DuplicateMatch {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  stage: string;
  source: string;
  created_at: string;
  match_score: number;
  match_reasons: string[];
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

const REASON_CONFIG: Record<string, { label: string; icon: typeof Phone; color: string }> = {
  exact_phone:    { label: "Same phone",      icon: Phone,       color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  guardian_phone: { label: "Guardian phone",   icon: ShieldAlert, color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  exact_email:    { label: "Same email",       icon: Mail,        color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  similar_email:  { label: "Similar email",    icon: Mail,        color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  similar_name:   { label: "Similar name",     icon: User,        color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  weak_name:      { label: "Name overlap",     icon: User,        color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

function confidenceLabel(score: number): { text: string; color: string } {
  if (score >= 0.70) return { text: "Very likely duplicate", color: "text-red-600 dark:text-red-400" };
  if (score >= 0.50) return { text: "Likely duplicate", color: "text-orange-600 dark:text-orange-400" };
  if (score >= 0.30) return { text: "Possible duplicate", color: "text-amber-600 dark:text-amber-400" };
  return { text: "Low confidence", color: "text-muted-foreground" };
}

interface Props {
  leadId: string;
  leadName: string;
  leadPhone?: string;
  leadEmail?: string;
}

export function FuzzyDuplicateAlert({ leadId, leadName, leadPhone, leadEmail }: Props) {
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);

  useEffect(() => {
    if (!leadName && !leadPhone && !leadEmail) return;

    (async () => {
      const { data, error } = await supabase.rpc("find_lead_duplicates" as any, {
        p_lead_id: leadId,
        p_name: leadName || null,
        p_phone: leadPhone || null,
        p_email: leadEmail || null,
        p_limit: 8,
      });
      if (error) {
        // Fallback to old name-only function if new one doesn't exist yet
        const { data: fallback } = await supabase.rpc("find_name_duplicates" as any, {
          p_name: leadName,
          p_exclude_id: leadId,
          p_threshold: 0.4,
        });
        if (fallback) {
          setMatches((fallback as any[]).slice(0, 5).map((m: any) => ({
            ...m,
            email: null,
            source: "",
            created_at: "",
            match_score: m.similarity,
            match_reasons: ["similar_name"],
          })));
        }
        return;
      }
      if (data) setMatches(data as DuplicateMatch[]);
    })();
  }, [leadId, leadName, leadPhone, leadEmail]);

  if (matches.length === 0) return null;

  const topScore = matches[0]?.match_score ?? 0;
  const confidence = confidenceLabel(topScore);
  const borderColor = topScore >= 0.50 ? "border-red-300 dark:border-red-800/40" : "border-amber-200 dark:border-amber-800/40";
  const bgColor = topScore >= 0.50 ? "bg-red-50/50 dark:bg-red-950/10" : "bg-amber-50/50 dark:bg-amber-950/10";

  return (
    <Card className={`${borderColor} ${bgColor}`}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-amber-600" />
          <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
            Possible Duplicates ({matches.length})
          </h3>
          <span className={`text-[10px] font-medium ml-auto ${confidence.color}`}>{confidence.text}</span>
        </div>
        <div className="space-y-1.5">
          {matches.map((m) => (
            <a
              key={m.id}
              href={`/admissions/${m.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-card border border-border/50 px-3 py-2 hover:bg-muted/50 transition-colors group"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium text-foreground truncate">{m.name}</span>
                  <Badge variant="outline" className="text-[9px]">{STAGE_LABELS[m.stage] || m.stage}</Badge>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {m.phone && <span className="text-[10px] text-muted-foreground font-mono">{m.phone}</span>}
                  {m.email && <span className="text-[10px] text-muted-foreground">{m.email}</span>}
                </div>
                {/* Match reason badges */}
                <div className="flex flex-wrap gap-1 mt-1">
                  {m.match_reasons.map((reason) => {
                    const cfg = REASON_CONFIG[reason];
                    if (!cfg) return null;
                    const Icon = cfg.icon;
                    return (
                      <Badge key={reason} className={`text-[8px] px-1.5 py-0 border-0 gap-0.5 ${cfg.color}`}>
                        <Icon className="h-2.5 w-2.5" />
                        {cfg.label}
                      </Badge>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Badge className={`border-0 text-[9px] font-semibold ${
                  m.match_score >= 0.50 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                }`}>
                  {Math.round(m.match_score * 100)}%
                </Badge>
                <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
