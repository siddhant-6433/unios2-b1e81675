import { describe, it, expect } from "vitest";
import {
  FIELD_TYPES,
  fieldTypeLabel,
  formatFieldValue,
  normalizeOptions,
  parseBoolean,
  sortDefs,
  validateFieldValue,
  type FieldDef,
} from "./customFields";

const def = (over: Partial<FieldDef> = {}): FieldDef => ({
  id: "f-1",
  key: "uniform_size",
  label: "Uniform size",
  field_type: "text",
  options: null,
  is_required: false,
  display_order: 0,
  is_active: true,
  ...over,
});

describe("FIELD_TYPES", () => {
  it("lists every type the DB CHECK allows", () => {
    expect([...FIELD_TYPES].sort()).toEqual(["boolean", "date", "number", "select", "text"]);
  });
});

describe("fieldTypeLabel", () => {
  it("names each known type", () => {
    expect(fieldTypeLabel("text")).toBe("Text");
    expect(fieldTypeLabel("number")).toBe("Number");
    expect(fieldTypeLabel("date")).toBe("Date");
    expect(fieldTypeLabel("boolean")).toBe("Yes / No");
    expect(fieldTypeLabel("select")).toBe("Select");
  });

  it("falls back to the raw string for an unknown type", () => {
    expect(fieldTypeLabel("mystery")).toBe("mystery");
  });
});

describe("normalizeOptions", () => {
  it("passes through an already-parsed array", () => {
    expect(normalizeOptions(["S", "M", "L"])).toEqual(["S", "M", "L"]);
  });

  it("parses a JSON-encoded string", () => {
    expect(normalizeOptions('["S","M"]')).toEqual(["S", "M"]);
  });

  it("drops blank entries and trims", () => {
    expect(normalizeOptions([" S ", "", "M", null])).toEqual(["S", "M"]);
  });

  it("returns an empty array for null, a non-array or bad JSON", () => {
    expect(normalizeOptions(null)).toEqual([]);
    expect(normalizeOptions(42)).toEqual([]);
    expect(normalizeOptions("not json")).toEqual([]);
  });
});

describe("parseBoolean", () => {
  it("reads the canonical and common spellings", () => {
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean("YES")).toBe(true);
    expect(parseBoolean("1")).toBe(true);
    expect(parseBoolean("false")).toBe(false);
    expect(parseBoolean("No")).toBe(false);
    expect(parseBoolean("0")).toBe(false);
  });

  it("is null for blank or unrecognised values", () => {
    expect(parseBoolean(null)).toBeNull();
    expect(parseBoolean("")).toBeNull();
    expect(parseBoolean("maybe")).toBeNull();
  });
});

describe("validateFieldValue", () => {
  it("rejects a blank value when the field is required", () => {
    const result = validateFieldValue(def({ is_required: true }), "");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("required");
    expect(result.error).toContain("Uniform size");
  });

  it("accepts a blank value when the field is optional", () => {
    expect(validateFieldValue(def(), "")).toEqual({ ok: true, error: null });
    expect(validateFieldValue(def(), null)).toEqual({ ok: true, error: null });
  });

  it("accepts any non-blank text", () => {
    expect(validateFieldValue(def({ field_type: "text" }), "XL").ok).toBe(true);
  });

  it("accepts numbers and rejects non-numeric text", () => {
    expect(validateFieldValue(def({ field_type: "number" }), "12.5").ok).toBe(true);
    expect(validateFieldValue(def({ field_type: "number" }), "-3").ok).toBe(true);
    const bad = validateFieldValue(def({ field_type: "number" }), "twelve");
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("number");
  });

  it("accepts an ISO date and rejects an impossible or mis-formatted one", () => {
    expect(validateFieldValue(def({ field_type: "date" }), "2026-01-15").ok).toBe(true);
    expect(validateFieldValue(def({ field_type: "date" }), "2026-02-30").ok).toBe(false);
    expect(validateFieldValue(def({ field_type: "date" }), "15/01/2026").ok).toBe(false);
  });

  it("constrains a select to its declared options", () => {
    const select = def({ field_type: "select", options: ["S", "M", "L"] });
    expect(validateFieldValue(select, "M").ok).toBe(true);
    const bad = validateFieldValue(select, "XXL");
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("S, M, L");
  });

  it("accepts any value for a select with no options configured", () => {
    expect(validateFieldValue(def({ field_type: "select", options: [] }), "anything").ok).toBe(true);
  });

  it("accepts a boolean spelling and rejects anything else", () => {
    expect(validateFieldValue(def({ field_type: "boolean" }), "true").ok).toBe(true);
    expect(validateFieldValue(def({ field_type: "boolean" }), "false").ok).toBe(true);
    expect(validateFieldValue(def({ field_type: "boolean" }), "maybe").ok).toBe(false);
  });
});

describe("formatFieldValue", () => {
  it("renders a blank value as an em dash", () => {
    expect(formatFieldValue(def(), "")).toBe("—");
    expect(formatFieldValue(def(), null)).toBe("—");
    expect(formatFieldValue(def({ field_type: "boolean" }), "")).toBe("—");
  });

  it("renders booleans as Yes / No", () => {
    expect(formatFieldValue(def({ field_type: "boolean" }), "true")).toBe("Yes");
    expect(formatFieldValue(def({ field_type: "boolean" }), "false")).toBe("No");
    expect(formatFieldValue(def({ field_type: "boolean" }), "yes")).toBe("Yes");
  });

  it("groups numbers in the Indian numbering system", () => {
    expect(formatFieldValue(def({ field_type: "number" }), "1234567")).toBe("12,34,567");
    expect(formatFieldValue(def({ field_type: "number" }), 1234.5)).toBe("1,234.5");
  });

  it("keeps an unparseable number visible instead of blanking it", () => {
    expect(formatFieldValue(def({ field_type: "number" }), "N/A")).toBe("N/A");
  });

  it("formats an ISO date for display", () => {
    expect(formatFieldValue(def({ field_type: "date" }), "2026-01-15")).toBe("15 Jan 2026");
  });

  it("keeps an unparseable date visible", () => {
    expect(formatFieldValue(def({ field_type: "date" }), "2026-02-30")).toBe("2026-02-30");
  });

  it("passes text and select values through unchanged", () => {
    expect(formatFieldValue(def({ field_type: "text" }), " XL ")).toBe("XL");
    expect(formatFieldValue(def({ field_type: "select", options: ["S", "M"] }), "M")).toBe("M");
  });
});

describe("sortDefs", () => {
  const order = (id: string, display_order: number, label = id) => ({ id, display_order, label, key: id });

  it("orders by display_order without mutating the input", () => {
    const input = [order("c", 2), order("a", 0), order("b", 1)];
    const sorted = sortDefs(input);
    expect(sorted.map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect(input.map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("breaks ties by label, then key", () => {
    const sorted = sortDefs([
      { id: "z", display_order: 1, label: "Beta", key: "beta" },
      { id: "y", display_order: 1, label: "Alpha", key: "alpha" },
    ]);
    expect(sorted.map((d) => d.id)).toEqual(["y", "z"]);
  });
});
