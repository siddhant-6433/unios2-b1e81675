import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TextField, SelectField, FieldShell } from "@/components/ui/state-fields";
import { Clock, Plus, Check, X, Calendar, MapPin } from "lucide-react";

interface NextFollowupProps {
  followups: any[];
  onSchedule: (data: { scheduled_at: string; type: string; notes: string }) => void;
  campuses?: any[];
  onScheduleVisit?: (data: { visit_date: string; campus_id: string }) => void;
}

export function NextFollowup({ followups, onSchedule, campuses, onScheduleVisit }: NextFollowupProps) {
  const pending = followups.find((f) => f.status === "pending");
  const [showFollowupForm, setShowFollowupForm] = useState(false);
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [followupDate, setFollowupDate] = useState("");
  const [followupType, setFollowupType] = useState("call");
  const [followupNotes, setFollowupNotes] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [visitCampus, setVisitCampus] = useState("");

  const handleAddFollowup = () => {
    if (!followupDate) return;
    onSchedule({ scheduled_at: followupDate, type: followupType, notes: followupNotes });
    setFollowupDate(""); setFollowupNotes(""); setFollowupType("call"); setShowFollowupForm(false);
  };

  const handleAddVisit = () => {
    if (!visitDate) return;
    onScheduleVisit?.({ visit_date: visitDate, campus_id: visitCampus });
    setVisitDate(""); setVisitCampus(""); setShowVisitForm(false);
  };

  return (
    <Card className="border-border/60">
      <CardContent className="p-5 space-y-4">
        {/* Next Follow-up */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Next Follow-up</h3>
            {!pending && !showFollowupForm && (
              <Button onClick={() => setShowFollowupForm(true)} size="sm" variant="ghost" className="text-xs gap-1 h-7 text-primary hover:text-primary">
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
          ) : showFollowupForm ? (
            <div className="space-y-2">
              <FieldShell label="Date & Time" hideLabel>
                <Input type="datetime-local" value={followupDate} onChange={e => setFollowupDate(e.target.value)} />
              </FieldShell>
              <SelectField
                value={followupType}
                onValueChange={setFollowupType}
                options={[
                  { value: "call", label: "Call" },
                  { value: "whatsapp", label: "WhatsApp" },
                  { value: "email", label: "Email" },
                  { value: "visit", label: "Visit" },
                ]}
                label="Type"
                hideLabel
              />
              <TextField
                value={followupNotes}
                onValueChange={setFollowupNotes}
                placeholder="Notes (optional)"
                hideLabel
              />
              <div className="flex gap-2">
                <Button onClick={handleAddFollowup} size="sm" disabled={!followupDate} className="gap-1 h-8 rounded-lg">
                  <Check className="h-3.5 w-3.5" /> Save
                </Button>
                <Button onClick={() => setShowFollowupForm(false)} size="sm" variant="ghost" className="h-8 rounded-lg">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No follow-up scheduled</p>
          )}
        </div>

        {/* Schedule Visit */}
        {onScheduleVisit && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Campus Visit</h3>
              {!showVisitForm && (
                <Button onClick={() => setShowVisitForm(true)} size="sm" variant="ghost" className="text-xs gap-1 h-7 text-primary hover:text-primary">
                  <MapPin className="h-3.5 w-3.5" /> Schedule
                </Button>
              )}
            </div>
            {showVisitForm ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <FieldShell hideLabel>
                    <Input type="date" value={visitDate.split("T")[0] || ""} onChange={e => {
                      const time = visitDate.split("T")[1] || "10:00";
                      setVisitDate(e.target.value ? `${e.target.value}T${time}` : "");
                    }} />
                  </FieldShell>
                  <FieldShell hideLabel>
                    <Input type="time" value={visitDate.split("T")[1] || ""} onChange={e => {
                      const date = visitDate.split("T")[0] || "";
                      if (date) setVisitDate(`${date}T${e.target.value}`);
                    }} className="w-32 shrink-0" />
                  </FieldShell>
                </div>
                {visitDate && (
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(visitDate).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" })}{" "}
                    {new Date(visitDate).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
                  </p>
                )}
                {campuses && campuses.length > 0 && (
                  <SelectField
                    value={visitCampus}
                    onValueChange={setVisitCampus}
                    options={[
                      { value: "", label: "Select campus" },
                      ...campuses.map(c => ({ value: c.id, label: c.name })),
                    ]}
                    hideLabel
                    placeholder="Select campus"
                  />
                )}
                <div className="flex gap-2">
                  <Button onClick={handleAddVisit} size="sm" disabled={!visitDate} className="gap-1 h-8 rounded-lg">
                    <Check className="h-3.5 w-3.5" /> Save
                  </Button>
                  <Button onClick={() => setShowVisitForm(false)} size="sm" variant="ghost" className="h-8 rounded-lg">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
