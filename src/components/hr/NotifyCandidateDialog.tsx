// Ask HR what to tell the candidate before anything is sent.
//
// This replaces a window.confirm that sent whatever the defaults were — which meant
// an interview invite going out saying "to be confirmed" for both the time and the
// place, i.e. an invite to nothing. The time and venue are collected here, and the
// venue is picked from the campuses and offices we already hold addresses for so a
// typo cannot send somebody to a place that does not exist.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { MessageSquare, Mail, MapPin, AlertTriangle } from "lucide-react";
import { STAGE_LABEL, type HiringStage } from "@/lib/hiringStages";

export interface NotifyPayload {
  channels: string[];
  venue_id: string | null;
  variables: Record<string, string>;
}

interface Venue {
  id: string;
  name: string;
  address: string | null;
  map_url: string | null;
  kind: string;
}

interface Props {
  open: boolean;
  stage: HiringStage | null;
  candidate: { name: string | null; email: string | null; phone: string | null } | null;
  onCancel: () => void;
  /** Resolves with null when HR chooses to move the candidate without telling them. */
  onConfirm: (payload: NotifyPayload | null) => void;
  busy?: boolean;
}

const CUSTOM = "__custom__";

/** What each stage actually needs from HR before it can be sent. */
const NEEDS_WHEN = new Set<HiringStage>(["interview"]);
const NEEDS_VENUE = new Set<HiringStage>(["interview", "preboarding"]);
const NEEDS_JOINING = new Set<HiringStage>(["preboarding"]);

export function NotifyCandidateDialog({ open, stage, candidate, onCancel, onConfirm, busy }: Props) {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venueId, setVenueId] = useState<string>("");
  const [customVenue, setCustomVenue] = useState("");
  const [when, setWhen] = useState("");
  const [roundName, setRoundName] = useState("Round 1");
  const [joiningDate, setJoiningDate] = useState("");
  const [wa, setWa] = useState(true);
  const [email, setEmail] = useState(true);

  useEffect(() => {
    if (!open) return;
    setWa(Boolean(candidate?.phone));
    setEmail(Boolean(candidate?.email));
    setWhen(""); setJoiningDate(""); setCustomVenue(""); setRoundName("Round 1");
    void (async () => {
      const { data } = await supabase
        .from("hiring_venues").select("id, name, address, map_url, kind").order("name");
      const list = (data as Venue[]) ?? [];
      setVenues(list);
      setVenueId(list[0]?.id ?? CUSTOM);
    })();
  }, [open, candidate?.phone, candidate?.email]);

  const venue = useMemo(() => venues.find((v) => v.id === venueId) ?? null, [venues, venueId]);
  const isCustom = venueId === CUSTOM;

  if (!stage) return null;

  const needsWhen = NEEDS_WHEN.has(stage);
  const needsVenue = NEEDS_VENUE.has(stage);
  const needsJoining = NEEDS_JOINING.has(stage);

  // A blank time or venue would go out as "to be confirmed", so require them.
  const incomplete =
    (needsWhen && !when) ||
    (needsJoining && !joiningDate) ||
    (needsVenue && isCustom && !customVenue.trim());

  const prettyWhen = when
    ? new Date(when).toLocaleString("en-IN", {
        weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
      })
    : "";
  const prettyJoining = joiningDate
    ? new Date(joiningDate).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : "";

  const send = () => {
    const variables: Record<string, string> = {};
    if (needsWhen) variables.interview_when = prettyWhen;
    if (needsJoining) variables.joining_date = prettyJoining;
    if (needsVenue) {
      variables.round_name = roundName;
      if (isCustom) variables.interview_where = customVenue.trim();
    }
    const channels = [wa && "whatsapp", email && "email"].filter(Boolean) as string[];
    onConfirm({ channels, venue_id: isCustom ? null : venueId, variables });
  };

  const label = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
  const input = "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Tell {candidate?.name || "the candidate"}?</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Moving to <strong className="text-foreground">{STAGE_LABEL[stage]}</strong>.
            {stage === "archived" && " They will receive a short, courteous decline."}
          </p>

          {needsWhen && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Date &amp; time</label>
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>Round</label>
                <input value={roundName} onChange={(e) => setRoundName(e.target.value)}
                  placeholder="Round 1" className={input} />
              </div>
            </div>
          )}

          {needsJoining && (
            <div>
              <label className={label}>Proposed joining date</label>
              <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} className={input} />
            </div>
          )}

          {needsVenue && (
            <div>
              <label className={label}>{stage === "preboarding" ? "Posting location" : "Where"}</label>
              <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={input}>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.kind === "office" ? " (office)" : ""}
                  </option>
                ))}
                <option value={CUSTOM}>Somewhere else…</option>
              </select>

              {isCustom ? (
                <input value={customVenue} onChange={(e) => setCustomVenue(e.target.value)}
                  placeholder="e.g. Online — Google Meet link to follow"
                  className={`${input} mt-2`} />
              ) : venue?.address ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <MapPin className="mt-px h-3 w-3 shrink-0" />
                  {venue.address}
                  {venue.map_url && <span className="text-primary"> · map link included</span>}
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-warning">
                  No address on file — the email will say it follows separately.
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-border p-3 space-y-2">
            <label className={`flex items-center gap-2 text-xs ${!candidate?.phone ? "opacity-50" : ""}`}>
              <input type="checkbox" checked={wa} disabled={!candidate?.phone}
                onChange={(e) => setWa(e.target.checked)} />
              <MessageSquare className="h-3.5 w-3.5" />
              WhatsApp {candidate?.phone ? <span className="text-muted-foreground">{candidate.phone}</span> : <span className="text-muted-foreground">— no number on file</span>}
            </label>
            <label className={`flex items-center gap-2 text-xs ${!candidate?.email ? "opacity-50" : ""}`}>
              <input type="checkbox" checked={email} disabled={!candidate?.email}
                onChange={(e) => setEmail(e.target.checked)} />
              <Mail className="h-3.5 w-3.5" />
              Email {candidate?.email
                ? <span className="text-muted-foreground">{candidate.email} · from hr@nimt.ac.in</span>
                : <span className="text-muted-foreground">— no address on file</span>}
            </label>
            {needsVenue && !isCustom && (
              <p className="text-[10px] text-muted-foreground">
                WhatsApp carries the venue name; the full address and map link go in the email.
              </p>
            )}
          </div>

          {incomplete && (
            <p className="flex items-start gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              Fill these in — leaving them blank sends "to be confirmed" to the candidate.
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button variant="outline" onClick={() => onConfirm(null)} disabled={busy}>
              Move without telling them
            </Button>
            <Button onClick={send} disabled={busy || incomplete || (!wa && !email)}>
              {busy ? <ButtonOrb state="working" onFilled /> : null}
              {busy ? "Sending…" : "Move and send"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NotifyCandidateDialog;
