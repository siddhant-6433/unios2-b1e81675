import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Plus } from "lucide-react";

interface NextFollowupProps {
  followups: any[];
  onSchedule: () => void;
}

export function NextFollowup({ followups, onSchedule }: NextFollowupProps) {
  const pending = followups.find((f) => f.status === "pending");

  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Next Follow-up</h3>
          {!pending && (
            <Button onClick={onSchedule} size="sm" variant="ghost" className="text-xs gap-1 h-7 text-primary hover:text-primary">
              <Plus className="h-3.5 w-3.5" /> Set
            </Button>
          )}
        </div>
        {pending ? (
          <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/10 rounded-xl p-3">
            <Clock className="h-4 w-4 text-amber-500 shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {new Date(pending.scheduled_at).toLocaleString("en-IN", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
              {pending.notes && <p className="text-xs text-muted-foreground mt-0.5">{pending.notes}</p>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No follow-up scheduled</p>
        )}
      </CardContent>
    </Card>
  );
}
