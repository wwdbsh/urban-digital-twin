/**
 * The drift gate for the T003 far-tier runtime records.
 *
 * NO PAYLOAD DIRECTORY IS READ. The staged tile bytes are gitignored local work
 * product; every input below is committed text checked against its own
 * committed `.sha256` sidecar before it is used, so this gate runs on a fresh
 * clone and a tampered input fails here rather than silently re-deriving a
 * matching wrong answer.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** The project idiom: node types are not in this tsconfig, so decode explicitly. */
function readText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}
import { sha256HexSync } from "../domain/deterministic-hash";
import { FAR_TIER_CELL_STATES, FAR_TIER_PAYLOAD_INVENTORY_SHA256, FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSOR, FAR_TIER_RUNTIME_BUDGETS } from "./far-tier-serving";
import { EXTERIOR_RUNTIME_BUDGETS } from "./exterior-cell-runtime";

const ROOT = "data/far-tier-hlod-runtime-20260818";

/** Read a committed record and refuse it unless it matches its own sidecar. */
function readChecked(name: string): Record<string, unknown> {
  const text = readText(`${ROOT}/${name}.json`);
  const recorded = readText(`${ROOT}/${name}.sha256`).trim().split(/\s+/u)[0];
  expect(sha256HexSync(text), `${name}.json does not match its committed sidecar`).toBe(recorded);
  return JSON.parse(text) as Record<string, unknown>;
}

describe("far-tier runtime records", () => {
  it("every record matches its sidecar", () => {
    for (const name of ["stage-0-picking-spike", "payload-inventory", "runtime-record"]) {
      expect(readChecked(name)).toBeTypeOf("object");
    }
  });

  it("the payload inventory is derived from committed text, not from a payload directory", () => {
    const inventory = readChecked("payload-inventory") as { derivedFrom: { record: string; recordSha256: string }; entries: Array<{ cellId: string; glbSha256: string; members: unknown[] }> };
    // Re-derive the source record's digest here, so a drifted provenance record
    // fails this gate instead of being trusted.
    const sourceText = readText(inventory.derivedFrom.record);
    expect(sha256HexSync(sourceText)).toBe(inventory.derivedFrom.recordSha256);
    expect(inventory.entries).toHaveLength(1);
    expect(inventory.entries[0]!.cellId).toBe("manhattan-exterior-cell-w05-000747-17-38610-35822");
    expect(inventory.entries[0]!.glbSha256).toBe("2f8599256ac45ee509dc7d7ce0da6a56964bac8e3ca66b77e795c1435ff7930b");
    expect(inventory.entries[0]!.members).toHaveLength(48);
  });

  it("keeps the far tier's cache out of the closed criterion #30", () => {
    const record = readChecked("runtime-record") as { servingPath: { cache: { maxCachedBytes: number; additive: string }; criterion30Isolation: string } };
    expect(record.servingPath.cache.maxCachedBytes).toBe(FAR_TIER_RUNTIME_BUDGETS.maxCachedBytes);
    expect(record.servingPath.cache.additive).toContain("never merged");
    // And the neighbour it must not touch has not moved.
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes).toBe(256 * 1024 * 1024);
  });

  it("describes the cache as what the code does, and names what it does NOT do", () => {
    // The finding this pins: the record claimed "its own cache with its own
    // ceiling and its own accounting" while the constant had zero non-test
    // consumers. A record must never claim what the code does not do — and the
    // eviction policy that is still missing has to be named, not implied away.
    const record = readChecked("runtime-record") as { servingPath: { cache: Record<string, string> } };
    const cache = record.servingPath.cache;
    expect(cache.whatIsImplemented).toContain("bounded by the SAME distance predicate");
    expect(cache.whatIsImplemented).toContain("BEFORE the fetch");
    expect(cache.whatIsNOTImplemented).toContain("NO EVICTION POLICY");
    expect(cache.whatIsNOTImplemented).toContain("DEFERRED TO MASS-BAKE SCALE");
    // T005 DISCHARGES that deferral by analysis rather than by a policy; the
    // T003 record still records the deferral it made, which was true then.
    expect(cache.correctionRecorded).toContain("ZERO NON-TEST CONSUMERS");
  });

  it("pins the PROMOTED inventory's digest in shipped code", () => {
    // The staged copy is gitignored operator work product. Without this pin a
    // swapped staged file declares its own checksums and every per-tile check
    // faithfully confirms them.
    //
    // T005 moved the pin from the one-cell T003 inventory to the promoted
    // 840-cell one, so this re-derivation follows it to the new file. Pointing
    // it at the old file would leave the shipped constant unchecked against
    // anything the runtime actually fetches.
    const committed = readText("data/far-tier-hlod-promotion-20260819/promoted-inventory.json");
    expect(sha256HexSync(committed)).toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256);
  });

  it("keeps the T003 record naming the pin T003 shipped, and the predecessor constant agreeing with it", () => {
    // The T003 runtime record is frozen evidence of what T003 pinned. It is NOT
    // rewritten to name a digest T003 never shipped; the supersession lives on
    // the constant and in the T005 activation record.
    const record = readChecked("runtime-record") as { servingPath: { inventoryPin: { digest: string; failDirection: string } } };
    expect(record.servingPath.inventoryPin.digest).toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSOR);
    expect(record.servingPath.inventoryPin.failDirection).toContain("WHOLE TIER");
    expect(sha256HexSync(readText(`${ROOT}/payload-inventory.json`))).toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSOR);
    expect(FAR_TIER_PAYLOAD_INVENTORY_SHA256).not.toBe(FAR_TIER_PAYLOAD_INVENTORY_SHA256_PREDECESSOR);
  });

  it("records that BOTH payloads are verified, and what an atlas mismatch does", () => {
    const record = readChecked("runtime-record") as { servingPath: { verification: Record<string, string> } };
    expect(record.servingPath.verification.statement).toContain("BOTH PAYLOADS ARE VERIFIED");
    expect(record.servingPath.verification.onAtlasMismatch).toContain("fails closed as checksum-mismatch");
    expect(record.servingPath.verification.onAtlasAbsence).toContain("not a mismatch");
  });

  it("records the pick Cesium performs that this repository cannot scan for", () => {
    const record = readChecked("runtime-record") as { pickingMechanism: { cesiumOwnPick: { finding: string; fix: string } } };
    expect(record.pickingMechanism.cesiumOwnPick.finding).toContain("pickAndTrackObject");
    expect(record.pickingMechanism.cesiumOwnPick.fix).toContain("removes that input action");
  });

  it("keeps the state vocabulary in the record identical to the code's", () => {
    const record = readChecked("runtime-record") as { explicitState: { states: string[]; buildFailureIsNotMismatch: string; declaredMeansTheInventory: string } };
    expect(record.explicitState.states).toEqual([...FAR_TIER_CELL_STATES]);
    // checksum-mismatch must mean exactly "the bytes differ from what was declared".
    expect(record.explicitState.buildFailureIsNotMismatch).toContain("its own state");
    expect(record.explicitState.declaredMeansTheInventory).toContain("INVENTORY'S OWN COUNT");
  });

  it("records the rebuild contract the far-tier alpha lost once", () => {
    const record = readChecked("runtime-record") as { suppression: { mechanism: { rebuildContract: { defect: string; fix: string } } } };
    expect(record.suppression.mechanism.rebuildContract.defect).toContain("NEVER HEALS");
    expect(record.suppression.mechanism.rebuildContract.fix).toContain("all three sites");
  });

  it("records the readiness gate and does not claim it was measured", () => {
    const record = readChecked("runtime-record") as { doubleResidency: { ordering: string; readinessGateCorrection: string } };
    expect(record.doubleResidency.ordering).toContain("reports `ready`");
    expect(record.doubleResidency.readinessGateCorrection).toContain("found by reading");
  });

  it("records that the distance rule bounds LOADING, not only drawing", () => {
    const record = readChecked("runtime-record") as { distanceSelection: { itBoundsLOADINGToo: string; retryPolicy: string } };
    expect(record.distanceSelection.itBoundsLOADINGToo).toContain("EVERY declared cell");
    expect(record.distanceSelection.retryPolicy).toContain("ONCE per in-range episode");
  });

  it("records the re-run arms, including what they did NOT cover", () => {
    // The two states no session has ever reached must not be allowed to read as
    // validated by a run that never produced them.
    const record = readChecked("runtime-record") as { endToEndValidation: { reviewFixArms: Record<string, string> } };
    const arms = record.endToEndValidation.reviewFixArms;
    expect(arms.distanceBoundedLoading).toContain("no .far_0.glb");
    expect(arms.defaultSessionUnchanged).toContain("ZERO far-tier network requests");
    expect(arms.notCovered).toContain("BUILD-FAILURE AND OVER-BUDGET STATES WERE NOT REACHED");
    expect(arms.notCovered).toContain("fixture only");
  });

  it("records that the status line stopped being a live region", () => {
    const record = readChecked("runtime-record") as { explicitState: { notALiveRegion: { correction: string; replacement: string } } };
    expect(record.explicitState.notALiveRegion.correction).toContain("role=status AND IT IS NOT ANY MORE");
    expect(record.explicitState.notALiveRegion.replacement).toContain("data-far-tier-");
  });

  it("records Route D, the rejected allowPicking finding, and the discarded Route E", () => {
    // The next Cesium upgrade needs to know why the bracket exists.
    const record = readChecked("runtime-record") as { pickingMechanism: Record<string, { sourceCitation?: string; whyRejected?: string; warning?: string }> & { headline: string } };
    expect(record.pickingMechanism.headline).toContain("ROUTE D");
    expect(record.pickingMechanism.rejected_allowPicking!.sourceCitation).toContain("index.js:48744-48765");
    expect(record.pickingMechanism.rejected_routeE!.whyRejected).toContain("cannot self-occlude");
    expect(record.pickingMechanism.alphaCutoff!.warning).toContain("DESTROYS FAR-RANGE PICKING");
  });

  it("states the placement residual as a measured number", () => {
    const record = readChecked("runtime-record") as { placement: { residualMeasurement: { residualMeters: number }; renderBoundsRefused: string } };
    expect(record.placement.residualMeasurement.residualMeters).toBeCloseTo(0.0811, 4);
    expect(record.placement.renderBoundsRefused).toContain("WRONG BY CONSTRUCTION");
  });

  it("discloses the open appearance defects and the missing floor", () => {
    // "Validated end to end" must never be allowed to read as visual acceptance.
    const record = readChecked("runtime-record") as { disclosures: string[]; whatIsNotDone: string[] };
    const disclosures = record.disclosures.join(" ");
    expect(disclosures).toContain("0.939");
    expect(disclosures).toContain("5 of 6 sampled hues");
    expect(disclosures).toContain("NO FLOOR");
    expect(disclosures).toContain("Nothing here is visual acceptance");
    // And the gaps that REMAIN are recorded rather than implied. End-to-end is
    // now met, so this pins the honest remainder instead of the old caveat.
    const notDone = record.whatIsNotDone.join(" ");
    expect(notDone).toContain("ONE CELL, NOT A RING");
    expect(notDone).toContain("FIXTURE-ONLY");
    expect(notDone).toContain("NO GPU MEASUREMENT");
    // The gaps the review fixes did NOT close are named alongside the old ones.
    expect(notDone).toContain("NO EVICTION POLICY");
    expect(notDone).toContain("THE READINESS GATE IS UNOBSERVED");
    expect(disclosures).toContain("NEVER BEEN REACHED OUTSIDE A FIXTURE");
  });

  it("records the end-to-end run against the real prototype tile", () => {
    const record = readChecked("runtime-record") as { endToEndValidation: { pickingUnchanged: { farTierOn: string; farTierOff: string; verdict: string }; fallbackArms: Record<string, string> } };
    // The contract's central requirement, as a measured pair rather than a claim.
    expect(record.endToEndValidation.pickingUnchanged.farTierOn).toBe("doitt:119910");
    expect(record.endToEndValidation.pickingUnchanged.farTierOff).toBe("doitt:119910");
    expect(record.endToEndValidation.pickingUnchanged.verdict).toContain("IDENTICAL");
    expect(record.endToEndValidation.fallbackArms.checksumMismatch).toContain("checksum-mismatch (fail-closed, drawing massing)");
    // Absence and mismatch stay two different sentences about two different arms.
    expect(record.endToEndValidation.fallbackArms.absent).toContain("1 absent");
    expect(record.endToEndValidation.fallbackArms.absent).not.toContain("checksum-mismatch");
    // The arm that proves the atlas is verified, run against the real tile.
    expect(record.endToEndValidation.fallbackArms.atlasMismatch).toContain(".atlas.png");
    expect(record.endToEndValidation.fallbackArms.forgedInventory).toContain("0 declared");
  });

  it("records that far-tier massing is hidden by alpha, not by show", () => {
    const record = readChecked("runtime-record") as { suppression: { mechanism: { attribute: string; defectFound: string } } };
    expect(record.suppression.mechanism.attribute).toContain("never the `show` attribute");
    expect(record.suppression.mechanism.defectFound).toContain("SHIPPED WRONG FOR ONE REVISION");
  });

  it("records the distance selection, its metric and its unmeasured band", () => {
    const record = readChecked("runtime-record") as {
      distanceSelection: { metric: { id: string; limitation: string }; thresholds: { enterMeters: number; exitMeters: number; bandProvenance: string }; nearIsNotAFailure: string };
      endToEndValidation: { distanceGating: { farPose: { line: string }; nearPose: { line: string; clicked: string } } };
    };
    expect(record.distanceSelection.metric.id).toBe("nearest-point-of-tile-rectangle-plus-camera-height");
    expect(record.distanceSelection.thresholds.enterMeters).toBe(1_200);
    expect(record.distanceSelection.thresholds.exitMeters).toBe(1_080);
    // The band must never be mistaken for evidence.
    expect(record.distanceSelection.thresholds.bandProvenance).toContain("NOT A MEASURED ONE");
    expect(record.distanceSelection.metric.limitation).toContain("BUILDING HEIGHT IS NOT MODELLED");
    expect(record.distanceSelection.nearIsNotAFailure).toContain("never with");
    // And the near pose is recorded as massing restored with picking intact.
    expect(record.endToEndValidation.distanceGating.farPose.line).toContain("1 drawn");
    expect(record.endToEndValidation.distanceGating.nearPose.line).toContain("1 near (massing drawing)");
    expect(record.endToEndValidation.distanceGating.nearPose.clicked).toBe("doitt:119910");
  });

  it("labels the double-residency figure as arithmetic, not a GPU reading", () => {
    const record = readChecked("runtime-record") as { doubleResidency: { labelling: string } };
    expect(record.doubleResidency.labelling).toContain("ARITHMETIC, NOT A GPU READING");
  });
});
