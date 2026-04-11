import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, X, User, Briefcase, GraduationCap, MapPin, Save, FileText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface EmployeeProfileDialogProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
}

interface EmployeeProfile {
  id?: string;
  employee_number: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  display_name: string;
  gender: string;
  date_of_birth: string;
  marital_status: string;
  blood_group: string;
  nationality: string;
  physically_handicapped: boolean;
  work_email: string;
  personal_email: string;
  mobile_number: string;
  work_number: string;
  residence_number: string;
  current_address: { line1?: string; city?: string; state?: string; pincode?: string };
  permanent_address: { line1?: string; city?: string; state?: string; pincode?: string };
  date_of_joining: string;
  job_title: string;
  job_title_secondary: string;
  worker_type: string;
  time_type: string;
  notice_period_days: number;
  employment_status: string;
  pan_number: string;
  aadhaar_number: string;
  education: { degree: string; branch: string; university: string; year_completion: string; percentage: string }[];
  experience: { position: string; organization: string; from: string; to: string; location: string }[];
  professional_summary: string;
}

const emptyProfile: EmployeeProfile = {
  employee_number: "", first_name: "", middle_name: "", last_name: "", display_name: "",
  gender: "", date_of_birth: "", marital_status: "", blood_group: "", nationality: "India",
  physically_handicapped: false, work_email: "", personal_email: "", mobile_number: "",
  work_number: "", residence_number: "",
  current_address: {}, permanent_address: {},
  date_of_joining: "", job_title: "", job_title_secondary: "", worker_type: "Permanent",
  time_type: "Full Time", notice_period_days: 90, employment_status: "Working",
  pan_number: "", aadhaar_number: "", education: [], experience: [], professional_summary: "",
};

const EmployeeProfileDialog = ({ open, onClose, userId, userName }: EmployeeProfileDialogProps) => {
  const [profile, setProfile] = useState<EmployeeProfile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isNew, setIsNew] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    (async () => {
      // Fetch base profile (display_name, phone) — email not fetchable from frontend (auth.users is restricted)
      const [profileRes, empRes] = await Promise.all([
        supabase.from("profiles").select("display_name, phone, campus").eq("user_id", userId).maybeSingle(),
        supabase.from("employee_profiles").select("*").eq("user_id", userId).maybeSingle(),
      ]);

      const baseProfile = profileRes.data;
      const empData = empRes.data;
      const authEmail = "";

      if (empRes.error) {
        toast({ title: "Error", description: empRes.error.message, variant: "destructive" });
      }

      if (empData) {
        setProfile({
          id: empData.id,
          employee_number: empData.employee_number || "",
          first_name: empData.first_name || "",
          middle_name: empData.middle_name || "",
          last_name: empData.last_name || "",
          display_name: empData.display_name || baseProfile?.display_name || userName,
          gender: empData.gender || "",
          date_of_birth: empData.date_of_birth || "",
          marital_status: empData.marital_status || "",
          blood_group: empData.blood_group || "",
          nationality: empData.nationality || "India",
          physically_handicapped: empData.physically_handicapped || false,
          work_email: empData.work_email || authEmail || "",
          personal_email: empData.personal_email || "",
          // Prefer employee_profiles.mobile_number, fall back to profiles.phone (OTP login number)
          mobile_number: empData.mobile_number || baseProfile?.phone || "",
          work_number: empData.work_number || "",
          residence_number: empData.residence_number || "",
          current_address: (empData.current_address as any) || {},
          permanent_address: (empData.permanent_address as any) || {},
          date_of_joining: empData.date_of_joining || "",
          job_title: empData.job_title || "",
          job_title_secondary: empData.job_title_secondary || "",
          worker_type: empData.worker_type || "Permanent",
          time_type: empData.time_type || "Full Time",
          notice_period_days: empData.notice_period_days || 90,
          employment_status: empData.employment_status || "Working",
          pan_number: empData.pan_number || "",
          aadhaar_number: empData.aadhaar_number || "",
          education: (empData.education as any) || [],
          experience: (empData.experience as any) || [],
          professional_summary: empData.professional_summary || "",
        });
        setIsNew(false);
      } else {
        // No employee_profiles row yet — pre-fill from profiles + auth
        setProfile({
          ...emptyProfile,
          display_name: baseProfile?.display_name || userName,
          first_name: (baseProfile?.display_name || userName).split(" ")[0] || "",
          last_name: (baseProfile?.display_name || userName).split(" ").slice(1).join(" ") || "",
          mobile_number: baseProfile?.phone || "",
          work_email: authEmail,
        });
        setIsNew(true);
      }
      setLoading(false);
    })();
  }, [open, userId]);

  if (!open) return null;

  const set = (field: keyof EmployeeProfile, value: any) => setProfile((p) => ({ ...p, [field]: value }));
  const setAddr = (type: "current_address" | "permanent_address", field: string, value: string) =>
    setProfile((p) => ({ ...p, [type]: { ...p[type], [field]: value } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        user_id: userId,
        employee_number: profile.employee_number || null,
        first_name: profile.first_name || null,
        middle_name: profile.middle_name || null,
        last_name: profile.last_name || null,
        display_name: profile.display_name || null,
        gender: profile.gender || null,
        date_of_birth: profile.date_of_birth || null,
        marital_status: profile.marital_status || null,
        blood_group: profile.blood_group || null,
        nationality: profile.nationality || null,
        physically_handicapped: profile.physically_handicapped,
        work_email: profile.work_email || null,
        personal_email: profile.personal_email || null,
        mobile_number: profile.mobile_number || null,
        work_number: profile.work_number || null,
        residence_number: profile.residence_number || null,
        current_address: profile.current_address,
        permanent_address: profile.permanent_address,
        date_of_joining: profile.date_of_joining || null,
        job_title: profile.job_title || null,
        job_title_secondary: profile.job_title_secondary || null,
        worker_type: profile.worker_type || null,
        time_type: profile.time_type || null,
        notice_period_days: profile.notice_period_days,
        employment_status: profile.employment_status || null,
        pan_number: profile.pan_number || null,
        aadhaar_number: profile.aadhaar_number || null,
        education: profile.education,
        experience: profile.experience,
        professional_summary: profile.professional_summary || null,
      };

      if (isNew) {
        const { error } = await supabase.from("employee_profiles").insert(payload);
        if (error) throw error;
        setIsNew(false);
      } else {
        const { error } = await supabase.from("employee_profiles").update(payload).eq("user_id", userId);
        if (error) throw error;
      }

      // Also sync mobile_number → profiles.phone (used for OTP login and admin panel display)
      if (profile.mobile_number) {
        const normalizedPhone = profile.mobile_number.startsWith("+")
          ? profile.mobile_number
          : `+${profile.mobile_number.replace(/\D/g, "")}`;
        const profileUpdate: Record<string, string> = { phone: normalizedPhone };
        if (profile.display_name) profileUpdate.display_name = profile.display_name;
        await supabase.from("profiles").upsert({ user_id: userId, ...profileUpdate }, { onConflict: "user_id" });
      }

      toast({ title: "Saved", description: "Employee profile updated successfully." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const addEducation = () => set("education", [...profile.education, { degree: "", branch: "", university: "", year_completion: "", percentage: "" }]);
  const removeEducation = (i: number) => set("education", profile.education.filter((_, idx) => idx !== i));
  const setEdu = (i: number, field: string, value: string) => {
    const arr = [...profile.education];
    arr[i] = { ...arr[i], [field]: value };
    set("education", arr);
  };

  const addExperience = () => set("experience", [...profile.experience, { position: "", organization: "", from: "", to: "", location: "" }]);
  const removeExperience = (i: number) => set("experience", profile.experience.filter((_, idx) => idx !== i));
  const setExp = (i: number, field: string, value: string) => {
    const arr = [...profile.experience];
    arr[i] = { ...arr[i], [field]: value };
    set("experience", arr);
  };

  const inputCls = "w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20";
  const labelCls = "block text-[11px] font-medium text-muted-foreground mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl max-h-[90vh] rounded-2xl bg-card card-shadow mx-4 animate-fade-in flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Briefcase className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Employee Profile</h2>
              <p className="text-xs text-muted-foreground">{userName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 p-6">
            <Tabs defaultValue="personal" className="w-full">
              <TabsList className="bg-muted/50 border border-border rounded-xl p-1 h-auto flex-wrap mb-6">
                <TabsTrigger value="personal" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <User className="h-3.5 w-3.5 mr-1" />Personal
                </TabsTrigger>
                <TabsTrigger value="job" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <Briefcase className="h-3.5 w-3.5 mr-1" />Job
                </TabsTrigger>
                <TabsTrigger value="education" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <GraduationCap className="h-3.5 w-3.5 mr-1" />Education
                </TabsTrigger>
                <TabsTrigger value="experience" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <Briefcase className="h-3.5 w-3.5 mr-1" />Experience
                </TabsTrigger>
                <TabsTrigger value="identity" className="rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  <FileText className="h-3.5 w-3.5 mr-1" />Identity
                </TabsTrigger>
              </TabsList>

              {/* Personal */}
              <TabsContent value="personal" className="space-y-5">
                <Section title="Primary Details">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <Field label="Employee Number" value={profile.employee_number} onChange={(v) => set("employee_number", v)} />
                    <Field label="First Name" value={profile.first_name} onChange={(v) => set("first_name", v)} />
                    <Field label="Middle Name" value={profile.middle_name} onChange={(v) => set("middle_name", v)} />
                    <Field label="Last Name" value={profile.last_name} onChange={(v) => set("last_name", v)} />
                    <Field label="Display Name" value={profile.display_name} onChange={(v) => set("display_name", v)} />
                    <div>
                      <label className={labelCls}>Gender</label>
                      <select value={profile.gender} onChange={(e) => set("gender", e.target.value)} className={inputCls}>
                        <option value="">Select</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <Field label="Date of Birth" value={profile.date_of_birth} onChange={(v) => set("date_of_birth", v)} type="date" />
                    <Field label="Marital Status" value={profile.marital_status} onChange={(v) => set("marital_status", v)} />
                    <Field label="Blood Group" value={profile.blood_group} onChange={(v) => set("blood_group", v)} />
                    <Field label="Nationality" value={profile.nationality} onChange={(v) => set("nationality", v)} />
                    <div className="flex items-center gap-2 pt-5">
                      <input type="checkbox" checked={profile.physically_handicapped} onChange={(e) => set("physically_handicapped", e.target.checked)} className="rounded" />
                      <span className="text-sm text-foreground">Physically Handicapped</span>
                    </div>
                  </div>
                </Section>

                <Section title="Contact Details">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <Field label="Work Email" value={profile.work_email} onChange={(v) => set("work_email", v)} type="email" />
                    <Field label="Personal Email" value={profile.personal_email} onChange={(v) => set("personal_email", v)} type="email" />
                    <Field label="Mobile Number" value={profile.mobile_number} onChange={(v) => set("mobile_number", v)} type="tel" />
                    <Field label="Work Number" value={profile.work_number} onChange={(v) => set("work_number", v)} type="tel" />
                    <Field label="Residence Number" value={profile.residence_number} onChange={(v) => set("residence_number", v)} type="tel" />
                  </div>
                </Section>

                <Section title="Current Address">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Address Line" value={profile.current_address.line1 || ""} onChange={(v) => setAddr("current_address", "line1", v)} />
                    <Field label="City" value={profile.current_address.city || ""} onChange={(v) => setAddr("current_address", "city", v)} />
                    <Field label="State" value={profile.current_address.state || ""} onChange={(v) => setAddr("current_address", "state", v)} />
                    <Field label="Pincode" value={profile.current_address.pincode || ""} onChange={(v) => setAddr("current_address", "pincode", v)} />
                  </div>
                </Section>

                <Section title="Permanent Address">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Address Line" value={profile.permanent_address.line1 || ""} onChange={(v) => setAddr("permanent_address", "line1", v)} />
                    <Field label="City" value={profile.permanent_address.city || ""} onChange={(v) => setAddr("permanent_address", "city", v)} />
                    <Field label="State" value={profile.permanent_address.state || ""} onChange={(v) => setAddr("permanent_address", "state", v)} />
                    <Field label="Pincode" value={profile.permanent_address.pincode || ""} onChange={(v) => setAddr("permanent_address", "pincode", v)} />
                  </div>
                </Section>
              </TabsContent>

              {/* Job */}
              <TabsContent value="job" className="space-y-5">
                <Section title="Job Details">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <Field label="Date of Joining" value={profile.date_of_joining} onChange={(v) => set("date_of_joining", v)} type="date" />
                    <Field label="Job Title (Primary)" value={profile.job_title} onChange={(v) => set("job_title", v)} />
                    <Field label="Job Title (Secondary)" value={profile.job_title_secondary} onChange={(v) => set("job_title_secondary", v)} />
                    <div>
                      <label className={labelCls}>Worker Type</label>
                      <select value={profile.worker_type} onChange={(e) => set("worker_type", e.target.value)} className={inputCls}>
                        <option value="Permanent">Permanent</option>
                        <option value="Contract">Contract</option>
                        <option value="Intern">Intern</option>
                        <option value="Probation">Probation</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Time Type</label>
                      <select value={profile.time_type} onChange={(e) => set("time_type", e.target.value)} className={inputCls}>
                        <option value="Full Time">Full Time</option>
                        <option value="Part Time">Part Time</option>
                      </select>
                    </div>
                    <Field label="Notice Period (Days)" value={String(profile.notice_period_days)} onChange={(v) => set("notice_period_days", parseInt(v) || 0)} type="number" />
                    <div>
                      <label className={labelCls}>Employment Status</label>
                      <select value={profile.employment_status} onChange={(e) => set("employment_status", e.target.value)} className={inputCls}>
                        <option value="Working">Working</option>
                        <option value="Resigned">Resigned</option>
                        <option value="Terminated">Terminated</option>
                        <option value="On Notice">On Notice</option>
                      </select>
                    </div>
                  </div>
                </Section>

                <Section title="Professional Summary">
                  <textarea
                    value={profile.professional_summary}
                    onChange={(e) => set("professional_summary", e.target.value)}
                    placeholder="Brief professional summary..."
                    rows={4}
                    className={inputCls + " min-h-[80px]"}
                  />
                </Section>
              </TabsContent>

              {/* Education */}
              <TabsContent value="education" className="space-y-5">
                <Section title="Education">
                  {profile.education.map((edu, i) => (
                    <div key={i} className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4 rounded-xl border border-border mb-3 relative">
                      <button onClick={() => removeEducation(i)} className="absolute top-2 right-2 text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                      <Field label="Degree" value={edu.degree} onChange={(v) => setEdu(i, "degree", v)} />
                      <Field label="Branch / Specialization" value={edu.branch} onChange={(v) => setEdu(i, "branch", v)} />
                      <Field label="University / College" value={edu.university} onChange={(v) => setEdu(i, "university", v)} />
                      <Field label="Year of Completion" value={edu.year_completion} onChange={(v) => setEdu(i, "year_completion", v)} />
                      <Field label="Percentage / CGPA" value={edu.percentage} onChange={(v) => setEdu(i, "percentage", v)} />
                    </div>
                  ))}
                  <button onClick={addEducation} className="rounded-xl border border-dashed border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                    + Add Education
                  </button>
                </Section>
              </TabsContent>

              {/* Experience */}
              <TabsContent value="experience" className="space-y-5">
                <Section title="Experience">
                  {profile.experience.map((exp, i) => (
                    <div key={i} className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4 rounded-xl border border-border mb-3 relative">
                      <button onClick={() => removeExperience(i)} className="absolute top-2 right-2 text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                      <Field label="Position" value={exp.position} onChange={(v) => setExp(i, "position", v)} />
                      <Field label="Organization" value={exp.organization} onChange={(v) => setExp(i, "organization", v)} />
                      <Field label="From" value={exp.from} onChange={(v) => setExp(i, "from", v)} placeholder="Jun 2019" />
                      <Field label="To" value={exp.to} onChange={(v) => setExp(i, "to", v)} placeholder="Present" />
                      <Field label="Location" value={exp.location} onChange={(v) => setExp(i, "location", v)} />
                    </div>
                  ))}
                  <button onClick={addExperience} className="rounded-xl border border-dashed border-input px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors">
                    + Add Experience
                  </button>
                </Section>
              </TabsContent>

              {/* Identity */}
              <TabsContent value="identity" className="space-y-5">
                <Section title="Identity Information">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="PAN Number" value={profile.pan_number} onChange={(v) => set("pan_number", v)} placeholder="ABCDE1234F" />
                    <Field label="Aadhaar Number" value={profile.aadhaar_number} onChange={(v) => set("aadhaar_number", v)} placeholder="XXXX-XXXX-XXXX" />
                  </div>
                </Section>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-3">
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    {children}
  </div>
);

const Field = ({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) => (
  <div>
    <label className="block text-[11px] font-medium text-muted-foreground mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder || label}
      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
    />
  </div>
);

export default EmployeeProfileDialog;
