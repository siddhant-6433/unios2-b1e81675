import { describe, it, expect } from "vitest";
import {
  buildChangeDiff,
  formatDiff,
  normalizeFieldValue,
  REGULARISATION_REASONS,
  validatePunchTimes,
} from "./selfService";

const EDITABLE = [
  "personal_email",
  "mobile_number",
  "current_address",
  "date_of_birth",
  "nationality",
];

describe("buildChangeDiff", () => {
  it("keeps only fields whose value changed", () => {
    const diff = buildChangeDiff(
      { personal_email: "a@old.com", mobile_number: "111", nationality: "Indian" },
      { personal_email: "a@new.com", mobile_number: "111", nationality: "Indian" },
      EDITABLE,
    );
    expect(diff).toEqual({ personal_email: { from: "a@old.com", to: "a@new.com" } });
  });

  it("points from the old value to the new value, never backwards", () => {
    const diff = buildChangeDiff(
      { mobile_number: "9999999999" },
      { mobile_number: "8888888888" },
      EDITABLE,
    );
    expect(diff.mobile_number).toEqual({ from: "9999999999", to: "8888888888" });
  });

  it("returns an empty object when nothing changed", () => {
    expect(buildChangeDiff({ personal_email: "x@y.com" }, { personal_email: "x@y.com" }, EDITABLE)).toEqual({});
  });

  it("ignores fields outside the editable allow-list", () => {
    // Salary is a classic thing an employee would love to "edit". It must never
    // make it into the diff even if present on both sides.
    const diff = buildChangeDiff(
      { salary: 100, personal_email: "old@x.com" },
      { salary: 500, personal_email: "new@x.com" },
      EDITABLE,
    );
    expect(diff).not.toHaveProperty("salary");
    expect(Object.keys(diff)).toEqual(["personal_email"]);
  });

  it("treats whitespace-only edits as no change and empty strings as cleared", () => {
    const noop = buildChangeDiff({ nationality: "Indian" }, { nationality: "  Indian  " }, EDITABLE);
    expect(noop).toEqual({});

    const cleared = buildChangeDiff({ nationality: "Indian" }, { nationality: "   " }, EDITABLE);
    expect(cleared).toEqual({ nationality: { from: "Indian", to: null } });
  });

  it("handles a missing before or after object", () => {
    expect(buildChangeDiff(null, { nationality: "Indian" }, EDITABLE)).toEqual({
      nationality: { from: null, to: "Indian" },
    });
    expect(buildChangeDiff({ nationality: "Indian" }, undefined, EDITABLE)).toEqual({
      nationality: { from: "Indian", to: null },
    });
  });

  it("stringifies Json columns so addresses stay diffable", () => {
    const diff = buildChangeDiff(
      { current_address: { line1: "A" } },
      { current_address: { line1: "B" } },
      EDITABLE,
    );
    expect(diff.current_address).toEqual({ from: '{"line1":"A"}', to: '{"line1":"B"}' });
  });

  it("does not emit a field twice when the allow-list repeats", () => {
    const diff = buildChangeDiff(
      { nationality: "Indian" },
      { nationality: "French" },
      ["nationality", "nationality"],
    );
    expect(Object.keys(diff)).toEqual(["nationality"]);
  });

  it("only reports changes for selected fields when called with a subset", () => {
    const diff = buildChangeDiff(
      { personal_email: "a@x.com", nationality: "Indian" },
      { personal_email: "b@x.com", nationality: "French" },
      ["personal_email"],
    );
    expect(diff).toEqual({ personal_email: { from: "a@x.com", to: "b@x.com" } });
  });
});

describe("normalizeFieldValue", () => {
  it("collapses empty strings, null and undefined to null", () => {
    expect(normalizeFieldValue("")).toBeNull();
    expect(normalizeFieldValue("   ")).toBeNull();
    expect(normalizeFieldValue(null)).toBeNull();
    expect(normalizeFieldValue(undefined)).toBeNull();
  });

  it("trims strings and keeps truthy scalars", () => {
    expect(normalizeFieldValue("  hi  ")).toBe("hi");
    expect(normalizeFieldValue(0)).toBe("0");
    expect(normalizeFieldValue(false)).toBe("false");
  });
});

describe("formatDiff", () => {
  it("renders friendly labels with a from → to arrow", () => {
    const text = formatDiff({ personal_email: { from: "old@x.com", to: "new@x.com" } });
    expect(text).toBe("Personal email: old@x.com → new@x.com");
  });

  it("shows an em dash for cleared or newly set values", () => {
    expect(formatDiff({ mobile_number: { from: null, to: "9999999999" } }))
      .toBe("Mobile: — → 9999999999");
    expect(formatDiff({ mobile_number: { from: "9999999999", to: null } }))
      .toBe("Mobile: 9999999999 → —");
  });

  it("joins multiple fields and returns empty string for no diff", () => {
    const text = formatDiff({
      personal_email: { from: "a@x.com", to: "b@x.com" },
      nationality: { from: "Indian", to: "French" },
    });
    expect(text).toBe("Personal email: a@x.com → b@x.com; Nationality: Indian → French");
    expect(formatDiff({})).toBe("");
    expect(formatDiff(null)).toBe("");
  });

  it("falls back to the raw column name for an unknown field", () => {
    expect(formatDiff({ preferred_name: { from: "A", to: "B" } })).toBe("preferred_name: A → B");
  });

  it("labels every field the RPC can return", () => {
    const rpcFields = [
      "personal_email", "mobile_number", "work_number", "residence_number",
      "current_address", "permanent_address", "marital_status", "blood_group",
      "date_of_birth", "gender", "nationality", "education", "experience",
      "emergency_contact_name", "emergency_contact_phone",
    ];
    const text = formatDiff(Object.fromEntries(rpcFields.map((f) => [f, { from: "a", to: "b" }])));
    for (const field of rpcFields) {
      expect(text).not.toContain(`${field}:`);
    }
  });
});

describe("REGULARISATION_REASONS", () => {
  it("is a non-empty, unique, closed list including an escape hatch", () => {
    expect(REGULARISATION_REASONS.length).toBeGreaterThan(0);
    expect(new Set(REGULARISATION_REASONS).size).toBe(REGULARISATION_REASONS.length);
    expect(REGULARISATION_REASONS).toContain("Other");
  });
});

describe("validatePunchTimes", () => {
  it("accepts a valid pair", () => {
    expect(validatePunchTimes("09:00", "18:00")).toEqual({ ok: true, error: null });
    expect(validatePunchTimes("09:00:30", "18:15:00")).toEqual({ ok: true, error: null });
  });

  it("accepts a single corrected side", () => {
    expect(validatePunchTimes("09:00", "")).toEqual({ ok: true, error: null });
    expect(validatePunchTimes(null, "18:00")).toEqual({ ok: true, error: null });
  });

  it("rejects an entirely empty pair", () => {
    const result = validatePunchTimes("", "");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/punch-in or punch-out/i);
  });

  it("rejects malformed times", () => {
    expect(validatePunchTimes("9:00", "18:00").ok).toBe(false);
    expect(validatePunchTimes("25:00", "18:00").ok).toBe(false);
    expect(validatePunchTimes("09:60", "18:00").ok).toBe(false);
    expect(validatePunchTimes("09:00", "evening").ok).toBe(false);
  });

  it("rejects a punch-out that is not after the punch-in", () => {
    expect(validatePunchTimes("18:00", "09:00").error).toMatch(/later than punch-in/i);
    expect(validatePunchTimes("09:00", "09:00").error).toMatch(/later than punch-in/i);
  });
});
