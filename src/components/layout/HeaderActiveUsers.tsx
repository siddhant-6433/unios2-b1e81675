import { useState, useEffect, useCallback } from "react";
import { Users, GraduationCap, Briefcase, Handshake, BookOpen, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { roleLabel } from "@/lib/accessPolicy";
import type { AppRole } from "@/lib/accessPolicy";
import { fetchActiveOverview } from "@/lib/actionBadgeCounts";

interface PresenceUser {
  user_id: string;
  display_name: string;
  role: AppRole | null;
  campus: string | null;
  last_seen_at: string;
}
interface ActiveLead {
  lead_id: string;
  name: string;
  phone: string | null;
  stage: string | null;
  last_activity_at: string;
  activity_type: string | null;
  is_applicant: boolean;
  counsellor_name: string | null;
}

const POLL_MS = 60000;

// Group login-users into the same buckets the Admin Panel uses.
type Category = "Team" | "Students & Families" | "Consultants" | "Partners" | "Publishers";
const CATEGORY_OF: Partial<Record<AppRole, Category>> = {
  consultant: "Consultants",
  academic_partner: "Partners",
  academic_partner_offer_letter: "Partners",
  admission_partner: "Partners",
  publisher: "Publishers",
  student: "Students & Families",
  parent: "Students & Families",
};
const SECTION_ORDER: Category[] = ["Team", "Students & Families", "Consultants", "Partners", "Publishers"];
const SECTION_ICON: Record<Category, typeof Users> = {
  Team: Users,
  "Students & Families": GraduationCap,
  Consultants: Briefcase,
  Partners: Handshake,
  Publishers: BookOpen,
};
function categoryOf(role: AppRole | null): Category {
  return (role && CATEGORY_OF[role]) || "Team"; // any staff role → Team
}

// Human labels for lead engagement event types.
const ACTIVITY_LABEL: Record<string, string> = {
  whatsapp_reply: "WhatsApp reply",
  inbound_call: "Inbound call",
  page_view: "Website visit",
  email_open: "Opened email",
  chat_message: "Live chat",
  chat_open: "Opened chat",
  apply_click: "Clicked apply",
  form_start: "Started form",
};
function activityLabel(t: string | null): string {
  if (!t) return "Active";
  return ACTIVITY_LABEL[t] || t.replace(/_/g, " ");
}

function activeAgo(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
function initials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "?";
}

export function HeaderActiveUsers() {
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [leads, setLeads] = useState<ActiveLead[]>([]);
  const [open, setOpen] = useState(false);

  // The background poll only needs presence (cheap); the recently-active leads
  // list (~2s server-side) is fetched only when the popover opens. When polling
  // presence-only we leave the last-known leads list untouched so it doesn't
  // flicker away between opens.
  const refresh = useCallback(async (includeLeads = false) => {
    const { data, error } = await fetchActiveOverview(includeLeads);
    if (!error && data) {
      setPresence(Array.isArray(data.presence) ? data.presence : []);
      if (includeLeads) setLeads(Array.isArray(data.leads) ? data.leads : []);
    }
  }, []);

  // Visibility-gated poll — same convention as GlobalActionBar.
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

  // Bucket presence users into ordered sections.
  const sections = SECTION_ORDER
    .map((cat) => ({ cat, users: presence.filter((u) => categoryOf(u.role) === cat) }))
    .filter((s) => s.users.length > 0);

  const total = presence.length + leads.length;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) refresh(true); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-1.5 rounded-xl px-2 text-muted-foreground" title="Active now">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-success/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          <Users className="h-[18px] w-[18px]" />
          <span className="text-xs font-semibold tabular-nums">{total}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Active now</h3>
          <span className="text-xs text-muted-foreground">
            {presence.length} online{leads.length > 0 ? ` · ${leads.length} leads` : ""}
          </span>
        </div>
        <div className="max-h-[440px] overflow-y-auto">
          {total === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              No one active right now
            </div>
          ) : (
            <>
              {sections.map(({ cat, users }) => {
                const Icon = SECTION_ICON[cat];
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-1.5 bg-muted/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Icon className="h-3 w-3" /> {cat} · {users.length}
                    </div>
                    {users.map((u) => (
                      <div key={u.user_id} className="flex items-center gap-3 border-b border-border/30 px-4 py-2 last:border-0">
                        <div className="relative shrink-0">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                            {initials(u.display_name)}
                          </div>
                          <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-success ring-2 ring-card" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{u.display_name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {roleLabel(u.role)}{u.campus ? ` · ${u.campus}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground/70">{activeAgo(u.last_seen_at)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}

              {leads.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 bg-muted/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Flame className="h-3 w-3" /> Active leads &amp; applicants · {leads.length}
                  </div>
                  {leads.map((l) => (
                    <div key={l.lead_id} className="flex items-center gap-3 border-b border-border/30 px-4 py-2 last:border-0">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning/50/10 text-warning-foreground dark:text-warning">
                        <Flame className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {l.name}{l.is_applicant ? <span className="ml-1 text-[10px] font-semibold text-primary">applicant</span> : null}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {activityLabel(l.activity_type)}{l.counsellor_name ? ` · ${l.counsellor_name}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">{activeAgo(l.last_activity_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
