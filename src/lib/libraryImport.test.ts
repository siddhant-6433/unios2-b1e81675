import { describe, it, expect } from "vitest";
import {
  isDitto, forwardFill, detectHeaderRow, parseAmount, parseIntLoose,
  splitPlacePublisher, resolveColumns, normalizeHeader, cleanAuthorName, normalizePublisher,
} from "./libraryImport";

describe("normalizePublisher", () => {
  it("collapses place + boilerplate variants of a house to one key", () => {
    expect(normalizePublisher("jaypee bro Pub Delhi")).toBe("jaypee");
    expect(normalizePublisher("N. Delhi jaypee Pub")).toBe("jaypee");
    expect(normalizePublisher("Jaypee")).toBe("jaypee");
    expect(normalizePublisher("CBS Pub")).toBe("cbs");
    expect(normalizePublisher("New delhi CBS Publication")).toBe("cbs");
    expect(normalizePublisher("AITBS Pub. Delhi")).toBe("aitbs");
    // distinct houses stay distinct
    expect(normalizePublisher("Elsevier")).not.toBe(normalizePublisher("Pearson"));
    expect(normalizePublisher("")).toBe("");
  });
});

describe("cleanAuthorName", () => {
  it("strips et al / etal / and others, drops standalone markers, keeps real names", () => {
    expect(cleanAuthorName("Taylor et al")).toBe("Taylor");
    expect(cleanAuthorName("Taylor, et al.")).toBe("Taylor");
    expect(cleanAuthorName("Taylor etal")).toBe("Taylor");
    expect(cleanAuthorName("Taylor and others")).toBe("Taylor");
    expect(cleanAuthorName("et al")).toBe("");
    expect(cleanAuthorName("A, B, et al")).toBe("A, B");
    // real names that merely contain the letters are untouched
    expect(cleanAuthorName("Petal, Rose")).toBe("Petal, Rose");
    expect(cleanAuthorName("Chaurasia, B.D")).toBe("Chaurasia, B.D");
  });
});

describe("isDitto", () => {
  it("recognizes ditto tokens, not blanks or real values or bare dash", () => {
    expect(isDitto(",,")).toBe(true);
    expect(isDitto('"')).toBe(true);
    expect(isDitto("-do-")).toBe(true);
    expect(isDitto("")).toBe(false);
    expect(isDitto("-")).toBe(false); // means "none", not ditto
    expect(isDitto("Chaurasia, B.D")).toBe(false);
  });
});

describe("forwardFill", () => {
  it("fills ditto tokens and blanks from the row above, but not exempt columns", () => {
    // cols: [accession(exempt), author, title]
    const body = [
      ["1", "Chaurasia, B.D", "Human Anatomy"],
      ["2", ",,", ",,"],       // ditto -> inherit author+title
      ["3", "", ""],            // blank -> inherit (aggressive)
      ["4", "Gupta, Madhu", "Nursing"],
    ];
    const out = forwardFill(body, 3, new Set([0]));
    expect(out[1]).toEqual(["2", "Chaurasia, B.D", "Human Anatomy"]);
    expect(out[2]).toEqual(["3", "Chaurasia, B.D", "Human Anatomy"]);
    expect(out[3]).toEqual(["4", "Gupta, Madhu", "Nursing"]);
    // accession is never propagated
    expect(out.map((r) => r[0])).toEqual(["1", "2", "3", "4"]);
  });

  it("leaves a column empty until it has had a value", () => {
    const out = forwardFill([["", "x"], ["y", ",,"]], 2);
    expect(out[0]).toEqual(["", "x"]);
    expect(out[1]).toEqual(["y", "x"]);
  });
});

describe("detectHeaderRow", () => {
  it("finds the header even with banner rows above (Paramedical shape)", () => {
    const rows = [
      ["NIMT INSTITUTE", "NIMT INSTITUTE", "", "", ""],
      ["", "Acc.N.", "Author", "Title", "Vol."],
      ["Date", "1", "Chaurasia", "Human Anatomy", "1st"],
    ];
    expect(detectHeaderRow(rows)).toBe(1);
  });
  it("returns 0 when the first row is the header", () => {
    expect(detectHeaderRow([["Date", "Acc no.", "Author", "Title"], ["", "1", "X", "Y"]])).toBe(0);
  });
});

describe("parseAmount", () => {
  it("strips /- and currency noise", () => {
    expect(parseAmount("460/-")).toBe(460);
    expect(parseAmount("575/")).toBe(575);
    expect(parseAmount("1,250/-")).toBe(1250);
    expect(parseAmount("845")).toBe(845);
    expect(parseAmount(",,")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});

describe("parseIntLoose", () => {
  it("takes the first integer run", () => {
    expect(parseIntLoose("13.1")).toBe(13);
    expect(parseIntLoose("2025 ")).toBe(2025);
    expect(parseIntLoose("332")).toBe(332);
    expect(parseIntLoose("Re")).toBeNull();
  });
});

describe("splitPlacePublisher", () => {
  it("splits on ':' or ';', else whole value is publisher", () => {
    expect(splitPlacePublisher("N.Delhi: Pearson")).toEqual({ place: "N.Delhi", publisher: "Pearson" });
    expect(splitPlacePublisher("New Delhi; CBS Pub")).toEqual({ place: "New Delhi", publisher: "CBS Pub" });
    expect(splitPlacePublisher("New delhi CBS Publication")).toEqual({ place: null, publisher: "New delhi CBS Publication" });
    expect(splitPlacePublisher("Jain Pub. Jaipur")).toEqual({ place: null, publisher: "Jain Pub. Jaipur" });
    expect(splitPlacePublisher("")).toEqual({ place: null, publisher: null });
  });
});

describe("resolveColumns", () => {
  it("maps the varied real headers to fields", () => {
    // Nursing header
    const cols = resolveColumns(["Date", "Acc no. ", "Author", "Title ", "Edition", "Place & Publisher", "year", "Page", "vol", "Cost ", "Remark", ""]);
    expect(cols.accession).toBe(1);
    expect(cols.edition).toBe(4);
    expect(cols.placePublisher).toBe(5);
    expect(cols.year).toBe(6);
    expect(cols.pages).toBe(7);
    expect(cols.volume).toBe(8);
    expect(cols.cost).toBe(9);
    expect(cols.remark).toBe(10);
  });
  it("matches Law/Paramedical variants: Acc.No., Vol., Edi., Year Pub, Pages", () => {
    const cols = resolveColumns(["Date", "Acc.No.", "Author", "Title", "Vol.", "Edi.", "Place & Publisher", "Year Pub", "Pages", "Cost", "Remark"]);
    expect(cols.accession).toBe(1);
    expect(cols.volume).toBe(4);
    expect(cols.edition).toBe(5);
    expect(cols.placePublisher).toBe(6);
    expect(cols.year).toBe(7);
    expect(cols.pages).toBe(8);
    expect(cols.cost).toBe(9);
  });
});

describe("normalizeHeader", () => {
  it("strips punctuation/spaces so 'Place & Publisher' -> 'placepublisher'", () => {
    expect(normalizeHeader("Place & Publisher")).toBe("placepublisher");
    expect(normalizeHeader("Acc.N.")).toBe("accn");
  });
});
