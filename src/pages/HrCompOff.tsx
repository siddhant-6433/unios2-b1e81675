// Comp Off — the HR pillar page.
//
// A thin shell: the work is in CompOffPanel, which owns the credit list, the
// grant/decision RPCs and the summary cards. Registering this route is the only
// wiring the router needs.

import { CompOffPanel } from "@/components/hr/CompOffPanel";

export default function HrCompOff() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Comp Off</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Grant compensatory-off credits for extra time worked, and approve or reject the ones raised automatically.
        </p>
      </div>
      <CompOffPanel />
    </div>
  );
}
