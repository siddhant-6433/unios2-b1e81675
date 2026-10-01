// Custom Fields — the HR pillar page.
//
// A thin shell: the work is in CustomFieldsPanel, which owns the field
// definitions and the per-employee values. Registering this route is the only
// wiring the router needs.

import { CustomFieldsPanel } from "@/components/hr/CustomFieldsPanel";

export default function HrCustomFields() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Custom Fields</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define extra fields for employee records and record each employee's answers.
        </p>
      </div>
      <CustomFieldsPanel />
    </div>
  );
}
