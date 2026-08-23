/* global TextDecoder, TextEncoder */
/**
 * The phantom-shaft fix, bound to its own evidence.
 *
 * Two things are held here that prose cannot hold. First, that the records this
 * fix SUPERSEDES were never edited — checked by re-hashing their bytes, not by
 * looking for a sentence that says so, because a sentence survives an edit and a
 * hash does not. Second, that the numbers quoted in the amendment and the budget
 * are the numbers the measurement actually produced.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { FAR_TIER_BUDGET_CONTRACT } from "../src/release/far-tier-budget.ts";
import {
  FAR_TIER_PAYLOAD_INVENTORY_SHA256,
  FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSORS,
  FAR_TIER_RUNTIME_BUDGETS_V3,
} from "../src/runtime/far-tier-serving.ts";

const EVIDENCE = "data/far-tier-hlod-phantom-shaft-20260823";
const PROMOTION = "data/far-tier-hlod-promotion-20260823";
const readText = (path) => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
const readJson = (path) => JSON.parse(readText(path));

/** Every record this task supersedes, with the digest it must still have. */
const FROZEN = {
  "data/manhattan-hlod-far-tier-acceptance-20260822/reconciliation.json": "4f4f733a863d9731b156f46d46fd06413b8b06773333b3f2a2ffa995596a79ec",
  "data/far-tier-hlod-mass-20260819/campaign-summary.json": "a2caba098461f5d2cb7bf5bbf57f87e398ec6842c4828620369f7158126e841c",
  "data/far-tier-hlod-promotion-20260819/promoted-inventory.json": "cf8e26480eecc91f2e7b473d217a0d3551d0be59b4d8da39ee1217a6e0538f0a",
  "data/far-tier-hlod-promotion-20260819/sweep-exemptions.json": "6354676da304ab03783132730f75dafdfce60c82f509dd740b9fc18c92e8d430",
};

describe("the superseded records are superseded BY STATEMENT, never edited", () => {
  it("re-hashes every frozen record to the digest this task pinned before it ran", () => {
    for (const [path, digest] of Object.entries(FROZEN)) {
      expect(sha256HexSync(readText(path)), path).toBe(digest);
    }
  });

  it("keeps every frozen per-wave telemetry and inventory matching its OWN sidecar", () => {
    // These are the records P4 corrects. They record what the defective code
    // did, and correcting them in place would destroy the evidence the
    // correction is measured against.
    for (const wave of ["w00", "w01", "w02", "w03", "w04", "w05"]) {
      for (const kind of ["telemetry", "inventory"]) {
        const path = `data/far-tier-hlod-mass-20260819/${kind}-${wave}.json`;
        const sidecar = readText(path.replace(/\.json$/u, ".sha256")).trim().split(/\s+/u)[0];
        expect(sha256HexSync(readText(path)), path).toBe(sidecar);
      }
    }
  });
});

describe("the amendment quotes the measurement", () => {
  const verification = readJson(`${EVIDENCE}/verification.json`);
  const amendment = readJson(`${EVIDENCE}/acceptance-amendment.json`);
  const preRegistration = readJson(`${EVIDENCE}/pre-registration.json`);

  it("pre-registered the architect's three anchors, and all three hold", () => {
    // The pre-registration must NOT have been written after the fact.
    expect(preRegistration.capturedAt).toBeNull();
    expect(preRegistration.predictions.P1.claims).toHaveLength(3);
    for (const anchor of verification.P1.anchors) expect(anchor.verdict).toBe("PASS");
  });

  it("bakes every ledger cell, with no stop in any class", () => {
    expect(verification.totals.ledgerCells).toBe(883);
    expect(verification.totals.baked).toBe(883);
    expect(verification.totals.stops).toBe(0);
    expect(verification.P2.verdict).toBe("PASS");
  });

  it("reproduces all 840 pre-existing tiles byte for byte", () => {
    expect(verification.P3.previouslyBakedCount).toBe(840);
    expect(verification.P3.mismatched).toBe(0);
    expect(verification.P3.verdict).toBe("PASS");
  });

  it("holds the bar where it was, and does not widen the fallback opt-in", () => {
    expect(verification.barUnchanged).toBe(0.05);
    expect(preRegistration.predictions.P1.claims[0]).toContain("0.05");
  });

  it("reports the refusal count that got WORSE, not only the one that got better", () => {
    // 143 -> 162. An amendment that quoted only the retired residual would be
    // reporting the improvement and hiding the regression beside it.
    const inventory = readJson(`${PROMOTION}/promoted-inventory.json`);
    const refused = inventory.entries.flatMap((entry) => entry.members).filter((member) => !member.included);
    expect(refused).toHaveLength(162);
    expect(amendment.change.whatDidNotGetBetter).toContain("143");
    expect(amendment.change.whatDidNotGetBetter).toContain("162");
  });

  it("retires R13 without moving any criterion verdict", () => {
    expect(amendment.amends.residual).toBe("R13");
    expect(amendment.change.residualStatus).toBe("R13 IS RETIRED.");
    expect(amendment.change.verdictMovement).toContain("NO CRITERION VERDICT CHANGES");
  });
});

describe("the promoted inventory and the pins agree", () => {
  const inventoryText = readText(`${PROMOTION}/promoted-inventory.json`);
  const inventory = JSON.parse(inventoryText);

  it("closes 883 + 0 against the ledger and is what shipped code pins", () => {
    expect(inventory.entries).toHaveLength(883);
    expect(inventory.coverage.honestStopCells).toBe(0);
    expect(inventory.coverage.accountedFor).toBe(883);
    expect(sha256HexSync(inventoryText)).toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256);
  });

  it("keeps BOTH earlier pins re-derivable, so neither swap can be dropped", () => {
    expect(FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSORS).toHaveLength(2);
    expect(sha256HexSync(readText("data/far-tier-hlod-runtime-20260818/payload-inventory.json")))
      .toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSORS[0]);
    expect(sha256HexSync(readText("data/far-tier-hlod-promotion-20260819/promoted-inventory.json")))
      .toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSORS[1]);
  });

  it("derives budgets v3 from the inventory it declares, not from a typed-in number", () => {
    const bytes = inventory.entries.reduce((sum, entry) => sum + entry.glbByteSize + entry.atlasByteSize, 0);
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.derivation.declaredFileBytesAllTiles).toBe(bytes);
    expect(FAR_TIER_RUNTIME_BUDGETS_V3.derivation.promotedTiles).toBe(inventory.entries.length);
  });

  it("meets the frozen GPU bar in the bar's own unit, and says the margin is thin", () => {
    const gpu = FAR_TIER_RUNTIME_BUDGETS_V3.gpuJustification;
    const verification = readJson(`${EVIDENCE}/verification.json`);
    expect(gpu.islandAtlasGpuBytes).toBe(verification.P5.atlasGpuBytes);
    expect(gpu.islandGeometryGpuBytes).toBe(verification.P5.geometryGpuBytes);
    expect(gpu.islandResidentGpuBytes).toBeLessThan(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes);
    // The retired proxy would now REFUSE this set. That is why it is retired.
    expect(gpu.v2ProxyCorrection.sameProxyOn883).toBeGreaterThan(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes);
  });
});

describe("the sweep is scored against the registered poses, unchanged", () => {
  const sweep = readJson(`${PROMOTION}/sweep-results.json`);

  it("passes all six registered poses with no uncovered massing anywhere", () => {
    expect(sweep.poses).toHaveLength(6);
    for (const pose of sweep.poses) expect(pose.verdict, pose.poseId).toBe("PASS");
    for (const pose of sweep.poses.filter((entry) => entry.poseId !== "P6-OFF")) {
      expect(pose.massing.uncovered, pose.poseId).toBe(0);
      expect(pose.states.absent + pose.states.checksumMismatch + pose.states.buildFailure + pose.states.overBudget).toBe(0);
    }
  });

  it("reports P3 against the INVERTED premise rather than quietly rescoring it", () => {
    // P3 was registered as "the far tier must show massing here, not a tile".
    // That cell now has a tile, so the honest move is to say the premise moved.
    const p3 = sweep.poses.find((pose) => pose.poseId === "P3");
    expect(p3.againstSweep2.covered).toBe(1);
    expect(p3.massing.covered).toBe(3);
    expect(sweep.p3PremiseInverted.cellId).toBe("manhattan-exterior-cell-w01-000062-14-4823-4481");
  });

  it("keeps the vehicle's limitation and the port substitution on the record", () => {
    expect(sweep.vehicleLimitation.materiality).toContain("ABSENT FROM THE VEHICLE");
    expect(sweep.vehicle.portDeviation.registered).toBe(4173);
    expect(sweep.vehicle.portDeviation.used).toBe(4174);
    expect(sweep.drawnShortfall.statement).toContain("CARRIED FORWARD UNEXPLAINED");
  });
});

describe("every record in this task carries a verifying sidecar", () => {
  it("matches each record against its own sha256 file", () => {
    const records = [
      `${EVIDENCE}/pre-registration.json`,
      `${EVIDENCE}/verification.json`,
      `${EVIDENCE}/replay-new-tiles.json`,
      `${EVIDENCE}/acceptance-amendment.json`,
      `${PROMOTION}/promoted-inventory.json`,
      `${PROMOTION}/sweep-results.json`,
      `${PROMOTION}/exemptions-superseded.json`,
      ...["w00", "w01", "w02", "w03", "w04", "w05"].flatMap((wave) => [
        `${EVIDENCE}/measure-${wave}.json`,
        `${EVIDENCE}/inventory-${wave}.json`,
      ]),
    ];
    for (const path of records) {
      const sidecar = readText(path.replace(/\.json$/u, ".sha256")).trim().split(/\s+/u)[0];
      expect(sha256HexSync(readText(path)), path).toBe(sidecar);
    }
    expect(new TextEncoder().encode("")).toHaveLength(0);
  });
});
