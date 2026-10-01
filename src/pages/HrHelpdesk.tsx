import { Headphones } from "lucide-react";
import { HelpdeskPanel } from "@/components/hr/HelpdeskPanel";

const HrHelpdesk = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Headphones className="h-6 w-6" /> Helpdesk
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Employee tickets in one queue — triage by priority, reply, and assign.
        </p>
      </div>
      <HelpdeskPanel />
    </div>
  );
};

export default HrHelpdesk;
