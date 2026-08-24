import { describe, expect, it } from "vitest";

import { CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE, getSourceRegistryEntry, licenseRegistry, sourceRegistry } from "./source-registry";

const FOOTPRINTS_ID = "nyc.building-footprints";

/** The shared `openDerivative` constant as it stood before the 2026-08-11 broadening. */
const SHARED_OPEN_DERIVATIVE = {
  allowed: "conditional",
  constraints: "Derived indexes/tiles require source attribution, licence review and the source's stated disclaimer/obligations.",
} as const;

/**
 * Every entry that shared `openDerivative` before the 2026-08-11 decision,
 * minus `nyc.building-footprints`, which now carries its own broader policy.
 * Committed literally so a future edit cannot quietly move another source onto
 * or off the shared constant.
 */
const SHARED_OPEN_DERIVATIVE_ENTRY_IDS = [
  "nyc.oti-planimetrics-sidewalk-block835",
  "nyc.oti-planimetrics-roadbed-block835",
  "nyc.oti-planimetrics-pavement-edge-block835",
  "nyc.hydrography",
  "nyc.dot-pedestrian-plazas",
  "nyc.mappluto",
  "nyc.dcp-centerline",
  "nyc.lidar-2017",
  "nyc.nta-2020",
  "nyc.community-districts",
  "nyc.cdta-2020",
  "nyc.borough-boundaries",
  "nyc.census-tracts-2020",
  "nyc.lpc-sites",
  "nyc.parks-properties",
  "nyc.facilities",
  "nyc.dca-businesses",
  "nyc.dohmh-restaurant-inspections",
  "nyc.addresspoint",
  "nyc.dcwp-legally-operating-businesses",
];

describe("NYC OTI Building Footprints (jh45-qr5r) approval envelope", () => {
  const entry = getSourceRegistryEntry(FOOTPRINTS_ID);

  it("still identifies the same dataset under the same approval state", () => {
    expect(entry).toBeDefined();
    expect(entry!.datasetId).toBe("jh45-qr5r");
    expect(entry!.approval.state).toBe("approved");
    expect(entry!.approval.scope).toBe("ingestion");
  });

  it("preserves the substance of the original local-wave approval note", () => {
    const note = entry!.approval.note;
    expect(note).toContain("msg_91770ac6d098");
    expect(note).toContain("immutable local all-Manhattan citywide wave");
    expect(note).toContain("City disclaimer");
    expect(note).toContain("source IDs");
    expect(note).toContain("capture timestamp");
    expect(note).toContain("checksum");
    expect(note).toContain("CRS");
    expect(note).toContain("height uncertainty");
    expect(note).toContain("no new provider, Google data, or unrelated dataset");
  });

  it("records the 2026-08-11 broadening to public display, derivative conveyance, and redistribution of generated geometry", () => {
    const note = entry!.approval.note;
    expect(note).toContain("2026-08-11");
    expect(note).toMatch(/generated from these footprints/i);
    expect(note).toMatch(/publicly displayed/i);
    expect(note).toMatch(/conveyed as a derivative/i);
    expect(note).toMatch(/redistributed/i);

    const constraints = entry!.derivativePolicy.constraints;
    expect(constraints).toContain("2026-08-11");
    expect(constraints).toMatch(/publicly displayed/i);
    expect(constraints).toMatch(/conveyed as a derivative/i);
    expect(constraints).toMatch(/redistributed/i);
    // Derivatives remain conditional: attribution and disclaimer obligations still ride along.
    expect(entry!.derivativePolicy.allowed).toBe("conditional");
    expect(constraints).toMatch(/attribution/i);
  });

  it("keeps public deployment excluded and limits redistribution to generated geometry", () => {
    for (const text of [entry!.approval.note, entry!.derivativePolicy.constraints]) {
      expect(text).toMatch(/public deployment remains excluded/i);
      expect(text).toMatch(/generated geometry only/i);
      expect(text).toMatch(/never the raw jh45-qr5r source dataset/i);
    }
  });

  it("carries its broadened policy into the derived license reference", () => {
    const license = licenseRegistry.find((candidate) => candidate.id === `license:${FOOTPRINTS_ID}`);
    expect(license?.derivativePolicy).toBe(entry!.derivativePolicy);
  });
});

describe("approval envelopes of every other registered source", () => {
  it("leaves the shared open-derivative constant and its remaining members untouched", () => {
    const footprints = getSourceRegistryEntry(FOOTPRINTS_ID)!;
    const shared = getSourceRegistryEntry("nyc.oti-planimetrics-sidewalk-block835")!.derivativePolicy;
    expect(shared).toEqual(SHARED_OPEN_DERIVATIVE);
    // The broadened entry must own a separate policy object.
    expect(footprints.derivativePolicy).not.toBe(shared);
    expect(sourceRegistry.filter((candidate) => candidate.derivativePolicy === shared).map((candidate) => candidate.id))
      .toEqual(SHARED_OPEN_DERIVATIVE_ENTRY_IDS);
  });

  it("grants no other source public display, derivative conveyance, or redistribution of generated geometry", () => {
    for (const candidate of sourceRegistry) {
      if (candidate.id === FOOTPRINTS_ID) continue;
      for (const text of [candidate.approval.note, candidate.derivativePolicy.constraints]) {
        expect(text, candidate.id).not.toContain("2026-08-11");
        expect(text, candidate.id).not.toMatch(/publicly displayed/i);
        expect(text, candidate.id).not.toMatch(/conveyed as a derivative/i);
        expect(text, candidate.id).not.toMatch(/may be .*redistributed/i);
      }
    }
  });
});

describe("CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE draft evidence (T002)", () => {
  it("is clearly marked as not yet user-approved", () => {
    expect(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE.evidenceId).toMatch(/:pending-user-approval$/);
    expect(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE.evidenceId).not.toMatch(/user-approved/);
    expect(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mirrors the Block 835 exclusions without the Manhattan-wide-generation exclusion", () => {
    expect(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE.exclusions).not.toContain("Manhattan-wide generation");
    for (const shared of [
      "Google products/data/imagery",
      "OSM/Overpass/third-party extracts",
      "paid or credentialed services",
      "runtime external network",
      "public deployment or conveyance",
    ]) {
      expect(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE.exclusions).toContain(shared);
    }
  });

  it("names every referenced dataset in scope", () => {
    for (const datasetId of ["xgwd-7vhd", "vfx9-tbb6", "x9uq-u3qs", "pjs3-c3z5", "k5k6-6jex"]) {
      expect(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE.scope).toContain(datasetId);
    }
    expect(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE.scope).toMatch(/orthoimagery/i);
  });
});

describe.each([
  { id: "nyc.hydrography", datasetId: "pjs3-c3z5" },
  { id: "nyc.dot-pedestrian-plazas", datasetId: "k5k6-6jex" },
  { id: "nyc.orthoimagery-2024-manhattan", datasetId: "boro_manhattan_sp24.zip" },
])("T002 citywide public-realm registration: $id", ({ id, datasetId }) => {
  const entry = getSourceRegistryEntry(id);

  it("is registered, unapproved, and cites the correct dataset", () => {
    expect(entry).toBeDefined();
    expect(entry!.datasetId).toBe(datasetId);
    expect(entry!.approval.state).toBe("pending");
    expect(entry!.approval.scope).toBe("ingestion");
  });

  it("cites the draft citywide public-realm evidence", () => {
    expect(entry!.approvalEvidence).toBe(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE);
    expect(entry!.approval.note).toContain("approval:citywide-public-realm:20260824:pending-user-approval");
    expect(entry!.approval.note).toMatch(/NOT yet user-approved/i);
  });

  it("carries its license reference into the license registry", () => {
    const license = licenseRegistry.find((candidate) => candidate.id === `license:${id}`);
    expect(license).toBeDefined();
    expect(license?.derivativePolicy).toBe(entry!.derivativePolicy);
  });
});

describe("nyc.orthoimagery-2024-manhattan honest gaps", () => {
  const entry = getSourceRegistryEntry("nyc.orthoimagery-2024-manhattan")!;

  it("does not misstate CC BY 4.0 as the share-alike license class", () => {
    // The domain LicenseClass enum has no plain "cc-by-4.0" value; "unknown"
    // avoids falsely adding a share-alike obligation via "cc-by-sa-4.0".
    expect(entry.licenseClass).toBe("unknown");
    expect(entry.attribution).toMatch(/CC BY 4\.0/);
    expect(entry.attribution).toMatch(/not CC BY-SA/i);
  });

  it("flags the T004 FGDC metadata inspection gate rather than asserting terms", () => {
    expect(entry.derivativePolicy.constraints).toMatch(/T004/);
    expect(entry.derivativePolicy.constraints).toMatch(/FGDC/);
    expect(entry.approval.note).toMatch(/honest gap/i);
  });
});
