import { describe, it, expect } from "vitest";
import {
  splitName, normalizePhone, detectEmployeeHeaderRow, buildEmployeeRows, normalizeEmployeeDate,
  resolveColumns, EMPLOYEE_COLUMN_ALIASES, failedRowsCsv,
} from "./employeeImport";

describe("splitName", () => {
  it("pulls the salutation off and splits first/middle/last", () => {
    expect(splitName("Dr. Ramesh Kumar Singh")).toEqual({
      salutation: "Dr", first_name: "Ramesh", middle_name: "Kumar", last_name: "Singh",
    });
    expect(splitName("Priya Sharma")).toEqual({
      salutation: "", first_name: "Priya", middle_name: "", last_name: "Sharma",
    });
    // Single-word names are common for support staff — no last name invented.
    expect(splitName("Ramu")).toEqual({
      salutation: "", first_name: "Ramu", middle_name: "", last_name: "",
    });
    // "Mr" alone must not be swallowed as the salutation of an empty name.
    expect(splitName("Mr").first_name).toBe("Mr");
  });
});

describe("normalizeEmployeeDate", () => {
  it("parses the dd-MMM-yyyy form Keka exports", () => {
    // The whole reason this exists: the shared student parser rejects these, and
    // silently dropping joining dates breaks payroll pro-rating.
    expect(normalizeEmployeeDate("01-Jul-2012")).toBe("2012-07-01");
    expect(normalizeEmployeeDate("29-Jun-2024")).toBe("2024-06-29");
    expect(normalizeEmployeeDate("8 September 2023")).toBe("2023-09-08");
    expect(normalizeEmployeeDate("15/Apr/2024")).toBe("2024-04-15");
  });

  it("still handles the formats the shared parser knows", () => {
    expect(normalizeEmployeeDate("2024-04-16")).toBe("2024-04-16");
    expect(normalizeEmployeeDate("16/04/2024")).toBe("2024-04-16");
  });

  it("decodes Excel serial dates", () => {
    // 41091 is what "01-Jul-2012" becomes when a sheet is read without raw:false.
    expect(normalizeEmployeeDate("41091")).toBe("2012-07-01");
    expect(normalizeEmployeeDate("45390")).toBe("2024-04-08");
    // Out-of-range numbers are not dates — an employee code must not become one.
    expect(normalizeEmployeeDate("1234")).toBe("");
    expect(normalizeEmployeeDate("99999")).toBe("");
  });

  it("rejects impossible and unparseable dates rather than inventing one", () => {
    expect(normalizeEmployeeDate("31-Feb-2024")).toBe("");
    expect(normalizeEmployeeDate("01-Xyz-2024")).toBe("");
    expect(normalizeEmployeeDate("")).toBe("");
    expect(normalizeEmployeeDate(null)).toBe("");
  });
});

describe("normalizePhone", () => {
  it("canonicalises the shapes an Indian staff register actually contains", () => {
    expect(normalizePhone("9871763193")).toBe("+919871763193");
    expect(normalizePhone("+91 98717-63193")).toBe("+919871763193");
    expect(normalizePhone("919871763193")).toBe("+919871763193");
    expect(normalizePhone("09871763193")).toBe("+919871763193");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
  });
});

describe("detectEmployeeHeaderRow", () => {
  it("skips banner and spacer rows above the real header", () => {
    const rows = [
      ["NIMT Institute of Technology", "", ""],
      ["Staff Register 2026", "", ""],
      ["", "", ""],
      ["Employee Name", "Designation", "Mobile"],
      ["Priya Sharma", "Lecturer", "9871763193"],
    ];
    expect(detectEmployeeHeaderRow(rows)).toBe(3);
  });

  it("falls back to row 0 when nothing looks like a header", () => {
    expect(detectEmployeeHeaderRow([["a", "b"], ["c", "d"]])).toBe(0);
  });
});

describe("buildEmployeeRows", () => {
  const header = ["Employee Name", "Emp Code", "Email", "Mobile", "DOJ", "PAN", "IFSC", "Account No"];
  const mapping = resolveColumns(header, EMPLOYEE_COLUMN_ALIASES);

  const build = (body: string[][], existing = new Set<string>()) =>
    buildEmployeeRows(body, mapping, existing);

  it("accepts a clean row and normalises every field", () => {
    const [r] = build([[
      "Dr. Ramesh Kumar Singh", "EMP-101", "Ramesh@NIMT.ac.in", "9871763193",
      "15/06/2019", "abcde1234f", "hdfc0001234", "50100123456789",
    ]]);
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.values).toMatchObject({
      salutation: "Dr",
      first_name: "Ramesh",
      middle_name: "Kumar",
      last_name: "Singh",
      employee_number: "EMP-101",
      work_email: "ramesh@nimt.ac.in",
      mobile_number: "+919871763193",
      date_of_joining: "2019-06-15",
      pan_number: "ABCDE1234F",
      bank_ifsc: "HDFC0001234",
    });
  });

  it("rejects a nameless row", () => {
    const [r] = build([["", "EMP-102", "x@nimt.ac.in", "", "", "", "", ""]]);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Name is required/);
  });

  it("drops malformed IDs and dates as warnings, keeping the row importable", () => {
    const [r] = build([[
      "Priya Sharma", "EMP-103", "not-an-email", "9871763193",
      "31/02/2019", "PAN123", "12345", "",
    ]]);
    expect(r.valid).toBe(true);
    expect(r.values.pan_number).toBeUndefined();
    expect(r.values.work_email).toBeUndefined();
    expect(r.values.date_of_joining).toBeUndefined();
    expect(r.warnings).toHaveLength(4); // email, DOJ, PAN, IFSC
  });

  it("refuses an account number with no valid IFSC — money must not land nowhere", () => {
    const [r] = build([["Priya Sharma", "EMP-104", "", "", "", "", "BADIFSC", "50100999"]]);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/IFSC/);
  });

  it("flags duplicates inside the file and against the existing directory", () => {
    const rows = build(
      [
        ["Priya Sharma", "EMP-105", "", "", "", "", "", ""],
        ["Priya Sharma", "EMP-105", "", "", "", "", "", ""],
        ["Amit Verma", "EMP-106", "", "", "", "", "", ""],
      ],
      new Set(["emp-106"]),
    );
    expect(rows[0].duplicate).toBe(false);
    expect(rows[1].duplicate).toBe(true);
    expect(rows[1].error).toMatch(/Duplicate/);
    expect(rows[2].duplicate).toBe(true);
    expect(rows[2].error).toMatch(/Already exists/);
  });

  it("numbers rows from the first data row so errors point at the sheet", () => {
    const rows = build([["A B", "", "", "", "", "", "", ""], ["C D", "", "", "", "", "", "", ""]]);
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3]);
  });
});

describe("failedRowsCsv", () => {
  it("escapes commas and quotes so the re-upload file round-trips", () => {
    const rows = buildEmployeeRows(
      [["", "EMP,1", '"quoted"']],
      { full_name: 0, employee_number: 1, job_title: 2 },
    );
    const csv = failedRowsCsv(rows, ["employee_number", "job_title"]);
    expect(csv.split("\n")[0]).toBe("Row,Error,employee_number,job_title");
    expect(csv).toContain('"EMP,1"');
    expect(csv).toContain('"""quoted"""');
  });
});
