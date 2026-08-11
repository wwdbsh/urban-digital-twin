/**
 * The stage fingerprint covers WHICH cells a curated subset admits, not merely
 * how many.
 *
 * Every stage of the wave pipeline is resumable and fingerprint-gated: a stage
 * whose recorded fingerprint equals this run's returns `skipped: true` and the
 * previous run's bytes stand. That is safe exactly as long as the fingerprint
 * covers everything the stage's output depends on.
 *
 * For the CANARY it did. Its renderable subset is a walk of the committed wave
 * ledger's cell order under an entry budget, so changing which cells it admits
 * requires changing the ledger, and `subsetLedgerChecksumSha256` moves with it.
 *
 * For the CURATED subset it did NOT. `LOWER_MANHATTAN_CURATED_CELLS` is a
 * constant in this repository. Editing it to a different pair of cells of the
 * same length changed nothing else the fingerprint hashed — not the ledger, not
 * the base manifest, not the predecessor inventory, not the profile, and not
 * `renderableCellCount` — so `plans` and `glbs` would have reported
 * `skipped: true` and the emitted release would have kept the PREVIOUS
 * curation's assets while its committed record described the new one.
 *
 * The fix is `renderableCellDigestSha256`, and these are the tests that fail
 * without it.
 */
import { describe, expect, it } from "vitest";
import { midtownCoreV3StageFingerprint } from "./midtown-core-v3-source";
import { LOWER_MANHATTAN_CURATED_CELLS } from "./lower-manhattan-curation";
import { LOWER_MANHATTAN_P1_WAVE_PROFILE } from "./lower-manhattan-p1-release";
import { LOWER_MANHATTAN_WAVE_PROFILE } from "./lower-manhattan-release";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash";

/** The digest the pipeline computes over the RESOLVED renderable cell ids. */
function renderableCellDigest(cellIds: readonly string[]): string {
  return sha256HexSync(stableSerialize([...cellIds]));
}

const CURATED_CELL_IDS = LOWER_MANHATTAN_CURATED_CELLS.map((record) => record.cellId);
/**
 * A different pair of Financial District cells of the SAME LENGTH. This is the
 * edit the gap made invisible: two cells in, two cells out, every other hashed
 * input identical.
 */
const ALTERNATIVE_CELL_IDS = [
  "manhattan-exterior-cell-w02-000162-16-19294-17946",
  "manhattan-exterior-cell-w02-000179-16-19296-17945",
];

const SHARED = {
  stage: "glbs",
  baseManifestChecksumSha256: "a".repeat(64),
  parentLedgerChecksumSha256: "b".repeat(64),
  subsetLedgerChecksumSha256: "c".repeat(64),
  predecessorInventoryChecksumSha256: "d".repeat(64),
  renderableCellCount: 2,
  shippedLodId: "lod_0",
  profile: LOWER_MANHATTAN_P1_WAVE_PROFILE,
} as const;

describe("the curated subset's stage fingerprint", () => {
  it("changes when the curated cell LIST changes, with everything else identical", () => {
    const curated = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest(CURATED_CELL_IDS) });
    const alternative = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest(ALTERNATIVE_CELL_IDS) });
    expect(alternative).not.toBe(curated);
    // Without the digest the two are the SAME fingerprint, which is the defect:
    // both subsets have two cells, so `renderableCellCount` cannot tell them
    // apart and every resumable stage would have reported `skipped: true`.
    expect(midtownCoreV3StageFingerprint(SHARED)).toBe(midtownCoreV3StageFingerprint(SHARED));
    expect(curated).not.toBe(midtownCoreV3StageFingerprint(SHARED));
  });

  it("changes when the ORDER of the same cells changes, because the emitted bytes do", () => {
    const forward = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest(CURATED_CELL_IDS) });
    const reversed = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest([...CURATED_CELL_IDS].reverse()) });
    expect(reversed).not.toBe(forward);
  });

  it("is stable for the same curated list, so a resumed run still resumes", () => {
    const first = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest(CURATED_CELL_IDS) });
    const second = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest([...CURATED_CELL_IDS]) });
    expect(second).toBe(first);
  });

  it("leaves a DERIVED subset's fingerprint byte-identical, so the canary cannot be forced to rebuild", () => {
    // The canary supplies no digest, because its subset is a pure function of
    // inputs this fingerprint already hashes. Omitting the field must emit no
    // key at all, or every committed wave's stage receipts would invalidate.
    const canary = { ...SHARED, profile: LOWER_MANHATTAN_WAVE_PROFILE };
    const withoutField = midtownCoreV3StageFingerprint(canary);
    const withUndefined = midtownCoreV3StageFingerprint({ ...canary, renderableCellDigestSha256: undefined });
    expect(withUndefined).toBe(withoutField);
    // And a supplied digest genuinely changes it, so the omission is a choice
    // rather than a field that never mattered.
    expect(midtownCoreV3StageFingerprint({ ...canary, renderableCellDigestSha256: renderableCellDigest(CURATED_CELL_IDS) })).not.toBe(withoutField);
  });
});
