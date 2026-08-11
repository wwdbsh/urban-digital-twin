import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../domain/exterior-fullsnapshot-input.ts";
import type { ExteriorOwnershipLedger } from "./exterior-release.ts";
import {
  EXTERIOR_WAVE_DOMAIN_REGISTRY,
  assertDistinctWaveDomains,
  buildExteriorWaveSubsetLedger,
  exteriorWaveArtifactChecksum,
  type ExteriorWaveSubsetIdentity,
} from "./exterior-wave-subset.ts";
import { MIDTOWN_CORE_SUBSET_IDENTITY } from "./midtown-core-package.ts";
import { LOWER_MANHATTAN_SUBSET_IDENTITY } from "./lower-manhattan-package.ts";

const LEDGER_ROOT = "data/normalized/manhattan-exterior-wave-ledger-20260804";

function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(readFileSync(path)));
}

const parentLedger = JSON.parse(readText(`${LEDGER_ROOT}/ledger.json`)) as ExteriorOwnershipLedger;
const parentLedgerChecksumSha256 = exteriorWaveArtifactChecksum(parentLedger);

/**
 * Wave `w03`, written the way a third wave actually gets written: by copying the
 * wave above it. Copying the domain strings along with everything else is the
 * specific mistake this guard exists for.
 */
const SOUTHERN_REMAINDER_BORROWING_MIDTOWN: ExteriorWaveSubsetIdentity = {
  releaseId: "manhattan-southern-remainder-cells-20260813",
  waveIndex: 3,
  waveId: "southern-remainder",
  cellCount: 176,
  buildingCount: 9_603,
  ledgerIdDomain: "udt.midtown-core.subset-ledger-id.v1",
  baseIdentityDomain: "udt.midtown-core.subset-base-identity.v1",
  exclusionWaveIndexes: [0, 1, 2],
};

describe("exterior wave hash-domain registry", () => {
  it("registers exactly the waves that have issued domains, with no string used twice", () => {
    const strings = EXTERIOR_WAVE_DOMAIN_REGISTRY.flatMap((entry) => [entry.ledgerIdDomain, entry.baseIdentityDomain]);
    expect(new Set(strings).size).toBe(strings.length);
    expect(new Set(EXTERIOR_WAVE_DOMAIN_REGISTRY.map((entry) => entry.waveId)).size).toBe(EXTERIOR_WAVE_DOMAIN_REGISTRY.length);
  });

  /**
   * The registry is the authority, and each wave module is CHECKED against it
   * rather than trusted to agree. A wave whose module drifted from its row would
   * otherwise move ids that are already committed.
   */
  it("agrees with what the two live wave modules declare", () => {
    for (const identity of [MIDTOWN_CORE_SUBSET_IDENTITY, LOWER_MANHATTAN_SUBSET_IDENTITY]) {
      const registered = EXTERIOR_WAVE_DOMAIN_REGISTRY.find((entry) => entry.waveId === identity.waveId);
      expect(registered).toBeDefined();
      expect(registered!.ledgerIdDomain).toBe(identity.ledgerIdDomain);
      expect(registered!.baseIdentityDomain).toBe(identity.baseIdentityDomain);
      expect(() => { assertDistinctWaveDomains(identity); }).not.toThrow();
    }
  });

  /** The failure this guard was added for, named by its owner rather than merely refused. */
  it("refuses a third wave that borrows the midtown domains, naming midtown-core", () => {
    expect(() => { assertDistinctWaveDomains(SOUTHERN_REMAINDER_BORROWING_MIDTOWN); })
      .toThrow(/borrows hash domain "udt\.midtown-core\.subset-ledger-id\.v1", which is issued to wave midtown-core/u);
  });

  it("refuses a borrowed base-identity domain even when the ledger domain is fresh", () => {
    expect(() => {
      assertDistinctWaveDomains({
        ...SOUTHERN_REMAINDER_BORROWING_MIDTOWN,
        ledgerIdDomain: "udt.southern-remainder.subset-ledger-id.v1",
      });
    }).toThrow(/issued to wave midtown-core/u);
  });

  it("refuses borrowing from the lower-manhattan wave too, not just from the first one registered", () => {
    expect(() => {
      assertDistinctWaveDomains({
        ...SOUTHERN_REMAINDER_BORROWING_MIDTOWN,
        ledgerIdDomain: "udt.southern-remainder.subset-ledger-id.v1",
        baseIdentityDomain: "udt.lower-manhattan.subset-base-identity.v1",
      });
    }).toThrow(/issued to wave lower-manhattan/u);
  });

  it("refuses one domain doing both jobs", () => {
    expect(() => {
      assertDistinctWaveDomains({
        ...SOUTHERN_REMAINDER_BORROWING_MIDTOWN,
        ledgerIdDomain: "udt.southern-remainder.subset.v1",
        baseIdentityDomain: "udt.southern-remainder.subset.v1",
      });
    }).toThrow(/for both derived ids/u);
  });

  /** A registered wave may not quietly reassign its own strings either. */
  it("refuses a registered wave that arrives with different domains", () => {
    expect(() => {
      assertDistinctWaveDomains({ ...LOWER_MANHATTAN_SUBSET_IDENTITY, ledgerIdDomain: "udt.lower-manhattan.subset-ledger-id.v2" });
    }).toThrow(/differ from its registered ones/u);
  });

  /**
   * The guard has to run inside the builder, not merely be available beside it.
   * It is asserted BEFORE any ledger work, so a borrowed identity never reaches
   * the point of deriving an id.
   */
  it("is enforced by the subset builder itself", () => {
    expect(() => buildExteriorWaveSubsetLedger(SOUTHERN_REMAINDER_BORROWING_MIDTOWN, {
      parentLedger,
      parentLedgerChecksumSha256,
      baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
      baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    })).toThrow(/borrows hash domain/u);
  });
});
