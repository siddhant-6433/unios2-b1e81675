import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, X } from "lucide-react";
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

interface InviteUserDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const InviteUserDialog = ({ open, onClose, onSuccess }: InviteUserDialogProps) => {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [campus, setCampus] = useState("");
  const [role, setRole] = useState<AppRole>("student");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !role) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("invite-user", {
        body: {
          email: email.trim(),
          display_name: displayName.trim() || undefined,
          role,
          campus: campus.trim() || undefined,
          password: password.trim() || undefined,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: password ? "User created" : "User invited",
        description: password
          ? `Account created for ${email}. They can log in immediately.`
          : `Invite sent to ${email}. They'll receive an email to set up their account.`,
      });

      setEmail("");
      setDisplayName("");
      setCampus("");
      setRole("student");
      setPassword("");
      onSuccess();
      onClose();
    } catch (err: any) {
      toast({
        title: "Invite failed",
        description: err.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-card card-shadow p-6 mx-4 animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Invite New User</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Email <span className="text-destructive">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Full Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="John Doe"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Campus
            </label>
            <input
              type="text"
              value={campus}
              onChange={(e) => setCampus(e.target.value)}
              placeholder="Main Campus"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Role <span className="text-destructive">*</span>
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              {ALL_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Password <span className="text-muted-foreground/60 font-normal">(optional — skips email invite)</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Set a password to create account immediately"
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {password ? "Creating…" : "Sending…"}
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  {password ? "Create User" : "Send Invite"}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InviteUserDialog;
