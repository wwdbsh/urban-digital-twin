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

  it("classifies EVERY licence class the registry uses, so a new one fails loudly", () => {
    /*
      INVERTED, and the inversion is the point.

      The previous version filtered the registry down to a hard-coded set of two
      share-alike classes and asserted those were carved out. That could only
      ever check what it already knew: a newly ingested class — share-alike or
      not — would simply not be in the set, the filter would skip it, and the
      test would pass while `LICENSE` said nothing about it. The comment claimed
      the check was derived from the registry; it was not.

      So the allow-list now covers CLASSIFICATION rather than membership: every
      class the registry uses must be classified here as share-alike or not, and
      an unclassified class FAILS. Adding a source with a new licence class is
      then a decision someone has to make explicitly, in this file, rather than
      something that slips through silently.
    */
    const CLASSIFICATION = {
      "odbl-1.0": { shareAlike: true, licenseToken: "ODbL" },
      "cc-by-sa-4.0": { shareAlike: true, licenseToken: "CC BY-SA 4.0" },
      "nyc-open-data-terms": { shareAlike: false, licenseToken: "NYC OPEN DATA" },
      "nyc-publication-facts": { shareAlike: false, licenseToken: "nyc-publication-facts" },
      "provider-terms": { shareAlike: false, licenseToken: "provider terms" },
      unknown: { shareAlike: false, licenseToken: "`unknown`" },
      // No carve-out needed: nothing is claimed FROM us and nothing is owed TO
      // anyone. Still classified, so they are a decision rather than a gap.
      "public-domain": { shareAlike: false, licenseToken: null },
      "fixture-only": { shareAlike: false, licenseToken: null },
    };
    const used = [...new Set(sourceRegistry.map((entry) => entry.licenseClass))].sort();
    const unclassified = used.filter((cls) => !(cls in CLASSIFICATION));
    expect(unclassified, "a licence class in the registry is not classified in this test").toEqual([]);

    // Every classified class that needs naming must actually be named.
    for (const cls of used) {
      const token = CLASSIFICATION[cls].licenseToken;
      if (token === null) continue;
      expect(LICENSE, `${cls} is not named in LICENSE`).toContain(token);
    }
    // And every share-alike class must be called share-alike where it is named.
    const shareAlikePresent = used.filter((cls) => CLASSIFICATION[cls].shareAlike);
    expect(shareAlikePresent.length).toBeGreaterThan(0);
    expect(LICENSE).toContain("SHARE-ALIKE");
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
