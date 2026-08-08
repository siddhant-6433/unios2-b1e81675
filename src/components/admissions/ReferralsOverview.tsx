import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrbLoader } from "@/components/ui/thinking-orb";
import { REFERRAL_STATUS_COLORS, REFERRAL_STATUS_LABELS } from "@/lib/leadReferral";
import { Share2 } from "lucide-react";

interface OverviewRow {
  id: string;
  lead_id: string;
  status: string;
  referred_at: string;
  referred_by_name: string | null;
  referral_note: string | null;
  partner_notes: string | null;
  outcome_at: string | null;
  leads: {
    name: string;
    phone: string | null;
    stage: string;
    courses?: { name: string } | null;
    campuses?: { name: string } | null;
    profiles?: { display_name: string } | null;
  } | null;
  academic_partners: { name: string; organization: string | null } | null;
}

const STATUS_ORDER = ["pending", "contacted", "not_reachable", "admitted", "not_admitted"] as const;

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * Super-admin view of every lead referred out to an academic partner, with the
 * outcome the partner reported. Reads lead_referrals directly — the staff SELECT
 * policy is can_view_lead, so a super admin sees all rows.
 */
export function ReferralsOverview() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("lead_referrals" as never)
        .select(
          "id, lead_id, status, referred_at, referred_by_name, referral_note, partner_notes, outcome_at, " +
          "leads:lead_id(name, phone, stage, courses:course_id(name), campuses:campus_id(name), profiles:counsellor_id(display_name)), " +
          "academic_partners:partner_id(name, organization)"
        )
        // ponytail: newest 500 — add pagination if referral volume ever justifies it.
        .order("referred_at", { ascending: false })
        .limit(500);
      if (error) console.error("[lead_referrals overview]", error.message);
      setRows((data || []) as unknown as OverviewRow[]);
      setLoading(false);
    })();
  }, []);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length };
    rows.forEach((r) => { map[r.status] = (map[r.status] || 0) + 1; });
    return map;
  }, [rows]);

  const visible = statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter);

  if (loading) {
    return <OrbLoader label="Loading referrals" className="py-16" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(["all", ...STATUS_ORDER] as const).map((value) => (
          <button
            key={value}
            onClick={() => setStatusFilter(value)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {value === "all" ? "All" : REFERRAL_STATUS_LABELS[value]} ({counts[value] || 0})
          </button>
        ))}
      </div>

      <Card className="border-border/60 shadow-none overflow-hidden"><CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead><tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Lead</th>
              <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Course</th>
              <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Referred to</th>
              <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Referred by</th>
              <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Partner notes</th>
            </tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  className="border-b last:border-0 hover:bg-muted/30 cursor-pointer align-top"
                  onClick={() => navigate(`/admissions/${row.lead_id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.leads?.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{row.leads?.phone || "No phone"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{row.leads?.courses?.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{row.leads?.campuses?.name || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    {row.academic_partners?.organization || row.academic_partners?.name || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs">{row.referred_by_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{fmtDate(row.referred_at)}</div>
                    {row.leads?.profiles?.display_name && (
                      <div className="text-[10px] text-muted-foreground">
                        Counsellor: {row.leads.profiles.display_name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`border-0 text-[10px] ${REFERRAL_STATUS_COLORS[row.status] || "bg-muted text-muted-foreground"}`}>
                      {REFERRAL_STATUS_LABELS[row.status] || row.status}
                    </Badge>
                    {row.outcome_at && (
                      <div className="mt-1 text-[10px] text-muted-foreground">{fmtDate(row.outcome_at)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                      {row.partner_notes || "—"}
                    </div>
                    {row.referral_note && (
                      <div className="mt-1 text-[10px] text-muted-foreground italic">
                        Sent with: {row.referral_note}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  <Share2 className="mx-auto mb-2 h-5 w-5 opacity-50" />
                  No referrals {statusFilter === "all" ? "yet" : `at "${REFERRAL_STATUS_LABELS[statusFilter]}"`}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}
