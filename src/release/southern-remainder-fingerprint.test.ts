/**
 * The `w03` stage fingerprint covers WHICH cells the curated subset admits.
 *
 * The T016 review found this gap on the Lower-Manhattan pipeline and the seam
 * was carried into the Southern-remainder pipeline UNUSED, waiting for a curated
 * variant. This is the suite that proves the seam is now load-bearing rather
 * than decorative.
 *
 * Every stage of the wave pipeline is resumable and fingerprint-gated: a stage
 * whose recorded fingerprint equals this run's returns `skipped: true` and the
 * previous run's bytes stand. For the CANARY that is safe, because its renderable
 * subset is a walk of the committed ledger's cell order under an entry budget,
 * so changing which cells it admits requires changing the ledger. For the CURATED
 * subset it is not: `SOUTHERN_REMAINDER_CURATED_CELLS` is a constant in this
 * repository, and editing it to a different set of the same length would change
 * nothing else the fingerprint hashes.
 */
import { describe, expect, it } from "vitest";
import { midtownCoreV3StageFingerprint } from "./midtown-core-v3-source";
import { SOUTHERN_REMAINDER_CURATED_CELLS } from "./southern-remainder-curation";
import { SOUTHERN_REMAINDER_P1_WAVE_PROFILE } from "./southern-remainder-p1-release";
import { SOUTHERN_REMAINDER_WAVE_PROFILE } from "./southern-remainder-release";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash";

/** The digest the pipeline computes over the RESOLVED renderable cell ids. */
function renderableCellDigest(cellIds: readonly string[]): string {
  return sha256HexSync(stableSerialize([...cellIds]));
}

const CURATED_CELL_IDS = SOUTHERN_REMAINDER_CURATED_CELLS.map((record) => record.cellId);
/**
 * A different set of FOUR envelope cells — the enumeration's connected-runner-up
 * shape. Four cells in, four cells out, every other hashed input identical:
 * exactly the edit the gap would have made invisible.
 */
const ALTERNATIVE_CELL_IDS = [
  "manhattan-exterior-cell-w03-000378-17-38596-35864",
  "manhattan-exterior-cell-w03-000379-17-38597-35864",
  "manhattan-exterior-cell-w03-000385-17-38596-35865",
  "manhattan-exterior-cell-w03-000387-17-38598-35865",
];

const SHARED = {
  stage: "glbs",
  baseManifestChecksumSha256: "a".repeat(64),
  parentLedgerChecksumSha256: "b".repeat(64),
  subsetLedgerChecksumSha256: "c".repeat(64),
  predecessorInventoryChecksumSha256: "d".repeat(64),
  renderableCellCount: 4,
  shippedLodId: "lod_0",
  profile: SOUTHERN_REMAINDER_P1_WAVE_PROFILE,
} as const;

describe("the curated w03 subset's stage fingerprint", () => {
  it("changes when the curated cell LIST changes, with everything else identical", () => {
    const curated = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest(CURATED_CELL_IDS) });
    const alternative = midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: renderableCellDigest(ALTERNATIVE_CELL_IDS) });
    expect(alternative).not.toBe(curated);
    // Without the digest the two are the SAME fingerprint: both subsets have
    // four cells, so `renderableCellCount` cannot tell them apart and every
    // resumable stage would have reported `skipped: true` on the previous
    // curation's bytes.
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

  it("leaves the w03 CANARY's fingerprint byte-identical, so it cannot be forced to rebuild", () => {
    // The canary supplies no digest, because its subset is a pure function of
    // inputs this fingerprint already hashes. Omitting the field must emit no
    // key at all, or the committed canary's stage receipts would invalidate and
    // its frozen bytes would be re-emitted.
    const canary = { ...SHARED, renderableCellCount: 1, profile: SOUTHERN_REMAINDER_WAVE_PROFILE };
    const withoutField = midtownCoreV3StageFingerprint(canary);
    const withUndefined = midtownCoreV3StageFingerprint({ ...canary, renderableCellDigestSha256: undefined });
    expect(withUndefined).toBe(withoutField);
    expect(midtownCoreV3StageFingerprint({ ...canary, renderableCellDigestSha256: renderableCellDigest(CURATED_CELL_IDS) })).not.toBe(withoutField);
  });

  it("separates the canary and the successor even at the same cell set, because the profile differs", () => {
    // The two profiles share seed, tool and generated instant; only the release
    // id differs, and it is not an input to any plan hash. It IS an input to the
    // stage fingerprint, which is what keeps the two variants' receipts apart in
    // their own work roots.
    const digest = renderableCellDigest(CURATED_CELL_IDS);
    expect(midtownCoreV3StageFingerprint({ ...SHARED, renderableCellDigestSha256: digest }))
      .not.toBe(midtownCoreV3StageFingerprint({ ...SHARED, profile: SOUTHERN_REMAINDER_WAVE_PROFILE, renderableCellDigestSha256: digest }));
  });
});
