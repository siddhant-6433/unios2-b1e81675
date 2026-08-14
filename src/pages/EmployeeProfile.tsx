// /employee/:id — one employee, one URL.
//
// Two audiences on the same route, and the difference is enforced by the database
// rather than by a flag here:
//
//   employee_directory_card()  a SECURITY DEFINER function whose RETURN SIGNATURE is
//                              the allow-list — name, designation, location, employee
//                              number, contact, photo. Every colleague may call it.
//   employee_profiles          RLS: HR, or your own row. Returns nothing to anyone
//                              else, so the page simply has no private record to show.
//
// So a counsellor opening this page gets the About tab and that is the whole of it,
// not because a `canView` boolean hid the rest, but because the private record never
// arrived. Deleting the check in this file would not leak anything.

import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { PageLoader } from "@/components/ui/page-loader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { MarkExitDialog } from "@/components/hr/MarkExitDialog";
import { AttendanceLog } from "@/components/hr/AttendanceLog";
import { useEmployeeProfile, EmployeeProfileTabs } from "@/components/hr/employeeProfileForm";
import {
  ArrowLeft, Mail, Phone, MapPin, IdCard, Camera, Save, LogOut, Lock,
} from "lucide-react";

interface DirectoryCard {
  employee_profile_id: string;
  employee_number: string | null;
  display_name: string | null;
  job_title: string | null;
  work_location: string | null;
  mobile_number: string | null;
  work_email: string | null;
  photo_url: string | null;
}

interface PrivateHeader {
  id: string;
  user_id: string | null;
  business_unit: string | null;
  hr_department: string | null;
  reports_to_name: string | null;
  date_of_exit: string | null;
  employment_status: string | null;
}

const EmployeeProfile = () => {
  const { id = "" } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { can } = usePermissions();

  const [card, setCard] = useState<DirectoryCard | null>(null);
  const [priv, setPriv] = useState<PrivateHeader | null>(null);
  const [probing, setProbing] = useState(true);
  const [exitOpen, setExitOpen] = useState(false);

  const tab = searchParams.get("tab") || "about";
  const setTab = (v: string) => setSearchParams((p) => { p.set("tab", v); return p; }, { replace: true });

  useEffect(() => {
    let cancelled = false;
    setProbing(true);
    (async () => {
      const [cardRes, privRes] = await Promise.all([
        supabase.rpc("employee_directory_card", { _q: null }),
        supabase
          .from("employee_profiles")
          .select("id, user_id, business_unit, hr_department, reports_to_name, date_of_exit, employment_status")
          .eq("id", id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const rows = (cardRes.data as DirectoryCard[] | null) ?? [];
      setCard(rows.find((r) => r.employee_profile_id === id) ?? null);
      setPriv((privRes.data as PrivateHeader | null) ?? null);
      setProbing(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  // The private record arriving IS the permission. Nothing else grants the tabs.
  const canSeePrivate = !!priv;
  const isSelf = !!priv?.user_id && priv.user_id === user?.id;
  const canEdit = can("hr", "employees_edit");

  const ctx = useEmployeeProfile({
    enabled: canSeePrivate,
    employeeProfileId: id,
    userName: card?.display_name || "Employee",
    readOnly: !canEdit,
  });

  const name = ctx.profile.display_name || card?.display_name || "Employee";
  const title = ctx.profile.job_title || card?.job_title || "";
  const photo = ctx.profile.photo_url || card?.photo_url || "";
  const email = ctx.profile.work_email || card?.work_email || "";
  const phone = ctx.profile.mobile_number || card?.mobile_number || "";
  const location = card?.work_location || "";
  const empNo = ctx.profile.employee_number || card?.employee_number || "";
  const exited = !!priv?.date_of_exit;

  const initials = name.split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  if (probing) return <PageLoader />;

  if (!card && !priv) {
    return (
      <div className="space-y-4 animate-fade-in">
        <BackLink />
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No employee record here, or you don't have access to it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <BackLink />

      {/* Header, after Keka's: cover strip, then the contact rail, then org placement. */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="relative h-28 bg-gradient-to-r from-primary/80 via-primary/50 to-primary/20">
          <div className="absolute -bottom-10 left-6 flex items-end gap-4">
            <div className="relative">
              {photo ? (
                <img src={photo} alt={name}
                  className="h-24 w-24 rounded-full border-4 border-card object-cover bg-white" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-card bg-primary/10 text-xl font-bold text-primary">
                  {initials}
                </div>
              )}
              {canEdit && canSeePrivate && (
                <label className="absolute bottom-1 right-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-foreground/80 text-background hover:bg-foreground"
                  title="Change photo — the background is replaced with plain white">
                  {ctx.uploadingPhoto ? <ButtonOrb state="working" /> : <Camera className="h-3.5 w-3.5" />}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    disabled={ctx.uploadingPhoto || !ctx.profile.id} onChange={ctx.handlePhoto} />
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="pl-32 pr-6 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{name}</h1>
            {exited && (
              <span className="rounded-md bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">OUT</span>
            )}
            {isSelf && (
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">You</span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{title || "No designation set"}</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-border px-6 py-3 text-sm">
          {email && <Meta icon={Mail}><a href={`mailto:${email}`} className="text-primary hover:underline">{email}</a></Meta>}
          {phone && <Meta icon={Phone}><a href={`tel:${phone}`} className="hover:underline">{phone}</a></Meta>}
          {location && <Meta icon={MapPin}>{location}</Meta>}
          {empNo && <Meta icon={IdCard}><span className="font-mono text-xs">{empNo}</span></Meta>}
          {canEdit && canSeePrivate && (
            <div className="ml-auto flex items-center gap-2">
              {ctx.profile.id && (
                <button onClick={() => setExitOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-input px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive">
                  <LogOut className="h-3.5 w-3.5" /> Mark exit
                </button>
              )}
              <button onClick={ctx.handleSave} disabled={ctx.saving}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                {ctx.saving ? <ButtonOrb state="working" onFilled /> : <Save className="h-3.5 w-3.5" />}
                {ctx.saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>

        {canSeePrivate && (priv?.business_unit || priv?.hr_department || priv?.reports_to_name) && (
          <div className="flex flex-wrap gap-x-12 gap-y-3 border-t border-border px-6 py-3">
            <Org label="Business unit" value={priv.business_unit} />
            <Org label="Department" value={priv.hr_department} />
            <Org label="Reporting manager" value={priv.reports_to_name} />
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="h-auto w-full justify-start gap-0 rounded-none border-b border-border bg-transparent p-0">
          {[["about", "About"],
            ...(canSeePrivate ? [["profile", "Profile"], ["time", "Time"]] as const : [])
          ].map(([v, label]) => (
            <TabsTrigger key={v} value={v}
              className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="about" className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AboutCard label="Employee ID" value={empNo} mono />
            <AboutCard label="Designation" value={title} />
            <AboutCard label="Location" value={location} />
            <AboutCard label="Contact" value={phone} />
            <AboutCard label="Work email" value={email} />
          </div>
          {!canSeePrivate && (
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              This is the directory card. Personal details, pay and attendance are visible
              only to HR and to {name.split(" ")[0]}.
            </p>
          )}
        </TabsContent>

        {canSeePrivate && (
          <TabsContent value="profile" className="mt-5">
            {ctx.loading ? <PageLoader /> : (
              <fieldset disabled={!canEdit} className="w-full disabled:opacity-100">
                <EmployeeProfileTabs ctx={ctx} />
              </fieldset>
            )}
          </TabsContent>
        )}

        {canSeePrivate && (
          <TabsContent value="time" className="mt-5">
            {priv?.user_id ? (
              <AttendanceLog userId={priv.user_id} employeeProfileId={id} canRegularise={isSelf} />
            ) : (
              <div className="rounded-xl border border-border p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  No login is linked to this employee, so nothing can be punched against them yet.
                </p>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      <MarkExitDialog
        open={exitOpen}
        onOpenChange={setExitOpen}
        employee={ctx.profile.id ? { id: ctx.profile.id, name, employeeNumber: ctx.profile.employee_number } : null}
        onSuccess={() => setExitOpen(false)}
      />
    </div>
  );
};

const BackLink = () => (
  <Link to="/hr-directory" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
    <ArrowLeft className="h-4 w-4" /> Directory
  </Link>
);

const Meta = ({ icon: Icon, children }: { icon: typeof Mail; children: React.ReactNode }) => (
  <span className="flex items-center gap-2 text-foreground">
    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
    {children}
  </span>
);

const Org = ({ label, value }: { label: string; value?: string | null }) => (
  <div>
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-sm text-foreground">{value || "—"}</p>
  </div>
);

const AboutCard = ({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={`mt-1 text-sm text-foreground ${mono ? "font-mono" : ""}`}>{value || "—"}</p>
  </div>
);

export default EmployeeProfile;
