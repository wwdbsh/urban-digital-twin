import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sourceRegistry } from "../src/data/source-registry.ts";

/**
 * THE REGISTRY-AGREEMENT INSTRUMENT for `NOTICE`.
 *
 * `LICENSE` claims the project code and the generated artifacts, and disclaims
 * the source data. That disclaimer is only worth anything if the list of what
 * is disclaimed is COMPLETE and CURRENT — and a hand-maintained attribution file
 * drifts the moment a dataset is added, which is exactly when getting it wrong
 * matters most.
 *
 * `src/data/source-registry.ts` is the live authority. This test asserts that
 * every attribution string and every terms URL in that registry appears
 * verbatim in `NOTICE`, so adding a source without attributing it breaks the
 * build rather than shipping an unqualified proprietary claim over somebody
 * else's data.
 */
const NOTICE = readFileSync("NOTICE", "utf8");
const LICENSE = readFileSync("LICENSE", "utf8");

describe("NOTICE agrees with the source registry", () => {
  it("reproduces every registry attribution string verbatim", () => {
    const missing = sourceRegistry.filter((entry) => !NOTICE.includes(entry.attribution)).map((entry) => entry.id);
    expect(missing).toEqual([]);
    // Sanity: the registry is non-trivial, so a passing run means something.
    expect(sourceRegistry.length).toBeGreaterThanOrEqual(45);
  });

  it("names every registry source id and terms URL", () => {
    const missingIds = sourceRegistry.filter((entry) => !NOTICE.includes(entry.id)).map((entry) => entry.id);
    expect(missingIds).toEqual([]);
    const missingTerms = [...new Set(sourceRegistry.map((entry) => entry.termsUrl))].filter((url) => !NOTICE.includes(url));
    expect(missingTerms).toEqual([]);
  });

  it("accounts for every licence class the registry uses", () => {
    const classes = [...new Set(sourceRegistry.map((entry) => entry.licenseClass))].sort();
    const unaccounted = classes.filter((cls) => !NOTICE.includes(`licenseClass: "${cls}"`));
    expect(unaccounted).toEqual([]);
  });

  it("names the registry as the governing authority in both files", () => {
    // The whole point of the arrangement: NOTICE is derived, not authored, and
    // both files say so, so a reader knows which one to trust.
    expect(NOTICE).toContain("src/data/source-registry.ts");
    expect(NOTICE).toContain("the registry governs");
    expect(LICENSE).toContain("src/data/source-registry.ts");
    expect(LICENSE).toContain("THE REGISTRY GOVERNS");
  });
});

/**
 * The carve-outs, asserted by name.
 *
 * An unqualified proprietary claim over share-alike data is a rights
 * misstatement, not a wording preference. These assertions are what stop the
 * carve-outs being edited away.
 */
describe("LICENSE carves out third-party source data", () => {
  it("claims only project code and generated artifacts", () => {
    expect(LICENSE).toContain("All rights reserved");
    expect(LICENSE).toContain("PROJECT CODE");
    expect(LICENSE).toContain("GENERATED ARTIFACTS");
    expect(LICENSE).toContain("THIS LICENCE MAKES NO CLAIM OVER THIRD-PARTY SOURCE DATA");
  });

  it("names the NYC Open Data and ODbL carve-outs explicitly", () => {
    expect(LICENSE).toContain("NYC OPEN DATA");
    expect(LICENSE).toContain("jh45-qr5r");
    expect(LICENSE).toContain("ODbL");
    expect(LICENSE).toContain("OpenStreetMap");
    expect(LICENSE).toContain("SHARE-ALIKE");
  });

  it("carves out every share-alike class the registry actually contains", () => {
    // Derived from the registry rather than hard-coded, so a newly ingested
    // share-alike source cannot sit outside the carve-out unnoticed.
    const shareAlike = new Set(["odbl-1.0", "cc-by-sa-4.0"]);
    const present = [...new Set(sourceRegistry.map((entry) => entry.licenseClass))].filter((cls) => shareAlike.has(cls));
    expect(present.length).toBeGreaterThan(0);
    for (const cls of present) {
      const token = cls === "odbl-1.0" ? "ODbL" : "CC BY-SA 4.0";
      expect(LICENSE, `${cls} is not carved out by name`).toContain(token);
    }
  });

  it("keeps the redistribution posture where it is recorded, not in the licence", () => {
    // Asserted on tokens that survive hard line-wrapping: the licence text is
    // wrapped at 80 columns, so a long phrase can straddle a newline and a
    // substring check on it would fail for formatting rather than for meaning.
    expect(LICENSE).toContain("remains non-redistributable");
    expect(LICENSE).toContain("public deployment");
    expect(NOTICE).toContain("2026-08-11");
  });
});
