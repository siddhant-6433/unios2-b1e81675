import { describe, expect, it, vi } from "vitest";
import { selectSavedApplications } from "@/lib/savedApplicationRouting";

describe("saved applications after manual applicant login", () => {
  it("does not display or rebrand an unflagged shared-campus B.Ed application on Mirai", async () => {
    const application = { application_id: "APP-BED", lead_id: "college-lead", flags: [] };
    const resolver = vi.fn().mockResolvedValue({ portal: "nimt", mirai_rollout_enabled: true });
    const result = await selectSavedApplications([application], "mirai", resolver);
    expect(result.applications).toEqual([]);
    expect(result.redirectPortal).toBe("nimt");
    expect(resolver).toHaveBeenCalledWith(application);
    expect(application.flags).toEqual([]);
  });
  it("shows a saved legacy Mirai application only on its owning portal without changing flags", async () => {
    const application = { application_id: "APP-MIRAI", flags: [] };
    const resolver = async () => ({ portal: "mirai" as const, mirai_rollout_enabled: true });
    expect((await selectSavedApplications([application], "mirai", resolver)).applications).toEqual([application]);
    expect((await selectSavedApplications([application], "nimt", resolver)).redirectPortal).toBe("mirai");
    expect(application.flags).toEqual([]);
  });
  it("requires the server rollout gate before redirecting manual sessions", async () => {
    const result = await selectSavedApplications([{ application_id: "APP-BED" }], "mirai",
      async () => ({ portal: "nimt", mirai_rollout_enabled: false }));
    expect(result.redirectPortal).toBeUndefined();
    expect(result.applications).toEqual([]);
  });
  it("handles multiple saved institutions independently and does not guess a redirect", async () => {
    const mirai = { application_id: "M" }, nimt = { application_id: "N" };
    const resolver = async (app: typeof mirai) => ({ portal: app.application_id === "M" ? "mirai" as const : "nimt" as const,
      mirai_rollout_enabled: true });
    expect((await selectSavedApplications([mirai, nimt], "mirai", resolver)).applications).toEqual([mirai]);
    expect((await selectSavedApplications([mirai, nimt], "beacon", resolver)).redirectPortal).toBeUndefined();
  });
  it("fails closed when saved ownership cannot be verified", async () => {
    await expect(selectSavedApplications([{ application_id: "APP" }], "mirai", async () => {
      throw new Error("Application not available");
    })).rejects.toThrow("Application not available");
  });
});
