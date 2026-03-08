import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Shield, Users, Search, ChevronDown, Check, X, Loader2, UserPlus } from "lucide-react";
import InviteUserDialog from "@/components/admin/InviteUserDialog";
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
  { value: "student", label: "Student" },
  { value: "parent", label: "Parent" },
];

interface UserWithRole {
  user_id: string;
  display_name: string | null;
  phone: string | null;
  campus: string | null;
  role: AppRole | null;
  role_id: string | null;
}

const AdminPanel = () => {
  const { role, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const { toast } = useToast();

  const fetchUsers = async () => {
    setLoading(true);
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("user_id, display_name, phone, campus")
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
    if (role === "super_admin") {
      fetchUsers();
    }
  }, [role]);

  const handleRoleChange = async (userId: string, newRole: AppRole | "none") => {
    setSavingUser(userId);
    const user = users.find((u) => u.user_id === userId);
    if (!user) return;

    try {
      if (newRole === "none") {
        // Remove role
        if (user.role_id) {
          const { error } = await supabase.from("user_roles").delete().eq("id", user.role_id);
          if (error) throw error;
        }
      } else if (user.role_id) {
        // Update existing role
        const { error } = await supabase.from("user_roles").update({ role: newRole }).eq("id", user.role_id);
        if (error) throw error;
      } else {
        // Insert new role
        const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
        if (error) throw error;
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

  if (authLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (role !== "super_admin") {
    return <Navigate to="/" replace />;
  }

  const filtered = users.filter(
    (u) =>
      (u.display_name || "").toLowerCase().includes(search.toLowerCase()) ||
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
          <h1 className="text-2xl font-bold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Assign and manage roles for all users.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            Invite User
          </button>
          <div className="flex items-center gap-2 rounded-xl bg-pastel-purple px-3 py-1.5">
            <Shield className="h-4 w-4 text-foreground/70" />
            <span className="text-xs font-semibold text-foreground/80">Super Admin Only</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, campus, or role..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-input bg-card pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
        />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="Total Users" value={users.length} bg="bg-pastel-blue" />
        <SummaryCard label="With Roles" value={users.filter((u) => u.role).length} bg="bg-pastel-green" />
        <SummaryCard label="No Role" value={users.filter((u) => !u.role).length} bg="bg-pastel-yellow" />
        <SummaryCard label="Admins" value={users.filter((u) => u.role === "super_admin" || u.role === "campus_admin").length} bg="bg-pastel-purple" />
      </div>

      {/* User Table */}
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
                <th className="px-4 py-3 font-medium text-muted-foreground">Campus</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Current Role</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const initials = (user.display_name || "?")
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();
                const isEditing = editingUser === user.user_id;
                const isSaving = savingUser === user.user_id;

                return (
                  <tr key={user.user_id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary shrink-0">
                          {initials}
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{user.display_name || "Unnamed"}</p>
                          <p className="text-[11px] text-muted-foreground">{user.phone || "No phone"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{user.campus || "—"}</td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <select
                            defaultValue={user.role || "none"}
                            onChange={(e) => handleRoleChange(user.user_id, e.target.value as AppRole | "none")}
                            disabled={isSaving}
                            className="rounded-lg border border-input bg-card px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                          >
                            <option value="none">No Role</option>
                            {ALL_ROLES.map((r) => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                          {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                          <button onClick={() => setEditingUser(null)} className="text-muted-foreground hover:text-foreground">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span className={`rounded-md px-2.5 py-0.5 text-[11px] font-semibold ${getRoleBadgeClass(user.role)}`}>
                          {user.role ? ALL_ROLES.find((r) => r.value === user.role)?.label || user.role : "No Role"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isEditing && (
                        <button
                          onClick={() => setEditingUser(user.user_id)}
                          className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                        >
                          Change Role
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={() => fetchUsers()}
      />
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
