export const BEACON_TRANSPORT_RATES = {
  zone_1: { code: "NB-TR1", oneWayCode: "NB-OTR1", monthly: 2000 },
  zone_2: { code: "NB-TR2", oneWayCode: "NB-OTR2", monthly: 2500 },
  zone_3: { code: "NB-TR3", oneWayCode: "NB-OTR3", monthly: 3500 },
} as const;

export const BEACON_TRANSPORT_RATES_BY_SESSION = {
  "2026-27": { zone_1: 1800, zone_2: 2500, zone_3: 3500 },
  "2027-28": { zone_1: 2000, zone_2: 2500, zone_3: 3500 },
} as const;

export const BEACON_ACADEMIC_MONTHS = [
  { month: 4, name: "April", quarter: "q1" },
  { month: 5, name: "May", quarter: "q1" },
  { month: 6, name: "June", quarter: "q1" },
  { month: 7, name: "July", quarter: "q2" },
  { month: 8, name: "August", quarter: "q2" },
  { month: 9, name: "September", quarter: "q2" },
  { month: 10, name: "October", quarter: "q3" },
  { month: 11, name: "November", quarter: "q3" },
  { month: 12, name: "December", quarter: "q3" },
  { month: 1, name: "January", quarter: "q4" },
  { month: 2, name: "February", quarter: "q4" },
  { month: 3, name: "March", quarter: "q4" },
] as const;

export const BEACON_QUARTER_DUE_DATES = {
  q1: { month: 4, day: 10 },
  q2: { month: 7, day: 10 },
  q3: { month: 10, day: 10 },
  q4: { month: 1, day: 10 },
} as const;

export type BeaconTransportZone = keyof typeof BEACON_TRANSPORT_RATES;

export function beaconTransportDefaultMonthlyAmount(zone: BeaconTransportZone, oneWay: boolean): number {
  const fullRate = BEACON_TRANSPORT_RATES[zone].monthly;
  return oneWay ? fullRate / 2 : fullRate;
}

export function beaconTransportSessionDefaultMonthlyAmount(session: keyof typeof BEACON_TRANSPORT_RATES_BY_SESSION, zone: BeaconTransportZone, oneWay: boolean): number {
  const fullRate = BEACON_TRANSPORT_RATES_BY_SESSION[session][zone];
  return oneWay ? fullRate / 2 : fullRate;
}

export function beaconTransportQuarterTotals(months: number[], monthlyAmount: number): Record<string, number> {
  const totals: Record<string, number> = { q1: 0, q2: 0, q3: 0, q4: 0 };
  for (const month of months) {
    const item = BEACON_ACADEMIC_MONTHS.find((candidate) => candidate.month === month);
    if (item) totals[item.quarter] += monthlyAmount;
  }
  return totals;
}

export function beaconTransportQuarterDueDate(quarter: keyof typeof BEACON_QUARTER_DUE_DATES, academicYearStart: number): string {
  const due = BEACON_QUARTER_DUE_DATES[quarter];
  const year = academicYearStart + (due.month < 4 ? 1 : 0);
  return `${year}-${String(due.month).padStart(2, "0")}-${String(due.day).padStart(2, "0")}`;
}
