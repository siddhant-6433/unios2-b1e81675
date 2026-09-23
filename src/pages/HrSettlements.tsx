// Full & Final — the HR pillar page.
//
// A thin shell: the work is in SettlementPanel, which lists the exits, computes
// the itemised statement through the database RPCs and drives finalize/mark-paid.
// Registering the route is the only wiring the router needs.

import { SettlementPanel } from "@/components/hr/SettlementPanel";

export default function HrSettlements() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Full &amp; Final</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compute, review and settle the dues of departing employees — final salary, leave encashment,
          gratuity, notice recovery and outstanding advances.
        </p>
      </div>
      <SettlementPanel />
    </div>
  );
}
