import { privateReportHeaders, renderAuthorizedReport, ReportDeliveryError, type DownloadGrant } from "./delivery.ts";

export interface ExamPayload<T> {
  exam_id: string;
  title: string;
  reports: { report_id: string; revision: number; snapshot: T }[];
}
export interface ReportHandlerDependencies<T> {
  enabled: boolean;
  authenticate: (authorization: string) => Promise<boolean>;
  authorize: (authorization: string, reportId: string) => Promise<DownloadGrant<T>>;
  authorizeExam: (authorization: string, examId: string) => Promise<ExamPayload<T>>;
  render: (grant: DownloadGrant<T>) => Promise<Uint8Array>;
  renderMerged: (snapshots: T[]) => Promise<Uint8Array>;
  log?: (event: string) => void;
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: string, fallback: string) => value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || fallback;

export function createReportHandler<T>(dependencies: ReportHandlerDependencies<T>) {
  return async (request: Request): Promise<Response> => {
    const headers = { ...cors, ...privateReportHeaders };
    const error = (code: string, status: number) => Response.json({ error: code }, { status, headers });
    const pdf = (bytes: Uint8Array, filename: string) => new Response(new Uint8Array(bytes), {
      headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` },
    });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return error("method_not_allowed", 405);
    if (!dependencies.enabled) return error("reports_not_enabled", 404);
    const authorization = request.headers.get("Authorization") ?? "";
    if (!/^Bearer\s+\S+$/i.test(authorization)) return error("authentication_required", 401);
    try {
      if (!await dependencies.authenticate(authorization)) return error("authentication_required", 401);
      let body: unknown;
      try { body = await request.json(); } catch { return error("invalid_request", 400); }
      const reportId = typeof body === "object" && body !== null && "report_id" in body ? body.report_id : null;
      const examId = typeof body === "object" && body !== null && "exam_id" in body ? body.exam_id : null;

      // Bulk print for an exam: one merged PDF of every fee-eligible released report.
      if (typeof examId === "string" && UUID.test(examId)) {
        const payload = await dependencies.authorizeExam(authorization, examId);
        if (!payload.reports.length) return error("no_reports", 404);
        const bytes = await dependencies.renderMerged(payload.reports.map(report => report.snapshot));
        return pdf(bytes, `${clean(payload.title, "Assessment")}-All-Reports-NIMT.pdf`);
      }

      if (typeof reportId !== "string" || !UUID.test(reportId)) return error("invalid_report_id", 400);
      const { bytes, grant } = await renderAuthorizedReport(reportId,
        id => dependencies.authorize(authorization, id), dependencies.render);
      const snapshot = (grant as { snapshot?: { student?: { name?: string }; title?: string } }).snapshot;
      return pdf(bytes, `${clean(snapshot?.student?.name ?? "", "Candidate")}-${clean(snapshot?.title ?? "", "Assessment")}-Report-NIMT.pdf`);
    } catch (cause) {
      // Never log snapshots, identities, marks, ledger balances or RPC messages.
      const code = cause instanceof ReportDeliveryError ? cause.code : "render_failed";
      dependencies.log?.(code);
      return error(code, cause instanceof ReportDeliveryError ? cause.status : 503);
    }
  };
}
