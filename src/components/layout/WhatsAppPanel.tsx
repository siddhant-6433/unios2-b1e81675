import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchWhatsAppReplyStateCounts } from "@/lib/actionBadgeCounts";
import { useAuth } from "@/contexts/AuthContext";
import { isAcademicPartnerPortalRole } from "@/lib/accessPolicy";
import { CheckCheck, Loader2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
  lead_id: string | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Minimal WhatsApp SVG icon
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

export function WhatsAppPanel() {
  const { user, role, profile } = useAuth();
  const navigate = useNavigate();
  const isCounsellor = role === "counsellor";
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [unrepliedCount, setUnrepliedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const toastIdSet = useRef(new Set<string>());

  // Notifications are already scoped at write time by user_id. Avoid fetching
  // every counsellor lead ID here; this component is mounted on every CRM page.
  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    if (isAcademicPartnerPortalRole(role)) return;
    setLoading(true);

    const q = supabase
      .from("notifications" as never)
      .select("*")
      .eq("user_id", user.id)
      .in("type", ["whatsapp_message", "whatsapp_sla_warning", "whatsapp_sla_breach"] as never)
      .order("created_at", { ascending: false })
      .limit(50);

    const { data } = await q;
    const filtered = (data || []) as Notification[];

    setNotifications(filtered);
    setUnreadNotifCount(filtered.filter((n) => !n.is_read).length);
    setLoading(false);
  }, [user?.id, role]);

  // Conversations still waiting on us — the same number, computed the same way,
  // as the inbox's "Needs Reply" chip.
  //
  // This used to read action_badge_counts.wa_unread, which counts unread
  // MESSAGES under RLS while the inbox lists CONVERSATIONS through an
  // RLS-bypassing view. That is why the header said 10 and the inbox said 30.
  // whatsapp_reply_state_counts scopes exactly like the list query, and keys on
  // reply state rather than read state, so opening a thread without replying no
  // longer silently drops the count.
  const fetchUnreplied = useCallback(async () => {
    if (!role || (isCounsellor && !profile?.id)) return;
    if (isAcademicPartnerPortalRole(role)) {
      setUnrepliedCount(0);
      return;
    }
    const { data, error } = await fetchWhatsAppReplyStateCounts({
      p_counsellor_id: isCounsellor ? profile?.id ?? null : null,
      p_business_key: null,
      p_include_outbound_only: false,
    });
    if (error) {
      console.error("[WhatsAppPanel] needs-reply count fetch failed:", error);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setUnrepliedCount(Number(row?.needs_reply || 0));
  }, [role, isCounsellor, profile?.id]);

  useEffect(() => {
    if (isAcademicPartnerPortalRole(role)) {
      setNotifications([]);
      setUnreadNotifCount(0);
      setUnrepliedCount(0);
      return;
    }
    fetchNotifications();
    fetchUnreplied();
  }, [fetchNotifications, fetchUnreplied, role]);

  // Realtime: new whatsapp_message notifications
  useEffect(() => {
    if (!user?.id) return;
    if (isAcademicPartnerPortalRole(role)) return;
    const notifChannel = supabase
      .channel("wa-notifications-realtime")
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, (payload: { new: Notification }) => {
        const n = payload.new as Notification;
        if (!["whatsapp_message", "whatsapp_sla_warning", "whatsapp_sla_breach"].includes(n.type)) return;
        if (toastIdSet.current.has(n.id)) return;
        fetchNotifications();
        fetchUnreplied();
      })
      .subscribe();

    // Debounce realtime refetch — bursts of inbound messages would
    // otherwise refire fetchUnreplied dozens of times per second across
    // every open tab.
    let waDebounce: ReturnType<typeof setTimeout> | null = null;
    const waChannel = supabase
      .channel("wa-conversations-header")
      .on("postgres_changes", {
        event: "*", schema: "public", table: "whatsapp_messages",
      }, () => {
        if (waDebounce) clearTimeout(waDebounce);
        waDebounce = setTimeout(fetchUnreplied, 1500);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(waChannel);
    };
  }, [user?.id, fetchNotifications, fetchUnreplied, role]);

  const handleClick = async (notif: Notification) => {
    if (!notif.is_read) {
      await supabase.from("notifications" as never).update({ is_read: true } as never).eq("id", notif.id);
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
      setUnreadNotifCount(prev => Math.max(0, prev - 1));
    }
    setOpen(false);

    // Deep-link: extract phone from link param, title, or lead lookup
    // 1. Link already has ?phone= (new webhook format)
    if (notif.link?.includes("phone=")) {
      navigate(notif.link);
      return;
    }

    // 2. Extract phone from title or body: "New WhatsApp from 919917149576"
    const allText = `${notif.title || ""} ${notif.body || ""}`;
    const phoneMatch = allText.match(/(91\d{10})/);
    if (phoneMatch) {
      navigate(`/whatsapp-inbox?phone=${phoneMatch[1]}`);
      return;
    }

    // 3. Look up phone via lead_id using whatsapp_messages (not the view, avoids RLS issues)
    if (notif.lead_id) {
      const { data: msg } = await supabase
        .from("whatsapp_messages" as never)
        .select("phone")
        .eq("lead_id", notif.lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (msg?.phone) {
        navigate(`/whatsapp-inbox?phone=${msg.phone}`);
        return;
      }
    }

    // 4. Fallback
    navigate(notif.link || "/whatsapp-inbox");
  };

  const markAllRead = async () => {
    if (!user?.id) return;
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from("notifications" as never).update({ is_read: true } as never).in("id", unreadIds);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadNotifCount(0);
  };

  const markNotificationRead = async (e: React.MouseEvent, notif: Notification) => {
    e.stopPropagation();
    if (notif.is_read) return;
    await supabase.from("notifications" as never).update({ is_read: true } as never).eq("id", notif.id);
    setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
    setUnreadNotifCount(prev => Math.max(0, prev - 1));
  };

  const deleteNotif = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await supabase.from("notifications" as never).delete().eq("id", id);
    const removed = notifications.find(n => n.id === id);
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (removed && !removed.is_read) setUnreadNotifCount(prev => Math.max(0, prev - 1));
  };

  // Only show for roles that use WhatsApp
  if (!role || ["student", "parent", "accountant"].includes(role)) return null;

  const hasNudge = unrepliedCount > 0;

  return (
    <div className="flex items-center gap-1.5">
      {/* Unreplied count pill */}
      {hasNudge && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => navigate("/whatsapp-inbox")}
              className="hidden md:flex items-center gap-1.5 rounded-xl border border-success/30/60 bg-success/5 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/10 transition-colors cursor-pointer select-none"
            >
              <WhatsAppIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{unrepliedCount} need reply</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[220px]">
            <p className="font-semibold mb-1">🟢 {unrepliedCount} {unrepliedCount === 1 ? "conversation" : "conversations"} waiting on you</p>
            <p className="leading-snug text-muted-foreground">These leads sent the last message and nobody has replied. Respond quickly — fast replies significantly improve conversion rates.</p>
            <p className="mt-1.5 font-medium text-success">Click to open WhatsApp Inbox →</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* WhatsApp notifications popover */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-success hover:text-success hover:bg-success/5 relative">
            <WhatsAppIcon className="h-[18px] w-[18px]" />
            {unrepliedCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-success/50 text-[9px] font-bold text-white px-1 ring-2 ring-card">
                {unrepliedCount > 99 ? "99+" : unrepliedCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[380px] p-0" sideOffset={8}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <WhatsAppIcon className="h-4 w-4 text-success" />
              <h3 className="text-sm font-semibold text-foreground">WhatsApp</h3>
              {unrepliedCount > 0 && (
                <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                  {unrepliedCount} unreplied
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadNotifCount > 0 && (
                <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <CheckCheck className="h-3 w-3" />
                  Mark all read
                </button>
              )}
              <button
                onClick={() => { setOpen(false); navigate("/whatsapp-inbox"); }}
                className="text-xs text-success hover:underline font-medium"
              >
                Open Inbox →
              </button>
            </div>
          </div>

          {unrepliedCount > 0 && (
            <div className="border-b border-success/10 bg-success/5 px-4 py-2.5 flex items-center gap-2">
              <WhatsAppIcon className="h-3.5 w-3.5 text-success shrink-0" />
              <p className="text-xs text-success-foreground">
                <strong>{unrepliedCount}</strong> conversation{unrepliedCount !== 1 ? "s" : ""} waiting for reply — respond quickly to improve conversions.
              </p>
            </div>
          )}

          <div className="max-h-[360px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                No WhatsApp notifications
              </div>
            ) : (
              notifications.map(notif => (
                <div
                  key={notif.id}
                  className={`group relative flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/30 cursor-pointer ${!notif.is_read ? "bg-success/50/[0.03]" : ""}`}
                  onClick={() => handleClick(notif)}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/5 text-success">
                    <WhatsAppIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm leading-tight ${!notif.is_read ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>
                        {notif.title}
                      </p>
                      {!notif.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-success/50" />}
                    </div>
                    {notif.body && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{notif.body}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground/70">{timeAgo(notif.created_at)}</p>
                  </div>
                  <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {!notif.is_read && (
                      <button
                        onClick={(e) => markNotificationRead(e, notif)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-success/10 hover:text-success"
                        title="Mark read"
                      >
                        <CheckCheck className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={(e) => deleteNotif(e, notif.id)}
                      className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete notification"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
