import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, DoorOpen, Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WalkInDialog } from "@/components/visits/WalkInDialog";
import { useToast } from "@/hooks/use-toast";
import { completeWalkIn, fetchLiveWalkIns, walkInElapsed, type LiveWalkIn } from "@/lib/liveWalkIns";
import { ButtonOrb } from "@/components/ui/thinking-orb";

const POLL_MS = 30_000;

export function HeaderWalkIns() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [showRecord, setShowRecord] = useState(false);
  const [rows, setRows] = useState<LiveWalkIn[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await fetchLiveWalkIns());
    } catch {
      // Keep the last known list; a failed poll shouldn't blank the badge.
    }
  }, []);

  useEffect(() => {
    refresh();
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (id === null) id = setInterval(refresh, POLL_MS); };
    const stop = () => { if (id !== null) { clearInterval(id); id = null; } };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { refresh(); start(); } else { stop(); }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refresh]);

  const markComplete = async (row: LiveWalkIn) => {
    setBusyId(row.id);
    try {
      await completeWalkIn(row.id);
      toast({ title: "Walk-in completed", description: `${row.lead_name} has left.` });
      await refresh();
    } catch (err: any) {
      toast({ title: "Could not complete walk-in", description: err?.message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) refresh(); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            title="Live walk-ins"
          >
            <Footprints className="h-3.5 w-3.5" />
            Walk-ins
            {rows.length > 0 && (
              <span className="ml-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
                {rows.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px] p-0" sideOffset={8}>
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
            <div>
              <h3 className="text-sm font-semibold text-foreground">On campus now</h3>
              <p className="text-[11px] text-muted-foreground">{rows.length} live walk-in{rows.length === 1 ? "" : "s"}</p>
            </div>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => { setOpen(false); setShowRecord(true); }}
            >
              <Footprints className="h-3.5 w-3.5" /> Record
            </Button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {rows.length === 0 ? (
              <div className="flex h-24 flex-col items-center justify-center gap-1 px-4 text-center text-sm text-muted-foreground">
                <DoorOpen className="h-4 w-4" />
                No one on campus
              </div>
            ) : (
              rows.map((row) => (
                <div key={row.id} className="flex items-center gap-2 border-b border-border/30 px-3 py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/admissions/${row.lead_id}`}
                      onClick={() => setOpen(false)}
                      className="block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {row.lead_name}
                    </Link>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {row.campus_code || row.campus_name}
                      {row.campus_code && row.campus_name ? ` · ${row.campus_name}` : ""}
                      {" · "}{walkInElapsed(row.checked_in_at)}
                    </p>
                  </div>
                  {row.campus_code && (
                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
                      {row.campus_code}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                    disabled={busyId === row.id}
                    onClick={() => markComplete(row)}
                  >
                    {busyId === row.id ? <ButtonOrb state="working" onFilled /> : <Check className="h-3 w-3" />}
                    Complete
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="border-t px-3 py-2">
            <Link
              to="/visit-center"
              onClick={() => setOpen(false)}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Open Visit Center
            </Link>
          </div>
        </PopoverContent>
      </Popover>

      <WalkInDialog
        open={showRecord}
        onOpenChange={setShowRecord}
        onRecorded={refresh}
      />
    </>
  );
}
