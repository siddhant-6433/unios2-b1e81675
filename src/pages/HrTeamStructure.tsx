import { TeamStructurePanel } from "@/components/hr/TeamStructurePanel";

const HrTeamStructure = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Team Structure</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Who reports to whom across campuses and departments. Set each employee's reporting
          manager here — expense approvals route through this line.
        </p>
      </div>

      <TeamStructurePanel />
    </div>
  );
};

export default HrTeamStructure;
