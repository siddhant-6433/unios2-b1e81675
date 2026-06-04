import { describe, expect, it } from "vitest";
import { getStudentClaimToken } from "@/lib/studentClaim";

describe("student claim token parsing", () => {
  it("returns a trimmed token when present", () => {
    expect(getStudentClaimToken(new URLSearchParams("token=%20abc123%20"))).toBe("abc123");
  });

  it("treats missing or blank token values as no claim token", () => {
    expect(getStudentClaimToken(new URLSearchParams(""))).toBeNull();
    expect(getStudentClaimToken(new URLSearchParams("token=%20%20"))).toBeNull();
  });
});
