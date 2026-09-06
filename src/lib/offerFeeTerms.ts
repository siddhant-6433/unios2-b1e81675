export interface OfferFeeItemLike {
  term?: string | null;
  amount?: number | string | null;
  // Category/code may be flat or nested under fee_codes depending on the query shape.
  category?: string | null;
  code?: string | null;
  fee_codes?: { code?: string | null; category?: string | null } | null;
}

export interface OfferFeeTermTotal {
  term: string;
  total: number;
}

const SCHOOL_OFFER_TERM_ORDER = ["admission", "q1", "q2", "q3", "q4"];

// ── School fee mode ──────────────────────────────────────────────────────────
// School fee structures list every boarding tier, every transport tier and the
// boarder-only security deposit as separate line items on the same term. They are
// mutually-exclusive add-ons the family picks — NOT all part of one bill. Which
// ones apply depends on the chosen mode. With no selection we show the base fee
// (day scholar, no transport): tuition + admission + registration + other. This
// mirrors provision-student-fees (the ledger builder) and FeeStructureViewer so
// the offer, the PDF and the eventual student ledger all agree.
export type SchoolStudentType = "day_scholar" | "day_boarder" | "boarder";
export type SchoolHostelType = "non_ac" | "ac_central" | "ac_individual";
export type SchoolTransportZone = "zone_1" | "zone_2" | "zone_3";

export interface SchoolFeeSelection {
  studentType?: SchoolStudentType | null;
  hostelType?: SchoolHostelType | null;
  transportZone?: SchoolTransportZone | null;
}

// Fee codes are brand-prefixed (NB- beacon, MR- mirai, BSAV- …); match by suffix.
const HOSTEL_CODE_SUFFIXES: Record<SchoolHostelType, string[]> = {
  non_ac: ["NAC", "B5"],
  ac_central: ["CBA", "B7"],
  ac_individual: ["IBA"],
};
const TRANSPORT_CODE_SUFFIX: Record<SchoolTransportZone, string> = {
  zone_1: "TR1",
  zone_2: "TR2",
  zone_3: "TR3",
};
const DAY_BOARDING_CODE_SUFFIX = "DBA";
const SECURITY_DEPOSIT_CODE_SUFFIX = "SEC";

function itemCategory(item: OfferFeeItemLike | null | undefined): string {
  return String(item?.category ?? item?.fee_codes?.category ?? "").trim().toLowerCase();
}
function itemCode(item: OfferFeeItemLike | null | undefined): string {
  return String(item?.code ?? item?.fee_codes?.code ?? "").trim().toUpperCase();
}

// Whether a fee item belongs in the programme fee for the chosen school mode.
// Keep in sync with the same-named helper in generate-offer-letter/index.ts.
export function includeOfferFeeItem(
  item: OfferFeeItemLike | null | undefined,
  selection?: SchoolFeeSelection | null,
): boolean {
  const category = itemCategory(item);
  const code = itemCode(item);
  const studentType: SchoolStudentType = selection?.studentType || "day_scholar";

  if (category === "transport") {
    const zone = selection?.transportZone;
    return !!zone && code.endsWith(TRANSPORT_CODE_SUFFIX[zone]);
  }
  if (category === "hostel") {
    if (studentType === "day_scholar") return false;
    if (studentType === "day_boarder") return code.endsWith(DAY_BOARDING_CODE_SUFFIX);
    // boarder: one matching hostel tier, never the day-boarding line
    if (code.endsWith(DAY_BOARDING_CODE_SUFFIX)) return false;
    const hostelType = selection?.hostelType;
    return !!hostelType && HOSTEL_CODE_SUFFIXES[hostelType].some((s) => code.endsWith(s));
  }
  if (category === "enrollment" && code.endsWith(SECURITY_DEPOSIT_CODE_SUFFIX)) {
    return studentType === "boarder"; // security deposit is boarders-only
  }
  return true; // tuition, enrollment (non-deposit), other
}

/** Base programme fee item (day scholar, no add-ons). */
export function isBaseOfferProgrammeFeeItem(item: OfferFeeItemLike | null | undefined): boolean {
  return includeOfferFeeItem(item, undefined);
}

/** True when a structure exposes school boarding/transport add-on options. */
export function hasSchoolFeeOptions(items: OfferFeeItemLike[] | null | undefined): boolean {
  return (items || []).some((item) => {
    const category = itemCategory(item);
    return category === "hostel" || category === "transport";
  });
}

// The refundable, boarder-only security deposit shares the "admission" term in
// the fee structure. Break it out onto its own synthetic display term so it isn't
// read as part of the admission fee — it stays in the total, just on its own line.
export const SECURITY_DEPOSIT_TERM = "security_deposit";

export function isSecurityDepositItem(item: OfferFeeItemLike | null | undefined): boolean {
  return itemCode(item).endsWith(SECURITY_DEPOSIT_CODE_SUFFIX);
}

export function isOfferProgrammeFeeTerm(term: string | null | undefined): boolean {
  const normalized = String(term || "").trim().toLowerCase();
  return /^year_\d+$/.test(normalized) || SCHOOL_OFFER_TERM_ORDER.includes(normalized);
}

export function offerFeeTermRank(term: string): number {
  const normalized = term.trim().toLowerCase();
  const yearMatch = normalized.match(/^year_(\d+)$/);
  if (yearMatch) return Number(yearMatch[1]);

  // Security deposit sorts right after the admission line (both one-time).
  if (normalized === SECURITY_DEPOSIT_TERM) return 100.5;

  const schoolIndex = SCHOOL_OFFER_TERM_ORDER.indexOf(normalized);
  if (schoolIndex >= 0) return 100 + schoolIndex;

  return 1_000;
}

export function collectOfferFeeTermTotals(
  items: OfferFeeItemLike[] | null | undefined,
  selection?: SchoolFeeSelection | null,
): OfferFeeTermTotal[] {
  const byTerm = new Map<string, number>();
  for (const item of items || []) {
    const term = String(item?.term || "").trim().toLowerCase();
    const amount = Number(item?.amount || 0);
    if (!isOfferProgrammeFeeTerm(term) || !Number.isFinite(amount) || amount <= 0) continue;
    if (!includeOfferFeeItem(item, selection)) continue;
    // Route the security deposit to its own line rather than folding it into admission.
    const displayTerm = isSecurityDepositItem(item) ? SECURITY_DEPOSIT_TERM : term;
    byTerm.set(displayTerm, (byTerm.get(displayTerm) || 0) + amount);
  }

  return Array.from(byTerm.entries())
    .sort(([a], [b]) => offerFeeTermRank(a) - offerFeeTermRank(b) || a.localeCompare(b))
    .map(([term, total]) => ({ term, total }));
}

export function firstOfferFeeTerm(totals: OfferFeeTermTotal[]): string {
  return totals.find((item) => item.term === "year_1")?.term || totals[0]?.term || "year_1";
}

// ── Per-component breakdown ───────────────────────────────────────────────────
// Each quarter (q1..q4) is really the sum of separate fee_structure_items sharing
// a term: tuition, hostel (boarding), transport, etc. This exposes that split so
// the offer breakdown can show — and a waiver can target — one component of a
// period. Component = fee_codes.category; a waiver's fee_category maps 1:1 to it.

export interface OfferFeeComponent {
  category: string; // fee_codes.category (tuition/hostel/transport/enrollment/other/…)
  label: string; // friendly label for the offer UI/PDF
  amount: number;
}

export interface OfferFeeTermBreakdown {
  term: string;
  total: number;
  components: OfferFeeComponent[];
}

const FEE_CATEGORY_LABELS: Record<string, string> = {
  tuition: "Tuition",
  hostel: "Boarding",
  transport: "Transport",
  enrollment: "Registration",
  lab: "Lab",
  library: "Library",
  exam: "Exam",
  other: "Other",
};

/** Friendly label for a fee component (waiver target / breakdown line). */
export function offerFeeComponentLabel(category: string): string {
  const key = String(category || "").trim().toLowerCase();
  return FEE_CATEGORY_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Other");
}

// Per-term component breakdown. Mirrors collectOfferFeeTermTotals' include rules,
// but groups each term's included items by category so the offer can show and
// waive a single component. The security-deposit line is its own term with a
// single "Security Deposit" component.
export function collectOfferFeeTermComponentTotals(
  items: OfferFeeItemLike[] | null | undefined,
  selection?: SchoolFeeSelection | null,
): OfferFeeTermBreakdown[] {
  // term -> (category -> amount)
  const byTerm = new Map<string, Map<string, number>>();
  for (const item of items || []) {
    const term = String(item?.term || "").trim().toLowerCase();
    const amount = Number(item?.amount || 0);
    if (!isOfferProgrammeFeeTerm(term) || !Number.isFinite(amount) || amount <= 0) continue;
    if (!includeOfferFeeItem(item, selection)) continue;
    const isDeposit = isSecurityDepositItem(item);
    const displayTerm = isDeposit ? SECURITY_DEPOSIT_TERM : term;
    // Deposit shares the enrollment category but reads as its own line.
    const category = isDeposit ? "security_deposit" : itemCategory(item) || "other";
    const catMap = byTerm.get(displayTerm) ?? new Map<string, number>();
    catMap.set(category, (catMap.get(category) || 0) + amount);
    byTerm.set(displayTerm, catMap);
  }

  return Array.from(byTerm.entries())
    .sort(([a], [b]) => offerFeeTermRank(a) - offerFeeTermRank(b) || a.localeCompare(b))
    .map(([term, catMap]) => {
      const components = Array.from(catMap.entries())
        .map(([category, amount]) => ({
          category,
          label: category === "security_deposit" ? "Security Deposit" : offerFeeComponentLabel(category),
          amount,
        }))
        .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
      const total = components.reduce((sum, c) => sum + c.amount, 0);
      return { term, total, components };
    });
}
