import { useState } from "react";
import { ArrowRight, ArrowLeft, Loader2, Upload, CheckCircle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ApplicationData } from "./types";
import { PhotoUpload } from "./PhotoUpload";

interface Props {
  data: ApplicationData;
  onChange: (data: Partial<ApplicationData>) => void;
  onNext: () => void;
  onBack?: () => void;
  saving: boolean;
  readOnly?: boolean;
}

interface DocSpec {
  key: string;
  label: string;
  desc: string;
  required: boolean;
}

function getRequiredDocs(
  category: string, 
  academicDetails?: Record<string, any>, 
  courseSelections?: { course_name: string }[]
): DocSpec[] {
  const c10Status = academicDetails?.class_10?.result_status;
  const c12Status = academicDetails?.class_12?.result_status;
  const gradStatus = academicDetails?.graduation?.result_status;

  if (category === 'school') {
    const courseNames = courseSelections?.map(s => s.course_name.toLowerCase()).join(' ') || '';
    const isAboveKG = /grade|class\s*[1-9]/i.test(courseNames);

    return [
      { key: 'birth_certificate', label: 'Birth Certificate', desc: 'PDF or image', required: true },
      { key: 'report_card', label: 'Previous Class Report Card', desc: 'Last year marksheet', required: isAboveKG },
      { key: 'student_photo', label: 'Student Photograph', desc: 'Passport size photo', required: true },
      { key: 'transfer_certificate', label: 'Transfer Certificate', desc: 'If applicable', required: false },
      { key: 'aadhaar', label: 'Aadhaar Card', desc: 'Front & back', required: false },
      { key: 'medical_record', label: 'Medical Record', desc: 'If applicable', required: false },
    ];
  }

  const base: DocSpec[] = [];

  // Class 10 marksheet — only if result declared
  if (c10Status !== 'not_declared') {
    base.push({ key: 'class_10_marksheet', label: 'Class 10 Marksheet', desc: 'PDF or image', required: true });
  }
  base.push({ key: 'class_10_certificate', label: '10th Pass Certificate', desc: 'Optional', required: false });

  // Class 12 marksheet — only if result declared
  if (c12Status !== 'not_declared') {
    base.push({ key: 'class_12_marksheet', label: 'Class 12 Marksheet', desc: 'PDF or image', required: true });
  }
  base.push({ key: 'class_12_certificate', label: '12th Pass Certificate', desc: 'Optional', required: false });

  if (['postgraduate', 'mba_pgdm', 'professional', 'bed', 'deled'].includes(category)) {
    // Graduation marksheet — only if result declared
    if (gradStatus !== 'not_declared') {
      base.push({ key: 'graduation_marksheet', label: 'Graduation Marksheet', desc: 'All semesters', required: true });
    }
    base.push({ key: 'graduation_certificate', label: 'Graduation Degree Certificate', desc: 'Optional', required: false });
  }

  // Optional graduation entered by UG applicants
  if (!['postgraduate', 'mba_pgdm', 'professional', 'bed', 'deled'].includes(category)) {
    const optGrad = academicDetails?.graduation;
    if (optGrad && (optGrad.degree || optGrad.university)) {
      if (optGrad.result_status !== 'not_declared') {
        base.push({ key: 'graduation_marksheet', label: 'Graduation Marksheet (Optional)', desc: 'If available', required: false });
      }
    }
  }

  // Additional qualifications marksheets
  const additionalQuals: any[] = academicDetails?.additional_qualifications || [];
  additionalQuals.forEach((q: any, idx: number) => {
    if (q && (q.degree || q.university) && q.result_status !== 'not_declared') {
      base.push({
        key: `additional_qual_${idx}_marksheet`,
        label: `${q.degree || `Qualification ${idx + 1}`} Marksheet`,
        desc: 'All semesters',
        required: false,
      });
    }
  });

  // Entrance exam scorecards
  const exams: any[] = academicDetails?.entrance_exams || [];
  exams.forEach((ex: any) => {
    if (ex && ex.status === 'declared' && ex.exam_name) {
      base.push({
        key: `entrance_${ex.exam_name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_scorecard`,
        label: `${ex.exam_name} Scorecard`,
        desc: 'Score/rank card',
        required: false,
      });
    }
  });

  return base;
}

export function DocumentUpload({ data, onChange, onNext, onBack, saving, readOnly }: Props) {
  const { toast } = useToast();
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const docs = getRequiredDocs(
    data.program_category, 
    data.academic_details as Record<string, any>,
    data.course_selections
  );

  const handleUpload = async (docKey: string, file: File) => {
    setUploading(docKey);
    const path = `${data.application_id}/${docKey}-${file.name}`;
    const { error } = await supabase.storage.from('application-documents').upload(path, file, { upsert: true });

    if (error) {
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
    } else {
      setUploaded(prev => ({ ...prev, [docKey]: true }));
      toast({ title: `${docKey.replace(/_/g, ' ')} uploaded` });
    }
    setUploading(null);
  };

  const requiredDocs = docs.filter(d => d.required);
  const allRequiredUploaded = requiredDocs.every(d => uploaded[d.key]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Upload Documents</h2>
        <p className="text-sm text-muted-foreground">Upload required documents. Accepted: PDF, JPG, PNG (max 5MB).</p>
      </div>

      <fieldset disabled={readOnly} className={readOnly ? "pointer-events-none opacity-75" : ""}>
      {/* Passport Photo */}
      {data.program_category !== 'school' && (
        <PhotoUpload
          applicationId={data.application_id}
          existingUrl={data.passport_photo_path ? undefined : undefined}
          onUploaded={(path) => onChange({ passport_photo_path: path })}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {docs.map(doc => (
          <Card key={doc.key} className={`border-border/60 shadow-none ${doc.required ? '' : 'border-dashed'}`}>
            <CardContent className="p-5 text-center">
              {uploaded[doc.key] ? (
                <CheckCircle className="h-6 w-6 text-primary mx-auto mb-2" />
              ) : uploading === doc.key ? (
                <Loader2 className="h-6 w-6 text-muted-foreground animate-spin mx-auto mb-2" />
              ) : (
                <FileText className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
              )}
              <h4 className="text-sm font-semibold text-foreground">
                {doc.label} {doc.required && <span className="text-destructive">*</span>}
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">{doc.desc}</p>
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" className="mt-3 text-xs pointer-events-none">
                  {uploaded[doc.key] ? 'Re-upload' : 'Choose File'}
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(doc.key, file);
                  }}
                />
              </label>
            </CardContent>
          </Card>
        ))}
      </div>
      </fieldset>

      <div className="flex justify-between">
        {onBack ? (
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : <div />}
        <Button onClick={onNext} disabled={!allRequiredUploaded && docs.some(d => d.required)} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Continue to Review
        </Button>
      </div>
    </div>
  );
}
