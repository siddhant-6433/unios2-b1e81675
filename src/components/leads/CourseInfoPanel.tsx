import { PageLoader } from "@/components/ui/page-loader";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { FeeStructureViewer } from "@/components/finance/FeeStructureViewer";
import {
  Loader2, ExternalLink, FileText, GraduationCap, Building2, Users,
  BookOpen, Award, Clock, CheckCircle,
} from "lucide-react";

/**
 * Curated course facts from public.course_facts, via fn_course_facts.
 * This is the single source of truth shared with the website, the WhatsApp
 * course_info templates and Navya — see the table comment in
 * 20260810*_course_facts_single_source_of_truth.sql.
 */
interface CourseFacts {
  duration?: string | null;
  eligibility?: string | null;
  entrance_exam?: string | null;
  approval?: string | null;
  age_requirement?: string | null;
  intake_seats?: string | null;
  subjects?: string | null;
  fee_first_year?: string | null;
  curated?: boolean;
  verified_at?: string | null;
}

// Last-resort affiliations per institution, used only when neither course_facts
// nor courses.affiliations has a value.
const INSTITUTION_INFO: Record<string, { affiliations: string[]; approvals: string[] }> = {
  "NIMT-IMPS": {
    affiliations: ["Dr. A.P.J. Abdul Kalam Technical University (AKTU), Lucknow"],
    approvals: ["AICTE Approved", "UP Government Recognised", "NIRF Ranked"],
  },
  "NIMT-CON": {
    affiliations: ["Indian Nursing Council (INC)", "UP State Medical Faculty"],
    approvals: ["UP Government Recognised"],
  },
  "NIMT-COE": {
    affiliations: ["NCTE Recognised"],
    approvals: ["UP Government Recognised"],
  },
  "NIMT-COL": {
    affiliations: ["Bar Council of India (BCI)", "Chaudhary Charan Singh University (CCSU)"],
    approvals: ["UP Government Recognised"],
  },
  "NIMT-COM": {
    affiliations: ["AICTE Approved"],
    approvals: ["UP Government Recognised", "NIRF Ranked"],
  },
  "NIMT-COL-KT": {
    affiliations: ["Bar Council of India (BCI)", "University of Rajasthan"],
    approvals: ["Rajasthan Government Recognised"],
  },
  "NIMT-COE-KT": {
    affiliations: ["NCTE Recognised", "University of Rajasthan"],
    approvals: ["Rajasthan Government Recognised"],
  },
  // Schools
  "NIMT-BS-AV": {
    affiliations: ["CBSE Affiliated"],
    approvals: ["UP Government Recognised"],
  },
  "NIMT-BS-AR": {
    affiliations: ["CBSE Affiliated"],
    approvals: ["UP Government Recognised"],
  },
  "MIRAI": {
    affiliations: ["IB World School (Candidate)"],
    approvals: [],
  },
};

interface CourseData {
  name: string;
  code: string;
  duration_years: number;
  type: string;
  webflow_slug: string | null;
  curriculum_url: string | null;
  affiliations: string[];
  department_name: string;
  institution_name: string;
  institution_code: string;
  institution_type: string;
  campus_name: string;
}

interface EligibilityData {
  entrance_exam_name: string | null;
  entrance_exam_required: boolean | null;
  class_12_min_marks: number | null;
  sc_st_min_marks: number | null;
  graduation_min_marks: number | null;
  requires_graduation: boolean | null;
  min_age: number | null;
  max_age: number | null;
  subject_prerequisites: string[] | null;
  notes: string | null;
  intake_capacity: number | null;
}

interface Props {
  courseId: string;
}

export function CourseInfoPanel({ courseId }: Props) {
  const [course, setCourse] = useState<CourseData | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityData | null>(null);
  const [facts, setFacts] = useState<CourseFacts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [courseRes, eligRes, factsRes] = await Promise.all([
        supabase
          .from("courses")
          .select(`
            name, code, duration_years, type, webflow_slug, curriculum_url, affiliations,
            departments!inner(name,
              institutions!inner(name, code, type,
                campuses!inner(name)
              )
            )
          `)
          .eq("id", courseId)
          .single(),
        supabase
          .from("eligibility_rules")
          .select("*")
          .eq("course_id", courseId)
          .maybeSingle(),
        // course_facts is the curated single source of truth — the same values
        // the website, WhatsApp templates and Navya now render.
        (supabase.rpc as any)("fn_course_facts", { p_course_id: courseId, p_student_name: null }),
      ]);
      if (!factsRes?.error && factsRes?.data) setFacts(factsRes.data as CourseFacts);

      if (courseRes.data) {
        const d = courseRes.data as any;
        setCourse({
          name: d.name,
          code: d.code,
          duration_years: d.duration_years,
          type: d.type,
          webflow_slug: d.webflow_slug,
          curriculum_url: d.curriculum_url,
          affiliations: Array.isArray(d.affiliations) ? d.affiliations : [],
          department_name: d.departments?.name,
          institution_name: d.departments?.institutions?.name,
          institution_code: d.departments?.institutions?.code,
          institution_type: d.departments?.institutions?.type,
          campus_name: d.departments?.institutions?.campuses?.name,
        });
      }
      if (eligRes.data) setEligibility(eligRes.data as any);
      setLoading(false);
    })();
  }, [courseId]);

  if (loading) return <PageLoader />;
  if (!course) return <p className="text-xs text-muted-foreground text-center py-4">Course not found</p>;

  // Curated course_facts wins, then course-level affiliations, then the
  // hardcoded institution defaults.
  const instDefaults = INSTITUTION_INFO[course.institution_code] || { affiliations: [], approvals: [] };
  const curatedAffiliations = (facts?.approval || "")
    .split(/\s*\|\s*/)
    .map(s => s.trim())
    .filter(s => s && s !== "NIMT Educational Institutions");
  const instInfo = {
    affiliations: curatedAffiliations.length > 0
      ? curatedAffiliations
      : (course.affiliations.length > 0 ? course.affiliations : instDefaults.affiliations),
    approvals: instDefaults.approvals,
  };
  const websiteUrl = course.webflow_slug ? `https://www.nimt.ac.in/${course.webflow_slug}` : null;
  const curriculumUrl = course.curriculum_url
    ? (course.curriculum_url.startsWith("http") ? course.curriculum_url : `https://www.nimt.ac.in${course.curriculum_url}`)
    : null;

  return (
    <div className="space-y-4">
      {/* Course Overview */}
      <div className="rounded-xl border border-border/60 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground">{course.name}</h4>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {course.institution_name} · {course.campus_name}
            </p>
          </div>
          <Badge variant="outline" className="text-[9px] font-mono">{course.code}</Badge>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/30 px-3 py-2">
            <span className="text-[10px] text-muted-foreground">Duration</span>
            <p className="text-xs font-semibold text-foreground">
              {facts?.duration || `${course.duration_years} year${course.duration_years > 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="rounded-lg bg-muted/30 px-3 py-2">
            <span className="text-[10px] text-muted-foreground">Exam Mode</span>
            <p className="text-xs font-semibold text-foreground capitalize">{course.type}</p>
          </div>
          <div className="rounded-lg bg-muted/30 px-3 py-2">
            <span className="text-[10px] text-muted-foreground">Department</span>
            <p className="text-xs font-semibold text-foreground">{course.department_name}</p>
          </div>
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-2">
          {websiteUrl && (
            <a href={websiteUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-primary/5 border border-primary/20 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors">
              <ExternalLink className="h-3 w-3" /> View on nimt.ac.in
            </a>
          )}
          {curriculumUrl && (
            <a href={curriculumUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-muted border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 transition-colors">
              <FileText className="h-3 w-3" /> Curriculum PDF
            </a>
          )}
        </div>
      </div>

      {/* Affiliations & Approvals */}
      {(instInfo.affiliations.length > 0 || instInfo.approvals.length > 0) && (
        <div className="rounded-xl border border-border/60 p-4 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Award className="h-3.5 w-3.5" /> Affiliations & Approvals
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {instInfo.affiliations.map((a, i) => (
              <Badge key={i} className="text-[10px] border-0 bg-info/10 text-info-foreground dark:bg-info/80/30 dark:text-info/80">
                {a}
              </Badge>
            ))}
            {instInfo.approvals.map((a, i) => (
              <Badge key={i} className="text-[10px] border-0 bg-success/10 text-success dark:bg-success/80/30 dark:text-success">
                <CheckCircle className="h-2.5 w-2.5 mr-0.5" /> {a}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Curated facts — verbatim what the website, WhatsApp templates and Navya
          tell students. Shown above the structured rules so a counsellor can
          quote the same words rather than paraphrase. */}
      {facts?.curated && (
        <div className="rounded-xl border border-success/30 bg-success/[0.03] p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-success uppercase tracking-wide flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" /> What we tell students
            </h4>
            {facts.verified_at && (
              <span className="text-[10px] text-muted-foreground">
                verified {new Date(facts.verified_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            )}
          </div>
          <div className="space-y-1.5 text-xs">
            {([
              ["Eligibility", facts.eligibility],
              ["Entrance exam", facts.entrance_exam],
              ["Subjects", facts.subjects],
              ["Age", facts.age_requirement],
              ["Seats", facts.intake_seats],
              ["First-year fee", facts.fee_first_year],
            ] as Array<[string, string | null | undefined]>)
              .filter(([, v]) => v)
              .map(([label, v]) => (
                <div key={label} className="flex items-start gap-2">
                  <span className="text-muted-foreground w-28 shrink-0">{label}</span>
                  <span className="text-foreground">{v}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Eligibility */}
      {eligibility && (
        <div className="rounded-xl border border-border/60 p-4 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <GraduationCap className="h-3.5 w-3.5" /> Eligibility (structured rules)
          </h4>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground w-28 shrink-0">Entrance Exam</span>
              {eligibility.entrance_exam_name ? (
                <>
                  <span className="text-foreground font-medium">{eligibility.entrance_exam_name}</span>
                  {eligibility.entrance_exam_required
                    ? <Badge className="text-[8px] bg-destructive/10 text-destructive dark:bg-destructive/80/30 dark:text-destructive/80 border-0">Mandatory</Badge>
                    : <Badge className="text-[8px] bg-warning/10 text-warning-foreground dark:bg-warning/80/30 dark:text-warning border-0">Optional</Badge>}
                </>
              ) : (
                <span className="text-foreground font-medium">
                  Not required
                  <Badge className="text-[8px] bg-info/10 text-info-foreground dark:bg-info/80/30 dark:text-info/80 border-0 ml-1.5">Direct Admission</Badge>
                </span>
              )}
            </div>
            {eligibility.class_12_min_marks && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-28 shrink-0">12th Min Marks</span>
                <span className="text-foreground font-medium">
                  {eligibility.class_12_min_marks}%
                  {eligibility.sc_st_min_marks != null && eligibility.sc_st_min_marks !== eligibility.class_12_min_marks && (
                    <span className="ml-1.5 text-muted-foreground font-normal text-[11px]">
                      (SC/ST: {eligibility.sc_st_min_marks}%)
                    </span>
                  )}
                </span>
              </div>
            )}
            {eligibility.requires_graduation && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-28 shrink-0">Graduation</span>
                <span className="text-foreground font-medium">
                  Required{eligibility.graduation_min_marks ? ` (min ${eligibility.graduation_min_marks}%)` : ""}
                </span>
              </div>
            )}
            {eligibility.subject_prerequisites && eligibility.subject_prerequisites.length > 0 && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground w-28 shrink-0">Subjects</span>
                <span className="text-foreground font-medium">{eligibility.subject_prerequisites.join(", ")}</span>
              </div>
            )}
            {(eligibility.min_age || eligibility.max_age) && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-28 shrink-0">Age</span>
                <span className="text-foreground font-medium">
                  {eligibility.min_age && `Min ${eligibility.min_age}`}
                  {eligibility.min_age && eligibility.max_age && " — "}
                  {eligibility.max_age && `Max ${eligibility.max_age}`} years
                </span>
              </div>
            )}
            {eligibility.intake_capacity && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-28 shrink-0">Intake</span>
                <span className="text-foreground font-medium flex items-center gap-1">
                  <Users className="h-3 w-3" /> {eligibility.intake_capacity} seats
                </span>
              </div>
            )}
            {eligibility.notes && (
              <div className="mt-1 rounded-lg bg-muted/30 px-3 py-2">
                <p className="text-[11px] text-foreground/80 leading-relaxed">{eligibility.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fee Structure */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
          <BookOpen className="h-3.5 w-3.5" /> Fee Structure
        </h4>
        <FeeStructureViewer courseId={courseId} compact newAdmissionOnly />
      </div>
    </div>
  );
}
