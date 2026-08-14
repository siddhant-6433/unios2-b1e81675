import { useState, useEffect, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { MessageSquare, Send, Check } from "lucide-react";
import { WhatsAppTemplatePicker } from "@/components/leads/WhatsAppTemplatePicker";
import {
  TEMPLATES,
  useWhatsAppTemplates,
  renderTemplatePreview,
  sendWhatsAppTemplate,
} from "@/components/leads/whatsappTemplates";
import {
  buildTemplateParams,
  resolveCourseTemplateFields,
  type TemplateParamSlot,
} from "@/lib/whatsappTemplateCatalog";

interface SendWhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id: string;
    name: string;
    phone: string;
    application_id?: string | null;
    source?: string | null;
  };
  courseName?: string;
  campusName?: string;
  courseDuration?: number;
  courseType?: string;
  /** Lets the dialog resolve curated course facts, so a hand-sent course_info
   *  says the same thing as the inbox and the website. */
  courseId?: string;
  onSuccess?: () => void;
}

/** Date slots get a bounded native picker instead of free text. */
const isDateSlot = (slot: TemplateParamSlot) => slot.name.endsWith("_date");

/** yyyy-mm-dd in local time, for <input type="date"> min/max/value. */
const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** yyyy-mm-dd → "16 Aug 2026", the readable form we actually send. */
const formatReadableDate = (iso: string) =>
  iso
    ? new Date(`${iso}T00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "";

export function SendWhatsAppDialog({ open, onOpenChange, lead, courseName, campusName, courseDuration, courseType, courseId, onSuccess }: SendWhatsAppDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  /** Values the counsellor typed for slots we could not resolve. */
  const [paramOverrides, setParamOverrides] = useState<Record<string, string>>({});
  /** Raw yyyy-mm-dd backing each date picker (paramOverrides holds the readable form we send). */
  const [dateInputs, setDateInputs] = useState<Record<string, string>>({});

  // A callback can only be scheduled from today through two months out.
  const todayISO = useMemo(() => toISODate(new Date()), []);
  const maxDateISO = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 2);
    return toISODate(d);
  }, []);

  const { allowedKeys, visibleTemplates, templateComponentsByKey, catalogByKey } = useWhatsAppTemplates(open);

  const selectedTmpl = visibleTemplates.find(t => t.key === selectedTemplate) || TEMPLATES.find(t => t.key === selectedTemplate);
  const catalogEntry = selectedTemplate ? catalogByKey.get(selectedTemplate) : undefined;

  // Curated course facts for this lead's course. Without these a hand-sent
  // course_info said "4 years" where every other surface said
  // "4 Years (3 Years + 1 Year Internship)".
  const [curatedCourse, setCuratedCourse] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open || !courseId) { setCuratedCourse({}); return; }
    let cancelled = false;
    (async () => {
      const resolved = await resolveCourseTemplateFields(courseId, lead.name);
      if (!cancelled) setCuratedCourse(resolved);
    })();
    return () => { cancelled = true; };
  }, [open, courseId, lead.name]);

  // Clear typed values when switching templates so one template's answer never
  // leaks into another. Seed the counsellor's own phone as an editable default
  // when the template asks for it, so they can correct it but don't retype it.
  useEffect(() => {
    const hasPhoneSlot = catalogEntry?.paramSlots.some((s) => s.name === "counsellor_phone");
    setParamOverrides(hasPhoneSlot && profile?.phone ? { counsellor_phone: profile.phone } : {});
    setDateInputs({});
  }, [selectedTemplate, catalogEntry, profile?.phone]);

  const leadContext = useMemo(() => ({
    student_name: lead.name,
    course_name: curatedCourse.course_name || courseName,
    campus_name: campusName,
    lead_source: lead.source,
    application_id: lead.application_id,
    // The signature is signed by whoever is sending; frozen, never retyped.
    counsellor_name: profile?.display_name || undefined,
    // Curated wins; the years-only derivation is the fallback.
    duration: curatedCourse.duration || (courseDuration ? `${courseDuration} years` : undefined),
    eligibility: curatedCourse.eligibility,
    approval: curatedCourse.approval,
    video_url: curatedCourse.video_url,
    course_url: curatedCourse.course_url,
  }), [lead.name, lead.source, lead.application_id, courseName, campusName, courseDuration, curatedCourse, profile?.display_name]);

  /**
   * Meta's placeholder_count is the authority — whatsapp-send validates the
   * outgoing array against it. Fill from curated facts and let the counsellor
   * type the rest; never substitute an invented value.
   */
  const { params: sendParams, missingSlots } = useMemo(() => {
    if (!catalogEntry) return { params: undefined as string[] | undefined, missingSlots: [] as TemplateParamSlot[] };
    const built = buildTemplateParams(catalogEntry, leadContext, paramOverrides);
    // A hardcoded buildParams that happens to match the real arity is still
    // acceptable for the legacy keys.
    const legacy = selectedTmpl?.buildParams(lead, courseName, campusName, courseDuration, courseType) || [];
    if (built.missing.length && legacy.length === catalogEntry.paramSlots.length) {
      return { params: legacy, missingSlots: [] as TemplateParamSlot[] };
    }
    return { params: built.params, missingSlots: built.missing };
  }, [catalogEntry, leadContext, paramOverrides, selectedTmpl, lead, courseName, campusName, courseDuration, courseType]);

  // Slots the counsellor sees: everything unresolved, plus their own phone even
  // when prefilled (so they can correct it before sending). counsellor_name stays
  // out — it's resolved from context and frozen.
  const editableSlots = useMemo(() => {
    if (!catalogEntry) return [] as TemplateParamSlot[];
    const missingNames = new Set(missingSlots.map((s) => s.name));
    return catalogEntry.paramSlots.filter(
      (s) => missingNames.has(s.name) || s.name === "counsellor_phone",
    );
  }, [catalogEntry, missingSlots]);

  const previewText = catalogEntry
    ? catalogEntry.preview.replace(/\{\{(\w+)\}\}/g, (whole, name) => {
        const slot = catalogEntry.paramSlots.find((s) => s.name === name);
        return (slot && sendParams?.[slot.index - 1]) || whole;
      })
    : renderTemplatePreview(selectedTmpl, lead, courseName, campusName, courseDuration, courseType);

  const handleSend = async () => {
    if (!selectedTmpl) return;
    setSending(true);
    const result = await sendWhatsAppTemplate({
      template: selectedTmpl, lead, courseName, campusName, courseDuration, courseType,
      catalogEntry, params: sendParams,
    });
    setSending(false);
    if (!result.ok) {
      toast({ title: "Failed to send", description: result.error, variant: "destructive" });
      return;
    }
    setSent(true);
    toast({ title: "WhatsApp sent successfully" });
    setTimeout(() => {
      setSent(false);
      setSelectedTemplate(null);
      onOpenChange(false);
      onSuccess?.();
    }, 1200);
  };

  const handleClose = (v: boolean) => {
    if (!sending) {
      setSelectedTemplate(null);
      setSent(false);
      onOpenChange(v);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-success" />
            Send WhatsApp
          </DialogTitle>
        </DialogHeader>

        {/* Recipient info */}
        <div className="flex items-center justify-between py-2 px-1">
          <div>
            <p className="text-[11px] text-muted-foreground">Sending to</p>
            <p className="text-sm font-medium text-foreground">{lead.name}</p>
          </div>
          <p className="text-sm text-muted-foreground font-mono">{lead.phone}</p>
        </div>

        <WhatsAppTemplatePicker
          allowedKeys={allowedKeys}
          templates={visibleTemplates}
          componentsByKey={templateComponentsByKey}
          selectedKey={selectedTemplate}
          onSelect={setSelectedTemplate}
          previewText={previewText}
        />

        {/* Values Meta requires that we could not resolve from the lead or the
            course record. Asked for rather than invented. */}
        {editableSlots.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Fill in {editableSlots.length} detail{editableSlots.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-2">
              {editableSlots.map((slot) => (
                <div key={slot.name} className="space-y-1">
                  <label className="text-[11px] text-muted-foreground" htmlFor={`wa-param-${slot.name}`}>
                    {slot.label}
                  </label>
                  {isDateSlot(slot) ? (
                    <Input
                      id={`wa-param-${slot.name}`}
                      type="date"
                      className="text-foreground h-9"
                      min={todayISO}
                      max={maxDateISO}
                      value={dateInputs[slot.name] || ""}
                      onChange={(e) => {
                        const iso = e.target.value;
                        setDateInputs((prev) => ({ ...prev, [slot.name]: iso }));
                        setParamOverrides((prev) => ({ ...prev, [slot.name]: formatReadableDate(iso) }));
                      }}
                    />
                  ) : (
                    <Input
                      id={`wa-param-${slot.name}`}
                      className="text-foreground h-9"
                      placeholder={slot.example || slot.label}
                      value={paramOverrides[slot.name] || ""}
                      onChange={(e) => setParamOverrides((prev) => ({ ...prev, [slot.name]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={!selectedTemplate || sending || sent || missingSlots.length > 0}
            className="gap-2 bg-success hover:bg-success/60"
          >
            {sending ? (
              <><ButtonOrb state="connecting" onFilled /> Sending...</>
            ) : sent ? (
              <><Check className="h-4 w-4" /> Sent!</>
            ) : (
              <><Send className="h-4 w-4" /> Send WhatsApp</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
