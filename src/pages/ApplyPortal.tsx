import { useState } from "react";
import {
  GraduationCap, ChevronRight, FileText, Upload, User,
  Phone, Mail, MapPin, Calendar, CheckCircle, ArrowRight, ArrowLeft
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const campusCourses = [
  {
    campus: "NIMT Greater Noida",
    code: "NIMT-GN",
    type: "college" as const,
    courses: ["B.Tech CSE", "B.Tech ECE", "B.Tech ME", "B.Tech CE", "MBA", "BBA", "BCA"],
  },
  {
    campus: "NIMT Kotputli",
    code: "NIMT-KTP",
    type: "college" as const,
    courses: ["MBA", "BBA", "B.Com"],
  },
  {
    campus: "NIMT School Avantika II",
    code: "NIMT-SAV",
    type: "school" as const,
    courses: ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8", "Class 9", "Class 10", "Class 11", "Class 12"],
  },
  {
    campus: "NIMT School Arthala",
    code: "NIMT-SAR",
    type: "school" as const,
    courses: ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7", "Class 8"],
  },
  {
    campus: "Campus School (B.Ed / D.El.Ed)",
    code: "CSDE",
    type: "college" as const,
    courses: ["B.Ed", "D.El.Ed"],
  },
  {
    campus: "Mirai Experiential School",
    code: "MR",
    type: "school" as const,
    courses: ["IB PYP", "IB MYP", "IB DP"],
  },
];

const ApplyPortal = () => {
  const [step, setStep] = useState(1);
  const [selectedCampus, setSelectedCampus] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const campus = campusCourses.find(c => c.campus === selectedCampus);

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full border-border/60 shadow-none">
          <CardContent className="p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-pastel-green mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Application Submitted!</h2>
            <p className="text-sm text-muted-foreground mt-2">Your Application ID is:</p>
            <p className="text-lg font-mono font-bold text-primary mt-1">APP-26-{String(Math.floor(Math.random() * 9000) + 1000)}</p>
            <p className="text-xs text-muted-foreground mt-4">
              You'll receive an OTP on your phone to track your application status. Our AI will call you shortly for an introductory conversation.
            </p>
            <Button className="mt-6 w-full" onClick={() => { setSubmitted(false); setStep(1); setSelectedCampus(null); setSelectedCourse(null); }}>
              Submit Another Application
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-sm">
            <GraduationCap className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <span className="text-sm font-bold text-foreground tracking-tight">NIMT UniOs</span>
            <span className="text-[11px] text-muted-foreground block">Apply for Admission</span>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* ── Progress ── */}
        <div className="flex items-center gap-2 mb-8">
          {[
            { n: 1, label: "Select Course" },
            { n: 2, label: "Personal Details" },
            { n: 3, label: "Documents" },
          ].map((s, i) => (
            <div key={s.n} className="flex items-center gap-2 flex-1">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${step >= s.n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {step > s.n ? <CheckCircle className="h-4 w-4" /> : s.n}
              </div>
              <span className={`text-sm font-medium ${step >= s.n ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
              {i < 2 && <div className={`flex-1 h-0.5 rounded-full ${step > s.n ? "bg-primary" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        {/* ── Step 1: Course Selection ── */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">Select Your Course</h2>
              <p className="text-sm text-muted-foreground mt-1">Choose a campus and course to begin your application.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {campusCourses.map((c) => (
                <Card
                  key={c.campus}
                  className={`border-border/60 shadow-none cursor-pointer transition-all hover:shadow-sm ${selectedCampus === c.campus ? "ring-2 ring-primary border-primary" : ""}`}
                  onClick={() => { setSelectedCampus(c.campus); setSelectedCourse(null); }}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{c.campus}</h3>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">{c.code}</p>
                      </div>
                      <Badge className={`text-[10px] border-0 ${c.type === "school" ? "bg-pastel-blue text-foreground/70" : "bg-pastel-purple text-foreground/70"}`}>
                        {c.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{c.courses.length} courses available</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {selectedCampus && campus && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Available Courses at {selectedCampus}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {campus.courses.map((course) => (
                    <button
                      key={course}
                      onClick={() => setSelectedCourse(course)}
                      className={`rounded-xl border px-4 py-3 text-sm font-medium transition-all ${selectedCourse === course ? "border-primary bg-primary/10 text-primary" : "border-input bg-card text-foreground hover:bg-muted"}`}
                    >
                      {course}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button disabled={!selectedCourse} onClick={() => setStep(2)} className="gap-2">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Personal Details ── */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">Personal Details</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Applying for <span className="font-semibold text-primary">{selectedCourse}</span> at <span className="font-semibold">{selectedCampus}</span>
              </p>
            </div>

            <Card className="border-border/60 shadow-none">
              <CardContent className="p-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: "Full Name", icon: User, placeholder: "Enter full name", required: true },
                    { label: "Phone Number", icon: Phone, placeholder: "+91 98765 43210", required: true },
                    { label: "Email Address", icon: Mail, placeholder: "student@email.com" },
                    { label: "Date of Birth", icon: Calendar, placeholder: "DD/MM/YYYY", type: "date" },
                    { label: "Father/Guardian Name", icon: User, placeholder: "Guardian name", required: true },
                    { label: "Guardian Phone", icon: Phone, placeholder: "+91 98765 43210", required: true },
                  ].map((field) => (
                    <div key={field.label}>
                      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                        {field.label} {field.required && <span className="text-destructive">*</span>}
                      </label>
                      <div className="relative">
                        <field.icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                          type={field.type || "text"}
                          placeholder={field.placeholder}
                          className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Address</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <textarea
                      placeholder="Full address"
                      rows={3}
                      className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 resize-none"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(3)} className="gap-2">
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Documents ── */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">Upload Documents</h2>
              <p className="text-sm text-muted-foreground mt-1">Upload required documents to complete your application.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: "Passport Photo", desc: "Recent photo (JPG/PNG)" },
                { label: "Previous Marksheet", desc: "Last year's marksheet" },
                { label: "Aadhar Card", desc: "Front & back (PDF/JPG)" },
                { label: "Transfer Certificate", desc: "If applicable" },
              ].map((doc) => (
                <Card key={doc.label} className="border-border/60 border-dashed shadow-none">
                  <CardContent className="p-6 text-center">
                    <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <h4 className="text-sm font-semibold text-foreground">{doc.label}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{doc.desc}</p>
                    <Button variant="outline" size="sm" className="mt-3 text-xs">
                      Choose File
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setSubmitted(true)} className="gap-2">
                <FileText className="h-4 w-4" /> Submit Application
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApplyPortal;
