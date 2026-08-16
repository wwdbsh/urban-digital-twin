/**
 * Drift gate over the committed T004 Stage-0 gate record.
 *
 * The record is produced by a deliberate operator command that takes minutes and
 * needs the pinned citywide snapshot, so it is not re-derived here. What IS
 * checked here, on every run, is that the committed record still says what the
 * wave dispatches are allowed to rely on — and that the go/no-go numbers inside
 * it are the ones the gate's own invariants demand.
 *
 * A record that drifts, or a record somebody edits to make a gate pass, fails
 * here rather than being discovered by a wave that should never have started.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  FINGERPRINT_PATH,
  FROZEN_FINGERPRINTS_AT_9E120E1,
  GATE_PATH,
  STRIDE_PATH,
  T003_DIFFERENTIAL_DIGEST,
  TEXTURE_COST_PATH,
  computeFingerprintRecord,
  stage0Invariants,
} from "./mass-generation-stage0-cli.mjs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const checksumOf = (path) => sha256HexSync(readFileSync(path, "utf8"));
const recordedChecksum = (path) => readFileSync(path.replace(/\.json$/u, ".sha256"), "utf8").trim().split(/\s+/u)[0];

describe("the committed Stage-0 records are intact", () => {
  it.each([
    ["gate", GATE_PATH],
    ["fingerprints", FINGERPRINT_PATH],
    ["stride", STRIDE_PATH],
    ["textured write cost", TEXTURE_COST_PATH],
  ])("%s matches its recorded checksum", (_name, path) => {
    expect(checksumOf(path)).toBe(recordedChecksum(path));
  });
});

describe("the Stage-0 gate still says exactly what it said", () => {
  /**
   * STAGE 0 DOES NOT PASS, and this test asserts that rather than a pass.
   *
   * Nine of the ten gate items are green; the tenth is not, and the committed
   * record says so. Pinning the EXACT issue list is what makes this a drift
   * gate in both directions: a new failure fails here, and so does a silent
   * disappearance of the known one. When the LOD-1 contract is re-decided and
   * the silhouette item goes green, this expectation has to be updated
   * deliberately — which is the conversation that should happen.
   */
  it("reports exactly the one known failure and no other", () => {
    expect(stage0Invariants(read(GATE_PATH))).toEqual([
      "19 strided building(s) are at or over the 2% LOD-transition cap",
    ]);
  });

  it("records the failure as NOT caused by T004", () => {
    const attribution = read(STRIDE_PATH).silhouette.overCapAttribution;
    // Every over-cap building is already over the cap under the SHIPPED
    // grammar, and neither rooftop rule moves any of them materially.
    expect(attribution.alreadyOverCapUnderShippedGrammar).toBe(attribution.buildings.length);
    expect(attribution.worstT004Delta).toBeLessThan(1e-4);
  });

  it("carries the T003 differential digest UNMOVED, which is the default-path proof", () => {
    const gate = read(GATE_PATH);
    expect(gate.differential.observedDigestSha256).toBe(T003_DIFFERENTIAL_DIGEST);
    expect(gate.differential.movedPlanHashCount).toBe(0);
    expect(gate.differential.acceptedSetSize).toBe(44_295);
  });

  it("carries a NON-VACUOUS shipped-byte replay", () => {
    const gate = read(GATE_PATH);
    expect(gate.shippedByteReplay.totalAssetsCompared).toBe(498);
    expect(gate.shippedByteReplay.totalAssetsMatched).toBe(498);
  });

  it("carries ZERO orphan legs after the fix, and a real number of them before it", () => {
    const stride = read(STRIDE_PATH);
    expect(stride.rooftop.postFix.orphanLegBuildings).toBe(0);
    expect(stride.rooftop.postFix.orphanLegTotal).toBe(0);
    // A pre-fix count of zero would mean the stride never met the defect and
    // the post-fix zero proved nothing.
    expect(stride.rooftop.preFix.orphanLegBuildings).toBeGreaterThan(0);
    expect(stride.rooftop.postFix.boundHolds).toBe(true);
  });

  it("measured a real population rather than a token one", () => {
    const stride = read(STRIDE_PATH);
    expect(stride.stride.materialized).toBeGreaterThan(2_000);
    expect(stride.silhouette.measured).toBe(stride.stride.materialized);
  });
});

describe("the frozen stage fingerprints in the record are still the live ones", () => {
  it("re-derives every frozen profile fingerprint and finds it unmoved", () => {
    const live = computeFingerprintRecord();
    expect(live.allUnmoved).toBe(true);
    for (const row of live.frozenProfiles) {
      expect(row.fingerprintNow, row.profile).toBe(FROZEN_FINGERPRINTS_AT_9E120E1[row.profile]);
    }
    // The committed record must agree with what this repository computes today.
    const committed = read(FINGERPRINT_PATH);
    expect(live.frozenProfiles.map((row) => [row.profile, row.fingerprintNow]))
      .toEqual(committed.frozenProfiles.map((row) => [row.profile, row.fingerprintNow]));
  });

  it("still SEES shared-uri delivery, which was the second blindness", () => {
    expect(computeFingerprintRecord().sharedUriVariants.allMoved).toBe(true);
  });
});
