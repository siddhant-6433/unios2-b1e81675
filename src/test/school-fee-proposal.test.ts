import {
  allocateFeeHeaderWaivers,
  admissionPayableBreakdown,
  buildSchoolFeeSnapshot,
  computeSchoolProposalChildTotals,
  feeHeaderKeyForItem,
  formatFeeTerm,
  groupFeeItemsByHeader,
  groupFeeItemsByTerm,
  siblingDiscountForFeeItems,
} from "@/lib/schoolFeeProposal";

describe("school fee proposal", () => {
  it("separates one-time, base recurring, transport, and boarding options", () => {
    const snapshot = buildSchoolFeeSnapshot([
      { code: "NB-REG", name: "Registration", category: "enrollment", term: "registration", amount: 500 },
      { code: "NB-ADM", name: "Admission", category: "enrollment", term: "admission", amount: 20_000 },
      { code: "NB-SEC", name: "Security", category: "enrollment", term: "admission", amount: 10_000 },
      { code: "NB-CPY", name: "Tuition", category: "tuition", term: "q1", amount: 14_001 },
      { code: "NB-CPY", name: "Tuition", category: "tuition", term: "q2", amount: 14_001 },
      { code: "NB-CPY", name: "Tuition", category: "tuition", term: "q3", amount: 14_001 },
      { code: "NB-CPY", name: "Tuition", category: "tuition", term: "q4", amount: 14_001 },
      { code: "NB-TR1", name: "Beacon Transport (Within 5 Kms)", category: "transport", term: "q1", amount: 6_000 },
      { code: "NB-TR1", name: "Beacon Transport (Within 5 Kms)", category: "transport", term: "q2", amount: 6_000 },
      { code: "NB-DBA", name: "Day Boarding", category: "hostel", term: "q1", amount: 12_000 },
    ]);

    expect(snapshot.oneTime).toBe(20_500);
    expect(snapshot.recurringBase).toBe(56_004);
    expect(snapshot.firstQuarterBase).toBe(14_001);
    expect(snapshot.transportOptions[0]).toMatchObject({ key: "zone_1", description: "Within 5 Kms", amount: 12_000 });
    expect(snapshot.boardingOptions[0]).toMatchObject({ key: "day_boarding", amount: 12_000 });
  });

  it("keeps first quarter and one-time payable at admission while Grayquest covers the remaining nine-month fee", () => {
    const totals = computeSchoolProposalChildTotals({
      oneTime: 20_500,
      recurringBase: 80_000,
      firstQuarterBase: 20_000,
      transportAnnual: 24_000,
      transportFirstQuarter: 6_000,
      waiverAmount: 10_000,
    });

    expect(totals.admissionPayable).toBe(46_500);
    expect(totals.grayquestPrincipal).toBe(68_000);
    expect(totals.annualAfterWaiver).toBe(114_500);
  });

  it("describes the payable-at-admission amount from item-level fee heads", () => {
    const breakdown = admissionPayableBreakdown([
      { code: "NB-ADM", name: "Admission Fee", category: "enrollment", term: "admission", amount: 20_000, headerKey: "adm", waiver: 0, paid: 0, net: 20_000 },
      { code: "NB-SEC", name: "Security Deposit", category: "enrollment", term: "admission", amount: 20_000, headerKey: "sec", waiver: 0, paid: 0, net: 20_000 },
      { code: "NB-Q1", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q1", amount: 20_000, headerKey: "q1", waiver: 2_000, paid: 0, net: 18_000 },
      { code: "NB-Q2", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q2", amount: 20_000, headerKey: "q2", waiver: 0, paid: 0, net: 20_000 },
      { code: "NB-APP", name: "Application Fee", category: "enrollment", term: "registration", amount: 1_000, headerKey: "app", waiver: 0, paid: 1_000, net: 1_000 },
    ]);

    expect(breakdown).toEqual([
      { label: "Admission Fee", amount: 20_000 },
      { label: "Security Deposit (refundable)", amount: 20_000 },
      { label: "First quarter tuition fee", amount: 18_000 },
    ]);
  });

  it("supports non-school year-wise fee structures", () => {
    const snapshot = buildSchoolFeeSnapshot([
      { code: "FORM-FEE", name: "Form Fee", category: "enrollment", term: "admission", amount: 1_000 },
      { code: "TUITION-Y1", name: "Year 1 Tuition", category: "tuition", term: "year_1", amount: 90_000 },
      { code: "TUITION-Y2", name: "Year 2 Tuition", category: "tuition", term: "year_2", amount: 90_000 },
    ]);

    expect(snapshot.oneTime).toBe(1_000);
    expect(snapshot.recurringBase).toBe(180_000);
    expect(snapshot.firstQuarterBase).toBe(90_000);
  });

  it("formats machine fee terms for parent-facing proposal PDFs", () => {
    expect(formatFeeTerm("year_1")).toBe("Year 1");
    expect(formatFeeTerm("year-2")).toBe("Year 2");
    expect(formatFeeTerm("sem_1")).toBe("Sem 1");
    expect(formatFeeTerm("semester_2")).toBe("Sem 2");
  });

  it("groups fee items by formatted term with subtotals", () => {
    const groups = groupFeeItemsByTerm([
      { code: "T1", name: "Tuition", category: "tuition", term: "year_1", amount: 25_000 },
      { code: "A1", name: "Admin", category: "other", term: "year_1", amount: 5_000 },
      { code: "T2", name: "Tuition", category: "tuition", term: "year_2", amount: 30_000 },
    ]);

    expect(groups.map((group) => [group.label, group.total])).toEqual([
      ["Year 1", 30_000],
      ["Year 2", 30_000],
    ]);
  });

  it("allocates waivers against fee headers and adjusts admission payable separately", () => {
    const tuition = { code: "T1", name: "Tuition", category: "tuition", term: "year_1", amount: 25_000 };
    const admin = { code: "A1", name: "Admin", category: "other", term: "year_2", amount: 10_000 };
    const groups = groupFeeItemsByHeader([tuition, admin]);

    expect(groups.map((group) => [group.label, group.total])).toEqual([
      ["Admin", 10_000],
      ["Tuition", 25_000],
    ]);
    expect(groups.map((group) => [group.label, group.totalLabel, group.periodLabel])).toEqual([
      ["Admin", "Year 2 fee total", "Year 2"],
      ["Tuition", "Year 1 fee total", "Year 1"],
    ]);

    const allocation = allocateFeeHeaderWaivers([tuition, admin], {
      [feeHeaderKeyForItem(tuition)]: 5_000,
      [feeHeaderKeyForItem(admin)]: 3_000,
    });

    expect(allocation.waiverTotal).toBe(8_000);
    expect(allocation.admissionWaiverTotal).toBe(5_000);
    expect(allocation.grayquestWaiverTotal).toBe(3_000);
    expect(allocation.items.map((item) => [item.name, item.waiver, item.net])).toEqual([
      ["Tuition", 5_000, 20_000],
      ["Admin", 3_000, 7_000],
    ]);

    const totals = computeSchoolProposalChildTotals({
      oneTime: 0,
      recurringBase: 35_000,
      firstQuarterBase: 25_000,
      waiverAmount: allocation.waiverTotal,
      admissionWaiverAmount: allocation.admissionWaiverTotal,
      grayquestWaiverAmount: allocation.grayquestWaiverTotal,
      admissionPaidAmount: 1_000,
      grayquestPaidAmount: 2_000,
    });

    expect(totals.admissionPayable).toBe(19_000);
    expect(totals.grayquestPrincipal).toBe(5_000);
    expect(totals.annualAfterWaiver).toBe(27_000);
  });

  it("splits selected boarding waivers between admission and remaining fee", () => {
    const boardingQ1 = { code: "B-AC", name: "Boarding AC", category: "hostel", term: "q1", amount: 10_000 };
    const boardingQ2 = { code: "B-AC", name: "Boarding AC", category: "hostel", term: "q2", amount: 10_000 };
    const allocation = allocateFeeHeaderWaivers([boardingQ1, boardingQ2], {
      [feeHeaderKeyForItem(boardingQ1)]: 2_000,
    });

    expect(allocation.waiverTotal).toBe(2_000);
    expect(allocation.admissionWaiverTotal).toBe(2_000);
    expect(allocation.grayquestWaiverTotal).toBe(0);

    const totals = computeSchoolProposalChildTotals({
      oneTime: 0,
      recurringBase: 40_000,
      firstQuarterBase: 10_000,
      boardingAnnual: 20_000,
      boardingFirstQuarter: 10_000,
      waiverAmount: allocation.waiverTotal,
      admissionWaiverAmount: allocation.admissionWaiverTotal,
      grayquestWaiverAmount: allocation.grayquestWaiverTotal,
    });

    expect(totals.admissionPayable).toBe(18_000);
    expect(totals.grayquestPrincipal).toBe(40_000);
  });

  it("splits quarterly fee heads into period-wise waiver rows", () => {
    const groups = groupFeeItemsByHeader([
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q1", amount: 14_001 },
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q2", amount: 14_001 },
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q3", amount: 14_001 },
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q4", amount: 14_001 },
      { code: "NB-ADM", name: "Admission Fee", category: "enrollment", term: "admission", amount: 20_000 },
    ]);

    expect(groups.map((group) => [group.label, group.periodLabel, group.totalLabel, group.total])).toEqual([
      ["Admission Fee", "One-time", "One-time fee total", 20_000],
      ["Beacon Primary Quarterly Fee", "Q1", "Q1 fee total", 14_001],
      ["Beacon Primary Quarterly Fee", "Q2", "Q2 fee total", 14_001],
      ["Beacon Primary Quarterly Fee", "Q3", "Q3 fee total", 14_001],
      ["Beacon Primary Quarterly Fee", "Q4", "Q4 fee total", 14_001],
    ]);
  });

  it("still allocates legacy annual fee-head waiver keys across matching periods", () => {
    const items = [
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q1", amount: 14_001 },
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q2", amount: 14_001 },
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q3", amount: 14_001 },
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q4", amount: 14_001 },
    ];
    const allocation = allocateFeeHeaderWaivers(items, {
      "nb-cpy:tuition": 5_000,
    });

    expect(allocation.waiverTotal).toBe(5_000);
    expect(allocation.items.map((item) => [item.term, item.waiver])).toEqual([
      ["q1", 5_000],
      ["q2", 0],
      ["q3", 0],
      ["q4", 0],
    ]);
  });

  it("ignores a legacy annual key once period-specific waiver keys exist", () => {
    const items = [
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q1", amount: 14_001 },
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q2", amount: 14_001 },
    ];
    const allocation = allocateFeeHeaderWaivers(items, {
      "nb-cpy:tuition": 5_000,
      [feeHeaderKeyForItem(items[1])]: 1_000,
    });

    expect(allocation.waiverTotal).toBe(1_000);
    expect(allocation.items.map((item) => [item.term, item.waiver])).toEqual([
      ["q1", 0],
      ["q2", 1_000],
    ]);
  });

  it("derives sibling discount from alternate sibling-rate fee structures", () => {
    const current = [
      { code: "NB-CPY", name: "Beacon Primary Quarterly Fee", category: "tuition", term: "q1", amount: 14_001 },
    ];
    const siblingRate = [
      { code: "NB-CPY-EP", name: "Beacon Primary Quarterly Fee - Existing Parent", category: "tuition", term: "q1", amount: 11_181 },
    ];

    expect(siblingDiscountForFeeItems(current, siblingRate)).toBe(2_820);
  });

  it("returns null for sibling discount when no alternate fee structure exists", () => {
    const current = [
      { code: "SCH-Q1", name: "School Tuition Q1", category: "tuition", term: "q1", amount: 2_850 },
    ];

    expect(siblingDiscountForFeeItems(current, null)).toBeNull();
  });
});
