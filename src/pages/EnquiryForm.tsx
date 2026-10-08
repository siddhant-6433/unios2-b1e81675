import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { GraduationCap, CheckCircle, Send, User, Phone, Mail, BookOpen, MapPin, MessageSquare, ArrowRight, CalendarDays, PhoneCall, School } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ButtonOrb } from "@/components/ui/thinking-orb";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";
import { PORTAL_CONFIGS, detectPortal } from "@/components/apply/portalConfig";
import { getSchoolGradeSortRank } from "@/components/apply/ageValidation";
import { captureAttribution, type AttributionPayload } from "@/lib/analytics";
import { miraiAdmissionRequestPayload, miraiEnquiryPayload, validateMiraiEnquiry, type MiraiEnquiryValues } from "@/components/apply/miraiJourney";

function fieldFromSearch(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value && value.trim() ? value.trim() : undefined;
}

function originFromUrl(value?: string) {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function leadSourceFromAttribution(attribution: AttributionPayload) {
  const source = (attribution._utm_source || "").toLowerCase();
  if (attribution._gclid) return "google_ads";
  if (source === "google" || source === "google_ads" || source === "adwords") return "google_ads";
  if (["facebook", "fb", "instagram", "meta", "meta_ads"].includes(source)) return "meta_ads";
  return "website";
}

function leadIngestAttribution(attribution: AttributionPayload) {
  return {
    ga_client_id: attribution._ga_client_id,
    ga_session_id: attribution._ga_session_id,
    gclid: attribution._gclid,
    utm_source: attribution._utm_source,
    utm_medium: attribution._utm_medium,
    utm_campaign: attribution._utm_campaign,
    utm_term: attribution._utm_term,
    utm_content: attribution._utm_content,
    landing_page: attribution._landing_page,
    referrer: attribution._referrer,
    origin_domain: attribution._origin_domain,
    fbc: attribution._fbc,
    fbp: attribution._fbp,
    portal_brand: attribution._portal_brand,
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

const EnquiryForm = () => {
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "true";
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const { coursesByDepartment, getCampusesForCourse, courseOptions } = useCourseCampusLink();

  // Auto-resize messaging for embed mode
  useEffect(() => {
    if (!isEmbed || !formRef.current) return;
    const observer = new ResizeObserver(() => {
      if (formRef.current) {
        window.parent.postMessage(
          { type: "nimt-enquiry-resize", height: formRef.current.scrollHeight + 32 },
          "*"
        );
      }
    });
    observer.observe(formRef.current);
    return () => observer.disconnect();
  }, [isEmbed, submitted]);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    guardian_name: "",
    guardian_phone: "",
    course_id: "",
    campus_id: "",
    message: "",
  });

  const update = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const filteredCampuses = getCampusesForCourse(form.course_id || null);
  const selectedCourse = courseOptions.find(c => c.id === form.course_id);
  // Determine if school type based on department/institution name
  const isSchool = selectedCourse?.institution_name?.toLowerCase().includes("school") || false;

  // Detect which portal is currently active (e.g. from the domain name or ?portal query)
  const currentPortalId = detectPortal(window.location.search, window.location.pathname);
  const portalConfig = PORTAL_CONFIGS[currentPortalId];

  if (currentPortalId === "mirai") {
    return <MiraiEnquiryForm isEmbed={isEmbed} courseOptions={filteredCourseGroups.flatMap(group => group.courses)} />;
  }

  // Filter the course groups based on the portal config (institutions, grade keywords, campus keywords)
  const filteredCourseGroups = coursesByDepartment.map(g => {
    return {
      ...g,
      courses: g.courses.filter(c => {
        // Institution type check
        if (portalConfig.institutionTypes.length > 0) {
          const instType = c.institution_type?.toLowerCase() || "";
          if (!portalConfig.institutionTypes.some(t => instType.includes(t))) return false;
        }

        // Grade keyword check
        if (portalConfig.gradeKeywords.length > 0) {
          const nameAndCode = (c.name + " " + c.code).toLowerCase();
          if (!portalConfig.gradeKeywords.some(kw => nameAndCode.includes(kw))) return false;
        }

        // Campus keyword check
        if (portalConfig.campusKeywords && portalConfig.campusKeywords.length > 0) {
          const matchCampuses = getCampusesForCourse(c.id);
          const foundMatchingCampus = matchCampuses.some(campus => {
            const cName = campus.name.toLowerCase();
            return portalConfig.campusKeywords.some(kw => cName.includes(kw));
          });
          if (!foundMatchingCampus) return false;
        }

        return true;
      }).sort((a, b) => {
        const rankA = getSchoolGradeSortRank(a.name || "", a.code || "", currentPortalId);
        const rankB = getSchoolGradeSortRank(b.name || "", b.code || "", currentPortalId);
        if (rankA !== rankB) return rankA - rankB;
        return (a.name || "").localeCompare(b.name || "");
      })
    };
  }).filter(g => g.courses.length > 0);

  const handleCourseChange = (courseId: string) => {
    const campuses = getCampusesForCourse(courseId || null);
    setForm((p) => ({
      ...p,
      course_id: courseId,
      campus_id: campuses.length === 1 ? campuses[0].id : "",
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      toast({ title: "Missing fields", description: "Name and phone are required.", variant: "destructive" });
      return;
    }
    if (isSchool && (!form.guardian_name.trim() || !form.guardian_phone.trim())) {
      toast({ title: "Missing fields", description: "Guardian name and phone are required for school admissions.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const courseName = courseOptions.find(c => c.id === form.course_id)?.name;
      const campusName = filteredCampuses.find(c => c.id === form.campus_id)?.name;

      const baseAttribution = captureAttribution(currentPortalId);
      const parentUrl = fieldFromSearch(searchParams, "parent_url");
      const parentReferrer = fieldFromSearch(searchParams, "parent_referrer");
      const forwardedOrigin = fieldFromSearch(searchParams, "origin_domain") || originFromUrl(parentUrl);
      const attribution: AttributionPayload = {
        ...baseAttribution,
        _landing_page: parentUrl || baseAttribution._landing_page,
        _referrer: parentReferrer || baseAttribution._referrer,
        _origin_domain: forwardedOrigin || baseAttribution._origin_domain,
      };
      const leadSource = leadSourceFromAttribution(attribution);

      const { data, error } = await supabase.functions.invoke(`lead-ingest?source=${encodeURIComponent(leadSource)}`, {
        body: {
          name: form.name.trim(),
          phone: form.phone,
          email: form.email.trim() || undefined,
          guardian_name: form.guardian_name.trim() || undefined,
          guardian_phone: form.guardian_phone || undefined,
          course: courseName || undefined,
          campus: campusName || undefined,
          course_id: form.course_id || undefined,
          campus_id: form.campus_id || undefined,
          message: form.message.trim() || undefined,
          ...leadIngestAttribution(attribution),
        },
      });

      if (error) throw error;

      if (data?.status === "duplicate") {
        toast({ title: "Already registered", description: "We already have your enquiry. Our team will reach out soon!" });
      } else {
        toast({ title: "Enquiry submitted!", description: "Our admissions team will contact you shortly." });
      }
      setSubmitted(true);
    } catch (err: unknown) {
      console.error("Enquiry submit error:", err);
      toast({ title: "Submission failed", description: errorMessage(err, "Please try again later."), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className={isEmbed ? "bg-background p-4" : "min-h-screen bg-background flex items-center justify-center p-6"}>
        <Card className="max-w-md w-full border-border/60 shadow-none mx-auto">
          <CardContent className="p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Thank You!</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Your enquiry has been received. Our admissions team will contact you within 24 hours.
            </p>
            <div className="mt-4 p-3 rounded-xl bg-primary/5 border border-primary/10">
              <p className="text-xs text-muted-foreground">Ready to complete your application?</p>
              <a
                href="/apply"
                className="inline-flex items-center gap-1.5 mt-1.5 text-sm font-medium text-primary hover:underline"
              >
                Go to Application Portal <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
            <Button
              variant="outline"
              className="mt-4 w-full"
              onClick={() => {
                setSubmitted(false);
                setForm({ name: "", phone: "", email: "", guardian_name: "", guardian_phone: "", course_id: "", campus_id: "", message: "" });
              }}
            >
              Submit Another Enquiry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div ref={formRef} className={isEmbed ? "bg-background p-4" : "min-h-screen bg-background animate-fade-in"}>
      {/* Header — hidden in embed mode */}
      {!isEmbed && (
        <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30">
          <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-sm">
              <GraduationCap className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <span className="text-sm font-bold text-foreground tracking-tight">NIMT UniOs</span>
              <span className="text-[11px] text-muted-foreground block">Admission Enquiry</span>
            </div>
          </div>
        </header>
      )}

      <div className={isEmbed ? "" : "max-w-2xl mx-auto px-6 py-8"}>
        {!isEmbed && (
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">Enquire Now</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Fill in your details and our admissions team will get back to you.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-6 space-y-5">
              {/* Course & Campus — first */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Course / Class <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <select
                      required
                      value={form.course_id}
                      onChange={(e) => handleCourseChange(e.target.value)}
                      className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 appearance-none"
                    >
                      <option value="">Select course / class</option>
                      {filteredCourseGroups.map((g) => (
                        <optgroup key={g.department} label={g.department}>
                          {g.courses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Campus {filteredCampuses.length > 1 && <span className="text-destructive">*</span>}
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <select
                      value={form.campus_id}
                      onChange={(e) => update("campus_id", e.target.value)}
                      disabled={!form.course_id || filteredCampuses.length <= 1}
                      required={filteredCampuses.length > 1}
                      className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {!form.course_id ? (
                        <option value="">Select course first</option>
                      ) : filteredCampuses.length === 1 ? (
                        <option value={filteredCampuses[0].id}>{filteredCampuses[0].name}</option>
                      ) : (
                        <>
                          <option value="">Select campus</option>
                          {filteredCampuses.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </>
                      )}
                    </select>
                  </div>
                </div>
              </div>

              {/* Name & Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Full Name <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      required
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      placeholder="Student's full name"
                      className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Phone Number <span className="text-destructive">*</span>
                  </label>
                  <PhoneInput value={form.phone} onChange={(v) => update("phone", v)} required />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="student@email.com"
                    className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
              </div>

              {/* Guardian — required for school, optional for college */}
              {(isSchool || !form.course_id) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Guardian Name {isSchool && <span className="text-destructive">*</span>}
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <input
                        required={isSchool}
                        value={form.guardian_name}
                        onChange={(e) => update("guardian_name", e.target.value)}
                        placeholder="Father / guardian name"
                        className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                      />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      Guardian Phone {isSchool && <span className="text-destructive">*</span>}
                    </label>
                    <PhoneInput value={form.guardian_phone} onChange={(v) => update("guardian_phone", v)} required={isSchool} />
                  </div>
                </div>
              )}

              {/* Message */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Message / Query</label>
                <div className="relative">
                  <MessageSquare className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <textarea
                    value={form.message}
                    onChange={(e) => update("message", e.target.value)}
                    placeholder="Any specific questions about admissions?"
                    rows={3}
                    className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none"
                  />
                </div>
              </div>

              <Button type="submit" className="w-full gap-2" disabled={submitting}>
                {submitting ? (
                  <ButtonOrb onFilled />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit Enquiry
              </Button>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
};

type MiraiCourseOption = { id: string; name: string; code: string };

function MiraiEnquiryForm({ isEmbed, courseOptions }: { isEmbed: boolean; courseOptions: MiraiCourseOption[] }) {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submittedLeadId, setSubmittedLeadId] = useState<string | null>(null);
  const [requestType, setRequestType] = useState<"call" | "campus_tour" | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; name: string }[]>([]);
  const [values, setValues] = useState<MiraiEnquiryValues>({
    parentName: "", email: "", phone: "", childName: "", age: "", currentSchool: "",
    grade: "", academicYear: "", discoverySource: "", consent: false,
  });
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const update = (key: keyof typeof values, value: string | boolean) => {
    setValues(previous => ({ ...previous, [key]: value }));
    setErrors(previous => ({ ...previous, [key]: false }));
  };

  useEffect(() => {
    supabase.from("admission_sessions").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => setSessions(data || []));
  }, []);

  const attribution = () => {
    const base = captureAttribution("mirai");
    const parentUrl = fieldFromSearch(searchParams, "parent_url");
    const parentReferrer = fieldFromSearch(searchParams, "parent_referrer");
    return {
      ...leadIngestAttribution({
        ...base,
        _landing_page: parentUrl || base._landing_page,
        _referrer: parentReferrer || base._referrer,
        _origin_domain: fieldFromSearch(searchParams, "origin_domain") || originFromUrl(parentUrl) || base._origin_domain,
      }),
      form_id: "mirai-admission-enquiry-v1",
    };
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (honeypot) return;
    const grade = courseOptions.find(course => course.id === values.grade);
    const nextErrors = validateMiraiEnquiry(values, !!grade);
    setErrors(Object.fromEntries(Object.entries(nextErrors).filter(([, valid]) => !valid).map(([key]) => [key, true])));
    if (Object.values(nextErrors).some(valid => !valid)) {
      toast({ title: "Check the highlighted fields", description: "Complete the required details to send your enquiry.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("lead-ingest?source=mirai", {
        body: miraiEnquiryPayload(values, grade!, attribution(), honeypot),
      });
      if (error) throw error;
      setSubmittedLeadId(data?.lead_id || data?.lead?.id || null);
    } catch (error: unknown) {
      toast({ title: "Enquiry could not be sent", description: errorMessage(error, "Please try again."), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const submitRequest = async () => {
    if (!requestType || !submittedLeadId) return;
    setRequesting(true);
    try {
      const { error } = await supabase.functions.invoke("mirai-admission-request", {
        body: miraiAdmissionRequestPayload(submittedLeadId, requestType, values.parentName, values.childName),
      });
      if (error) throw error;
      setRequestSent(true);
      setRequestType(null);
    } catch (error: unknown) {
      toast({ title: "Request could not be sent", description: errorMessage(error, "Please try again."), variant: "destructive" });
    } finally {
      setRequesting(false);
    }
  };

  if (submittedLeadId) {
    return (
      <div className={isEmbed ? "bg-background p-4" : "min-h-screen bg-[#f6f7f2] px-4 py-10 sm:px-6"}>
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex items-center gap-3">
            <img src={PORTAL_CONFIGS.mirai.logo} alt="Mirai Experiential School" className="h-12 w-auto" />
            <span className="border-l border-[#dce3d4] pl-3 text-xs uppercase tracking-[0.16em] text-[#64745e]">Admissions</span>
          </div>
          <Card className="overflow-hidden rounded-[1.75rem] border-[#e1e6dc] shadow-[0_22px_70px_rgba(48,66,39,0.08)]">
            <CardContent className="p-7 sm:p-10">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e9f0e4] text-[#506d47]"><CheckCircle className="h-7 w-7" /></div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-[#77966d]">Enquiry received</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#243121]">Thank you, {values.parentName.split(" ")[0]}.</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[#687264]">Our admissions team will be in touch. Here’s what the next part of the journey looks like.</p>
              <ol className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  ["01", "A conversation", "Join a webinar or speak one-to-one with admissions."],
                  ["02", "Experience Mirai", "Explore a campus visit or an age-appropriate assessment."],
                  ["03", "Next steps", "Receive an update and guidance from the admissions team."],
                ].map(([number, title, copy]) => <li key={number} className="rounded-2xl bg-[#f5f7f2] p-4"><span className="text-xs font-semibold tracking-widest text-[#77966d]">{number}</span><h2 className="mt-2 text-sm font-semibold text-[#2d3b29]">{title}</h2><p className="mt-1 text-xs leading-5 text-[#70796b]">{copy}</p></li>)}
              </ol>
              <div className="mt-8 rounded-2xl border border-[#e3e9dd] p-5">
                {requestSent ? <p className="text-sm font-medium text-[#435b3d]" role="status">Your request is with the Mirai admissions team. They’ll contact you soon.</p> : <>
                  <h2 className="text-sm font-semibold text-[#2d3b29]">Would you like us to arrange a conversation?</h2>
                  <p className="mt-1 text-xs text-[#70796b]">Choose a call or campus tour request. The team will contact you to arrange a time.</p>
                  {!requestType ? <div className="mt-4 flex flex-wrap gap-3"><Button variant="outline" className="rounded-xl" onClick={() => setRequestType("call")}><PhoneCall className="mr-2 h-4 w-4" />Request a call</Button><Button variant="outline" className="rounded-xl" onClick={() => setRequestType("campus_tour")}><CalendarDays className="mr-2 h-4 w-4" />Request a campus tour</Button></div> : <div className="mt-4 flex flex-wrap items-center gap-3"><p className="text-sm text-[#435b3d]">{requestType === "call" ? "Request a call" : "Request a campus tour"}</p><Button disabled={requesting} onClick={submitRequest} className="rounded-xl bg-[#526f49] hover:bg-[#415d39]">{requesting ? "Sending…" : "Send request"}</Button><Button variant="ghost" onClick={() => setRequestType(null)}>Cancel</Button></div>}
                </>}
              </div>
              <a href="/apply/mirai" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#526f49] hover:underline">Continue to the application portal <ArrowRight className="h-4 w-4" /></a>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const inputClass = "h-12 w-full rounded-xl border-[#dce2d7] bg-white px-3.5 text-sm text-[#293426] placeholder:text-[#9ba393] focus-visible:ring-[#77966d]/35";
  const labelClass = "mb-1.5 block text-xs font-semibold text-[#53604d]";
  const fieldError = (key: string) => errors[key] ? <span className="mt-1 block text-xs font-medium text-destructive" role="alert">Please check this field.</span> : null;
  const required = <span className="text-[#aa4a44]">*</span>;
  return (
    <div className={isEmbed ? "bg-background p-4" : "min-h-screen bg-[#f6f7f2] px-4 py-8 sm:px-6 sm:py-12"}>
      <div className="mx-auto grid max-w-6xl overflow-hidden rounded-[1.75rem] border border-[#e1e6dc] bg-white shadow-[0_22px_70px_rgba(48,66,39,0.08)] lg:grid-cols-[0.82fr_1.18fr]">
        <aside className="relative flex min-h-64 flex-col justify-between overflow-hidden bg-[#263923] p-7 text-white sm:p-10">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `url(${PORTAL_CONFIGS.mirai.loginBgImage})`, backgroundSize: "cover", backgroundPosition: "center" }} />
          <div className="absolute inset-0 bg-gradient-to-br from-[#1d2d1b]/90 via-[#33482e]/85 to-[#526f49]/75" />
          <div className="relative"><img src={PORTAL_CONFIGS.mirai.logo} alt="Mirai Experiential School" className="h-12 w-auto brightness-0 invert" /><p className="mt-12 text-xs font-semibold uppercase tracking-[0.2em] text-[#d3dfcc]">A place to grow</p><h1 className="mt-3 max-w-sm text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Begin your child’s Mirai journey.</h1><p className="mt-4 max-w-sm text-sm leading-6 text-white/75">Tell us a little about your family and what you’re looking for. Our admissions team will help you find the right next step.</p></div>
          <div className="relative mt-8 flex items-center gap-2 text-xs text-white/70"><School className="h-4 w-4" /> Future ready IB school</div>
        </aside>
        <main className="p-6 sm:p-9 lg:p-10">
          <div className="mb-7"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#77966d]">Admissions enquiry · about 1 minute</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#263225]">Let’s get to know your family</h2><p className="mt-2 text-sm text-[#737c6f]">Fields marked {required} are required.</p></div>
          <form noValidate onSubmit={handleSubmit} className="space-y-7">
            <section><h3 className="mb-4 text-sm font-semibold text-[#34412f]">Parent or guardian</h3><div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>Parent’s full name {required}<input aria-invalid={errors.parentName || undefined} className={`${inputClass} mt-1.5`} autoComplete="name" required value={values.parentName} onChange={e => update("parentName", e.target.value)} placeholder="Your full name" />{fieldError("parentName")}</label>
              <label className={labelClass}>Email address {required}<input aria-invalid={errors.email || undefined} className={`${inputClass} mt-1.5`} type="email" autoComplete="email" required value={values.email} onChange={e => update("email", e.target.value)} placeholder="you@example.com" />{fieldError("email")}</label>
              <div className="sm:col-span-2"><label className={labelClass}>Phone number {required}</label><PhoneInput value={values.phone} onChange={value => update("phone", value)} required invalid={errors.phone} aria-label="Parent phone number" />{fieldError("phone")}</div>
            </div></section>
            <section><h3 className="mb-4 text-sm font-semibold text-[#34412f]">About your child</h3><div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>Child’s full name {required}<input aria-invalid={errors.childName || undefined} className={`${inputClass} mt-1.5`} required value={values.childName} onChange={e => update("childName", e.target.value)} placeholder="Child’s full name" />{fieldError("childName")}</label>
              <label className={labelClass}>Current age {required}<input aria-invalid={errors.age || undefined} className={`${inputClass} mt-1.5`} type="number" min="1" max="18" step="1" required value={values.age} onChange={e => update("age", e.target.value)} placeholder="Age in years" />{errors.age && <span className="mt-1 block text-xs font-medium text-destructive" role="alert">Enter an age from 1 to 18.</span>}</label>
              <label className={labelClass}>Current school {required}<input aria-invalid={errors.currentSchool || undefined} className={`${inputClass} mt-1.5`} required value={values.currentSchool} onChange={e => update("currentSchool", e.target.value)} placeholder="School name" />{fieldError("currentSchool")}</label>
              <label className={labelClass}>Seeking admission for {required}<select aria-invalid={errors.grade || undefined} className={`${inputClass} mt-1.5`} required value={values.grade} onChange={e => update("grade", e.target.value)}><option value="">Select a grade</option>{courseOptions.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select>{fieldError("grade")}</label>
              <label className={labelClass}>Academic year {required}<select aria-invalid={errors.academicYear || undefined} className={`${inputClass} mt-1.5`} required value={values.academicYear} onChange={e => update("academicYear", e.target.value)}><option value="">Select an academic year</option>{sessions.map(session => <option key={session.id} value={session.name}>{session.name}</option>)}</select>{fieldError("academicYear")}</label>
              <label className={labelClass}>How did you hear about Mirai? {required}<select aria-invalid={errors.discoverySource || undefined} className={`${inputClass} mt-1.5`} required value={values.discoverySource} onChange={e => update("discoverySource", e.target.value)}><option value="">Select one</option>{["Online ads", "Social media", "Residential community", "Mirai parent referral", "Events or workshops", "Other"].map(option => <option key={option} value={option}>{option}</option>)}</select>{fieldError("discoverySource")}</label>
            </div></section>
            <label className="flex items-start gap-3 text-xs leading-5 text-[#697364]"><input aria-invalid={errors.consent || undefined} type="checkbox" required checked={values.consent} onChange={e => update("consent", e.target.checked)} className="mt-1 h-4 w-4 rounded border-[#b9c4b3] accent-[#526f49]" /><span>I agree that Mirai may contact me by phone, WhatsApp or email about this enquiry. See the <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-[#526f49] underline">Privacy Policy</a>. {required}{fieldError("consent")}</span></label>
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={honeypot} onChange={e => setHoneypot(e.target.value)} className="pointer-events-none absolute h-px w-px opacity-0" />
            <Button type="submit" disabled={submitting} className="h-12 w-full rounded-xl bg-[#526f49] text-sm font-semibold hover:bg-[#415d39]">{submitting ? "Sending your enquiry…" : <>Send enquiry <Send className="ml-2 h-4 w-4" /></>}</Button>
            <p className="text-center text-xs text-[#858d80]">Already started an application? <a href="/apply/mirai" className="font-semibold text-[#526f49] hover:underline">Continue to the application portal</a></p>
          </form>
        </main>
      </div>
    </div>
  );
}

export default EnquiryForm;
