import { collectOfferFeeTermTotals } from "./offerFeeTerms";

export interface OfferSessionOption {
  id: string;
  name: string;
  is_active: boolean;
  has_fee_structure?: boolean;
}

interface FeeStructureLike {
  session_id?: string | null;
  fee_structure_items?: Array<{ term?: string | null; amount?: number | string | null }> | null;
}

export function feeStructureHasOfferFeeItems(structure: FeeStructureLike): boolean {
  return collectOfferFeeTermTotals(structure.fee_structure_items).length > 0;
}

export const feeStructureHasYearWiseItems = feeStructureHasOfferFeeItems;

export function feeBackedSessionIds(structures: FeeStructureLike[]): string[] {
  return Array.from(new Set(
    structures
      .filter(feeStructureHasOfferFeeItems)
      .map((structure) => structure.session_id)
      .filter((sessionId): sessionId is string => !!sessionId),
  ));
}

export function chooseOfferSessionId(
  sessions: OfferSessionOption[],
  currentSessionId: string,
): string {
  const current = sessions.find((session) => session.id === currentSessionId);
  if (current?.has_fee_structure) return current.id;

  const activeWithFees = sessions.find((session) => session.is_active && session.has_fee_structure);
  if (activeWithFees) return activeWithFees.id;

  const anyWithFees = sessions.find((session) => session.has_fee_structure);
  if (anyWithFees) return anyWithFees.id;

  if (currentSessionId) return currentSessionId;

  const active = sessions.find((session) => session.is_active);
  return active?.id || sessions[0]?.id || "";
}
