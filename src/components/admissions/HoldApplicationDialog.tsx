import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, PauseCircle, PlayCircle, MessageCircle } from "lucide-react";
import { type ExamCode, EXAM_DISPLAY_NAMES } from "@/lib/examRegistration";

export interface HoldApplicationTarget {
  id: string;
  application_id: string;
  lead_id: string | null;
  full_name: string;
  phone?: string | null;
  course_name?: string | null;
  /** Course-relevant exam, used to pre-fill the reason + WhatsApp copy. */
  exam_code?: ExamCode | null;
  /** Whether the application is already on hold (dialog switches to "release"). */
  on_hold?: boolean;
  hold_reason?: string | null;
}

interface Props {
  target: HoldApplicationTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Move an application to / out of the "On Hold – Ineligible" stage. Holding
 * sets applications.status='on_hold' + hold_reason and (optionally) sends the
 * application_on_hold_eligibility WhatsApp template so the candidate knows.
 */
export function HoldApplicationDialog({ target, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);

  const examName = target?.exam_code ? EXAM_DISPLAY_NAMES[target.exam_code] : null;
  const isRelease = !!target?.on_hold;

  useEffect(() => {
    if (!target) return;
    setNotify(true);
    setReason(
      target.hold_reason ||
        (examName
          ? `Not registered for the required entrance exam (${examName}) and not eligible / interested in an alternative course.`
          : "Does not meet eligibility criteria and not interested in any other available course."),
    );
  }, [target?.id]);

  if (!target) return null;

  const putOnHold = async () => {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("applications" as any)
      .update({
        status: "on_hold",
        hold_reason: reason.trim() || null,
        held_at: new Date().toISOString(),
        held_by: userData?.user?.id || null,
      })
      .eq("id", target.id);
    if (error) {
      toast({ title: "Couldn't put on hold", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    if (notify && target.phone) {
      try {
        const { error: waErr } = await supabase.functions.invoke("whatsapp-send", {
          body: {
            template_key: "application_on_hold_eligibility",
            phone: target.phone,
            lead_id: target.lead_id,
            params: [
              target.full_name || "there",
              target.course_name || "your course",
              examName || "the required entrance exam",
            ],
          },
        });
        if (waErr) throw waErr;
        toast({ title: "Application put on hold", description: `${target.application_id} · candidate notified on WhatsApp.` });
      } catch (e: any) {
        toast({
          title: "On hold — but WhatsApp not sent",
          description: e?.message || "The `application_on_hold_eligibility` template may not be approved in Meta yet. The hold was still applied.",
          variant: "destructive",
        });
      }
    } else {
      toast({ title: "Application put on hold", description: target.application_id });
    }
    setSaving(false);
    onSaved();
  };

  const releaseHold = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("applications" as any)
      .update({ status: "submitted", hold_reason: null, held_at: null, held_by: null })
      .eq("id", target.id);
    if (error) {
      toast({ title: "Couldn't release hold", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    toast({ title: "Hold released", description: `${target.application_id} is back in the active flow.` });
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isRelease ? <PlayCircle className="h-4 w-4 text-success" /> : <PauseCircle className="h-4 w-4 text-warning-foreground" />}
            {isRelease ? "Release hold" : "Put application on hold"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {target.full_name} · {target.application_id}
            {target.course_name ? ` · ${target.course_name}` : ""}
          </DialogDescription>
        </DialogHeader>

        {isRelease ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            This application is currently on hold
            {target.hold_reason ? <>: <span className="text-foreground">{target.hold_reason}</span></> : "."}
            <br />
            Releasing puts it back into the active application flow (Submission).
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="hold-reason">Reason for hold</Label>
              <Textarea
                id="hold-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Why can't this application be processed?"
              />
            </div>
            <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2.5 cursor-pointer">
              <Checkbox checked={notify} onCheckedChange={(v) => setNotify(!!v)} className="mt-0.5" />
              <span className="text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <MessageCircle className="h-3.5 w-3.5 text-success" /> Notify candidate on WhatsApp
                </span>
                <br />
                Sends the <code className="text-[10px] bg-muted px-1 rounded">application_on_hold_eligibility</code> template
                {examName ? <> mentioning {examName}</> : null}. {target.phone ? `To ${target.phone}.` : "No phone on file — will skip."}
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          {isRelease ? (
            <Button onClick={releaseHold} disabled={saving} className="bg-success hover:bg-success/90">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <PlayCircle className="h-4 w-4 mr-1.5" />}
              Release hold
            </Button>
          ) : (
            <Button onClick={putOnHold} disabled={saving} className="bg-warning hover:bg-warning/60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <PauseCircle className="h-4 w-4 mr-1.5" />}
              Put on hold
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
