// Expenses & Reimbursements — the HR pillar page.
//
// A thin shell: the work is in ExpenseReviewPanel, which owns the inbox, the
// decision RPCs and the summary cards. Registering this route is the only wiring
// the router needs.

import { ExpenseReviewPanel } from "@/components/hr/ExpenseReviewPanel";

export default function HrExpenses() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Expenses &amp; Reimbursements</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review employee expense claims, approve or reject them, and mark approved claims reimbursed.
        </p>
      </div>
      <ExpenseReviewPanel />
    </div>
  );
}
