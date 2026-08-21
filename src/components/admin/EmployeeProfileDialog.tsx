// Employee profile editor — the one place an employee record is edited.
//
// Opened from the admin Team tab (by auth user) and from the HR directory (by
// employee_profiles.id). Those are different keys on purpose: employees imported
// in bulk have no auth user at all, so `user_id` cannot be the handle. Anything
// that syncs back to `profiles` is skipped for those rows.

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionContext";
import { useOrgUnits } from "@/hooks/useOrgUnits";
import { downscaleImage } from "@/lib/downscaleImage";
import { X, User, Briefcase, GraduationCap, Save, FileText, Landmark, Camera, ScrollText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LettersPanel } from "@/components/hr/LettersPanel";
import { ButtonOrb, OrbLoader } from "@/components/ui/thinking-orb";
import { BankDetailsFields, type BankVerification } from "@/components/bank/BankDetailsFields";
import { isValidIfsc } from "@/lib/bankDetails";
import { PROVISIONABLE_ROLES, provisionEmployeeLogin, lookupExistingUser, linkEmployeeLogin, getUserRoles, addUserRole, removeUserRole, type ExistingUserMatch } from "@/lib/employeeLogin";
import { useAuth } from "@/contexts/AuthContext";

type EmployeeProfileRow = Database["public"]["Tables"]["employee_profiles"]["Row"];

interface EmployeeProfileDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Auth user id. Absent for employees imported without a login. */
  userId?: string;
  /** employee_profiles.id. Preferred when known; required for login-less rows. */
  employeeProfileId?: string;
  userName: string;
  readOnly?: boolean;
}

interface EmployeeProfile {
  id?: string;
  employee_number: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  salutation: string;
  display_name: string;
  gender: string;
  date_of_birth: string;
  marital_status: string;
  blood_group: string;
  nationality: string;
  physically_handicapped: boolean;
  photo_url: string;
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
  campus_id: string;
  institution_id: string;
  department_id: string;
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

interface BankDetails {
  account_holder_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
  branch: string;
  account_type: string;
}

const emptyProfile: EmployeeProfile = {
  employee_number: "", first_name: "", middle_name: "", last_name: "", salutation: "", display_name: "",
  gender: "", date_of_birth: "", marital_status: "", blood_group: "", nationality: "India",
  physically_handicapped: false, photo_url: "", work_email: "", personal_email: "", mobile_number: "",
  work_number: "", residence_number: "",
  current_address: {}, permanent_address: {},
  date_of_joining: "", job_title: "", job_title_secondary: "",
  campus_id: "", institution_id: "", department_id: "",
  worker_type: "Permanent",
  time_type: "Full Time", notice_period_days: 90, employment_status: "Working",
  pan_number: "", aadhaar_number: "", education: [], experience: [], professional_summary: "",
};

const emptyBank: BankDetails = {
  account_holder_name: "", account_number: "", ifsc: "", bank_name: "", branch: "", account_type: "Savings",
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

const EmployeeProfileDialog = ({
  open, onClose, onSuccess, userId, employeeProfileId, userName, readOnly = false,
}: EmployeeProfileDialogProps) => {
  const [profile, setProfile] = useState<EmployeeProfile>(emptyProfile);
  const [bank, setBank] = useState<BankDetails>(emptyBank);
  const [bankVerified, setBankVerified] = useState<BankVerification | null>(null);
  const [bankLoaded, setBankLoaded] = useState(false);
  const [linkedUserId, setLinkedUserId] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionRole, setProvisionRole] = useState("");
  // Set when a login lookup finds an existing account for this email/phone —
  // offer to map instead of creating a duplicate.
  const [existingMatch, setExistingMatch] = useState<ExistingUserMatch | null>(null);
  // Roles held by the linked login (additive). Editable by super_admin only,
  // since user_roles writes are super_admin-only by RLS.
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [rolesBusy, setRolesBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoStage, setPhotoStage] = useState<"processing" | "uploading" | null>(null);
  const [isNew, setIsNew] = useState(true);
  const { toast } = useToast();
  const { can } = usePermissions();
  const { realRole } = useAuth();
  const org = useOrgUnits();

  const canEditBank = can("hr", "bank_edit");
  const canManageRoles = realRole === "super_admin";
  const editable = !readOnly;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setBankLoaded(false);
    setBank(emptyBank);
    setExistingMatch(null);

    (async () => {
      // Look the employee row up by whichever key the caller had.
      const empQuery = employeeProfileId
        ? supabase.from("employee_profiles").select("*").eq("id", employeeProfileId).maybeSingle()
        : supabase.from("employee_profiles").select("*").eq("user_id", userId!).maybeSingle();

      const [empRes, profileRes] = await Promise.all([
        empQuery,
        userId
          ? supabase.from("profiles").select("display_name, phone, salutation").eq("user_id", userId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (empRes.error) {
        toast({ title: "Error", description: empRes.error.message, variant: "destructive" });
      }

      const empData = empRes.data as EmployeeProfileRow | null;
      const baseProfile = profileRes.data as { display_name?: string; phone?: string; salutation?: string } | null;
      const resolvedUserId = (empData?.user_id as string | null) ?? userId ?? null;
      setLinkedUserId(resolvedUserId);

      if (empData) {
        const str = (k: string) => (empData[k] as string | null) || "";
        setProfile({
          id: empData.id,
          employee_number: str("employee_number"),
          first_name: str("first_name"),
          middle_name: str("middle_name"),
          last_name: str("last_name"),
          salutation: baseProfile?.salutation || "",
          display_name: str("display_name") || baseProfile?.display_name || userName,
          gender: str("gender"),
          date_of_birth: str("date_of_birth"),
          marital_status: str("marital_status"),
          blood_group: str("blood_group"),
          nationality: str("nationality") || "India",
          physically_handicapped: Boolean(empData.physically_handicapped),
          photo_url: str("photo_url"),
          work_email: str("work_email"),
          personal_email: str("personal_email"),
          // Prefer employee_profiles.mobile_number, fall back to profiles.phone (OTP login number)
          mobile_number: str("mobile_number") || baseProfile?.phone || "",
          work_number: str("work_number"),
          residence_number: str("residence_number"),
          current_address: (empData.current_address as never) || {},
          permanent_address: (empData.permanent_address as never) || {},
          date_of_joining: str("date_of_joining"),
          job_title: str("job_title"),
          job_title_secondary: str("job_title_secondary"),
          campus_id: str("campus_id"),
          institution_id: str("institution_id"),
          department_id: str("department_id"),
          worker_type: str("worker_type") || "Permanent",
          time_type: str("time_type") || "Full Time",
          notice_period_days: (empData.notice_period_days as number | null) ?? 90,
          employment_status: str("employment_status") || "Working",
          pan_number: str("pan_number"),
          aadhaar_number: str("aadhaar_number"),
          education: (empData.education as never) || [],
          experience: (empData.experience as never) || [],
          professional_summary: str("professional_summary"),
        });
        setIsNew(false);
      } else {
        // No employee_profiles row yet — pre-fill from profiles.
        setProfile({
          ...emptyProfile,
          salutation: baseProfile?.salutation || "",
          display_name: baseProfile?.display_name || userName,
          first_name: (baseProfile?.display_name || userName).split(" ")[0] || "",
          last_name: (baseProfile?.display_name || userName).split(" ").slice(1).join(" ") || "",
          mobile_number: baseProfile?.phone || "",
        });
        setIsNew(true);
      }
      setLoading(false);
    })();
  }, [open, userId, employeeProfileId, userName, toast]);

  // Bank details are a separate table behind hr:bank_edit — fetch only when the
  // caller can actually see them, so a principal's dialog makes no doomed query.
  useEffect(() => {
    if (!open || !canEditBank || !profile.id || bankLoaded) return;
    (async () => {
      const { data } = await supabase
        .from("employee_bank_details")
        .select("account_holder_name, account_number, ifsc, bank_name, branch, account_type, bank_verified_name, bank_verified_at, bank_verification_ref, bank_verification_status")
        .eq("employee_profile_id", profile.id)
        .maybeSingle();
      if (data) {
        const d = data as any;
        setBank({ ...emptyBank, account_holder_name: d.account_holder_name || "", account_number: d.account_number || "", ifsc: d.ifsc || "", bank_name: d.bank_name || "", branch: d.branch || "", account_type: d.account_type || "Savings" });
        setBankVerified({ status: d.bank_verification_status || "unverified", name: d.bank_verified_name || null, ref: d.bank_verification_ref || null, at: d.bank_verified_at || null });
      }
      setBankLoaded(true);
    })();
  }, [open, canEditBank, profile.id, bankLoaded]);

  if (!open) return null;

  const set = <K extends keyof EmployeeProfile>(field: K, value: EmployeeProfile[K]) =>
    setProfile((p) => ({ ...p, [field]: value }));
  const setAddr = (type: "current_address" | "permanent_address", field: string, value: string) =>
    setProfile((p) => ({ ...p, [type]: { ...p[type], [field]: value } }));

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Not an image", description: "Choose a JPEG, PNG or WebP file.", variant: "destructive" });
      return;
    }
    if (!profile.id) {
      toast({ title: "Save first", description: "Save the profile once before adding a photo.", variant: "destructive" });
      return;
    }

    setUploadingPhoto(true);
    try {
      // Same white-background treatment student and applicant photos get, via
      // the shared process-passport-photo function. If Gemini is down or out of
      // quota we still store the original — a photo beats no photo, and the
      // toast says which one landed.
      setPhotoStage("processing");
      const original = await fileToDataUrl(file);
      let processed = original;
      let bgRemoved = false;
      try {
        const { data: fn, error: fnErr } = await supabase.functions.invoke("process-passport-photo", {
          body: { image: original },
        });
        if (!fnErr && fn?.processedImage) {
          processed = fn.processedImage as string;
          bgRemoved = true;
        }
      } catch {
        // fall through to the original
      }

      setPhotoStage("uploading");
      // Shrunk client-side: these render at 40–96px and Supabase's image
      // transformation quota is metered.
      const blob = await downscaleImage(await dataUrlToBlob(processed), { maxEdge: 800 });
      const path = `${profile.id}/photo.jpg`;
      const { error: upErr } = await supabase.storage
        .from("employee-photos")
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("employee-photos").getPublicUrl(path);
      // Cache-bust: the path is stable across re-uploads.
      const url = `${pub.publicUrl}?v=${Date.now()}`;

      const { data, error } = await supabase
        .from("employee_profiles")
        .update({ photo_url: url } as never)
        .eq("id", profile.id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("You don't have permission to edit this employee.");

      set("photo_url", url);
      toast({
        title: "Photo updated",
        description: bgRemoved
          ? "Background replaced with plain white."
          : "Saved as-is — background removal was unavailable.",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Photo upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploadingPhoto(false);
      setPhotoStage(null);
    }
  };

  // Create a login for an already-saved employee who has none. Mirrors the
  // verify-queue path (invite-user → back-fill user_id) via the shared helper.
  const handleGenerateLogin = async () => {
    if (isNew || !profile.id) {
      toast({ title: "Save the profile first", description: "Save this employee once before creating a login.", variant: "destructive" });
      return;
    }
    if (!profile.work_email.trim()) {
      toast({ title: "Add a work email", description: "A login needs a work email. Add one and Save, then try again.", variant: "destructive" });
      return;
    }
    if (!provisionRole) {
      toast({ title: "Pick a role", description: "Choose the role this login should have.", variant: "destructive" });
      return;
    }
    setProvisioning(true);
    try {
      // Detect a pre-existing account for this email/phone before creating a
      // duplicate — if found, offer to map instead of inviting.
      const match = await lookupExistingUser({
        email: profile.work_email.trim(),
        phone: profile.mobile_number || undefined,
        role: provisionRole,
      });
      if (match) {
        setExistingMatch(match);
        return;
      }
      const newUserId = await provisionEmployeeLogin({
        employeeProfileId: profile.id,
        email: profile.work_email.trim(),
        role: provisionRole,
        displayName: profile.display_name || undefined,
        phone: profile.mobile_number || undefined,
        campus: org.campuses.find((c) => c.id === profile.campus_id)?.name || undefined,
      });
      setLinkedUserId(newUserId);
      toast({ title: "Login created", description: "An activation invite was sent to the work email." });
      onSuccess?.();
    } catch (err) {
      toast({ title: "Could not create login", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setProvisioning(false);
    }
  };

  // Map the employee to the already-existing account the lookup surfaced.
  const handleMapExisting = async () => {
    if (!profile.id || !existingMatch) return;
    setProvisioning(true);
    try {
      await linkEmployeeLogin(profile.id, existingMatch.user_id);
      setLinkedUserId(existingMatch.user_id);
      setExistingMatch(null);
      toast({ title: "Employee linked", description: "This employee is now mapped to the existing account." });
      onSuccess?.();
    } catch (err) {
      toast({ title: "Could not link account", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setProvisioning(false);
    }
  };

  // Load the linked login's roles (additive) when a user is linked.
  useEffect(() => {
    if (!open || !linkedUserId || !canManageRoles) { setUserRoles([]); return; }
    getUserRoles(linkedUserId).then(setUserRoles).catch(() => setUserRoles([]));
  }, [open, linkedUserId, canManageRoles]);

  const handleAddRole = async (role: string) => {
    if (!linkedUserId || !role) return;
    setRolesBusy(true);
    try {
      await addUserRole(linkedUserId, role);
      setUserRoles(await getUserRoles(linkedUserId));
      toast({ title: "Role added" });
    } catch (err) {
      toast({ title: "Could not add role", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setRolesBusy(false);
    }
  };

  const handleRemoveRole = async (role: string) => {
    if (!linkedUserId) return;
    setRolesBusy(true);
    try {
      await removeUserRole(linkedUserId, role);
      setUserRoles(await getUserRoles(linkedUserId));
      toast({ title: "Role removed" });
    } catch (err) {
      toast({ title: "Could not remove role", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setRolesBusy(false);
    }
  };

  const handleSave = async () => {
    if (canEditBank && bank.account_number.trim() && !isValidIfsc(bank.ifsc)) {
      toast({ title: "Check the IFSC", description: "An account number needs a valid IFSC (e.g. HDFC0001234).", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        user_id: linkedUserId,
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
        campus_id: profile.campus_id || null,
        institution_id: profile.institution_id || null,
        department_id: profile.department_id || null,
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

      let profileId = profile.id;
      if (isNew) {
        const { data, error } = await supabase
          .from("employee_profiles").insert(payload as never).select("id").single();
        if (error) throw error;
        profileId = data.id;
        setProfile((p) => ({ ...p, id: data.id }));
        setIsNew(false);
      } else {
        // .select() so an RLS-filtered update reports 0 rows instead of a
        // silent "success" that changed nothing.
        const { data, error } = await supabase
          .from("employee_profiles").update(payload as never).eq("id", profile.id!).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("You don't have permission to edit this employee.");
      }

      if (canEditBank && profileId && Object.values(bank).some((v) => v.trim())) {
        const { error } = await supabase
          .from("employee_bank_details")
          .upsert({
            employee_profile_id: profileId,
            account_holder_name: bank.account_holder_name.trim() || profile.display_name || null,
            account_number: bank.account_number.trim() || null,
            ifsc: bank.ifsc.trim().toUpperCase() || null,
            bank_name: bank.bank_name.trim() || null,
            branch: bank.branch.trim() || null,
            account_type: bank.account_type || null,
            bank_verified_name: bankVerified?.name ?? null,
            bank_verified_at: bankVerified?.at ?? null,
            bank_verification_ref: bankVerified?.ref ?? null,
            bank_verification_status: bankVerified?.status ?? "unverified",
          } as never, { onConflict: "employee_profile_id" });
        if (error) throw new Error(`Bank details: ${error.message}`);
      }

      // Sync name/email/phone back to `profiles` — only meaningful when this
      // employee actually has a login. The RPC's error used to be discarded,
      // which hid a hard 'Forbidden' for every non-super_admin.
      if (linkedUserId) {
        const normalizedPhone = profile.mobile_number
          ? (profile.mobile_number.startsWith("+") ? profile.mobile_number : `+${profile.mobile_number.replace(/\D/g, "")}`)
          : null;
        const { error } = await supabase.rpc("admin_update_profile" as never, {
          p_user_id: linkedUserId,
          p_display_name: profile.display_name || null,
          p_email: profile.work_email || null,
          p_phone: normalizedPhone,
          p_salutation: profile.salutation ?? "",
        } as never);
        if (error) throw new Error(`Employee saved, but the login profile could not be updated: ${error.message}`);
      }

      toast({ title: "Saved", description: "Employee profile updated successfully." });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
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
  const initials = (profile.display_name || userName || "U")
    .split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const tabCls = "rounded-lg text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      {/* Radix portals this to <body>. The hand-rolled `fixed inset-0` version it
          replaced was positioned by the nearest transformed ancestor instead of the
          viewport — the HR directory page carries `animate-fade-in`, whose keyframes
          set a transform — so the modal opened near the bottom of a long list. */}
      <DialogContent className="max-w-3xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden rounded-2xl [&>button]:hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            {profile.photo_url ? (
              <img
                src={profile.photo_url}
                alt={profile.display_name || userName}
                className="h-14 w-14 rounded-xl object-cover border border-border bg-white"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                {initials}
              </div>
            )}
            <div>
              <DialogTitle className="text-lg font-semibold text-foreground">Employee Profile</DialogTitle>
              <p className="text-xs text-muted-foreground">
                {profile.display_name || userName}
                {!linkedUserId && <span className="ml-2 text-muted-foreground/70">· no login linked</span>}
              </p>
              {editable && !isNew && !linkedUserId && can("hr", "employees_edit") && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <select
                    value={provisionRole}
                    onChange={(e) => setProvisionRole(e.target.value)}
                    disabled={provisioning}
                    className="rounded-lg border border-input bg-background px-2 py-1 text-[11px]"
                  >
                    <option value="">Login role…</option>
                    {PROVISIONABLE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button
                    onClick={handleGenerateLogin}
                    disabled={provisioning}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {provisioning ? <ButtonOrb state="working" /> : <User className="h-3.5 w-3.5" />}
                    {provisioning ? "Checking…" : "Generate login"}
                  </button>
                </div>
              )}
              {editable && !isNew && !linkedUserId && existingMatch && (
                <div className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
                  <p>
                    A user already exists for this email/phone:{" "}
                    <span className="font-medium">{existingMatch.display_name || existingMatch.email || existingMatch.phone}</span>
                    {existingMatch.role ? ` · ${existingMatch.role}` : ""}.
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      onClick={handleMapExisting}
                      disabled={provisioning}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {provisioning ? <ButtonOrb state="working" onFilled /> : null}
                      Map to this employee
                    </button>
                    <button onClick={() => setExistingMatch(null)} disabled={provisioning} className="text-amber-800 hover:underline">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {editable && linkedUserId && canManageRoles && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Roles:</span>
                  {userRoles.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                      {PROVISIONABLE_ROLES.find((x) => x.value === r)?.label || r.replace(/_/g, " ")}
                      <button onClick={() => handleRemoveRole(r)} disabled={rolesBusy} title="Remove role" className="hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) handleAddRole(e.target.value); }}
                    disabled={rolesBusy}
                    className="rounded-lg border border-input bg-background px-2 py-0.5 text-[11px]"
                  >
                    <option value="">+ Add role…</option>
                    {PROVISIONABLE_ROLES.filter((r) => !userRoles.includes(r.value)).map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  {rolesBusy && <ButtonOrb state="working" />}
                </div>
              )}
              {editable && (
                <label
                  className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    uploadingPhoto || !profile.id
                      ? "text-muted-foreground/60 cursor-not-allowed"
                      : "text-foreground hover:bg-muted cursor-pointer"
                  }`}
                  title={profile.id ? undefined : "Save the profile once before adding a photo"}
                >
                  {uploadingPhoto ? <ButtonOrb state="working" /> : <Camera className="h-3.5 w-3.5" />}
                  {photoStage === "processing"
                    ? "Removing background…"
                    : photoStage === "uploading"
                      ? "Uploading…"
                      : profile.photo_url ? "Change photo" : "Add photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    disabled={uploadingPhoto || !profile.id}
                    onChange={handlePhoto}
                  />
                </label>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editable && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? <ButtonOrb state="working" onFilled /> : <Save className="h-4 w-4" />}
                {saving ? "Saving…" : "Save"}
              </button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <OrbLoader state="working" />
          </div>
        ) : (
          // The <div> is the scroll container (flex-1 min-h-0 under the pinned
          // header). A <fieldset> can't reliably constrain flex children in
          // Chrome, so it sits INSIDE and only carries the readOnly `disabled`.
          <div className="overflow-y-auto flex-1 min-h-0 p-6">
           <fieldset disabled={!editable} className="min-w-0 border-0 m-0 p-0 disabled:opacity-100">
            <Tabs defaultValue="personal" className="w-full">
              <TabsList className="bg-muted/50 border border-border rounded-xl p-1 h-auto flex-wrap mb-6">
                <TabsTrigger value="personal" className={tabCls}><User className="h-3.5 w-3.5 mr-1" />Personal</TabsTrigger>
                <TabsTrigger value="job" className={tabCls}><Briefcase className="h-3.5 w-3.5 mr-1" />Job</TabsTrigger>
                <TabsTrigger value="education" className={tabCls}><GraduationCap className="h-3.5 w-3.5 mr-1" />Education</TabsTrigger>
                <TabsTrigger value="experience" className={tabCls}><Briefcase className="h-3.5 w-3.5 mr-1" />Experience</TabsTrigger>
                <TabsTrigger value="identity" className={tabCls}><FileText className="h-3.5 w-3.5 mr-1" />Identity</TabsTrigger>
                {canEditBank && (
                  <TabsTrigger value="bank" className={tabCls}><Landmark className="h-3.5 w-3.5 mr-1" />Bank</TabsTrigger>
                )}
                {profile.id && editable && (
                  <TabsTrigger value="letters" className={tabCls}><ScrollText className="h-3.5 w-3.5 mr-1" />Letters</TabsTrigger>
                )}
              </TabsList>

              {/* Personal */}
              <TabsContent value="personal" className="space-y-5">
                <Section title="Primary Details">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <Field label="Employee Number" value={profile.employee_number} onChange={(v) => set("employee_number", v)} />
                    <Field label="First Name" value={profile.first_name} onChange={(v) => set("first_name", v)} />
                    <Field label="Middle Name" value={profile.middle_name} onChange={(v) => set("middle_name", v)} />
                    <Field label="Last Name" value={profile.last_name} onChange={(v) => set("last_name", v)} />
                    <div>
                      <label className={labelCls}>Salutation</label>
                      <select value={profile.salutation} onChange={(e) => set("salutation", e.target.value)} className={inputCls}>
                        <option value="">None</option>
                        <option value="Mr">Mr</option>
                        <option value="Mrs">Mrs</option>
                        <option value="Ms">Ms</option>
                        <option value="Dr">Dr</option>
                        <option value="Prof">Prof</option>
                      </select>
                    </div>
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
                <Section title="Posting">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelCls}>Campus</label>
                      <select
                        value={profile.campus_id}
                        onChange={(e) => setProfile((p) => ({ ...p, campus_id: e.target.value, institution_id: "", department_id: "" }))}
                        className={inputCls}
                      >
                        <option value="">Select</option>
                        {org.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Institution</label>
                      <select
                        value={profile.institution_id}
                        onChange={(e) => setProfile((p) => ({ ...p, institution_id: e.target.value, department_id: "" }))}
                        className={inputCls}
                        disabled={!profile.campus_id}
                      >
                        <option value="">Select</option>
                        {org.institutionsFor(profile.campus_id).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Department</label>
                      <select
                        value={profile.department_id}
                        onChange={(e) => set("department_id", e.target.value)}
                        className={inputCls}
                        disabled={!profile.institution_id}
                      >
                        <option value="">Select</option>
                        {org.departmentsFor(profile.institution_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                  </div>
                </Section>

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

              {/* Bank */}
              {canEditBank && (
                <TabsContent value="bank" className="space-y-5">
                  <Section title="Salary Account">
                    <BankDetailsFields
                      value={{
                        holderName: bank.account_holder_name, accountNumber: bank.account_number,
                        ifsc: bank.ifsc, bankName: bank.bank_name, branch: bank.branch,
                      }}
                      onChange={v => setBank(b => ({
                        ...b, account_holder_name: v.holderName, account_number: v.accountNumber,
                        ifsc: v.ifsc, bank_name: v.bankName, branch: v.branch || "",
                      }))}
                      showUpi={false}
                      showBranch
                      verification={bankVerified ? { status: bankVerified.status, name: bankVerified.name } : undefined}
                      onVerification={setBankVerified}
                    />
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <label className={labelCls}>Account Type</label>
                        <select value={bank.account_type} onChange={(e) => setBank((b) => ({ ...b, account_type: e.target.value }))} className={inputCls}>
                          <option value="Savings">Savings</option>
                          <option value="Current">Current</option>
                          <option value="Salary">Salary</option>
                        </select>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Every change to these fields is recorded with your name and the time.
                    </p>
                  </Section>
                </TabsContent>
              )}
              {profile.id && editable && (
                <TabsContent value="letters" className="space-y-5">
                  <Section title="Employment letters">
                    <LettersPanel employeeProfileId={profile.id} />
                  </Section>
                </TabsContent>
              )}
            </Tabs>
           </fieldset>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
