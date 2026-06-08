import { LeadAssignmentHistory } from "@/components/dashboard/LeadAssignmentHistory";

export default function LeadAssignmentHistoryPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Lead Assignments</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Assignment history by counsellor, source, lead status, and latest call response.
        </p>
      </div>
      <LeadAssignmentHistory limit={300} />
    </div>
  );
}
