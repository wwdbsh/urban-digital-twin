/**
 * Two-wave attribution regressions, additive to `App.test.tsx`.
 *
 * These pin the two rules a running session depends on and that a screenshot
 * would not catch:
 *
 * 1. The details panel attributes a selection to the wave that actually
 *    rendered it, in either direction, within one session.
 * 2. The aggregated bounded-availability line is attributed to the release that
 *    produced it, in its exact shipped form.
 *
 * They are pure-function tests, and they deliberately do NOT import `App`. A
 * second test file that merely imports the application module pulls its whole
 * Cesium-bearing graph into another worker and intermittently fails a
 * timing-sensitive focus test already in `App.test.tsx` (measured at roughly
 * one run in four, with a file whose own body was a single trivial assertion).
 * That test may not be modified here, so the rules under test live in their own
 * module instead. End-to-end behaviour stays covered by `App.test.tsx` and by
 * the recorded renderer journeys; the records driving these cases are the
 * COMMITTED ones, so they run on a fresh clone with no payload present.
 */
import { describe, expect, it } from "vitest";
import { exteriorNotShippedSummary, exteriorQualifiedNotice, exteriorWaveForSelection } from "./exterior-wave-attribution";
import { EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION, type ExteriorDefaultActivationEnabled } from "./exterior-default-activation";
import type { ExteriorCellOutcome } from "./exterior-cell-runtime";

const block835 = EXTERIOR_DEFAULT_ACTIVATION as ExteriorDefaultActivationEnabled;
const midtown = MIDTOWN_CORE_EXTERIOR_ACTIVATION as ExteriorDefaultActivationEnabled;

const BLOCK835_PICK = "doitt:778052";
const MIDTOWN_PICK = "doitt:105916";
const MIDTOWN_CELL_ID = "manhattan-exterior-cell-w01-000001-14-4823-4482";

function rendered(cellId: string, cellReleaseId: string, canonicalFeatureId: string): ExteriorCellOutcome {
  return {
    kind: "rendered",
    cellId,
    cellReleaseId,
    cellReleaseVersion: "v1",
    assemblyPackageId: `assembly:${cellReleaseId}`,
    representation: "head",
    assets: [{ canonicalFeatureId, lodId: "lod_0", checksumSha256: "b".repeat(64), byteSize: 4, bytes: new Uint8Array([1]), geometricErrorMeters: 0, provenance: {} }],
    notice: null,
  } as unknown as ExteriorCellOutcome;
}

function notShipped(cellId: string, cellReleaseId: string): ExteriorCellOutcome {
  return {
    kind: "not-shipped",
    cellId,
    cellReleaseId,
    unavailableBuildingCount: 48,
    notice: `Exterior cell ${cellId} ships no exterior geometry in this release; no substitute was selected.`,
  } as unknown as ExteriorCellOutcome;
}

/** The two promoted waves as the panel sees them: release id plus outcomes. */
const block835Wave = {
  releaseId: block835.releaseId,
  outcomes: [rendered(block835.membership.cells[0]!.cellId, block835.membership.cells[0]!.cellReleaseId, BLOCK835_PICK)],
};
const midtownWave = {
  releaseId: midtown.releaseId,
  outcomes: [rendered(MIDTOWN_CELL_ID, `cell-release:${midtown.releaseId}:${MIDTOWN_CELL_ID}:v1`, MIDTOWN_PICK)],
};
const bothWaves = [block835Wave, midtownWave];

describe("details-panel attribution follows the selected feature's wave", () => {
  it("names the Midtown wave for a Midtown building and Block 835 for an ESB-block building", () => {
    // Both directions, against the SAME streaming set: attributing to the
    // leading wave would pass one of these and fail the other.
    expect(exteriorWaveForSelection(bothWaves, MIDTOWN_PICK)?.releaseId).toBe(midtown.releaseId);
    expect(exteriorWaveForSelection(bothWaves, BLOCK835_PICK)?.releaseId).toBe(block835.releaseId);
    // Order of the promoted set must not decide the answer.
    expect(exteriorWaveForSelection([...bothWaves].reverse(), MIDTOWN_PICK)?.releaseId).toBe(midtown.releaseId);
    expect(exteriorWaveForSelection([...bothWaves].reverse(), BLOCK835_PICK)?.releaseId).toBe(block835.releaseId);
  });

  it("attributes nothing when several waves stream and the selection is in none of them", () => {
    // A selection with no exterior representation cannot be attributed to one
    // of two streaming waves without guessing, so it attributes to neither.
    expect(exteriorWaveForSelection(bothWaves, "doitt:999999")).toBeNull();
    expect(exteriorWaveForSelection(bothWaves, null)).toBeNull();
  });

  it("falls back to the sole wave of a single-wave session", () => {
    // Preserves the pre-multi-wave panel: one streaming wave still names itself
    // even when the selection has no exterior representation.
    expect(exteriorWaveForSelection([block835Wave], "doitt:999999")?.releaseId).toBe(block835.releaseId);
    expect(exteriorWaveForSelection([block835Wave], null)?.releaseId).toBe(block835.releaseId);
    expect(exteriorWaveForSelection([], MIDTOWN_PICK)).toBeNull();
  });
});

describe("aggregated bounded-availability notice attribution", () => {
  it("attributes the tombstone line to the release that produced it, in its shipped form", () => {
    // 146 of the Midtown wave's 149 cells deliberately ship nothing (ADR 0029),
    // and the aggregate line must name the Midtown release rather than reading
    // as if the leading wave had shipped nothing.
    const cells = [
      midtownWave.outcomes[0]!,
      ...Array.from({ length: 146 }, (_, index) => notShipped(`midtown-cell-${index}`, `cell-release:${midtown.releaseId}:midtown-cell-${index}:v1`)),
    ];
    const line = exteriorQualifiedNotice(midtown.releaseId, exteriorNotShippedSummary(cells)!);
    expect(line).toBe(`Exterior release ${midtown.releaseId}: 146 of 147 exterior cells ship no exterior geometry in this release; no substitute was selected for them.`);
    expect(line).not.toContain(block835.releaseId);
    // A wave that ships every cell contributes no aggregate line at all.
    expect(exteriorNotShippedSummary(block835Wave.outcomes)).toBeNull();
    // One not-shipped cell states itself rather than being aggregated.
    expect(exteriorNotShippedSummary([notShipped("solo", "cell-release:solo:v1")]))
      .toBe("Exterior cell solo ships no exterior geometry in this release; no substitute was selected.");
  });

  it("keeps two waves' identical notices distinguishable", () => {
    // The reason qualification is unconditional: the same text from two waves
    // must not collapse into one indistinguishable line.
    const shared = "146 of 147 exterior cells ship no exterior geometry in this release; no substitute was selected for them.";
    const lines = [exteriorQualifiedNotice(block835.releaseId, shared), exteriorQualifiedNotice(midtown.releaseId, shared)];
    expect(new Set(lines).size).toBe(2);
    expect(lines[0]).toContain(block835.releaseId);
    expect(lines[1]).toContain(midtown.releaseId);
  });
});
