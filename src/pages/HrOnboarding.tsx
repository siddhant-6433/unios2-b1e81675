// Onboarding — the HR pillar page.
//
// A thin shell: the work is in OnboardingPipelinePanel, which reads the
// pre-employment `employee_profiles` rows, groups them by `onboarding_stage`
// and lets HR advance each hire one stage at a time. Registering the route is
// the only wiring the router needs.

import { OnboardingPipelinePanel } from "@/components/hr/OnboardingPipelinePanel";

export default function HrOnboarding() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Onboarding</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track every candidate from offer to employee — documents, offer generation and signing,
          login creation, then the handoff into the employee directory.
        </p>
      </div>
      <OnboardingPipelinePanel />
    </div>
  );
}
