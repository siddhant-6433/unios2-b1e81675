import { RecruitmentAnalyticsPanel } from "@/components/hr/RecruitmentAnalyticsPanel";

export default function HrRecruitment() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Recruitment Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pipeline, offer outcomes and time-to-hire across the selected period.
        </p>
      </div>
      <RecruitmentAnalyticsPanel />
    </div>
  );
}
