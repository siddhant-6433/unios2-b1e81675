import { BookOpen, FileText, User, Users, type LucideIcon } from "lucide-react";

export const MIRAI_STEPS: { key: string; label: string; icon: LucideIcon; sectionKeys: readonly string[] }[] = [
  { key: "child_grade", label: "Child & grade", icon: User, sectionKeys: ["personal"] },
  { key: "family", label: "Family", icon: Users, sectionKeys: ["parents", "siblings"] },
  { key: "learning", label: "Learning journey", icon: BookOpen, sectionKeys: ["questionnaire", "academic"] },
  { key: "documents_payment", label: "Documents & payment", icon: FileText, sectionKeys: ["payment", "documents"] },
  { key: "review", label: "Review", icon: FileText, sectionKeys: ["review"] },
];

export type MiraiEnquiryValues = {
  parentName: string; email: string; phone: string; childName: string; age: string;
  currentSchool: string; grade: string; academicYear: string; discoverySource: string; consent: boolean;
};

export function validateMiraiEnquiry(values: MiraiEnquiryValues, selectedGradeExists: boolean) {
  return {
    parentName: !!values.parentName.trim(),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()),
    phone: values.phone.replace(/\D/g, "").length >= 8,
    childName: !!values.childName.trim(),
    age: Number.isInteger(Number(values.age)) && Number(values.age) >= 1 && Number(values.age) <= 18,
    currentSchool: !!values.currentSchool.trim(),
    grade: !!values.grade && selectedGradeExists,
    academicYear: !!values.academicYear,
    discoverySource: !!values.discoverySource,
    consent: values.consent,
  };
}

export function miraiEnquiryPayload(values: MiraiEnquiryValues, grade: { name: string; code: string }, attribution: Record<string, unknown>, honeypot = "") {
  return {
    parent_name: values.parentName.trim(),
    mobile_number: values.phone,
    email: values.email.trim(),
    child_name: values.childName.trim(),
    child_age: Number(values.age),
    current_school: values.currentSchool.trim(),
    grade: grade.name,
    course_code: grade.code,
    academic_year: values.academicYear,
    discovery_source: values.discoverySource,
    contact_consent: values.consent,
    whatsapp_consent: values.consent,
    website: honeypot,
    ...attribution,
  };
}

export function miraiAdmissionRequestPayload(leadId: string, requestType: "call" | "campus_tour", parentName: string, childName: string) {
  return { lead_id: leadId, request_type: requestType, parent_name: parentName, child_name: childName };
}

export function miraiGroupIsComplete(step: typeof MIRAI_STEPS[number], completed: Record<string, boolean>) {
  return step.sectionKeys.every(key => completed[key] === true);
}

export function findMiraiSection(completed: Record<string, boolean>, preferred?: string) {
  if (preferred) {
    const group = MIRAI_STEPS.find(step => step.sectionKeys.includes(preferred));
    if (group) return { stepIndex: MIRAI_STEPS.indexOf(group), sectionKey: preferred };
  }
  for (let stepIndex = 0; stepIndex < MIRAI_STEPS.length; stepIndex++) {
    const group = MIRAI_STEPS[stepIndex];
    const sectionKey = group.sectionKeys.find(key => !completed[key]);
    if (sectionKey) return { stepIndex, sectionKey };
  }
  return { stepIndex: MIRAI_STEPS.length - 1, sectionKey: "review" };
}
