import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../domain/deterministic-hash.ts";
import {
  BLOCK835_PUBLIC_REALM_APPROVAL_EVIDENCE,
  CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE,
  CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE,
  CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_STATEMENT,
  CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE,
  CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_STATEMENT,
  getSourceRegistryEntry,
  licenseRegistry,
  sourceRegistry,
} from "./source-registry";

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

describe("CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE (T003 granted vector envelope)", () => {
  it("has a fingerprint reproducible from the recorded statement in the constant itself", () => {
    const recomputed = sha256HexSync(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_STATEMENT);
    expect(recomputed).toBe(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.fingerprintSha256);
    expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.approvalStatement).toBe(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_STATEMENT);
  });

  it("records the statement as one line with no trailing newline", () => {
    expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_STATEMENT).not.toMatch(/\n/);
    expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_STATEMENT.trim()).toBe(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_STATEMENT);
  });

  it("is marked user-approved rather than pending", () => {
    expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.evidenceId).toBe("approval:citywide-public-realm-vector:20260824:user-approved");
    expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.evidenceId).not.toMatch(/pending/);
  });

  it("mirrors the T002 draft exclusions exactly, so only acquisition widened", () => {
    expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.exclusions).toEqual(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE.exclusions);
    for (const excluded of ["runtime external network", "public deployment or conveyance"]) {
      expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.exclusions).toContain(excluded);
    }
  });

  it("names the five vector datasets and excludes imagery", () => {
    for (const datasetId of ["xgwd-7vhd", "vfx9-tbb6", "x9uq-u3qs", "pjs3-c3z5", "k5k6-6jex"]) {
      expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.scope).toContain(datasetId);
    }
    expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.scope).toMatch(/Imagery is NOT in this envelope/);
  });

  it("pins the same snapped Manhattan ground coverage the acquisition CLI clips to", () => {
    for (const bound of ["-74.0478515625", "40.67138671875", "-73.89404296875", "40.89111328125"]) {
      expect(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE.scope).toContain(bound);
    }
  });
});

describe.each([
  { id: "nyc.hydrography", datasetId: "pjs3-c3z5" },
  { id: "nyc.dot-pedestrian-plazas", datasetId: "k5k6-6jex" },
])("T003 approved citywide vector source: $id", ({ id, datasetId }) => {
  const entry = getSourceRegistryEntry(id);

  it("is registered, approved for ingestion, and cites the correct dataset", () => {
    expect(entry).toBeDefined();
    expect(entry!.datasetId).toBe(datasetId);
    expect(entry!.approval.state).toBe("approved");
    expect(entry!.approval.scope).toBe("ingestion");
  });

  it("is dated to the 2026-08-24 user turn, not the 2026-08-04 real wave", () => {
    expect(entry!.approval.reviewedAt).toBe("2026-08-24T00:00:00Z");
  });

  it("cites the granted vector evidence and no longer claims to be pending", () => {
    expect(entry!.approvalEvidence).toBe(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE);
    expect(entry!.approval.note).toContain("approval:citywide-public-realm-vector:20260824:user-approved");
    expect(entry!.approval.note).not.toMatch(/NOT yet user-approved/i);
    expect(entry!.approval.note).not.toContain("approval:citywide-public-realm:20260824:pending-user-approval");
  });

  it("permits download but still forbids runtime, redistribution, and deployment", () => {
    expect(entry!.access.keyOrAgreementRequired).toBe(false);
    expect(entry!.access.constraints).toMatch(/Download is authorized/i);
    expect(entry!.access.constraints).toMatch(/runtime provider requests, redistribution, and public deployment remain excluded/i);
  });

  it("discloses that the clip envelope is a rectangle, not a borough boundary", () => {
    expect(entry!.geographicScope).toMatch(/rectangle, not a borough boundary|envelope is a rectangle/i);
    expect(entry!.geographicScope).toMatch(/ground ledger downstream/i);
  });

  it("carries its license reference into the license registry", () => {
    const license = licenseRegistry.find((candidate) => candidate.id === `license:${id}`);
    expect(license).toBeDefined();
    expect(license?.derivativePolicy).toBe(entry!.derivativePolicy);
  });
});

describe.each([
  { id: "nyc.oti-planimetrics-roadbed-block835", datasetId: "xgwd-7vhd" },
  { id: "nyc.oti-planimetrics-sidewalk-block835", datasetId: "vfx9-tbb6" },
  { id: "nyc.oti-planimetrics-pavement-edge-block835", datasetId: "x9uq-u3qs" },
])("T003 wider Manhattan clip annotated on the Block 835 planimetrics entry: $id", ({ id, datasetId }) => {
  const entry = getSourceRegistryEntry(id)!;

  it("keeps the Block 835 evidence object and fingerprint untouched", () => {
    expect(entry.datasetId).toBe(datasetId);
    expect(entry.approvalEvidence).toBe(BLOCK835_PUBLIC_REALM_APPROVAL_EVIDENCE);
    expect(entry.approval.reviewedAt).toBe("2026-08-04T00:00:00Z");
    expect(BLOCK835_PUBLIC_REALM_APPROVAL_EVIDENCE.fingerprintSha256).toBe("378fec5e7306c224c133de78cc18323b9ca8410039af76974dfabdf7de4cb5d5");
  });

  it("records the wider T003 clip as an additional envelope rather than a replacement", () => {
    expect(entry.approval.note).toContain("approval:block835-public-realm:20260806:user-approved");
    expect(entry.approval.note).toContain("approval:citywide-public-realm-vector:20260824:user-approved");
    expect(entry.approval.note).toMatch(/does not alter, widen, or reinterpret the Block 835 evidence/i);
    expect(entry.geographicScope).toContain("Block 835 perimeter and four adjacent intersection approaches");
    expect(entry.geographicScope).toContain("approval:citywide-public-realm-vector:20260824:user-approved");
  });
});

describe("nyc.orthoimagery-2024-manhattan graduated at the T004 imagery gate", () => {
  const entry = getSourceRegistryEntry("nyc.orthoimagery-2024-manhattan");

  it("is registered, approved for ingestion, and cites the correct dataset", () => {
    expect(entry).toBeDefined();
    expect(entry!.datasetId).toBe("boro_manhattan_sp24.zip");
    expect(entry!.approval.state).toBe("approved");
    expect(entry!.approval.scope).toBe("ingestion");
  });

  it("was reviewed on the T004 gate date, not the inherited real-wave date", () => {
    expect(entry!.approval.reviewedAt).toBe("2026-08-25T00:00:00Z");
  });

  it("cites the ortho envelope, not the T002 draft and not the vector envelope", () => {
    expect(entry!.approvalEvidence).toBe(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE);
    expect(entry!.approvalEvidence).not.toBe(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE);
    expect(entry!.approvalEvidence).not.toBe(CITYWIDE_PUBLIC_REALM_VECTOR_APPROVAL_EVIDENCE);
    expect(entry!.approval.note).toContain("approval:citywide-public-realm-ortho:20260825:standing-envelope");
    expect(entry!.approval.note).not.toMatch(/NOT yet user-approved/i);
  });

  it("leaves the T002 draft evidence with no citing source entry", () => {
    // `sourceRegistry` is a heterogeneous union and some members carry no
    // `approvalEvidence` at all, so the property is probed rather than assumed.
    const citing = sourceRegistry
      .filter((candidate) => "approvalEvidence" in candidate && candidate.approvalEvidence === CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE)
      .map((candidate) => candidate.id);
    expect(citing).toEqual([]);
  });

  it("carries its license reference into the license registry", () => {
    const license = licenseRegistry.find((candidate) => candidate.id === "license:nyc.orthoimagery-2024-manhattan");
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

  it("records the completed T004 FGDC inspection rather than asserting terms", () => {
    expect(entry.derivativePolicy.constraints).toMatch(/T004/);
    expect(entry.derivativePolicy.constraints).toMatch(/FGDC/);
    // The inspection found unfilled template placeholders. That is recorded as
    // non-contradiction of CC BY 4.0, never as an affirmative grant by the zip.
    expect(entry.derivativePolicy.constraints).toMatch(/placeholder/i);
    expect(entry.approval.note).toMatch(/not as an affirmative grant/i);
    expect(entry.approval.note).toMatch(/closed by inspection/i);
  });

  it("keeps the CC BY 4.0 attribution obligation attached to derivatives", () => {
    expect(entry.derivativePolicy.allowed).toBe("conditional");
    expect(entry.derivativePolicy.constraints).toMatch(/attribution/i);
    expect(entry.retention.constraints).toMatch(/CC BY 4\.0 attribution/);
  });
});

describe("CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE (T004 granted envelope)", () => {
  it("has a reproducible fingerprint over the verbatim approval statement", () => {
    const recomputed = sha256HexSync(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_STATEMENT);
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.fingerprintSha256).toBe(recomputed);
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.approvalStatement).toBe(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_STATEMENT);
  });

  it("records the statement as a single line with no surrounding whitespace", () => {
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_STATEMENT).not.toMatch(/\n/);
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_STATEMENT.trim()).toBe(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_STATEMENT);
  });

  it("is a granted envelope distinct from the T002 draft", () => {
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.evidenceId).toBe("approval:citywide-public-realm-ortho:20260825:standing-envelope");
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.evidenceId).not.toMatch(/pending-user-approval/);
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.fingerprintSha256).not.toBe(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE.fingerprintSha256);
  });

  it("widened acquisition permission only, never use permission", () => {
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.exclusions).toEqual(CITYWIDE_PUBLIC_REALM_APPROVAL_EVIDENCE.exclusions);
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.scope).toMatch(/No redistribution/i);
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.scope).toMatch(/local-only/i);
  });

  it("names the imagery it covers and does not reach the vector datasets", () => {
    expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.scope).toContain("boro_manhattan_sp24.zip");
    for (const vectorDatasetId of ["xgwd-7vhd", "vfx9-tbb6", "x9uq-u3qs", "pjs3-c3z5", "k5k6-6jex"]) {
      expect(CITYWIDE_PUBLIC_REALM_ORTHO_APPROVAL_EVIDENCE.scope).not.toContain(vectorDatasetId);
    }
  });
});
