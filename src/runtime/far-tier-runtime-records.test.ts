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
import { FAR_TIER_RUNTIME_BUDGETS } from "./far-tier-serving";
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
    expect(notDone).toContain("NO DISTANCE GATING");
    expect(notDone).toContain("FIXTURE-ONLY");
    expect(notDone).toContain("NO GPU MEASUREMENT");
  });

  it("records the end-to-end run against the real prototype tile", () => {
    const record = readChecked("runtime-record") as { endToEndValidation: { pickingUnchanged: { farTierOn: string; farTierOff: string; verdict: string }; fallbackArms: Record<string, string> } };
    // The contract's central requirement, as a measured pair rather than a claim.
    expect(record.endToEndValidation.pickingUnchanged.farTierOn).toBe("doitt:119910");
    expect(record.endToEndValidation.pickingUnchanged.farTierOff).toBe("doitt:119910");
    expect(record.endToEndValidation.pickingUnchanged.verdict).toContain("IDENTICAL");
    expect(record.endToEndValidation.fallbackArms.checksumMismatch).toContain("never as absence");
  });

  it("records that far-tier massing is hidden by alpha, not by show", () => {
    const record = readChecked("runtime-record") as { suppression: { mechanism: { attribute: string; defectFound: string } } };
    expect(record.suppression.mechanism.attribute).toContain("never the `show` attribute");
    expect(record.suppression.mechanism.defectFound).toContain("SHIPPED WRONG FOR ONE REVISION");
  });

  it("labels the double-residency figure as arithmetic, not a GPU reading", () => {
    const record = readChecked("runtime-record") as { doubleResidency: { labelling: string } };
    expect(record.doubleResidency.labelling).toContain("ARITHMETIC, NOT A GPU READING");
  });
});
