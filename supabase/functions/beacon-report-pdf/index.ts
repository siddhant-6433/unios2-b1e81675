import { createClient } from "npm:@supabase/supabase-js@2.108.1";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { createReportHandler, type ExamPayload } from "./handler.ts";
import { ReportDeliveryError } from "./delivery.ts";
import { renderBeaconReport } from "./renderer.ts";
import type { CbseDownloadPayload } from "../../../src/lib/cbseExams.ts";

const clientFor = (authorization: string) => createClient(
  Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
  { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } },
);
Deno.serve(createReportHandler({
  enabled: Deno.env.get("BEACON_ACADEMICS_ENABLED") === "true",
  authenticate: async authorization => {
    const { data, error } = await clientFor(authorization).auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
    return !error && Boolean(data.user);
  },
  authorize: async (authorization, reportId) => {
    const { data, error } = await clientFor(authorization).rpc("cbse_download_payload", { _report_id: reportId });
    if (error || !data) throw new ReportDeliveryError("report_unavailable", 403);
    return data as CbseDownloadPayload;
  },
  authorizeExam: async (authorization, examId) => {
    const { data, error } = await clientFor(authorization).rpc("cbse_exam_print_payloads", { _exam_id: examId });
    if (error || !data) throw new ReportDeliveryError("exam_unavailable", 403);
    return data as ExamPayload<CbseDownloadPayload["snapshot"]>;
  },
  render: grant => renderBeaconReport(grant.snapshot),
  renderMerged: async snapshots => {
    const merged = await PDFDocument.create();
    for (const snapshot of snapshots) {
      const document = await PDFDocument.load(await renderBeaconReport(snapshot));
      const pages = await merged.copyPages(document, document.getPageIndices());
      for (const page of pages) merged.addPage(page);
    }
    return merged.save();
  },
  log: event => console.error(JSON.stringify({ function: "beacon-report-pdf", event })),
}));
