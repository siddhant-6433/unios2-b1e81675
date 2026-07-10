/**
 * Floating Hot Leads sidebar — collapses to a small flame-icon FAB on the
 * right edge of the screen and slides out a 380px panel when clicked.
 *
 *   - Polls `hot_engaged_leads` every 30s.
 *   - Tracks the last time the user opened the panel in localStorage; any
 *     hot lead whose `last_engaged_at` is newer than that timestamp counts
 *     as NEW and pulses on the FAB with a numeric badge.
 *   - Counsellors see only their assigned leads; super_admin / team
 *     leaders see everything.
 *
 * Mounted globally inside the /admissions page so it's available wherever
 * the page is open; can be lifted to `App.tsx` if you want it across every
 * route (just import there and remove from Admissions.tsx).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Flame, X, BellRing } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  profileId?: string;
  isSuperAdmin?: boolean;
  isTeamLeader?: boolean;
}

interface HotLead {
  id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  engagement_score: number;
  lead_score: number;
  last_engaged_at: string;
  counsellor_id: string | null;
  course_name: string | null;
  last_event_type: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New", counsellor_call: "Follow Up", ai_called: "AI Called",
  visit_scheduled: "Visit", interview: "Interview", offer_sent: "Offer",
  token_paid: "Token Paid", pre_admitted: "Pre-Admit", admitted: "Admitted",
  application_in_progress: "App In Progress", application_submitted: "App Submitted",
  priority_interested: "Priority", deferred: "Deferred",
};
const EVENT_LABELS: Record<string, string> = {
  page_view: "Visited website", chat_open: "Opened chat",
  chat_message: "Sent chat message", navya_click: "Talked to Navya",
  whatsapp_click: "Clicked WhatsApp", email_open: "Opened email",
  form_start: "Started form", apply_click: "Clicked Apply",
  whatsapp_reply: "Replied on WhatsApp",
};

const stageColor = (s: string) => {
  if (s === "admitted" || s === "pre_admitted" || s === "token_paid") return "bg-success/10 text-success";
  if (s === "visit_scheduled" || s === "interview") return "bg-primary/10 text-primary";
  if (s === "counsellor_call" || s === "ai_called") return "bg-info/10 text-info-foreground";
  if (s === "priority_interested") return "bg-warning/10 text-warning-foreground";
  return "bg-slate-100 text-slate-700";
};
const flameTint = (score: number) => {
  if (score >= 80) return "text-destructive";
  if (score >= 50) return "text-warning";
  return "text-warning";
};
const engagementBar = (score: number) => {
  if (score >= 80) return "bg-destructive/50";
  if (score >= 50) return "bg-warning/50";
  return "bg-warning/40";
};
const timeAgo = (s: string) => {
  const m = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const STORAGE_KEY = "uniOs.hotLeads.lastSeenAt";

export function HotLeadsSidebar({ profileId, isSuperAdmin, isTeamLeader }: Props) {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<HotLead[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState<string>(() => {
    if (typeof window === "undefined") return new Date(0).toISOString();
    return localStorage.getItem(STORAGE_KEY) || new Date(0).toISOString();
  });
  // Prev set of lead ids — used to detect arrivals across polls so we can
  // pulse the FAB even when the lead was active before the user opened the
  // app for the first time.
  const prevIdsRef = useRef<Set<string>>(new Set());

  const fetchLeads = useCallback(async () => {
    let q = supabase
      .from("hot_engaged_leads" as any)
      .select("*")
      .order("last_engaged_at", { ascending: false })
      .limit(20);
    if (!isSuperAdmin && !isTeamLeader && profileId) {
      q = q.eq("counsellor_id" as any, profileId);
    }
    const { data } = await q;
    setLeads((data as HotLead[] | null) || []);
  }, [profileId, isSuperAdmin, isTeamLeader]);

  useEffect(() => {
    fetchLeads();
    const id = setInterval(fetchLeads, 30_000);
    return () => clearInterval(id);
  }, [fetchLeads]);

  // Count of "new since last open" — drives the FAB badge + pulse.
  const newLeads = useMemo(
    () => leads.filter(l => l.last_engaged_at > lastSeenAt),
    [leads, lastSeenAt]
  );
  const newCount = newLeads.length;

  // Track ids on every poll. If a brand-new id arrives, we already see it
  // via lastSeenAt, but this ref also lets us play a subtle alert sound
  // hook later if you want one.
  useEffect(() => {
    prevIdsRef.current = new Set(leads.map(l => l.id));
  }, [leads]);

  const openPanel = () => {
    setIsOpen(true);
    const now = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, now);
    setLastSeenAt(now);
  };

  return (
    <>
      {/* ── FAB (collapsed state) ─────────────────────────────────── */}
      <button
        onClick={openPanel}
        aria-label={`${newCount > 0 ? `${newCount} new hot leads` : "View hot leads"}`}
        className={`fixed right-4 bottom-20 z-40 group inline-flex items-center gap-2 rounded-full border bg-card px-3 py-2 shadow-lg shadow-orange-500/10 hover:shadow-orange-500/20 transition-all hover:scale-105 ${
          newCount > 0 ? "border-warning/25 bg-warning/5 animate-pulse" : "border-border/60"
        }`}
      >
        <Flame className={`h-4 w-4 ${newCount > 0 ? "text-warning-foreground" : "text-warning"}`} />
        <span className="text-xs font-semibold text-foreground">{leads.length}</span>
        {newCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning text-white text-[10px] font-bold px-1.5 py-0.5">
            <BellRing className="h-2.5 w-2.5" /> {newCount}
          </span>
        )}
      </button>

      {/* ── Slide-in panel (expanded state) ─────────────────────────── */}
      {/* Backdrop — translucent, click-through-friendly close. */}
      <div
        onClick={() => setIsOpen(false)}
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Hot leads"
        className={`fixed right-0 top-0 bottom-0 w-[380px] max-w-[92vw] z-50 bg-card border-l border-border shadow-2xl flex flex-col transition-transform duration-200 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
              <Flame className="h-4 w-4 text-warning-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Hot Leads</h2>
              <p className="text-[10px] text-muted-foreground">Live · refreshes every 30s</p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close hot leads panel"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {leads.length === 0 ? (
            <p className="py-12 text-center text-xs text-muted-foreground">No active hot leads right now.</p>
          ) : (
            <div className="space-y-1">
              {leads.map((lead) => {
                const isNew = lead.last_engaged_at > lastSeenAt;
                return (
                  <button
                    key={lead.id}
                    onClick={() => { setIsOpen(false); navigate(`/admissions/${lead.id}`); }}
                    className={`group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors hover:bg-muted/50 ${
                      isNew ? "border-warning/25 bg-warning/5/40" : "border-border/40"
                    }`}
                  >
                    <Flame className={`h-4 w-4 shrink-0 ${flameTint(lead.engagement_score)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-foreground group-hover:underline">{lead.name}</span>
                        {isNew && (
                          <span className="inline-flex items-center rounded-full bg-warning text-white text-[8px] font-bold px-1.5 py-0.5 uppercase tracking-wider">new</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-muted-foreground truncate">{EVENT_LABELS[lead.last_event_type || ""] || "Active on site"}</span>
                        <Badge className={`border-0 text-[9px] px-1.5 py-0 ${stageColor(lead.stage)}`}>{STAGE_LABELS[lead.stage] || lead.stage}</Badge>
                      </div>
                      {lead.course_name && (
                        <div className="text-[10px] text-muted-foreground/80 truncate mt-0.5">{lead.course_name}</div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className="text-[10px] tabular-nums text-muted-foreground">{timeAgo(lead.last_engaged_at)}</span>
                      <div className="flex items-center gap-1">
                        <div className="h-1 w-8 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${engagementBar(lead.engagement_score)}`}
                            style={{ width: `${Math.min(lead.engagement_score, 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] tabular-nums font-semibold text-foreground/80">{lead.engagement_score}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
