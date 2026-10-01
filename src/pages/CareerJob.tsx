import { type FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  FileText,
  GraduationCap,
  IndianRupee,
  MapPin,
  Send,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OrbLoader, ButtonOrb } from "@/components/ui/thinking-orb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/unios-logo.png";
import {
  employmentTypeLabel,
  experienceLabel,
  formatCloses,
  formatPosted,
  isLive,
  salaryLabel,
  type PublicJob,
} from "@/lib/careers";

const JOB_COLUMNS =
  "id, slug, title, description, employment_type, experience_min_years, experience_max_years, salary_min, salary_max, salary_visible, location, openings_count, department_id, campus_id, posted_at, closes_at, status";

/** Minimal structural view of the PostgREST builder — see Careers.tsx. */
type DbResult = { data: unknown; error: { message: string } | null };
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  maybeSingle: () => Promise<DbResult>;
};
type LooseDb = { from: (table: string) => LooseQuery };

function BrandBar() {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4 sm:px-6">
        <Link to="/careers" className="flex items-center gap-2">
          <img src={logo} alt="UniOs" className="h-9 w-auto object-contain" />
        </Link>
        <div className="ml-auto flex items-center gap-2 text-right">
          <GraduationCap className="hidden h-5 w-5 text-primary sm:block" />
          <div>
            <p className="text-sm font-semibold leading-tight text-foreground">Careers</p>
            <p className="text-xs leading-tight text-muted-foreground">NIMT Group of Institutions</p>
          </div>
        </div>
      </div>
    </header>
  );
}

function MetaItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function ClosedState() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <Briefcase className="h-6 w-6 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-bold text-foreground">No longer accepting applications</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This role is closed or has been removed. Browse our other current openings instead.
      </p>
      <Button asChild className="mt-6">
        <Link to="/careers">
          <ArrowLeft className="h-4 w-4" />
          Back to all openings
        </Link>
      </Button>
    </div>
  );
}

export default function CareerJob() {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();

  const [job, setJob] = useState<PublicJob | null>(null);
  const [departmentName, setDepartmentName] = useState<string | null>(null);
  const [campusName, setCampusName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [experienceYears, setExperienceYears] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [resume, setResume] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ already: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!slug) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setLoading(true);
      const db = supabase as unknown as LooseDb;
      const { data, error } = await db
        .from("job_openings")
        .select(JOB_COLUMNS)
        .eq("slug", slug)
        .maybeSingle();

      if (cancelled) return;
      if (error || !data || !isLive(data as PublicJob)) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const opening = data as PublicJob;
      setJob(opening);

      const [deptRes, campusRes] = await Promise.all([
        opening.department_id
          ? db.from("departments").select("name").eq("id", opening.department_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        opening.campus_id
          ? db.from("campuses").select("name").eq("id", opening.campus_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (cancelled) return;
      setDepartmentName((deptRes?.data as { name?: string } | null)?.name ?? null);
      setCampusName((campusRes?.data as { name?: string } | null)?.name ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!job) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName || !trimmedEmail || !trimmedPhone) {
      setFormError("Name, email and phone are required.");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const formData = new FormData();
      formData.append("opening_slug", job.slug);
      formData.append("name", trimmedName);
      formData.append("email", trimmedEmail);
      formData.append("phone", trimmedPhone);
      if (experienceYears.trim()) formData.append("experience_years", experienceYears.trim());
      if (coverNote.trim()) formData.append("cover_note", coverNote.trim());
      if (resume) formData.append("resume", resume);

      const { data, error } = await supabase.functions.invoke("apply-job", { body: formData });

      if (error) {
        // The SDK consumes the response body when building FunctionsHttpError,
        // so read the server's JSON from the attached Response for the real reason.
        let message = error.message || "Could not submit your application.";
        const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        if (context && typeof context.json === "function") {
          try {
            const body = await context.json();
            if (body?.error) message = body.error;
          } catch {
            /* keep the generic message */
          }
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);

      const already = Boolean(data?.already_applied);
      setSubmitted({ already });
      toast({
        title: already ? "You've already applied" : "Application received",
        description: already
          ? "We already have an application from this email for this role."
          : "Thanks — our hiring team will be in touch.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not submit your application.";
      setFormError(message);
      toast({ title: "Submission failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const team = departmentName || campusName || null;
  const place = job?.location || campusName || null;
  const description = (job?.description ?? "").trim();

  return (
    <div className="min-h-screen bg-background">
      <BrandBar />

      {loading ? (
        <div className="mx-auto flex max-w-4xl items-center justify-center px-4 py-24">
          <OrbLoader state="working" label="Loading role…" />
        </div>
      ) : notFound || !job ? (
        <ClosedState />
      ) : submitted ? (
        <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
                <CheckCircle2 className="h-7 w-7 text-success" />
              </div>
              <h1 className="text-xl font-bold text-foreground">
                {submitted.already ? "You've already applied" : "Application received"}
              </h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {submitted.already
                  ? `We already have an application from you for ${job.title}. Our hiring team will review it and get in touch if there's a fit.`
                  : `Thanks for applying for ${job.title}. Our hiring team will review your application and contact you if there's a match.`}
              </p>
              <Button asChild variant="outline" className="mt-6">
                <Link to="/careers">
                  <ArrowLeft className="h-4 w-4" />
                  Browse more openings
                </Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      ) : (
        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
          <Link
            to="/careers"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            All openings
          </Link>

          <div className="mb-8 space-y-4">
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{job.title}</h1>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="font-medium">
                {employmentTypeLabel(job.employment_type) || "Role"}
              </Badge>
              <Badge variant="outline" className="font-medium">
                {experienceLabel(job.experience_min_years, job.experience_max_years)}
              </Badge>
              {Number(job.openings_count) > 1 && (
                <Badge variant="secondary" className="font-medium">
                  <Users className="mr-1 h-3 w-3" />
                  {Number(job.openings_count)} openings
                </Badge>
              )}
            </div>
            <div className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
              {team && <MetaItem icon={Building2} label="Department" value={team} />}
              {place && <MetaItem icon={MapPin} label="Location" value={place} />}
              <MetaItem
                icon={Briefcase}
                label="Type"
                value={employmentTypeLabel(job.employment_type) || "—"}
              />
              <MetaItem
                icon={IndianRupee}
                label="Compensation"
                value={salaryLabel(job.salary_min, job.salary_max, job.salary_visible)}
              />
              <MetaItem
                icon={CalendarClock}
                label="Timeline"
                value={[formatPosted(job.posted_at), formatCloses(job.closes_at)]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              />
            </div>
          </div>

          {description && (
            <Card className="mb-8">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-4 w-4 text-primary" />
                  About this role
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {description}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Apply for this role</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="name" className="text-sm font-medium text-foreground">
                      Full name <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="phone" className="text-sm font-medium text-foreground">
                      Phone <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      required
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="email" className="text-sm font-medium text-foreground">
                      Email <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="experience" className="text-sm font-medium text-foreground">
                      Years of experience
                    </label>
                    <Input
                      id="experience"
                      type="number"
                      min={0}
                      step="0.5"
                      value={experienceYears}
                      onChange={(e) => setExperienceYears(e.target.value)}
                      placeholder="e.g. 3"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="resume" className="text-sm font-medium text-foreground">
                    Resume
                  </label>
                  <Input
                    id="resume"
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf"
                    onChange={(e) => setResume(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">PDF or Word document, up to 5 MB.</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="cover" className="text-sm font-medium text-foreground">
                    Cover note
                  </label>
                  <Textarea
                    id="cover"
                    value={coverNote}
                    onChange={(e) => setCoverNote(e.target.value)}
                    placeholder="Tell us briefly why you're a good fit (optional)"
                    rows={4}
                  />
                </div>

                {formError && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                  {submitting ? (
                    <ButtonOrb state="working" onFilled />
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Submit application
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  By applying you agree to be contacted about this role.
                </p>
              </form>
            </CardContent>
          </Card>
        </main>
      )}
    </div>
  );
}
