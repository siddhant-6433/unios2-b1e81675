/** Compact INR so Finance header and receipts KPIs share a unit. */
export function formatCompactINR(amount: number) {
  const value = Number(amount) || 0;
  const abs = Math.abs(value);
  if (abs >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`;
  return `₹${(value / 1_000).toFixed(1)}K`;
}
