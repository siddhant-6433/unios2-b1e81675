import { privateReportHeaders, renderAuthorizedReport, ReportDeliveryError, type DownloadGrant } from "./delivery.ts";

export interface ReportHandlerDependencies<T> {
  enabled: boolean;
  authenticate: (authorization: string) => Promise<boolean>;
  authorize: (authorization: string, reportId: string) => Promise<DownloadGrant<T>>;
  render: (grant: DownloadGrant<T>) => Promise<Uint8Array>;
  log?: (event: string) => void;
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export function createReportHandler<T>(dependencies: ReportHandlerDependencies<T>) {
  return async (request: Request): Promise<Response> => {
    const headers = { ...cors, ...privateReportHeaders };
    const error = (code: string, status: number) => Response.json({ error: code }, { status, headers });
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
      if (typeof reportId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reportId)) return error("invalid_report_id", 400);
      const { bytes, grant } = await renderAuthorizedReport(reportId,
        id => dependencies.authorize(authorization, id), dependencies.render);
      const snapshot = (grant as { snapshot?: { student?: { name?: string }; title?: string } }).snapshot;
      const clean = (value: string, fallback: string) => value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || fallback;
      const filename = `${clean(snapshot?.student?.name ?? "", "Candidate")}-${clean(snapshot?.title ?? "", "Assessment")}-Report-NIMT.pdf`;
      return new Response(new Uint8Array(bytes), { headers: {
        ...headers, "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      } });
    } catch (cause) {
      // Never log snapshots, identities, marks, ledger balances or RPC messages.
      const code = cause instanceof ReportDeliveryError ? cause.code : "render_failed";
      dependencies.log?.(code);
      return error(code, cause instanceof ReportDeliveryError ? cause.status : 503);
    }
  };
}
