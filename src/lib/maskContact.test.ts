import { describe, it, expect } from "vitest";
import {
  maskPhone,
  maskEmail,
  maskContactField,
  maskExportRows,
  maskMatrix,
  canUnmaskContact,
  displayPhone,
} from "./maskContact";

describe("maskPhone", () => {
  it("masks a bare 10-digit number to first3 + **** + last3", () => {
    expect(maskPhone("9812345892")).toBe("981****892");
    expect(maskPhone("9871763193")).toBe("987****193");
  });
  it("drops the +91 country code before masking", () => {
    expect(maskPhone("+919812345892")).toBe("981****892");
    expect(maskPhone("919812345892")).toBe("981****892");
  });
  it("handles empty / short values", () => {
    expect(maskPhone("")).toBe("");
    expect(maskPhone(null)).toBe("");
    expect(maskPhone("1234")).toBe("****");
  });
});

describe("displayPhone / canUnmaskContact", () => {
  it("reveals the stored value only for super_admin exports", () => {
    expect(canUnmaskContact("super_admin")).toBe(true);
    expect(canUnmaskContact("counsellor")).toBe(false);
    expect(canUnmaskContact("admission_head")).toBe(false);
    expect(canUnmaskContact(null)).toBe(false);
  });
  it("returns the original number when unmask=true", () => {
    expect(displayPhone("+919812345892", true)).toBe("+919812345892");
  });
  it("masks when unmask=false", () => {
    expect(displayPhone("9812345892", false)).toBe("981****892");
    expect(displayPhone("9812345892")).toBe("981****892");
  });
});

describe("maskEmail", () => {
  it("keeps first 2 of local part + domain", () => {
    expect(maskEmail("john.doe@gmail.com")).toBe("jo****@gmail.com");
  });
  it("handles short local part and empties", () => {
    expect(maskEmail("a@b.com")).toBe("a****@b.com");
    expect(maskEmail("")).toBe("");
    expect(maskEmail("notanemail")).toBe("****");
  });
});

describe("maskContactField", () => {
  it("routes Destination by value shape", () => {
    expect(maskContactField("Destination", "a@b.com")).toBe("a****@b.com");
    expect(maskContactField("Destination", "9871763193")).toBe("987****193");
  });
  it("masks by header name", () => {
    expect(maskContactField("Email ID", "john.doe@gmail.com")).toBe("jo****@gmail.com");
    expect(maskContactField("Mobile No", "9871763193")).toBe("987****193");
  });
  it("passes non-contact columns through", () => {
    expect(maskContactField("Course", "BBA")).toBe("BBA");
  });
});

describe("maskExportRows / maskMatrix", () => {
  it("returns rows untouched when unmask=true", () => {
    const rows = [{ Phone: "9871763193", Course: "BBA" }];
    expect(maskExportRows(rows, true)).toBe(rows);
  });
  it("masks object rows when unmask=false", () => {
    const out = maskExportRows([{ Phone: "9871763193", Course: "BBA" }], false);
    expect(out).toEqual([{ Phone: "987****193", Course: "BBA" }]);
  });
  it("masks matrix rows by header index", () => {
    const out = maskMatrix(["Lead", "Phone"], [["Amit", "9871763193"]], false);
    expect(out).toEqual([["Amit", "987****193"]]);
  });
});
