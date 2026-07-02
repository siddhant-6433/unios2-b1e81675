export type SchoolFeeCategory = "tuition" | "hostel" | "transport" | "enrollment" | "other";

export interface SchoolFeeItem {
  code: string;
  name: string;
  category: SchoolFeeCategory | string;
  term: string;
  amount: number;
}

export interface SchoolFeeOption {
  key: string;
  label: string;
  description?: string;
  amount: number;
  items: SchoolFeeItem[];
}

export interface SchoolFeeSnapshot {
  oneTime: number;
  recurringBase: number;
  firstQuarterBase: number;
  transportOptions: SchoolFeeOption[];
  boardingOptions: SchoolFeeOption[];
  items: SchoolFeeItem[];
}

export interface GroupedSchoolFeeItems {
  key: string;
  label: string;
  total: number;
  items: SchoolFeeItem[];
}

export interface GroupedSchoolFeeHeader {
  key: string;
  legacyKey: string;
  label: string;
  totalLabel: string;
  periodLabel: string;
  category: string;
  total: number;
  items: SchoolFeeItem[];
}

export interface SchoolFeeItemWaiverAllocation extends SchoolFeeItem {
  headerKey: string;
  waiver: number;
  paid?: number;
  net: number;
}

export interface FeeHeaderWaiverAllocation {
  items: SchoolFeeItemWaiverAllocation[];
  waiverTotal: number;
  admissionWaiverTotal: number;
  grayquestWaiverTotal: number;
}

export interface AdmissionPayableBreakdownItem {
  label: string;
  amount: number;
}

export interface SchoolProposalChildInput {
  oneTime: number;
  recurringBase: number;
  firstQuarterBase: number;
  transportAnnual?: number;
  transportFirstQuarter?: number;
  boardingAnnual?: number;
  boardingFirstQuarter?: number;
  waiverAmount?: number;
  admissionWaiverAmount?: number;
  grayquestWaiverAmount?: number;
  admissionPaidAmount?: number;
  grayquestPaidAmount?: number;
}

export interface SchoolProposalChildTotals {
  oneTime: number;
  annualBeforeWaiver: number;
  annualAfterWaiver: number;
  firstQuarterBeforeWaiver: number;
  admissionPayable: number;
  grayquestPrincipal: number;
}

export const SCHOOL_COURSE_CODE_RE = /^(BSA|BSAV|MES)-/;
const QUARTER_RE = /^q([1-4])$/i;
const FIRST_RECURRING_TERM_RE = /^(q1|year_1|year1|sem_1|semester_1|term_1|installment_1)$/i;

export function isSchoolCourseCode(code: string | null | undefined): boolean {
  return SCHOOL_COURSE_CODE_RE.test(code || "");
}

export function formatInr(amount: number): string {
  return `Rs. ${Math.round(amount || 0).toLocaleString("en-IN")}`;
}

function optionKeyFor(item: SchoolFeeItem): string {
  if (item.code.endsWith("TR1")) return "zone_1";
  if (item.code.endsWith("TR2")) return "zone_2";
  if (item.code.endsWith("TR3")) return "zone_3";
  if (item.code.endsWith("DBA")) return "day_boarding";
  if (item.code.endsWith("NAC")) return "non_ac";
  if (item.code.endsWith("CBA") || item.code.endsWith("B5")) return "ac_5_day";
  if (item.code.endsWith("IBA") || item.code.endsWith("B7")) return "ac_7_day";
  return item.code;
}

function optionLabelFor(key: string, item: SchoolFeeItem): string {
  if (key === "zone_1") return "Transport Zone 1";
  if (key === "zone_2") return "Transport Zone 2";
  if (key === "zone_3") return "Transport Zone 3";
  if (key === "day_boarding") return "Day Boarding";
  if (key === "non_ac") return "Boarding Non-AC";
  if (key === "ac_5_day") return item.code.startsWith("MR-") ? "Boarding AC 5-day" : "Boarding AC Central";
  if (key === "ac_7_day") return item.code.startsWith("MR-") ? "Boarding AC 7-day" : "Boarding AC Individual";
  return item.name;
}

function transportDescriptionFor(item: SchoolFeeItem): string | undefined {
  if (item.category !== "transport") return undefined;
  const match = String(item.name || "").match(/\(([^)]+)\)/);
  return match?.[1]?.trim() || undefined;
}

function groupOptions(items: SchoolFeeItem[]): SchoolFeeOption[] {
  const grouped = new Map<string, SchoolFeeOption>();
  for (const item of items) {
    const key = optionKeyFor(item);
    const existing = grouped.get(key);
    if (existing) {
      existing.amount += Number(item.amount || 0);
      existing.items.push(item);
      existing.description ||= transportDescriptionFor(item);
    } else {
      grouped.set(key, {
        key,
        label: optionLabelFor(key, item),
        description: transportDescriptionFor(item),
        amount: Number(item.amount || 0),
        items: [item],
      });
    }
  }
  return Array.from(grouped.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function isOneTimeItem(item: SchoolFeeItem): boolean {
  const term = String(item.term || "").toLowerCase();
  return item.category === "enrollment" || term === "admission" || term === "registration" || term === "one_time";
}

function isFirstRecurringTerm(term: string): boolean {
  return FIRST_RECURRING_TERM_RE.test(String(term || ""));
}

export function isAdmissionPayableFeeItem(item: SchoolFeeItem): boolean {
  if (item.category === "transport" || item.category === "hostel") return isFirstRecurringTerm(item.term);
  return isOneTimeItem(item) || isFirstRecurringTerm(item.term);
}

function isRefundableFeeItem(item: SchoolFeeItem): boolean {
  return /security|deposit|refundable/i.test(`${item.code} ${item.name}`);
}

function admissionPayableBreakdownLabel(item: SchoolFeeItem): string {
  const term = normalizedFeeTerm(item.term);
  const cleanName = titleCaseTerm(item.name || item.code || "Fee");
  const refundableSuffix = isRefundableFeeItem(item) && !/refundable/i.test(cleanName) ? " (refundable)" : "";

  if (term === "q1" || term === "quarter_1") {
    if (item.category === "hostel") return "First quarter boarding fee";
    if (item.category === "transport") return "First quarter transport fee";
    if (item.category === "tuition") return "First quarter tuition fee";
    return `First quarter ${cleanName.toLowerCase()}`;
  }

  if (term === "year_1" || term === "year1") {
    return `Year 1 ${cleanName.toLowerCase()}`;
  }

  if (term === "sem_1" || term === "semester_1") {
    return `Sem 1 ${cleanName.toLowerCase()}`;
  }

  return `${cleanName}${refundableSuffix}`;
}

function admissionBreakdownSortRank(label: string): number {
  if (/application/i.test(label)) return 5;
  if (/registration/i.test(label)) return 10;
  if (/admission/i.test(label)) return 15;
  if (/security|deposit/i.test(label)) return 20;
  if (/first quarter tuition/i.test(label)) return 30;
  if (/first quarter boarding/i.test(label)) return 40;
  if (/first quarter transport/i.test(label)) return 50;
  if (/year 1/i.test(label)) return 60;
  if (/sem 1/i.test(label)) return 70;
  return 100;
}

export function admissionPayableBreakdown(items: SchoolFeeItemWaiverAllocation[]): AdmissionPayableBreakdownItem[] {
  const grouped = new Map<string, number>();
  for (const item of items) {
    if (!isAdmissionPayableFeeItem(item)) continue;
    const amount = Math.max(0, Number(item.net ?? item.amount ?? 0) - Number(item.paid || 0));
    if (amount <= 0) continue;
    const label = admissionPayableBreakdownLabel(item);
    grouped.set(label, Math.round((grouped.get(label) || 0) + amount));
  }

  return Array.from(grouped.entries())
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => {
      const rankDiff = admissionBreakdownSortRank(a.label) - admissionBreakdownSortRank(b.label);
      if (rankDiff !== 0) return rankDiff;
      return a.label.localeCompare(b.label);
    });
}

export function buildSchoolFeeSnapshot(items: SchoolFeeItem[]): SchoolFeeSnapshot {
  const oneTime = items
    .filter((item) => isOneTimeItem(item) && !item.code.endsWith("-SEC"))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const recurringBaseItems = items.filter((item) => {
    if (item.category === "transport" || item.category === "hostel") return false;
    if (isOneTimeItem(item)) return false;
    return true;
  });
  const recurringBase = recurringBaseItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const firstQuarterBase = recurringBaseItems
    .filter((item) => isFirstRecurringTerm(item.term))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return {
    oneTime,
    recurringBase,
    firstQuarterBase,
    transportOptions: groupOptions(items.filter((item) => item.category === "transport" && QUARTER_RE.test(item.term))),
    boardingOptions: groupOptions(items.filter((item) => item.category === "hostel" && QUARTER_RE.test(item.term))),
    items,
  };
}

function titleCaseTerm(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function formatFeeTerm(term: string | null | undefined): string {
  const normalized = String(term || "").trim().toLowerCase();
  const yearMatch = normalized.match(/^year[_\s-]?(\d+)$/);
  if (yearMatch) return `Year ${yearMatch[1]}`;

  const semesterMatch = normalized.match(/^(sem|semester)[_\s-]?(\d+)$/);
  if (semesterMatch) return `Sem ${semesterMatch[2]}`;

  const quarterMatch = normalized.match(/^q(?:uarter)?[_\s-]?(\d+)$/);
  if (quarterMatch) return `Q${quarterMatch[1]}`;

  const termMatch = normalized.match(/^term[_\s-]?(\d+)$/);
  if (termMatch) return `Term ${termMatch[1]}`;

  const installmentMatch = normalized.match(/^installment[_\s-]?(\d+)$/);
  if (installmentMatch) return `Installment ${installmentMatch[1]}`;

  return titleCaseTerm(normalized || "fee");
}

function canonicalFeeTerm(term: string | null | undefined): string {
  const normalized = String(term || "").trim().toLowerCase();
  const display = formatFeeTerm(normalized);
  return display.toLowerCase().replace(/\s+/g, "_");
}

function normalizedFeeTerm(term: string | null | undefined): string {
  return String(term || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function uniqueFeeTerms(items: SchoolFeeItem[]): string[] {
  return Array.from(new Set(items.map((item) => normalizedFeeTerm(item.term)).filter(Boolean)));
}

function areQuarterlyTerms(terms: string[]): boolean {
  return terms.length > 0 && terms.every((term) => /^q[1-4]$/.test(term) || /^quarter_[1-4]$/.test(term));
}

function areYearTerms(terms: string[]): boolean {
  return terms.length > 0 && terms.every((term) => /^year_\d+$/.test(term) || /^year\d+$/.test(term));
}

function areSemesterTerms(terms: string[]): boolean {
  return terms.length > 0 && terms.every((term) => /^sem_\d+$/.test(term) || /^semester_\d+$/.test(term));
}

function areOneTimeTerms(terms: string[]): boolean {
  return terms.length > 0 && terms.every((term) => /^(admission|registration|one_time)$/.test(term));
}

export function feeHeadPeriodLabel(items: SchoolFeeItem[]): string {
  const terms = uniqueFeeTerms(items);
  if (areQuarterlyTerms(terms) && terms.length > 1) return "Annual";
  if (areOneTimeTerms(terms)) return "One-time";
  if (areYearTerms(terms) && terms.length > 1) return "Multi-year";
  if (areSemesterTerms(terms) && terms.length > 1) return "Multi-semester";
  if (terms.length === 1) return formatFeeTerm(terms[0]);
  return "Fee head";
}

export function feeHeadTotalLabel(items: SchoolFeeItem[]): string {
  const periodLabel = feeHeadPeriodLabel(items);
  if (periodLabel === "Annual") return "Annual fee total";
  if (periodLabel === "One-time") return "One-time fee total";
  if (periodLabel === "Multi-year") return "Multi-year fee total";
  if (periodLabel === "Multi-semester") return "Multi-semester fee total";
  return `${periodLabel} fee total`;
}

function termSortRank(label: string): number {
  const yearMatch = label.match(/^Year (\d+)$/i);
  if (yearMatch) return 100 + Number(yearMatch[1]);
  const semMatch = label.match(/^Sem (\d+)$/i);
  if (semMatch) return 200 + Number(semMatch[1]);
  const quarterMatch = label.match(/^Q(\d+)$/i);
  if (quarterMatch) return 300 + Number(quarterMatch[1]);
  if (/admission/i.test(label)) return 10;
  if (/registration/i.test(label)) return 11;
  if (/one time/i.test(label)) return 12;
  return 900;
}

export function groupFeeItemsByTerm(items: SchoolFeeItem[]): GroupedSchoolFeeItems[] {
  const groups = new Map<string, GroupedSchoolFeeItems>();
  for (const item of items) {
    const key = canonicalFeeTerm(item.term);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      existing.total += Number(item.amount || 0);
    } else {
      groups.set(key, {
        key,
        label: formatFeeTerm(item.term),
        total: Number(item.amount || 0),
        items: [item],
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const rankDiff = termSortRank(a.label) - termSortRank(b.label);
    if (rankDiff !== 0) return rankDiff;
    return a.label.localeCompare(b.label);
  });
}

export function feeHeaderKeyForItem(item: SchoolFeeItem): string {
  return [
    item.code || item.name || "fee",
    item.category || "other",
    normalizedFeeTerm(item.term) || "term",
  ].join(":").toLowerCase().replace(/\s+/g, "_");
}

function feeCodeFamily(code: string | null | undefined): string {
  return String(code || "").trim().replace(/-EP$/i, "").toLowerCase();
}

function siblingMatchKey(item: SchoolFeeItem): string {
  return [
    feeCodeFamily(item.code),
    item.category || "other",
    normalizedFeeTerm(item.term) || "term",
  ].join(":");
}

function siblingFallbackMatchKey(item: SchoolFeeItem): string {
  return [
    item.category || "other",
    normalizedFeeTerm(item.term) || "term",
  ].join(":");
}

export function siblingDiscountForFeeItems(
  currentItems: SchoolFeeItem[],
  siblingRateItems: SchoolFeeItem[] | null | undefined,
): number | null {
  if (!siblingRateItems || siblingRateItems.length === 0) return null;

  const byExact = new Map<string, SchoolFeeItem[]>();
  const byFallback = new Map<string, SchoolFeeItem[]>();
  for (const item of siblingRateItems) {
    const exactKey = siblingMatchKey(item);
    byExact.set(exactKey, [...(byExact.get(exactKey) || []), item]);
    const fallbackKey = siblingFallbackMatchKey(item);
    byFallback.set(fallbackKey, [...(byFallback.get(fallbackKey) || []), item]);
  }

  let discount = 0;
  let matched = false;
  for (const item of currentItems) {
    const exactMatches = byExact.get(siblingMatchKey(item)) || [];
    const fallbackMatches = byFallback.get(siblingFallbackMatchKey(item)) || [];
    const match = exactMatches[0] || (fallbackMatches.length === 1 ? fallbackMatches[0] : null);
    if (!match) continue;
    matched = true;
    discount += Math.max(0, Number(item.amount || 0) - Number(match.amount || 0));
  }

  return matched ? Math.round(discount) : null;
}

function legacyFeeHeaderKeyForItem(item: SchoolFeeItem): string {
  return [
    item.code || item.name || "fee",
    item.category || "other",
  ].join(":").toLowerCase().replace(/\s+/g, "_");
}

export function groupFeeItemsByHeader(items: SchoolFeeItem[]): GroupedSchoolFeeHeader[] {
  const groups = new Map<string, GroupedSchoolFeeHeader>();
  for (const item of items) {
    const key = feeHeaderKeyForItem(item);
    const existing = groups.get(key);
    if (existing) {
      existing.total += Number(item.amount || 0);
      existing.items.push(item);
    } else {
      groups.set(key, {
        key,
        legacyKey: legacyFeeHeaderKeyForItem(item),
        label: item.name || item.code || "Fee",
        totalLabel: feeHeadTotalLabel([item]),
        periodLabel: feeHeadPeriodLabel([item]),
        category: item.category || "other",
        total: Number(item.amount || 0),
        items: [item],
      });
    }
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    totalLabel: feeHeadTotalLabel(group.items),
    periodLabel: feeHeadPeriodLabel(group.items),
  })).sort((a, b) => {
    const categoryDiff = a.category.localeCompare(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    const labelDiff = a.label.localeCompare(b.label);
    if (labelDiff !== 0) return labelDiff;
    const rankDiff = termSortRank(a.periodLabel) - termSortRank(b.periodLabel);
    if (rankDiff !== 0) return rankDiff;
    return a.periodLabel.localeCompare(b.periodLabel);
  });
}

export function allocateFeeHeaderWaivers(
  items: SchoolFeeItem[],
  waiverByHeader: Record<string, number | string | null | undefined>,
): FeeHeaderWaiverAllocation {
  const remaining = new Map<string, number>();
  const headers = groupFeeItemsByHeader(items);
  const legacyKeysWithSpecificWaivers = new Set<string>();
  for (const header of headers) {
    const raw = waiverByHeader[header.key];
    if (raw !== null && raw !== undefined && String(raw) !== "") {
      legacyKeysWithSpecificWaivers.add(header.legacyKey);
    }
    remaining.set(header.key, Math.min(header.total, Math.max(0, Number(waiverByHeader[header.key] || 0))));
  }
  const legacyRemaining = new Map<string, number>();
  for (const item of items) {
    const key = legacyFeeHeaderKeyForItem(item);
    if (legacyRemaining.has(key)) continue;
    if (legacyKeysWithSpecificWaivers.has(key)) {
      legacyRemaining.set(key, 0);
      continue;
    }
    const total = items
      .filter((candidate) => legacyFeeHeaderKeyForItem(candidate) === key)
      .reduce((sum, candidate) => sum + Number(candidate.amount || 0), 0);
    legacyRemaining.set(key, Math.min(total, Math.max(0, Number(waiverByHeader[key] || 0))));
  }

  let waiverTotal = 0;
  let admissionWaiverTotal = 0;
  let grayquestWaiverTotal = 0;
  const allocations = items.map((item) => {
    const headerKey = feeHeaderKeyForItem(item);
    const legacyHeaderKey = legacyFeeHeaderKeyForItem(item);
    const available = (remaining.get(headerKey) || 0) || (legacyRemaining.get(legacyHeaderKey) || 0);
    const waiver = Math.min(Number(item.amount || 0), available);
    remaining.set(headerKey, Math.max(0, available - waiver));
    legacyRemaining.set(legacyHeaderKey, Math.max(0, (legacyRemaining.get(legacyHeaderKey) || 0) - waiver));
    waiverTotal += waiver;
    if (isAdmissionPayableFeeItem(item)) {
      admissionWaiverTotal += waiver;
    } else {
      grayquestWaiverTotal += waiver;
    }
    return {
      ...item,
      headerKey,
      waiver,
      net: Math.max(0, Number(item.amount || 0) - waiver),
    };
  });

  return {
    items: allocations,
    waiverTotal,
    admissionWaiverTotal,
    grayquestWaiverTotal,
  };
}

export function computeSchoolProposalChildTotals(input: SchoolProposalChildInput): SchoolProposalChildTotals {
  const oneTime = Math.max(0, Number(input.oneTime || 0));
  const recurringBase = Math.max(0, Number(input.recurringBase || 0));
  const firstQuarterBase = Math.max(0, Number(input.firstQuarterBase || 0));
  const transportAnnual = Math.max(0, Number(input.transportAnnual || 0));
  const transportFirstQuarter = Math.max(0, Number(input.transportFirstQuarter || 0));
  const boardingAnnual = Math.max(0, Number(input.boardingAnnual || 0));
  const boardingFirstQuarter = Math.max(0, Number(input.boardingFirstQuarter || 0));
  const waiverAmount = Math.max(0, Number(input.waiverAmount || 0));
  const admissionWaiverAmount = Math.max(0, Number(input.admissionWaiverAmount || 0));
  const grayquestWaiverAmount = Math.max(0, Number(input.grayquestWaiverAmount ?? waiverAmount));
  const admissionPaidAmount = Math.max(0, Number(input.admissionPaidAmount || 0));
  const grayquestPaidAmount = Math.max(0, Number(input.grayquestPaidAmount || 0));

  const annualBeforeWaiver = oneTime + recurringBase + transportAnnual + boardingAnnual;
  const recurringAfterFirstQuarter = Math.max(
    0,
    recurringBase + transportAnnual + boardingAnnual - firstQuarterBase - transportFirstQuarter - boardingFirstQuarter,
  );
  const grayquestPrincipal = Math.max(0, recurringAfterFirstQuarter - grayquestWaiverAmount - grayquestPaidAmount);
  const admissionPayable = Math.max(0, oneTime + firstQuarterBase + transportFirstQuarter + boardingFirstQuarter - admissionWaiverAmount - admissionPaidAmount);

  return {
    oneTime,
    annualBeforeWaiver,
    annualAfterWaiver: Math.max(0, annualBeforeWaiver - waiverAmount),
    firstQuarterBeforeWaiver: firstQuarterBase + transportFirstQuarter + boardingFirstQuarter,
    admissionPayable,
    grayquestPrincipal,
  };
}
