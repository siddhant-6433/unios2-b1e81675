import { useState } from "react";
import { GraduationCap, CheckCircle, Send, User, Phone, Mail, BookOpen, MapPin, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PhoneInput, formatFullPhone, parsePhone } from "@/components/ui/phone-input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const CAMPUS_OPTIONS = [
  "NIMT Greater Noida",
  "NIMT Kotputli",
  "NIMT School Avantika II",
  "NIMT School Arthala",
  "Campus School (B.Ed / D.El.Ed)",
  "Mirai Experiential School",
];

const EnquiryForm = () => {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    guardian_name: "",
    guardian_phone: "",
    course: "",
    campus: "",
    message: "",
  });

  const update = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) {
      toast({ title: "Missing fields", description: "Name and phone are required.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("lead-ingest", {
        body: {
          source: "website",
          name: form.name.trim(),
          phone: form.phone,
          email: form.email.trim() || undefined,
          guardian_name: form.guardian_name.trim() || undefined,
          guardian_phone: form.guardian_phone || undefined,
          course: form.course.trim() || undefined,
          campus: form.campus || undefined,
          message: form.message.trim() || undefined,
        },
        headers: {
          "x-api-key": import.meta.env.VITE_LEAD_INGEST_KEY || "",
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
                setForm({ name: "", phone: "", email: "", guardian_name: "", guardian_phone: "", course: "", campus: "", message: "" });
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

              {/* Guardian */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Guardian Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      value={form.guardian_name}
                      onChange={(e) => update("guardian_name", e.target.value)}
                      placeholder="Father / guardian name"
                      className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Guardian Phone</label>
                  <PhoneInput value={form.guardian_phone} onChange={(v) => update("guardian_phone", v)} />
                </div>
              </div>

              {/* Campus & Course */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Campus</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <select
                      value={form.campus}
                      onChange={(e) => update("campus", e.target.value)}
                      className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 appearance-none"
                    >
                      <option value="">Select campus</option>
                      {CAMPUS_OPTIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Course / Class</label>
                  <div className="relative">
                    <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      value={form.course}
                      onChange={(e) => update("course", e.target.value)}
                      placeholder="e.g. B.Tech CSE, Class 10"
                      className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </div>
                </div>
              </div>

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
