import { Pencil, Check, X } from "lucide-react";
import { CahetPendingBadge } from "@/components/leads/CahetPendingBadge";
import { UpdeledPendingBadge } from "@/components/leads/UpdeledPendingBadge";
import type { QueueLead } from "@/lib/dialerQueue";

interface Props {
  lead: QueueLead;
  stageLabel: string;
  editing: "name" | "course" | null;
  setEditing: (v: "name" | "course" | null) => void;
  editValue: string;
  setEditValue: (v: string) => void;
  saveLeadEdit: (field: "name" | "course", value: string) => void;
  courseOptions: { id: string; name: string; campus: string }[];
}

/**
 * The workspace's identity band — who am I calling, about what. Replaces the
 * old full-width lead Card: same facts, one strip, always in view while the
 * body below it scrolls.
 */
export function DialerLeadHeader({
  lead, stageLabel, editing, setEditing, editValue, setEditValue, saveLeadEdit, courseOptions,
}: Props) {
  return (
    <div className="shrink-0 border-b border-border bg-card px-5 py-2.5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-100 dark:bg-cyan-900/30">
          <span className="text-sm font-bold text-cyan-700">{lead.name[0]?.toUpperCase()}</span>
        </div>

        <div className="min-w-0 flex-1">
          {editing === "name" ? (
            <div className="flex items-center gap-1">
              <input type="text" value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                className="w-48 rounded-md border border-input px-1.5 py-0.5 text-base font-bold leading-tight text-foreground outline-none focus:ring-1 focus:ring-primary"
                onKeyDown={e => { if (e.key === "Enter") saveLeadEdit("name", editValue); if (e.key === "Escape") setEditing(null); }} />
              <button onClick={() => saveLeadEdit("name", editValue)} className="text-success"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <h2 className="group flex items-center gap-1.5 text-base font-bold leading-tight text-foreground">
              <span className="truncate">{lead.name}</span>
              <button onClick={() => { setEditing("name"); setEditValue(lead.name); }}
                className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary">
                <Pencil className="h-3 w-3" />
              </button>
              <span className="ml-1 shrink-0 font-mono text-[11px] font-normal text-muted-foreground">{lead.phone}</span>
            </h2>
          )}

          {editing === "course" ? (
            <div className="mt-1 flex items-center gap-1">
              <select value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                className="flex-1 rounded-md border border-input bg-background px-1.5 py-1 text-xs outline-none focus:ring-1 focus:ring-primary">
                <option value="">Select course...</option>
                {courseOptions.map(c => <option key={c.id} value={c.id}>{c.name} — {c.campus}</option>)}
              </select>
              <button onClick={() => saveLeadEdit("course", editValue)} className="text-success"><Check className="h-3.5 w-3.5" /></button>
              <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <p className="group flex items-center gap-1.5 text-xs font-medium text-foreground">
              <span className="truncate">{lead.course_name} · {lead.campus_name}</span>
              <button onClick={() => { setEditing("course"); setEditValue(lead.course_id || ""); }}
                className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary">
                <Pencil className="h-3 w-3" />
              </button>
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            <span><span className="text-muted-foreground/70">Stage</span> <b className="font-medium text-foreground">{stageLabel}</b></span>
            <span><span className="text-muted-foreground/70">Source</span> <b className="font-medium capitalize text-foreground">{lead.source}</b></span>
            <span><span className="text-muted-foreground/70">Bucket</span> <b className="font-medium text-foreground">{lead.bucket}</b></span>
            <span className={lead.attempt_count > 0 ? "text-warning-foreground" : "text-success"}>
              {lead.attempt_count > 0 ? `${lead.attempt_count} previous attempts` : "First call"}
            </span>
            <CahetPendingBadge leadId={lead.id} leadName={lead.name} phone={lead.phone} courseName={lead.course_name} />
            <UpdeledPendingBadge leadId={lead.id} leadName={lead.name} phone={lead.phone} courseName={lead.course_name} />
          </div>
        </div>

        <a href={`/admissions/${lead.id}`} target="_blank" rel="noreferrer"
          className="shrink-0 text-[10px] text-primary hover:underline">Open Lead →</a>
      </div>
    </div>
  );
}
