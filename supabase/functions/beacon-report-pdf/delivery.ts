/** Kept independent of the runtime so the last-moment authorization gate is testable. */
export interface DownloadGrant<T = unknown> {
  report_id: string;
  revision: number;
  eligibility_token: string;
  snapshot: T;
}

export class ReportDeliveryError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

export async function renderAuthorizedReport<T>(
  reportId: string,
  authorize: (id: string) => Promise<DownloadGrant<T>>,
  render: (grant: DownloadGrant<T>) => Promise<Uint8Array>,
): Promise<{ bytes: Uint8Array; grant: DownloadGrant<T> }> {
  const grant = await authorize(reportId);
  if (grant.report_id !== reportId || !grant.eligibility_token || !Number.isInteger(grant.revision)) {
    throw new ReportDeliveryError("report_unavailable", 409);
  }
  const bytes = await render(grant);
  // Payment reversals, withdrawal, corrections and exception revocation must take
  // effect even when they happen while the PDF is being rendered.
  const current = await authorize(reportId);
  if (current.report_id !== grant.report_id || current.revision !== grant.revision ||
      current.eligibility_token !== grant.eligibility_token) {
    throw new ReportDeliveryError("report_changed", 409);
  }
  return { bytes, grant };
}

export const privateReportHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "Vary": "Authorization, Origin",
  "X-Content-Type-Options": "nosniff",
};
