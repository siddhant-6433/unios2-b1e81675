// Job Openings — the HR requisitions pillar page.
//
// A thin shell: the work is in JobOpeningsPanel, which owns the job_openings
// table, the create/edit dialog and the publish/close lifecycle. Registering
// this route is the only wiring the router needs.

import { JobOpeningsPanel } from "@/components/hr/JobOpeningsPanel";

export default function HrJobOpenings() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Job Openings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Draft requisitions, publish them to the careers page, and close them when the role is filled.
        </p>
      </div>
      <JobOpeningsPanel />
    </div>
  );
}
