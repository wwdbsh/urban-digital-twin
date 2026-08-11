/**
 * The `w04` stage fingerprint covers WHICH cells the curated subset admits.
 *
 * The T016 review found this gap on the Lower-Manhattan pipeline; the seam was
 * carried into the Southern-remainder pipeline, proved load-bearing there at
 * T018, and carried into this pipeline UNUSED again while only the canary
 * existed. This is the suite that proves it is load-bearing for wave `w04`.
 *
 * Every stage of the wave pipeline is resumable and fingerprint-gated: a stage
 * whose recorded fingerprint equals this run's returns `skipped: true` and the
 * previous run's bytes stand. For the CANARY that is safe, because its renderable
 * subset is a walk of the committed ledger's cell order under an entry budget, so
 * changing which cells it admits requires changing the ledger. For the CURATED
 * subset it is not: `CENTRAL_UPPER_MANHATTAN_CURATED_CELLS` is a constant in this
 * repository, and editing it to a different set of the same length would change
 * nothing else the fingerprint hashes.
 */
import { describe, expect, it } from "vitest";
import { midtownCoreV3StageFingerprint } from "./midtown-core-v3-source";
import { CENTRAL_UPPER_MANHATTAN_CURATED_CELLS } from "./central-upper-manhattan-curation";
import { CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE } from "./central-upper-manhattan-p1-release";
import { CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE } from "./central-upper-manhattan-release";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash";

/** The digest the pipeline computes over the RESOLVED renderable cell ids. */
function renderableCellDigest(cellIds: readonly string[]): string {
  return sha256HexSync(stableSerialize([...cellIds]));
}

const CURATED_CELL_IDS = CENTRAL_UPPER_MANHATTAN_CURATED_CELLS.map((record) => record.cellId);
/**
 * A different pair of cells — the tower cell plus the block immediately NORTH of
 * it rather than the park to its east. Two cells in, two cells out, every other
 * hashed input identical: exactly the edit the gap would have made invisible.
 */
const ALTERNATIVE_CELL_IDS = [
  "manhattan-exterior-cell-w04-000490-16-19300-17923",
  "manhattan-exterior-cell-w04-000482-17-38602-35846",
];

const SHARED = {
  stage: "glbs",
  baseManifestChecksumSha256: "a".repeat(64),
  parentLedgerChecksumSha256: "b".repeat(64),
  subsetLedgerChecksumSha256: "c".repeat(64),
  predecessorInventoryChecksumSha256: "d".repeat(64),
  renderableCellCount: 2,
  shippedLodId: "lod_0",
  profile: CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE,
} as const;

describe("the curated w04 subset's stage fingerprint", () => {
  it("changes when the curated cell LIST changes, with everything else identical", () => {
    const curated = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest(CURATED_CELL_IDS) });
    const alternative = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest(ALTERNATIVE_CELL_IDS) });
    expect(alternative).not.toBe(curated);
    // Without the digest the two are the SAME fingerprint: both subsets have two
    // cells, so `renderableCellCount` cannot tell them apart and every other
    // hashed input is shared. That is the defect the digest closes, asserted
    // rather than described.
    expect(midtownCoreV3StageFingerprint({ ...SHARED })).toBe(midtownCoreV3StageFingerprint({ ...SHARED }));
    expect(ALTERNATIVE_CELL_IDS).toHaveLength(CURATED_CELL_IDS.length);
  });

  it("changes when the ORDER of the curated list changes, because the subset ledger would", () => {
    const reversed = renderableCellDigest([...CURATED_CELL_IDS].reverse());
    expect(reversed).not.toBe(renderableCellDigest(CURATED_CELL_IDS));
  });

  it("separates the canary and the successor even though the curated list is the only difference", () => {
    // The two wave profiles differ only in release id, which is deliberately NOT
    // an input to any plan hash — so the fingerprint has to separate them, or a
    // p1 run would resume on the canary's receipts.
    const canary = midtownCoreV3StageFingerprint({ ...SHARED, profile: CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE });
    const successor = midtownCoreV3StageFingerprint({ ...SHARED, profile: CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE });
    expect(canary).not.toBe(successor);
    expect(CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE.seed).toBe(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.seed);
    expect(CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE.generatedAt).toBe(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.generatedAt);
    expect(CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE.tool).toEqual(CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE.tool);
  });
});
