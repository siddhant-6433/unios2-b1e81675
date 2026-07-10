import { useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, Users, FileText, Phone, IndianRupee, BarChart3, Shield, Smartphone, ChevronLeft, ChevronRight } from "lucide-react";
import uniosLogo from "@/assets/unios-logo.png";
import nimtLogo from "@/assets/nimt-edu-inst-logo.svg";
import screenshotDashboard from "@/assets/about/dashboard.jpg";
import screenshotAdmissions from "@/assets/about/admissions.jpg";
import screenshotStudents from "@/assets/about/students.jpg";
import screenshotFinance from "@/assets/about/finance.jpg";

const screenshots = [
  { src: screenshotDashboard, label: "Dashboard — real-time overview of leads, applications, and admissions funnel" },
  { src: screenshotAdmissions, label: "Admissions CRM — lead pipeline, visit tracking, and counsellor action center" },
  { src: screenshotStudents, label: "Student Records — search, filter, and manage student profiles across campuses" },
  { src: screenshotFinance, label: "Finance Engine — fee ledger, payment tracking, and financial reporting" },
];

const modules = [
  {
    icon: Users,
    title: "Admissions & CRM",
    description: "End-to-end lead management — from first enquiry to enrolled student. WhatsApp-integrated counsellor tools, automated lead assignment, campus visit tracking, and a self-service applicant portal.",
  },
  {
    icon: FileText,
    title: "Application Processing",
    description: "Online applications with document upload, merit-based and management-quota workflows, offer letters, fee-link generation, and real-time status tracking for applicants and parents.",
  },
  {
    icon: GraduationCap,
    title: "Student Lifecycle",
    description: "Student profiles, attendance, academic records, ID cards, and alumni verification — covering the full journey from admission to alumni.",
  },
  {
    icon: IndianRupee,
    title: "Finance & Fees",
    description: "Fee structure management, online payment collection via Razorpay, instalment tracking, consultant commission management, and financial reporting across campuses.",
  },
  {
    icon: Phone,
    title: "Communication Hub",
    description: "Cloud dialer for counsellor calls, WhatsApp messaging with template management, automated OTP login, and a notification system that reaches students, parents, and staff.",
  },
  {
    icon: BarChart3,
    title: "Analytics & Reporting",
    description: "Admission funnels, counsellor performance dashboards, campus-wise comparisons, and custom reports — all in real time.",
  },
  {
    icon: Shield,
    title: "Role-Based Access",
    description: "Granular permissions for administrators, admission heads, counsellors, finance staff, students, parents, and academic partners — each seeing only what they need.",
  },
  {
    icon: Smartphone,
    title: "Mobile App",
    description: "A native mobile app for students and parents with push notifications, attendance, fee status, and document access on the go.",
  },
];

const stats = [
  { value: "3", label: "Campuses managed" },
  { value: "7+", label: "User roles supported" },
  { value: "20+", label: "Integrated modules" },
  { value: "24/7", label: "Self-service access" },
];

function ScreenshotGallery() {
  const [idx, setIdx] = useState(0);
  const prev = () => setIdx((i) => (i - 1 + screenshots.length) % screenshots.length);
  const next = () => setIdx((i) => (i + 1) % screenshots.length);

  return (
    <section className="py-16 px-6 bg-muted/30 border-y border-border">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-foreground text-center mb-3">See it in action</h2>
        <p className="text-sm text-muted-foreground text-center mb-8">
          Real screenshots from the platform. Personal information has been blurred for privacy.
        </p>
        <div className="relative">
          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-lg">
            <img
              src={screenshots[idx].src}
              alt={screenshots[idx].label}
              className="w-full h-auto"
            />
          </div>
          <button
            onClick={prev}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-background/90 border border-border p-2 shadow-md hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-5 w-5 text-foreground" />
          </button>
          <button
            onClick={next}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-background/90 border border-border p-2 shadow-md hover:bg-muted transition-colors"
          >
            <ChevronRight className="h-5 w-5 text-foreground" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-4">{screenshots[idx].label}</p>
        <div className="flex justify-center gap-2 mt-3">
          {screenshots.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`h-2 w-2 rounded-full transition-colors ${i === idx ? "bg-primary" : "bg-border"}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function About() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={uniosLogo} alt="UniOs" width="32" height="32" className="h-8 w-8 object-contain" />
            <span className="text-lg font-bold text-foreground">NIMT UniOs</span>
          </div>
          <Link
            to="/login"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-primary text-primary-foreground py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <img src={nimtLogo} alt="NIMT" width="80" height="40" className="h-10 w-auto mx-auto mb-6 brightness-0 invert opacity-80" />
          <h1 className="text-4xl font-bold mb-4">UniOs — University Operating System</h1>
          <p className="text-lg text-primary-foreground/80 max-w-2xl mx-auto leading-relaxed">
            A multi-campus education management platform built for NIMT Group of Institutions.
            UniOs brings admissions, student lifecycle, finance, communication, and analytics
            into a single unified system.
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-border py-12 px-6">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-3xl font-bold text-primary">{s.value}</div>
              <div className="text-sm text-muted-foreground mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Product Screenshots */}
      <ScreenshotGallery />

      {/* Modules */}
      <section className="py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-foreground text-center mb-3">What UniOs covers</h2>
          <p className="text-sm text-muted-foreground text-center mb-12 max-w-xl mx-auto">
            Every module works together — a lead that converts into an applicant flows seamlessly
            into student records, fee collection, and parent communication.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {modules.map((m) => (
              <div key={m.title} className="rounded-xl border border-border bg-card p-5">
                <m.icon className="h-6 w-6 text-primary mb-3" />
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{m.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{m.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 px-6 bg-muted/30 border-y border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-foreground text-center mb-10">How teams use UniOs</h2>
          <div className="space-y-6">
            {[
              { role: "Counsellors", desc: "Manage leads via WhatsApp and cloud dialer, track follow-ups, schedule campus visits, and convert enquiries into applications — all from one dashboard." },
              { role: "Admission Heads", desc: "Monitor counsellor performance, review applications, approve offers, allocate leads across teams, and track campus-wise admission funnels." },
              { role: "Finance Team", desc: "Generate payment links, track fee instalments, manage consultant commissions, and reconcile collections across campuses." },
              { role: "Students & Parents", desc: "Apply online, upload documents, track application status, view attendance, pay fees, and receive updates via WhatsApp and push notifications." },
              { role: "Administrators", desc: "Configure campuses, manage user access, set up automation rules, and access cross-campus analytics and reports." },
            ].map((item) => (
              <div key={item.role} className="flex gap-4">
                <div className="w-36 shrink-0 text-right">
                  <span className="text-sm font-semibold text-foreground">{item.role}</span>
                </div>
                <div className="border-l-2 border-primary/20 pl-4">
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6 text-center">
        <h2 className="text-xl font-bold text-foreground mb-3">Ready to get started?</h2>
        <p className="text-sm text-muted-foreground mb-6">Sign in to access your UniOs dashboard.</p>
        <Link
          to="/login"
          className="inline-flex rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Sign in to UniOs
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} NIMT Group of Institutions. All rights reserved.</span>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
            <Link to="/login" className="hover:text-foreground transition-colors">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
