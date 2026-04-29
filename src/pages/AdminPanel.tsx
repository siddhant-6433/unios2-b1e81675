import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  Users, UserPlus, FileSpreadsheet, Search, Loader2, Shield, Phone, Eye, X, KeyRound, Trash2, UserCheck
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import EligibilityConfigPanel from "@/components/admin/EligibilityConfigPanel";
import { PermissionMatrixPanel } from "@/components/admin/PermissionMatrixPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import InviteUserDialog from "@/components/admin/InviteUserDialog";
import BulkImportDialog from "@/components/admin/BulkImportDialog";
import EditPhoneDialog from "@/components/admin/EditPhoneDialog";
import EmployeeProfileDialog from "@/components/admin/EmployeeProfileDialog";
import SetPasswordDialog from "@/components/admin/SetPasswordDialog";
import UserPermissionsDialog from "@/components/admin/UserPermissionsDialog";
import TeamManagement from "@/components/admin/TeamManagement";
import CourseCampusMaster from "@/components/admin/CourseCampusMaster";
import FinancialGroupsPanel from "@/components/admin/FinancialGroupsPanel";
import PaymentGatewaysPanel from "@/components/admin/PaymentGatewaysPanel";
import ApprovalLettersPanel from "@/components/admin/ApprovalLettersPanel";
import CampusGeofencePanel from "@/components/admin/CampusGeofencePanel";
import FaceApprovalPanel from "@/components/admin/FaceApprovalPanel";
import type { Database } from "@/integrations/supabase/types";

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
  { value: "consultant", label: "Consultant" },
  { value: "student", label: "Student" },
  { value: "parent", label: "Parent" },
];

interface UserWithRole {
  user_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  campus: string | null;
  role: AppRole | null;
  role_id: string | null;
  last_sign_in_at: string | null;
  profile_updated_at: string | null;
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

const AdminPanel = () => {
  const { role, realRole, isImpersonating, startImpersonating, hasPermission, loading: authLoading, roleLoaded } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishers, setPublishers] = useState<any[]>([]);
  const [publishersLoading, setPublishersLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [userSubTab, setUserSubTab] = useState<"employees" | "consultants" | "publishers" | "families" | "leads">("employees");
  const [roleFilter, setRoleFilter] = useState<AppRole | "all" | "none">("all");
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
  const [linkingPubId, setLinkingPubId] = useState<string | null>(null);
  const [linkUserId, setLinkUserId] = useState<string>("");
  const [linking, setLinking] = useState(false);
  const [inviteDefaults, setInviteDefaults] = useState<{ role?: AppRole; source?: string; publisherId?: string }>({});
  const { toast } = useToast();

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data: profiles, error: profileError } = await supabase
        .from("profiles")
        .select("user_id, display_name, email, phone, campus, updated_at")
        .order("created_at", { ascending: false });

      if (profileError) {
        toast({ title: "Error loading profiles", description: profileError.message, variant: "destructive" });
        return;
      }

      const [{ data: roles, error: roleError }, { data: authInfo }] = await Promise.all([
        supabase.from("user_roles").select("id, user_id, role"),
        supabase.rpc("get_user_auth_info" as any).then((r: any) => r).catch(() => ({ data: [], error: null })),
      ]);

      if (roleError) {
        toast({ title: "Error loading roles", description: roleError.message, variant: "destructive" });
        return;
      }

      const authMap: Record<string, string | null> = {};
      (authInfo || []).forEach((a: any) => { authMap[a.user_id] = a.last_sign_in_at; });

      const merged: UserWithRole[] = (profiles || []).map((p: any) => {
        const userRole = (roles || []).find((r) => r.user_id === p.user_id);
        return {
          user_id: p.user_id,
          display_name: p.display_name,
          email: p.email || null,
          phone: p.phone,
          campus: p.campus,
          role: userRole?.role ?? null,
          role_id: userRole?.id ?? null,
          last_sign_in_at: authMap[p.user_id] || null,
          profile_updated_at: p.updated_at || null,
        };
      });

      setUsers(merged);
    } catch (err: any) {
      console.error("fetchUsers crashed:", err);
      toast({ title: "Error", description: err.message || "Failed to load users", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const isSuperAdmin = realRole === "super_admin" || role === "super_admin";
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
  }, [canManageUsers]);

  const handleLinkPublisher = async (publisherId: string, userId: string) => {
    if (!userId) return;
    setLinking(true);
    try {
      // Clear any prior publisher row holding this user_id (UNIQUE constraint).
      await supabase.from("publishers").update({ user_id: null }).eq("user_id", userId);
      const { error } = await supabase.from("publishers").update({ user_id: userId }).eq("id", publisherId);
      if (error) throw error;
      toast({ title: "Linked", description: "Publisher linked to user account." });
      setLinkingPubId(null);
      setLinkUserId("");
      await fetchPublishers();
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

      // Unlink consultant profile if role changed away from consultant
      if (user.role === "consultant" && newRole !== "consultant") {
        await supabase.from("consultants").update({ user_id: null }).eq("user_id", userId);
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
      toast({ title: "User deleted", description: `${deleteTarget.name} has been permanently deleted.` });
      setDeleteTarget(null);
      await fetchUsers();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
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
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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

    return matchesSearch && matchesRole;
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
          <TabsTrigger value="approval-letters" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-sm px-4 py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:font-semibold">
            Approval Letters
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

            <div className="flex items-center gap-2">
              {([
                { key: "employees" as const, label: "Employees" },
                { key: "consultants" as const, label: "Consultants" },
                { key: "publishers" as const, label: "Publishers" },
                { key: "families" as const, label: "Students & Families" },
                { key: "leads" as const, label: "Leads & Applicants" },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setUserSubTab(tab.key); setSearch(""); setRoleFilter("all"); }}
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
              {userSubTab === "employees" && (
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as AppRole | "all" | "none")}
                  className="rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="all">All Roles</option>
                  {ALL_ROLES.filter((r) => !["student", "parent", "consultant"].includes(r.value)).map((r) => (
                    <option key={r.value} value={r.value}>{r.label} ({users.filter((u) => u.role === r.value).length})</option>
                  ))}
                </select>
              )}
            </div>

            {(() => {
              const subFiltered = filtered.filter((u) => {
                if (userSubTab === "employees") return u.role && !["student", "parent", "consultant", "publisher"].includes(u.role);
                if (userSubTab === "consultants") return u.role === "consultant";
                if (userSubTab === "publishers") return u.role === "publisher";
                if (userSubTab === "families") return u.role === "student" || u.role === "parent";
                return !u.role;
              });
              const allSubUsers = users.filter((u) => {
                if (userSubTab === "employees") return u.role && !["student", "parent", "consultant", "publisher"].includes(u.role);
                if (userSubTab === "consultants") return u.role === "consultant";
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
                <SummaryCard label="Faculty" value={allSubUsers.filter((u) => u.role === "faculty" || u.role === "teacher").length} bg="bg-pastel-orange" />
              </>)}
              {userSubTab === "consultants" && (<>
                <SummaryCard label="Total Consultants" value={allSubUsers.length} bg="bg-pastel-purple" />
                <SummaryCard label="With Phone" value={allSubUsers.filter((u) => u.phone).length} bg="bg-pastel-green" />
                <SummaryCard label="With Email" value={allSubUsers.filter((u) => u.email).length} bg="bg-pastel-blue" />
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
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
                            <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-950/40 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400 capitalize">
                              {pub.source}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">
                            {pub.user_id ? (() => {
                              const u = users.find(u => u.user_id === pub.user_id);
                              return (
                                <div className="flex items-center gap-2">
                                  <span className="text-green-700 dark:text-green-400 font-medium">
                                    ✓ {u?.display_name || u?.email || pub.user_id.slice(0, 8) + "…"}
                                  </span>
                                  <button
                                    onClick={async () => {
                                      await supabase.from("publishers").update({ user_id: null }).eq("id", pub.id);
                                      await fetchPublishers();
                                    }}
                                    className="text-[11px] text-muted-foreground hover:text-red-600 underline"
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
                                <span className="text-amber-600 dark:text-amber-400">⚠ No login yet</span>
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
                              <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-950/40 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">Active</span>
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
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary shrink-0">{initials}</div>
                              <p className="font-medium text-foreground">{user.display_name || "Unnamed"}</p>
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
                                {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
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
                                      className="rounded-lg bg-amber-500/10 p-1.5 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
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

            <InviteUserDialog
              open={inviteOpen}
              onClose={() => { setInviteOpen(false); setInviteDefaults({}); }}
              onSuccess={() => { fetchUsers(); fetchPublishers(); }}
              defaultRole={inviteDefaults.role}
              defaultPublisherSource={inviteDefaults.source}
              publisherId={inviteDefaults.publisherId}
            />
            <BulkImportDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onSuccess={() => fetchUsers()} />
            <EditPhoneDialog open={!!phoneEdit} onClose={() => setPhoneEdit(null)} onSuccess={() => fetchUsers()}
              userId={phoneEdit?.userId || ""} userName={phoneEdit?.name || ""} currentPhone={phoneEdit?.phone || null} />
            <EmployeeProfileDialog open={!!employeeProfile} onClose={() => setEmployeeProfile(null)}
              userId={employeeProfile?.userId || ""} userName={employeeProfile?.name || ""} />
            <SetPasswordDialog open={!!setPasswordTarget} onClose={() => setSetPasswordTarget(null)}
              userId={setPasswordTarget?.userId || ""} userName={setPasswordTarget?.name || ""} />
            <UserPermissionsDialog open={!!permTarget} onClose={() => setPermTarget(null)}
              userId={permTarget?.userId || ""} userName={permTarget?.name || ""} userRole={permTarget?.role || null} />

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the user account and all associated data. This action cannot be undone.
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
          </div>
        </TabsContent>

        <TabsContent value="teams" className="mt-6">
          <TeamManagement />
        </TabsContent>

        <TabsContent value="course-campus" className="mt-6">
          <CourseCampusMaster />
        </TabsContent>

        <TabsContent value="eligibility" className="mt-6">
          <EligibilityConfigPanel />
        </TabsContent>

        <TabsContent value="financial-groups" className="mt-6">
          <FinancialGroupsPanel />
        </TabsContent>

        <TabsContent value="payment-gateways" className="mt-6">
          <PaymentGatewaysPanel />
        </TabsContent>

        <TabsContent value="approval-letters" className="mt-6">
          <ApprovalLettersPanel />
        </TabsContent>

        <TabsContent value="face-approval" className="mt-6">
          <FaceApprovalPanel />
        </TabsContent>

        <TabsContent value="permissions" className="mt-6">
          <PermissionMatrixPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
};

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

export default AdminPanel;
