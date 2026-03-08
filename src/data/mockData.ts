export const admissionStages = [
  "New Lead", "AI Called", "Counsellor Call", "Visit Scheduled",
  "Interview", "Offer Sent", "Token Paid", "Pre-Admitted", "Admitted", "Rejected"
] as const;

export type AdmissionStage = typeof admissionStages[number];

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  course: string;
  campus: string;
  counsellor: string;
  stage: AdmissionStage;
  source: string;
  createdDate: string;
}

export interface StudentFee {
  id: string;
  studentName: string;
  admissionNo: string;
  course: string;
  feeCode: string;
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
}

export const mockLeads: Lead[] = [
  { id: "L001", name: "Rahul Sharma", phone: "9876543210", email: "rahul@email.com", course: "B.Tech CSE", campus: "Main Campus", counsellor: "Priya Singh", stage: "New Lead", source: "Website", createdDate: "2026-03-01" },
  { id: "L002", name: "Ananya Gupta", phone: "9876543211", email: "ananya@email.com", course: "MBA", campus: "City Campus", counsellor: "Amit Kumar", stage: "Counsellor Call", source: "Walk-in", createdDate: "2026-03-02" },
  { id: "L003", name: "Vikram Patel", phone: "9876543212", email: "vikram@email.com", course: "B.Tech ECE", campus: "Main Campus", counsellor: "Priya Singh", stage: "Visit Scheduled", source: "Referral", createdDate: "2026-02-28" },
  { id: "L004", name: "Sneha Reddy", phone: "9876543213", email: "sneha@email.com", course: "BBA", campus: "City Campus", counsellor: "Amit Kumar", stage: "Interview", source: "Social Media", createdDate: "2026-02-25" },
  { id: "L005", name: "Arjun Nair", phone: "9876543214", email: "arjun@email.com", course: "B.Tech CSE", campus: "Main Campus", counsellor: "Priya Singh", stage: "Offer Sent", source: "Website", createdDate: "2026-02-20" },
  { id: "L006", name: "Kavitha Menon", phone: "9876543215", email: "kavitha@email.com", course: "MBA", campus: "City Campus", counsellor: "Amit Kumar", stage: "Token Paid", source: "Education Fair", createdDate: "2026-02-18" },
  { id: "L007", name: "Rohan Das", phone: "9876543216", email: "rohan@email.com", course: "B.Tech ME", campus: "Main Campus", counsellor: "Priya Singh", stage: "Pre-Admitted", source: "Website", createdDate: "2026-02-15" },
  { id: "L008", name: "Meera Iyer", phone: "9876543217", email: "meera@email.com", course: "B.Tech CSE", campus: "Main Campus", counsellor: "Amit Kumar", stage: "Admitted", source: "Referral", createdDate: "2026-02-10" },
  { id: "L009", name: "Karthik Raja", phone: "9876543218", email: "karthik@email.com", course: "MBA", campus: "City Campus", counsellor: "Priya Singh", stage: "AI Called", source: "Website", createdDate: "2026-03-05" },
  { id: "L010", name: "Divya Lakshmi", phone: "9876543219", email: "divya@email.com", course: "BBA", campus: "City Campus", counsellor: "Amit Kumar", stage: "Rejected", source: "Walk-in", createdDate: "2026-01-30" },
];

export const mockFees: StudentFee[] = [
  { id: "F001", studentName: "Meera Iyer", admissionNo: "AN2026001", course: "B.Tech CSE", feeCode: "TF", term: "Sem 1", totalAmount: 75000, concession: 5000, paidAmount: 70000, balance: 0, dueDate: "2026-03-15", status: "Paid" },
  { id: "F002", studentName: "Meera Iyer", admissionNo: "AN2026001", course: "B.Tech CSE", feeCode: "HF", term: "Sem 1", totalAmount: 30000, concession: 0, paidAmount: 30000, balance: 0, dueDate: "2026-03-15", status: "Paid" },
  { id: "F003", studentName: "Rohan Das", admissionNo: "PAN2026007", course: "B.Tech ME", feeCode: "TF", term: "Sem 1", totalAmount: 75000, concession: 0, paidAmount: 20000, balance: 55000, dueDate: "2026-03-20", status: "Due" },
  { id: "F004", studentName: "Rohan Das", admissionNo: "PAN2026007", course: "B.Tech ME", feeCode: "LF", term: "Sem 1", totalAmount: 15000, concession: 0, paidAmount: 0, balance: 15000, dueDate: "2026-03-20", status: "Due" },
  { id: "F005", studentName: "Aarav Singh", admissionNo: "AN2025045", course: "MBA", feeCode: "TF", term: "Sem 2", totalAmount: 90000, concession: 10000, paidAmount: 0, balance: 80000, dueDate: "2026-02-28", status: "Overdue" },
  { id: "F006", studentName: "Priya Verma", admissionNo: "AN2025078", course: "BBA", feeCode: "TF", term: "Sem 2", totalAmount: 50000, concession: 0, paidAmount: 50000, balance: 0, dueDate: "2026-03-01", status: "Paid" },
];

export const mockAttendance: AttendanceRecord[] = [
  { id: "S001", studentName: "Meera Iyer", admissionNo: "AN2026001", status: "Present" },
  { id: "S002", studentName: "Aarav Singh", admissionNo: "AN2025045", status: "Present" },
  { id: "S003", studentName: "Priya Verma", admissionNo: "AN2025078", status: "Absent" },
  { id: "S004", studentName: "Rohan Das", admissionNo: "PAN2026007", status: "Present" },
  { id: "S005", studentName: "Neha Kapoor", admissionNo: "AN2025102", status: "Late" },
  { id: "S006", studentName: "Suresh Babu", admissionNo: "AN2025110", status: "Present" },
  { id: "S007", studentName: "Lakshmi Devi", admissionNo: "AN2025115", status: "Present" },
  { id: "S008", studentName: "Rajesh Kumar", admissionNo: "AN2025120", status: "Absent" },
];

export const dashboardStats = {
  superAdmin: {
    totalCampuses: 3,
    totalStudents: 2450,
    feeCollected: 12500000,
    overdueAmount: 3200000,
    newAdmissions: 185,
    admissionFunnel: [
      { stage: "New Lead", count: 45 },
      { stage: "Called", count: 38 },
      { stage: "Visit", count: 28 },
      { stage: "Interview", count: 22 },
      { stage: "Offer", count: 18 },
      { stage: "Token", count: 15 },
      { stage: "Pre-Admitted", count: 12 },
      { stage: "Admitted", count: 10 },
    ],
    campusComparison: [
      { campus: "Main Campus", students: 1200, fee: 6500000 },
      { campus: "City Campus", students: 850, fee: 4200000 },
      { campus: "South Campus", students: 400, fee: 1800000 },
    ],
  },
};
