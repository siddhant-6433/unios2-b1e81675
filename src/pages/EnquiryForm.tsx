import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { GraduationCap, CheckCircle, Send, User, Phone, Mail, BookOpen, MapPin, MessageSquare, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCourseCampusLink } from "@/hooks/useCourseCampusLink";
import { PORTAL_CONFIGS, detectPortal } from "@/components/apply/portalConfig";
import { getSchoolGradeSortRank } from "@/components/apply/ageValidation";

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

      const { data, error } = await supabase.functions.invoke("lead-ingest?source=website", {
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
        },
      });

      if (error) throw error;

      if (data?.status === "duplicate") {
        toast({ title: "Already registered", description: "We already have your enquiry. Our team will reach out soon!" });
      } else {
        toast({ title: "Enquiry submitted!", description: "Our admissions team will contact you shortly." });
      }
      setSubmitted(true);
    } catch (err: any) {
      console.error("Enquiry submit error:", err);
      toast({ title: "Submission failed", description: err.message || "Please try again later.", variant: "destructive" });
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
    <div ref={formRef} className={isEmbed ? "bg-background p-4" : "min-h-screen bg-background"}>
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
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
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

export default EnquiryForm;
