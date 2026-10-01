import { ReferralsPanel } from "@/components/hr/ReferralsPanel";

export default function HrReferrals() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Referrals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Put a candidate forward for an open role. HR tracks them through to hire.
        </p>
      </div>
      <ReferralsPanel />
    </div>
  );
}
