import { OrgChartPanel } from "@/components/hr/OrgChartPanel";

const HrOrg = () => (
  <div className="space-y-6 animate-fade-in">
    <div>
      <h1 className="text-2xl font-bold text-foreground">Org Chart</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Reporting structure across departments and campuses
      </p>
    </div>
    <OrgChartPanel />
  </div>
);

export default HrOrg;
