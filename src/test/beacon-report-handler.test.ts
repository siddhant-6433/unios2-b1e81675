import { describe, expect, it, vi } from "vitest";
import { createReportHandler } from "../../supabase/functions/beacon-report-pdf/handler";
import { ReportDeliveryError } from "../../supabase/functions/beacon-report-pdf/delivery";
const id = "11111111-1111-4111-8111-111111111111";
const grant = { report_id: id, revision: 1, eligibility_token: "released-clear", snapshot: { student: { name: "Aarav Sharma" }, title: "Half Yearly Examination" } };
const request = (body = JSON.stringify({ report_id: id })) => new Request("https://example.test/report", { method: "POST", headers: { Authorization: "Bearer family-token", "Content-Type": "application/json" }, body });
function setup() {
  const dependencies = {
    enabled: true,
    authenticate: vi.fn().mockResolvedValue(true),
    authorize: vi.fn().mockResolvedValue(grant),
    authorizeExam: vi.fn().mockResolvedValue({ exam_id: id, title: "Half Yearly Examination", reports: [grant] }),
    render: vi.fn().mockResolvedValue(new Uint8Array([37,80,68,70])),
    renderMerged: vi.fn().mockResolvedValue(new Uint8Array([37,80,68,70])),
    log: vi.fn(),
  };
  return { dependencies, handler: createReportHandler(dependencies) };
}
const examRequest = () => new Request("https://example.test/report", { method: "POST", headers: { Authorization: "Bearer family-token", "Content-Type": "application/json" }, body: JSON.stringify({ exam_id: id }) });
describe("Beacon PDF HTTP endpoint", () => {
  it("returns private authenticated PDF bytes and checks the same caller twice", async () => {
    const { handler, dependencies } = setup();
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(response.headers.get("Content-Disposition")).toContain("Aarav-Sharma-Half-Yearly-Examination-Report-NIMT.pdf");
    expect(await response.text()).toBe("%PDF");
    expect(dependencies.authenticate).toHaveBeenCalledWith("Bearer family-token");
    expect(dependencies.authorize.mock.calls).toEqual([["Bearer family-token",id],["Bearer family-token",id]]);
  });
  it("rejects invalid sessions before retrieving data", async () => {
    const { handler, dependencies } = setup(); dependencies.authenticate.mockResolvedValue(false);
    expect((await handler(request())).status).toBe(401); expect(dependencies.authorize).not.toHaveBeenCalled();
  });
  it("defaults disabled and rejects bad JSON/ids without invoking RPCs", async () => {
    const { handler, dependencies } = setup();
    dependencies.enabled = false;
    expect((await handler(request())).status).toBe(404);
    dependencies.enabled = true;
    expect((await handler(request("invalid"))).status).toBe(400);
    expect((await handler(request('{"report_id":"malicious"}'))).status).toBe(400);
    expect(dependencies.authorize).not.toHaveBeenCalled();
  });
  it.each([1,2])("returns no private content if authorization check %s fails", async check => {
    const { handler, dependencies } = setup();
    if (check === 2) dependencies.authorize.mockResolvedValueOnce(grant);
    dependencies.authorize.mockRejectedValue(new ReportDeliveryError("report_unavailable",403));
    const response = await handler(request());
    expect(response.status).toBe(403); expect(await response.json()).toEqual({error:"report_unavailable"});
    if (check === 1) expect(dependencies.render).not.toHaveBeenCalled();
  });
  it("allows retry after rendering fails and leaks no raw exception text", async () => {
    const { handler, dependencies } = setup();
    dependencies.render.mockRejectedValueOnce(new Error("private ledger values"));
    const response = await handler(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private ledger");
    expect((await handler(request())).status).toBe(200);
  });
  it("merges all fee-eligible reports for an exam into one PDF", async () => {
    const { handler, dependencies } = setup();
    const response = await handler(examRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("Half-Yearly-Examination-All-Reports-NIMT.pdf");
    expect(dependencies.authorizeExam).toHaveBeenCalledOnce();
    expect(dependencies.renderMerged).toHaveBeenCalledOnce();
  });

  it("returns no-reports when no fee-eligible report exists for the exam", async () => {
    const { handler, dependencies } = setup();
    dependencies.authorizeExam.mockResolvedValue({ exam_id: id, title: "Half Yearly", reports: [] });
    const response = await handler(examRequest());
    expect(response.status).toBe(404);
    expect(dependencies.renderMerged).not.toHaveBeenCalled();
  });

  it("discards bytes when the revision changes during rendering", async () => {
    const { handler, dependencies } = setup();
    dependencies.authorize.mockResolvedValueOnce(grant).mockResolvedValueOnce({...grant,revision:2});
    const response = await handler(request());
    expect(response.status).toBe(409); expect(await response.text()).not.toContain("%PDF");
  });
});
