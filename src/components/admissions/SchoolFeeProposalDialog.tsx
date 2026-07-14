import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { brandForStudentOwner, type StudentBrand } from "@/lib/studentBranding";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpCircle, Loader2, Plus, Send, FileDown, CheckCircle, XCircle, Copy, Trash2 } from "lucide-react";
import {
  buildSchoolFeeSnapshot,
  allocateFeeHeaderWaivers,
  admissionPayableBreakdown,
  computeSchoolProposalChildTotals,
  isAdmissionPayableFeeItem,
  formatInr,
  groupFeeItemsByTerm,
  groupFeeItemsByHeader,
  type GroupedSchoolFeeHeader,
  type SchoolFeeItem,
  type SchoolFeeItemWaiverAllocation,
  type SchoolFeeOption,
  type SchoolFeeSnapshot,
} from "@/lib/schoolFeeProposal";

interface SchoolFeeProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id: string;
    name: string;
    phone?: string | null;
  };
}

interface FeeCourseOption {
  courseId: string;
  courseName: string;
  courseCode: string;
  courseType: string;
  institutionType: string;
  durationYears: number;
  campusName: string;
  institutionName: string;
  sessionId: string;
  sessionName: string;
  feeVersion: string;
  siblingFeeVersion?: string | null;
  createdAt: string;
  snapshot: SchoolFeeSnapshot;
  siblingSnapshot?: SchoolFeeSnapshot | null;
}

type ChildWaiverType = "sibling" | "single_parent" | "custom";
type ChildWaiverChoice = "" | "none" | ChildWaiverType;

interface ChildDraft {
  id: string;
  leadId: string;
  name: string;
  courseId: string;
  transportKey: string;
  boardingKey: string;
  waiverType: ChildWaiverChoice;
  waiverTypes: ChildWaiverType[];
  feeHeaderWaivers: Record<string, string>;
}

interface SchoolFeeProposalRow {
  id: string;
  status: "pending_super_admin" | "approved" | "rejected";
  proposal: any;
  total_children: number;
  annual_total: number;
  annual_net_total: number;
  admission_payable_total: number;
  grayquest_principal_total: number;
  waiver_total: number;
  waiver_percent: number;
  rejection_reason: string | null;
  whatsapp_sent_at: string | null;
  created_at: string;
  linked_lead_ids?: string[] | null;
  revision_group_id?: string | null;
  revision_number?: number | null;
  is_current?: boolean | null;
  superseded_at?: string | null;
  superseded_by?: string | null;
}

interface RelatedLeadOption {
  id: string;
  name: string;
  phone: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  stage: string | null;
}

interface LeadPaymentRow {
  id: string;
  lead_id: string;
  type: string;
  amount: number;
  status: string | null;
}

interface ApplicationNameRow {
  lead_id: string | null;
  full_name: string | null;
}

interface LeadFeeStatus {
  an_threshold?: number;
  twenty_five_pct?: number;
  paid_toward_course?: number;
  total_paid?: number;
  application_paid?: number;
  registration_paid?: number;
  twenty_five_complete?: boolean;
}

interface ProposalIssuerDetails {
  user_id?: string | null;
  name: string;
  employee_id: string | null;
}

interface PdfImageAsset {
  dataUrl: string;
  width: number;
  height: number;
}

interface ProposalBrand extends StudentBrand {
  primaryColor: string;
  accentColor: string;
}

const emptyChild = (): ChildDraft => ({
  id: crypto.randomUUID(),
  leadId: "",
  name: "",
  courseId: "",
  transportKey: "",
  boardingKey: "",
  waiverType: "",
  waiverTypes: [],
  feeHeaderWaivers: {},
});

const feeProposalGuideStorageKey = (userId?: string | null) => `fee-proposal-guide-seen-v1:${userId || "anonymous"}`;

function optionFirstQuarter(option: SchoolFeeOption | null): number {
  return option?.items
    .filter((item) => item.term.toLowerCase() === "q1")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0) || 0;
}

function statusLabel(status: SchoolFeeProposalRow["status"]): string {
  if (status === "pending_super_admin") return "Pending super admin";
  if (status === "approved") return "Approved";
  return "Rejected";
}

function statusClass(status: SchoolFeeProposalRow["status"]): string {
  if (status === "approved") return "bg-success/10 text-success border-success/20";
  if (status === "rejected") return "bg-destructive/10 text-destructive border-destructive/20";
  return "bg-warning/10 text-warning-foreground border-warning/20";
}

function revisionLabel(proposal: SchoolFeeProposalRow): string {
  return `Revision ${Number(proposal.revision_number || proposal.proposal?.revision?.number || 1)}`;
}

function proposalLifecycleSteps(proposal: SchoolFeeProposalRow) {
  return [
    {
      label: "Generated",
      value: new Date(proposal.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
      className: "bg-slate-100 text-slate-700 border-slate-200",
    },
    {
      label: statusLabel(proposal.status),
      value: proposal.status === "approved" ? "Ready to send" : proposal.status === "rejected" ? "Not sendable" : "Awaiting approval",
      className: statusClass(proposal.status),
    },
    {
      label: proposal.whatsapp_sent_at ? "Sent" : "Not sent",
      value: proposal.whatsapp_sent_at
        ? new Date(proposal.whatsapp_sent_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
        : proposal.status === "approved" ? "Pending WhatsApp" : "Locked",
      className: proposal.whatsapp_sent_at
        ? "bg-info/10 text-info-foreground border-info/20"
        : "bg-slate-100 text-slate-600 border-slate-200",
    },
  ];
}

function feeVersionRank(version: string): number {
  const normalized = version.toLowerCase();
  if (normalized === "new_admission") return 0;
  if (normalized === "standard") return 1;
  return 2;
}

function siblingFeeVersionRank(version: string, primaryVersion: string): number {
  const normalized = version.toLowerCase();
  const primary = primaryVersion.toLowerCase();
  if (normalized.includes("existing_parent")) return 0;
  if (primary !== "standard" && normalized === "standard") return 1;
  return 99;
}

function courseOptionLabel(option: FeeCourseOption): string {
  return [option.institutionName, option.courseName].filter(Boolean).join(" - ");
}

function transportOptionLabel(option: SchoolFeeOption): string {
  const distance = option.description ? ` (${option.description})` : "";
  return `${option.label}${distance} - ${formatInr(option.amount)}`;
}

function transportProposalLabel(option: SchoolFeeOption): string {
  return option.description ? `${option.label} (${option.description})` : option.label;
}

function personLabel(name?: string | null, phone?: string | null): string {
  const cleanName = String(name || "").trim();
  const cleanPhone = String(phone || "").trim();
  if (cleanName && cleanPhone && cleanName !== cleanPhone) return `${cleanName}\n${cleanPhone}`;
  return cleanName || cleanPhone || "-";
}

function cleanDisplayName(name?: string | null): string {
  return String(name || "").trim();
}

function isSchoolProposalPayload(payload: any): boolean {
  const children = Array.isArray(payload?.children) ? payload.children : [];
  if (children.length === 0) return false;
  return children.every((child: any) => {
    const institutionType = String(child.institution_type || child.course_type || "").toLowerCase();
    if (institutionType === "school") return true;
    if (institutionType && institutionType !== "school") return false;
    const haystack = [
      child.course_name,
      child.class_name,
      child.course_code,
      child.campus_name,
    ].filter(Boolean).join(" ").toLowerCase();
    return /beacon|mirai|grade|class|nursery|lkg|ukg|toddler|pyp|myp|eyp/.test(haystack);
  });
}

function isSchoolCourseOption(course: FeeCourseOption | null): boolean {
  if (!course) return false;
  const institutionType = String(course.institutionType || course.courseType || "").toLowerCase();
  if (institutionType === "school") return true;
  if (institutionType && institutionType !== "school") return false;
  const haystack = [course.courseName, course.courseCode, course.campusName].filter(Boolean).join(" ").toLowerCase();
  return /beacon|mirai|grade|class|nursery|lkg|ukg|toddler|pyp|myp|eyp/.test(haystack);
}

function amountToConfirmAdmission(feeStatus?: LeadFeeStatus | null): number | null {
  if (!feeStatus) return null;
  const anThreshold = Number(feeStatus.an_threshold ?? feeStatus.twenty_five_pct ?? 0);
  const paidTowardCourse = Number(
    feeStatus.paid_toward_course ?? Math.max(
      0,
      Number(feeStatus.total_paid || 0) -
        Number(feeStatus.application_paid || 0) -
        Number(feeStatus.registration_paid || 0),
    ),
  );
  if (anThreshold <= 0) return null;
  return Math.max(0, anThreshold - paidTowardCourse);
}

function payableColumnLabel(payload: any): string {
  return isSchoolProposalPayload(payload) ? "Payable at admission" : "Confirm Admission";
}

function negativeInr(amount: number): string {
  const value = Math.round(Math.max(0, Number(amount || 0)));
  return value > 0 ? `- ${formatInr(value)}` : "-";
}

function pdfSafeText(value: unknown): string {
  return String(value ?? "-")
    .replace(/\u20b9/g, "Rs. ")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "-";
}

function pdfSafeLines(value: unknown): string {
  return String(value ?? "-")
    .replace(/\u20b9/g, "Rs. ")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || "-";
}

function payableBreakdownText(items: SchoolFeeItemWaiverAllocation[]): string {
  const parts = admissionPayableBreakdown(items).map((item) => `${item.label}: ${formatInr(item.amount)}`);
  return parts.length > 0 ? parts.join("; ") : "-";
}

function isBoardingSpecificFeeItem(item: SchoolFeeItem): boolean {
  return item.category === "hostel" || /boarder|boarding|hostel/i.test(`${item.code} ${item.name}`);
}

function normalizedTerm(value?: string | null): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function roundRupee(amount: number): number {
  return Math.round(Math.max(0, Number(amount || 0)));
}

function courseGradeRank(course: FeeCourseOption | null): number {
  if (!course) return Number.POSITIVE_INFINITY;
  const text = [course.courseName, course.courseCode].filter(Boolean).join(" ").toLowerCase();
  if (/\b(toddler|pre[-\s]?nursery|playgroup)\b/.test(text)) return -4;
  if (/\bnursery\b/.test(text)) return -3;
  if (/\blkg\b/.test(text)) return -2;
  if (/\bukg\b/.test(text)) return -1;
  const gradeMatch = text.match(/\b(?:grade|class|gr|cl)\s*[-:]?\s*(\d{1,2})\b/);
  if (gradeMatch) return Number(gradeMatch[1]);
  const codeMatch = text.match(/(?:^|[-_\s])(?:g|grade|class)?\s*(\d{1,2})(?:$|[-_\s])/);
  if (codeMatch) return Number(codeMatch[1]);
  return Number.POSITIVE_INFINITY;
}

function normalizeWaiverTypes(value: unknown): ChildWaiverType[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split("+")
      : [];
  const allowed = new Set<ChildWaiverType>(["sibling", "single_parent", "custom"]);
  return Array.from(new Set(values.filter((item): item is ChildWaiverType => allowed.has(item as ChildWaiverType))));
}

function selectedWaiverTypes(child: ChildDraft, canApplySiblingWaiver: boolean): ChildWaiverType[] {
  const rawTypes = child.waiverTypes?.length > 0 ? child.waiverTypes : normalizeWaiverTypes(child.waiverType);
  return rawTypes.filter((type) => type !== "sibling" || canApplySiblingWaiver);
}

function hasWaiverChoice(child: ChildDraft, canApplySiblingWaiver: boolean): boolean {
  return child.waiverType === "none" || selectedWaiverTypes(child, canApplySiblingWaiver).length > 0;
}

function mergeWaiverPresets(existing: Record<string, string>, preset: Record<string, string>): Record<string, string> {
  const merged = { ...existing };
  for (const [key, amount] of Object.entries(preset)) {
    merged[key] = String(Math.max(Number(merged[key] || 0), Number(amount || 0)));
  }
  return merged;
}

function waiverTypesLabel(types: ChildWaiverType[]): string {
  const labels: Record<ChildWaiverType, string> = {
    sibling: "Sibling discount",
    single_parent: "Single parent waiver",
    custom: "Custom waiver",
  };
  return types.map((type) => labels[type]).join(" + ") || "Waiver";
}

function feePeriodSortRank(label: string): number {
  const normalized = String(label || "").toLowerCase();
  const quarterMatch = normalized.match(/^q(\d+)$/);
  if (quarterMatch) return 100 + Number(quarterMatch[1]);
  const yearMatch = normalized.match(/^year\s+(\d+)$/);
  if (yearMatch) return 200 + Number(yearMatch[1]);
  const semMatch = normalized.match(/^sem\s+(\d+)$/);
  if (semMatch) return 300 + Number(semMatch[1]);
  if (/one-time|one time|admission|registration/.test(normalized)) return 10;
  return 900;
}

function groupWaiverHeadersByPeriod(headers: GroupedSchoolFeeHeader[]) {
  const groups = new Map<string, { label: string; total: number; headers: GroupedSchoolFeeHeader[] }>();
  for (const header of headers) {
    const label = header.periodLabel || "Fee period";
    const existing = groups.get(label);
    if (existing) {
      existing.total += Number(header.total || 0);
      existing.headers.push(header);
    } else {
      groups.set(label, { label, total: Number(header.total || 0), headers: [header] });
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    const rankDiff = feePeriodSortRank(a.label) - feePeriodSortRank(b.label);
    if (rankDiff !== 0) return rankDiff;
    return a.label.localeCompare(b.label);
  });
}

function isTuitionHeader(header: { label: string; category: string; items?: SchoolFeeItem[] }): boolean {
  return header.category === "tuition" || /tuition/i.test(`${header.label} ${header.category}`);
}

function isBoardingQuarterHeader(header: { label: string; category: string; items?: SchoolFeeItem[] }): boolean {
  if (header.category !== "hostel") return false;
  return (header.items || []).some((item) => /^q[1-4]$/.test(normalizedTerm(item.term)));
}

function isLastQuarterTuitionHeader(header: { label: string; category: string; items?: SchoolFeeItem[] }): boolean {
  if (!isTuitionHeader(header)) return false;
  return (header.items || []).some((item) => normalizedTerm(item.term) === "q4");
}

function buildSchoolWaiverPreset(
  headers: { key: string; label: string; category: string; total: number; items?: SchoolFeeItem[] }[],
  waiverTypesInput: ChildWaiverType[] | ChildDraft["waiverType"],
  course?: FeeCourseOption | null,
): Record<string, string> {
  const waiverTypes = normalizeWaiverTypes(waiverTypesInput);
  if (waiverTypes.length === 0) return {};
  const preset: Record<string, string> = {};
  for (const header of headers) {
    if (isNonWaivableFeeHeader(header)) continue;
    let amount = 0;
    if (waiverTypes.includes("sibling") && isLastQuarterTuitionHeader(header)) {
      amount += Number(header.total || 0);
    }
    if (waiverTypes.includes("single_parent") && isBoardingQuarterHeader(header)) {
      amount += roundRupee(Number(header.total || 0) * 0.25);
    }
    amount = Math.min(Number(header.total || 0), amount);
    if (amount > 0) {
      preset[header.key] = String(roundRupee(amount));
    }
  }
  return preset;
}

function feeHeaderBaseApprovalLimit(header: { total: number }): number {
  return Math.round(Number(header.total || 0) * 0.10 * 100) / 100;
}

function feeHeaderRuleApprovalLimit(
  header: { label: string; category: string; total: number; items?: SchoolFeeItem[] },
  waiverTypesInput: ChildWaiverType[] | ChildDraft["waiverType"],
  course?: FeeCourseOption | null,
): { amount: number; source: "rule" | "general" } {
  const waiverTypes = normalizeWaiverTypes(waiverTypesInput);
  let ruleAmount = 0;

  if (waiverTypes.includes("sibling") && isLastQuarterTuitionHeader(header)) {
    ruleAmount += Number(header.total || 0);
  }

  if (waiverTypes.includes("single_parent") && isBoardingQuarterHeader(header)) {
    ruleAmount += roundRupee(Number(header.total || 0) * 0.25);
  }

  if (ruleAmount > 0) {
    return {
      amount: Math.min(Number(header.total || 0), ruleAmount),
      source: "rule",
    };
  }

  return { amount: feeHeaderBaseApprovalLimit(header), source: "general" };
}

function isNonWaivableFeeHeader(header: { label: string; category?: string; items?: SchoolFeeItem[] }): boolean {
  const text = [
    header.label,
    header.category,
    ...(header.items || []).flatMap((item) => [item.code, item.name, item.category]),
  ].filter(Boolean).join(" ");
  return /\b(application|form|registration)\b/i.test(text);
}

function sanitizeFeeHeaderWaivers(
  child: ChildDraft,
  headers: { key: string; label: string; category?: string; items?: SchoolFeeItem[] }[],
  waiverTypes: ChildWaiverType[] = normalizeWaiverTypes(child.waiverTypes?.length ? child.waiverTypes : child.waiverType),
): Record<string, string> {
  if (waiverTypes.length === 0) return {};
  const allowedKeys = new Set(headers.filter((header) => !isNonWaivableFeeHeader(header)).map((header) => header.key));
  return Object.fromEntries(
    Object.entries(child.feeHeaderWaivers).filter(([key, value]) => allowedKeys.has(key) && Number(value || 0) > 0),
  );
}

function proposalRecipientName(proposal: SchoolFeeProposalRow, fallbackLeadName: string): string {
  const payload = proposal.proposal || {};
  const children = Array.isArray(payload.children) ? payload.children : [];
  return cleanDisplayName(payload.lead?.applicant_name)
    || cleanDisplayName(children.find((child: any) => cleanDisplayName(child.applicant_name))?.applicant_name)
    || cleanDisplayName(payload.lead?.name)
    || cleanDisplayName(fallbackLeadName)
    || "Applicant";
}

const COLLEGE_PROPOSAL_REVIEW_NOTE = "Please review the eligibility criteria and fee inclusions/exclusions before confirming admission.";

function brandForProposal(proposal: SchoolFeeProposalRow): ProposalBrand {
  const child = proposal.proposal?.children?.[0] || {};
  const brand = brandForStudentOwner({
    campusName: child.campus_name,
    courseName: child.course_name || child.class_name,
    courseCode: child.course_code,
    institutionName: child.institution_name,
    institutionType: child.course_type,
  });
  const normalized = brand.name.toLowerCase();
  if (normalized.includes("mirai")) {
    return { ...brand, primaryColor: "#77966D", accentColor: "#F2F6EF" };
  }
  if (normalized.includes("beacon")) {
    return { ...brand, primaryColor: "#0044FF", accentColor: "#EEF4FF" };
  }
  return { ...brand, primaryColor: "#0035C5", accentColor: "#EEF3FF" };
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function imageAssetToPngDataUrl(src: string): Promise<string> {
  if (src.startsWith("data:")) return src;
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Logo fetch failed: ${response.status}`);
  const blob = await response.blob();
  if (!blob.type.includes("svg")) {
    const dataUrl = await readBlobAsDataUrl(blob);
    return dataUrl;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || 360;
    canvas.height = image.naturalHeight || 120;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function imageAssetToPdfImage(src: string): Promise<PdfImageAsset> {
  const dataUrl = await imageAssetToPngDataUrl(src);
  const image = await loadImage(dataUrl);
  return {
    dataUrl,
    width: image.naturalWidth || image.width || 1,
    height: image.naturalHeight || image.height || 1,
  };
}

function containedImageRect(image: PdfImageAsset, boxX: number, boxY: number, boxW: number, boxH: number) {
  const scale = Math.min(boxW / image.width, boxH / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: boxX + (boxW - width) / 2,
    y: boxY + (boxH - height) / 2,
    width,
    height,
  };
}

function paidFeeTermRank(term: string): number {
  const normalized = String(term || "").toLowerCase();
  const yearMatch = normalized.match(/^year[_-]?(\d+)$/);
  if (yearMatch) return Number(yearMatch[1]);
  const semMatch = normalized.match(/^(sem|semester)[_-]?(\d+)$/);
  if (semMatch) return Number(semMatch[2]);
  if (/admission|registration|one_time/.test(normalized)) return 0;
  return 999;
}

function allocatePaidFees(
  items: SchoolFeeItemWaiverAllocation[],
  payments: LeadPaymentRow[],
): { items: SchoolFeeItemWaiverAllocation[]; paidTotal: number; admissionPaidTotal: number; grayquestPaidTotal: number } {
  const allocated = items.map((item) => ({ ...item, paid: 0 }));
  const confirmed = payments.filter((payment) => payment.status === "confirmed");
  const appPayments = confirmed.filter((payment) => payment.type === "application_fee");
  const otherPayments = confirmed.filter((payment) => ["token_fee", "registration_fee", "other"].includes(payment.type));

  const applyToItem = (item: SchoolFeeItemWaiverAllocation, amount: number) => {
    const cap = Math.max(0, Number(item.net ?? 0) - Number(item.paid || 0));
    const take = Math.min(cap, Math.max(0, amount));
    item.paid = Number(item.paid || 0) + take;
    return take;
  };

  const applicationTarget =
    allocated.find((item) => /FORM|APPLICATION/i.test(`${item.code} ${item.name}`)) ||
    allocated.find((item) => String(item.term).toLowerCase() === "year_1" && /SEAT|BLOCK/i.test(`${item.code} ${item.name}`));
  if (applicationTarget) {
    for (const payment of appPayments) {
      applyToItem(applicationTarget, Number(payment.amount || 0));
    }
  }

  const tokenTargets = allocated
    .filter((item) => /^year[_-]?\d+$/i.test(item.term) || /^(sem|semester)[_-]?\d+$/i.test(item.term))
    .sort((a, b) => paidFeeTermRank(a.term) - paidFeeTermRank(b.term));
  let targetIndex = 0;
  for (const payment of otherPayments) {
    let remaining = Number(payment.amount || 0);
    while (remaining > 0 && targetIndex < tokenTargets.length) {
      const taken = applyToItem(tokenTargets[targetIndex], remaining);
      remaining -= taken;
      if (taken === 0 || Number(tokenTargets[targetIndex].paid || 0) >= Number(tokenTargets[targetIndex].net || 0)) {
        targetIndex += 1;
      }
    }
  }

  let paidTotal = 0;
  let admissionPaidTotal = 0;
  let grayquestPaidTotal = 0;
  for (const item of allocated) {
    const paid = Number(item.paid || 0);
    paidTotal += paid;
    if (isAdmissionPayableFeeItem(item)) {
      admissionPaidTotal += paid;
    } else if (item.category !== "transport" && item.category !== "hostel") {
      grayquestPaidTotal += paid;
    }
  }

  return { items: allocated, paidTotal, admissionPaidTotal, grayquestPaidTotal };
}

export function SchoolFeeProposalDialog({ open, onOpenChange, lead }: SchoolFeeProposalDialogProps) {
  const { user, profile, role } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revisingProposal, setRevisingProposal] = useState<SchoolFeeProposalRow | null>(null);
  const [proposalsTableMissing, setProposalsTableMissing] = useState(false);
  const [courses, setCourses] = useState<FeeCourseOption[]>([]);
  const [proposals, setProposals] = useState<SchoolFeeProposalRow[]>([]);
  const [relatedLeads, setRelatedLeads] = useState<RelatedLeadOption[]>([]);
  const [leadPaymentsByLeadId, setLeadPaymentsByLeadId] = useState<Record<string, LeadPaymentRow[]>>({});
  const [applicationNamesByLeadId, setApplicationNamesByLeadId] = useState<Record<string, string>>({});
  const [feeStatusByLeadId, setFeeStatusByLeadId] = useState<Record<string, LeadFeeStatus>>({});
  const [issuerDetails, setIssuerDetails] = useState<ProposalIssuerDetails | null>(null);
  const [children, setChildren] = useState<ChildDraft[]>([emptyChild()]);
  const [fullYearWaiverAmount, setFullYearWaiverAmount] = useState("");
  const [note, setNote] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  const isSuperAdmin = role === "super_admin";
  const canCreate = ["super_admin", "principal", "counsellor", "admission_head", "campus_admin"].includes(role || "");

  const courseById = useMemo(() => new Map(courses.map((course) => [course.courseId, course])), [courses]);
  const relatedLeadById = useMemo(() => new Map(relatedLeads.map((item) => [item.id, item])), [relatedLeads]);
  const coursesByCampus = useMemo(() => {
    const grouped = new Map<string, FeeCourseOption[]>();
    for (const course of courses) {
      const label = course.campusName || "Other Campus";
      grouped.set(label, [...(grouped.get(label) || []), course]);
    }
    return Array.from(grouped.entries()).map(([campusName, options]) => ({ campusName, options }));
  }, [courses]);

  const waivableItemsForChild = (child: ChildDraft, course: FeeCourseOption | null): SchoolFeeItem[] => {
    if (!course) return [];
    const hasBoarding = Boolean(child.boardingKey && child.boardingKey !== "none");
    const baseItems = course.snapshot.items.filter((item) => {
      if (item.category === "transport" || item.category === "hostel") return false;
      if (isBoardingSpecificFeeItem(item) && !hasBoarding) return false;
      return true;
    });
    if (!isSchoolCourseOption(course)) return baseItems;
    const boarding = course.snapshot.boardingOptions.find((option) => option.key === child.boardingKey) || null;
    const transport = course.snapshot.transportOptions.find((option) => option.key === child.transportKey) || null;
    return [...baseItems, ...(boarding?.items || []), ...(transport?.items || [])];
  };

  const waiverHeadersForChild = (child: ChildDraft, course: FeeCourseOption | null) =>
    groupFeeItemsByHeader(waivableItemsForChild(child, course)).filter((header) => !isNonWaivableFeeHeader(header));

  const proposalCandidateCount = useMemo(
    () => children.filter((child) => courseById.has(child.courseId)).length,
    [children, courseById],
  );
  const canApplySiblingWaiver = proposalCandidateCount >= 2;
  const siblingWaiverChildId = useMemo(() => {
    if (!canApplySiblingWaiver) return null;
    return children.reduce<{ id: string | null; rank: number; index: number }>((youngest, child, index) => {
      const course = courseById.get(child.courseId) || null;
      if (!course || !isSchoolCourseOption(course)) return youngest;
      const rank = courseGradeRank(course);
      if (rank < youngest.rank || (rank === youngest.rank && index < youngest.index)) {
        return { id: child.id, rank, index };
      }
      return youngest;
    }, { id: null, rank: Number.POSITIVE_INFINITY, index: Number.POSITIVE_INFINITY }).id;
  }, [children, courseById, canApplySiblingWaiver]);

  const childSummaries = useMemo(() => children.map((child) => {
    const course = courseById.get(child.courseId) || null;
    const linkedLead = relatedLeadById.get(child.leadId || lead.id) || null;
    const linkedLeadId = linkedLead?.id || child.leadId || lead.id;
    const transport = course?.snapshot.transportOptions.find((option) => option.key === child.transportKey) || null;
    const boarding = course?.snapshot.boardingOptions.find((option) => option.key === child.boardingKey) || null;
    const feeItemsForWaiver = waivableItemsForChild(child, course);
    const feeHeaderGroups = groupFeeItemsByHeader(feeItemsForWaiver);
    const canApplySiblingForChild = canApplySiblingWaiver && child.id === siblingWaiverChildId;
    const waiverTypes = selectedWaiverTypes(child, canApplySiblingForChild);
    const feeHeaderWaivers = sanitizeFeeHeaderWaivers(child, feeHeaderGroups, waiverTypes);
    const feeHeadWaiverOverLimit = feeHeaderGroups.some((header) =>
      Number(feeHeaderWaivers[header.key] || 0) > feeHeaderRuleApprovalLimit(header, waiverTypes, course).amount,
    );
    const headerWaiverAllocation = allocateFeeHeaderWaivers(feeItemsForWaiver, feeHeaderWaivers);
    const paidAllocation = allocatePaidFees(
      headerWaiverAllocation.items,
      leadPaymentsByLeadId[linkedLeadId] || [],
    );
    const waiverAmount = headerWaiverAllocation.waiverTotal;
    const selectedBaseSnapshot = buildSchoolFeeSnapshot(feeItemsForWaiver.filter((item) => item.category !== "transport" && item.category !== "hostel"));
    const baseTotals = computeSchoolProposalChildTotals({
      oneTime: selectedBaseSnapshot.oneTime,
      recurringBase: selectedBaseSnapshot.recurringBase,
      firstQuarterBase: selectedBaseSnapshot.firstQuarterBase,
      transportAnnual: transport?.amount || 0,
      transportFirstQuarter: optionFirstQuarter(transport),
      boardingAnnual: boarding?.amount || 0,
      boardingFirstQuarter: optionFirstQuarter(boarding),
      waiverAmount,
      admissionWaiverAmount: headerWaiverAllocation.admissionWaiverTotal,
      grayquestWaiverAmount: headerWaiverAllocation.grayquestWaiverTotal,
      admissionPaidAmount: paidAllocation.admissionPaidTotal,
      grayquestPaidAmount: paidAllocation.grayquestPaidTotal,
    });
    const isSchoolProgram = isSchoolCourseOption(course);
    const confirmationPayable = !isSchoolProgram ? amountToConfirmAdmission(feeStatusByLeadId[linkedLeadId]) : null;
    const totals = confirmationPayable == null
      ? baseTotals
      : { ...baseTotals, admissionPayable: confirmationPayable };

    return { child, linkedLead, course, transport, boarding, waiverTypes, waiverAmount, feeHeaderWaivers, paidAllocation, headerWaiverAllocation, feeHeadWaiverOverLimit, totals, isSchoolProgram, confirmationPayable };
  }), [children, courseById, relatedLeadById, leadPaymentsByLeadId, feeStatusByLeadId, lead.id, isSuperAdmin, canApplySiblingWaiver, siblingWaiverChildId]);

  const selectedChildren = childSummaries.filter((summary) => summary.course);
  const hasMissingWaiverType = selectedChildren.some((summary) => !hasWaiverChoice(summary.child, canApplySiblingWaiver && summary.child.id === siblingWaiverChildId));
  const hasMissingTransport = selectedChildren.some((summary) => !summary.child.transportKey);
  const hasMissingBoarding = selectedChildren.some((summary) => !summary.child.boardingKey);
  const childWaiverTotal = childSummaries.reduce((sum, summary) => sum + summary.waiverAmount, 0);
  const childPaidTotal = childSummaries.reduce((sum, summary) => sum + summary.paidAllocation.paidTotal, 0);
  const hasAnyWaiverSelected = selectedChildren.some((summary) => summary.waiverTypes.length > 0);
  const fullYearWaiver = hasAnyWaiverSelected ? Math.max(0, Number(fullYearWaiverAmount || 0)) : 0;
  const annualTotal = childSummaries.reduce((sum, summary) => sum + summary.totals.annualBeforeWaiver, 0);
  const annualNetBeforeFullYearWaiver = childSummaries.reduce((sum, summary) => sum + summary.totals.annualAfterWaiver, 0);
  const annualNetTotal = Math.max(0, annualNetBeforeFullYearWaiver - fullYearWaiver - childPaidTotal);
  const admissionPayableTotal = childSummaries.reduce((sum, summary) => sum + summary.totals.admissionPayable, 0);
  const grayquestPrincipalTotal = Math.max(
    0,
    childSummaries.reduce((sum, summary) => sum + summary.totals.grayquestPrincipal, 0) - fullYearWaiver,
  );
  const waiverTotal = childWaiverTotal + fullYearWaiver;
  const waiverPercent = annualTotal > 0 ? (waiverTotal / annualTotal) * 100 : 0;
  const fullYearWaiverOverLimit = fullYearWaiver > Math.round(annualNetBeforeFullYearWaiver * 0.10 * 100) / 100;
  const requiresSuperAdminApproval = childSummaries.some((summary) => summary.feeHeadWaiverOverLimit) || fullYearWaiverOverLimit;
  const autoApprovalAllowed = !requiresSuperAdminApproval;
  const selectedChildrenAreSchool = selectedChildren.length > 0 && selectedChildren.every((summary) => summary.isSchoolProgram);
  const payableMetricLabel = selectedChildrenAreSchool ? "Admission payable" : "Confirm admission (AN)";
  const canApproveProposal = (proposal: SchoolFeeProposalRow) =>
    isSuperAdmin && proposal.status === "pending_super_admin";

  const currentIssuerDetails = (): ProposalIssuerDetails => ({
    user_id: user?.id || null,
    name: issuerDetails?.name || profile?.display_name || user?.email || "UniOS User",
    employee_id: issuerDetails?.employee_id || null,
  });

  const proposalIssuerDetails = (proposal: SchoolFeeProposalRow): ProposalIssuerDetails => {
    const savedIssuer = proposal.proposal?.issued_by || proposal.proposal?.issuer || null;
    const fallback = currentIssuerDetails();
    return {
      user_id: savedIssuer?.user_id || fallback.user_id,
      name: savedIssuer?.name || savedIssuer?.full_name || fallback.name,
      employee_id: savedIssuer?.employee_id || savedIssuer?.employee_number || fallback.employee_id,
    };
  };

  const fetchData = async () => {
    setLoading(true);
    const currentLeadFilter = lead.phone
      ? `id.eq.${lead.id},phone.eq.${lead.phone},guardian_phone.eq.${lead.phone}`
      : `id.eq.${lead.id}`;
    const [
      { data: feeRows, error: feeError },
      { data: directProposalRows, error: directProposalError },
      { data: linkedProposalRows, error: linkedProposalError },
      { data: relatedLeadRows, error: relatedLeadError },
    ] = await Promise.all([
      supabase
        .from("fee_structures")
        .select(`
          id, course_id, session_id, version, is_active, created_at,
          courses:course_id(id, name, code, duration_years, type,
            departments!inner(name,
              institutions!inner(name, type,
                campuses!inner(name)
              )
            )
          ),
          admission_sessions:session_id(name),
          fee_structure_items(term, amount, fee_codes:fee_code_id(code, name, category))
        `)
        .eq("is_active", true),
      supabase
        .from("fee_proposals" as any)
        .select("*")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("fee_proposals" as any)
        .select("*")
        .contains("linked_lead_ids", [lead.id])
        .order("created_at", { ascending: false }),
      supabase
        .from("leads")
        .select("id, name, phone, guardian_name, guardian_phone, stage")
        .or(currentLeadFilter)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    if (relatedLeadError) {
      setRelatedLeads([{ id: lead.id, name: lead.name, phone: lead.phone || null, guardianName: null, guardianPhone: null, stage: null }]);
      setLeadPaymentsByLeadId({});
      setApplicationNamesByLeadId({});
      setFeeStatusByLeadId({});
    } else {
      const rows = ((relatedLeadRows || []) as any[]).map((row) => ({
        id: row.id,
        name: row.name || "Unnamed lead",
        phone: row.phone || null,
        guardianName: row.guardian_name || null,
        guardianPhone: row.guardian_phone || null,
        stage: row.stage || null,
      }));
      if (!rows.some((row) => row.id === lead.id)) {
        rows.unshift({ id: lead.id, name: lead.name, phone: lead.phone || null, guardianName: null, guardianPhone: null, stage: null });
      }
      setRelatedLeads(rows);
      const leadIds = Array.from(new Set(rows.map((row) => row.id)));
      const [{ data: paymentRows }, { data: applicationRows }, feeStatusResults] = await Promise.all([
        supabase
          .from("lead_payments")
          .select("id, lead_id, type, amount, status")
          .in("lead_id", leadIds)
          .eq("status", "confirmed"),
        supabase
          .from("applications")
          .select("lead_id, full_name")
          .in("lead_id", leadIds)
          .order("updated_at", { ascending: false }),
        Promise.all(
          leadIds.map(async (leadId) => {
            const { data } = await supabase.rpc("lead_fee_status" as any, { _lead_id: leadId });
            return [leadId, data || null] as const;
          }),
        ),
      ]);
      const paymentsByLead = ((paymentRows || []) as LeadPaymentRow[]).reduce<Record<string, LeadPaymentRow[]>>((acc, payment) => {
        acc[payment.lead_id] = [...(acc[payment.lead_id] || []), payment];
        return acc;
      }, {});
      const applicationNamesByLead = ((applicationRows || []) as ApplicationNameRow[]).reduce<Record<string, string>>((acc, application) => {
        const leadId = application.lead_id || "";
        const fullName = cleanDisplayName(application.full_name);
        if (leadId && fullName && !acc[leadId]) acc[leadId] = fullName;
        return acc;
      }, {});
      const feeStatusByLead = feeStatusResults.reduce<Record<string, LeadFeeStatus>>((acc, [leadId, status]) => {
        if (status) acc[leadId] = status as LeadFeeStatus;
        return acc;
      }, {});
      setLeadPaymentsByLeadId(paymentsByLead);
      setApplicationNamesByLeadId(applicationNamesByLead);
      setFeeStatusByLeadId(feeStatusByLead);
    }

    if (feeError) {
      toast({ title: "Failed to load fees", description: feeError.message, variant: "destructive" });
    } else {
      const mapped = ((feeRows || []) as any[])
        .map((row) => {
          const items: SchoolFeeItem[] = (row.fee_structure_items || []).map((item: any) => ({
            code: item.fee_codes?.code || "",
            name: item.fee_codes?.name || "Fee",
            category: item.fee_codes?.category || "other",
            term: item.term,
            amount: Number(item.amount || 0),
          }));
          const course = row.courses;
          const institution = course?.departments?.institutions;
          return {
            courseId: row.course_id,
            courseName: course?.name || "Course",
            courseCode: course?.code || "",
            courseType: course?.type || "",
            institutionType: institution?.type || "",
            durationYears: Number(course?.duration_years || 0),
            campusName: institution?.campuses?.name || "",
            institutionName: institution?.name || "",
            sessionId: row.session_id,
            sessionName: row.admission_sessions?.name || "",
            feeVersion: row.version || "",
            siblingFeeVersion: null,
            createdAt: row.created_at || "",
            snapshot: buildSchoolFeeSnapshot(items),
            siblingSnapshot: null,
          };
        })
        .sort((a, b) => {
          const rankDiff = feeVersionRank(a.feeVersion) - feeVersionRank(b.feeVersion);
          if (rankDiff !== 0) return rankDiff;
          return Date.parse(b.createdAt || "0") - Date.parse(a.createdAt || "0");
        });
      const mappedByCourse = mapped.reduce((map, option) => {
        const key = `${option.courseId}:${option.sessionId}`;
        map.set(key, [...(map.get(key) || []), option]);
        return map;
      }, new Map<string, FeeCourseOption[]>());
      const deduped = Array.from(
        mapped
          .filter((option) => !option.feeVersion.toLowerCase().includes("existing_parent"))
          .reduce((map, option) => {
          const key = option.courseId;
          if (!map.has(key)) {
            const alternate = (mappedByCourse.get(`${option.courseId}:${option.sessionId}`) || [])
              .filter((candidate) => candidate.feeVersion !== option.feeVersion)
              .sort((a, b) =>
                siblingFeeVersionRank(a.feeVersion, option.feeVersion) - siblingFeeVersionRank(b.feeVersion, option.feeVersion),
              )[0];
            map.set(key, alternate && siblingFeeVersionRank(alternate.feeVersion, option.feeVersion) < 99
              ? { ...option, siblingFeeVersion: alternate.feeVersion, siblingSnapshot: alternate.snapshot }
              : option);
          }
          return map;
        }, new Map<string, FeeCourseOption>()).values(),
      ).sort((a, b) =>
        `${a.campusName} ${a.institutionName} ${a.courseCode || a.courseName}`.localeCompare(
          `${b.campusName} ${b.institutionName} ${b.courseCode || b.courseName}`,
        ),
      );
      setCourses(deduped);
      setChildren((previous) => previous.map((child, index) => ({
        ...child,
        leadId: child.leadId || (index === 0 ? lead.id : ""),
        name: child.name || (index === 0 ? lead.name || "" : ""),
        courseId: child.courseId || "",
      })));
    }

    const proposalError = directProposalError || linkedProposalError;
    if (proposalError) {
      const tableMissing = /fee_proposals|schema cache|could not find the table|linked_lead_ids/i.test(proposalError.message || "");
      setProposalsTableMissing(tableMissing);
      if (tableMissing) {
        setProposals([]);
      } else {
        toast({ title: "Failed to load proposals", description: proposalError.message, variant: "destructive" });
      }
    } else {
      setProposalsTableMissing(false);
      const byId = new Map<string, SchoolFeeProposalRow>();
      ([...(directProposalRows || []), ...(linkedProposalRows || [])] as SchoolFeeProposalRow[])
        .forEach((proposal) => byId.set(proposal.id, proposal));
      setProposals(Array.from(byId.values()).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) fetchData();
  }, [open, lead.id]);

  useEffect(() => {
    if (!open) return;
    try {
      setShowGuide(window.localStorage.getItem(feeProposalGuideStorageKey(user?.id)) !== "1");
    } catch {
      setShowGuide(true);
    }
  }, [open, user?.id]);

  const dismissGuide = () => {
    setShowGuide(false);
    try {
      window.localStorage.setItem(feeProposalGuideStorageKey(user?.id), "1");
    } catch {
      // localStorage is optional; the guide can still be dismissed for this session.
    }
  };

  useEffect(() => {
    if (!open || !user?.id) {
      setIssuerDetails(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const [profileRes, employeeRes] = await Promise.all([
        supabase
          .from("profiles" as any)
          .select("display_name, employee_id")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("employee_profiles")
          .select("display_name, first_name, middle_name, last_name, employee_number")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const employee = employeeRes.data as any;
      const profileRow = profileRes.data as any;
      const fullName = cleanDisplayName(
        employee?.display_name ||
          [employee?.first_name, employee?.middle_name, employee?.last_name].filter(Boolean).join(" ") ||
          profileRow?.display_name ||
          profile?.display_name ||
          user.email,
      );
      setIssuerDetails({
        user_id: user.id,
        name: fullName || "UniOS User",
        employee_id: cleanDisplayName(employee?.employee_number || profileRow?.employee_id) || null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, user?.id, profile?.display_name, user?.email]);

  const updateChild = (id: string, patch: Partial<ChildDraft>) => {
    setChildren((previous) => previous.map((child) => child.id === id ? { ...child, ...patch } : child));
  };

  const updateChildWaiverTypes = (
    child: ChildDraft,
    nextTypes: ChildWaiverType[],
    headers: ReturnType<typeof waiverHeadersForChild>,
    course: FeeCourseOption | null,
  ) => {
    const isSchoolProgram = isSchoolCourseOption(course);
    const effectiveTypes = normalizeWaiverTypes(nextTypes)
      .filter((type) => type === "custom" || isSchoolProgram)
      .filter((type) => type !== "sibling" || (canApplySiblingWaiver && child.id === siblingWaiverChildId));
    const ruleTypes = effectiveTypes.filter((type) => type !== "custom");
    const rulePreset = isSchoolProgram ? buildSchoolWaiverPreset(headers, ruleTypes, course) : {};
    updateChild(child.id, {
      waiverType: effectiveTypes.length > 0 ? "custom" : "",
      waiverTypes: effectiveTypes,
      feeHeaderWaivers: effectiveTypes.includes("custom")
        ? mergeWaiverPresets(child.feeHeaderWaivers, rulePreset)
        : rulePreset,
    });
  };

  const updateChildHeaderWaiver = (childId: string, headerKey: string, value: string) => {
    setChildren((previous) => previous.map((child) => {
      if (child.id !== childId) return child;
      const course = courseById.get(child.courseId) || null;
      const header = waiverHeadersForChild(child, course).find((item) => item.key === headerKey);
      const activeWaiverTypes = selectedWaiverTypes(child, canApplySiblingWaiver && child.id === siblingWaiverChildId);
      if (!header || activeWaiverTypes.length === 0 || isNonWaivableFeeHeader(header)) return child;
      const max = Number(header?.total || 0);
      const nextValue = value === "" ? "" : String(Math.min(max, Math.max(0, Number(value || 0))));
      const nextWaivers = { ...child.feeHeaderWaivers, [headerKey]: nextValue };
      if (header?.legacyKey) delete nextWaivers[header.legacyKey];
      return { ...child, feeHeaderWaivers: nextWaivers };
    }));
  };

  const buildPayload = () => ({
    lead: { id: lead.id, name: lead.name, applicant_name: applicationNamesByLeadId[lead.id] || null, phone: lead.phone || null },
    issued_by: currentIssuerDetails(),
    linked_lead_ids: Array.from(new Set(selectedChildren.map((summary) => summary.linkedLead?.id || summary.child.leadId).filter(Boolean))),
    linked_leads: Array.from(
      new Map(
        selectedChildren
          .map((summary) => summary.linkedLead)
          .filter(Boolean)
          .map((item) => [item!.id, item]),
      ).values(),
    ),
    generated_at: new Date().toISOString(),
    generated_by_role: role || null,
    children: selectedChildren.map((summary, index) => ({
      lead_id: summary.linkedLead?.id || summary.child.leadId || null,
      lead_name: summary.linkedLead?.name || null,
      applicant_name: applicationNamesByLeadId[summary.linkedLead?.id || summary.child.leadId || lead.id] || null,
      lead_phone: summary.linkedLead?.phone || null,
      name: summary.child.name.trim() || (selectedChildren.length > 1 ? `Student ${index + 1}` : summary.linkedLead?.name || `Student ${index + 1}`),
      course_id: summary.course?.courseId,
      class_name: summary.course?.courseName,
      course_name: summary.course?.courseName,
      course_code: summary.course?.courseCode,
      course_type: summary.course?.courseType,
      institution_type: summary.course?.institutionType,
      duration_years: summary.course?.durationYears,
      institution_name: summary.course?.institutionName,
      campus_name: summary.course?.campusName,
      session_id: summary.course?.sessionId,
      session_name: summary.course?.sessionName,
      fee_items: summary.paidAllocation.items,
      fee_header_waivers: summary.feeHeaderWaivers,
      paid: summary.paidAllocation.paidTotal > 0 ? {
        amount: summary.paidAllocation.paidTotal,
        admission_paid: summary.paidAllocation.admissionPaidTotal,
        grayquest_paid: summary.paidAllocation.grayquestPaidTotal,
      } : null,
      transport: summary.transport ? { key: summary.transport.key, label: transportProposalLabel(summary.transport), annual: summary.transport.amount } : null,
      boarding: summary.boarding ? { key: summary.boarding.key, label: summary.boarding.label, annual: summary.boarding.amount } : null,
      waiver: summary.waiverAmount > 0 ? {
        type: summary.waiverTypes.join("+") || "custom",
        types: summary.waiverTypes,
        label: waiverTypesLabel(summary.waiverTypes),
        amount: summary.waiverAmount,
        by_header: summary.feeHeaderWaivers,
        policy_notes: [
          summary.waiverTypes.includes("single_parent")
            ? "Single parent waiver: 25% relaxation on boarding fee for the academic year; confirm continuation or removal before applying in the next academic year."
            : null,
          summary.waiverTypes.includes("sibling")
            ? "Sibling waiver: last quarter tuition fee removed for the youngest child only."
            : null,
        ].filter(Boolean),
      } : null,
      admission_confirmation: !summary.isSchoolProgram ? {
        payable: summary.totals.admissionPayable,
        source: summary.confirmationPayable == null ? "proposal_fallback" : "lead_fee_status_an_threshold",
        note: "Amount required to generate the admission number.",
      } : null,
      totals: summary.totals,
    })),
    full_year_payment: {
      enabled: true,
      extra_waiver_amount: fullYearWaiver,
      payable_at_admission: annualNetTotal,
    },
    grayquest: {
      enabled: true,
      subject_to_approval: true,
      principal_amount: grayquestPrincipalTotal,
      note: "Applicable only on the remaining recurring fee. First installment and one-time fee are payable at admission.",
    },
    totals: {
      annual_total: annualTotal,
      annual_net_total: annualNetTotal,
      admission_payable_total: admissionPayableTotal,
      grayquest_principal_total: grayquestPrincipalTotal,
      waiver_total: waiverTotal,
      paid_total: childPaidTotal,
      waiver_percent: waiverPercent,
    },
    note: note.trim() || null,
  });

  const saveProposal = async () => {
    if (!canCreate) {
      toast({ title: "You do not have permission to create proposals", variant: "destructive" });
      return;
    }
    if (selectedChildren.length === 0) {
      toast({ title: "Add at least one student/program", variant: "destructive" });
      return;
    }
    if (hasMissingWaiverType) {
      toast({ title: "Waiver selection is required", description: "Select No waiver or one or more applicable waivers for each student/program.", variant: "destructive" });
      return;
    }
    if (hasMissingTransport) {
      toast({ title: "Transport selection is required", description: "Select No transport or a transport option for each student/program.", variant: "destructive" });
      return;
    }
    if (hasMissingBoarding) {
      toast({ title: "Boarding selection is required", description: "Select No boarding or a boarding option for each student/program.", variant: "destructive" });
      return;
    }
    if (proposalsTableMissing) {
      toast({
        title: "Migration required",
        description: "Apply the fee proposal migrations before saving proposals.",
        variant: "destructive",
      });
      return;
    }

    const status = isSuperAdmin || autoApprovalAllowed
      ? "approved"
      : "pending_super_admin";
    const linkedLeadIds = Array.from(new Set(selectedChildren.map((summary) => summary.linkedLead?.id || summary.child.leadId).filter(Boolean)));
    const revisionGroupId = revisingProposal?.revision_group_id || proposals[0]?.revision_group_id || crypto.randomUUID();
    const revisionNumber = Math.max(0, ...proposals.map((proposal) => Number(proposal.revision_number || proposal.proposal?.revision?.number || 1))) + 1;
    const previousProposalIds = proposals.map((proposal) => proposal.id);

    setSaving(true);
    const payload: any = buildPayload();
    payload.revision = {
      group_id: revisionGroupId,
      number: previousProposalIds.length === 0 ? 1 : revisionNumber,
      revised_from: revisingProposal?.id || previousProposalIds[0] || null,
    };
    const { data: insertedProposal, error } = await supabase.from("fee_proposals" as any).insert({
      lead_id: lead.id,
      linked_lead_ids: linkedLeadIds,
      status,
      proposal: payload,
      revision_group_id: revisionGroupId,
      revision_number: payload.revision.number,
      is_current: true,
      total_children: selectedChildren.length,
      annual_total: annualTotal,
      annual_net_total: annualNetTotal,
      admission_payable_total: admissionPayableTotal,
      grayquest_principal_total: grayquestPrincipalTotal,
      waiver_total: waiverTotal,
      waiver_percent: waiverPercent,
      ...(status === "approved" ? { approved_by: user?.id || null, approved_at: new Date().toISOString() } : {}),
    }).select("id").single();
    setSaving(false);

    if (error) {
      toast({ title: "Couldn't create proposal", description: error.message, variant: "destructive" });
      return;
    }

    if (insertedProposal?.id && previousProposalIds.length > 0) {
      await supabase.from("fee_proposals" as any)
        .update({ is_current: false, superseded_at: new Date().toISOString(), superseded_by: insertedProposal.id })
        .in("id", previousProposalIds);
    }

    await supabase.from("lead_activities").insert({
      lead_id: lead.id,
      user_id: user?.id || null,
      type: "fee_proposal",
      description: status === "approved"
        ? `Fee proposal approved: ${formatInr(admissionPayableTotal)} ${selectedChildrenAreSchool ? "payable at admission" : "to confirm admission"}`
        : "Fee proposal submitted for super admin approval",
    } as any);

    toast({
      title: status === "approved" ? "Proposal approved" : "Proposal submitted",
      description: status === "approved" ? "You can now send it on WhatsApp or download the PDF." : "It will unlock for sending after approval.",
    });
    setChildren([]);
    setFullYearWaiverAmount("");
    setNote("");
    setRevisingProposal(null);
    fetchData();
  };

  const decideProposal = async (proposal: SchoolFeeProposalRow, decision: "approved" | "rejected") => {
    if (!canApproveProposal(proposal)) return;
    let rejectionReason: string | undefined;
    if (decision === "rejected") {
      const reason = window.prompt("Reason for rejection (optional):");
      if (reason === null) return;
      rejectionReason = reason || undefined;
    }
    setDecidingId(proposal.id);
    const { error } = await supabase.from("fee_proposals" as any).update({
      status: decision,
      ...(decision === "approved"
        ? { approved_by: user?.id || null, approved_at: new Date().toISOString(), rejection_reason: null }
        : { rejected_by: user?.id || null, rejected_at: new Date().toISOString(), rejection_reason: rejectionReason || null }),
    }).eq("id", proposal.id);
    setDecidingId(null);

    if (error) {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: decision === "approved" ? "Proposal approved" : "Proposal rejected" });
    fetchData();
  };

  const reviseProposal = (proposal: SchoolFeeProposalRow) => {
    const payload = proposal.proposal || {};
    const draftChildren: ChildDraft[] = (payload.children || []).map((child: any) => {
      const waiverTypes = normalizeWaiverTypes(child.waiver?.types || child.waiver?.type);
      return {
        id: crypto.randomUUID(),
        leadId: child.lead_id || lead.id,
        name: child.name || child.lead_name || "",
        courseId: child.course_id || "",
        transportKey: child.transport?.key || "none",
        boardingKey: child.boarding?.key || "none",
        waiverType: (child.waiver ? (waiverTypes.length > 0 ? "custom" : "none") : "none") as ChildWaiverChoice,
        waiverTypes,
        feeHeaderWaivers: child.fee_header_waivers || child.waiver?.by_header || {},
      };
    });
    setChildren(draftChildren.length > 0 ? draftChildren : [emptyChild()]);
    setFullYearWaiverAmount(String(payload.full_year_payment?.extra_waiver_amount || ""));
    setNote(payload.note || "");
    setRevisingProposal(proposal);
    toast({ title: `Editing ${revisionLabel(proposal)}`, description: "Submitting will create a new revision and keep this version in history." });
  };

  const deleteProposal = async (proposal: SchoolFeeProposalRow) => {
    if (!isSuperAdmin) return;
    const confirmed = window.confirm(`Delete ${revisionLabel(proposal)}? This cannot be undone.`);
    if (!confirmed) return;
    setDeletingId(proposal.id);
    const wasCurrent = proposal.is_current !== false;
    const { error } = await supabase.from("fee_proposals" as any).delete().eq("id", proposal.id);
    if (error) {
      setDeletingId(null);
      toast({ title: "Couldn't delete proposal", description: error.message, variant: "destructive" });
      return;
    }

    if (wasCurrent) {
      const fallback = proposals
        .filter((item) => item.id !== proposal.id)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      if (fallback) {
        await supabase.from("fee_proposals" as any)
          .update({ is_current: true, superseded_at: null, superseded_by: null })
          .eq("id", fallback.id);
      }
    }

    if (revisingProposal?.id === proposal.id) {
      setRevisingProposal(null);
    }
    setDeletingId(null);
    toast({ title: "Proposal deleted" });
    fetchData();
  };

  const proposalMessage = (proposal: SchoolFeeProposalRow) => {
    const payload = proposal.proposal || {};
    const isSchoolProposal = isSchoolProposalPayload(payload);
    const recipientName = proposalRecipientName(proposal, lead.name);
    const salutation = isSchoolProposal ? "Dear Parent," : `Dear ${recipientName},`;
    const childPayableLabel = isSchoolProposal ? "admission payable" : "to confirm admission (AN)";
    const totalPayableLabel = isSchoolProposal ? "Total payable at admission" : "Total payable to confirm admission (AN)";
    const childLines = (payload.children || []).map((child: any, index: number) => {
      const addOns = [child.transport?.label, child.boarding?.label].filter(Boolean).join(", ");
      const details = [child.institution_name, child.duration_years ? `${child.duration_years} year${child.duration_years === 1 ? "" : "s"}` : null].filter(Boolean).join(", ");
      const leadPart = child.lead_name && child.lead_name !== child.name ? `Lead: ${child.lead_name}; ` : "";
      return `${index + 1}. ${leadPart}Student: ${child.name} - ${child.course_name || child.class_name}${details ? ` (${details})` : ""}${addOns ? `; ${addOns}` : ""}: Total ${formatInr(child.totals?.annualAfterWaiver || 0)}, ${childPayableLabel} ${formatInr(child.totals?.admissionPayable || 0)}`;
    }).join("\n");

    const collegeReviewNote = isSchoolProposal ? "" : `\n${COLLEGE_PROPOSAL_REVIEW_NOTE}`;

    return `${salutation}\n\nFee proposal for ${recipientName}:\n${childLines}\n\n${totalPayableLabel}: ${formatInr(proposal.admission_payable_total)}\nOne-time yearly balance after waivers and paid fees: ${formatInr(proposal.annual_net_total)}\nGrayquest EMI option: subject to Grayquest approval on ${formatInr(proposal.grayquest_principal_total)}. First installment and one-time fee must be paid at admission.${collegeReviewNote}\n\nThis proposal is approved by the admissions office and valid subject to final admission confirmation.`;
  };

  const copyProposal = async (proposal: SchoolFeeProposalRow) => {
    await navigator.clipboard.writeText(proposalMessage(proposal));
    toast({ title: "Proposal copied" });
  };

  const sendProposal = async (proposal: SchoolFeeProposalRow) => {
    if (proposal.status !== "approved") return;
    if (!lead.phone) {
      toast({ title: "Lead phone is missing", variant: "destructive" });
      return;
    }
    setSendingId(proposal.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/whatsapp-reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken || anonKey}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ phone: lead.phone, message: proposalMessage(proposal), lead_id: lead.id }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      await supabase.from("fee_proposals" as any).update({ whatsapp_sent_at: new Date().toISOString() }).eq("id", proposal.id);
      toast({ title: "Proposal sent on WhatsApp" });
      fetchData();
    } catch (error: any) {
      toast({ title: "WhatsApp send failed", description: error.message, variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  };

  const downloadPdf = async (proposal: SchoolFeeProposalRow) => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const brand = brandForProposal(proposal);
    const issuer = proposalIssuerDetails(proposal);
    const [primaryR, primaryG, primaryB] = hexToRgb(brand.primaryColor);
    const [accentR, accentG, accentB] = hexToRgb(brand.accentColor);
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 38;
    const contentWidth = pageWidth - margin * 2;
    const bottomLimit = pageHeight - 54;
    let pageNumber = 1;
    let y = 36;
    let logoImage: PdfImageAsset | null = null;

    try {
      logoImage = await imageAssetToPdfImage(brand.logo);
    } catch {
      logoImage = null;
    }

    const addFooter = () => {
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, pageHeight - 36, pageWidth - margin, pageHeight - 36);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text("Generated by UniOS Admissions", margin, pageHeight - 22);
      doc.text(`Page ${pageNumber}`, pageWidth - margin, pageHeight - 22, { align: "right" });
    };

    const addPage = () => {
      addFooter();
      doc.addPage();
      pageNumber += 1;
      y = 42;
    };

    const ensureSpace = (height: number) => {
      if (y + height > bottomLimit) addPage();
    };

    const sectionTitle = (title: string, options: { topGap?: number } = {}) => {
      const topGap = options.topGap ?? 12;
      ensureSpace(28 + topGap);
      y += topGap;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(pdfSafeText(title), margin, y);
      y += 10;
      doc.setDrawColor(primaryR, primaryG, primaryB);
      doc.setLineWidth(1.1);
      doc.line(margin, y, margin + 82, y);
      y += 10;
    };

    const table = (
      headers: string[],
      rows: string[][],
      widths: number[],
      options: { fontSize?: number; alignRightColumns?: number[] } = {},
    ) => {
      const fontSize = options.fontSize || 8.5;
      const lineHeight = fontSize + 3;
      const cellPadX = 6;
      const cellPadY = 6;
      const alignRight = new Set(options.alignRightColumns || []);
      const drawHeader = () => {
        ensureSpace(28);
        doc.setFillColor(primaryR, primaryG, primaryB);
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(fontSize);
        doc.rect(margin, y, contentWidth, 22, "F");
        let x = margin;
        headers.forEach((header, index) => {
          doc.text(pdfSafeText(header), alignRight.has(index) ? x + widths[index] - cellPadX : x + cellPadX, y + 14, {
            align: alignRight.has(index) ? "right" : "left",
          });
          x += widths[index];
        });
        y += 22;
      };

      drawHeader();
      rows.forEach((row, rowIndex) => {
        const safeRow = row.map((cell) => pdfSafeLines(cell));
        const isSubtotal = /^Subtotal\b/i.test(pdfSafeText(safeRow[1] || safeRow[0] || ""));
        const wrapped = safeRow.map((cell, index) => doc.splitTextToSize(cell, widths[index] - cellPadX * 2));
        const rowHeight = Math.max(24, Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + cellPadY * 2);
        if (y + rowHeight > bottomLimit) {
          addPage();
          drawHeader();
        }
        if (isSubtotal) {
          doc.setFillColor(accentR, accentG, accentB);
        } else {
          doc.setFillColor(rowIndex % 2 === 0 ? 255 : 248, rowIndex % 2 === 0 ? 255 : 250, rowIndex % 2 === 0 ? 255 : 252);
        }
        doc.rect(margin, y, contentWidth, rowHeight, "F");
        doc.setDrawColor(226, 232, 240);
        doc.rect(margin, y, contentWidth, rowHeight);
        doc.setTextColor(30, 41, 59);
        doc.setFont("helvetica", isSubtotal ? "bold" : "normal");
        doc.setFontSize(fontSize);
        let x = margin;
        wrapped.forEach((lines, index) => {
          doc.text(lines, alignRight.has(index) ? x + widths[index] - cellPadX : x + cellPadX, y + cellPadY + fontSize, {
            align: alignRight.has(index) ? "right" : "left",
            lineHeightFactor: 1.15,
          });
          x += widths[index];
        });
        y += rowHeight;
      });
      y += 12;
    };

    doc.setFillColor(primaryR, primaryG, primaryB);
    doc.rect(0, 0, pageWidth, 82, "F");
    doc.setFillColor(255, 255, 255);
    const logoBoxMax = logoImage ? containedImageRect(logoImage, 0, 0, 74, 34) : null;
    const logoBoxWidth = logoBoxMax ? Math.min(88, Math.max(58, logoBoxMax.width + 18)) : 76;
    doc.roundedRect(margin, 18, logoBoxWidth, 46, 5, 5, "F");
    if (logoImage) {
      const logo = containedImageRect(logoImage, margin + 9, 24, logoBoxWidth - 18, 34);
      doc.addImage(logoImage.dataUrl, "PNG", logo.x, logo.y, logo.width, logo.height, undefined, "FAST");
    } else {
      doc.setDrawColor(primaryR, primaryG, primaryB);
      doc.setLineWidth(1.2);
      doc.roundedRect(margin + 8, 26, logoBoxWidth - 16, 30, 4, 4);
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Fee Proposal", pageWidth - margin, 36, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(new Date(proposal.created_at).toLocaleDateString("en-IN"), pageWidth - margin, 53, { align: "right" });
    doc.setFontSize(7.2);
    doc.text(pdfSafeText(`Issued By: ${issuer.name}`), pageWidth - margin, 66, { align: "right" });
    doc.text(pdfSafeText(`Employee ID: ${issuer.employee_id || "-"}`), pageWidth - margin, 76, { align: "right" });

    y = 102;
    const children = (proposal.proposal?.children || []) as any[];
    const isSchoolPdf = isSchoolProposalPayload(proposal.proposal);
    const topBreakdown = isSchoolPdf
      ? admissionPayableBreakdown(children.flatMap((child: any) => (child.fee_items || []) as SchoolFeeItemWaiverAllocation[]))
      : [];
    const topBreakdownText = topBreakdown.length > 0
      ? `Includes: ${topBreakdown.map((item) => `${item.label} ${formatInr(item.amount)}`).join("; ")}`
      : "";
    const topBreakdownLines = topBreakdownText
      ? doc.splitTextToSize(pdfSafeLines(topBreakdownText), 174).slice(0, 3)
      : [];
    const topCardHeight = topBreakdownLines.length > 0 ? 84 : 60;
    doc.setFillColor(accentR, accentG, accentB);
    doc.roundedRect(margin, y, contentWidth, topCardHeight, 6, 6, "F");
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Lead / Parent", margin + 14, y + 18);
    doc.text(pdfSafeText(payableColumnLabel(proposal.proposal)), pageWidth - margin - 150, y + 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      doc.splitTextToSize(pdfSafeLines(personLabel(proposal.proposal?.lead?.name || lead.name, proposal.proposal?.lead?.phone || lead.phone)), 360),
      margin + 14,
      y + 34,
      { lineHeightFactor: 1.15 },
    );
    doc.setFont("helvetica", "bold");
    doc.text(formatInr(proposal.admission_payable_total), pageWidth - margin - 150, y + 36);
    if (topBreakdownLines.length > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.1);
      doc.setTextColor(71, 85, 105);
      doc.text(topBreakdownLines, pageWidth - margin - 150, y + 49, { lineHeightFactor: 1.12 });
    }
    y += topCardHeight + 22;

    const pdfPayableLabel = isSchoolPdf ? "At admission" : "Confirm AN";
    const leadNameForPdf = pdfSafeText(proposal.proposal?.lead?.name || lead.name).toLowerCase();
    const pdfChildName = (child: any, index: number) => {
      const childName = pdfSafeText(child.name || "");
      if (children.length > 1 && childName && childName.toLowerCase() === leadNameForPdf) {
        return `Student ${index + 1}`;
      }
      return childName || `Student ${index + 1}`;
    };
    sectionTitle("Student Summary", { topGap: 0 });
    table(
      ["Student", "Course / Class", "Options", pdfPayableLabel, "Annual Net"],
      children.map((child: any, index: number) => [
        [
          pdfChildName(child, index),
          child.lead_name && child.lead_name !== child.name ? `Lead: ${child.lead_name}` : null,
        ].filter(Boolean).join("\n"),
        [
          [child.course_name || child.class_name, child.course_code].filter(Boolean).join(" - "),
          child.campus_name ? `Campus: ${child.campus_name}` : null,
        ].filter(Boolean).join("\n"),
        [child.transport?.label || "No transport", child.boarding?.label || "No boarding"].join("\n"),
        formatInr(Number(child.totals?.admissionPayable || 0)),
        formatInr(Number(child.totals?.annualAfterWaiver || 0)),
      ]),
      [98, 185, 110, 64, 62],
      { fontSize: 8, alignRightColumns: [3, 4] },
    );

    if (isSchoolPdf) {
      sectionTitle("Payable at Admission Includes");
      table(
        ["Student", "Included fee heads", "Amount"],
        children.map((child: any, index: number) => [
          pdfChildName(child, index),
          payableBreakdownText((child.fee_items || []) as SchoolFeeItemWaiverAllocation[]),
          formatInr(Number(child.totals?.admissionPayable || 0)),
        ]),
        [88, 331, 100],
        { fontSize: 7.8, alignRightColumns: [2] },
      );
    }

    y += 10;

    children.forEach((child: any, childIndex: number) => {
      sectionTitle(`${pdfChildName(child, childIndex)} - ${child.course_name || child.class_name || "Fee Summary"}`);
      const allocatedFeeItems = (child.fee_items || []) as SchoolFeeItemWaiverAllocation[];
      const feeRows = groupFeeItemsByTerm(allocatedFeeItems).map((group) => {
        const groupItems = group.items as SchoolFeeItemWaiverAllocation[];
        const gross = groupItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const waiver = groupItems.reduce((sum, item) => sum + Number(item.waiver || 0), 0);
        const paid = groupItems.reduce((sum, item) => sum + Number(item.paid || 0), 0);
        const net = groupItems.reduce((sum, item) => sum + Number(item.net ?? Math.max(0, Number(item.amount || 0) - Number(item.waiver || 0))), 0);
        return [
          group.label,
          formatInr(gross),
          negativeInr(waiver),
          paid > 0 ? negativeInr(paid) : "-",
          formatInr(net),
          formatInr(Math.max(0, net - paid)),
        ];
      });
      table(
        ["Period", "Gross", "Waiver", "Paid", "Net", "Balance"],
        feeRows,
        [86, 86, 86, 86, 86, 89],
        { fontSize: 8.2, alignRightColumns: [1, 2, 3, 4, 5] },
      );
      if (child.waiver?.amount || child.transport?.label || child.boarding?.label) {
        table(
          ["Adjustment / Add-on", "Details", "Amount"],
          [
            child.transport?.label ? ["Transport", child.transport.label, formatInr(Number(child.transport.annual || 0))] : null,
            child.boarding?.label ? ["Boarding", child.boarding.label, formatInr(Number(child.boarding.annual || 0))] : null,
            child.waiver?.amount ? ["Waiver", child.waiver.label || child.waiver.type || "waiver", negativeInr(Number(child.waiver.amount || 0))] : null,
          ].filter(Boolean) as string[][],
          [128, 271, 120],
          { fontSize: 8, alignRightColumns: [2] },
        );
      }
    });

    ensureSpace(190);
    sectionTitle("Proposal Totals");
    table(
      ["Particular", "Amount"],
      [
        ["Total annual fee before waivers", formatInr(proposal.annual_total)],
        ["Total waiver offered", `${proposal.waiver_total > 0 ? negativeInr(proposal.waiver_total) : formatInr(0)} (${proposal.waiver_percent.toFixed(2)}%)`],
        ["Paid to date", negativeInr(Number(proposal.proposal?.totals?.paid_total || 0))],
        ["One-time yearly balance after waivers and paid fees", formatInr(proposal.annual_net_total)],
        [isSchoolPdf ? "Payable at admission" : "Payable to confirm admission (AN)", formatInr(proposal.admission_payable_total)],
        ["Grayquest EMI eligible amount", `${formatInr(proposal.grayquest_principal_total)} (subject to approval)`],
      ],
      [330, 189],
      { fontSize: 8.6, alignRightColumns: [1] },
    );

    const paymentNotes = [
      "Grayquest EMI is applicable only on the remaining recurring fee and is subject to Grayquest approval. First installment and one-time fee are payable at admission.",
      !isSchoolProposalPayload(proposal.proposal) ? "The confirm admission amount follows the same payment threshold required to generate the admission number." : null,
      !isSchoolProposalPayload(proposal.proposal) ? COLLEGE_PROPOSAL_REVIEW_NOTE : null,
      "Proposal is subject to final admission confirmation.",
    ].filter(Boolean).join(" ");
    const paymentNoteLines = doc.splitTextToSize(pdfSafeLines(paymentNotes), contentWidth - 24);
    const paymentNoteHeight = Math.max(46, paymentNoteLines.length * 10 + 28);
    ensureSpace(paymentNoteHeight + 6);
    doc.setFillColor(255, 251, 235);
    doc.setDrawColor(253, 230, 138);
    doc.roundedRect(margin, y, contentWidth, paymentNoteHeight, 5, 5, "FD");
    doc.setTextColor(120, 53, 15);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("Payment Notes", margin + 12, y + 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(paymentNoteLines, margin + 12, y + 30, { lineHeightFactor: 1.2 });
    y += paymentNoteHeight + 12;

    if (proposal.proposal?.note) {
      ensureSpace(36);
      doc.setTextColor(71, 85, 105);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.text("Internal Note", margin, y);
      y += 13;
      doc.setFont("helvetica", "normal");
      doc.text(doc.splitTextToSize(pdfSafeLines(proposal.proposal.note), contentWidth), margin, y);
    }

    addFooter();
    doc.save(`fee-proposal-${lead.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-[96vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <DialogTitle>Fee Proposal - {lead.name}</DialogTitle>
              <DialogDescription>
                Build and manage admission fee proposals for one or more students linked to this lead.
              </DialogDescription>
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setShowGuide(true)}>
              <HelpCircle className="h-3.5 w-3.5" />
              Guide
            </Button>
          </div>
        </DialogHeader>

        {showGuide && (
          <Card className="border-info/20 bg-info/5/80 shadow-none">
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-info/10 text-info-foreground border-info/20">New feature</Badge>
                    <h3 className="text-sm font-semibold text-info-foreground">How to use fee proposals</h3>
                  </div>
                  <div className="grid gap-2 text-xs text-info-foreground md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-md border border-info/20 bg-white/70 p-2">
                      <div className="font-semibold">1. Select students</div>
                      <p className="mt-1 text-info-foreground">Add one or more linked leads, then choose the class or course and campus.</p>
                    </div>
                    <div className="rounded-md border border-info/20 bg-white/70 p-2">
                      <div className="font-semibold">2. Choose options</div>
                      <p className="mt-1 text-info-foreground">For schools, select boarding and transport so only relevant fee heads are shown.</p>
                    </div>
                    <div className="rounded-md border border-info/20 bg-white/70 p-2">
                      <div className="font-semibold">3. Apply waivers</div>
                      <p className="mt-1 text-info-foreground">Pick no waiver, sibling, single parent, or custom waivers. Above-limit concessions go for approval.</p>
                    </div>
                    <div className="rounded-md border border-info/20 bg-white/70 p-2">
                      <div className="font-semibold">4. Submit and share</div>
                      <p className="mt-1 text-info-foreground">Approved proposals unlock PDF and WhatsApp sharing. Revisions keep history for staff.</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-info-foreground">
                    The PDF includes lead/student names, campus, payable-at-admission breakup, waivers, paid fees, issuer details, and Grayquest EMI eligibility.
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" className="shrink-0 text-info-foreground hover:bg-info/10" onClick={dismissGuide}>
                  Got it
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-4">
              <Card className="shadow-none">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">{revisingProposal ? `Revise Proposal - ${revisionLabel(revisingProposal)}` : "Build Proposal"}</h3>
                      <p className="text-xs text-muted-foreground">
                        {revisingProposal ? "Submitting creates a new revision while keeping the earlier proposal in history." : "Add each student/program under this lead before submitting."}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {revisingProposal && (
                        <Button size="sm" variant="ghost" onClick={() => {
                          setRevisingProposal(null);
                          setChildren([emptyChild()]);
                          setFullYearWaiverAmount("");
                          setNote("");
                        }}>
                          Cancel
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setChildren((prev) => [...prev, emptyChild()])}>
                        <Plus className="h-4 w-4 mr-1.5" /> Student
                      </Button>
                    </div>
                  </div>

                  {children.map((child, index) => {
                    const course = courseById.get(child.courseId) || null;
                    const linkedLead = relatedLeadById.get(child.leadId || lead.id) || null;
                    const isSchoolProgram = isSchoolCourseOption(course);
                    const waiverHeaders = waiverHeadersForChild(child, course);
                    const waiverHeaderGroups = groupWaiverHeadersByPeriod(waiverHeaders);
                    const siblingAllowedForChild = canApplySiblingWaiver && child.id === siblingWaiverChildId;
                    const activeWaiverTypesForChild = selectedWaiverTypes(child, siblingAllowedForChild);
                    const hasCustomWaiver = activeWaiverTypesForChild.includes("custom");
                    const hasSelectedWaiverForChild = activeWaiverTypesForChild.length > 0;
                    const totalEnteredWaiverForChild = hasSelectedWaiverForChild
                      ? waiverHeaders.reduce((sum, header) => sum + Number(child.feeHeaderWaivers[header.key] || 0), 0)
                      : 0;
                    return (
                      <div key={child.id} className="rounded-lg border border-border/70 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground">Student / Program {index + 1}</span>
                          {children.length > 1 && (
                            <button className="text-destructive" onClick={() => setChildren((prev) => prev.filter((item) => item.id !== child.id))}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                          <div>
                            <Label className="text-xs">Lead / Applicant</Label>
                            <select
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={child.leadId || lead.id}
                              onChange={(event) => {
                                const nextLead = relatedLeadById.get(event.target.value);
                                updateChild(child.id, {
                                  leadId: event.target.value,
                                  name: child.name && child.name !== linkedLead?.name ? child.name : nextLead?.name || child.name,
                                });
                              }}
                            >
                              {relatedLeads.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name}{option.phone ? ` - ${option.phone}` : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs">Student name</Label>
                            <Input value={child.name} onChange={(event) => updateChild(child.id, { name: event.target.value })} placeholder="Optional" />
                          </div>
                          <div>
                            <Label className="text-xs">Course / Class</Label>
                            <select
                              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={child.courseId}
                              onChange={(event) => updateChild(child.id, { courseId: event.target.value, transportKey: "", boardingKey: "", waiverType: "", waiverTypes: [], feeHeaderWaivers: {} })}
                            >
                              <option value="">Select course / class</option>
                              {coursesByCampus.map((group) => (
                                <optgroup key={group.campusName} label={group.campusName}>
                                  {group.options.map((option) => (
                                    <option key={option.courseId} value={option.courseId}>
                                      {courseOptionLabel(option)}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs">Transport <span className="text-destructive">*</span></Label>
                            <select
                              className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${!child.transportKey ? "border-destructive/60" : "border-input"}`}
                              value={child.transportKey}
                              onChange={(event) => updateChild(child.id, { transportKey: event.target.value })}
                              required
                            >
                              <option value="" disabled>Select transport</option>
                              <option value="none">No transport</option>
                              {(course?.snapshot.transportOptions || []).map((option) => (
                                <option key={option.key} value={option.key}>{transportOptionLabel(option)}</option>
                              ))}
                            </select>
                            {!child.transportKey && <p className="mt-1 text-[11px] text-destructive">Required</p>}
                          </div>
                          <div>
                            <Label className="text-xs">Boarding <span className="text-destructive">*</span></Label>
                            <select
                              className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${!child.boardingKey ? "border-destructive/60" : "border-input"}`}
                              value={child.boardingKey}
                              onChange={(event) => {
                                const nextChild = { ...child, boardingKey: event.target.value };
                                const nextHeaders = waiverHeadersForChild(nextChild, course);
                                const activeWaiverTypes = selectedWaiverTypes(child, canApplySiblingWaiver && child.id === siblingWaiverChildId);
                                const ruleTypes = activeWaiverTypes.filter((type) => type !== "custom");
                                const rulePreset = buildSchoolWaiverPreset(nextHeaders, ruleTypes, course);
                                updateChild(child.id, {
                                  boardingKey: event.target.value,
                                  feeHeaderWaivers: isSchoolProgram && ruleTypes.length > 0
                                    ? activeWaiverTypes.includes("custom")
                                      ? mergeWaiverPresets(child.feeHeaderWaivers, rulePreset)
                                      : rulePreset
                                    : child.feeHeaderWaivers,
                                });
                              }}
                              required
                            >
                              <option value="" disabled>Select boarding</option>
                              <option value="none">No boarding</option>
                              {(course?.snapshot.boardingOptions || []).map((option) => (
                                <option key={option.key} value={option.key}>{option.label} - {formatInr(option.amount)}</option>
                              ))}
                            </select>
                            {!child.boardingKey && <p className="mt-1 text-[11px] text-destructive">Required</p>}
                          </div>
                          <div>
                            <Label className="text-xs">Waivers <span className="text-destructive">*</span></Label>
                            <div className={`mt-1 rounded-md border bg-background p-1.5 text-sm ${!hasWaiverChoice(child, siblingAllowedForChild) ? "border-destructive/60" : "border-input"}`}>
                              {(() => {
                                const rawTypes = normalizeWaiverTypes(child.waiverTypes?.length ? child.waiverTypes : child.waiverType);
                                const toggleType = (type: ChildWaiverType, checked: boolean) => {
                                  const next = new Set(rawTypes);
                                  if (checked) next.add(type);
                                  else next.delete(type);
                                  updateChildWaiverTypes(child, Array.from(next), waiverHeaders, course);
                                };
                                return (
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <label className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${child.waiverType === "none" ? "border-primary bg-primary/5 text-primary" : "border-border"}`}>
                                      <input
                                        className="mt-0.5"
                                        type="checkbox"
                                        checked={child.waiverType === "none"}
                                        onChange={(event) => updateChild(child.id, {
                                          waiverType: event.target.checked ? "none" : "",
                                          waiverTypes: [],
                                          feeHeaderWaivers: {},
                                        })}
                                      />
                                      <span>
                                        <span className="block font-medium">No waiver</span>
                                        <span className="block text-[10px] text-muted-foreground">Charge standard fee</span>
                                      </span>
                                    </label>
                                    {isSchoolProgram && (
                                      <label className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${siblingAllowedForChild && rawTypes.includes("sibling") ? "border-primary bg-primary/5 text-primary" : "border-border"} ${!siblingAllowedForChild ? "text-muted-foreground opacity-70" : ""}`}>
                                        <input
                                          className="mt-0.5"
                                          type="checkbox"
                                          checked={siblingAllowedForChild && rawTypes.includes("sibling")}
                                          disabled={!siblingAllowedForChild}
                                          onChange={(event) => toggleType("sibling", event.target.checked)}
                                        />
                                        <span>
                                          <span className="block font-medium">Sibling</span>
                                          <span className="block text-[10px] text-muted-foreground">Youngest child: Q4 tuition</span>
                                        </span>
                                      </label>
                                    )}
                                    {isSchoolProgram && (
                                      <label className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${rawTypes.includes("single_parent") ? "border-primary bg-primary/5 text-primary" : "border-border"}`}>
                                        <input
                                          className="mt-0.5"
                                          type="checkbox"
                                          checked={rawTypes.includes("single_parent")}
                                          onChange={(event) => toggleType("single_parent", event.target.checked)}
                                        />
                                        <span>
                                          <span className="block font-medium">Single parent</span>
                                          <span className="block text-[10px] text-muted-foreground">25% on boarding</span>
                                        </span>
                                      </label>
                                    )}
                                    <label className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${rawTypes.includes("custom") ? "border-primary bg-primary/5 text-primary" : "border-border"}`}>
                                      <input
                                        className="mt-0.5"
                                        type="checkbox"
                                        checked={rawTypes.includes("custom")}
                                        onChange={(event) => toggleType("custom", event.target.checked)}
                                      />
                                      <span>
                                        <span className="block font-medium">Custom</span>
                                        <span className="block text-[10px] text-muted-foreground">Manual adjustment</span>
                                      </span>
                                    </label>
                                  </div>
                                );
                              })()}
                            </div>
                            {!hasWaiverChoice(child, siblingAllowedForChild) && <p className="mt-1 text-[11px] text-destructive">Required</p>}
                            {isSchoolProgram && !canApplySiblingWaiver && (
                              <p className="mt-1 text-[11px] text-muted-foreground">Sibling discount is available only when at least two candidates are included.</p>
                            )}
                            {isSchoolProgram && canApplySiblingWaiver && child.id !== siblingWaiverChildId && (
                              <p className="mt-1 text-[11px] text-muted-foreground">Sibling waiver applies only to the youngest child.</p>
                            )}
                          </div>
                        </div>
                        {waiverHeaders.length > 0 && (
                          <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <div>
                                <Label className="text-xs font-semibold">Waiver impact</Label>
                                <p className="text-[11px] text-muted-foreground">Preview first. Open details only when you need to adjust amounts.</p>
                              </div>
                              {hasSelectedWaiverForChild && (
                                <div className="rounded-md bg-background px-2.5 py-1 text-right">
                                  <div className="text-[10px] text-muted-foreground">Total waiver</div>
                                  <div className="text-sm font-semibold">{formatInr(totalEnteredWaiverForChild)}</div>
                                </div>
                              )}
                            </div>

                            {!hasSelectedWaiverForChild ? (
                              <div className="rounded-md border border-dashed border-border bg-background px-3 py-3 text-xs text-muted-foreground">
                                Select a waiver above to see what will be applied.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                                  {waiverHeaderGroups.map((group) => {
                                    const groupAllowed = group.headers.reduce((sum, header) =>
                                      sum + feeHeaderRuleApprovalLimit(header, activeWaiverTypesForChild, course).amount,
                                    0);
                                    const groupEntered = group.headers.reduce((sum, header) =>
                                      sum + Number(child.feeHeaderWaivers[header.key] || 0),
                                    0);
                                    if (!hasCustomWaiver && groupAllowed === 0 && groupEntered === 0) return null;
                                    const groupOverLimit = groupEntered > groupAllowed;
                                    return (
                                      <div key={group.label} className={`rounded-md border bg-background px-3 py-2 ${groupOverLimit ? "border-warning/30 bg-warning/5" : "border-border/70"}`}>
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-xs font-semibold">{group.label}</div>
                                          {groupOverLimit && <Badge className="h-5 bg-warning/10 px-1.5 text-[10px] text-warning-foreground border-warning/20">Approval</Badge>}
                                        </div>
                                        <div className="mt-2">
                                          <div className="text-[10px] text-muted-foreground">Waiver applied</div>
                                          <div className={`text-base font-semibold ${groupOverLimit ? "text-warning-foreground" : ""}`}>{formatInr(groupEntered)}</div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                <details className="rounded-md border border-border/70 bg-background" open={hasCustomWaiver}>
                                  <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold">
                                    Adjust fee-period amounts
                                  </summary>
                                  <div className="border-t border-border/60">
                                    {waiverHeaderGroups.map((group) => (
                                      <div key={group.label} className="border-b border-border/60 last:border-b-0">
                                        <div className="flex items-center justify-between bg-muted/30 px-3 py-1.5">
                                          <div className="text-xs font-semibold">{group.label}</div>
                                          <div className="text-[11px] text-muted-foreground">Period total {formatInr(group.total)}</div>
                                        </div>
                                        <div className="hidden border-t border-border/60 bg-muted/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_8rem_8rem_7.5rem]">
                                          <div>Fee head</div>
                                          <div className="text-right">Fee</div>
                                          <div className="text-right">Allowed</div>
                                          <div className="text-right">Waiver</div>
                                        </div>
                                        <div className="divide-y divide-border/60">
                                          {group.headers.map((header) => {
                                            const autoApproval = feeHeaderRuleApprovalLimit(header, activeWaiverTypesForChild, course);
                                            const autoLimit = autoApproval.amount;
                                            const nonWaivableHeader = isNonWaivableFeeHeader(header);
                                            const waiverInputDisabled = !hasSelectedWaiverForChild || nonWaivableHeader;
                                            const entered = waiverInputDisabled ? 0 : Number(child.feeHeaderWaivers[header.key] || 0);
                                            const overLimit = entered > autoLimit;
                                            return (
                                              <div key={header.key} className={`grid grid-cols-1 gap-1.5 px-3 py-1.5 md:grid-cols-[minmax(0,1fr)_8rem_8rem_7.5rem] md:items-center ${overLimit ? "bg-warning/5" : ""} ${waiverInputDisabled ? "opacity-75" : ""}`}>
                                                <div className="min-w-0 text-xs font-medium leading-snug break-words">{header.label}</div>
                                                <div className="text-[11px] text-muted-foreground md:text-right">
                                                  <span className="md:hidden">Fee: </span>
                                                  <span className="font-medium text-foreground">{formatInr(header.total)}</span>
                                                </div>
                                                <div className={`text-[11px] md:text-right ${overLimit ? "text-warning-foreground" : "text-muted-foreground"}`}>
                                                  <span className="md:hidden">Allowed: </span>
                                                  {nonWaivableHeader ? "-" : (
                                                    <>
                                                      <span className="font-medium text-foreground">{formatInr(autoLimit)}</span>
                                                      <span className="ml-1">{autoApproval.source === "rule" ? "rule" : "auto"}</span>
                                                    </>
                                                  )}
                                                </div>
                                                <Input
                                                  className="h-7 md:text-right"
                                                  type="number"
                                                  min={0}
                                                  max={header.total}
                                                  value={waiverInputDisabled ? "" : child.feeHeaderWaivers[header.key] || ""}
                                                  onChange={(event) => updateChildHeaderWaiver(child.id, header.key, event.target.value)}
                                                  disabled={waiverInputDisabled}
                                                  placeholder="0"
                                                />
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">One-time payment waiver</Label>
                      <Input
                        type="number"
                        min={0}
                        value={hasAnyWaiverSelected ? fullYearWaiverAmount : ""}
                        onChange={(event) => setFullYearWaiverAmount(event.target.value)}
                        placeholder="0"
                        disabled={!hasAnyWaiverSelected}
                      />
                      {!hasAnyWaiverSelected && <p className="mt-1 text-[11px] text-muted-foreground">Disabled because no waiver is selected</p>}
                    </div>
                    <div>
                      <Label className="text-xs">Internal note</Label>
                      <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional approval context" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="rounded-md bg-muted/50 p-2">
                      <div className="text-muted-foreground">{payableMetricLabel}</div>
                      <div className="font-semibold">{formatInr(admissionPayableTotal)}</div>
                    </div>
                    <div className="rounded-md bg-muted/50 p-2">
                      <div className="text-muted-foreground">Net total</div>
                      <div className="font-semibold">{formatInr(annualNetTotal)}</div>
                    </div>
                    <div className="rounded-md bg-muted/50 p-2">
                      <div className="text-muted-foreground">Grayquest base</div>
                      <div className="font-semibold">{formatInr(grayquestPrincipalTotal)}</div>
                    </div>
                    <div className="rounded-md bg-muted/50 p-2">
                      <div className="text-muted-foreground">Waiver</div>
                      <div className="font-semibold">{waiverPercent.toFixed(2)}%</div>
                    </div>
                  </div>

                  {!autoApprovalAllowed && (
                    <div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning-foreground">
                      One or more concessions are above the applicable auto-approval limit, so this proposal requires super admin approval before PDF download or WhatsApp sending.
                    </div>
                  )}

                  <Button onClick={saveProposal} disabled={saving || selectedChildren.length === 0 || courses.length === 0 || hasMissingWaiverType || hasMissingTransport || hasMissingBoarding} className="w-full">
                    {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                    {revisingProposal ? "Submit Revision" : "Submit Proposal"}
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Saved Proposals</h3>
              {proposalsTableMissing && (
                <Card className="shadow-none border-warning/20 bg-warning/5">
                  <CardContent className="p-4 text-sm text-warning-foreground">
                    <div className="font-medium">Migration required</div>
                    <div className="mt-1 text-xs">
                      The database does not have <span className="font-mono">public.fee_proposals</span> yet. Apply
                      <span className="font-mono"> 20260629110000_school_fee_proposals.sql</span> and
                      <span className="font-mono"> 20260629114500_fee_proposal_linked_leads.sql</span> and
                      <span className="font-mono"> 20260629130000_fee_proposal_revisions_delete.sql</span> to enable saving and sending proposals.
                    </div>
                  </CardContent>
                </Card>
              )}
              {proposals.length === 0 ? (
                <Card className="shadow-none">
                  <CardContent className="py-6 text-center text-sm text-muted-foreground">No proposals yet</CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {proposals.map((proposal, index) => {
                const isCurrent = proposal.is_current ?? index === 0;
                const isParentShareable = isCurrent && proposal.status === "approved";
                return (
                <Card key={proposal.id} className="shadow-none">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={statusClass(proposal.status)}>{statusLabel(proposal.status)}</Badge>
                        <Badge variant="outline">{revisionLabel(proposal)}</Badge>
                        <Badge className={isCurrent ? "bg-info/10 text-info-foreground border-info/20" : "bg-slate-100 text-slate-600 border-slate-200"}>
                          {isCurrent ? "Latest" : "Superseded"}
                        </Badge>
                      </div>
                      <span className="text-[11px] text-muted-foreground">{new Date(proposal.created_at).toLocaleDateString("en-IN")}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {proposalLifecycleSteps(proposal).map((step) => (
                        <div key={step.label} className={`rounded-md border px-2 py-1.5 ${step.className}`}>
                          <div className="text-[10px] font-semibold uppercase tracking-wide">{step.label}</div>
                          <div className="mt-0.5 text-[11px]">{step.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-muted-foreground">Students/programs</span><div className="font-medium">{proposal.total_children}</div></div>
                      <div><span className="text-muted-foreground">Waiver</span><div className="font-medium">{proposal.waiver_percent.toFixed(2)}%</div></div>
                      <div><span className="text-muted-foreground">{payableColumnLabel(proposal.proposal)}</span><div className="font-medium">{formatInr(proposal.admission_payable_total)}</div></div>
                      <div><span className="text-muted-foreground">Net total</span><div className="font-medium">{formatInr(proposal.annual_net_total)}</div></div>
                    </div>
                    <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                      Grayquest EMI: {formatInr(proposal.grayquest_principal_total)} subject to approval. First installment and one-time fee payable at admission.
                    </div>
                    {proposal.rejection_reason && <p className="text-xs text-destructive">{proposal.rejection_reason}</p>}
                    {!isCurrent && (
                      <p className="text-[11px] text-muted-foreground">
                        Historical revision. Parent/applicant sharing is available only on the latest approved revision.
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {canApproveProposal(proposal) && proposal.status.startsWith("pending") && (
                        <>
                          <Button size="sm" onClick={() => decideProposal(proposal, "approved")} disabled={decidingId === proposal.id}>
                            {decidingId === proposal.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => decideProposal(proposal, "rejected")} disabled={decidingId === proposal.id}>
                            <XCircle className="h-4 w-4 mr-1.5" />
                            Reject
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="outline" onClick={() => reviseProposal(proposal)} disabled={saving}>
                        Revise
                      </Button>
                      {isParentShareable && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => copyProposal(proposal)}>
                            <Copy className="h-4 w-4 mr-1.5" /> Copy
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => downloadPdf(proposal)}>
                            <FileDown className="h-4 w-4 mr-1.5" /> PDF
                          </Button>
                          <Button size="sm" onClick={() => sendProposal(proposal)} disabled={sendingId === proposal.id}>
                            {sendingId === proposal.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                            WhatsApp
                          </Button>
                        </>
                      )}
                      {isSuperAdmin && (
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => deleteProposal(proposal)} disabled={deletingId === proposal.id}>
                          {deletingId === proposal.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
                          Delete
                        </Button>
                      )}
                    </div>
                    {proposal.whatsapp_sent_at && (
                      <p className="text-[11px] text-success">Sent on WhatsApp {new Date(proposal.whatsapp_sent_at).toLocaleString("en-IN")}</p>
                    )}
                  </CardContent>
                </Card>
              );
              })}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
