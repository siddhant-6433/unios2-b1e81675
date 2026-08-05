import { lazy, Suspense } from "react";
import {
  MessageSquareText, BookOpen, MessageCircle, Mail, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { ScriptTab } from "@/components/dialer/rail/ScriptTab";
import { WhatsAppTab } from "@/components/dialer/rail/WhatsAppTab";
import { EmailTab } from "@/components/dialer/rail/EmailTab";
import type { QueueLead } from "@/lib/dialerQueue";

const CourseInfoPanel = lazy(() =>
  import("@/components/leads/CourseInfoPanel").then((m) => ({ default: m.CourseInfoPanel })));

export type RailTab = "script" | "course" | "whatsapp" | "email";

const TABS: { key: RailTab; label: string; icon: typeof BookOpen }[] = [
  { key: "script", label: "Script", icon: MessageSquareText },
  { key: "course", label: "Course", icon: BookOpen },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "email", label: "Email", icon: Mail },
];

interface Props {
  lead: QueueLead;
  counsellorDisplayName: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  tab: RailTab;
  setTab: (t: RailTab) => void;
}

/**
 * Right column — the reference material the counsellor reads *from* while the
 * centre column is what they act *on*. Collapses to a 40px icon strip; each
 * tab mounts only while it's the active one, so the WhatsApp/Email fetches
 * don't fire until asked for.
 */
export function DialerContextRail({ lead, counsellorDisplayName, open, setOpen, tab, setTab }: Props) {
  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-border bg-muted/20 py-2">
        <button onClick={() => setOpen(true)} title="Expand panel"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <PanelRightOpen className="h-4 w-4" />
        </button>
        <div className="my-1 h-px w-5 bg-border" />
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} title={label} onClick={() => { setTab(key); setOpen(true); }}
            className={`rounded-md p-1.5 transition-colors ${
              tab === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}>
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex w-[380px] shrink-0 flex-col border-l border-border bg-card">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-1.5 py-1.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-colors ${
              tab === key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
            }`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
        <button onClick={() => setOpen(false)} title="Collapse panel"
          className="ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === "script" && <ScriptTab lead={lead} counsellorDisplayName={counsellorDisplayName} />}
        {tab === "course" && (
          lead.course_id
            ? <Suspense fallback={null}><CourseInfoPanel courseId={lead.course_id} /></Suspense>
            : <p className="py-8 text-center text-xs text-muted-foreground">No course set on this lead yet.</p>
        )}
        {tab === "whatsapp" && <WhatsAppTab lead={lead} active />}
        {tab === "email" && <EmailTab leadId={lead.id} leadName={lead.name} active />}
      </div>
    </div>
  );
}
