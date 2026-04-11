import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Download, Plus, Users, TrendingUp, IndianRupee, ArrowUpRight,
  CreditCard, Clock, Mic, Play, Square, Send, FileText, CheckCircle,
  Sparkles, ChevronRight, Building2, BookOpen, Loader2, MousePointer2,
  Eye, Phone, Mail, Calendar,
} from "lucide-react";

/**
 * Visual guide for consultants — rich in-app illustrated walkthrough.
 * Each section has an annotated mock UI showing real portal screens.
 * The "Download PDF" button captures the whole page with html2canvas and
 * exports a multi-page PDF.
 */
export default function ConsultantGuide() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const contentRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);

  const generatePdf = async () => {
    if (!contentRef.current) return;
    setGenerating(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import("jspdf"),
        import("html2canvas"),
      ]);

      const sections = contentRef.current.querySelectorAll<HTMLElement>("[data-guide-section]");
      if (sections.length === 0) {
        toast({ title: "Nothing to export", variant: "destructive" });
        setGenerating(false);
        return;
      }

      const pdf = new jsPDF("p", "mm", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;

      // Cover page
      pdf.setFillColor(99, 102, 241);
      pdf.rect(0, 0, pageW, 50, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(24);
      pdf.setTextColor(255, 255, 255);
      pdf.text("NIMT Consultant Guide", margin, 30);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");
      pdf.text("Visual walkthrough of your consultant portal", margin, 40);

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const canvas = await html2canvas(section, {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
        });
        const imgData = canvas.toDataURL("image/png");

        // Calculate dimensions to fit the page
        const availableW = pageW - margin * 2;
        const imgRatio = canvas.width / canvas.height;
        let imgW = availableW;
        let imgH = imgW / imgRatio;

        // If the image is too tall for one page, scale down to fit
        const availableH = pageH - margin * 2 - (i === 0 ? 60 : 10);
        if (imgH > availableH) {
          imgH = availableH;
          imgW = imgH * imgRatio;
        }

        const yStart = i === 0 ? 60 : margin;
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", (pageW - imgW) / 2, yStart, imgW, imgH);
      }

      // Footer on all pages
      const totalPages = pdf.getNumberOfPages();
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      for (let p = 1; p <= totalPages; p++) {
        pdf.setPage(p);
        pdf.text(
          `NIMT Consultant Guide  ·  Page ${p} of ${totalPages}  ·  uni.nimt.ac.in`,
          margin,
          pageH - 5
        );
      }

      pdf.save("NIMT-Consultant-Guide.pdf");
      toast({ title: "Guide downloaded", description: "PDF saved with visual walkthrough" });
    } catch (e: any) {
      toast({ title: "PDF failed", description: e.message, variant: "destructive" });
    }
    setGenerating(false);
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <h1 className="text-2xl font-bold text-foreground">Consultant Portal Guide</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visual walkthrough of every feature. Scroll through the sections or download as PDF.
          </p>
        </div>
        <Button onClick={generatePdf} disabled={generating} className="gap-2">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download as PDF
        </Button>
      </div>

      {/* Content */}
      <div ref={contentRef} className="space-y-6 bg-background">
        {/* ── Intro ── */}
        <Section number={1} title="Welcome to the NIMT Consultant Portal" icon={Sparkles}>
          <p className="text-sm text-foreground/80 leading-relaxed mb-4">
            As an NIMT consultant you play a critical role in helping students find the right programme at our institutions.
            This portal gives you everything you need in one place: add leads, track their journey, earn commission,
            and stay in touch with our admission team.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Users, label: "Add & manage leads", color: "bg-blue-100 text-blue-700" },
              { icon: TrendingUp, label: "Track admissions", color: "bg-green-100 text-green-700" },
              { icon: IndianRupee, label: "Earn commission", color: "bg-purple-100 text-purple-700" },
              { icon: Mic, label: "Voice-chat admin", color: "bg-orange-100 text-orange-700" },
            ].map((f, i) => (
              <div key={i} className="flex flex-col items-center text-center p-3 rounded-xl border border-border/60">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl mb-2 ${f.color}`}>
                  <f.icon className="h-5 w-5" />
                </div>
                <p className="text-xs font-medium text-foreground">{f.label}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ── 2. Dashboard Stats ── */}
        <Section number={2} title="Understanding Your Dashboard" icon={TrendingUp}>
          <p className="text-sm text-foreground/80 leading-relaxed mb-4">
            Your dashboard opens with 6 key stats that show your performance at a glance. Here's what each one means:
          </p>
          <MockStatsCards />
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <Annotation label="Total Leads" body="Every student you've added to the portal." />
            <Annotation label="Pipeline" body="Students still in progress — not yet admitted or dropped." />
            <Annotation label="Conversions" body="Students who successfully got admitted." />
            <Annotation label="Fee Collected" body="Total fees paid by your admitted students so far." />
            <Annotation label="Commission Earned" body="Your total commission based on fees collected." />
            <Annotation label="Pending Payout" body="Commission amount not yet paid to you." />
          </div>
        </Section>

        {/* ── 3. Adding a Lead ── */}
        <Section number={3} title="Adding a New Lead" icon={Plus}>
          <p className="text-sm text-foreground/80 leading-relaxed mb-4">
            Click the <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium">
              <Plus className="h-2.5 w-2.5" /> Add Lead
            </span> button in the top right. A form opens where you enter the student's details:
          </p>
          <MockAddLeadForm />
          <div className="mt-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200/50">
            <p className="text-xs text-blue-900 dark:text-blue-200">
              <strong>Tip:</strong> Name, phone and course are mandatory. Email helps our team reach the student.
              Once submitted, the lead enters your pipeline and we'll get an instant notification.
            </p>
          </div>
        </Section>

        {/* ── 4. Lead Pipeline ── */}
        <Section number={4} title="Lead Pipeline Stages" icon={ChevronRight}>
          <p className="text-sm text-foreground/80 leading-relaxed mb-4">
            Every lead moves through these stages as they progress toward admission. You can always see the current stage
            in the Leads tab:
          </p>
          <MockPipeline />
          <p className="text-xs text-muted-foreground mt-3">
            Your commission becomes payable once the lead reaches <strong>Admitted</strong> and starts paying fees.
          </p>
        </Section>

        {/* ── 5. Courses & Fees ── */}
        <Section number={5} title="Courses & Fee Structures" icon={BookOpen}>
          <p className="text-sm text-foreground/80 leading-relaxed mb-4">
            Need to share fee details with a student? Click <strong>"Info"</strong> next to any lead or use the
            Courses & Fees section to browse detailed fee structures for every programme:
          </p>
          <MockCoursesFees />
          <ul className="mt-3 text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li><strong>School courses</strong> (Beacon, Mirai) have Day Scholar / Day Boarder / Boarder toggles</li>
            <li><strong>Boarding fees</strong> show 3 options: Non-AC, AC C Block, AC B Block</li>
            <li><strong>Transport fees</strong> have 3 zones based on distance</li>
            <li><strong>College courses</strong> show year-wise breakdowns with discount options</li>
          </ul>
        </Section>

        {/* ── 6. Voice Messages ── */}
        <Section number={6} title="Voice Messages to Admission Team" icon={Mic}>
          <p className="text-sm text-foreground/80 leading-relaxed mb-4">
            Have a quick question? Record a voice note and send it directly to the NIMT admission team.
            They'll hear it instantly and respond.
          </p>
          <MockVoiceRecorder />
          <div className="mt-4 grid grid-cols-3 gap-3">
            <StepCard step={1} label="Click Record" icon={Mic} />
            <StepCard step={2} label="Speak" icon={MousePointer2} />
            <StepCard step={3} label="Send" icon={Send} />
          </div>
        </Section>

        {/* ── 7. Commissions ── */}
        <Section number={7} title="Commission & Payouts" icon={IndianRupee}>
          <p className="text-sm text-foreground/80 leading-relaxed mb-4">
            The Commissions tab shows all your earnings, payouts, and their status.
            Commission is calculated as a percentage of fees paid by your admitted students.
          </p>
          <MockCommissionTable />
          <div className="mt-4 flex items-center gap-4 flex-wrap text-xs">
            <StatusLegend color="bg-amber-100 text-amber-700" label="Pending — awaiting review" />
            <StatusLegend color="bg-blue-100 text-blue-700" label="Approved — scheduled for payout" />
            <StatusLegend color="bg-emerald-100 text-emerald-700" label="Paid — money transferred" />
          </div>
        </Section>

        {/* ── 8. Support ── */}
        <Section number={8} title="Need Help?" icon={CheckCircle}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <HelpCard icon={Mic} title="Voice message" body="Fastest — dashboard recorder" />
            <HelpCard icon={Mail} title="Email" body="admissions@nimt.ac.in" />
            <HelpCard icon={Phone} title="Phone" body="Your NIMT representative" />
          </div>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Thank you for partnering with NIMT Educational Institutions 🎓
          </p>
        </Section>
      </div>
    </div>
  );
}

/* ── Reusable visual components ──────────────────────────── */

function Section({
  number, title, icon: Icon, children,
}: { number: number; title: string; icon: any; children: React.ReactNode }) {
  return (
    <Card data-guide-section className="border-border/60 shadow-none">
      <CardContent className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Chapter {number}
            </p>
            <h2 className="text-lg font-bold text-foreground">{title}</h2>
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Annotation({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex gap-2 p-2 rounded-lg bg-muted/40">
      <div className="h-5 w-5 shrink-0 flex items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">•</div>
      <div>
        <p className="font-semibold text-foreground">{label}</p>
        <p className="text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function StepCard({ step, label, icon: Icon }: { step: number; label: string; icon: any }) {
  return (
    <div className="flex flex-col items-center text-center p-3 rounded-xl border border-border/60 bg-muted/20">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold mb-1">
        {step}
      </div>
      <Icon className="h-4 w-4 text-foreground mb-1" />
      <p className="text-[11px] font-medium text-foreground">{label}</p>
    </div>
  );
}

function StatusLegend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Badge className={`text-[9px] border-0 ${color}`}>status</Badge>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function HelpCard({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center text-center p-4 rounded-xl border border-border/60 bg-muted/20">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary mb-2">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{body}</p>
    </div>
  );
}

/* ── Mock UI illustrations (look like the real portal) ──── */

function MockStatsCards() {
  const stats = [
    { label: "Total Leads", value: "24", icon: Users, bg: "bg-pastel-blue" },
    { label: "Pipeline", value: "17", icon: ArrowUpRight, bg: "bg-pastel-orange" },
    { label: "Conversions", value: "7", icon: TrendingUp, bg: "bg-pastel-green" },
    { label: "Fee Collected", value: "₹3.4L", icon: CreditCard, bg: "bg-pastel-mint" },
    { label: "Commission", value: "₹34k", icon: IndianRupee, bg: "bg-pastel-purple" },
    { label: "Pending Payout", value: "₹12k", icon: Clock, bg: "bg-pastel-yellow" },
  ];
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-3 bg-muted/10">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg border border-border/60 bg-card p-2.5">
            <div className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${s.bg} mb-1`}>
              <s.icon className="h-3.5 w-3.5 text-foreground/70" />
            </div>
            <p className="text-sm font-bold text-foreground">{s.value}</p>
            <p className="text-[9px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground italic text-center mt-2">↑ Example of your dashboard stats</p>
    </div>
  );
}

function MockAddLeadForm() {
  const inp = "w-full rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs text-muted-foreground";
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-4 bg-muted/10">
      <div className="max-w-sm mx-auto rounded-xl border border-border bg-card shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Plus className="h-4 w-4" />
          </div>
          <p className="text-sm font-bold text-foreground">Add New Lead</p>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Student Name *</label>
          <div className={inp}>Rohan Kumar</div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Phone *</label>
          <div className={inp}>+91 98765 43210</div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Course *</label>
          <div className={inp}>B.Sc Nursing</div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Campus</label>
          <div className={inp}>NIMT Greater Noida</div>
        </div>
        <div className="pt-1">
          <div className="w-full rounded-lg bg-primary text-primary-foreground text-[11px] py-1.5 text-center font-medium">
            Save Lead
          </div>
        </div>
      </div>
    </div>
  );
}

function MockPipeline() {
  const stages = [
    { label: "New Lead", color: "bg-gray-100 text-gray-700" },
    { label: "App in Progress", color: "bg-amber-100 text-amber-700" },
    { label: "Submitted", color: "bg-blue-100 text-blue-700" },
    { label: "Counsellor Call", color: "bg-purple-100 text-purple-700" },
    { label: "Visit Scheduled", color: "bg-violet-100 text-violet-700" },
    { label: "Interview", color: "bg-indigo-100 text-indigo-700" },
    { label: "Offer Sent", color: "bg-teal-100 text-teal-700" },
    { label: "Token Paid", color: "bg-cyan-100 text-cyan-700" },
    { label: "Admitted", color: "bg-emerald-100 text-emerald-700" },
  ];
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-3 bg-muted/10 overflow-x-auto">
      <div className="flex items-center gap-1.5 min-w-max">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${s.color}`}>{s.label}</div>
            {i < stages.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function MockCoursesFees() {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-4 bg-muted/10">
      <div className="max-w-md mx-auto rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2 border-b border-border/60 pb-2 mb-2">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">NIMT Beacon School Avantika II</span>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          <span className="px-2 py-0.5 rounded-md bg-primary text-primary-foreground font-medium">Day Scholar</span>
          <span className="px-2 py-0.5 rounded-md border border-border">Day Boarder</span>
          <span className="px-2 py-0.5 rounded-md border border-border">Boarder</span>
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex justify-between py-1 border-b border-border/30">
            <span className="text-muted-foreground">One-Time Fees</span>
            <span className="font-semibold">₹20,500</span>
          </div>
          <div className="flex justify-between py-1 border-b border-border/30">
            <span className="text-muted-foreground">Tuition Fee</span>
            <span className="font-semibold">₹56,004</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground font-medium text-primary">Total</span>
            <span className="font-bold text-primary">₹76,504</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] pt-1">
          <span className="text-muted-foreground">Transport:</span>
          <span className="px-1.5 py-0.5 rounded border border-border">Zone 1 · ₹5,400/q</span>
          <span className="px-1.5 py-0.5 rounded border border-border">Zone 2 · ₹7,500/q</span>
          <span className="px-1.5 py-0.5 rounded border border-border">Zone 3 · ₹10,500/q</span>
        </div>
      </div>
    </div>
  );
}

function MockVoiceRecorder() {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-4 bg-muted/10">
      <div className="max-w-sm mx-auto rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Send Voice Message</p>
        </div>
        <div className="flex flex-col items-center justify-center py-4 rounded-xl border-2 border-dashed border-border/60">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 relative">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            <div className="absolute inset-0 rounded-full border-2 border-red-400/50 animate-ping" />
          </div>
          <p className="text-xs font-mono mt-2 text-foreground">0:07</p>
          <div className="mt-2 flex items-center gap-1 px-2.5 py-1 rounded-md bg-destructive text-destructive-foreground text-[10px] font-medium">
            <Square className="h-2.5 w-2.5" /> Stop Recording
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground italic text-center">Recording → Review → Send</div>
      </div>
    </div>
  );
}

function MockCommissionTable() {
  const rows = [
    { lead: "Rohan Kumar", course: "B.Sc Nursing", amount: "₹8,000", status: "paid", color: "bg-emerald-100 text-emerald-700" },
    { lead: "Priya Singh", course: "GNM", amount: "₹6,500", status: "approved", color: "bg-blue-100 text-blue-700" },
    { lead: "Amit Sharma", course: "DPT", amount: "₹5,200", status: "pending", color: "bg-amber-100 text-amber-700" },
  ];
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-3 bg-muted/10">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Lead</th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Course</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-muted-foreground">Amount</th>
              <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="px-3 py-2 font-medium">{r.lead}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.course}</td>
                <td className="px-3 py-2 text-right font-semibold">{r.amount}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${r.color}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
