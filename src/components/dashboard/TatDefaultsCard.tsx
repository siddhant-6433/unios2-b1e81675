import { useNavigate } from "react-router-dom";
import { useTatDefaults } from "@/hooks/useTatDefaults";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Phone, Clock, FileText, ChevronRight } from "lucide-react";

/**
 * Shows on Overview dashboard:
 * - For counsellors: "Your Pending Actions" card
 * - For admins/team leaders: summary of all counsellor defaults
 */
export function TatDefaultsCard() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const { myDefaults, counsellorsWithDefaults, totalTeamDefaults, loading } = useTatDefaults();

  if (loading) return null;

  const isCounsellor = role === "counsellor";
  const isAdmin = ["super_admin", "campus_admin", "admission_head", "principal"].includes(role || "");

  // Counsellor: show own defaults
  if (isCounsellor && myDefaults && myDefaults.total_defaults > 0) {
    return (
      <Card className="border-destructive/20/60 bg-destructive/5/30 dark:bg-destructive/90/10 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2 text-destructive dark:text-destructive/60">
            <AlertTriangle className="h-4 w-4" />
            Your Pending Actions — {myDefaults.total_defaults}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-3 gap-3">
            {myDefaults.new_leads_overdue > 0 && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10/50 dark:bg-destructive/80/20">
                <Phone className="h-4 w-4 text-destructive shrink-0" />
                <div>
                  <p className="text-lg font-bold text-destructive">{myDefaults.new_leads_overdue}</p>
                  <p className="text-[10px] text-destructive">New leads to contact</p>
                </div>
              </div>
            )}
            {myDefaults.overdue_followups > 0 && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-warning/10/50 dark:bg-warning/80/20">
                <Clock className="h-4 w-4 text-warning-foreground shrink-0" />
                <div>
                  <p className="text-lg font-bold text-warning-foreground">{myDefaults.overdue_followups}</p>
                  <p className="text-[10px] text-warning-foreground">Overdue follow-ups</p>
                </div>
              </div>
            )}
            {myDefaults.app_checkins_overdue > 0 && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-warning/10/50 dark:bg-warning/80/20">
                <FileText className="h-4 w-4 text-warning-foreground shrink-0" />
                <div>
                  <p className="text-lg font-bold text-warning-foreground">{myDefaults.app_checkins_overdue}</p>
                  <p className="text-[10px] text-warning-foreground">App check-ins due</p>
                </div>
              </div>
            )}
          </div>
          <Button size="sm" variant="outline" className="mt-3 w-full border-destructive/20 text-destructive hover:bg-destructive/10" onClick={() => navigate("/admissions")}>
            Go to Leads <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Admin: show team-wide defaults summary
  if (isAdmin && counsellorsWithDefaults.length > 0) {
    return (
      <Card className="border-warning/20/60 bg-warning/5/20 dark:bg-warning/90/10 shadow-none">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2 text-warning-foreground dark:text-warning/70">
            <AlertTriangle className="h-4 w-4" />
            TAT Defaults — {totalTeamDefaults} across {counsellorsWithDefaults.length} counsellor{counsellorsWithDefaults.length > 1 ? "s" : ""}
          </CardTitle>
          <Button size="sm" variant="ghost" className="text-xs text-warning-foreground" onClick={() => navigate("/counsellor-dashboard")}>
            View All <ChevronRight className="h-3 w-3 ml-0.5" />
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-1.5">
            {counsellorsWithDefaults.slice(0, 5).map(d => (
              <div key={d.profile_id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-warning/10/30">
                <span className="text-sm font-medium text-foreground">{d.counsellor_name}</span>
                <div className="flex items-center gap-3 text-xs">
                  {d.new_leads_overdue > 0 && <span className="text-destructive font-semibold">{d.new_leads_overdue} new</span>}
                  {d.overdue_followups > 0 && <span className="text-warning-foreground font-semibold">{d.overdue_followups} FU</span>}
                  {d.app_checkins_overdue > 0 && <span className="text-warning-foreground font-semibold">{d.app_checkins_overdue} app</span>}
                  <span className="font-bold text-foreground bg-destructive/10 dark:bg-destructive/80/30 rounded-full px-2 py-0.5 text-[10px]">{d.total_defaults}</span>
                </div>
              </div>
            ))}
            {counsellorsWithDefaults.length > 5 && (
              <p className="text-[10px] text-muted-foreground text-center pt-1">+{counsellorsWithDefaults.length - 5} more</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
