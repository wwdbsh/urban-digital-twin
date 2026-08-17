/**
 * The digest forms a serving wave's promotion record needs (ADR 0052 D-A).
 *
 * A curated wave states its acceptance literally: one assembly package, and 14
 * to 179 building identities a reviewer can read. A SERVING wave states the
 * same facts about up to 11,682 buildings and up to 249 per-cell packages, and
 * the literal form stops being reviewable long before it stops being
 * expressible — ninety kilobytes of identifiers in a source file is a diff
 * nobody reads, and pasting it does not make the acceptance stronger because
 * the gate still only compares it against what the runtime resolved.
 *
 * So both become digests over the same canonical join `cellsDigestSha256`
 * already uses, with the same failure ordering: COUNT FIRST, then digest. This
 * suite pins that ordering, pins that a caller which computed no digest is
 * refused rather than passed by omission, and pins which form each shipped
 * record uses.
 *
 * That last part is what the T005 promotion changed. When this suite was
 * written every promoted record still stated its acceptance literally and the
 * digest form was reachable only through fixtures. All six promoted records now
 * state all three sets as digests, and the literal form survives — unchanged and
 * still exercised below — in the curated predecessors those records roll back
 * to.
 */
import { describe, expect, it } from "vitest";

import {
  EXTERIOR_DEFAULT_ACTIVATIONS,
  exteriorAcceptedCellsJoin,
  exteriorAcceptedIdsDigest,
  exteriorAcceptedIdsJoin,
  verifyPromotedExteriorMembership,
  verifyPromotedExteriorPin,
  type ExteriorAcceptedCell,
  type ExteriorDefaultActivationEnabled,
} from "./exterior-default-activation.ts";

const CELLS: readonly ExteriorAcceptedCell[] = [
  { cellId: "cell-a", cellReleaseId: "cell-release:serving:cell-a:v1", checksumSha256: "a".repeat(64) },
  { cellId: "cell-b", cellReleaseId: "cell-release:serving:cell-b:v1", checksumSha256: "b".repeat(64) },
];
const PACKAGES = ["assembly:serving:cell-a", "assembly:serving:cell-b"];
const BUILDINGS = ["doitt:1", "doitt:2", "doitt:3"];

async function digestRecord(): Promise<ExteriorDefaultActivationEnabled> {
  return {
    enabled: true,
    releaseId: "manhattan-lower-manhattan-cells-20260812-s1",
    snapshotId: "snapshot:manhattan-lower-manhattan-cells-20260812-s1:v1",
    snapshotChecksumSha256: "c".repeat(64),
    assemblyPackageIds: [],
    assemblyPackageIdsDigestSha256: await exteriorAcceptedIdsDigest(PACKAGES),
    assemblyPackageCount: PACKAGES.length,
    membership: {
      cells: [...CELLS],
      cellsDigestSha256: null,
      cellCount: CELLS.length,
      buildingIds: [],
      buildingIdsDigestSha256: await exteriorAcceptedIdsDigest(BUILDINGS),
      buildingCount: BUILDINGS.length,
    },
    approvalRef: "fixture approval",
    rolledBackReleaseId: null,
    predecessor: { enabled: false, releaseId: null, rolledBackReleaseId: null },
  };
}

async function resolvedInput(overrides: Partial<Parameters<typeof verifyPromotedExteriorPin>[0]> = {}) {
  return {
    releaseId: "manhattan-lower-manhattan-cells-20260812-s1",
    snapshotId: "snapshot:manhattan-lower-manhattan-cells-20260812-s1:v1",
    snapshotChecksumSha256: "c".repeat(64),
    assemblyPackageIds: PACKAGES,
    assemblyPackageIdsDigestSha256: await exteriorAcceptedIdsDigest(PACKAGES),
    cells: CELLS,
    cellsDigestSha256: null,
    buildingIds: BUILDINGS,
    buildingIdsDigestSha256: await exteriorAcceptedIdsDigest(BUILDINGS),
    ...overrides,
  };
}

describe("the canonical ID join", () => {
  it("is order-independent and uses the separator the cell join already uses", () => {
    expect(exteriorAcceptedIdsJoin(["b", "a"])).toBe(exteriorAcceptedIdsJoin(["a", "b"]));
    expect(exteriorAcceptedIdsJoin(["a", "b"])).toBe("a, b");
    // The cell join's separator, so there is one encoding rather than two.
    expect(exteriorAcceptedCellsJoin(CELLS)).toContain(", ");
  });

  it("changes when any identity changes", async () => {
    const base = await exteriorAcceptedIdsDigest(BUILDINGS);
    expect(await exteriorAcceptedIdsDigest([...BUILDINGS, "doitt:4"])).not.toBe(base);
    expect(await exteriorAcceptedIdsDigest(BUILDINGS.slice(1))).not.toBe(base);
    expect(await exteriorAcceptedIdsDigest(["doitt:1", "doitt:2", "doitt:9"])).not.toBe(base);
    expect(await exteriorAcceptedIdsDigest([...BUILDINGS].reverse())).toBe(base);
  });
});

describe("the digest-form pin gate", () => {
  it("accepts a resolve that matches both digests", async () => {
    expect(verifyPromotedExteriorPin(await resolvedInput(), await digestRecord())).toEqual({ ok: true });
  });

  it("names the assembly package COUNT before it compares any digest", async () => {
    const verification = verifyPromotedExteriorPin(
      await resolvedInput({ assemblyPackageIds: [PACKAGES[0]!], assemblyPackageIdsDigestSha256: "0".repeat(64) }),
      await digestRecord(),
    );
    expect(verification.ok).toBe(false);
    expect(verification.ok ? "" : verification.message).toContain("assembly package count");
    expect(verification.ok ? "" : verification.message).not.toContain("digest");
  });

  it("names the building COUNT before it compares any digest", async () => {
    const verification = verifyPromotedExteriorPin(
      await resolvedInput({ buildingIds: BUILDINGS.slice(1), buildingIdsDigestSha256: "0".repeat(64) }),
      await digestRecord(),
    );
    expect(verification.ok).toBe(false);
    expect(verification.ok ? "" : verification.message).toContain("building count");
  });

  it("refuses a caller that computed no digest, rather than passing by omission", async () => {
    for (const field of ["assemblyPackageIdsDigestSha256", "buildingIdsDigestSha256"] as const) {
      const verification = verifyPromotedExteriorPin(await resolvedInput({ [field]: null }), await digestRecord());
      expect(verification.ok).toBe(false);
      expect(verification.ok ? "" : verification.message).toContain("never verified");
    }
  });

  it("refuses a resolve whose set differs at the same count", async () => {
    const swapped = ["assembly:serving:cell-a", "assembly:serving:cell-z"];
    const verification = verifyPromotedExteriorPin(
      await resolvedInput({ assemblyPackageIds: swapped, assemblyPackageIdsDigestSha256: await exteriorAcceptedIdsDigest(swapped) }),
      await digestRecord(),
    );
    expect(verification.ok).toBe(false);
    expect(verification.ok ? "" : verification.message).toContain("assembly package digest");

    const shifted = ["doitt:1", "doitt:2", "doitt:9"];
    const buildingVerification = verifyPromotedExteriorPin(
      await resolvedInput({ buildingIds: shifted, buildingIdsDigestSha256: await exteriorAcceptedIdsDigest(shifted) }),
      await digestRecord(),
    );
    expect(buildingVerification.ok).toBe(false);
    expect(buildingVerification.ok ? "" : buildingVerification.message).toContain("building membership digest");
  });
});

describe("the digest-form identity gate", () => {
  it("refuses when it is not handed the membership the pin gate verified", async () => {
    const verification = verifyPromotedExteriorMembership(["doitt:1"], await digestRecord());
    expect(verification.ok).toBe(false);
    expect(verification.ok ? "" : verification.message).toContain("must be handed the verified resolved membership");
  });

  it("gates rendered identities against the verified set", async () => {
    const record = await digestRecord();
    expect(verifyPromotedExteriorMembership(["doitt:1", "doitt:3"], record, BUILDINGS)).toEqual({ ok: true });
    const rejected = verifyPromotedExteriorMembership(["doitt:1", "doitt:404"], record, BUILDINGS);
    expect(rejected.ok).toBe(false);
    expect(rejected.ok ? "" : rejected.message).toContain("doitt:404");
  });
});

describe("the digest form, in the records this build ships", () => {
  it("is what every promoted record uses, for all three acceptance sets", () => {
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) continue;
      // The unused form is empty in all three places, so nothing in a promoted
      // record can be read as an accepted list the gate does not compare.
      expect(record.assemblyPackageIds, record.releaseId).toEqual([]);
      expect(record.assemblyPackageIdsDigestSha256 ?? "", record.releaseId).toMatch(/^[0-9a-f]{64}$/u);
      expect(record.assemblyPackageCount ?? 0, record.releaseId).toBeGreaterThan(0);
      expect(record.membership.cells, record.releaseId).toEqual([]);
      expect(record.membership.cellsDigestSha256 ?? "", record.releaseId).toMatch(/^[0-9a-f]{64}$/u);
      expect(record.membership.cellCount, record.releaseId).toBeGreaterThan(0);
      expect(record.membership.buildingIds, record.releaseId).toEqual([]);
      expect(record.membership.buildingIdsDigestSha256 ?? "", record.releaseId).toMatch(/^[0-9a-f]{64}$/u);
      expect(record.membership.buildingCount ?? 0, record.releaseId).toBeGreaterThan(0);
    }
  });
});

/**
 * The literal form, which no promoted record uses any more.
 *
 * It is not dead: it is what the CURATED records state, and a rolled-back build
 * runs it. T001 MOVED IT ONE RUNG FURTHER DOWN — a promoted `-s2` record's
 * predecessor is now the `-s1` serving record, which uses the DIGEST form like
 * its successor, and the curated record that states its head and membership
 * literally is that record's own predecessor. These cases follow the form to
 * where it actually ships rather than asserting it of records that moved.
 */
describe("the literal form", () => {
  /** The curated rung: down through the serving records to the literal one. */
  const curatedRung = (record: ExteriorDefaultActivationEnabled): ExteriorDefaultActivationEnabled => {
    let current = record;
    while (current.predecessor.enabled && (current.predecessor.assemblyPackageIdsDigestSha256 ?? null) !== null) {
      current = current.predecessor as ExteriorDefaultActivationEnabled;
    }
    return current.predecessor as ExteriorDefaultActivationEnabled;
  };

  it("is what every curated predecessor still uses, and is untouched", () => {
    let checked = 0;
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) continue;
      // The rung immediately below is the -s1 serving record, which is DIGEST
      // form. Asserting the literal form of it would have failed for the right
      // reason and been "fixed" by deleting the check.
      expect(record.predecessor.enabled, record.releaseId).toBe(true);
      const predecessor = curatedRung(record);
      expect(predecessor.enabled, record.releaseId).toBe(true);
      if (!predecessor.enabled) continue;
      expect(predecessor.assemblyPackageIdsDigestSha256 ?? null, predecessor.releaseId).toBeNull();
      expect(predecessor.membership.buildingIdsDigestSha256 ?? null, predecessor.releaseId).toBeNull();
      expect(predecessor.assemblyPackageIds.length, predecessor.releaseId).toBeGreaterThan(0);
      expect(predecessor.membership.buildingIds.length, predecessor.releaseId).toBeGreaterThan(0);
      checked += 1;
    }
    // Not vacuous: all six waves reach a literal-form curated record.
    expect(checked).toBe(6);
  });

  it("ignores a supplied resolved set, so the record's own list stays authoritative", () => {
    const promoted = EXTERIOR_DEFAULT_ACTIVATIONS.find((entry) => entry.enabled)! as ExteriorDefaultActivationEnabled;
    const record = curatedRung(promoted);
    expect(record.enabled).toBe(true);
    const outsider = "doitt:000000";
    expect(record.membership.buildingIds).not.toContain(outsider);
    const verification = verifyPromotedExteriorMembership([outsider], record, [outsider]);
    expect(verification.ok).toBe(false);
  });
});
