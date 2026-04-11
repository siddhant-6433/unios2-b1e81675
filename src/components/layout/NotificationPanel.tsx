import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Bell, UserPlus, AlertTriangle, RotateCcw, Calendar, Clock,
  MapPin, ArrowRightLeft, Trash2, Info, CheckCheck, Loader2,
  MessageSquare, X, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  lead_assigned: UserPlus,
  sla_warning: AlertTriangle,
  lead_reclaimed: RotateCcw,
  followup_due: Calendar,
  followup_overdue: Clock,
  visit_confirmation_due: MapPin,
  visit_followup_due: MapPin,
  lead_transferred: ArrowRightLeft,
  deletion_request: Trash2,
  whatsapp_message: MessageSquare,
  approval_pending: ShieldCheck,
  approval_decided: CheckCheck,
  general: Info,
};

const TYPE_COLORS: Record<string, string> = {
  lead_assigned: "text-blue-500 bg-blue-50 dark:bg-blue-950/30",
  sla_warning: "text-amber-500 bg-amber-50 dark:bg-amber-950/30",
  lead_reclaimed: "text-red-500 bg-red-50 dark:bg-red-950/30",
  followup_due: "text-orange-500 bg-orange-50 dark:bg-orange-950/30",
  followup_overdue: "text-red-500 bg-red-50 dark:bg-red-950/30",
  visit_confirmation_due: "text-purple-500 bg-purple-50 dark:bg-purple-950/30",
  visit_followup_due: "text-purple-500 bg-purple-50 dark:bg-purple-950/30",
  lead_transferred: "text-blue-500 bg-blue-50 dark:bg-blue-950/30",
  deletion_request: "text-red-500 bg-red-50 dark:bg-red-950/30",
  whatsapp_message: "text-green-500 bg-green-50 dark:bg-green-950/30",
  approval_pending: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
  approval_decided: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30",
  general: "text-gray-500 bg-gray-50 dark:bg-gray-900/30",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Toast notification that auto-fades
function NotificationToast({ notif, onClose, onClick }: { notif: Notification; onClose: () => void; onClick: () => void }) {
  const Icon = TYPE_ICONS[notif.type] || Bell;
  const colorClass = TYPE_COLORS[notif.type] || TYPE_COLORS.general;

  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className="animate-in slide-in-from-top-2 fade-in duration-300 pointer-events-auto w-[360px] rounded-xl border border-border bg-card shadow-lg overflow-hidden cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start gap-3 p-3">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">{notif.title}</p>
          {notif.body && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{notif.body}</p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Auto-fade progress bar */}
      <div className="h-0.5 bg-primary/20">
        <div className="h-full bg-primary animate-[shrink_5s_linear_forwards]" />
      </div>
    </div>
  );
}

export function NotificationPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Notification[]>([]);
  const toastIdSet = useRef(new Set<string>());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    toastIdSet.current.delete(id);
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("notifications" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setNotifications((data || []) as any);
    setUnreadCount((data || []).filter((n: any) => !n.is_read).length);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription with toast
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload: any) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev]);
          setUnreadCount((prev) => prev + 1);

          // Show toast if panel is not open and not already showing this toast
          if (!toastIdSet.current.has(newNotif.id)) {
            toastIdSet.current.add(newNotif.id);
            setToasts((prev) => [newNotif, ...prev].slice(0, 3)); // max 3 toasts
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const handleClick = async (notif: Notification) => {
    // Mark as read
    if (!notif.is_read) {
      await supabase
        .from("notifications" as any)
        .update({ is_read: true })
        .eq("id", notif.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
    // Navigate
    if (notif.link) {
      setOpen(false);
      navigate(notif.link);
    }
  };

  const markAllRead = async () => {
    if (!user?.id) return;
    await supabase
      .from("notifications" as any)
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  };

  const deleteNotification = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await supabase
      .from("notifications" as any)
      .delete()
      .eq("id", id);
    const removed = notifications.find((n) => n.id === id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (removed && !removed.is_read) {
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  };

  return (
    <>
      {/* Toast overlay - fixed top-right */}
      {toasts.length > 0 && (
        <div className="fixed top-14 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <NotificationToast
              key={t.id}
              notif={t}
              onClose={() => dismissToast(t.id)}
              onClick={() => {
                dismissToast(t.id);
                if (t.link) navigate(t.link);
              }}
            />
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-muted-foreground relative">
            <Bell className="h-[18px] w-[18px]" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground px-1 ring-2 ring-card">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[380px] p-0" sideOffset={8}>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              notifications.map((notif) => {
                const Icon = TYPE_ICONS[notif.type] || Bell;
                const colorClass = TYPE_COLORS[notif.type] || TYPE_COLORS.general;
                return (
                  <div
                    key={notif.id}
                    className={`group relative w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b border-border/30 cursor-pointer ${
                      !notif.is_read ? "bg-primary/[0.03]" : ""
                    }`}
                    onClick={() => handleClick(notif)}
                  >
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-tight ${!notif.is_read ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>
                          {notif.title}
                        </p>
                        {!notif.is_read && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      {notif.body && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {notif.body}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                        {timeAgo(notif.created_at)}
                      </p>
                    </div>
                    {/* Delete button - visible on hover */}
                    <button
                      onClick={(e) => deleteNotification(e, notif.id)}
                      className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete notification"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
