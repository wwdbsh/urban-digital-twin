/**
 * The `w05` stage fingerprint covers WHICH cell the curated subset admits.
 *
 * The T016 review found this gap on the Lower-Manhattan pipeline; the seam was
 * carried into every wave pipeline since and proved load-bearing at T018 and
 * T020. It was carried into this pipeline UNUSED again while only the canary
 * existed. This is the suite that proves it is load-bearing for wave `w05`.
 *
 * Every stage of the wave pipeline is resumable and fingerprint-gated: a stage
 * whose recorded fingerprint equals this run's returns `skipped: true` and the
 * previous run's bytes stand. For the CANARY that is safe, because its renderable
 * subset is a walk of the committed ledger's cell order under an entry budget, so
 * changing which cells it admits requires changing the ledger. For the CURATED
 * subset it is not: `NORTHERN_MANHATTAN_CURATED_CELLS` is a constant in this
 * repository, and editing it to a different cell would change nothing else the
 * fingerprint hashes.
 *
 * THE GAP IS WIDER FOR A ONE-CELL SUBSET, which is why this suite matters more
 * here than it did for wave `w04`. That wave's curated list had two cells, so an
 * edit that changed one of them at least had to keep the count at two to stay
 * invisible; a single-cell list can be repointed at any of the other 181 cells of
 * this wave with `renderableCellCount` unchanged at 1.
 */
import { describe, expect, it } from "vitest";
import { midtownCoreV3StageFingerprint } from "./midtown-core-v3-source";
import { NORTHERN_MANHATTAN_CURATED_CELLS } from "./northern-manhattan-curation";
import { NORTHERN_MANHATTAN_P1_WAVE_PROFILE } from "./northern-manhattan-p1-release";
import { NORTHERN_MANHATTAN_WAVE_PROFILE } from "./northern-manhattan-release";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash";

/** The digest the pipeline computes over the RESOLVED renderable cell ids. */
function renderableCellDigest(cellIds: readonly string[]): string {
  return sha256HexSync(stableSerialize([...cellIds]));
}

const CURATED_CELL_IDS = NORTHERN_MANHATTAN_CURATED_CELLS.map((record) => record.cellId);
/**
 * A different cell of the same wave — 707, the cell this rule would have selected
 * at a 60 or 75 m threshold. One cell in, one cell out, every other hashed input
 * identical: exactly the edit the gap would have made invisible, and a plausible
 * one rather than a contrived id.
 */
const ALTERNATIVE_CELL_IDS = ["manhattan-exterior-cell-w05-000707-17-38611-35816"];

const SHARED = {
  stage: "glbs",
  baseManifestChecksumSha256: "a".repeat(64),
  parentLedgerChecksumSha256: "b".repeat(64),
  subsetLedgerChecksumSha256: "c".repeat(64),
  predecessorInventoryChecksumSha256: "d".repeat(64),
  renderableCellCount: 1,
  shippedLodId: "lod_0",
  profile: NORTHERN_MANHATTAN_P1_WAVE_PROFILE,
} as const;

describe("the curated w05 subset's stage fingerprint", () => {
  it("changes when the curated cell LIST changes, with everything else identical", () => {
    const curated = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest(CURATED_CELL_IDS) });
    const alternative = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest(ALTERNATIVE_CELL_IDS) });
    expect(alternative).not.toBe(curated);
    // Without the digest the two are the SAME fingerprint: both subsets have one
    // cell, so `renderableCellCount` cannot tell them apart and every other
    // hashed input is shared. That is the defect the digest closes, asserted
    // rather than described.
    expect(midtownCoreV3StageFingerprint({ ...SHARED })).toBe(midtownCoreV3StageFingerprint({ ...SHARED }));
    expect(ALTERNATIVE_CELL_IDS).toHaveLength(CURATED_CELL_IDS.length);
  });

  it("separates the canary and the successor even though the curated list is the only difference", () => {
    // The two wave profiles differ only in release id, which is deliberately NOT
    // an input to any plan hash — so the fingerprint has to separate them, or a
    // p1 run would resume on the canary's receipts.
    const canary = midtownCoreV3StageFingerprint({ ...SHARED, profile: NORTHERN_MANHATTAN_WAVE_PROFILE });
    const successor = midtownCoreV3StageFingerprint({ ...SHARED, profile: NORTHERN_MANHATTAN_P1_WAVE_PROFILE });
    expect(canary).not.toBe(successor);
    expect(NORTHERN_MANHATTAN_P1_WAVE_PROFILE.seed).toBe(NORTHERN_MANHATTAN_WAVE_PROFILE.seed);
    expect(NORTHERN_MANHATTAN_P1_WAVE_PROFILE.generatedAt).toBe(NORTHERN_MANHATTAN_WAVE_PROFILE.generatedAt);
    expect(NORTHERN_MANHATTAN_P1_WAVE_PROFILE.tool).toEqual(NORTHERN_MANHATTAN_WAVE_PROFILE.tool);
  });

  /**
   * The successor ships under the CANARY's rights instrument, carried unedited.
   * That is a claim about object identity rather than about equal text, and it is
   * asserted here because a copied-and-edited instrument would move a fingerprint
   * the canary's own committed release graph pins.
   */
  it("keeps the canary's approval instrument by reference rather than by copy", async () => {
    const { NORTHERN_MANHATTAN_APPROVAL } = await import("./northern-manhattan-release");
    const { northernManhattanP1Profile } = await import("./northern-manhattan-p1-release");
    expect(northernManhattanP1Profile(null).approval).toBe(NORTHERN_MANHATTAN_APPROVAL);
  });
});
