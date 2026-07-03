import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, X, ChevronDown } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { TextField, SelectField } from "@/components/ui/state-fields";
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
  { value: "librarian", label: "Librarian" },
  { value: "consultant", label: "Consultant" },
  { value: "academic_partner", label: "Academic Partner" },
  { value: "video_editor", label: "Video Editor (Consultant)" },
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
  defaultRole?: AppRole;
  defaultPublisherSource?: string;
  publisherId?: string;
}

const InviteUserDialog = ({ open, onClose, onSuccess, defaultRole, defaultPublisherSource, publisherId }: InviteUserDialogProps) => {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedCampuses, setSelectedCampuses] = useState<string[]>([]);
  const [campusDropdownOpen, setCampusDropdownOpen] = useState(false);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [role, setRole] = useState<AppRole>(defaultRole ?? "student");
  const [publisherSource, setPublisherSource] = useState(defaultPublisherSource ?? PUBLISHER_SOURCES[0].value);

  useEffect(() => {
    if (open) {
      if (defaultRole) setRole(defaultRole);
      if (defaultPublisherSource) setPublisherSource(defaultPublisherSource);
    }
  }, [open, defaultRole, defaultPublisherSource]);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    supabase.from("campuses").select("id, name").order("name").then(({ data }) => {
      if (data) setCampuses(data);
    });
    supabase.from("teams").select("id, name").order("name").then(({ data }) => {
      if (data) setTeams(data);
    });
  }, []);

  useEffect(() => {
    if (role !== "counsellor") {
      setSelectedTeamIds([]);
      setTeamDropdownOpen(false);
    }
  }, [role]);

  const toggleCampus = (name: string) => {
    setSelectedCampuses((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
  };

  const toggleTeam = (id: string) => {
    setSelectedTeamIds((prev) =>
      prev.includes(id) ? prev.filter((teamId) => teamId !== id) : [...prev, id]
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
          team_ids: role === "counsellor" ? selectedTeamIds : undefined,
          password: password.trim() || undefined,
          publisher_id: role === "publisher" ? publisherId : undefined,
          publisher_source: role === "publisher" ? publisherSource : undefined,
        },
      });

      if (error) {
        // Pull the real error body out of the FunctionsHttpError context (supabase-js
        // surfaces "non-2xx status code" otherwise).
        let message = error.message;
        try {
          const text = await (error as any)?.context?.text?.();
          if (text) {
            try { const body = JSON.parse(text); if (body?.error) message = body.error; }
            catch { message = text.slice(0, 300); }
          }
        } catch {}
        throw new Error(message);
      }
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

      // Auto-create academic partner profile when inviting with academic partner role
      if (role === "academic_partner" && data?.user_id) {
        const { data: existing } = await supabase.from("academic_partners").select("id").eq("user_id", data.user_id).maybeSingle();
        if (!existing) {
          await supabase.from("academic_partners").insert({
            name: displayName.trim() || email.trim(),
            email: email.trim(),
            phone: phone.trim() || null,
            user_id: data.user_id,
            status: "active",
          });
        }
      }

      // Mirror the same pattern for video editors so the new user has a
      // video_editors row to log into. Rate defaults to 0 — super admin sets
      // it on the Video Approvals → Editors tab.
      if (role === "video_editor" && data?.user_id) {
        const { data: existing } = await supabase.from("video_editors" as any).select("id").eq("user_id", data.user_id).maybeSingle();
        if (!existing) {
          await supabase.from("video_editors" as any).insert({
            name: displayName.trim() || email.trim(),
            email: email.trim(),
            phone: phone.trim() || null,
            user_id: data.user_id,
            active: true,
          });
        }
      }

      // Toast copy depends on which path was taken:
      //  - reused existing user (role / password updated)
      //  - direct create (admin supplied a password)
      //  - email invite delivered
      //  - email rate-limit fallback (created without email; user logs in
      //    via WhatsApp OTP; the staff_welcome WA template was sent if
      //    a phone was provided)
      const fallback = data?.email_skipped_reason === "rate_limit";
      toast({
        title: data?.reused_existing
          ? "Existing user updated"
          : fallback
            ? "User created (email rate-limited)"
            : password ? "User created" : "User invited",
        description: data?.reused_existing
          ? `Reused existing account for ${email}: role set to ${role}${password ? ", password reset" : ""}.`
          : fallback
            ? `Supabase email quota hit. Account is active — they can log in via WhatsApp OTP using ${phone || "their phone number"}. The staff welcome WA was sent.`
            : password
              ? `Account created for ${email}. They can log in immediately.`
              : `Invite sent to ${email}. They'll receive an email to set up their account.`,
      });

      setEmail("");
      setDisplayName("");
      setPhone("");
      setSelectedCampuses([]);
      setSelectedTeamIds([]);
      setRole(defaultRole ?? "student");
      setPublisherSource(defaultPublisherSource ?? PUBLISHER_SOURCES[0].value);
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
      <div className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-card card-shadow p-6 mx-4 animate-fade-in">
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
          <TextField
            value={email}
            onValueChange={setEmail}
            label="Email"
            required
            type="email"
            placeholder="user@example.com"
          />

          <TextField
            value={displayName}
            onValueChange={setDisplayName}
            label="Full Name"
            placeholder="John Doe"
          />

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

          <SelectField
            value={role}
            onValueChange={value => setRole(value as AppRole)}
            options={ALL_ROLES.map(r => ({ value: r.value, label: r.label }))}
            label="Role"
            required
            placeholder="Select role"
            allowEmpty={false}
          />

          {role === "publisher" && (
            <SelectField
              value={publisherSource}
              onValueChange={setPublisherSource}
              options={PUBLISHER_SOURCES.map(s => ({ value: s.value, label: s.label }))}
              label="Lead Source"
              required
              description="Must match the source on their leads"
              allowEmpty={false}
            />
          )}

          {role === "counsellor" && (
            <div className="relative">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Teams
                <span className="ml-1 text-muted-foreground/60 font-normal">— add counsellor to one or more teams</span>
              </label>
              <button
                type="button"
                onClick={() => setTeamDropdownOpen((v) => !v)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                <span className={selectedTeamIds.length === 0 ? "text-muted-foreground" : "text-foreground"}>
                  {selectedTeamIds.length === 0
                    ? "Select teams..."
                    : teams
                      .filter((team) => selectedTeamIds.includes(team.id))
                      .map((team) => team.name)
                      .join(", ")}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
              {teamDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setTeamDropdownOpen(false)} />
                  <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                    <div className="max-h-44 overflow-y-auto py-1">
                      {teams.map((team) => (
                        <label
                          key={team.id}
                          className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedTeamIds.includes(team.id)}
                            onChange={() => toggleTeam(team.id)}
                            className="h-3.5 w-3.5 rounded border-input accent-primary"
                          />
                          <span className="text-foreground">{team.name}</span>
                        </label>
                      ))}
                      {teams.length === 0 && (
                        <p className="px-3 py-2 text-sm text-muted-foreground">No teams found</p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          <TextField
            value={password}
            onValueChange={setPassword}
            label="Password"
            type="password"
            placeholder="Set a password to create account immediately"
            description="Optional — skips email invite"
          />

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
