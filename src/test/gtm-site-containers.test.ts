import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync("index.html", "utf8");
const appTsx = readFileSync("src/App.tsx", "utf8");

describe("site GTM container mapping", () => {
  it("maps public marketing hostnames to their site-level GTM containers", () => {
    expect(indexHtml).toContain('"nimt.ac.in": "GTM-NHC65VZ"');
    expect(indexHtml).toContain('"www.nimt.ac.in": "GTM-NHC65VZ"');
    expect(indexHtml).toContain('"miraischool.in": "GTM-WL5MTC3D"');
    expect(indexHtml).toContain('"www.miraischool.in": "GTM-WL5MTC3D"');
    expect(indexHtml).toContain('"school.nimt.ac.in": "GTM-M9J8RJ7V"');
    expect(indexHtml).toContain('"seralislab.com": "GTM-NN2LQW8T"');
    expect(indexHtml).toContain('"www.seralislab.com": "GTM-NN2LQW8T"');
  });

  it("keeps GTM host-gated instead of loading a marketing container globally", () => {
    expect(indexHtml).toContain("var i = containers[host];");
    expect(indexHtml).toContain("if (!i) return;");
    expect(indexHtml).not.toContain('"uni.nimt.ac.in": "GTM-');
  });

  it("loads brand GTM containers on student-facing uni.nimt.ac.in application paths only", () => {
    expect(indexHtml).toContain('host === "uni.nimt.ac.in"');
    expect(indexHtml).toContain('/^\\/apply\\/nimt\\/?$/i.test(path)');
    expect(indexHtml).toContain('/^\\/apply\\/mirai\\/?$/i.test(path)');
    expect(indexHtml).toContain('/^\\/apply\\/beacon\\/?$/i.test(path)');
    expect(indexHtml).toContain('i = "GTM-NHC65VZ"');
    expect(indexHtml).toContain('i = "GTM-WL5MTC3D"');
    expect(indexHtml).toContain('i = "GTM-M9J8RJ7V"');
  });

  it("redirects common application URL typos to canonical apply routes", () => {
    expect(appTsx).toContain('path="/applly/nimt"');
    expect(appTsx).toContain('to="/apply/nimt"');
    expect(appTsx).toContain('path="/apply.mirai"');
    expect(appTsx).toContain('to="/apply/mirai"');
  });
});
