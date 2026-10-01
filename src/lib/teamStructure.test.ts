import { describe, it, expect } from "vitest";
import {
  groupByManager,
  formatEmployeeName,
  formatManagerName,
  managersFromRows,
  NO_MANAGER_KEY,
  sortByManager,
  UNASSIGNED_MANAGER,
  wouldCreateCycle,
  type TeamRow,
} from "./teamStructure";

function row(overrides: Partial<TeamRow> & Pick<TeamRow, "employee_profile_id">): TeamRow {
  return {
    employee_name: null,
    employee_number: null,
    designation: null,
    department: null,
    campus: null,
    employment_status: null,
    manager_user_id: null,
    manager_name: null,
    user_id: null,
    ...overrides,
  };
}

// A → B → C → D (D is the root). `x.reports_to` points at the next user up.
const chain: TeamRow[] = [
  row({ employee_profile_id: "pA", employee_name: "Alice", user_id: "uA", manager_user_id: "uB", manager_name: "Bob" }),
  row({ employee_profile_id: "pB", employee_name: "Bob", user_id: "uB", manager_user_id: "uC", manager_name: "Carol" }),
  row({ employee_profile_id: "pC", employee_name: "Carol", user_id: "uC", manager_user_id: "uD", manager_name: "Dave" }),
  row({ employee_profile_id: "pD", employee_name: "Dave", user_id: "uD" }),
];

describe("wouldCreateCycle", () => {
  it("flags an employee reporting to themselves", () => {
    expect(wouldCreateCycle(chain, "pA", "uA")).toBe(true);
  });

  it("flags a deep chain that loops back to the employee", () => {
    // Setting Dave's manager to Alice closes Dave → Alice → Bob → Carol → Dave.
    expect(wouldCreateCycle(chain, "pD", "uA")).toBe(true);
  });

  it("flags a shorter loop back to the employee", () => {
    // Setting Carol's manager to Bob closes Bob → Carol → Bob.
    expect(wouldCreateCycle(chain, "pC", "uB")).toBe(true);
  });

  it("allows a manager whose chain never reaches the employee", () => {
    // Alice → Carol → Dave → (end); Dave never reaches back to Alice.
    expect(wouldCreateCycle(chain, "pA", "uC")).toBe(false);
  });

  it("allows a sibling as manager", () => {
    const sibling = row({ employee_profile_id: "pE", employee_name: "Eve", user_id: "uE", manager_user_id: "uB", manager_name: "Bob" });
    expect(wouldCreateCycle([...chain, sibling], "pA", "uE")).toBe(false);
  });

  it("treats clearing the manager (null) as safe", () => {
    expect(wouldCreateCycle(chain, "pA", null)).toBe(false);
    expect(wouldCreateCycle(chain, "pA", undefined)).toBe(false);
    expect(wouldCreateCycle(chain, "pA", "")).toBe(false);
  });

  it("stays silent when rows are not enriched with user ids", () => {
    const bare = [row({ employee_profile_id: "pA", employee_name: "Alice" })];
    expect(wouldCreateCycle(bare, "pA", "uA")).toBe(false);
  });

  it("does not hang on a pre-existing loop in the data", () => {
    const looped: TeamRow[] = [
      row({ employee_profile_id: "pX", user_id: "uX", manager_user_id: "uY" }),
      row({ employee_profile_id: "pY", user_id: "uY", manager_user_id: "uX" }),
    ];
    expect(wouldCreateCycle(looped, "pX", "uY")).toBe(true);
  });

  it("returns false for an unknown employee", () => {
    expect(wouldCreateCycle(chain, "nope", "uA")).toBe(false);
  });
});

describe("groupByManager", () => {
  it("buckets reports under their manager's user id", () => {
    const rows: TeamRow[] = [
      row({ employee_profile_id: "p1", manager_user_id: "m1", manager_name: "Mia" }),
      row({ employee_profile_id: "p2", manager_user_id: "m1", manager_name: "Mia" }),
      row({ employee_profile_id: "p3", manager_user_id: "m2", manager_name: "Max" }),
    ];
    const groups = groupByManager(rows);
    expect(groups.size).toBe(2);
    expect(groups.get("m1")?.map((r) => r.employee_profile_id)).toEqual(["p1", "p2"]);
    expect(groups.get("m2")?.map((r) => r.employee_profile_id)).toEqual(["p3"]);
  });

  it("puts employees with no manager under the sentinel key", () => {
    const groups = groupByManager([
      row({ employee_profile_id: "p1", manager_user_id: null }),
      row({ employee_profile_id: "p2", manager_user_id: "m1" }),
    ]);
    expect(groups.get(NO_MANAGER_KEY)?.map((r) => r.employee_profile_id)).toEqual(["p1"]);
  });

  it("returns an empty map for no rows", () => {
    expect(groupByManager([]).size).toBe(0);
  });
});

describe("sortByManager", () => {
  it("places unassigned employees first, then sorts by manager then employee", () => {
    const rows: TeamRow[] = [
      row({ employee_profile_id: "p1", employee_name: "Zed", manager_user_id: "m1", manager_name: "Zara" }),
      row({ employee_profile_id: "p2", employee_name: "Ann", manager_user_id: null, manager_name: null }),
      row({ employee_profile_id: "p3", employee_name: "Bob", manager_user_id: "m2", manager_name: "Alice" }),
      row({ employee_profile_id: "p4", employee_name: "Amy", manager_user_id: "m2", manager_name: "Alice" }),
    ];
    expect(sortByManager(rows).map((r) => r.employee_profile_id)).toEqual(["p2", "p4", "p3", "p1"]);
  });

  it("treats a blank manager name as unassigned and sorts unanswered names last", () => {
    const rows: TeamRow[] = [
      row({ employee_profile_id: "p1", employee_name: "Ann", manager_user_id: "m1", manager_name: "  " }),
      row({ employee_profile_id: "p2", employee_name: null, manager_user_id: "m1", manager_name: "Mia" }),
      row({ employee_profile_id: "p3", employee_name: "Bea", manager_user_id: "m1", manager_name: "Mia" }),
    ];
    expect(sortByManager(rows).map((r) => r.employee_profile_id)).toEqual(["p1", "p3", "p2"]);
  });

  it("is case-insensitive and does not mutate its input", () => {
    const rows: TeamRow[] = [
      row({ employee_profile_id: "p1", employee_name: "ann", manager_user_id: "m1", manager_name: "alice" }),
      row({ employee_profile_id: "p2", employee_name: "Bea", manager_user_id: "m2", manager_name: "Bob" }),
    ];
    const sorted = sortByManager(rows);
    expect(sorted.map((r) => r.employee_profile_id)).toEqual(["p1", "p2"]);
    expect(rows.map((r) => r.employee_profile_id)).toEqual(["p1", "p2"]);
    expect(sorted).not.toBe(rows);
  });
});

describe("managersFromRows", () => {
  it("returns distinct managers with direct-report counts, sorted by name", () => {
    const rows: TeamRow[] = [
      row({ employee_profile_id: "p1", manager_user_id: "m2", manager_name: "Zara" }),
      row({ employee_profile_id: "p2", manager_user_id: "m1", manager_name: "Alice" }),
      row({ employee_profile_id: "p3", manager_user_id: "m1", manager_name: "Alice" }),
      row({ employee_profile_id: "p4", manager_user_id: null, manager_name: null }),
    ];
    expect(managersFromRows(rows)).toEqual([
      { user_id: "m1", name: "Alice", reports: 2 },
      { user_id: "m2", name: "Zara", reports: 1 },
    ]);
  });

  it("returns an empty list when nobody manages anyone", () => {
    expect(managersFromRows([row({ employee_profile_id: "p1" })])).toEqual([]);
  });
});

describe("display helpers", () => {
  it("formats manager names, falling back to Unassigned", () => {
    expect(formatManagerName({ manager_name: "  Bob  Smith " })).toBe("Bob Smith");
    expect(formatManagerName({ manager_name: null })).toBe(UNASSIGNED_MANAGER);
    expect(formatManagerName(null)).toBe(UNASSIGNED_MANAGER);
  });

  it("formats employee names with number and unnamed fallbacks", () => {
    expect(formatEmployeeName(row({ employee_profile_id: "p1", employee_name: " Ann " }))).toBe("Ann");
    expect(formatEmployeeName(row({ employee_profile_id: "p2", employee_number: "E-42" }))).toBe("E-42");
    expect(formatEmployeeName(row({ employee_profile_id: "p3" }))).toBe("Unnamed employee");
  });
});
