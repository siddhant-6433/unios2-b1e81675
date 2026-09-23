// Assets & Allocation — the HR pillar page.
//
// A thin shell: the work is in AssetsPanel, which owns the register, the
// allocation RPCs and the summary cards. Registering this route is the only
// wiring the router needs.

import { AssetsPanel } from "@/components/hr/AssetsPanel";

export default function HrAssets() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Assets &amp; Allocation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track every asset in the register, assign it to an employee, and record its return.
        </p>
      </div>
      <AssetsPanel />
    </div>
  );
}
