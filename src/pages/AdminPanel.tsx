import { Suspense, lazy, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  Users, UserPlus, FileSpreadsheet, Search, Loader2, Shield, Phone, Eye, X, KeyRound, Trash2, UserCheck, Lock, LockOpen, ArrowRightLeft, AlertTriangle, Archive, ArchiveRestore, Sparkles, ChevronRight
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import type { Database } from "@/integrations/supabase/types";

const EligibilityConfigPanel = lazy(() => import("@/components/admin/EligibilityConfigPanel"));
const PermissionMatrixPanel = lazy(() =>
  import("@/components/admin/PermissionMatrixPanel").then((m) => ({ default: m.PermissionMatrixPanel })));
const InviteUserDialog = lazy(() => import("@/components/admin/InviteUserDialog"));
const BulkImportDialog = lazy(() => import("@/components/admin/BulkImportDialog"));
const EditPhoneDialog = lazy(() => import("@/components/admin/EditPhoneDialog"));
const EmployeeProfileDialog = lazy(() => import("@/components/admin/EmployeeProfileDialog"));
const SetPasswordDialog = lazy(() => import("@/components/admin/SetPasswordDialog"));
const UserPermissionsDialog = lazy(() => import("@/components/admin/UserPermissionsDialog"));
const TeamManagement = lazy(() => import("@/components/admin/TeamManagement"));
const CourseCampusMaster = lazy(() => import("@/components/admin/CourseCampusMaster"));
const FinancialGroupsPanel = lazy(() => import("@/components/admin/FinancialGroupsPanel"));
const PaymentGatewaysPanel = lazy(() => import("@/components/admin/PaymentGatewaysPanel"));
const ConsultantFeeManagementPanel = lazy(() => import("@/components/admin/ConsultantFeeManagementPanel"));
const ApprovalLettersPanel = lazy(() => import("@/components/admin/ApprovalLettersPanel"));
const BrandingPanel = lazy(() =>
  import("@/components/admin/BrandingPanel").then((m) => ({ default: m.BrandingPanel })));
const FaceApprovalPanel = lazy(() => import("@/components/admin/FaceApprovalPanel"));
const TransferAccountDialog = lazy(() =>
  import("@/components/admin/TransferAccountDialog").then((m) => ({ default: m.TransferAccountDialog })));

type AppRole = Database["public"]["Enums"]["app_role"];

const ALL_ROLES: { value: AppRole; label: string }[] = [
  { value: "super_admin", label: "Super Admin" },
  { value: "campus_admin", label: "Campus Admin" },
  { value: "principal", label: "Principal" },
  { value: "admission_head", label: "Admission Head" },
  { value: "counsellor", label: "Counsellor" },
  { value: "accountant", label: "Accountant" },
  { value: "faculty", label: "Faculty" },
  { value: "teacher", label: "Teacher" },
  { value: "data_entry", label: "Data Entry" },
  { value: "office_admin", label: "Office Administrator" },
  { value: "office_assistant", label: "Office Assistant" },
  { value: "hostel_warden", label: "Hostel Warden" },
  { value: "librarian", label: "Librarian" },
  { value: "consultant", label: "Consultant" },
  { value: "academic_partner", label: "Academic Partner" },
  { value: "academic_partner_offer_letter", label: "Academic Partner + Offers" },
  { value: "student", label: "Student" },
  { value: "parent", label: "Parent" },
];

const PARTNER_PORTAL_ROLES: AppRole[] = ["academic_partner", "academic_partner_offer_letter"];

interface UserWithRole {
  user_id: string;
  profile_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  campus: string | null;
  role: AppRole | null;
  role_id: string | null;
  last_sign_in_at: string | null;
  profile_updated_at: string | null;
  login_disabled: boolean;
  last_seen_at: string | null;
  archived_at: string | null;
}

function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < 2 * 60 * 1000;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function AdminLazyFallback() {
  return (
    <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading...
    </div>
  );
}

const AdminPanel = () => {
  const { user: authUser, role, isImpersonating, startImpersonating, hasPermission, loading: authLoading, roleLoaded } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishers, setPublishers] = useState<any[]>([]);
  const [publishersLoading, setPublishersLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [userSubTab, setUserSubTab] = useState<"employees" | "consultants" | "academic_partners" | "publishers" | "families" | "leads">("employees");
  const [roleFilter, setRoleFilter] = useState<AppRole | "all" | "none">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [phoneEdit, setPhoneEdit] = useState<{ userId: string; name: string; phone: string | null } | null>(null);
  const [employeeProfile, setEmployeeProfile] = useState<{ userId: string; name: string } | null>(null);
  const [setPasswordTarget, setSetPasswordTarget] = useState<{ userId: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ userId: string; name: string } | null>(null);
  const [permTarget, setPermTarget] = useState<{ userId: string; name: string; role: string | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [disableTarget, setDisableTarget] = useState<{ userId: string; name: string; nextDisabled: boolean } | null>(null);
  const [togglingLogin, setTogglingLogin] = useState(false);
  const [showArchivedUsers, setShowArchivedUsers] = useState(false);
  const [archivingUser, setArchivingUser] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ profileId: string; userId: string; name: string } | null>(null);
  const [linkingPubId, setLinkingPubId] = useState<string | null>(null);
  const [linkUserId, setLinkUserId] = useState<string>("");
  const [linking, setLinking] = useState(false);
  const [inviteDefaults, setInviteDefaults] = useState<{ role?: AppRole; source?: string; publisherId?: string }>({});
  const { toast } = useToast();

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_user_directory" as any, {
        _show_archived: showArchivedUsers,
      }).limit(10000);

      if (error) {
        toast({ title: "Error loading users", description: error.message, variant: "destructive" });
        return;
      }

      const merged: UserWithRole[] = ((data || []) as any[]).map((row) => ({
        user_id: row.user_id,
        profile_id: row.profile_id,
        display_name: row.display_name,
        email: row.email || null,
        phone: row.phone,
        campus: row.campus,
        role: row.role ?? null,
        role_id: row.role_id ?? null,
        last_sign_in_at: row.last_sign_in_at || null,
        profile_updated_at: row.profile_updated_at || null,
        login_disabled: !!row.login_disabled,
        last_seen_at: row.last_seen_at || null,
        archived_at: row.archived_at || null,
      }));

      setUsers(merged);
    } catch (err: any) {
      console.error("fetchUsers crashed:", err);
      toast({ title: "Error", description: err.message || "Failed to load users", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const isSuperAdmin = role === "super_admin";
  const canManageUsers = isSuperAdmin || hasPermission("user_management:view");

  const fetchPublishers = async () => {
    setPublishersLoading(true);
    const { data } = await supabase
      .from("publishers")
      .select("id, display_name, source, is_active, user_id, created_at")
      .order("source", { ascending: true });
    setPublishers(data ?? []);
    setPublishersLoading(false);
  };

  useEffect(() => {
    if (canManageUsers) { fetchUsers(); fetchPublishers(); }
  }, [canManageUsers, showArchivedUsers]);

  const handleLinkPublisher = async (publisherId: string, userId: string) => {
    if (!userId) return;
    setLinking(true);
    try {
      // Clear any prior publisher row holding this user_id (UNIQUE constraint).
      await supabase.from("publishers").update({ user_id: null }).eq("user_id", userId);
      const { error } = await supabase.from("publishers").update({ user_id: userId }).eq("id", publisherId);
      if (error) throw error;

      // Ensure the user has role=publisher; otherwise they can't pass RLS on the
      // publisher-portal page or leads queries.
      const { data: existingRole } = await supabase
        .from("user_roles")
        .select("id, role")
        .eq("user_id", userId)
        .maybeSingle();
      if (!existingRole) {
        await supabase.from("user_roles").insert({ user_id: userId, role: "publisher" });
      } else if (existingRole.role !== "publisher") {
        await supabase.from("user_roles").update({ role: "publisher" }).eq("id", existingRole.id);
      }

      toast({ title: "Linked", description: "Publisher linked & role set to publisher." });
      setLinkingPubId(null);
      setLinkUserId("");
      await fetchPublishers();
      await fetchUsers();
    } catch (err: any) {
      toast({ title: "Link failed", description: err.message, variant: "destructive" });
    } finally {
      setLinking(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: AppRole | "none") => {
    setSavingUser(userId);
    const user = users.find((u) => u.user_id === userId);
    if (!user) return;

    try {
      if (newRole === "none") {
        if (user.role_id) {
          const { error } = await supabase.from("user_roles").delete().eq("id", user.role_id);
          if (error) throw error;
        }
      } else if (user.role_id) {
        const { error } = await supabase.from("user_roles").update({ role: newRole }).eq("id", user.role_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
        if (error) throw error;
      }

      // Auto-create consultant profile when role is set to consultant
      if (newRole === "consultant") {
        const { data: existing } = await supabase.from("consultants").select("id").eq("user_id", userId).maybeSingle();
        if (!existing) {
          const { error: cErr } = await supabase.from("consultants").insert({
            name: user.display_name || "Unnamed Consultant",
            email: user.email || null,
            phone: user.phone || null,
            user_id: userId,
            stage: "active",
          });
          if (cErr) console.error("Failed to create consultant profile:", cErr.message);
        }
      }

      // Auto-create academic partner profile when role is set to a partner portal role.
      if (PARTNER_PORTAL_ROLES.includes(newRole as AppRole)) {
        const { data: existing } = await supabase.from("academic_partners").select("id").eq("user_id", userId).maybeSingle();
        if (!existing) {
          const { error: apErr } = await supabase.from("academic_partners").insert({
            name: user.display_name || "Unnamed Academic Partner",
            email: user.email || null,
            phone: user.phone || null,
            user_id: userId,
            status: "active",
          });
          if (apErr) console.error("Failed to create academic partner profile:", apErr.message);
        }
      }

      // Unlink consultant profile if role changed away from consultant
      if (user.role === "consultant" && newRole !== "consultant") {
        await supabase.from("consultants").update({ user_id: null }).eq("user_id", userId);
      }

      // Unlink academic partner profile if role changed away from partner portal roles.
      if (user.role && PARTNER_PORTAL_ROLES.includes(user.role) && !PARTNER_PORTAL_ROLES.includes(newRole as AppRole)) {
        await supabase.from("academic_partners").update({ user_id: null }).eq("user_id", userId);
      }

      // Unlink publisher profile if role changed away from publisher
      if (user.role === "publisher" && newRole !== "publisher") {
        await supabase.from("publishers").update({ user_id: null }).eq("user_id", userId);
      }

      toast({ title: "Role updated", description: `Role ${newRole === "none" ? "removed" : `set to ${newRole.replace("_", " ")}`} successfully.` });
      await fetchUsers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSavingUser(null);
      setEditingUser(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { user_id: deleteTarget.userId },
      });
      if (error) {
        let message = error.message;
        try {
          const text = await (error as any)?.context?.text?.();
          if (text) {
            try { const body = JSON.parse(text); if (body?.error) message = body.error; }
            catch { message = text.slice(0, 200); }
          }
        } catch {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      toast({ title: "User deleted", description: `${deleteTarget.name} has been removed from active user management.` });
      setDeleteTarget(null);
      await fetchUsers();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleLogin = async () => {
    if (!disableTarget) return;
    setTogglingLogin(true);
    try {
      const { data, error } = await supabase.functions.invoke("toggle-user-login", {
        body: { user_id: disableTarget.userId, disabled: disableTarget.nextDisabled },
      });
      if (error) {
        let message = error.message;
        try {
          const text = await (error as any)?.context?.text?.();
          if (text) {
            try { const body = JSON.parse(text); if (body?.error) message = body.error; }
            catch { message = text.slice(0, 200); }
          }
        } catch {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);
      toast({
        title: disableTarget.nextDisabled ? "Login disabled" : "Login enabled",
        description: disableTarget.nextDisabled
          ? `${disableTarget.name} can no longer sign in. Active sessions revoked.`
          : `${disableTarget.name} can sign in again.`,
      });
      setDisableTarget(null);
      await fetchUsers();
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setTogglingLogin(false);
    }
  };

  const handleArchiveUser = async (target: UserWithRole, archived: boolean) => {
    if (archived && !target.login_disabled) {
      toast({ title: "Archive unavailable", description: "Disable login before archiving a user.", variant: "destructive" });
      return;
    }

    setArchivingUser(target.user_id);
    try {
      const payload = archived
        ? { archived_at: new Date().toISOString(), archived_by: authUser?.id ?? null }
        : { archived_at: null, archived_by: null };
      const { error } = await (supabase.from("profiles") as any)
        .update(payload)
        .eq("user_id", target.user_id);
      if (error) throw error;

      toast({
        title: archived ? "User archived" : "User restored",
        description: archived
          ? `${target.display_name || "User"} has been hidden from the main user list.`
          : `${target.display_name || "User"} is visible in the main user list again.`,
      });
      await fetchUsers();
    } catch (err: any) {
      toast({ title: archived ? "Archive failed" : "Restore failed", description: err.message, variant: "destructive" });
    } finally {
      setArchivingUser(null);
    }
  };

  const handleViewProfile = (user: UserWithRole) => {
    if (user.role === "student") {
      // Navigate to student profile (would need admission number lookup)
      navigate("/students");
    } else {
      setEmployeeProfile({ userId: user.user_id, name: user.display_name || "Unnamed" });
    }
  };

  if (authLoading || !roleLoaded) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Allow access if super_admin or has user_management permission
  if (!canManageUsers) return <Navigate to="/" replace />;

  const filtered = users.filter((u) => {
    const matchesSearch =
      !search ||
      (u.display_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.phone || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.campus || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.role || "").toLowerCase().includes(search.toLowerCase());

    const matchesRole =
      roleFilter === "all" ||
      (roleFilter === "none" ? !u.role : u.role === roleFilter);

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" ? !u.login_disabled : u.login_disabled);

    return matchesSearch && matchesRole && matchesStatus;
  });

  const getRoleBadgeClass = (r: AppRole | null) => {
    if (!r) return "bg-muted text-muted-foreground";
    if (r === "super_admin") return "bg-pastel-purple text-foreground/80";
    if (r === "student") return "bg-pastel-blue text-foreground/80";
    if (r === "parent") return "bg-pastel-mint text-foreground/80";
    if (r === "faculty" || r === "teacher") return "bg-pastel-green text-foreground/80";
    return "bg-pastel-orange text-foreground/80";
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage users, roles, and teams</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-pastel-purple px-3 py-1.5">
          <Shield className="h-4 w-4 text-foreground/70" />
          <span className="text-xs font-semibold text-foreground/80">{isSuperAdmin ? "Super Admin" : "User Management"}</span>
        </div>
      </div>

      {isSuperAdmin && (
        <div className="space-y-3">
          <OverdueFollowupEnforcementCard />
          <VoiceProviderCard />
          <NavyaKnowledgeCard />
        </div>
      )}

      <Tabs defaultValue={searchParams.get("tab") || "users"} className="w-full">
        <TabsList className="bg-transparent border-b border-border rounded-none p-0 h-auto gap-0 w-full justify-start">
          <TabsTrigger value="users" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Users & Roles
          </TabsTrigger>
          <TabsTrigger value="teams" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Teams
          </TabsTrigger>
          <TabsTrigger value="course-campus" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Course & Campus
          </TabsTrigger>
          <TabsTrigger value="eligibility" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Eligibility Config
          </TabsTrigger>
          <TabsTrigger value="financial-groups" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Financial Groups
          </TabsTrigger>
          <TabsTrigger value="payment-gateways" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Payment Gateways
          </TabsTrigger>
          <TabsTrigger value="consultant-fees" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Consultant Fees
          </TabsTrigger>
          <TabsTrigger value="approval-letters" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Approval Letters
          </TabsTrigger>
          <TabsTrigger value="branding" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Branding
          </TabsTrigger>
          <TabsTrigger value="face-approval" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Face ID
          </TabsTrigger>
          <TabsTrigger value="permissions" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Permissions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-6">
          <div className="space-y-6">
            {isSuperAdmin && (
              <div className="flex items-center gap-3">
                <button onClick={() => setBulkOpen(true)} className="flex items-center gap-2 rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                  <FileSpreadsheet className="h-4 w-4" /> Bulk Import
                </button>
                <button onClick={() => setInviteOpen(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                  <UserPlus className="h-4 w-4" /> Invite User
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground mr-1">
                {users.length} total users
              </span>
              {([
                { key: "employees" as const, label: "Employees" },
                { key: "consultants" as const, label: "Consultants" },
                { key: "academic_partners" as const, label: "Academic Partners" },
                { key: "publishers" as const, label: "Publishers" },
                { key: "families" as const, label: "Students & Families" },
                { key: "leads" as const, label: "Leads & Applicants" },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setUserSubTab(tab.key); setSearch(""); setRoleFilter("all"); setStatusFilter("all"); }}
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                    userSubTab === tab.key
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative max-w-sm flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input type="text" placeholder="Search by name, phone, campus..." value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-input bg-card pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
                className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                <option value="all">All Status</option>
                <option value="active">Active ({users.filter((u) => !u.login_disabled).length})</option>
                <option value="inactive">Inactive ({users.filter((u) => u.login_disabled).length})</option>
              </select>
              {userSubTab === "employees" && (
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as AppRole | "all" | "none")}
                  className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="all">All Roles</option>
                  {ALL_ROLES.filter((r) => !["student", "parent", "consultant", "academic_partner", "academic_partner_offer_letter"].includes(r.value)).map((r) => (
                    <option key={r.value} value={r.value}>{r.label} ({users.filter((u) => u.role === r.value).length})</option>
                  ))}
                </select>
              )}
              {isSuperAdmin && (
                <label className="flex items-center gap-2 rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground">
                  <Switch checked={showArchivedUsers} onCheckedChange={setShowArchivedUsers} />
                  <span>{showArchivedUsers ? "Showing archived" : "Show archived"}</span>
                </label>
              )}
            </div>

            {(() => {
              const subFiltered = filtered.filter((u) => {
                if (userSubTab === "employees") return u.role && !["student", "parent", "consultant", "academic_partner", "academic_partner_offer_letter", "publisher"].includes(u.role);
                if (userSubTab === "consultants") return u.role === "consultant";
                if (userSubTab === "academic_partners") return !!u.role && PARTNER_PORTAL_ROLES.includes(u.role);
                if (userSubTab === "publishers") return u.role === "publisher";
                if (userSubTab === "families") return u.role === "student" || u.role === "parent";
                return !u.role;
              });
              const allSubUsers = users.filter((u) => {
                if (userSubTab === "employees") return u.role && !["student", "parent", "consultant", "academic_partner", "academic_partner_offer_letter", "publisher"].includes(u.role);
                if (userSubTab === "consultants") return u.role === "consultant";
                if (userSubTab === "academic_partners") return !!u.role && PARTNER_PORTAL_ROLES.includes(u.role);
                if (userSubTab === "publishers") return u.role === "publisher";
                if (userSubTab === "families") return u.role === "student" || u.role === "parent";
                return !u.role;
              });
              return (<>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {userSubTab === "employees" && (<>
                <SummaryCard label="Total Employees" value={allSubUsers.length} bg="bg-pastel-blue" />
                <SummaryCard label="Admins" value={allSubUsers.filter((u) => u.role === "super_admin" || u.role === "campus_admin").length} bg="bg-pastel-purple" />
                <SummaryCard label="Counsellors" value={allSubUsers.filter((u) => u.role === "counsellor").length} bg="bg-pastel-green" />
                <SummaryCard label="Online Now" value={allSubUsers.filter((u) => isOnline(u.last_seen_at)).length} bg="bg-pastel-mint" />
              </>)}
              {userSubTab === "consultants" && (<>
                <SummaryCard label="Total Consultants" value={allSubUsers.length} bg="bg-pastel-purple" />
                <SummaryCard label="With Phone" value={allSubUsers.filter((u) => u.phone).length} bg="bg-pastel-green" />
                <SummaryCard label="With Email" value={allSubUsers.filter((u) => u.email).length} bg="bg-pastel-blue" />
                <SummaryCard label="Shown" value={subFiltered.length} bg="bg-pastel-yellow" />
              </>)}
              {userSubTab === "academic_partners" && (<>
                <SummaryCard label="Total Partners" value={allSubUsers.length} bg="bg-pastel-blue" />
                <SummaryCard label="With Phone" value={allSubUsers.filter((u) => u.phone).length} bg="bg-pastel-green" />
                <SummaryCard label="With Email" value={allSubUsers.filter((u) => u.email).length} bg="bg-pastel-purple" />
                <SummaryCard label="Shown" value={subFiltered.length} bg="bg-pastel-yellow" />
              </>)}
              {userSubTab === "publishers" && (<>
                <SummaryCard label="Total Publishers" value={publishers.length} bg="bg-pastel-blue" />
                <SummaryCard label="Active" value={publishers.filter((p) => p.is_active).length} bg="bg-pastel-green" />
                <SummaryCard label="Linked Users" value={publishers.filter((p) => p.user_id).length} bg="bg-pastel-purple" />
                <SummaryCard label="Pending Login" value={publishers.filter((p) => !p.user_id).length} bg="bg-pastel-yellow" />
              </>)}
              {userSubTab === "families" && (<>
                <SummaryCard label="Total" value={allSubUsers.length} bg="bg-pastel-blue" />
                <SummaryCard label="Students" value={allSubUsers.filter((u) => u.role === "student").length} bg="bg-pastel-green" />
                <SummaryCard label="Parents" value={allSubUsers.filter((u) => u.role === "parent").length} bg="bg-pastel-mint" />
                <SummaryCard label="Shown" value={subFiltered.length} bg="bg-pastel-yellow" />
              </>)}
              {userSubTab === "leads" && (<>
                <SummaryCard label="Total Leads" value={allSubUsers.length} bg="bg-pastel-blue" />
                <SummaryCard label="With Email" value={allSubUsers.filter((u) => u.email).length} bg="bg-pastel-green" />
                <SummaryCard label="With Phone" value={allSubUsers.filter((u) => u.phone).length} bg="bg-pastel-orange" />
                <SummaryCard label="Shown" value={subFiltered.length} bg="bg-pastel-yellow" />
              </>)}
            </div>

            {/* Publishers tab — dedicated table from publishers table */}
            {userSubTab === "publishers" && (
              <div className="rounded-xl bg-card card-shadow overflow-x-auto">
                {publishersLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : publishers.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No publishers found. Use "Invite User" with the Publisher role to add one.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="px-4 py-3 font-medium text-muted-foreground">Publisher</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Lead Source</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Linked User</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {publishers.map((pub) => (
                        <tr key={pub.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium text-foreground">{pub.display_name}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded-full bg-info/10 dark:bg-info/90/40 px-2.5 py-0.5 text-xs font-medium text-info-foreground dark:text-info/80 capitalize">
                              {pub.source}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {pub.user_id ? (() => {
                              const u = users.find(u => u.user_id === pub.user_id);
                              return (
                                <div className="flex items-center gap-2">
                                  <span className="text-success dark:text-success font-medium">
                                    ✓ {u?.display_name || u?.email || pub.user_id.slice(0, 8) + "…"}
                                  </span>
                                  <button
                                    onClick={async () => {
                                      await supabase.from("publishers").update({ user_id: null }).eq("id", pub.id);
                                      await fetchPublishers();
                                    }}
                                    className="text-[11px] text-muted-foreground hover:text-destructive underline"
                                  >
                                    unlink
                                  </button>
                                </div>
                              );
                            })() : linkingPubId === pub.id ? (
                              <div className="flex items-center gap-2">
                                <select
                                  value={linkUserId}
                                  onChange={(e) => setLinkUserId(e.target.value)}
                                  className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none"
                                >
                                  <option value="">— Select user —</option>
                                  <optgroup label="Publisher role">
                                    {users.filter(u => u.role === "publisher").map(u => (
                                      <option key={u.user_id} value={u.user_id}>
                                        {u.display_name || u.email || u.user_id.slice(0, 8)} {u.email ? `· ${u.email}` : ""}
                                      </option>
                                    ))}
                                  </optgroup>
                                  <optgroup label="Other users">
                                    {users.filter(u => u.role !== "publisher").map(u => (
                                      <option key={u.user_id} value={u.user_id}>
                                        {u.display_name || u.email || u.user_id.slice(0, 8)} {u.email ? `· ${u.email}` : ""} {u.role ? `(${u.role})` : "(no role)"}
                                      </option>
                                    ))}
                                  </optgroup>
                                </select>
                                <button
                                  disabled={!linkUserId || linking}
                                  onClick={() => handleLinkPublisher(pub.id, linkUserId)}
                                  className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                >
                                  {linking ? "Linking…" : "Link"}
                                </button>
                                <button
                                  onClick={() => { setLinkingPubId(null); setLinkUserId(""); }}
                                  className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-warning-foreground dark:text-warning">⚠ No login yet</span>
                                <button
                                  onClick={() => {
                                    setInviteDefaults({ role: "publisher", source: pub.source, publisherId: pub.id });
                                    setInviteOpen(true);
                                  }}
                                  className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                                >
                                  + Create user
                                </button>
                                <button
                                  onClick={() => { setLinkingPubId(pub.id); setLinkUserId(""); }}
                                  className="rounded-md border border-input bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
                                >
                                  Link existing…
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {pub.is_active ? (
                              <span className="inline-flex items-center rounded-full bg-success/10 dark:bg-success/90/40 px-2 py-0.5 text-xs font-medium text-success dark:text-success">Active</span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Inactive</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {new Date(pub.created_at).toLocaleDateString("en-IN")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            <div className="rounded-xl bg-card card-shadow overflow-x-auto" style={{ display: userSubTab === "publishers" ? "none" : undefined }}>
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : subFiltered.length === 0 ? (
                <div className="py-16 text-center">
                  <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No users found</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground">User</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Email</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Phone (OTP)</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Campus</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Current Role</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Last Login</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Last Active</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subFiltered.map((user) => {
                      const initials = (user.display_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                      const isEditing = editingUser === user.user_id;
                      const isSaving = savingUser === user.user_id;
                      const isFamiliesTab = userSubTab === "families";
                      return (
                        <tr key={user.user_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="relative shrink-0">
                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{initials}</div>
                                {isOnline(user.last_seen_at) && (
                                  <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-success/50 ring-2 ring-background" title="Online now" />
                                )}
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <p className="font-medium text-foreground">{user.display_name || "Unnamed"}</p>
                                {user.login_disabled && (
                                  <span className="inline-flex items-center gap-1 self-start rounded-md bg-warning/50/10 px-1.5 py-0.5 text-[10px] font-medium text-warning-foreground dark:text-warning">
                                    <Lock className="h-2.5 w-2.5" /> Login disabled
                                  </span>
                                )}
                                {user.archived_at && (
                                  <span className="inline-flex items-center gap-1 self-start rounded-md bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-300">
                                    <Archive className="h-2.5 w-2.5" /> Archived
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-sm ${user.email ? "text-foreground" : "text-muted-foreground italic"}`}>{user.email || "—"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm ${user.phone ? "text-foreground" : "text-muted-foreground italic"}`}>{user.phone || "Not set"}</span>
                              <button onClick={() => setPhoneEdit({ userId: user.user_id, name: user.display_name || "User", phone: user.phone })}
                                className="rounded-lg p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="Edit phone number">
                                <Phone className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{user.campus || "—"}</td>
                          <td className="px-4 py-3">
                            {isEditing ? (
                              <div className="flex items-center gap-2">
                                <select defaultValue={user.role || "none"} onChange={(e) => handleRoleChange(user.user_id, e.target.value as AppRole | "none")} disabled={isSaving}
                                  className="rounded-lg border border-input bg-card px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20">
                                  <option value="none">No Role</option>
                                  {ALL_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                                </select>
                                {isSaving && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                                <button onClick={() => setEditingUser(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                              </div>
                            ) : (
                              <span className={`rounded-md px-2.5 py-0.5 text-[11px] font-semibold ${getRoleBadgeClass(user.role)}`}>
                                {user.role ? ALL_ROLES.find((r) => r.value === user.role)?.label || user.role : "No Role"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {user.last_sign_in_at ? (
                              <span className="text-xs text-foreground" title={new Date(user.last_sign_in_at).toLocaleString("en-IN")}>
                                {timeAgo(user.last_sign_in_at)}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">Never</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {user.profile_updated_at ? (
                              <span className="text-xs text-foreground" title={new Date(user.profile_updated_at).toLocaleString("en-IN")}>
                                {timeAgo(user.profile_updated_at)}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5 flex-nowrap">
                              <button onClick={() => handleViewProfile(user)}
                                className="rounded-lg bg-muted p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                                title={user.role === "student" ? "View Student Profile" : "View Employee Profile"}>
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              {!isEditing && (
                                <>
                                  {!isFamiliesTab && isSuperAdmin && (
                                    <button onClick={async () => { await startImpersonating(user.user_id); navigate("/"); }}
                                      className="rounded-lg bg-warning/50/10 p-1.5 text-warning-foreground dark:text-warning hover:bg-warning/50/20 transition-colors"
                                      title="Impersonate user">
                                      <UserCheck className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {isSuperAdmin && (
                                    <button onClick={() => setSetPasswordTarget({ userId: user.user_id, name: user.display_name || "User" })}
                                      className="rounded-lg bg-muted p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                                      title="Set password">
                                      <KeyRound className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {!isFamiliesTab && isSuperAdmin && (
                                    <button onClick={() => setEditingUser(user.user_id)}
                                      className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors">
                                      Role
                                    </button>
                                  )}
                                  {!isFamiliesTab && isSuperAdmin && (
                                    <button onClick={() => setPermTarget({ userId: user.user_id, name: user.display_name || "User", role: user.role })}
                                      className="rounded-lg bg-muted p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                                      title="Manage permissions">
                                      <Shield className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {isSuperAdmin && user.role !== "super_admin" && user.user_id !== authUser?.id && (
                                    <button onClick={() => setDisableTarget({
                                      userId: user.user_id,
                                      name: user.display_name || "Unnamed",
                                      nextDisabled: !user.login_disabled,
                                    })}
                                      className={user.login_disabled
                                        ? "rounded-lg bg-success/50/10 p-1.5 text-success dark:text-success hover:bg-success/50/20 transition-colors"
                                        : "rounded-lg bg-warning/50/10 p-1.5 text-warning-foreground dark:text-warning hover:bg-warning/50/20 transition-colors"}
                                      title={user.login_disabled ? "Enable login" : "Disable login"}>
                                      {user.login_disabled
                                        ? <LockOpen className="h-3.5 w-3.5" />
                                        : <Lock className="h-3.5 w-3.5" />}
                                    </button>
                                  )}
                                  {isSuperAdmin && user.role !== "super_admin" && user.user_id !== authUser?.id && (
                                    showArchivedUsers ? (
                                      <button
                                        onClick={() => handleArchiveUser(user, false)}
                                        disabled={archivingUser === user.user_id}
                                        className="rounded-lg bg-success/50/10 p-1.5 text-success dark:text-success hover:bg-success/50/20 transition-colors disabled:opacity-50"
                                        title="Restore to main user list"
                                      >
                                        {archivingUser === user.user_id
                                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          : <ArchiveRestore className="h-3.5 w-3.5" />}
                                      </button>
                                    ) : user.login_disabled ? (
                                      <button
                                        onClick={() => handleArchiveUser(user, true)}
                                        disabled={archivingUser === user.user_id}
                                        className="rounded-lg bg-slate-500/10 p-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-500/20 transition-colors disabled:opacity-50"
                                        title="Archive inactive user"
                                      >
                                        {archivingUser === user.user_id
                                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          : <Archive className="h-3.5 w-3.5" />}
                                      </button>
                                    ) : null
                                  )}
                                  {isSuperAdmin && user.role !== "super_admin" && user.user_id !== authUser?.id && (
                                    <button onClick={() => setTransferTarget({ profileId: user.profile_id, userId: user.user_id, name: user.display_name || "Unnamed" })}
                                      className="rounded-lg bg-primary/50/10 p-1.5 text-primary dark:text-primary/60 hover:bg-primary/50/20 transition-colors"
                                      title="Transfer account data">
                                      <ArrowRightLeft className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                  {isSuperAdmin && user.role !== "super_admin" && (
                                    <button onClick={() => setDeleteTarget({ userId: user.user_id, name: user.display_name || "Unnamed" })}
                                      className="rounded-lg bg-destructive/10 p-1.5 text-destructive hover:bg-destructive/20 transition-colors"
                                      title="Delete user">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
              </>);
            })()}

            <Suspense fallback={null}>
              {inviteOpen && (
                <InviteUserDialog
                  open={inviteOpen}
                  onClose={() => { setInviteOpen(false); setInviteDefaults({}); }}
                  onSuccess={() => { fetchUsers(); fetchPublishers(); }}
                  defaultRole={inviteDefaults.role}
                  defaultPublisherSource={inviteDefaults.source}
                  publisherId={inviteDefaults.publisherId}
                />
              )}
              {bulkOpen && <BulkImportDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onSuccess={() => fetchUsers()} />}
              {phoneEdit && (
                <EditPhoneDialog open onClose={() => setPhoneEdit(null)} onSuccess={() => fetchUsers()}
                  userId={phoneEdit.userId} userName={phoneEdit.name} currentPhone={phoneEdit.phone || null} />
              )}
              {employeeProfile && (
                <EmployeeProfileDialog open onClose={() => setEmployeeProfile(null)}
                  onSuccess={() => fetchUsers()}
                  userId={employeeProfile.userId} userName={employeeProfile.name} />
              )}
              {setPasswordTarget && (
                <SetPasswordDialog open onClose={() => setSetPasswordTarget(null)}
                  userId={setPasswordTarget.userId} userName={setPasswordTarget.name} />
              )}
              {permTarget && (
                <UserPermissionsDialog open onClose={() => setPermTarget(null)}
                  userId={permTarget.userId} userName={permTarget.name} userRole={permTarget.role || null} />
              )}
            </Suspense>

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove the user's login and hide them from active user management. Historical records remain linked for audit and reporting.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteUser}
                    disabled={deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Delete User
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={!!disableTarget} onOpenChange={(o) => !o && setDisableTarget(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {disableTarget?.nextDisabled ? "Disable login for" : "Enable login for"} "{disableTarget?.name}"?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {disableTarget?.nextDisabled
                      ? "The user won't be able to sign in. Active sessions will be revoked immediately. Their assignments, history, and data stay intact and you can re-enable any time."
                      : "The user will be able to sign in again with their existing credentials."}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={togglingLogin}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleToggleLogin}
                    disabled={togglingLogin}
                    className={disableTarget?.nextDisabled
                      ? "bg-warning text-white hover:bg-warning/60"
                      : "bg-success text-white hover:bg-success/90"}
                  >
                    {togglingLogin && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    {disableTarget?.nextDisabled ? "Disable login" : "Enable login"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {transferTarget && (
              <Suspense fallback={null}>
                <TransferAccountDialog
                  source={transferTarget}
                  allUsers={users.filter((u) => u.role && !["super_admin", "student", "parent"].includes(u.role)).map((u) => ({
                    profile_id: u.profile_id,
                    user_id: u.user_id,
                    name: u.display_name || "Unnamed",
                    role: u.role,
                  }))}
                  onClose={() => setTransferTarget(null)}
                  onDone={() => { setTransferTarget(null); fetchUsers(); }}
                />
              </Suspense>
            )}
          </div>
        </TabsContent>

        <TabsContent value="teams" className="mt-6">
          <Suspense fallback={<AdminLazyFallback />}><TeamManagement /></Suspense>
        </TabsContent>

        <TabsContent value="course-campus" className="mt-6">
          <Suspense fallback={<AdminLazyFallback />}><CourseCampusMaster /></Suspense>
        </TabsContent>

        <TabsContent value="eligibility" className="mt-6">
          <Suspense fallback={<AdminLazyFallback />}><EligibilityConfigPanel /></Suspense>
        </TabsContent>

        <TabsContent value="financial-groups" className="mt-6">
          <Suspense fallback={<AdminLazyFallback />}><FinancialGroupsPanel /></Suspense>
        </TabsContent>

        <TabsContent value="payment-gateways" className="mt-6">
          <Suspense fallback={<AdminLazyFallback />}><PaymentGatewaysPanel /></Suspense>
        </TabsContent>

        <TabsContent value="consultant-fees" className="mt-6">
          <Suspense fallback={<AdminLazyFallback />}><ConsultantFeeManagementPanel /></Suspense>
        </TabsContent>

        <TabsContent value="approval-letters" className="mt-6">
          <Suspense fallback={<AdminLazyFallback />}><ApprovalLettersPanel /></Suspense>
        </TabsContent>

        <TabsContent value="branding" className="mt-6">
          <Suspense fallback={<AdminLazyFallback />}><BrandingPanel /></Suspense>
        </TabsContent>

        <TabsContent value="face-approval" className="mt-6">
          <Suspense fallback={<AdminLazyFallback />}><FaceApprovalPanel /></Suspense>
        </TabsContent>

        <TabsContent value="permissions" className="mt-6">
          <Suspense fallback={<AdminLazyFallback />}><PermissionMatrixPanel /></Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
};

// Voice agent provider toggle + tunable knobs. Flips the AI call backend
// between Gemini Live native-audio and the cascaded Sarvam STT → Gemini
// text → Sarvam TTS path, AND exposes the latency/voice-quality knobs
// the voice-agent reads on a 30s cache. Switching propagates within
// ~30s of the save (no redeploy required).
type VoiceTuning = {
  gemini_silence_ms: number;
  sarvam_filler_threshold_ms: number;
  sarvam_pace: number;
  sarvam_speaker: string;
  sarvam_bulbul_model: string;
  // Round 2 — high & medium value
  gemini_voice: string;
  gemini_model: string;
  gemini_prefix_padding_ms: number;
  cascade_max_tokens: number;
  cascade_temperature: number;
  cascade_lang_override: "auto" | "hi-IN" | "en-IN";
  // Round 3 — ElevenLabs as alternative cascade TTS
  cascade_tts_provider: "sarvam" | "elevenlabs";
  elevenlabs_voice_id: string;
};

// v3-beta speakers (per Sarvam API): aditya/ritu/ashutosh/priya/neha/
// rahul/pooja/rohan/simran/kavya. v3-stable accepts a different mostly-
// disjoint set including suhani/anushka/manisha/shubh/etc. — using the
// v3-beta list here since that's our default model and the API rejects
// mismatched (model, speaker) pairs with HTTP 400.
const SARVAM_SPEAKERS = ["priya", "neha", "ritu", "pooja", "kavya", "simran", "aditya", "ashutosh", "rahul", "rohan"] as const;
const BULBUL_MODELS = ["bulbul:v3", "bulbul:v3-beta"] as const;
const GEMINI_VOICES = ["Aoede", "Charon", "Fenrir", "Kore", "Leda", "Puck", "Zephyr"] as const;
const GEMINI_MODELS = [
  "gemini-2.5-flash-native-audio-latest",
  "gemini-2.5-flash-native-audio-preview-09-2025",
  "gemini-2.5-flash-native-audio-preview-12-2025",
] as const;
const CASCADE_LANGS = [
  { v: "auto",  label: "Auto-detect from script" },
  { v: "hi-IN", label: "Force Hindi (hi-IN)" },
  { v: "en-IN", label: "Force English (en-IN)" },
] as const;

function NavyaKnowledgeCard() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<number>(0);

  useEffect(() => {
    (async () => {
      const { count } = await (supabase as any)
        .from("voice_knowledge_gaps")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      setPending(count ?? 0);
    })();
  }, []);

  return (
    <button
      onClick={() => navigate("/admin/navya-knowledge")}
      className="w-full flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="rounded-xl bg-pastel-purple p-2">
        <Sparkles className="h-5 w-5 text-foreground/70" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Navya Knowledge</p>
        <p className="text-[12px] text-muted-foreground mt-0.5">Review questions Navya couldn't answer and teach her the right replies.</p>
      </div>
      {pending > 0 && (
        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">{pending} pending</span>
      )}
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}

function VoiceProviderCard() {
  const { toast } = useToast();
  const [provider, setProvider] = useState<"gemini" | "sarvam" | null>(null);
  const [saving, setSaving] = useState(false);
  const [tuning, setTuning] = useState<VoiceTuning | null>(null);
  const [tuningSaving, setTuningSaving] = useState(false);

  useEffect(() => {
    (supabase.rpc("get_voice_agent_provider" as any) as any).then(({ data }: any) => {
      setProvider((data === "sarvam" ? "sarvam" : "gemini"));
    });
    (supabase.rpc("get_voice_agent_settings" as any) as any).then(({ data }: any) => {
      // Defaults match the migration so the UI always renders something useful
      setTuning({
        gemini_silence_ms:          data?.gemini_silence_ms          ?? 1500,
        sarvam_filler_threshold_ms: data?.sarvam_filler_threshold_ms ?? 700,
        sarvam_pace:                Number(data?.sarvam_pace ?? 1.0),
        sarvam_speaker:             data?.sarvam_speaker             ?? "suhani",
        sarvam_bulbul_model:        data?.sarvam_bulbul_model        ?? "bulbul:v3-beta",
        gemini_voice:               data?.gemini_voice               ?? "Aoede",
        gemini_model:               data?.gemini_model               ?? "gemini-2.5-flash-native-audio-latest",
        gemini_prefix_padding_ms:   data?.gemini_prefix_padding_ms   ?? 300,
        cascade_max_tokens:         data?.cascade_max_tokens         ?? 150,
        cascade_temperature:        Number(data?.cascade_temperature ?? 0.4),
        cascade_lang_override:      (data?.cascade_lang_override === "hi-IN" || data?.cascade_lang_override === "en-IN") ? data.cascade_lang_override : "auto",
        cascade_tts_provider:       data?.cascade_tts_provider === "elevenlabs" ? "elevenlabs" : "sarvam",
        elevenlabs_voice_id:        data?.elevenlabs_voice_id ?? "",
      });
    });
  }, []);

  const flip = async (next: "gemini" | "sarvam") => {
    if (next === provider) return;
    setSaving(true);
    const { error } = await supabase.rpc("set_voice_agent_provider" as any, { _provider: next });
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't change provider", description: error.message, variant: "destructive" });
      return;
    }
    setProvider(next);
    toast({ title: `Voice provider switched to ${next}`, description: "New calls land on the new engine within ~30s." });
  };

  // Patch one or more tuning fields. Only the changed field needs to be
  // sent — set_voice_agent_settings does a partial JSONB merge.
  const patchTuning = async (patch: Partial<VoiceTuning>) => {
    if (!tuning) return;
    const next: VoiceTuning = { ...tuning, ...patch };
    setTuning(next);
    setTuningSaving(true);
    const { error } = await supabase.rpc("set_voice_agent_settings" as any, { _settings: patch });
    setTuningSaving(false);
    if (error) {
      toast({ title: "Couldn't save setting", description: error.message, variant: "destructive" });
      // Refetch on failure so the UI snaps back to the actual stored value
      const { data } = await (supabase.rpc("get_voice_agent_settings" as any) as any);
      if (data) setTuning(data);
      return;
    }
    toast({ title: "Saved", description: "Active on new calls within ~30s." });
  };

  if (!provider) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
      {/* ── Provider toggle (existing) ── */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">AI Voice Agent backend</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            <span className="font-medium">Gemini Live</span> = end-to-end native audio (lower latency, less resilient).
            <span className="font-medium"> Sarvam</span> = STT + Gemini text + TTS (higher latency, more resilient, Indian-language native voices).
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1">
          <button
            disabled={saving}
            onClick={() => flip("gemini")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${provider === "gemini" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Gemini Live
          </button>
          <button
            disabled={saving}
            onClick={() => flip("sarvam")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${provider === "sarvam" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Sarvam
          </button>
        </div>
      </div>

      {/* ── Tunable settings ── only the section for the ACTIVE provider
              is shown so admins aren't editing knobs that don't apply. */}
      {tuning && (
        <div className="border-t border-border pt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-foreground/80 uppercase tracking-wide">
              Tuning · {provider === "gemini" ? "Gemini Live" : "Sarvam Cascade"}
            </p>
            {tuningSaving && <span className="text-[11px] text-muted-foreground">Saving…</span>}
          </div>

          {/* ── Gemini Live tuning ── */}
          {provider === "gemini" && (
            <div className="space-y-3">
              {/* Turn-end VAD timeout */}
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs font-medium text-foreground">Turn-end timeout</label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.gemini_silence_ms} ms</span>
                </div>
                <input
                  type="range" min={500} max={3000} step={100}
                  value={tuning.gemini_silence_ms}
                  onChange={(e) => setTuning({ ...tuning, gemini_silence_ms: Number(e.target.value) })}
                  onMouseUp={(e) => patchTuning({ gemini_silence_ms: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => patchTuning({ gemini_silence_ms: Number((e.target as HTMLInputElement).value) })}
                  className="w-full"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  How long Gemini's VAD waits before declaring the caller done. Lower = snappier. Below ~1200 ms risks self-interrupt on Hindi pauses.
                </p>
              </div>

              {/* Prefix padding */}
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs font-medium text-foreground">Prefix padding</label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.gemini_prefix_padding_ms} ms</span>
                </div>
                <input
                  type="range" min={100} max={500} step={50}
                  value={tuning.gemini_prefix_padding_ms}
                  onChange={(e) => setTuning({ ...tuning, gemini_prefix_padding_ms: Number(e.target.value) })}
                  onMouseUp={(e) => patchTuning({ gemini_prefix_padding_ms: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => patchTuning({ gemini_prefix_padding_ms: Number((e.target as HTMLInputElement).value) })}
                  className="w-full"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">VAD pre-speech context window. Default 300 ms. Lower = miss first phoneme; higher = small lag.</p>
              </div>

              {/* Voice + model side-by-side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Voice</label>
                  <select
                    value={tuning.gemini_voice}
                    onChange={(e) => patchTuning({ gemini_voice: e.target.value })}
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                  >
                    {GEMINI_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Aoede=measured female · Kore=energetic · Charon=deep · Leda/Zephyr=calm.</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Model</label>
                  <select
                    value={tuning.gemini_model}
                    onChange={(e) => patchTuning({ gemini_model: e.target.value })}
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                  >
                    {GEMINI_MODELS.map(m => <option key={m} value={m}>{m.replace("gemini-", "")}</option>)}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">native-audio = best quality. flash-live = lower latency, more synthetic.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Sarvam Cascade tuning ── */}
          {provider === "sarvam" && (
            <div className="space-y-3">
              {/* TTS provider switch — Sarvam Bulbul vs ElevenLabs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-border/40">
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Cascade TTS provider</label>
                  <select
                    value={tuning.cascade_tts_provider}
                    onChange={(e) => patchTuning({ cascade_tts_provider: e.target.value as VoiceTuning["cascade_tts_provider"] })}
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                  >
                    <option value="sarvam">Sarvam Bulbul</option>
                    <option value="elevenlabs">ElevenLabs (Turbo v2.5)</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Bulbul = cheaper, faster (~500ms). ElevenLabs = better Hinglish prosody, ~$0.30/1k chars, ~800ms.
                  </p>
                </div>
                {tuning.cascade_tts_provider === "elevenlabs" && (
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">ElevenLabs voice ID</label>
                    <input
                      type="text"
                      value={tuning.elevenlabs_voice_id}
                      onChange={(e) => setTuning({ ...tuning, elevenlabs_voice_id: e.target.value })}
                      onBlur={(e) => patchTuning({ elevenlabs_voice_id: e.target.value.trim() })}
                      placeholder="paste voice_id from ElevenLabs"
                      className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Find in ElevenLabs dashboard → Voices → click voice → "View ID". e.g. for Anjura.
                    </p>
                  </div>
                )}
              </div>

              {/* Filler-ack threshold */}
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs font-medium text-foreground">Filler-ack threshold</label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.sarvam_filler_threshold_ms} ms</span>
                </div>
                <input
                  type="range" min={0} max={2500} step={100}
                  value={tuning.sarvam_filler_threshold_ms}
                  onChange={(e) => setTuning({ ...tuning, sarvam_filler_threshold_ms: Number(e.target.value) })}
                  onMouseUp={(e) => patchTuning({ sarvam_filler_threshold_ms: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => patchTuning({ sarvam_filler_threshold_ms: Number((e.target as HTMLInputElement).value) })}
                  className="w-full"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  How long after the caller stops speaking before we play a short "ji…" filler while the LLM thinks. 0 = always. ≥2000 = effectively never.
                </p>
              </div>

              {/* Bulbul pace */}
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs font-medium text-foreground">Bulbul pace</label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.sarvam_pace.toFixed(2)}×</span>
                </div>
                <input
                  type="range" min={0.7} max={1.4} step={0.05}
                  value={tuning.sarvam_pace}
                  onChange={(e) => setTuning({ ...tuning, sarvam_pace: Number(e.target.value) })}
                  onMouseUp={(e) => patchTuning({ sarvam_pace: Number((e.target as HTMLInputElement).value) })}
                  onTouchEnd={(e) => patchTuning({ sarvam_pace: Number((e.target as HTMLInputElement).value) })}
                  className="w-full"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">Bulbul speech speed. 1.0 = natural default. Higher = faster.</p>
              </div>

              {/* Bulbul speaker + model side-by-side — hidden when
                  ElevenLabs is the active TTS provider (those settings
                  don't apply to EL). */}
              {tuning.cascade_tts_provider === "sarvam" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">Bulbul speaker</label>
                    <select
                      value={tuning.sarvam_speaker}
                      onChange={(e) => patchTuning({ sarvam_speaker: e.target.value })}
                      className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                    >
                      {SARVAM_SPEAKERS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Filler audio re-renders automatically when the voice changes.</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">Bulbul model</label>
                    <select
                      value={tuning.sarvam_bulbul_model}
                      onChange={(e) => patchTuning({ sarvam_bulbul_model: e.target.value })}
                      className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                    >
                      {BULBUL_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <p className="text-[10px] text-muted-foreground mt-0.5">v3-beta = better prosody · v3 = stable fallback.</p>
                  </div>
                </div>
              )}

              {/* LLM tuning sub-section */}
              <div className="border-t border-border/60 pt-3 space-y-3">
                <p className="text-[10px] font-semibold text-foreground/70 uppercase tracking-wide">LLM (Gemini text)</p>

                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <label className="text-xs font-medium text-foreground">Reply max tokens</label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.cascade_max_tokens}</span>
                  </div>
                  <input
                    type="range" min={50} max={500} step={10}
                    value={tuning.cascade_max_tokens}
                    onChange={(e) => setTuning({ ...tuning, cascade_max_tokens: Number(e.target.value) })}
                    onMouseUp={(e) => patchTuning({ cascade_max_tokens: Number((e.target as HTMLInputElement).value) })}
                    onTouchEnd={(e) => patchTuning({ cascade_max_tokens: Number((e.target as HTMLInputElement).value) })}
                    className="w-full"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">~150 tokens ≈ 2-3 short sentences. Tighter = faster TTS, but cuts off long answers.</p>
                </div>

                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <label className="text-xs font-medium text-foreground">Temperature</label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{tuning.cascade_temperature.toFixed(2)}</span>
                  </div>
                  <input
                    type="range" min={0} max={1.5} step={0.05}
                    value={tuning.cascade_temperature}
                    onChange={(e) => setTuning({ ...tuning, cascade_temperature: Number(e.target.value) })}
                    onMouseUp={(e) => patchTuning({ cascade_temperature: Number((e.target as HTMLInputElement).value) })}
                    onTouchEnd={(e) => patchTuning({ cascade_temperature: Number((e.target as HTMLInputElement).value) })}
                    className="w-full"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">0 = deterministic. 0.4 = default. 0.7+ = more variety, occasionally off-script.</p>
                </div>

                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Bulbul language override</label>
                  <select
                    value={tuning.cascade_lang_override}
                    onChange={(e) => patchTuning({ cascade_lang_override: e.target.value as VoiceTuning["cascade_lang_override"] })}
                    className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
                  >
                    {CASCADE_LANGS.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Auto reads phonetics from the script the LLM emitted. Force one if you see persistent mispronunciations.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SummaryCard = ({ label, value, bg }: { label: string; value: number; bg: string }) => (
  <div className="rounded-xl bg-card card-shadow p-4 flex items-center gap-3">
    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${bg}`}>
      <span className="text-xs font-bold text-foreground/70">#</span>
    </div>
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  </div>
);

function OverdueFollowupEnforcementCard() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (supabase.rpc("get_overdue_followup_enforcement_enabled" as any) as any).then(({ data, error }: any) => {
      if (error) {
        toast({ title: "Couldn't load overdue follow-up setting", description: error.message, variant: "destructive" });
        setEnabled(true);
        return;
      }
      setEnabled(data !== false);
    });
  }, [toast]);

  const updateEnabled = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setSaving(true);

    const { error } = await supabase.rpc("set_overdue_followup_enforcement_enabled" as any, { _enabled: next });
    setSaving(false);

    if (error) {
      setEnabled(previous);
      toast({ title: "Couldn't save overdue follow-up setting", description: error.message, variant: "destructive" });
      return;
    }

    toast({
      title: next ? "Overdue follow-ups enabled" : "Overdue follow-ups paused",
      description: next
        ? "Counsellor overdue queues and direct-dial priority checks are active."
        : "Overdue queues and direct-dial overdue blocking are temporarily suppressed.",
    });
  };

  if (enabled === null) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${enabled ? "bg-warning/10 text-warning-foreground" : "bg-slate-100 text-slate-600"}`}>
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-[240px]">
          <p className="text-sm font-semibold text-foreground">Overdue follow-up enforcement</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {enabled
              ? "Overdue follow-ups appear in counsellor queues and can block non-priority direct calls."
              : "Overdue follow-up queues are hidden and direct calls are not blocked by overdue follow-ups."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-[11px] text-muted-foreground">Saving...</span>}
          <span className="text-xs font-medium text-muted-foreground">{enabled ? "Enabled" : "Paused"}</span>
          <Switch checked={enabled} disabled={saving} onCheckedChange={updateEnabled} aria-label="Toggle overdue follow-up enforcement" />
        </div>
      </div>
    </div>
  );
}

export default AdminPanel;
