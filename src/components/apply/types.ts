export interface CourseSelection {
  course_id: string;
  campus_id: string;
  course_name: string;
  campus_name: string;
  preference_order: number;
  program_category: string;
}

export interface ApplicationData {
  id: string;
  application_id: string;
  lead_id: string | null;
  session_id: string | null;
  status: string;
  course_selections: CourseSelection[];
  full_name: string;
  gender: string;
  dob: string;
  nationality: string;
  category: string;
  aadhaar: string;
  passport_number: string;
  phone: string;
  email: string;
  whatsapp_verified: boolean;
  address: {
    line1?: string;
    city?: string;
    state?: string;
    country?: string;
    pin_code?: string;
  };
  father: {
    name?: string; first_name?: string; last_name?: string; dob?: string;
    nationality?: string; id_type?: string; id_number?: string;
    education?: string; annual_income?: string; employer_name?: string;
    current_position?: string; marital_status?: string;
    phone?: string; phone_mobile?: string; phone_home?: string; email?: string; occupation?: string;
  };
  mother: {
    name?: string; first_name?: string; last_name?: string; dob?: string;
    nationality?: string; id_type?: string; id_number?: string;
    education?: string; annual_income?: string; employer_name?: string;
    current_position?: string; marital_status?: string;
    phone?: string; phone_mobile?: string; phone_home?: string; email?: string; occupation?: string;
  };
  guardian: { name?: string; relationship?: string; phone?: string; email?: string };
  apaar_id: string;
  pen_number: string;
  academic_details: {
    previous_school?: { 
      prev_school_name?: string; 
      board?: string; 
      last_class?: string; 
      academic_year?: string; 
      percentage?: string; 
      tc_available?: 'yes' | 'no' 
    };
    class_10?: { board?: string; board_other?: string; school?: string; year?: string; marks?: string; result_status?: string };
    class_12?: { board?: string; board_other?: string; school?: string; year?: string; marks?: string; result_status?: string; expected_month?: string; subjects?: string };
    graduation?: { degree?: string; university?: string; university_other?: string; college?: string; year?: string; marks?: string; result_status?: string; cgpa_till_sem?: string; semesters_completed?: string };
    additional_qualifications?: { degree?: string; university?: string; university_other?: string; college?: string; year?: string; marks?: string; result_status?: string; cgpa_till_sem?: string; semesters_completed?: string }[];
    entrance_exams?: { exam_name: string; status: 'yet_to_appear' | 'not_declared' | 'declared'; score?: string; expected_date?: string; is_custom?: boolean }[];
  };
  passport_photo_path?: string;
  result_status: Record<string, any>;
  extracurricular: {
    achievements?: string;
    competitions?: string;
    leadership?: string;
    sports?: string;
    volunteer?: string;
    portfolio?: string;
    linkedin?: string;
  };
  school_details: Record<string, any>;
  completed_sections: {
    personal: boolean;
    parents: boolean;
    academic: boolean;
    documents: boolean;
    payment: boolean;
  };
  fee_amount: number;
  payment_status: string;
  payment_ref: string | null;
  flags: string[];
  institution_id: string | null;
  program_category: string;
  submitted_at: string | null;
}

export const DEFAULT_APPLICATION: Omit<ApplicationData, 'id' | 'application_id'> = {
  lead_id: null,
  session_id: null,
  status: 'draft',
  course_selections: [],
  full_name: '',
  gender: '',
  dob: '',
  nationality: 'Indian',
  category: '',
  aadhaar: '',
  passport_number: '',
  phone: '',
  email: '',
  whatsapp_verified: false,
  address: {},
  father: {},
  mother: {},
  guardian: {},
  apaar_id: '',
  pen_number: '',
  academic_details: {},
  passport_photo_path: undefined,
  result_status: {},
  extracurricular: {},
  school_details: {},
  completed_sections: { personal: false, parents: false, academic: false, documents: false, payment: false },
  fee_amount: 0,
  payment_status: 'pending',
  payment_ref: null,
  flags: [],
  institution_id: null,
  program_category: '',
  submitted_at: null,
};

export const FEE_MAP: Record<string, number> = {
  school: 500,
  undergraduate: 1000,
  mba_pgdm: 1500,
  bed: 0,
  deled: 0,
  postgraduate: 1500,
  professional: 1000,
};

export function generateApplicationId(): string {
  const yr = new Date().getFullYear().toString().slice(-2);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `APP-${yr}-${rand}`;
}

export function determineProgramCategory(courseCode: string, courseName: string): string {
  const lower = (courseCode + ' ' + courseName).toLowerCase();
  if (lower.includes('nursery') || lower.includes('lkg') || lower.includes('ukg') || lower.includes('grade') || lower.includes('toddler') || lower.includes('montessori')) return 'school';
  if (lower.includes('mba') || lower.includes('pgdm')) return 'mba_pgdm';
  if (lower.includes('b.ed') || lower.includes('bed')) return 'bed';
  if (lower.includes('d.el.ed') || lower.includes('deled')) return 'deled';
  if (lower.includes('mpt') || lower.includes('llb') || lower.includes('mmrit')) return 'professional';
  if (lower.startsWith('m') || lower.includes('master') || lower.includes('pg')) return 'postgraduate';
  return 'undergraduate';
}

export function calculateFee(selections: CourseSelection[]): number {
  return selections.reduce((total, s) => total + (FEE_MAP[s.program_category] || 1000), 0);
}
