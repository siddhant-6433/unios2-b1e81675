import { useState, useRef, useCallback } from "react";
import { ArrowLeft, Loader2, Send, CheckCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ApplicationData } from "./types";
import nimtLogo from "@/assets/nimt-beacon-logo.png";

interface Props {
  data: ApplicationData;
  onBack: () => void;
  onSubmit: () => Promise<void>;
  saving: boolean;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="bg-muted/50 rounded-xl p-4 text-sm space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}

export function ReviewSubmit({ data, onBack, onSubmit, saving }: Props) {
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [generating, setGenerating] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const addr = data.address || {};
  const academic = data.academic_details || {};

  const handleSubmit = async () => {
    await onSubmit();
    setSubmitted(true);
  };

  const downloadPDF = useCallback(async () => {
    setGenerating(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);

      if (!printRef.current) return;
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      let heightLeft = pdfHeight;
      let position = 0;
      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pdf.internal.pageSize.getHeight();

      while (heightLeft > 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pdf.internal.pageSize.getHeight();
      }

      pdf.save(`${data.application_id}-application.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
    } finally {
      setGenerating(false);
    }
  }, [data.application_id]);

  const entranceExams = (academic as any).entrance_exams || [];

  return (
    <div className="space-y-6">
      {submitted && (
        <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-6 w-6 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Application Submitted!</p>
              <p className="text-xs text-muted-foreground">ID: {data.application_id}</p>
            </div>
          </div>
          <Button onClick={downloadPDF} disabled={generating} variant="outline" size="sm" className="gap-2">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download PDF
          </Button>
        </div>
      )}

      {/* Printable content for PDF */}
      <div ref={printRef} className={submitted ? 'bg-white p-6 rounded-xl' : ''}>
        {submitted && (
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-border">
            <img src={nimtLogo} alt="Logo" className="h-12" />
            <div className="text-right">
              <p className="text-sm font-bold text-foreground">Application Form</p>
              <p className="text-xs text-muted-foreground">ID: {data.application_id}</p>
              <p className="text-xs text-muted-foreground">
                Submitted: {data.submitted_at ? new Date(data.submitted_at).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN')}
              </p>
            </div>
          </div>
        )}

        <h2 className="text-lg font-semibold text-foreground mb-4">Review & Submit</h2>

        <div className="space-y-4">
          <Section title="Courses Selected">
            {data.course_selections.map((cs, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-muted-foreground">Preference {cs.preference_order}</span>
                <span className="text-foreground font-medium">{cs.course_name} — {cs.campus_name}</span>
              </div>
            ))}
          </Section>

          <Section title="Personal Details">
            <Row label="Name" value={data.full_name} />
            <Row label="Gender" value={data.gender} />
            <Row label="Date of Birth" value={data.dob} />
            <Row label="Phone" value={data.phone} />
            <Row label="Email" value={data.email} />
            <Row label="Nationality" value={data.nationality} />
            <Row label="Category" value={data.category} />
            <Row label="Address" value={[addr.line1, addr.city, addr.state, addr.pin_code].filter(Boolean).join(', ')} />
          </Section>

          <Section title="Parent Details">
            <Row label="Father" value={data.father?.name} />
            <Row label="Mother" value={data.mother?.name} />
            {data.guardian?.name && <Row label="Guardian" value={data.guardian.name} />}
          </Section>

          <Section title="Academic Details">
            {(academic as any).class_10?.board && <Row label="Class 10 Board" value={(academic as any).class_10.board} />}
            {(academic as any).class_10?.year && <Row label="Class 10 Year" value={(academic as any).class_10.year} />}
            {(academic as any).class_10?.marks && <Row label="Class 10 Marks" value={(academic as any).class_10.marks} />}
            {(academic as any).class_12?.board && <Row label="Class 12 Board" value={(academic as any).class_12.board} />}
            {(academic as any).class_12?.year && <Row label="Class 12 Year" value={(academic as any).class_12.year} />}
            {(academic as any).class_12?.marks && <Row label="Class 12 Marks" value={(academic as any).class_12.marks} />}
            {(academic as any).class_12?.subjects && <Row label="Class 12 Subjects" value={(academic as any).class_12.subjects} />}
            {(academic as any).graduation?.degree && <Row label="Graduation" value={`${(academic as any).graduation.degree} — ${(academic as any).graduation.university || ''}`} />}
            {(academic as any).graduation?.marks && <Row label="Graduation Marks" value={(academic as any).graduation.marks} />}
          </Section>

          {entranceExams.length > 0 && (
            <Section title="Entrance Exams">
              {entranceExams.map((ex: any, i: number) => (
                <div key={i}>
                  <Row label={ex.exam_name} value={
                    ex.status === 'declared' ? `Score: ${ex.score || 'N/A'}`
                    : ex.status === 'not_declared' ? `Result pending${ex.expected_date ? ` (Expected: ${ex.expected_date})` : ''}`
                    : 'Yet to appear'
                  } />
                </div>
              ))}
            </Section>
          )}

          <Section title="Payment">
            <Row label="Fee Amount" value={`₹${data.fee_amount.toLocaleString('en-IN')}`} />
            <Row label="Status" value={data.payment_status === 'paid' ? '✅ Paid' : data.fee_amount === 0 ? '✅ Waived' : '⏳ Pending'} />
          </Section>

          {data.flags.length > 0 && (
            <Section title="Application Flags">
              <div className="flex flex-wrap gap-2">
                {data.flags.map(f => (
                  <span key={f} className="text-xs px-2 py-1 rounded-full bg-warning/10 text-warning font-medium">
                    {f.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>

      {!submitted && (
        <>
          <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
            <Checkbox id="declaration" checked={agreed} onCheckedChange={v => setAgreed(v === true)} />
            <label htmlFor="declaration" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
              I hereby declare that all information provided in this application is true and correct to the best of my knowledge. 
              I understand that any false information may lead to cancellation of my admission.
            </label>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={onBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={handleSubmit} disabled={!agreed || saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit Application
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
