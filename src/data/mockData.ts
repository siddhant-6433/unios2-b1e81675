export const admissionStages = [
  "New Lead", "AI Called", "Counsellor Call", "Visit Scheduled",
  "Interview", "Offer Sent", "Token Paid", "Pre-Admitted", "Admitted", "Rejected"
] as const;

export type AdmissionStage = typeof admissionStages[number];

export type LeadSource = "Website" | "Meta Ads" | "Google Ads" | "Shiksha" | "Walk-in" | "Consultant" | "JustDial" | "Referral" | "Education Fair" | "Other";

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  guardianName?: string;
  guardianPhone?: string;
  course: string;
  campus: string;
  counsellor: string;
  stage: AdmissionStage;
  source: LeadSource;
  createdDate: string;
  applicationId?: string;
  preAdmissionNo?: string;
  admissionNo?: string;
  interviewScore?: number;
  interviewResult?: "pass" | "hold" | "reject";
  visitDate?: string;
  offerAmount?: number;
  tokenAmount?: number;
  notes?: string;
}

export interface StudentFee {
  id: string;
  studentName: string;
  admissionNo: string;
  course: string;
  feeCode: string;
  feeCategory: string;
  term: string;
  totalAmount: number;
  concession: number;
  paidAmount: number;
  balance: number;
  dueDate: string;
  status: "Due" | "Paid" | "Overdue";
}

export interface AttendanceRecord {
  id: string;
  studentName: string;
  admissionNo: string;
  status: "Present" | "Absent" | "Late";
  feeStatus?: "Paid" | "Due" | "Blocked";
}

export interface StudentProfile {
  id: string;
  name: string;
  admissionNo: string;
  preAdmissionNo?: string;
  course: string;
  batch: string;
  campus: string;
  department: string;
  session: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
  fatherName: string;
  motherName: string;
  address: string;
  bloodGroup: string;
  photo: string;
  status: "Pre-Admitted" | "Active" | "Inactive" | "Alumni" | "Dropped";
  admissionDate: string;
  feePercentPaid: number;
}

export interface ExamRecord {
  id: string;
  admissionNo: string;
  subject: string;
  examType: string;
  maxMarks: number;
  obtained: number;
  grade: string;
  date: string;
}

export interface AttendanceHistory {
  id: string;
  admissionNo: string;
  date: string;
  status: "Present" | "Absent" | "Late";
  subject: string;
}

/* ── Mock Leads (enriched) ── */
export const mockLeads: Lead[] = [
  { id: "L001", name: "Rahul Sharma", phone: "9876543210", email: "rahul@email.com", guardianName: "Suresh Sharma", guardianPhone: "9876543200", course: "B.Tech CSE", campus: "NIMT Greater Noida", counsellor: "Ritu Verma", stage: "New Lead", source: "Website", createdDate: "2026-03-01", applicationId: "APP-26-0001" },
  { id: "L002", name: "Ananya Gupta", phone: "9876543211", email: "ananya@email.com", guardianName: "Rajesh Gupta", guardianPhone: "9876543201", course: "MBA", campus: "NIMT Kotputli", counsellor: "Sunita Devi", stage: "Counsellor Call", source: "Walk-in", createdDate: "2026-03-02", applicationId: "APP-26-0002" },
  { id: "L003", name: "Vikram Patel", phone: "9876543212", email: "vikram@email.com", course: "B.Tech ECE", campus: "NIMT Greater Noida", counsellor: "Ritu Verma", stage: "Visit Scheduled", source: "Referral", createdDate: "2026-02-28", applicationId: "APP-26-0003", visitDate: "2026-03-10" },
  { id: "L004", name: "Sneha Reddy", phone: "9876543213", email: "sneha@email.com", course: "BBA", campus: "NIMT Kotputli", counsellor: "Anil Kapoor", stage: "Interview", source: "Meta Ads", createdDate: "2026-02-25", applicationId: "APP-26-0004", interviewScore: 78, interviewResult: "pass" },
  { id: "L005", name: "Arjun Nair", phone: "9876543214", email: "arjun@email.com", course: "B.Tech CSE", campus: "NIMT Greater Noida", counsellor: "Ritu Verma", stage: "Offer Sent", source: "Website", createdDate: "2026-02-20", applicationId: "APP-26-0005", offerAmount: 300000 },
  { id: "L006", name: "Kavitha Menon", phone: "9876543215", email: "kavitha@email.com", course: "MBA", campus: "NIMT Kotputli", counsellor: "Sunita Devi", stage: "Token Paid", source: "Education Fair", createdDate: "2026-02-18", applicationId: "APP-26-0006", tokenAmount: 30000, preAdmissionNo: "NIMT-PRE-26-0006" },
  { id: "L007", name: "Rohan Das", phone: "9876543216", email: "rohan@email.com", course: "B.Tech ME", campus: "NIMT Greater Noida", counsellor: "Ritu Verma", stage: "Pre-Admitted", source: "Website", createdDate: "2026-02-15", applicationId: "APP-26-0007", preAdmissionNo: "NIMT-PRE-26-0007", tokenAmount: 30000 },
  { id: "L008", name: "Meera Iyer", phone: "9876543217", email: "meera@email.com", course: "B.Tech CSE", campus: "NIMT Greater Noida", counsellor: "Sunita Devi", stage: "Admitted", source: "Referral", createdDate: "2026-02-10", applicationId: "APP-26-0008", preAdmissionNo: "NIMT-PRE-26-0008", admissionNo: "NIMT26001" },
  { id: "L009", name: "Karthik Raja", phone: "9876543218", email: "karthik@email.com", course: "MBA", campus: "NIMT Kotputli", counsellor: "Meera Singh", stage: "AI Called", source: "Google Ads", createdDate: "2026-03-05", applicationId: "APP-26-0009" },
  { id: "L010", name: "Divya Lakshmi", phone: "9876543219", email: "divya@email.com", course: "BBA", campus: "NIMT Kotputli", counsellor: "Anil Kapoor", stage: "Rejected", source: "Walk-in", createdDate: "2026-01-30", applicationId: "APP-26-0010", interviewResult: "reject" },
  { id: "L011", name: "Amit Verma", phone: "9876543220", email: "amit@email.com", course: "B.Tech CSE", campus: "NIMT Greater Noida", counsellor: "Ritu Verma", stage: "New Lead", source: "Shiksha", createdDate: "2026-03-06" },
  { id: "L012", name: "Pooja Yadav", phone: "9876543221", email: "pooja@email.com", course: "Class 5", campus: "NIMT School Avantika II", counsellor: "Meera Singh", stage: "AI Called", source: "JustDial", createdDate: "2026-03-04" },
  { id: "L013", name: "Sanjay Mishra", phone: "9876543222", email: "sanjay@email.com", course: "B.Ed", campus: "Campus School", counsellor: "Anil Kapoor", stage: "Visit Scheduled", source: "Consultant", createdDate: "2026-03-03", visitDate: "2026-03-12" },
  { id: "L014", name: "Nisha Patel", phone: "9876543223", email: "nisha@email.com", course: "B.Tech CSE", campus: "NIMT Greater Noida", counsellor: "Sunita Devi", stage: "Offer Sent", source: "Meta Ads", createdDate: "2026-02-22", offerAmount: 280000 },
  { id: "L015", name: "Deepak Kumar", phone: "9876543224", email: "deepak@email.com", course: "MBA", campus: "NIMT Kotputli", counsellor: "Ritu Verma", stage: "Token Paid", source: "Google Ads", createdDate: "2026-02-16", tokenAmount: 25000, preAdmissionNo: "NIMT-PRE-26-0015" },
];

/* ── Fee structures ── */
export interface FeeStructure {
  id: string;
  course: string;
  session: string;
  version: string;
  isActive: boolean;
  items: FeeStructureItem[];
}

export interface FeeStructureItem {
  feeCode: string;
  feeName: string;
  category: string;
  term: string;
  amount: number;
  dueDay: number;
}

export const mockFeeStructures: FeeStructure[] = [
  {
    id: "FS001", course: "B.Tech CSE", session: "2025-26", version: "BTECH_CSE_2025_V1", isActive: true,
    items: [
      { feeCode: "BSN25_SEM1_TUITION", feeName: "Tuition Fee", category: "tuition", term: "Sem 1", amount: 75000, dueDay: 10 },
      { feeCode: "BSN25_SEM1_LAB", feeName: "Lab Fee", category: "lab", term: "Sem 1", amount: 15000, dueDay: 10 },
      { feeCode: "ENROLL_ABVMU", feeName: "University Enrollment", category: "enrollment", term: "Sem 1", amount: 8000, dueDay: 10 },
      { feeCode: "BSN25_SEM2_TUITION", feeName: "Tuition Fee", category: "tuition", term: "Sem 2", amount: 75000, dueDay: 10 },
      { feeCode: "BSN25_SEM2_LAB", feeName: "Lab Fee", category: "lab", term: "Sem 2", amount: 15000, dueDay: 10 },
    ]
  },
  {
    id: "FS002", course: "MBA", session: "2025-26", version: "MBA_2025_V1", isActive: true,
    items: [
      { feeCode: "MBA25_SEM1_TUITION", feeName: "Tuition Fee", category: "tuition", term: "Sem 1", amount: 90000, dueDay: 10 },
      { feeCode: "MBA25_SEM1_LIBRARY", feeName: "Library Fee", category: "library", term: "Sem 1", amount: 5000, dueDay: 10 },
      { feeCode: "MBA25_SEM2_TUITION", feeName: "Tuition Fee", category: "tuition", term: "Sem 2", amount: 90000, dueDay: 10 },
    ]
  },
];

/* ── Mock Fees (enriched) ── */
export const mockFees: StudentFee[] = [
  { id: "F001", studentName: "Meera Iyer", admissionNo: "NIMT26001", course: "B.Tech CSE", feeCode: "BSN25_SEM1_TUITION", feeCategory: "tuition", term: "Sem 1", totalAmount: 75000, concession: 5000, paidAmount: 70000, balance: 0, dueDate: "2026-03-15", status: "Paid" },
  { id: "F002", studentName: "Meera Iyer", admissionNo: "NIMT26001", course: "B.Tech CSE", feeCode: "BSN25_SEM1_LAB", feeCategory: "lab", term: "Sem 1", totalAmount: 15000, concession: 0, paidAmount: 15000, balance: 0, dueDate: "2026-03-15", status: "Paid" },
  { id: "F003", studentName: "Rohan Das", admissionNo: "NIMT-PRE-26-0007", course: "B.Tech ME", feeCode: "BSN25_SEM1_TUITION", feeCategory: "tuition", term: "Sem 1", totalAmount: 75000, concession: 0, paidAmount: 20000, balance: 55000, dueDate: "2026-03-20", status: "Due" },
  { id: "F004", studentName: "Rohan Das", admissionNo: "NIMT-PRE-26-0007", course: "B.Tech ME", feeCode: "BSN25_SEM1_LAB", feeCategory: "lab", term: "Sem 1", totalAmount: 15000, concession: 0, paidAmount: 0, balance: 15000, dueDate: "2026-03-20", status: "Due" },
  { id: "F005", studentName: "Aarav Singh", admissionNo: "NIMT25045", course: "MBA", feeCode: "MBA25_SEM2_TUITION", feeCategory: "tuition", term: "Sem 2", totalAmount: 90000, concession: 10000, paidAmount: 0, balance: 80000, dueDate: "2026-02-28", status: "Overdue" },
  { id: "F006", studentName: "Priya Verma", admissionNo: "NIMT25078", course: "BBA", feeCode: "BBA25_SEM2_TUITION", feeCategory: "tuition", term: "Sem 2", totalAmount: 50000, concession: 0, paidAmount: 50000, balance: 0, dueDate: "2026-03-01", status: "Paid" },
  { id: "F007", studentName: "Kavitha Menon", admissionNo: "NIMT-PRE-26-0006", course: "MBA", feeCode: "SEAT_RESERVE_TOKEN", feeCategory: "token", term: "Token", totalAmount: 30000, concession: 0, paidAmount: 30000, balance: 0, dueDate: "2026-02-18", status: "Paid" },
  { id: "F008", studentName: "Deepak Kumar", admissionNo: "NIMT-PRE-26-0015", course: "MBA", feeCode: "SEAT_RESERVE_TOKEN", feeCategory: "token", term: "Token", totalAmount: 25000, concession: 0, paidAmount: 25000, balance: 0, dueDate: "2026-02-16", status: "Paid" },
];

export interface Payment {
  id: string;
  studentName: string;
  admissionNo: string;
  amount: number;
  mode: "online" | "cash" | "cheque" | "upi" | "bank_transfer";
  transactionRef: string;
  receiptNo: string;
  paidAt: string;
  feeCode: string;
}

export const mockPayments: Payment[] = [
  { id: "P001", studentName: "Meera Iyer", admissionNo: "NIMT26001", amount: 70000, mode: "online", transactionRef: "TXN001234", receiptNo: "RCP-26-0001", paidAt: "2026-02-12", feeCode: "BSN25_SEM1_TUITION" },
  { id: "P002", studentName: "Meera Iyer", admissionNo: "NIMT26001", amount: 15000, mode: "upi", transactionRef: "UPI001235", receiptNo: "RCP-26-0002", paidAt: "2026-02-12", feeCode: "BSN25_SEM1_LAB" },
  { id: "P003", studentName: "Rohan Das", admissionNo: "NIMT-PRE-26-0007", amount: 20000, mode: "cash", transactionRef: "", receiptNo: "RCP-26-0003", paidAt: "2026-02-15", feeCode: "BSN25_SEM1_TUITION" },
  { id: "P004", studentName: "Priya Verma", admissionNo: "NIMT25078", amount: 50000, mode: "bank_transfer", transactionRef: "NEFT001236", receiptNo: "RCP-26-0004", paidAt: "2026-02-28", feeCode: "BBA25_SEM2_TUITION" },
  { id: "P005", studentName: "Kavitha Menon", admissionNo: "NIMT-PRE-26-0006", amount: 30000, mode: "online", transactionRef: "TXN001237", receiptNo: "RCP-26-0005", paidAt: "2026-02-18", feeCode: "SEAT_RESERVE_TOKEN" },
];

export const mockAttendance: AttendanceRecord[] = [
  { id: "S001", studentName: "Meera Iyer", admissionNo: "NIMT26001", status: "Present", feeStatus: "Paid" },
  { id: "S002", studentName: "Aarav Singh", admissionNo: "NIMT25045", status: "Present", feeStatus: "Due" },
  { id: "S003", studentName: "Priya Verma", admissionNo: "NIMT25078", status: "Absent", feeStatus: "Paid" },
  { id: "S004", studentName: "Rohan Das", admissionNo: "NIMT-PRE-26-0007", status: "Present", feeStatus: "Blocked" },
  { id: "S005", studentName: "Neha Kapoor", admissionNo: "NIMT25102", status: "Late", feeStatus: "Paid" },
  { id: "S006", studentName: "Suresh Babu", admissionNo: "NIMT25110", status: "Present", feeStatus: "Paid" },
  { id: "S007", studentName: "Lakshmi Devi", admissionNo: "NIMT25115", status: "Present", feeStatus: "Paid" },
  { id: "S008", studentName: "Rajesh Kumar", admissionNo: "NIMT25120", status: "Absent", feeStatus: "Due" },
];

export const mockStudentProfiles: StudentProfile[] = [
  { id: "SP001", name: "Meera Iyer", admissionNo: "NIMT26001", course: "B.Tech CSE", batch: "B.Tech CSE - Sem 2 - A", campus: "NIMT Greater Noida", department: "Computer Science", session: "2025-26", dob: "2006-04-15", gender: "Female", phone: "9876543217", email: "meera@email.com", fatherName: "Suresh Iyer", motherName: "Lakshmi Iyer", address: "42 MG Road, Bangalore", bloodGroup: "B+", photo: "", status: "Active", admissionDate: "2025-07-01", feePercentPaid: 100 },
  { id: "SP002", name: "Aarav Singh", admissionNo: "NIMT25045", course: "MBA", batch: "MBA - Sem 2 - A", campus: "NIMT Kotputli", department: "Management", session: "2025-26", dob: "2003-08-22", gender: "Male", phone: "9876543218", email: "aarav@email.com", fatherName: "Rajesh Singh", motherName: "Sunita Singh", address: "15 Nehru Nagar, Delhi", bloodGroup: "O+", photo: "", status: "Active", admissionDate: "2025-07-05", feePercentPaid: 45 },
  { id: "SP003", name: "Priya Verma", admissionNo: "NIMT25078", course: "BBA", batch: "BBA - Sem 2 - A", campus: "NIMT Kotputli", department: "Management", session: "2025-26", dob: "2005-01-10", gender: "Female", phone: "9876543219", email: "priya@email.com", fatherName: "Anil Verma", motherName: "Rekha Verma", address: "8 Jubilee Hills, Hyderabad", bloodGroup: "A+", photo: "", status: "Active", admissionDate: "2025-07-03", feePercentPaid: 100 },
  { id: "SP004", name: "Rohan Das", preAdmissionNo: "NIMT-PRE-26-0007", admissionNo: "NIMT-PRE-26-0007", course: "B.Tech ME", batch: "B.Tech ME - Sem 2 - A", campus: "NIMT Greater Noida", department: "Mechanical Engineering", session: "2025-26", dob: "2005-11-30", gender: "Male", phone: "9876543216", email: "rohan@email.com", fatherName: "Bikash Das", motherName: "Anima Das", address: "23 Salt Lake, Kolkata", bloodGroup: "AB+", photo: "", status: "Pre-Admitted", admissionDate: "2025-07-02", feePercentPaid: 22 },
  { id: "SP005", name: "Neha Kapoor", admissionNo: "NIMT25102", course: "B.Tech CSE", batch: "B.Tech CSE - Sem 2 - B", campus: "NIMT Greater Noida", department: "Computer Science", session: "2025-26", dob: "2005-06-18", gender: "Female", phone: "9876543220", email: "neha@email.com", fatherName: "Vikram Kapoor", motherName: "Shalini Kapoor", address: "56 Koramangala, Bangalore", bloodGroup: "O-", photo: "", status: "Active", admissionDate: "2025-07-04", feePercentPaid: 100 },
  { id: "SP006", name: "Suresh Babu", admissionNo: "NIMT25110", course: "B.Tech ECE", batch: "B.Tech ECE - Sem 2 - A", campus: "NIMT Greater Noida", department: "Electronics", session: "2025-26", dob: "2005-03-25", gender: "Male", phone: "9876543221", email: "suresh@email.com", fatherName: "Ramesh Babu", motherName: "Geetha Babu", address: "12 Anna Nagar, Chennai", bloodGroup: "B-", photo: "", status: "Active", admissionDate: "2025-07-06", feePercentPaid: 75 },
];

export const mockExamRecords: ExamRecord[] = [
  { id: "E001", admissionNo: "NIMT26001", subject: "Data Structures", examType: "Mid-Term", maxMarks: 50, obtained: 42, grade: "A", date: "2026-01-15" },
  { id: "E002", admissionNo: "NIMT26001", subject: "Mathematics II", examType: "Mid-Term", maxMarks: 50, obtained: 38, grade: "B+", date: "2026-01-16" },
  { id: "E003", admissionNo: "NIMT26001", subject: "Digital Electronics", examType: "Mid-Term", maxMarks: 50, obtained: 45, grade: "A+", date: "2026-01-17" },
  { id: "E004", admissionNo: "NIMT26001", subject: "English", examType: "Mid-Term", maxMarks: 50, obtained: 35, grade: "B", date: "2026-01-18" },
  { id: "E005", admissionNo: "NIMT25045", subject: "Marketing Management", examType: "Mid-Term", maxMarks: 100, obtained: 72, grade: "B+", date: "2026-01-20" },
  { id: "E006", admissionNo: "NIMT25045", subject: "Financial Accounting", examType: "Mid-Term", maxMarks: 100, obtained: 65, grade: "B", date: "2026-01-21" },
  { id: "E007", admissionNo: "NIMT25078", subject: "Business Communication", examType: "Mid-Term", maxMarks: 100, obtained: 88, grade: "A", date: "2026-01-20" },
  { id: "E008", admissionNo: "NIMT-PRE-26-0007", subject: "Thermodynamics", examType: "Mid-Term", maxMarks: 50, obtained: 30, grade: "B-", date: "2026-01-15" },
];

export const mockAttendanceHistory: AttendanceHistory[] = [
  { id: "AH001", admissionNo: "NIMT26001", date: "2026-03-01", status: "Present", subject: "Data Structures" },
  { id: "AH002", admissionNo: "NIMT26001", date: "2026-03-01", status: "Present", subject: "Mathematics II" },
  { id: "AH003", admissionNo: "NIMT26001", date: "2026-03-02", status: "Absent", subject: "Digital Electronics" },
  { id: "AH004", admissionNo: "NIMT26001", date: "2026-03-02", status: "Present", subject: "English" },
  { id: "AH005", admissionNo: "NIMT26001", date: "2026-03-03", status: "Present", subject: "Data Structures" },
  { id: "AH006", admissionNo: "NIMT26001", date: "2026-03-03", status: "Late", subject: "Mathematics II" },
  { id: "AH007", admissionNo: "NIMT26001", date: "2026-03-04", status: "Present", subject: "Digital Electronics" },
  { id: "AH008", admissionNo: "NIMT26001", date: "2026-03-05", status: "Present", subject: "Data Structures" },
  { id: "AH009", admissionNo: "NIMT26001", date: "2026-03-05", status: "Present", subject: "English" },
  { id: "AH010", admissionNo: "NIMT26001", date: "2026-03-06", status: "Absent", subject: "Mathematics II" },
  { id: "AH011", admissionNo: "NIMT25045", date: "2026-03-01", status: "Present", subject: "Marketing Management" },
  { id: "AH012", admissionNo: "NIMT25045", date: "2026-03-02", status: "Late", subject: "Financial Accounting" },
  { id: "AH013", admissionNo: "NIMT25078", date: "2026-03-01", status: "Present", subject: "Business Communication" },
  { id: "AH014", admissionNo: "NIMT-PRE-26-0007", date: "2026-03-01", status: "Present", subject: "Thermodynamics" },
  { id: "AH015", admissionNo: "NIMT-PRE-26-0007", date: "2026-03-02", status: "Absent", subject: "Thermodynamics" },
];

export const dashboardStats = {
  superAdmin: {
    totalCampuses: 6,
    totalStudents: 2450,
    feeCollected: 12500000,
    overdueAmount: 3200000,
    newAdmissions: 185,
    admissionFunnel: [
      { stage: "New Lead", count: 145 },
      { stage: "AI Called", count: 112 },
      { stage: "Counsellor Call", count: 84 },
      { stage: "Visit Scheduled", count: 62 },
      { stage: "Interview", count: 48 },
      { stage: "Offer Sent", count: 35 },
      { stage: "Token Paid", count: 28 },
      { stage: "Pre-Admitted", count: 22 },
      { stage: "Admitted", count: 18 },
    ],
    campusComparison: [
      { campus: "NIMT Greater Noida", students: 1200, fee: 6500000 },
      { campus: "NIMT School Avantika II", students: 450, fee: 2200000 },
      { campus: "NIMT School Arthala", students: 380, fee: 1800000 },
      { campus: "NIMT Kotputli", students: 280, fee: 1400000 },
      { campus: "Campus School", students: 90, fee: 400000 },
      { campus: "Mirai Experiential", students: 50, fee: 200000 },
    ],
  },
};
