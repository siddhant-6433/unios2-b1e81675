import { describe, expect, it, vi } from "vitest";
import { renderAuthorizedReport, privateReportHeaders } from "../../supabase/functions/beacon-report-pdf/delivery";
import { wrapReportText } from "../../supabase/functions/beacon-report-pdf/layout";

const grant = { report_id: "report-1", revision: 3, eligibility_token: "released-clear-v3", snapshot: {} };

describe("academic PDF authorization", () => {
  it("checks eligibility both before rendering and before delivery", async () => {
    const authorize = vi.fn().mockResolvedValue(grant);
    const render = vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const result = await renderAuthorizedReport(grant.report_id, authorize, render);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenCalledOnce();
    expect(result.bytes[0]).toBe(37);
    expect(privateReportHeaders["Cache-Control"]).toContain("no-store");
  });
  it("never renders a blocked report", async () => {
    const render = vi.fn();
    await expect(renderAuthorizedReport(grant.report_id, vi.fn().mockRejectedValue(new Error("fee_hold")), render)).rejects.toThrow("fee_hold");
    expect(render).not.toHaveBeenCalled();
  });
  it.each(["fee_hold", "withdrawn", "unrelated_child", "exception_revoked", "disabled_student"])("discards rendered bytes after %s", async code => {
    const authorize = vi.fn().mockResolvedValueOnce(grant).mockRejectedValueOnce(new Error(code));
    await expect(renderAuthorizedReport(grant.report_id, authorize, async () => new Uint8Array([1]))).rejects.toThrow(code);
  });
  it("discards a superseded academic revision", async () => {
    const authorize = vi.fn().mockResolvedValueOnce(grant).mockResolvedValueOnce({ ...grant, revision: 4 });
    await expect(renderAuthorizedReport(grant.report_id, authorize, async () => new Uint8Array([1]))).rejects.toThrow("report_changed");
  });
  it("discards a changed release/fee eligibility token", async () => {
    const authorize = vi.fn().mockResolvedValueOnce(grant).mockResolvedValueOnce({ ...grant, eligibility_token: "other" });
    await expect(renderAuthorizedReport(grant.report_id, authorize, async () => new Uint8Array([1]))).rejects.toThrow("report_changed");
  });
});

describe("report wrapping", () => {
  it("preserves long unbroken names and explicit paragraphs", () => {
    const lines = wrapReportText("Averyverylongname\nSecond paragraph", 8, text => text.length);
    expect(lines.every(line => line.length <= 8)).toBe(true);
    expect(lines.join("").replace(/ /g, "")).toBe("AveryverylongnameSecondparagraph");
  });
  it("preserves combining characters and Hindi clusters", () => {
    const text = "राम कुमार e\u0301";
    const lines = wrapReportText(text, 5, value => Array.from(value).length);
    expect(lines.join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""));
    expect(lines.some(line => line.startsWith("\u0301"))).toBe(false);
  });
});
