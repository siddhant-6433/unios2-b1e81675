import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { GraduationCap, CheckCircle, Send, User, Phone, Mail, BookOpen, MapPin, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Program groups with courses and campuses from official taxonomy
const PROGRAMS: { program: string; type: "school" | "college"; courses: { name: string; campuses: string[] }[] }[] = [
  {
    program: "Allied Healthcare",
    type: "college",
    courses: [
      { name: "B.Sc. in Medical Radiology & Imaging Technology (BMRIT)", campuses: ["Greater Noida, Uttar Pradesh"] },
      { name: "M.Sc. in Medical Radiology & Imaging Technology (MMRIT)", campuses: ["Greater Noida, Uttar Pradesh"] },
      { name: "Diploma in Physiotherapy (DPT)", campuses: ["Greater Noida, Uttar Pradesh"] },
      { name: "Bachelor of Physiotherapy (BPT)", campuses: ["Greater Noida, Uttar Pradesh"] },
      { name: "Masters in Physiotherapy (MPT)", campuses: ["Greater Noida, Uttar Pradesh"] },
      { name: "Diploma in Operation Theater Technician (OTT)", campuses: ["Greater Noida, Uttar Pradesh"] },
    ],
  },
  {
    program: "Pharmacy",
    type: "college",
    courses: [
      { name: "Diploma in Pharmacy (D. Pharma)", campuses: ["Greater Noida, Uttar Pradesh"] },
    ],
  },
  {
    program: "Nursing",
    type: "college",
    courses: [
      { name: "Bachelor of Science in Nursing (B.Sc Nursing)", campuses: ["Greater Noida, Uttar Pradesh"] },
      { name: "Diploma in General Nursing and Midwifery (GNM)", campuses: ["Greater Noida, Uttar Pradesh"] },
    ],
  },
  {
    program: "Education",
    type: "college",
    courses: [
      { name: "Bachelor of Education (B.Ed)", campuses: ["Shastri Nagar, Ghaziabad, Uttar Pradesh", "Greater Noida, Uttar Pradesh", "Kotputli, Rajasthan"] },
      { name: "BTC/ Diploma in Elementary Education (D.El.Ed)", campuses: ["Shastri Nagar, Ghaziabad, Uttar Pradesh"] },
    ],
  },
  {
    program: "Law",
    type: "college",
    courses: [
      { name: "Bachelor of Arts and Bachelor of Laws (BALLB)", campuses: ["Greater Noida, Uttar Pradesh"] },
      { name: "Bachelor of Laws (LLB)", campuses: ["Greater Noida, Uttar Pradesh", "Kotputli, Rajasthan"] },
    ],
  },
  {
    program: "Management",
    type: "college",
    courses: [
      { name: "Master of Business Administration (MBA)", campuses: ["Greater Noida, Uttar Pradesh"] },
      { name: "Post Graduate Diploma In Management (PGDM)", campuses: ["Greater Noida, Uttar Pradesh", "Kotputli, Rajasthan"] },
      { name: "Bachelor of Business Administration (BBA)", campuses: ["Greater Noida, Uttar Pradesh"] },
    ],
  },
  {
    program: "Computer Science",
    type: "college",
    courses: [
      { name: "Bachelor of Computer Administration (BCA)", campuses: ["Greater Noida, Uttar Pradesh"] },
    ],
  },
  {
    program: "K-12 Schooling – CBSE",
    type: "school",
    courses: [
      ...["Pre-Nursery", "Nursery", "KG", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"].map((cls) => ({
        name: cls,
        campuses: ["NIMT B School Avt II – CBSE"],
      })),
    ],
  },
  {
    program: "K-12 Schooling",
    type: "school",
    courses: [
      ...["Pre-Nursery", "Nursery", "KG", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"].map((cls) => ({
        name: cls,
        campuses: ["NIMT B School Arthala"],
      })),
    ],
  },
];

// Flatten for lookup: course name → { type, campuses[] }
const COURSE_CAMPUS_MAP = PROGRAMS.flatMap((p) =>
  p.courses.map((c) => ({ course: c.name, program: p.program, type: p.type, campuses: c.campuses }))
);

const EnquiryForm = () => {
  const [searchParams] = useSearchParams();
  const isEmbed = searchParams.get("embed") === "true";
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    guardian_name: "",
    guardian_phone: "",
    courseKey: "", // "program||course" composite key
    campus: "",
    message: "",
  });

  const update = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const selectedCourseEntry = useMemo(() => {
    if (!form.courseKey) return null;
    const [program, course] = form.courseKey.split("||");
    return COURSE_CAMPUS_MAP.find((c) => c.program === program && c.course === course) || null;
  }, [form.courseKey]);

  const isSchool = selectedCourseEntry?.type === "school";
  const availableCampuses = selectedCourseEntry?.campuses || [];

  const handleCourseChange = (courseKey: string) => {
    const [program, course] = courseKey.split("||");
    const entry = COURSE_CAMPUS_MAP.find((c) => c.program === program && c.course === course);
    const campus = entry?.campuses.length === 1 ? entry.campuses[0] : "";
    setForm((p) => ({ ...p, courseKey, campus }));
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
      const { data, error } = await supabase.functions.invoke("lead-ingest?source=website", {
        body: {
          name: form.name.trim(),
          phone: form.phone,
          email: form.email.trim() || undefined,
          guardian_name: form.guardian_name.trim() || undefined,
          guardian_phone: form.guardian_phone || undefined,
          course: selectedCourseEntry?.course || undefined,
          campus: form.campus || undefined,
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
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-border/60 shadow-none">
          <CardContent className="p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Thank You!</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Your enquiry has been received. Our admissions team will contact you within 24 hours.
            </p>
            <Button
              className="mt-6 w-full"
              onClick={() => {
                setSubmitted(false);
                setForm({ name: "", phone: "", email: "", guardian_name: "", guardian_phone: "", courseKey: "", campus: "", message: "" });
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
    <div className="min-h-screen bg-background">
      {/* Header */}
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

      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Enquire Now</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Fill in your details and our admissions team will get back to you.
          </p>
        </div>

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
                      value={form.courseKey}
                      onChange={(e) => handleCourseChange(e.target.value)}
                      className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 appearance-none"
                    >
                      <option value="">Select course / class</option>
                      {PROGRAMS.map((p) => (
                        <optgroup key={p.program} label={p.program}>
                          {p.courses.map((c) => (
                            <option key={`${p.program}-${c.name}`} value={`${p.program}||${c.name}`}>
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
                    Campus {availableCampuses.length > 1 && <span className="text-destructive">*</span>}
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <select
                      value={form.campus}
                      onChange={(e) => update("campus", e.target.value)}
                      disabled={!form.courseKey || availableCampuses.length <= 1}
                      required={availableCampuses.length > 1}
                      className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {!form.courseKey ? (
                        <option value="">Select course first</option>
                      ) : availableCampuses.length === 1 ? (
                        <option value={availableCampuses[0]}>{availableCampuses[0]}</option>
                      ) : (
                        <>
                          <option value="">Select campus</option>
                          {availableCampuses.map((c) => (
                            <option key={c} value={c}>{c}</option>
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
              {(isSchool || !form.courseKey) && (
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
            </CardContent>
          </Card>

          <Button type="submit" disabled={submitting} className="mt-6 w-full gap-2">
            <Send className="h-4 w-4" />
            {submitting ? "Submitting…" : "Submit Enquiry"}
          </Button>

          <p className="text-[11px] text-muted-foreground text-center mt-4">
            By submitting, you agree to be contacted by our admissions team via phone, WhatsApp, or email.
          </p>
        </form>
      </div>
    </div>
  );
};

export default EnquiryForm;
