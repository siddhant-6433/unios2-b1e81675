import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Briefcase,
  Building2,
  CalendarClock,
  GraduationCap,
  IndianRupee,
  MapPin,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
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

type Lookup = { id: string; name: string };

/**
 * Minimal structural view of the PostgREST builder. The generated Database
 * types don't model every chain we need here, so we describe just the surface
 * the careers page uses — no `any`, no `never` casts, and awaiting a chain
 * still resolves to `{ data, error }`.
 */
type DbResult = { data: unknown; error: { message: string } | null };
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery;
  eq: (column: string, value: unknown) => LooseQuery;
  or: (filter: string) => LooseQuery;
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery;
};
type LooseDb = { from: (table: string) => LooseQuery };

function BrandBar() {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
        <img src={logo} alt="UniOs" className="h-9 w-auto object-contain" />
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

function JobCard({
  job,
  departmentName,
  campusName,
}: {
  job: PublicJob;
  departmentName?: string;
  campusName?: string;
}) {
  const openings = Number(job.openings_count) || 0;
  const place = job.location || campusName || "—";
  const posted = formatPosted(job.posted_at);
  const closes = formatCloses(job.closes_at);
  const team = departmentName || campusName;

  return (
    <Card className="flex h-full flex-col transition-shadow hover:shadow-md">
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold leading-snug text-foreground">{job.title}</h3>
            {openings > 1 && (
              <Badge variant="secondary" className="shrink-0 font-medium">
                <Users className="mr-1 h-3 w-3" />
                {openings} openings
              </Badge>
            )}
          </div>
          {team && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              {team}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="font-medium">
            {employmentTypeLabel(job.employment_type) || "Role"}
          </Badge>
          <Badge variant="outline" className="font-medium">
            {experienceLabel(job.experience_min_years, job.experience_max_years)}
          </Badge>
        </div>

        <div className="space-y-1.5 text-sm text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{place}</span>
          </p>
          {job.salary_visible && (
            <p className="flex items-center gap-1.5">
              <IndianRupee className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {salaryLabel(job.salary_min, job.salary_max, job.salary_visible)}
              </span>
            </p>
          )}
          {(posted || closes) && (
            <p className="flex items-center gap-1.5 text-xs">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              <span>
                {posted}
                {posted && closes ? " · " : ""}
                {closes}
              </span>
            </p>
          )}
        </div>

        <Button asChild className="mt-auto w-full">
          <Link to={`/careers/${job.slug}`}>
            View &amp; apply
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function Careers() {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [departments, setDepartments] = useState<Lookup[]>([]);
  const [campuses, setCampuses] = useState<Lookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const db = supabase as unknown as LooseDb;
      const nowIso = new Date().toISOString();
      const [jobsRes, deptRes, campusRes] = await Promise.all([
        db
          .from("job_openings")
          .select(JOB_COLUMNS)
          .eq("status", "open")
          .or(`closes_at.is.null,closes_at.gt.${nowIso}`)
          .order("posted_at", { ascending: false }),
        db.from("departments").select("id, name").order("name"),
        db.from("campuses").select("id, name").order("name"),
      ]);
      if (cancelled) return;
      if (jobsRes.error) {
        setError(jobsRes.error.message);
        toast({
          title: "Could not load open roles",
          description: jobsRes.error.message,
          variant: "destructive",
        });
      }
      // Belt-and-braces: the RLS policy already filters closed rows, but the
      // query can race a closing date, so re-check in the client.
      setJobs(((jobsRes.data as PublicJob[]) ?? []).filter((job) => isLive(job)));
      setDepartments((deptRes.data as Lookup[]) ?? []);
      setCampuses((campusRes.data as Lookup[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [toast, reloadKey]);

  const departmentMap = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments],
  );
  const campusMap = useMemo(
    () => new Map(campuses.map((c) => [c.id, c.name])),
    [campuses],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((job) => {
      const haystack = [
        job.title,
        job.location,
        job.employment_type,
        job.department_id ? departmentMap.get(job.department_id) : "",
        job.campus_id ? campusMap.get(job.campus_id) : "",
      ];
      return haystack.some((value) => (value ?? "").toLowerCase().includes(q));
    });
  }, [jobs, search, departmentMap, campusMap]);

  return (
    <div className="min-h-screen bg-background">
      <BrandBar />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 space-y-2">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Open roles</h1>
          <p className="text-sm text-muted-foreground">
            Join NIMT Group of Institutions. Browse our current openings and apply online.
          </p>
        </div>

        <div className="relative mb-6 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, department or location"
            className="pl-9"
            aria-label="Search open roles"
          />
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="h-56 animate-pulse bg-muted/40" />
            ))}
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={Briefcase}
                title="We couldn't load the openings"
                description={error}
              >
                <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                  <RefreshCw className="h-4 w-4" />
                  Try again
                </Button>
              </EmptyState>
            </CardContent>
          </Card>
        ) : jobs.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={Briefcase}
                title="No open roles right now"
                description="We're not hiring at the moment. Please check back soon — new openings are posted here first."
              />
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <EmptyState
                icon={Search}
                title="No roles match your search"
                description={`Nothing found for “${search.trim()}”. Try a different keyword or clear the search.`}
              >
                <Button variant="outline" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              </EmptyState>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filtered.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                departmentName={job.department_id ? departmentMap.get(job.department_id) : undefined}
                campusName={job.campus_id ? campusMap.get(job.campus_id) : undefined}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-border py-6">
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} NIMT Group of Institutions · Careers
        </p>
      </footer>
    </div>
  );
}
