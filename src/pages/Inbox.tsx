import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tag, FileText, AlertTriangle, MessageSquare, CheckCircle, XCircle,
  Loader2, ExternalLink, ChevronRight, Clock, User, RefreshCw, Inbox as InboxIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface InboxCategory {
  id: CategoryId;
  label: string;
  icon: React.ElementType;
  count: number;
  roles: string[]; // roles that can see this category
  color: string;
}

type CategoryId = "offer_waivers" | "offer_approvals" | "applications" | "followups" | "whatsapp";

interface WaiverItem {
  id: string;
  offer_letter_id: string;
  term: string;
  amount: number;
  reason: string | null;
  status: string;
  requested_by_name: string | null;
  requested_by_role: string | null;
  created_at: string;
  lead_name: string;
  lead_id: string;
  course_name: string | null;
}

interface OfferApprovalItem {
  id: string;
  lead_id: string;
  lead_name: string;
  course_name: string | null;
  approval_status: string;
  created_at: string;
  requested_by_name: string | null;
  application_id: string | null;
}

interface ApplicationItem {
  id: string;
  application_id: string;
  lead_name: string;
  course_name: string | null;
  created_at: string;
  stage: string;
  phone: string | null;
  app_status: string | null;
}

interface FollowupItem {
  id: string;
  lead_id: string;
  lead_name: string;
  phone: string | null;
  scheduled_at: string;
  notes: string | null;
  counsellor_name: string | null;
}

interface WhatsAppItem {
  phone: string;
  lead_id: string | null;
  lead_name: string | null;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
}

type InboxItem = WaiverItem | OfferApprovalItem | ApplicationItem | FollowupItem | WhatsAppItem;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtINR = (n: number | null | undefined) =>
  n != null && !isNaN(n) ? "₹" + n.toLocaleString("en-IN") : "—";

const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

const fmtTime = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return `${Math.round(diffMs / 60000)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return fmtDate(s);
};

const termLabel = (t: string) =>
  t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const ADMISSIONS_ROLES = [
  "super_admin", "campus_admin", "principal", "admission_head", "counsellor", "data_entry",
];

const APPROVER_ROLES = ["super_admin", "principal", "campus_admin", "admission_head"];

// ── Main Component ────────────────────────────────────────────────────────────

export default function Inbox() {
  const { role, profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<CategoryId | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<CategoryId, number>>({
    offer_waivers: 0,
    offer_approvals: 0,
    applications: 0,
    followups: 0,
    whatsapp: 0,
  });

  const isSuperAdmin = role === "super_admin";
  const isPrincipal = role === "principal";
  const isAdmissions = ADMISSIONS_ROLES.includes(role || "");
  const isApprover = APPROVER_ROLES.includes(role || "");

  // ── Category definitions ──────────────────────────────────────────────────

  const allCategories: InboxCategory[] = [
    {
      id: "offer_waivers",
      label: "Offer Waivers",
      icon: Tag,
      count: counts.offer_waivers,
      roles: ["super_admin"],
      color: "text-amber-600",
    },
    {
      id: "offer_approvals",
      label: "Offer Approvals",
      icon: FileText,
      count: counts.offer_approvals,
      roles: APPROVER_ROLES,
      color: "text-blue-600",
    },
    {
      id: "applications",
      label: "New Applications",
      icon: FileText,
      count: counts.applications,
      roles: ADMISSIONS_ROLES,
      color: "text-violet-600",
    },
    {
      id: "followups",
      label: "Pending Follow-ups",
      icon: AlertTriangle,
      count: counts.followups,
      roles: ADMISSIONS_ROLES,
      color: "text-orange-600",
    },
    {
      id: "whatsapp",
      label: "WhatsApp Unreplied",
      icon: MessageSquare,
      count: counts.whatsapp,
      roles: ADMISSIONS_ROLES,
      color: "text-green-600",
    },
  ];

  const visibleCategories = allCategories.filter((c) =>
    c.roles.includes(role || "")
  );

  // ── Counts ────────────────────────────────────────────────────────────────

  const fetchCounts = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const results = await Promise.allSettled([
      // offer_waivers — super_admin only
      isSuperAdmin
        ? supabase
            .from("offer_waivers")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending")
        : Promise.resolve({ count: 0 }),

      // offer_approvals — approvers
      isApprover
        ? supabase
            .from("offer_letters")
            .select("id", { count: "exact", head: true })
            .eq("approval_status", "pending_principal")
        : Promise.resolve({ count: 0 }),

      // applications — admissions (submitted apps awaiting review)
      isAdmissions
        ? supabase
            .from("applications" as any)
            .select("id", { count: "exact", head: true })
            .eq("status", "submitted")
        : Promise.resolve({ count: 0 }),

      // followups — admissions
      isAdmissions
        ? (() => {
            let q = supabase
              .from("lead_followups")
              .select("id", { count: "exact", head: true })
              .eq("status", "pending")
              .lte("scheduled_at", `${today}T23:59:59`);
            return q;
          })()
        : Promise.resolve({ count: 0 }),

      // whatsapp unreplied
      isAdmissions
        ? supabase
            .from("whatsapp_messages")
            .select("id", { count: "exact", head: true })
            .eq("direction", "inbound")
            .eq("is_read", false)
        : Promise.resolve({ count: 0 }),
    ]);

    const get = (i: number) => {
      const r = results[i];
      if (r.status === "fulfilled") return (r.value as any).count || 0;
      return 0;
    };

    setCounts({
      offer_waivers: get(0),
      offer_approvals: get(1),
      applications: get(2),
      followups: get(3),
      whatsapp: get(4),
    });
  }, [role, isSuperAdmin, isApprover, isAdmissions, profile?.id]);

  useEffect(() => {
    fetchCounts();
    // auto-select first visible category
  }, [fetchCounts]);

  useEffect(() => {
    if (visibleCategories.length > 0 && !selected) {
      setSelected(visibleCategories[0].id);
    }
  }, [visibleCategories.length]);

  // ── Item loading ──────────────────────────────────────────────────────────

  const loadItems = useCallback(async (cat: CategoryId) => {
    setLoading(true);
    setSelectedItem(null);
    setItems([]); // clear stale items immediately so renderMiddleItem never sees mismatched data

    try {
      if (cat === "offer_waivers") {
        // offer_letters has course_id → courses FK; use that directly — no applications join needed
        const { data, error } = await supabase
          .from("offer_waivers")
          .select(`
            id, offer_letter_id, term, amount, reason, status,
            requested_by_name, requested_by_role, created_at,
            offer_letters!offer_letter_id (
              lead_id,
              leads!lead_id ( name ),
              courses!course_id ( name )
            )
          `)
          .eq("status", "pending")
          .order("created_at", { ascending: false });

        if (error) throw error;
        setItems(
          (data || []).map((w: any) => ({
            id: w.id,
            offer_letter_id: w.offer_letter_id,
            term: w.term,
            amount: Number(w.amount),
            reason: w.reason,
            status: w.status,
            requested_by_name: w.requested_by_name,
            requested_by_role: w.requested_by_role,
            created_at: w.created_at,
            lead_name: w.offer_letters?.leads?.name || "—",
            lead_id: w.offer_letters?.lead_id || "",
            course_name: w.offer_letters?.courses?.name || null,
          } as WaiverItem))
        );
      } else if (cat === "offer_approvals") {
        // offer_letters has course_id → courses FK; join directly
        const { data, error } = await supabase
          .from("offer_letters")
          .select(`
            id, lead_id, approval_status, created_at,
            leads!lead_id ( name ),
            courses!course_id ( name )
          `)
          .eq("approval_status", "pending_principal")
          .order("created_at", { ascending: false });

        if (error) throw error;
        setItems(
          (data || []).map((o: any) => ({
            id: o.id,
            lead_id: o.lead_id,
            lead_name: o.leads?.name || "—",
            course_name: o.courses?.name || null,
            approval_status: o.approval_status,
            created_at: o.created_at || null,
            requested_by_name: null,
            application_id: null,
          } as OfferApprovalItem))
        );
      } else if (cat === "applications") {
        const { data, error } = await (supabase as any)
          .from("applications")
          .select("id, application_id, status, created_at, submitted_at, course_selections, full_name, phone, leads!lead_id ( name, phone )")
          .eq("status", "submitted")
          .order("submitted_at", { ascending: false })
          .limit(100);

        if (error) throw error;
        setItems(
          (data || []).map((a: any) => ({
            id: a.id,
            application_id: a.application_id,
            lead_name: a.leads?.name || a.full_name || "—",
            course_name: a.course_selections?.[0]?.course_name || null,
            created_at: a.submitted_at || a.created_at,
            stage: a.status,
            phone: a.leads?.phone || a.phone || null,
            app_status: a.status || null,
          } as ApplicationItem))
        );
      } else if (cat === "followups") {
        const today = new Date().toISOString().slice(0, 10);
        // user_id is FK to auth.users (not profiles); just fetch lead data
        const { data, error } = await supabase
          .from("lead_followups")
          .select("id, lead_id, scheduled_at, notes, leads!lead_id ( name, phone )")
          .eq("status", "pending")
          .lte("scheduled_at", `${today}T23:59:59`)
          .order("scheduled_at", { ascending: true })
          .limit(100);

        if (error) throw error;
        setItems(
          (data || []).map((f: any) => ({
            id: f.id,
            lead_id: f.lead_id,
            lead_name: f.leads?.name || "—",
            phone: f.leads?.phone || null,
            scheduled_at: f.scheduled_at,
            notes: f.notes,
            counsellor_name: null,
          } as FollowupItem))
        );
      } else if (cat === "whatsapp") {
        // Use whatsapp_conversations view if available, else aggregate
        const { data, error } = await supabase
          .from("whatsapp_conversations" as any)
          .select("*")
          .gt("unread_count", 0)
          .order("last_message_at", { ascending: false })
          .limit(100);

        if (error) throw error;
        setItems(
          (data || []).map((c: any) => ({
            phone: c.phone,
            lead_id: c.lead_id,
            lead_name: c.lead_name,
            last_message: c.last_message,
            last_message_at: c.last_message_at,
            unread_count: c.unread_count,
          } as WhatsAppItem))
        );
      }
    } catch (e: any) {
      toast({ title: "Failed to load items", description: e.message, variant: "destructive" });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selected) loadItems(selected);
  }, [selected, loadItems]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const decideWaiver = async (waiver: WaiverItem, decision: "approved" | "rejected") => {
    if (!isSuperAdmin) return;
    let rejection_reason: string | undefined;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection (optional):");
      if (r === null) return;
      rejection_reason = r || undefined;
    }
    setProcessing(waiver.id);
    try {
      const { data, error } = await supabase.functions.invoke("decide-offer-waiver", {
        body: { waiver_id: waiver.id, decision, rejection_reason },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      toast({ title: decision === "approved" ? "Waiver approved" : "Waiver rejected" });
      setSelectedItem(null);
      loadItems("offer_waivers");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  const decideOfferApproval = async (offer: OfferApprovalItem, decision: "approved" | "rejected") => {
    if (!isApprover) return;
    let rejection_reason: string | undefined;
    if (decision === "rejected") {
      const r = window.prompt("Reason for rejection (optional):");
      if (r === null) return;
      rejection_reason = r || undefined;
    }
    setProcessing(offer.id);
    try {
      const { error } = await supabase
        .from("offer_letters")
        .update({
          approval_status: decision,
          ...(rejection_reason ? { rejection_reason } : {}),
        })
        .eq("id", offer.id);
      if (error) throw error;
      toast({ title: decision === "approved" ? "Offer letter approved" : "Offer letter rejected" });
      setSelectedItem(null);
      loadItems("offer_approvals");
      fetchCounts();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setProcessing(null);
    }
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderMiddleItem = (item: InboxItem) => {
    const isSelected = selectedItem === item;
    const baseClass = cn(
      "w-full text-left px-4 py-3 border-b border-border/40 transition-colors cursor-pointer",
      isSelected
        ? "bg-primary/5 border-l-2 border-l-primary"
        : "hover:bg-muted/30"
    );

    if (selected === "offer_waivers") {
      const w = item as WaiverItem;
      return (
        <button key={w.id} className={baseClass} onClick={() => setSelectedItem(w)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{w.lead_name}</p>
              <p className="text-xs text-muted-foreground truncate">{w.course_name || "—"}</p>
            </div>
            <span className="text-sm font-semibold text-amber-700 shrink-0">{fmtINR(w.amount)}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge className="bg-muted text-muted-foreground border-0 text-[10px] capitalize">
              {termLabel(w.term)}
            </Badge>
            <span className="text-[10px] text-muted-foreground/60">{fmtTime(w.created_at)}</span>
          </div>
        </button>
      );
    }

    if (selected === "offer_approvals") {
      const o = item as OfferApprovalItem;
      return (
        <button key={o.id} className={baseClass} onClick={() => setSelectedItem(o)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{o.lead_name}</p>
              <p className="text-xs text-muted-foreground truncate">{o.course_name || "—"}</p>
            </div>
            <span className="text-[10px] text-amber-600 font-medium shrink-0">Pending</span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(o.created_at)}</p>
        </button>
      );
    }

    if (selected === "applications") {
      const a = item as ApplicationItem;
      return (
        <button key={a.id} className={baseClass} onClick={() => setSelectedItem(a)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{a.lead_name}</p>
              <p className="text-xs text-muted-foreground truncate">{a.course_name || "—"}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(a.created_at)}</p>
        </button>
      );
    }

    if (selected === "followups") {
      const f = item as FollowupItem;
      const isOverdue = new Date(f.scheduled_at) < new Date();
      return (
        <button key={f.id} className={baseClass} onClick={() => setSelectedItem(f)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{f.lead_name}</p>
              {f.notes && <p className="text-xs text-muted-foreground truncate">{f.notes}</p>}
            </div>
            <span className={cn("text-[10px] font-medium shrink-0", isOverdue ? "text-destructive" : "text-muted-foreground")}>
              {isOverdue ? "Overdue" : "Today"}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {new Date(f.scheduled_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            {f.counsellor_name && ` · ${f.counsellor_name}`}
          </p>
        </button>
      );
    }

    if (selected === "whatsapp") {
      const w = item as WhatsAppItem;
      return (
        <button
          key={w.phone}
          className={cn(baseClass, isSelected && "bg-primary/5 border-l-2 border-l-primary")}
          onClick={() => setSelectedItem(w)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{w.lead_name || w.phone}</p>
              {w.last_message && (
                <p className="text-xs text-muted-foreground truncate">{w.last_message}</p>
              )}
            </div>
            <Badge className="bg-green-100 text-green-700 border-0 text-[10px] shrink-0">
              {w.unread_count}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(w.last_message_at)}</p>
        </button>
      );
    }

    return null;
  };

  const renderDetail = () => {
    if (!selectedItem) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
          <InboxIcon className="h-10 w-10 opacity-20" />
          <p className="text-sm">Select an item to review</p>
        </div>
      );
    }

    if (selected === "offer_waivers") {
      const w = selectedItem as WaiverItem;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{w.lead_name}</h3>
            {w.course_name && <p className="text-sm text-muted-foreground">{w.course_name}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Term" value={termLabel(w.term)} />
            <Row label="Waiver Amount" value={fmtINR(w.amount)} highlight />
            <Row label="Reason" value={w.reason || "—"} />
            <Row label="Requested By" value={
              w.requested_by_name
                ? `${w.requested_by_name}${w.requested_by_role ? ` (${w.requested_by_role.replace("_", " ")})` : ""}`
                : "—"
            } />
            <Row label="Requested On" value={fmtDate(w.created_at)} />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 bg-success/90 hover:bg-success text-white"
              disabled={!isSuperAdmin || processing === w.id}
              onClick={() => decideWaiver(w, "approved")}
            >
              {processing === w.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <><CheckCircle className="h-4 w-4 mr-1.5" />Approve</>
              )}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={!isSuperAdmin || processing === w.id}
              onClick={() => decideWaiver(w, "rejected")}
            >
              <XCircle className="h-4 w-4 mr-1.5" />Reject
            </Button>
          </div>

          {!isSuperAdmin && (
            <p className="text-xs text-muted-foreground text-center">Only super admins can approve waivers.</p>
          )}

          {w.lead_id && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => navigate(`/admissions/${w.lead_id}`)}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              View Lead Profile
            </Button>
          )}
        </div>
      );
    }

    if (selected === "offer_approvals") {
      const o = selectedItem as OfferApprovalItem;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{o.lead_name}</h3>
            {o.course_name && <p className="text-sm text-muted-foreground">{o.course_name}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Status" value="Pending Approval" />
            <Row label="Requested By" value={o.requested_by_name || "—"} />
            <Row label="Issued On" value={fmtDate(o.created_at)} />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 bg-success/90 hover:bg-success text-white"
              disabled={!isApprover || processing === o.id}
              onClick={() => decideOfferApproval(o, "approved")}
            >
              {processing === o.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <><CheckCircle className="h-4 w-4 mr-1.5" />Approve</>
              )}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              disabled={!isApprover || processing === o.id}
              onClick={() => decideOfferApproval(o, "rejected")}
            >
              <XCircle className="h-4 w-4 mr-1.5" />Reject
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {o.lead_id && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => navigate(`/admissions/${o.lead_id}`)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                View Lead Profile
              </Button>
            )}
          </div>
        </div>
      );
    }

    if (selected === "applications") {
      const a = selectedItem as ApplicationItem;
      const stageLabel: Record<string, string> = {
        draft: "Draft",
        submitted: "Submitted",
        under_review: "Under Review",
        approved: "Approved",
        rejected: "Rejected",
      };
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{a.lead_name}</h3>
            {a.course_name && <p className="text-sm text-muted-foreground">{a.course_name}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Application ID" value={a.application_id} />
            <Row label="Stage" value={stageLabel[a.stage] || a.stage} />
            {a.phone && <Row label="Phone" value={a.phone} />}
            <Row label="Started On" value={fmtDate(a.created_at)} />
          </div>

          <Button
            size="sm"
            className="w-full"
            onClick={() => navigate(`/applications/${a.application_id}`)}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Open Application
          </Button>
        </div>
      );
    }

    if (selected === "followups") {
      const f = selectedItem as FollowupItem;
      const isOverdue = new Date(f.scheduled_at) < new Date();
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{f.lead_name}</h3>
            {f.phone && <p className="text-sm text-muted-foreground">{f.phone}</p>}
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row
              label="Scheduled"
              value={new Date(f.scheduled_at).toLocaleString("en-IN", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            />
            <Row label="Status" value={isOverdue ? "Overdue" : "Due Today"} />
            {f.counsellor_name && <Row label="Counsellor" value={f.counsellor_name} />}
            {f.notes && <Row label="Notes" value={f.notes} />}
          </div>

          <Button
            size="sm"
            className="w-full"
            onClick={() => navigate(`/admissions/${f.lead_id}`)}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Open Lead
          </Button>
        </div>
      );
    }

    if (selected === "whatsapp") {
      const w = selectedItem as WhatsAppItem;
      return (
        <div className="p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-foreground">{w.lead_name || w.phone}</h3>
            <p className="text-sm text-muted-foreground">{w.phone}</p>
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            <Row label="Unread Messages" value={String(w.unread_count)} highlight />
            <Row label="Last Message" value={w.last_message || "—"} />
            <Row label="Received" value={fmtTime(w.last_message_at)} />
          </div>

          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              className="w-full"
              onClick={() => navigate(`/whatsapp-inbox?phone=${encodeURIComponent(w.phone)}`)}
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
              Open Conversation
            </Button>
            {w.lead_id && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => navigate(`/admissions/${w.lead_id}`)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                View Lead Profile
              </Button>
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-background">
      {/* Left: Category list */}
      <div className="w-56 shrink-0 border-r border-border bg-muted/20 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Inbox</h2>
          <button
            onClick={() => { fetchCounts(); if (selected) loadItems(selected); }}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {visibleCategories.length === 0 && (
            <p className="px-4 py-3 text-xs text-muted-foreground">No categories available</p>
          )}
          {visibleCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => { setItems([]); setSelected(cat.id); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium transition-colors text-left",
                selected === cat.id
                  ? "bg-primary/8 text-foreground border-l-2 border-l-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              <cat.icon className={cn("h-4 w-4 shrink-0", cat.color)} />
              <span className="flex-1 truncate">{cat.label}</span>
              {cat.count > 0 && (
                <span className={cn(
                  "flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-bold text-white px-1",
                  cat.id === "whatsapp" ? "bg-green-500"
                  : cat.id === "followups" ? "bg-orange-500"
                  : "bg-primary"
                )}>
                  {cat.count > 99 ? "99+" : cat.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Middle: Item list */}
      <div className="w-72 shrink-0 border-r border-border bg-background flex flex-col">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {visibleCategories.find((c) => c.id === selected)?.label || ""}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {items.length} item{items.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground">
              <CheckCircle className="h-8 w-8 opacity-20" />
              <p className="text-xs">All clear!</p>
            </div>
          ) : (
            items.map((item) => renderMiddleItem(item))
          )}
        </div>
      </div>

      {/* Right: Detail pane */}
      <div className="flex-1 overflow-y-auto bg-muted/10">
        {renderDetail()}
      </div>
    </div>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="text-xs text-muted-foreground w-32 shrink-0 pt-px">{label}</span>
      <span className={cn("text-sm flex-1", highlight ? "font-semibold text-foreground" : "text-foreground/80")}>
        {value}
      </span>
    </div>
  );
}
