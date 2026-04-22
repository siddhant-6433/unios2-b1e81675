import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, X, ChevronDown } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
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
  { value: "publisher", label: "Publisher (Lead Aggregator)" },
  { value: "student", label: "Student" },
  { value: "parent", label: "Parent" },
];

// External lead sources that can have a publisher portal account
const PUBLISHER_SOURCES: { value: string; label: string }[] = [
  { value: "collegedunia", label: "Collegedunia" },
  { value: "collegehai", label: "CollegeHai" },
  { value: "justdial", label: "JustDial" },
  { value: "salahlo", label: "Salahlo" },
  { value: "shiksha", label: "Shiksha" },
];

interface InviteUserDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const InviteUserDialog = ({ open, onClose, onSuccess }: InviteUserDialogProps) => {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedCampuses, setSelectedCampuses] = useState<string[]>([]);
  const [campusDropdownOpen, setCampusDropdownOpen] = useState(false);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [role, setRole] = useState<AppRole>("student");
  const [publisherSource, setPublisherSource] = useState(PUBLISHER_SOURCES[0].value);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    supabase.from("campuses").select("id, name").order("name").then(({ data }) => {
      if (data) setCampuses(data);
    });
  }, []);

  const toggleCampus = (name: string) => {
    setSelectedCampuses((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
  };

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
          phone: phone.trim() || undefined,
          role,
          campus: selectedCampuses.length > 0 ? selectedCampuses.join(", ") : undefined,
          password: password.trim() || undefined,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Auto-create consultant profile when inviting with consultant role
      if (role === "consultant" && data?.user_id) {
        const { data: existing } = await supabase.from("consultants").select("id").eq("user_id", data.user_id).maybeSingle();
        if (!existing) {
          await supabase.from("consultants").insert({
            name: displayName.trim() || email.trim(),
            email: email.trim(),
            phone: phone.trim() || null,
            user_id: data.user_id,
            stage: "active",
          });
        }
      }

      // Auto-create or link publisher record when inviting with publisher role
      if (role === "publisher" && data?.user_id) {
        const { data: existing } = await supabase.from("publishers").select("id").eq("user_id", data.user_id).maybeSingle();
        if (!existing) {
          // Check if a publishers record for this source already exists (unlinked)
          const { data: bySource } = await supabase.from("publishers").select("id").eq("source", publisherSource).is("user_id", null).maybeSingle();
          if (bySource) {
            await supabase.from("publishers").update({ user_id: data.user_id, display_name: displayName.trim() || email.trim() }).eq("id", bySource.id);
          } else {
            await supabase.from("publishers").insert({
              display_name: displayName.trim() || email.trim(),
              source: publisherSource,
              user_id: data.user_id,
              is_active: true,
            });
          }
        }
      }

      toast({
        title: password ? "User created" : "User invited",
        description: password
          ? `Account created for ${email}. They can log in immediately.`
          : `Invite sent to ${email}. They'll receive an email to set up their account.`,
      });

      setEmail("");
      setDisplayName("");
      setPhone("");
      setSelectedCampuses([]);
      setRole("student");
      setPublisherSource(PUBLISHER_SOURCES[0].value);
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
              Mobile Number <span className="text-muted-foreground/60 font-normal">(for WhatsApp OTP login)</span>
            </label>
            <PhoneInput value={phone} onChange={setPhone} />
          </div>

          <div className="relative">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Campus
            </label>
            <button
              type="button"
              onClick={() => setCampusDropdownOpen((v) => !v)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              <span className={selectedCampuses.length === 0 ? "text-muted-foreground" : "text-foreground"}>
                {selectedCampuses.length === 0
                  ? "Select campuses…"
                  : selectedCampuses.join(", ")}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
            {campusDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCampusDropdownOpen(false)} />
                <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                  <div className="max-h-44 overflow-y-auto py-1">
                    {campuses.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCampuses.includes(c.name)}
                          onChange={() => toggleCampus(c.name)}
                          className="h-3.5 w-3.5 rounded border-input accent-primary"
                        />
                        <span className="text-foreground">{c.name}</span>
                      </label>
                    ))}
                    {campuses.length === 0 && (
                      <p className="px-3 py-2 text-sm text-muted-foreground">No campuses found</p>
                    )}
                  </div>
                </div>
              </>
            )}
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

          {role === "publisher" && (
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Lead Source <span className="text-destructive">*</span>
                <span className="ml-1 text-muted-foreground/60 font-normal">— must match the source on their leads</span>
              </label>
              <select
                value={publisherSource}
                onChange={(e) => setPublisherSource(e.target.value)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                {PUBLISHER_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}

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
