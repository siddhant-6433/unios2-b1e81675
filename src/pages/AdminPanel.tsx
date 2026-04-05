import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  Users, UserPlus, FileSpreadsheet, Search, Loader2, Shield, Phone, Eye, X, KeyRound, Trash2
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import EligibilityConfigPanel from "@/components/admin/EligibilityConfigPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import InviteUserDialog from "@/components/admin/InviteUserDialog";
import BulkImportDialog from "@/components/admin/BulkImportDialog";
import EditPhoneDialog from "@/components/admin/EditPhoneDialog";
import EmployeeProfileDialog from "@/components/admin/EmployeeProfileDialog";
import SetPasswordDialog from "@/components/admin/SetPasswordDialog";
import TeamManagement from "@/components/admin/TeamManagement";
import CourseCampusMaster from "@/components/admin/CourseCampusMaster";
import FinancialGroupsPanel from "@/components/admin/FinancialGroupsPanel";
import PaymentGatewaysPanel from "@/components/admin/PaymentGatewaysPanel";
import ApprovalLettersPanel from "@/components/admin/ApprovalLettersPanel";
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
}

const AdminPanel = () => {
  const { role, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [phoneEdit, setPhoneEdit] = useState<{ userId: string; name: string; phone: string | null } | null>(null);
  const [employeeProfile, setEmployeeProfile] = useState<{ userId: string; name: string } | null>(null);
  const [setPasswordTarget, setSetPasswordTarget] = useState<{ userId: string; name: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ userId: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const fetchUsers = async () => {
    setLoading(true);
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, display_name, email, phone, campus")
      .order("created_at", { ascending: false });

    if (profileError) {
      toast({ title: "Error", description: profileError.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const { data: roles, error: roleError } = await supabase
      .from("user_roles")
      .select("id, user_id, role");

    if (roleError) {
      toast({ title: "Error", description: roleError.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const merged: UserWithRole[] = (profiles || []).map((p) => {
      const userRole = (roles || []).find((r) => r.user_id === p.user_id);
      return {
        user_id: p.user_id,
        display_name: p.display_name,
        email: p.email || null,
        phone: p.phone,
        campus: p.campus,
        role: userRole?.role ?? null,
        role_id: userRole?.id ?? null,
      };
    });

    setUsers(merged);
    setLoading(false);
  };

  useEffect(() => {
    if (role === "super_admin") fetchUsers();
  }, [role]);

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

  if (authLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (role !== "super_admin") return <Navigate to="/" replace />;

  const filtered = users.filter(
    (u) =>
      (u.display_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.phone || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.campus || "").toLowerCase().includes(search.toLowerCase()) ||
      (u.role || "").toLowerCase().includes(search.toLowerCase())
  );

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
          <span className="text-xs font-semibold text-foreground/80">Super Admin Only</span>
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
        </TabsList>

        <TabsContent value="users" className="mt-6">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <button onClick={() => setBulkOpen(true)} className="flex items-center gap-2 rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                <FileSpreadsheet className="h-4 w-4" /> Bulk Import
              </button>
              <button onClick={() => setInviteOpen(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                <UserPlus className="h-4 w-4" /> Invite User
              </button>
            </div>

            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input type="text" placeholder="Search by name, phone, campus, or role..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-input bg-card pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <SummaryCard label="Total Users" value={users.length} bg="bg-pastel-blue" />
              <SummaryCard label="With Roles" value={users.filter((u) => u.role).length} bg="bg-pastel-green" />
              <SummaryCard label="No Role" value={users.filter((u) => !u.role).length} bg="bg-pastel-yellow" />
              <SummaryCard label="Admins" value={users.filter((u) => u.role === "super_admin" || u.role === "campus_admin").length} bg="bg-pastel-purple" />
            </div>

            <div className="rounded-xl bg-card card-shadow overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
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
                      <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((user) => {
                      const initials = (user.display_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                      const isEditing = editingUser === user.user_id;
                      const isSaving = savingUser === user.user_id;
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
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => handleViewProfile(user)}
                                className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 transition-colors flex items-center gap-1"
                                title={user.role === "student" ? "View Student Profile" : "View Employee Profile"}>
                                <Eye className="h-3.5 w-3.5" />{user.role === "student" ? "Student" : "Profile"}
                              </button>
                              {!isEditing && (
                                <>
                                  <button onClick={() => setSetPasswordTarget({ userId: user.user_id, name: user.display_name || "User" })}
                                    className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 transition-colors flex items-center gap-1"
                                    title="Set password">
                                    <KeyRound className="h-3.5 w-3.5" />Password
                                  </button>
                                  <button onClick={() => setEditingUser(user.user_id)}
                                    className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors">
                                    Change Role
                                  </button>
                                  <button onClick={() => setDeleteTarget({ userId: user.user_id, name: user.display_name || "Unnamed" })}
                                    className="rounded-lg bg-destructive/10 p-1.5 text-destructive hover:bg-destructive/20 transition-colors"
                                    title="Delete user">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
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

            <InviteUserDialog open={inviteOpen} onClose={() => setInviteOpen(false)} onSuccess={() => fetchUsers()} />
            <BulkImportDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onSuccess={() => fetchUsers()} />
            <EditPhoneDialog open={!!phoneEdit} onClose={() => setPhoneEdit(null)} onSuccess={() => fetchUsers()}
              userId={phoneEdit?.userId || ""} userName={phoneEdit?.name || ""} currentPhone={phoneEdit?.phone || null} />
            <EmployeeProfileDialog open={!!employeeProfile} onClose={() => setEmployeeProfile(null)}
              userId={employeeProfile?.userId || ""} userName={employeeProfile?.name || ""} />
            <SetPasswordDialog open={!!setPasswordTarget} onClose={() => setSetPasswordTarget(null)}
              userId={setPasswordTarget?.userId || ""} userName={setPasswordTarget?.name || ""} />

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
