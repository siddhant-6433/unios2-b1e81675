import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Phone, Mail, MapPin, FileText, Building2, User, Globe, UserCheck, Sparkles,
} from "lucide-react";

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New Lead", application_in_progress: "Application In Progress", application_submitted: "Application Submitted",
  ai_called: "AI Called", counsellor_call: "Counsellor Call",
  visit_scheduled: "Visit Scheduled", interview: "Interview", offer_sent: "Offer Sent",
  token_paid: "Token Paid", pre_admitted: "Pre-Admitted", admitted: "Admitted", rejected: "Rejected",
};

interface LeadInfoCardProps {
  lead: any;
  counsellorName?: string;
  courseName?: string;
  campusName?: string;
  onStageChange: (stage: string) => void;
}

export function LeadInfoCard({ lead, counsellorName, courseName, campusName, onStageChange }: LeadInfoCardProps) {
  const initials = lead.name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Card className="border-border/60 overflow-hidden">
      <CardContent className="p-0">
        {/* Avatar + Name */}
        <div className="flex items-center gap-4 p-5 pb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-lg font-bold text-primary shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground truncate">{lead.name}</h2>
            <p className="text-sm text-muted-foreground">{lead.phone}</p>
          </div>
        </div>

        {/* Current Stage */}
        <div className="px-5 pb-4">
          <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Current Stage</label>
          <select
            value={lead.stage}
            onChange={(e) => onStageChange(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            {Object.entries(STAGE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {/* Info rows */}
        <div className="border-t border-border divide-y divide-border">
          {courseName && (
            <InfoRow icon={<FileText className="h-4 w-4" />} label="Course" value={courseName} />
          )}
          {campusName && (
            <InfoRow icon={<Building2 className="h-4 w-4" />} label="Campus" value={campusName} />
          )}
          {lead.email && (
            <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={lead.email} />
          )}
          <InfoRow icon={<Globe className="h-4 w-4" />} label="Source" value={lead.source?.replace(/_/g, " ")} className="capitalize" />
          {counsellorName && (
            <InfoRow icon={<UserCheck className="h-4 w-4" />} label="Assigned to" value={counsellorName} />
          )}
          {lead.guardian_name && (
            <InfoRow icon={<User className="h-4 w-4" />} label="Guardian" value={`${lead.guardian_name}${lead.guardian_phone ? ` · ${lead.guardian_phone}` : ""}`} />
          )}
          {(lead.pre_admission_no || lead.admission_no) && (
            <div className="px-5 py-3 flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex gap-2 flex-wrap">
                {lead.pre_admission_no && <Badge variant="outline" className="text-xs text-primary border-primary/30">PAN: {lead.pre_admission_no}</Badge>}
                {lead.admission_no && <Badge className="text-xs bg-primary text-primary-foreground">AN: {lead.admission_no}</Badge>}
              </div>
            </div>
          )}
        </div>

        {/* Interest Level (mock based on interview score) */}
        {lead.interview_score != null && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Interest Level</span>
            <Badge
              className={`text-xs border-0 ${
                lead.interview_score >= 7 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : lead.interview_score >= 4 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              }`}
            >
              {lead.interview_score >= 7 ? "High" : lead.interview_score >= 4 ? "Medium" : "Low"}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({ icon, label, value, className }: { icon: React.ReactNode; label: string; value: string; className?: string }) {
  return (
    <div className="px-5 py-3 flex items-start gap-3">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={`text-sm font-medium text-foreground mt-0.5 ${className || ""}`}>{value}</p>
      </div>
    </div>
  );
}
