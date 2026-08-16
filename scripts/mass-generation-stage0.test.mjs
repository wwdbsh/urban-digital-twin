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
  ISLAND_PATH,
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
    ["island silhouette", ISLAND_PATH],
    ["textured write cost", TEXTURE_COST_PATH],
  ])("%s matches its recorded checksum", (_name, path) => {
    expect(checksumOf(path)).toBe(recordedChecksum(path));
  });
});

describe("the Stage-0 gate still says exactly what it said", () => {
  /**
   * STAGE 0 NOW PASSES, and the reason is recorded rather than assumed.
   *
   * The single failure was the LOD-1 contract: 19 of 2,250 strided buildings at
   * or over the assembly schema's 2% silhouette cap. That count has NOT gone
   * away and this test does not pretend it has — it is still asserted below.
   * What changed is the contract: under the adjudicated `measured-fallback`
   * rule an over-cap building's coarse level carries FULL GEOMETRY, so its
   * emitted deviation is zero because it dropped nothing, and no coarse level
   * above the cap ships. The cap was not relaxed; the buildings it excludes
   * stopped having a coarse level.
   */
  it("passes with an EMPTY issue list, under the adjudicated LOD-1 rule", () => {
    expect(stage0Invariants(read(GATE_PATH))).toEqual([]);
  });

  it("still records the raw over-cap count, so the fallback is visibly a decision rather than a disappearance", () => {
    const gate = read(GATE_PATH);
    expect(gate.silhouette.countAtOrOverCap).toBe(19);
    expect(gate.lod1Contract.policy).toBe("measured-fallback");
    expect(gate.lod1Contract.strideFallbackBuildings).toBe(19);
    expect(gate.lod1Contract.strideUnresolvedOverCap).toBe(0);
    // A fallback level IS the fine level: zero declared error, same triangles.
    expect(gate.lod1Contract.fallbackGeometricErrorsAllZero).toBe(true);
    expect(gate.lod1Contract.fallbackTrianglesMatchLod0).toBe(true);
    expect(gate.lod1Contract.strideWorstEmittedDeviationRatio).toBeLessThanOrEqual(0.02);
  });

  it("records the stride failure as NOT caused by T004", () => {
    const attribution = read(STRIDE_PATH).silhouette.overCapAttribution;
    // Every over-cap building in the stride is already over the cap under the
    // SHIPPED grammar, and neither rooftop rule moves any of them materially.
    expect(attribution.alreadyOverCapUnderShippedGrammar).toBe(attribution.buildings.length);
    expect(attribution.worstT004Delta).toBeLessThan(1e-4);
  });

  /**
   * THE EXHAUSTIVE PASS, which is what a per-building decision has to key on.
   *
   * A stride can say "about 0.8% are over the cap"; it cannot say WHICH, and
   * the fallback rule decides per building. The island pass names every one.
   * Its attribution is pinned in three disjoint buckets, because the honest
   * residual — buildings that were inside the cap under the shipped grammar and
   * are outside it under this envelope — is exactly ONE, and a single "already
   * over the cap" count would have hidden it.
   */
  it("carries the exhaustive island pass, with the over-cap set attributed", () => {
    const island = read(ISLAND_PATH);
    expect(island.population.enumeratedOwnedParents).toBe(45_194);
    expect(island.population.measured).toBe(45_032);
    expect(island.overCap.count).toBe(425);
    expect(island.overCap.buildings).toHaveLength(425);
    const attribution = island.overCap.attribution;
    expect(attribution.alreadyOverCapUnderShippedGrammar
      + attribution.absentUnderShippedGrammar
      + attribution.crossedUnderT004Count).toBe(island.overCap.count);
    expect(attribution.alreadyOverCapUnderShippedGrammar).toBe(415);
    // Nine are buildings the SHIPPED grammar refuses outright — T003 low-rise
    // recoveries, which have no shipped deviation to be over or under.
    expect(attribution.absentUnderShippedGrammar).toBe(9);
    // And exactly one building crosses the cap because of T004's rooftop rules.
    expect(attribution.crossedUnderT004Count).toBe(1);
    expect(attribution.crossedUnderT004[0].buildingId).toBe("doitt:401323");
    expect(attribution.crossedUnderT004[0].t004Delta).toBeLessThan(1e-3);
    // Every building in the set resolves to a full-geometry coarse level.
    expect(island.overCap.buildings.every((row) => row.lod1Decision === "full-geometry")).toBe(true);
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
