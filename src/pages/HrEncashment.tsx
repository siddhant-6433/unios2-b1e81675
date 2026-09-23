// Leave Encashment — the HR pillar page.
//
// A thin shell: the work is in EncashmentPanel, which owns the inbox view, the
// decision/payment RPCs and the summary cards. Registering this route is the only
// wiring the router needs.

import { EncashmentPanel } from "@/components/hr/EncashmentPanel";

export default function HrEncashment() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Leave Encashment</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review employee requests to cash out unused paid leave, approve or reject them, and mark approved encashments paid.
        </p>
      </div>
      <EncashmentPanel />
    </div>
  );
}
