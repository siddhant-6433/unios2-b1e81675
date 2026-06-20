import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const applyPortal = readFileSync("src/pages/ApplyPortal.tsx", "utf8");
const passwordLoginFunction = readFileSync("supabase/functions/apply-portal-password-login/index.ts", "utf8");
const supabaseConfig = readFileSync("supabase/config.toml", "utf8");

describe("NIMT apply portal password login", () => {
  it("shows the temporary username/password option only for the NIMT portal", () => {
    expect(applyPortal).toContain('const passwordLoginEnabled = portal.id === "nimt"');
    expect(applyPortal).toContain('supabase.functions.invoke("apply-portal-password-login"');
    expect(applyPortal).toContain("Use username and password");
  });

  it("keeps the edge function scoped to NIMT and configured as public", () => {
    expect(passwordLoginFunction).toContain('if (portal !== "nimt")');
    expect(passwordLoginFunction).toContain('const DEFAULT_USERNAME = "razorpay_uat"');
    expect(passwordLoginFunction).toContain('const DEFAULT_PHONE = "+919999000026"');
    expect(supabaseConfig).toContain("[functions.apply-portal-password-login]");
    expect(supabaseConfig).toContain("verify_jwt = false");
  });
});
