import { useState } from "react";
import { ArrowRight, ArrowLeft, Loader2, Upload, CheckCircle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ApplicationData } from "./types";

interface Props {
  data: ApplicationData;
  onNext: () => void;
  onBack: () => void;
  saving: boolean;
}

interface DocSpec {
  key: string;
  label: string;
  desc: string;
  required: boolean;
}

function getRequiredDocs(category: string, academicDetails?: Record<string, any>): DocSpec[] {
  const c10Status = academicDetails?.class_10?.result_status;
  const c12Status = academicDetails?.class_12?.result_status;
  const gradStatus = academicDetails?.graduation?.result_status;

  if (category === 'school') {
    return [
      { key: 'birth_certificate', label: 'Birth Certificate', desc: 'PDF or image', required: true },
      { key: 'report_card', label: 'Previous Class Report Card', desc: 'Last year marksheet', required: true },
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

  return base;
}

export function DocumentUpload({ data, onNext, onBack, saving }: Props) {
  const { toast } = useToast();
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const docs = getRequiredDocs(data.program_category, data.academic_details as Record<string, any>);

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

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={onNext} disabled={!allRequiredUploaded && docs.some(d => d.required)} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Continue to Review
        </Button>
      </div>
    </div>
  );
}
