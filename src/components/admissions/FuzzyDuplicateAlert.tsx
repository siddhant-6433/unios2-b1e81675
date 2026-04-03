import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, ExternalLink } from "lucide-react";

interface FuzzyMatch {
  id: string;
  name: string;
  phone: string;
  stage: string;
  similarity: number;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

interface Props {
  leadId: string;
  leadName: string;
}

export function FuzzyDuplicateAlert({ leadId, leadName }: Props) {
  const [matches, setMatches] = useState<FuzzyMatch[]>([]);

  useEffect(() => {
    if (!leadName || leadName.length < 3) return;

    (async () => {
      const { data } = await supabase.rpc("find_name_duplicates" as any, {
        p_name: leadName,
        p_exclude_id: leadId,
        p_threshold: 0.4,
      });
      if (data) setMatches((data as any).slice(0, 5));
    })();
  }, [leadId, leadName]);

  if (matches.length === 0) return null;

  return (
    <Card className="border-amber-200 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/10">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-amber-600" />
          <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
            Possible Duplicates
          </h3>
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
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground truncate">{m.name}</span>
                  <Badge variant="outline" className="text-[9px]">{STAGE_LABELS[m.stage] || m.stage}</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">{m.phone}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0 text-[9px] font-semibold">
                  {Math.round(m.similarity * 100)}% match
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
