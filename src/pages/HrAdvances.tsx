// Advances — the HR pillar page.
//
// A thin shell: the work is in AdvancesPanel, which owns the ledger, the issue
// and recover RPCs and the summary cards. Registering this route is the only
// wiring the router needs.

import { AdvancesPanel } from "@/components/hr/AdvancesPanel";

export default function HrAdvances() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Advances</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Issue salary advances to employees and recover them from payroll or final settlement.
        </p>
      </div>
      <AdvancesPanel />
    </div>
  );
}
