import { useState, useRef, useEffect } from "react";
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

function DocCard({ doc, uploading, uploaded, uploadedUrl, onUpload, disabled }: {
  doc: DocSpec;
  uploading: string | null;
  uploaded: Record<string, boolean>;
  uploadedUrl?: string;
  onUpload: (key: string, file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isUploading = uploading === doc.key;
  const isUploaded = uploaded[doc.key];

  return (
    <Card className={`border-border/60 shadow-none ${isUploaded ? 'border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/10' : doc.required ? '' : 'border-dashed'}`}>
      <CardContent className="p-4 text-center">
        {isUploaded ? (
          <CheckCircle className="h-5 w-5 text-emerald-600 mx-auto mb-1.5" />
        ) : isUploading ? (
          <Loader2 className="h-5 w-5 text-muted-foreground animate-spin mx-auto mb-1.5" />
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground/40 mx-auto mb-1.5" />
        )}
        <h4 className="text-sm font-semibold text-foreground">
          {doc.label} {doc.required && <span className="text-destructive">*</span>}
        </h4>
        <p className="text-[10px] text-muted-foreground mt-0.5">{isUploaded ? "Uploaded successfully" : doc.desc}</p>
        <div className="flex items-center justify-center gap-2 mt-2">
          {isUploaded && uploadedUrl && (
            <a href={uploadedUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline">
              <FileText className="h-3 w-3" /> View
            </a>
          )}
          <Button
            variant={isUploaded ? "ghost" : "outline"}
            size="sm"
            type="button"
            className={`text-xs ${isUploaded ? "text-muted-foreground" : ""}`}
            disabled={isUploading || disabled}
            onClick={() => inputRef.current?.click()}
          >
            {isUploading ? "Uploading..." : isUploaded ? 'Re-upload' : 'Choose File'}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onUpload(doc.key, file);
            e.target.value = '';
          }}
        />
      </CardContent>
    </Card>
  );
}

export function DocumentUpload({ data, onChange, onNext, onBack, saving, readOnly }: Props) {
  const { toast } = useToast();
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({});
  const [uploadedUrls, setUploadedUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const docs = getRequiredDocs(
    data.program_category,
    data.academic_details as Record<string, any>,
    data.course_selections
  );

  // Check for existing uploads on mount
  useEffect(() => {
    if (!data.application_id) return;
    (async () => {
      const { data: files } = await supabase.storage.from('application-documents').list(data.application_id, { limit: 50 });
      if (files?.length) {
        const found: Record<string, boolean> = {};
        const urls: Record<string, string> = {};
        for (const f of files) {
          if (!f.name || f.name.startsWith('.')) continue;
          // Extract doc key from filename: "class_10_marksheet-filename.pdf" → "class_10_marksheet"
          const dashIdx = f.name.indexOf('-');
          const key = dashIdx > 0 ? f.name.substring(0, dashIdx) : f.name;
          found[key] = true;
          const { data: urlData } = supabase.storage.from('application-documents').getPublicUrl(`${data.application_id}/${f.name}`);
          urls[key] = urlData.publicUrl;
        }
        setUploaded(prev => ({ ...prev, ...found }));
        setUploadedUrls(prev => ({ ...prev, ...urls }));
      }
    })();
  }, [data.application_id]);

  const handleUpload = async (docKey: string, file: File) => {
    setUploading(docKey);
    // Sanitize filename: replace spaces and special chars with underscores
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${data.application_id}/${docKey}-${safeName}`;
    const { error } = await supabase.storage.from('application-documents').upload(path, file, { upsert: true });

    if (error) {
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
    } else {
      setUploaded(prev => ({ ...prev, [docKey]: true }));
      const { data: urlData } = supabase.storage.from('application-documents').getPublicUrl(path);
      setUploadedUrls(prev => ({ ...prev, [docKey]: urlData.publicUrl }));
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
          <DocCard
            key={doc.key}
            doc={doc}
            uploading={uploading}
            uploaded={uploaded}
            uploadedUrl={uploadedUrls[doc.key]}
            onUpload={handleUpload}
            disabled={readOnly}
          />
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
