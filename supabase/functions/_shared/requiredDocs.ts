// Required-document rules — the single source of truth, shared by the applicant
// portal (src/components/apply/DocumentUpload.tsx) and the server-side
// completeness computation (sync-admission-doc-status). Keep this in sync with
// the frontend copy: same keys, same `required` conditions.

export interface DocSpec {
  key: string;
  label: string;
  desc: string;
  required: boolean;
}

const PARENT_AADHAAR_DOCS: DocSpec[] = [
  { key: 'father_aadhaar', label: 'Father Aadhaar Card', desc: 'JPEG / PNG / PDF (optional)', required: false },
  { key: 'mother_aadhaar', label: 'Mother Aadhaar Card', desc: 'JPEG / PNG / PDF (optional)', required: false },
  { key: 'guardian_aadhaar', label: 'Guardian Aadhaar Card', desc: 'JPEG / PNG / PDF (optional)', required: false },
];

function isNurseryClass(courseNames: string): boolean {
  return /\b(pre[-\s]?nursery|nursery)\b/i.test(courseNames);
}

export function getRequiredDocs(
  programCategory: string,
  academicDetails?: Record<string, any>,
  courseSelections?: { course_name: string }[],
  socialCategory?: string,
): DocSpec[] {
  const c10Status = academicDetails?.class_10?.result_status;
  const c12Status = academicDetails?.class_12?.result_status;
  const gradStatus = academicDetails?.graduation?.result_status;
  const needsCasteCert = ['SC', 'ST', 'OBC'].includes((socialCategory || '').toUpperCase());

  if (programCategory === 'school') {
    const courseNames = courseSelections?.map(s => s.course_name.toLowerCase()).join(' ') || '';
    const isAboveKG = /grade|class\s*[1-9]/i.test(courseNames);
    const needsBirthCertificate = isNurseryClass(courseNames);

    return [
      { key: 'birth_certificate', label: 'Birth Certificate', desc: needsBirthCertificate ? 'PDF or image' : 'Required for Nursery only', required: needsBirthCertificate },
      { key: 'report_card', label: 'Previous Class Report Card', desc: 'Last year marksheet', required: isAboveKG },
      { key: 'student_photo', label: 'Student Photograph', desc: 'Passport size photo', required: true },
      { key: 'transfer_certificate', label: 'Transfer Certificate', desc: 'If applicable', required: false },
      { key: 'aadhaar', label: 'Student Aadhaar Card', desc: 'JPEG / PNG / PDF', required: true },
      ...PARENT_AADHAAR_DOCS,
      { key: 'caste_certificate', label: 'Caste Certificate', desc: 'Mandatory for SC / ST / OBC', required: needsCasteCert },
      { key: 'medical_record', label: 'Medical Record', desc: 'If applicable', required: false },
      { key: 'other_document', label: 'Other Document', desc: 'Any additional supporting document (optional)', required: false },
    ];
  }

  const base: DocSpec[] = [];

  if (c10Status !== 'not_declared') {
    base.push({ key: 'class_10_marksheet', label: 'Class 10 Marksheet', desc: 'PDF or image', required: true });
  }
  base.push({ key: 'class_10_certificate', label: '10th Pass Certificate', desc: 'Optional', required: false });

  if (c12Status !== 'not_declared') {
    base.push({ key: 'class_12_marksheet', label: 'Class 12 Marksheet', desc: 'PDF or image', required: true });
  }
  base.push({ key: 'class_12_certificate', label: '12th Pass Certificate', desc: 'Optional', required: false });

  if (['postgraduate', 'mba_pgdm', 'professional', 'bed', 'deled'].includes(programCategory)) {
    if (gradStatus !== 'not_declared') {
      base.push({ key: 'graduation_marksheet', label: 'Graduation Marksheet', desc: 'All semesters', required: true });
    }
    base.push({ key: 'graduation_certificate', label: 'Graduation Degree Certificate', desc: 'Optional', required: false });
  }

  if (!['postgraduate', 'mba_pgdm', 'professional', 'bed', 'deled'].includes(programCategory)) {
    const optGrad = academicDetails?.graduation;
    if (optGrad && (optGrad.degree || optGrad.university)) {
      if (optGrad.result_status !== 'not_declared') {
        base.push({ key: 'graduation_marksheet', label: 'Graduation Marksheet (Optional)', desc: 'If available', required: false });
      }
    }
  }

  const additionalQuals: any[] = academicDetails?.additional_qualifications || [];
  additionalQuals.forEach((q: any, idx: number) => {
    if (q && (q.degree || q.university) && q.result_status !== 'not_declared') {
      base.push({ key: `additional_qual_${idx}_marksheet`, label: `${q.degree || `Qualification ${idx + 1}`} Marksheet`, desc: 'All semesters', required: false });
    }
  });

  const exams: any[] = academicDetails?.entrance_exams || [];
  exams.forEach((ex: any) => {
    if (ex && ex.status === 'declared' && ex.exam_name && !/cahet|up\s*d\.?\s*el\.?\s*ed|updeled|d\.?\s*el\.?\s*ed counselling/i.test(ex.exam_name)) {
      base.push({ key: `entrance_${ex.exam_name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_scorecard`, label: `${ex.exam_name} Scorecard`, desc: 'Score/rank card', required: false });
    }
  });

  base.push({ key: 'aadhaar', label: 'Student Aadhaar Card', desc: 'JPEG / PNG / PDF', required: true });
  base.push(...PARENT_AADHAAR_DOCS);
  base.push({ key: 'caste_certificate', label: 'Caste Certificate', desc: 'Mandatory for SC / ST / OBC', required: needsCasteCert });

  const isPG = ['postgraduate', 'mba_pgdm', 'bed'].includes(programCategory);
  if (isPG) {
    base.push({ key: 'migration_certificate', label: 'Migration / Transfer Certificate', desc: 'From your graduation college / university (optional)', required: false });
  } else {
    base.push({ key: 'school_transfer_certificate', label: 'School Transfer / Migration Certificate', desc: 'From your Class 12 school (optional)', required: false });
  }

  base.push({ key: 'entrance_allotment_letter', label: 'Entrance Score / Allotment Letter', desc: 'Scorecard or counselling seat allotment (optional)', required: false });
  base.push({ key: 'other_document', label: 'Other Document', desc: 'Any additional supporting document (optional)', required: false });

  return base;
}

/** Doc state for one required key, given the merged doc list from list-app-docs. */
export type DocState = 'verified' | 'rejected' | 'pending' | 'missing';

export interface MergedDoc { doc_key: string; review_status?: string }

export function computeAdmissionDocStatus(
  required: DocSpec[],
  uploaded: MergedDoc[],
) {
  const mandatory = required.filter(d => d.required);
  const byKey = new Map<string, string[]>();
  for (const d of uploaded) {
    if (!d?.doc_key) continue;
    const arr = byKey.get(d.doc_key) || [];
    arr.push(d.review_status || 'pending');
    byKey.set(d.doc_key, arr);
  }

  const docs = mandatory.map(spec => {
    const statuses = byKey.get(spec.key) || [];
    let state: DocState;
    if (statuses.length === 0) state = 'missing';
    else if (statuses.includes('verified')) state = 'verified';
    else if (statuses.includes('rejected')) state = 'rejected';
    else state = 'pending';
    return { key: spec.key, label: spec.label, state };
  });

  const count = (s: DocState) => docs.filter(d => d.state === s).length;
  return {
    complete: docs.every(d => d.state === 'verified'),
    required_total: docs.length,
    verified: count('verified'),
    rejected: count('rejected'),
    pending: count('pending'),
    missing: count('missing'),
    docs,
  };
}
