import { useState, useRef, useEffect } from "react";
import { ArrowRight, ArrowLeft, Loader2, Upload, CheckCircle, FileText, AlertCircle } from "lucide-react";
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
  nextLabel?: string;
  storageTarget?: "r2" | "supabase";
}

interface DocSpec {
  key: string;
  label: string;
  desc: string;
  required: boolean;
}

function getRequiredDocs(
  programCategory: string,
  academicDetails?: Record<string, any>,
  courseSelections?: { course_name: string }[],
  socialCategory?: string,
): DocSpec[] {
  const c10Status = academicDetails?.class_10?.result_status;
  const c12Status = academicDetails?.class_12?.result_status;
  const gradStatus = academicDetails?.graduation?.result_status;
  // Caste certificate is mandatory for reserved-category applicants
  // (SC/ST/OBC). EWS uses an income certificate which is out of scope here.
  const needsCasteCert = ['SC', 'ST', 'OBC'].includes((socialCategory || '').toUpperCase());

  if (programCategory === 'school') {
    const courseNames = courseSelections?.map(s => s.course_name.toLowerCase()).join(' ') || '';
    const isAboveKG = /grade|class\s*[1-9]/i.test(courseNames);

    return [
      { key: 'birth_certificate', label: 'Birth Certificate', desc: 'PDF or image', required: true },
      { key: 'report_card', label: 'Previous Class Report Card', desc: 'Last year marksheet', required: isAboveKG },
      { key: 'student_photo', label: 'Student Photograph', desc: 'Passport size photo', required: true },
      { key: 'transfer_certificate', label: 'Transfer Certificate', desc: 'If applicable', required: false },
      { key: 'aadhaar', label: 'Student Aadhaar Card', desc: 'JPEG / PNG / PDF', required: true },
      { key: 'parent_aadhaar', label: 'Parent / Guardian Aadhaar', desc: 'JPEG / PNG / PDF (optional)', required: false },
      { key: 'caste_certificate', label: 'Caste Certificate', desc: 'Mandatory for SC / ST / OBC', required: needsCasteCert },
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

  if (['postgraduate', 'mba_pgdm', 'professional', 'bed', 'deled'].includes(programCategory)) {
    // Graduation marksheet — only if result declared
    if (gradStatus !== 'not_declared') {
      base.push({ key: 'graduation_marksheet', label: 'Graduation Marksheet', desc: 'All semesters', required: true });
    }
    base.push({ key: 'graduation_certificate', label: 'Graduation Degree Certificate', desc: 'Optional', required: false });
  }

  // Optional graduation entered by UG applicants
  if (!['postgraduate', 'mba_pgdm', 'professional', 'bed', 'deled'].includes(programCategory)) {
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
    if (ex && ex.status === 'declared' && ex.exam_name && !/cahet/i.test(ex.exam_name)) {
      base.push({
        key: `entrance_${ex.exam_name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_scorecard`,
        label: `${ex.exam_name} Scorecard`,
        desc: 'Score/rank card',
        required: false,
      });
    }
  });

  // Identity + parent + caste — required across all higher-ed program
  // categories. Caste cert only kicks in for reserved categories.
  base.push({ key: 'aadhaar',           label: 'Student Aadhaar Card',     desc: 'JPEG / PNG / PDF',                  required: true });
  base.push({ key: 'parent_aadhaar',    label: 'Parent / Guardian Aadhaar', desc: 'JPEG / PNG / PDF (optional)',       required: false });
  base.push({ key: 'caste_certificate', label: 'Caste Certificate',         desc: 'Mandatory for SC / ST / OBC',       required: needsCasteCert });

  // Transfer / Migration Certificate — sourced from the most recent
  // institution. UG applicants get it from their Class 12 school
  // ("school TC/MC"); PG applicants get it from their graduation
  // college/university ("migration certificate"). Optional either way —
  // many applicants don't have it issued yet at application time.
  const isPG = ['postgraduate', 'mba_pgdm', 'bed'].includes(programCategory);
  if (isPG) {
    base.push({
      key:      'migration_certificate',
      label:    'Migration / Transfer Certificate',
      desc:     'From your graduation college / university (optional)',
      required: false,
    });
  } else {
    base.push({
      key:      'school_transfer_certificate',
      label:    'School Transfer / Migration Certificate',
      desc:     'From your Class 12 school (optional)',
      required: false,
    });
  }

  return base;
}

function DocCard({ doc, uploading, uploaded, uploadedUrl, onUpload, disabled, reviewStatus, reviewNotes, invalid }: {
  doc: DocSpec;
  uploading: string | null;
  uploaded: Record<string, boolean>;
  uploadedUrl?: string;
  onUpload: (key: string, file: File) => void;
  disabled?: boolean;
  reviewStatus?: string;
  reviewNotes?: string | null;
  invalid?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isUploading = uploading === doc.key;
  const isUploaded = uploaded[doc.key];

  const isRejected = reviewStatus === "rejected";

  return (
    <Card className={`border-border/60 shadow-none ${
      isRejected
        ? 'border-rose-300 bg-rose-50/40 dark:bg-rose-950/10'
        : invalid ? 'border-destructive ring-1 ring-destructive/30 bg-destructive/5'
        : isUploaded ? 'border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/10' : doc.required ? '' : 'border-dashed'
    }`}>
      <CardContent className="p-4 text-center">
        {isRejected ? (
          <AlertCircle className="h-5 w-5 text-rose-600 mx-auto mb-1.5" />
        ) : isUploaded ? (
          <CheckCircle className="h-5 w-5 text-emerald-600 mx-auto mb-1.5" />
        ) : isUploading ? (
          <Loader2 className="h-5 w-5 text-muted-foreground animate-spin mx-auto mb-1.5" />
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground/40 mx-auto mb-1.5" />
        )}
        <h4 className="text-sm font-semibold text-foreground">
          {doc.label} {doc.required && <span className="text-destructive">*</span>}
        </h4>
        <p className={`text-[10px] mt-0.5 ${isRejected ? "text-rose-700" : "text-muted-foreground"}`}>
          {isRejected ? (reviewNotes || "Rejected. Please re-upload this document.") : isUploaded ? "Uploaded successfully" : doc.desc}
        </p>
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

function docKeyForFile(name: string): string {
  if (name.startsWith("passport_photo.")) return "passport_photo";
  const dashIdx = name.indexOf("-");
  return dashIdx > 0 ? name.substring(0, dashIdx) : name.replace(/\.[^.]+$/, "");
}

export function DocumentUpload({
  data,
  onChange,
  onNext,
  onBack,
  saving,
  readOnly,
  nextLabel = "Continue to Review",
  storageTarget = "r2",
}: Props) {
  const { toast } = useToast();
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({});
  const [uploadedUrls, setUploadedUrls] = useState<Record<string, string>>({});
  const [reviewStatus, setReviewStatus] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string | null>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const docs = getRequiredDocs(
    data.program_category,
    data.academic_details as Record<string, any>,
    data.course_selections,
    data.category,
  );
  // Passport photo is mandatory for higher-ed (non-school) applicants —
  // PhotoUpload writes data.passport_photo_path on success (webcam capture
  // or file upload). School category doesn't render PhotoUpload.
  const needsPassportPhoto = data.program_category !== 'school';
  const passportPhotoUploaded = !!data.passport_photo_path || uploaded.passport_photo;

  // Check for existing uploads on mount
  useEffect(() => {
    if (!data.application_id) return;
    (async () => {
      const { data: res, error } = await supabase.functions.invoke("list-app-docs", {
        body: { application_id: data.application_id },
      });
      if (!error && (res as any)?.docs?.length) {
        const found: Record<string, boolean> = {};
        const urls: Record<string, string> = {};
        const statuses: Record<string, string> = {};
        const notes: Record<string, string | null> = {};
        for (const f of (res as any).docs) {
          if (!f.name || f.name.startsWith('.')) continue;
          const key = docKeyForFile(f.name);
          found[key] = true;
          urls[key] = f.url;
          statuses[key] = f.review_status || "pending";
          notes[key] = f.review_notes || null;
        }
        setUploaded(prev => ({ ...prev, ...found }));
        setUploadedUrls(prev => ({ ...prev, ...urls }));
        setReviewStatus(prev => ({ ...prev, ...statuses }));
        setReviewNotes(prev => ({ ...prev, ...notes }));
      }
    })();
  }, [data.application_id]);

  const handleUpload = async (docKey: string, file: File) => {
    setUploading(docKey);
    const form = new FormData();
    form.append('application_id', data.application_id);
    form.append('phone', data.phone);
    form.append('doc_key', docKey);
    form.append('storage_target', storageTarget);
    form.append('file', file);

    const { data: res, error } = await supabase.functions.invoke('apply-portal-upload-doc', { body: form });

    if (error || (res && res.error)) {
      const msg = (res && res.error) || error?.message || 'Upload failed';
      toast({ title: 'Upload failed', description: msg, variant: 'destructive' });
    } else {
      setUploaded(prev => ({ ...prev, [docKey]: true }));
      if (res?.url) setUploadedUrls(prev => ({ ...prev, [docKey]: res.url }));
      setReviewStatus(prev => ({ ...prev, [docKey]: "pending" }));
      setReviewNotes(prev => ({ ...prev, [docKey]: null }));
      toast({ title: `${docKey.replace(/_/g, ' ')} uploaded` });
    }
    setUploading(null);
  };

  const requiredDocs = docs.filter(d => d.required);
  const allRequiredUploaded = requiredDocs.every(d => uploaded[d.key])
    && (!needsPassportPhoto || passportPhotoUploaded);
  const hasRejectedDocs = Object.values(reviewStatus).some(status => status === "rejected");
  const handleContinue = () => {
    if (!allRequiredUploaded || hasRejectedDocs) {
      setShowErrors(true);
      return;
    }
    onNext();
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Upload Documents</h2>
        <p className="text-sm text-muted-foreground">Upload required documents. Accepted: PDF, JPG, PNG (max 5MB).</p>
      </div>

      <fieldset disabled={readOnly} className={readOnly ? "pointer-events-none opacity-75" : ""}>
      {/* Passport Photo — mandatory for higher-ed applicants. PhotoUpload
          supports both webcam capture and file upload internally. */}
      {needsPassportPhoto && (
        <div className={`space-y-1 rounded-2xl ${showErrors && !passportPhotoUploaded ? 'ring-1 ring-destructive/30 border border-destructive bg-destructive/5 p-3' : ''}`}>
          <PhotoUpload
            applicationId={data.application_id}
            phone={data.phone}
            storageTarget={storageTarget}
            existingUrl={data.passport_photo_path ? undefined : undefined}
            onUploaded={(path) => {
              onChange({ passport_photo_path: path });
              setUploaded(prev => ({ ...prev, passport_photo: true }));
              setReviewStatus(prev => ({ ...prev, passport_photo: "pending" }));
              setReviewNotes(prev => ({ ...prev, passport_photo: null }));
            }}
          />
          {!passportPhotoUploaded && (
            <p className="text-[11px] text-destructive">
              Passport photo is required — use the webcam or upload an image.
            </p>
          )}
        </div>
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
            reviewStatus={reviewStatus[doc.key]}
            reviewNotes={reviewNotes[doc.key]}
            invalid={showErrors && doc.required && !uploaded[doc.key]}
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
        <Button onClick={handleContinue} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
