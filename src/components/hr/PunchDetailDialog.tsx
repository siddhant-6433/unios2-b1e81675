// Where each punch was taken, and how much to trust it.
//
// Keka opens a Google map with lettered markers. This shows the same facts —
// per-punch time, coordinates, distance from the nearest campus — without pulling in
// a Maps SDK and an API key for a panel HR opens occasionally. Each coordinate links
// out to Google Maps, which is where they would end up anyway.
//
// The selfie and the face/liveness scores are the part Keka does not have and this
// system does: they are the actual evidence that a remote punch was the right person.

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin, ExternalLink, LogIn, LogOut, ShieldCheck, ShieldAlert } from "lucide-react";
import { formatClock, type AttendanceDay } from "@/lib/attendanceDay";
import { classifyPunch, mapsUrl, markerLetter, type CampusPoint } from "@/lib/punchLocation";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: AttendanceDay | null;
  campuses: CampusPoint[];
  employeeName?: string;
}

export function PunchDetailDialog({ open, onOpenChange, day, campuses, employeeName }: Props) {
  if (!day) return null;

  const dayLabel = new Date(day.date).toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" />
            {dayLabel}{employeeName ? ` · ${employeeName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
          {day.pairs.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No punches on this day.</p>
          )}

          {day.pairs.map((pair, i) => {
            const src = pair.source;
            const verdict = classifyPunch(
              { location_lat: src?.location_lat, location_lng: src?.location_lng },
              campuses,
            );
            const lat = src?.location_lat;
            const lng = src?.location_lng;

            return (
              <div key={i} className="rounded-xl border border-border p-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                    {markerLetter(i)}
                  </span>

                  {src?.selfie_url && (
                    // The punch selfie. Small, but it is the thing that answers
                    // "was this actually them".
                    // Framed: these are often shot against a bright wall, and an
                    // unbordered near-white thumbnail reads as an empty gap.
                    <a href={src.selfie_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                      <img src={src.selfie_url} alt="Punch selfie" loading="lazy"
                        className="h-14 w-14 rounded-lg border border-border bg-muted object-cover" />
                    </a>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="flex items-center gap-1 text-foreground">
                        <LogIn className="h-3.5 w-3.5 text-success" /> {formatClock(pair.in)}
                      </span>
                      <span className="flex items-center gap-1 text-foreground">
                        <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
                        {pair.out ? formatClock(pair.out) : <span className="text-warning">still in</span>}
                      </span>
                      {verdict.isRemote && (
                        <span className="rounded-md bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                          Remote
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-[11px] text-muted-foreground">{verdict.label}</p>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                      {lat != null && lng != null && (
                        <a href={mapsUrl(lat, lng)} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 font-mono text-muted-foreground hover:text-primary hover:underline">
                          {lat.toFixed(6)}, {lng.toFixed(6)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {src?.face_match_score != null && (
                        <span className={`flex items-center gap-1 ${
                          src.face_match_result === "match" ? "text-success" : "text-destructive"}`}>
                          {src.face_match_result === "match"
                            ? <ShieldCheck className="h-3 w-3" />
                            : <ShieldAlert className="h-3 w-3" />}
                          Face {src.face_match_score}%
                        </span>
                      )}
                      {src?.liveness_score != null && (
                        <span className="text-muted-foreground">Liveness {src.liveness_score}%</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PunchDetailDialog;
