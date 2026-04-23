import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ExternalLink } from "lucide-react";

interface DuplicateLead {
  id: string;
  name: string;
  phone: string;
  stage: string;
  created_at: string;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "App In Progress",
  application_fee_paid: "Fee Paid", application_submitted: "Submitted",
  ai_called: "AI Called", counsellor_call: "In Follow Up",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected", ineligible: "Ineligible", dnc: "Do Not Contact", deferred: "Deferred (Next Session)",
};

interface Props {
  phone: string;
  excludeId?: string;
}

export function DuplicateLeadWarning({ phone, excludeId }: Props) {
  const [duplicates, setDuplicates] = useState<DuplicateLead[]>([]);

  const check = useCallback(async () => {
    if (!phone || phone.length < 10) {
      setDuplicates([]);
      return;
    }
    const { data } = await supabase.rpc("find_phone_duplicates" as any, {
      p_phone: phone,
      p_exclude_id: excludeId || null,
    });
    setDuplicates((data || []) as any);
  }, [phone, excludeId]);

  useEffect(() => {
    const timer = setTimeout(check, 500);
    return () => clearTimeout(timer);
  }, [check]);

  if (duplicates.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
        <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
          Duplicate phone number found
        </span>
      </div>
      {duplicates.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-2 rounded-md bg-amber-100/60 dark:bg-amber-900/20 px-2.5 py-1.5">
          <div>
            <span className="text-xs font-medium text-foreground">{d.name}</span>
            <span className="text-[10px] text-muted-foreground ml-2">{STAGE_LABELS[d.stage] || d.stage}</span>
          </div>
          <a
            href={`/admissions/${d.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            View <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      ))}
      <p className="text-[10px] text-amber-700 dark:text-amber-400">
        A lead with this phone number already exists. You can still proceed if this is intentional.
      </p>
    </div>
  );
}
