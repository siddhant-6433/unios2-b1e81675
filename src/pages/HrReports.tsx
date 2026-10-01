import { HrReportsPanel } from "@/components/hr/HrReportsPanel";

const HrReports = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">HR Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Headcount, attendance, leave, payroll cost, attrition, recruitment and expenses — one
          screen, each exportable as CSV.
        </p>
      </div>
      <HrReportsPanel />
    </div>
  );
};

export default HrReports;
