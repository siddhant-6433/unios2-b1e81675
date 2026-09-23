import { PerformancePanel } from "@/components/hr/PerformancePanel";

// HR performance management. The panel owns its own tabs and permission gate —
// this is just the page heading so the route reads like the rest of the HR
// section.
const HrPerformance = () => (
  <div className="space-y-6 animate-fade-in">
    <div>
      <h1 className="text-2xl font-bold text-foreground">Performance</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Review cycles, appraisals and goals
      </p>
    </div>
    <PerformancePanel />
  </div>
);

export default HrPerformance;
