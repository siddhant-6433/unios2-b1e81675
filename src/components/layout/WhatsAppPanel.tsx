import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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

  // Fetch WhatsApp message notifications scoped to counsellor's leads if needed
  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    let leadIds: string[] | null = null;
    if (isCounsellor && profile?.id) {
      const { data: myLeads } = await supabase
        .from("leads").select("id").eq("counsellor_id", profile.id);
      leadIds = (myLeads || []).map((l: any) => l.id);
    }

    let q = supabase
      .from("notifications" as any)
      .select("*")
      .eq("user_id", user.id)
      .eq("type", "whatsapp_message")
      .order("created_at", { ascending: false })
      .limit(50);

    // For counsellors, further filter by notifications whose link contains their lead IDs
    // Notifications use user_id already scoped at creation, but fetch all and filter by link/lead
    const { data } = await q;
    let filtered = (data || []) as any[];

    // If counsellor, only show notifications whose link matches their leads
    if (isCounsellor && leadIds !== null) {
      const idSet = new Set(leadIds);
      filtered = filtered.filter((n: any) => {
        if (!n.link) return false;
        // links are typically "/admissions/<lead_id>" or "/whatsapp-inbox?lead=<lead_id>"
        return leadIds!.some(id => n.link.includes(id));
      });
    }

    setNotifications(filtered);
    setUnreadNotifCount(filtered.filter((n: any) => !n.is_read).length);
    setLoading(false);
  }, [user?.id, isCounsellor, profile?.id]);

  // Fetch unreplied WhatsApp conversations — scoped to counsellor's leads
  const fetchUnreplied = useCallback(async () => {
    let q = supabase
      .from("whatsapp_conversations" as any)
      .select("unread_count");
    if (isCounsellor && profile?.id) {
      q = q.eq("counsellor_id", profile.id);
    }
    const { data } = await q;
    if (data) {
      setUnrepliedCount((data as any[]).reduce((sum, c) => sum + (c.unread_count || 0), 0));
    }
  }, [isCounsellor, profile?.id]);

  useEffect(() => {
    fetchNotifications();
    fetchUnreplied();
  }, [fetchNotifications, fetchUnreplied]);

  // Realtime: new whatsapp_message notifications
  useEffect(() => {
    if (!user?.id) return;
    const notifChannel = supabase
      .channel("wa-notifications-realtime")
      .on("postgres_changes" as any, {
        event: "INSERT", schema: "public", table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, (payload: any) => {
        const n = payload.new as Notification;
        if (n.type !== "whatsapp_message") return;
        if (toastIdSet.current.has(n.id)) return;
        // For counsellors, only surface if the notification link relates to their leads
        // Re-fetch to apply proper filtering rather than doing it inline
        fetchNotifications();
        fetchUnreplied();
      })
      .subscribe();

    const waChannel = supabase
      .channel("wa-conversations-header")
      .on("postgres_changes" as any, {
        event: "*", schema: "public", table: "whatsapp_messages",
      }, fetchUnreplied)
      .subscribe();

    return () => {
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(waChannel);
    };
  }, [user?.id, fetchUnreplied]);

  const handleClick = async (notif: Notification) => {
    if (!notif.is_read) {
      await supabase.from("notifications" as any).update({ is_read: true }).eq("id", notif.id);
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
      setUnreadNotifCount(prev => Math.max(0, prev - 1));
    }
    if (notif.link) { setOpen(false); navigate(notif.link); }
  };

  const markAllRead = async () => {
    if (!user?.id) return;
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from("notifications" as any).update({ is_read: true }).in("id", unreadIds);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadNotifCount(0);
  };

  const deleteNotif = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await supabase.from("notifications" as any).delete().eq("id", id);
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
              className="hidden md:flex items-center gap-1.5 rounded-xl border border-green-400/60 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors cursor-pointer select-none"
            >
              <WhatsAppIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{unrepliedCount} unreplied</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[220px]">
            <p className="font-semibold mb-1">🟢 {unrepliedCount} WhatsApp {unrepliedCount === 1 ? "message" : "messages"} waiting</p>
            <p className="leading-snug text-muted-foreground">Leads are waiting for a reply. Respond quickly — fast replies significantly improve conversion rates.</p>
            <p className="mt-1.5 font-medium text-green-700">Click to open WhatsApp Inbox →</p>
          </TooltipContent>
        </Tooltip>
      )}

      {/* WhatsApp notifications popover */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-green-600 hover:text-green-700 hover:bg-green-50 relative">
            <WhatsAppIcon className="h-[18px] w-[18px]" />
            {unreadNotifCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white px-1 ring-2 ring-card">
                {unreadNotifCount > 99 ? "99+" : unreadNotifCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[380px] p-0" sideOffset={8}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <WhatsAppIcon className="h-4 w-4 text-green-600" />
              <h3 className="text-sm font-semibold text-foreground">WhatsApp</h3>
              {unrepliedCount > 0 && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
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
                className="text-xs text-green-600 hover:underline font-medium"
              >
                Open Inbox →
              </button>
            </div>
          </div>

          {unrepliedCount > 0 && (
            <div className="border-b border-green-100 bg-green-50 px-4 py-2.5 flex items-center gap-2">
              <WhatsAppIcon className="h-3.5 w-3.5 text-green-600 shrink-0" />
              <p className="text-xs text-green-800">
                <strong>{unrepliedCount}</strong> conversation{unrepliedCount !== 1 ? "s" : ""} waiting for reply — respond quickly to improve conversions.
              </p>
            </div>
          )}

          <div className="max-h-[360px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                No WhatsApp notifications
              </div>
            ) : (
              notifications.map(notif => (
                <div
                  key={notif.id}
                  className={`group relative flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b border-border/30 cursor-pointer ${!notif.is_read ? "bg-green-500/[0.03]" : ""}`}
                  onClick={() => handleClick(notif)}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600">
                    <WhatsAppIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm leading-tight ${!notif.is_read ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>
                        {notif.title}
                      </p>
                      {!notif.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-green-500" />}
                    </div>
                    {notif.body && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{notif.body}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground/70">{timeAgo(notif.created_at)}</p>
                  </div>
                  <button
                    onClick={(e) => deleteNotif(e, notif.id)}
                    className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
