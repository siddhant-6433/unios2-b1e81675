import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const loginPage = readFileSync("src/pages/Login.tsx", "utf8");
const studentLoginFunction = readFileSync("supabase/functions/student-password-login/index.ts", "utf8");
const supabaseConfig = readFileSync("supabase/config.toml", "utf8");

describe("temporary Razorpay student password login", () => {
  it("exposes username/password sign-in from the production login page", () => {
    expect(loginPage).toContain('"student_password"');
    expect(loginPage).toContain('supabase.functions.invoke("student-password-login"');
    expect(loginPage).toContain("supabase.auth.signInWithPassword");
    expect(loginPage).toContain("Username or email");
    expect(loginPage).toContain("Sign in with username and password");
  });

  it("provisions the Razorpay UAT student as Beacon Avantika Grade V", () => {
    expect(studentLoginFunction).toContain('const DEFAULT_USERNAME = "razorpay_uat"');
    expect(studentLoginFunction).toContain('const DEFAULT_COURSE_CODE = "BSAV-G5"');
    expect(studentLoginFunction).toContain('joining_class: "Grade V"');
    expect(studentLoginFunction).toContain('fee_structure_version: "new_admission"');
    expect(studentLoginFunction).toContain('if (code === "NB-SEC") return false');
    expect(supabaseConfig).toContain("[functions.student-password-login]");
    expect(supabaseConfig).toContain("verify_jwt = false");
  });
});
