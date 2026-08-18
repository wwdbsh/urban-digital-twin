/**
 * The far-tier records claim two things: that they are what they say they are,
 * and that producing them disturbed nothing that was already frozen. These
 * tests attack both, and the second matters more — a task that quietly moves a
 * committed checksum has broken the ledger even if its own numbers are right.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { FAR_TIER_BUDGET_CONTRACT, farTierBudgetContractHash, farTierDeliveredQuality } from "../src/release/far-tier-budget.ts";
import { farTierRecipeHash } from "../src/release/far-tier-bake.ts";
import { AUDITED_WORKING_RECORD_DIRECTORIES } from "./public-showcase-audit-cli.mjs";
import { EXPECTED_TEXTURE_BYTE_LENGTH } from "./exterior-acceptance-campaign-constants.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(repositoryRoot, "data", "far-tier-hlod-20260818");
const readRecord = (name) => readFileSync(join(evidenceRoot, `${name}.json`), "utf8");
const readJson = (name) => JSON.parse(readRecord(name));

const RECORDS = ["stage0-hierarchy", "bake-pre-registration", "prototype-provenance", "sampling-results"];

/**
 * Every committed far-tier record, v1 and v2, discovered from the TREE rather
 * than from a hand-kept list.
 *
 * The list above is v1-only and stayed v1-only when T010 added a second
 * directory, so the sidecar and artefact-string scans silently stopped covering
 * the new records while still being described as covering them. Enumerating the
 * directories removes the chance to forget again.
 */
/**
 * DISCOVERED, not listed. The T010 review caught a hand-kept RECORDS list that
 * silently stopped covering a new directory; the fix at the time only pushed
 * the hand-kept list up one level, to the DIRECTORIES, and T011 promptly added
 * a third directory that the scan again did not cover. So the directories are
 * discovered too, by prefix, and there is no list left to forget.
 */
const EVIDENCE_DIRECTORIES = readdirSync(join(repositoryRoot, "data"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("far-tier-hlod-"))
  .map((entry) => entry.name)
  .sort();
const ALL_RECORDS = EVIDENCE_DIRECTORIES.flatMap((directory) => {
  const root = join(repositoryRoot, "data", directory);
  return readdirSync(root)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => ({ directory, root, name: entry.replace(/\.json$/u, "") }));
});

describe("every far-tier record matches its own sidecar", () => {
  it("discovers every far-tier evidence directory, including ones added later", () => {
    expect(ALL_RECORDS.length).toBeGreaterThan(RECORDS.length);
    // At least the three that exist today, and any future sibling automatically.
    expect(EVIDENCE_DIRECTORIES.length).toBeGreaterThanOrEqual(3);
    for (const directory of EVIDENCE_DIRECTORIES) {
      expect(ALL_RECORDS.some((record) => record.directory === directory), `no record found under ${directory}`).toBe(true);
    }
    // The v1 list is retained only as a floor; it must never be the source.
    for (const name of RECORDS) {
      expect(ALL_RECORDS.some((record) => record.name === name), `${name} missing from discovery`).toBe(true);
    }
  });

  for (const record of ALL_RECORDS) {
    it(`${record.directory}/${record.name} reproduces its committed checksum`, () => {
      const text = readFileSync(join(record.root, `${record.name}.json`), "utf8");
      const declared = readFileSync(join(record.root, `${record.name}.sha256`), "utf8").trim().split(/\s+/u);
      expect(declared[1]).toBe(`${record.name}.json`);
      expect(sha256HexSync(text)).toBe(declared[0]);
    });
  }
});

describe("the committed records are free of emission defects", () => {
  // The failure this exists to catch actually happened: two record fields were
  // renamed, a template string in a DIFFERENT command kept reading the old
  // names, and `bake-pre-registration.json` shipped the sentence "at most
  // undefined faces ... undefined of 883 cells". Every test at the time passed,
  // because each only asserted fields it had itself added. This one reads the
  // bytes.
  for (const record of ALL_RECORDS) {
    const label = `${record.directory}/${record.name}`;
    it(`${label} contains no "undefined" anywhere in its bytes`, () => {
      expect(readFileSync(join(record.root, `${record.name}.json`), "utf8")).not.toContain("undefined");
    });

    it(`${label} contains no other stringified-JS artefact`, () => {
      const text = readFileSync(join(record.root, `${record.name}.json`), "utf8");
      for (const artefact of ["[object Object]", "NaN", '"null"', "Infinity"]) {
        expect(text, `${label} contains ${artefact}`).not.toContain(artefact);
      }
    });
  }

  it("interpolates B1's feasibility sentence from the REAL field values", () => {
    const b1 = readJson("bake-pre-registration").budgetBars.B1;
    const ceiling = readJson("stage0-hierarchy").leafResolutionLadder.faceCountCeiling;
    // Both numbers must appear literally, so a renamed source field cannot
    // silently blank them again.
    expect(b1.alsoDecidesFeasibility).toContain(String(ceiling.arithmeticCapacityOfACeilingSizedAtlas));
    expect(b1.alsoDecidesFeasibility).toContain(String(ceiling.packerMeasuredUnpackableCellCount));
    expect(b1.alsoDecidesFeasibility).toContain(String(ceiling.minimumTexelsPerFace));
    expect(ceiling.arithmeticCapacityOfACeilingSizedAtlas).toBe(1_024);
    expect(ceiling.packerMeasuredUnpackableCellCount).toBe(172);
    // And it must not sell the capacity figure as a feasibility count.
    expect(b1.alsoDecidesFeasibility).toContain("NOT a feasibility count");
  });

  it("does not claim a higher ceiling buys packability, which its own table denies", () => {
    const bound = readJson("stage0-hierarchy").cutIndependentBound;
    const at512 = bound.atlasCeilingComparison.find((row) => row.atlasCeilingPixels === 512);
    const at1024 = bound.atlasCeilingComparison.find((row) => row.atlasCeilingPixels === 1_024);
    // The table's own facts, restated as the invariant the note must respect.
    expect(at1024.packerMeasuredUnpackableCellCount).toBe(at512.packerMeasuredUnpackableCellCount);
    expect(at1024.cutIndependentAtlasGpuBytes).toBeGreaterThan(at512.cutIndependentAtlasGpuBytes);
    expect(bound.atlasCeilingComparisonNote).not.toContain("buys packability as much as sharpness");
    expect(bound.atlasCeilingComparisonNote).toContain("NO packability");
  });
});

describe("the cut-independent bound really dominates the sweep", () => {
  it("holds on the committed record", () => {
    // The substantive invariant: a bound below an observed pose is not a bound.
    const hierarchy = readJson("stage0-hierarchy");
    expect(hierarchy.cutIndependentBound.totalGpuBytes)
      .toBeGreaterThanOrEqual(hierarchy.worstCaseResidency.totalGpuBytes);
    expect(hierarchy.cutIndependentBound.atlasGpuBytes)
      .toBeGreaterThanOrEqual(hierarchy.worstCaseResidency.atlasGpuBytes);
  });

  it("is still ENFORCED by the derivation, not merely true today", () => {
    // The guard was an explicit B1 closure condition and was silently deleted
    // once already, during an unrelated refactor. A record that happens to
    // satisfy the invariant proves nothing about the next run, so the guard's
    // presence is pinned too.
    const source = readFileSync(join(repositoryRoot, "scripts", "far-tier-stage0-cli.mjs"), "utf8");
    expect(source).toContain("cutBound.totalGpuBytes < worst.totalGpuBytes");
    expect(source).toMatch(/if \(cutBound\.totalGpuBytes < worst\.totalGpuBytes\) \{\s*\n\s*fail\(/u);
  });
});

describe("the pre-registration really does predate the measurements", () => {
  it("carries no capture timestamp in any record", () => {
    // A timestamp is the one field a replay cannot reproduce, and in a
    // pre-registration it would also be a quiet lie about when the bars were set.
    for (const name of RECORDS) expect(readJson(name).capturedAt).toBeNull();
  });

  it("binds the results to the pre-registration by checksum, not by assertion", () => {
    const results = readJson("sampling-results");
    expect(results.preRegistration.sha256).toBe(sha256HexSync(readRecord("bake-pre-registration")));
  });

  it("derives the bars from the hierarchy record rather than typing them beside it", () => {
    const pre = readJson("bake-pre-registration");
    expect(pre.derivedFrom.sha256).toBe(sha256HexSync(readRecord("stage0-hierarchy")));
  });

  it("pins the recipe and contract hashes the code actually computes", () => {
    const pre = readJson("bake-pre-registration");
    expect(pre.recipe.recipeSha256).toBe(farTierRecipeHash());
    expect(pre.budgetBars.contractSha256).toBe(farTierBudgetContractHash());
    expect(readJson("prototype-provenance").provenance.recipeSha256).toBe(farTierRecipeHash());
  });
});

describe("the bars are reported against verbatim, including where they are missed", () => {
  it("records the tone bar as a MISS rather than rounding it into a pass", () => {
    const results = readJson("sampling-results");
    expect(results.result_tone.verdict).toBe("MISS");
    expect(results.result_tone.missingPoses).toHaveLength(1);
    // And the excess is stated as a number, not described.
    expect(results.result_tone.missingPoses[0].excess).toBeGreaterThan(0);
  });

  it("keeps every barred pose's reading, passing or not", () => {
    const barred = readJson("sampling-results").results.filter((entry) => entry.barred);
    expect(barred).toHaveLength(4);
    for (const entry of barred) expect(typeof entry.unionMeanLuminanceRatio).toBe("number");
  });

  it("does not silently swap the primary measure for the friendlier one", () => {
    // The intersection measure would have passed all four. The record must say
    // so AND must still report the union verdict as the outcome.
    const tone = readJson("sampling-results").result_tone;
    expect(tone.statedPlainly).toContain("NOT re-judged");
    expect(tone.verdict).toBe("MISS");
  });

  it("pre-registered B6 as already missed, and against the DELIVERED resolution", () => {
    const b6 = readJson("bake-pre-registration").budgetBars.B6;
    expect(b6.knownToBeMissed).toBe(true);
    // The bar must be judged on what the packer delivers, not on a 100%-full
    // atlas that no packer achieves. Deriving it from the ideal ladder alone
    // understated the shortfall by more than half, which is the defect this
    // assertion exists to stop recurring.
    expect(b6.rule).toContain("THE RESOLUTION THE PACKER ACTUALLY DELIVERS");
    expect(b6.measuredShortfallDelivered.underResolvedCellCount)
      .toBeGreaterThan(b6.measuredShortfallIdeal.underResolvedCellCount);
    expect(b6.measuredShortfallDelivered.cellsUnpackable).toBeGreaterThan(0);
  });
});

describe("the byte-replay proof", () => {
  it("compared two independent runs and found them identical", () => {
    const replay = readJson("prototype-provenance").byteReplay;
    expect(replay.runs).toBe(2);
    expect(replay.verdict).toBe("PASS");
    expect(replay.run1.glbSha256).toBe(replay.run2.glbSha256);
    expect(replay.run1.atlasSha256).toBe(replay.run2.atlasSha256);
  });

  it("ran the second bake in a FRESH PROCESS, not the same one", () => {
    // This module memoizes the tile integrator and the texture catalogue, so a
    // same-process repeat exercises the caches rather than the computation and
    // cannot catch one that leaks state.
    const replay = readJson("prototype-provenance").byteReplay;
    expect(replay.run1.process).toBe("parent");
    expect(replay.run2.process).toBe("child");
    expect(replay.method).toContain("FRESH CHILD PROCESS");
  });

  it("reports the DELIVERED resolution, consistent with the applied packing scale", () => {
    // The defect this catches: reporting the ideal ratio beside an applied
    // scale of 0.5 stated a sharpness the tile does not have, and B6 requires
    // an under-resolved leaf to be reported as under-resolved.
    const outcome = readJson("prototype-provenance").bakeOutcome;
    // Both operands are recorded to six decimals, so the identity is checked to
    // five; a real inconsistency is orders of magnitude larger than this.
    expect(outcome.appliedTexelWorldSizeMeters)
      .toBeCloseTo(outcome.targetTexelWorldSizeMeters / outcome.appliedResolutionScale, 5);
    const delivered = farTierDeliveredQuality(outcome.appliedTexelWorldSizeMeters);
    expect(outcome.achievedTexelRatio).toBeCloseTo(delivered.achievedRatio, 6);
    expect(outcome.underResolved).toBe(delivered.underResolved);
    expect(outcome.criticalDistanceMeters).toBe(Math.round(delivered.criticalDistanceMeters));
    // A scale below 1 is a real quality loss and must never read as fully resolved.
    if (outcome.appliedResolutionScale < 1) {
      expect(outcome.achievedTexelRatio).toBeLessThan(outcome.idealTexelRatio);
    }
  });

  it("measured the COMMITTED tile, not a superseded one", () => {
    // The frozen evidence must describe the bytes that shipped. This binds the
    // sampling record's subject to the replay's own digest, so a future byte
    // change that is not re-captured fails here rather than sitting unnoticed.
    const supersession = readJson("sampling-results").subjectDigestSupersession;
    const replay = readJson("prototype-provenance").byteReplay;
    expect(supersession.committedTileGlbSha256).toBe(replay.run1.glbSha256);
    expect(readJson("sampling-results").capture.subject).toContain(replay.run1.glbSha256);
  });

  it("retains the superseded capture rather than discarding it", () => {
    const record = readJson("sampling-results");
    const superseded = record.supersededCapture;
    expect(superseded.subjectGlbSha256).toBe(record.subjectDigestSupersession.supersededTileGlbSha256);
    expect(superseded.subjectGlbSha256).not.toBe(record.subjectDigestSupersession.committedTileGlbSha256);
    // Both captures carry the full six-pose reading set, so the re-capture can
    // be checked against the original rather than trusted.
    expect(superseded.results).toHaveLength(record.results.length);
  });

  it("re-captured under the UNCHANGED instrument", () => {
    const supersession = readJson("sampling-results").subjectDigestSupersession;
    expect(supersession.recaptureDiscipline).toContain("NOT altered");
    // Geometry-only measures cannot move if only texel bytes changed, so an
    // altered camera or viewport would show up here.
    const record = readJson("sampling-results");
    for (const [index, entry] of record.results.entries()) {
      const before = record.supersededCapture.results[index];
      expect(entry.distanceMeters).toBe(before.distanceMeters);
      expect(entry.azimuthDegrees).toBe(before.azimuthDegrees);
      expect(entry.unionPixels).toBe(before.unionPixels);
      expect(entry.intersectionPixels).toBe(before.intersectionPixels);
      expect(entry.intersectionOverUnion).toBe(before.intersectionOverUnion);
      // Channel spread is a ratio-of-ratios that cannot move unless the
      // lighting or the palette moved, so it is a second independent check
      // that the instrument itself was not altered between captures.
      expect(entry.channelSpread).toBe(before.channelSpread);
    }
  });

  it("reaches the same verdict on both captures, so the MISS is not a build artefact", () => {
    const record = readJson("sampling-results");
    expect(record.result_tone.verdict).toBe(record.supersededCapture.toneVerdict);
    expect(record.result_tone.missingPoses).toHaveLength(record.supersededCapture.toneMissingPoses.length);
  });

  it("names every source it derives from by checksum", () => {
    const provenance = readJson("prototype-provenance").provenance;
    expect(provenance.sourceRelease.releaseId).toMatch(/-c2$/u);
    expect(provenance.parentLedger.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(provenance.cell.membershipChecksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(provenance.sourceAssets.length).toBeGreaterThan(0);
    for (const asset of provenance.sourceAssets) expect(asset.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(provenance.classTiles.length).toBeGreaterThan(0);
  });

  it("proves rather than asserts that the regenerated sources are the shipped bytes", () => {
    const verification = readJson("prototype-provenance").provenance.sourceAssetVerification;
    expect(verification.verdict).toBe("PASS");
    expect(verification.byteIdentical).toBe(verification.compared);
  });

  it("carries the narrower rights envelope onto the derivative", () => {
    const rights = readJson("prototype-provenance").rights;
    expect(rights.envelope).toContain("NARROWER");
    expect(rights.envelope).toContain("Retention and local display only");
    expect(rights.note).toContain("does not widen an approval envelope");
  });
});

describe("nothing already frozen was disturbed", () => {
  it("leaves T006's G2 bar and its committed record untouched", () => {
    // Superseded BY STATEMENT for the far tier only. The T006 record must still
    // reproduce its own committed checksum, and the constant must not have moved.
    const t006Root = join(repositoryRoot, "data", "exterior-acceptance-20260817");
    const text = readFileSync(join(t006Root, "pre-registration.json"), "utf8");
    const declared = readFileSync(join(t006Root, "pre-registration.sha256"), "utf8").trim().split(/\s+/u)[0];
    expect(sha256HexSync(text)).toBe(declared);
    expect(sha256HexSync(text)).toBe("132adaf5ffdb8558400e06d3650cb7b03db90976f12eeacdb183876d6404d2bf");
    expect(EXPECTED_TEXTURE_BYTE_LENGTH).toBe(2_097_144);
    expect(JSON.parse(text).gates.gpu.G2.expectedByteLength).toBe(2_097_144);

    const supersede = readJson("bake-pre-registration").supersedes.T006_G2.statement;
    expect(supersede).toContain("FOR THE FAR TIER ONLY");
    expect(supersede).toContain("IS NOT REGENERATED");
  });

  it("adds no AUDITED_WORKING_RECORD_DIRECTORIES entry", () => {
    // The far tier's evidence directory is deliberately NOT declared: adding one
    // would move the committed differential-audit checksum, which is exactly the
    // drift that constant exists to stop.
    expect(AUDITED_WORKING_RECORD_DIRECTORIES).not.toContain("far-tier-hlod-20260818");
    expect(AUDITED_WORKING_RECORD_DIRECTORIES).toHaveLength(21);
  });

  it("leaves the -c1 and -c2 payload inventories exactly as committed", () => {
    for (const releaseId of ["manhattan-exterior-cells-20260811-v3-c1", "manhattan-northern-manhattan-cells-20260812-c2"]) {
      const root = join(repositoryRoot, "data", releaseId);
      const text = readFileSync(join(root, "payload-inventory.json"), "utf8");
      const declared = readFileSync(join(root, "payload-inventory.sha256"), "utf8").trim().split(/\s+/u)[0];
      expect(sha256HexSync(text)).toBe(declared);
    }
  });

  it("reverses ADR 0047 for the far tier only, and says so", () => {
    const statement = readJson("bake-pre-registration").supersedes.ADR_0047.statement;
    expect(statement).toContain("FOR THE FAR TIER ONLY");
    expect(statement).toContain("continues to govern the near and mid tiers unchanged");
  });

  it("qualifies B3-B5 as one-cut bounds and names what they do not cover", () => {
    // The defect this pins: "never exceeds at any camera pose" reads as a peak
    // bound, but the theorem bounds ONE antichain. A streaming runtime holding
    // an outgoing node while its replacement uploads exceeds it momentarily.
    const bars = readJson("bake-pre-registration").budgetBars;
    expect(bars.boundKind).toBe("instantaneous-steady-state-over-one-selected-cut");
    for (const key of ["B3", "B4", "B5"]) {
      expect(bars[key].rule, `${key} rule is unqualified`).toContain("SELECTED CUT");
      expect(bars[key].rule).toContain("steady state");
    }
    const excluded = bars.whatB3toB5DoNotBound;
    expect(excluded.outsideTheBound.length).toBeGreaterThanOrEqual(3);
    expect(excluded.consequence).toContain("T003");
  });

  it("discloses that the BUDGET bars were amended after the bake", () => {
    // The status line once claimed the whole record predated the bake. True of
    // the instrument, false of the budget bars as committed.
    const record = readJson("bake-pre-registration");
    expect(record.status).toContain("AMENDED");
    expect(record.amendments.amendedAfterTheBakeAndFirstCapture.length).toBeGreaterThanOrEqual(3);
    expect(record.amendments.notAmendedAndNotAmendable.length).toBeGreaterThanOrEqual(2);
    expect(record.amendments.honestReading).toContain("do not carry that guarantee");
  });

  it("proves the appearance instrument never drifted, rather than asserting it", () => {
    // The amendment disclosure is only worth anything if the part it claims is
    // untouched really is untouched. Recompute it from the record itself.
    const record = readJson("bake-pre-registration");
    const instrument = record.blenderAgreementInstrument;
    expect(instrument.agreementBar.tone.bar).toBe("|meanLuminanceRatio - 1| <= 0.05 at 1,200 m and at 4,000 m");
    expect(instrument.agreementBar.hue.bar).toBe("max per-channel ratio spread <= 0.02");
    expect(instrument.poses.distancesMeters).toEqual([400, 1_200, 4_000]);
    expect(instrument.poses.azimuthsDegrees).toEqual([55, 235]);
    // And the recipe hash, which the amendments claim did not move.
    expect(record.recipe.recipeSha256).toBe(farTierRecipeHash());
  });

  it("keeps the far tier's budget out of the closed criterion #30", () => {
    expect(FAR_TIER_BUDGET_CONTRACT.scope).toContain("and nothing else");
    expect(readJson("bake-pre-registration").budgetBars.separateFromCriterion30).toContain("NOT FOLDED INTO THE CLOSED 256 MiB CRITERION #30");
  });
});

describe("the derived budget bars and the code agree", () => {
  it("pins the CUT-INDEPENDENT bound, not the sampled sweep maximum", () => {
    const hierarchy = readJson("stage0-hierarchy");
    const bound = hierarchy.cutIndependentBound;
    expect(bound.atlasGpuBytes).toBe(FAR_TIER_BUDGET_CONTRACT.maxResidentAtlasGpuBytes);
    expect(bound.geometryGpuBytes).toBe(FAR_TIER_BUDGET_CONTRACT.maxResidentGeometryGpuBytes);
    expect(bound.totalGpuBytes).toBe(FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes);
    // And it must actually dominate the thing it replaced, or it is not a bound.
    expect(bound.totalGpuBytes).toBeGreaterThan(hierarchy.worstCaseResidency.totalGpuBytes);
  });

  it("does not claim the sweep is a bound, and shows why", () => {
    const worst = readJson("stage0-hierarchy").worstCaseResidency;
    expect(worst.quantifier).toContain("NOT a proven bound");
    // The ladder is the evidence. It must be a real ladder, and it must record
    // that refinement kept moving the answer rather than settling.
    expect(worst.refinementLadder.length).toBeGreaterThanOrEqual(4);
    const totals = worst.refinementLadder.map((entry) => entry.totalGpuBytes);
    expect(Math.max(...totals)).toBeGreaterThan(Math.min(...totals));
    expect(worst.stable).toBe(false);
    expect(worst.stabilityStatement).toContain("NOT STABLE");
  });

  it("measures per-ceiling feasibility with the REAL packer, not a capacity estimate", () => {
    // The defect this pins: infeasibility was estimated as faceCount >
    // ceiling^2/64, the same 100%-utilisation idealisation the delivered ladder
    // had already been corrected for, and it produced the false claim that a
    // 512 ceiling removes the packing blocker entirely.
    const table = readJson("stage0-hierarchy").cutIndependentBound.atlasCeilingComparison;
    expect(table.length).toBeGreaterThanOrEqual(4);
    for (const row of table) {
      expect(typeof row.packerMeasuredUnpackableCellCount).toBe("number");
      // The arithmetic capacity must not be mistakable for a feasibility count.
      expect(row).not.toHaveProperty("unpackableCellCount");
      expect(row.maximumFacesNote).toContain("NOT a feasibility count");
    }
    // Raising the ceiling must NOT be reported as a cure.
    const at512 = table.find((row) => row.atlasCeilingPixels === 512);
    const at1024 = table.find((row) => row.atlasCeilingPixels === 1_024);
    expect(at512.packerMeasuredUnpackableCellCount).toBeGreaterThan(0);
    expect(at1024.packerMeasuredUnpackableCellCount).toBe(at512.packerMeasuredUnpackableCellCount);
    // And the mechanism must be recorded: those cells' atlases sit below the ceiling.
    expect(at512.unpackableWhoseAtlasIsBelowTheCeiling).toBe(at512.packerMeasuredUnpackableCellCount);
  });

  it("states remedies that actually bite, and does not offer a bigger atlas as one", () => {
    const ceiling = readJson("stage0-hierarchy").leafResolutionLadder.faceCountCeiling;
    expect(ceiling.raisingTheCeilingDoesNotFixIt).toContain("MEASURED, NOT ASSUMED");
    expect(ceiling.survivingRemedies.length).toBeGreaterThanOrEqual(3);
    expect(ceiling.consequence).not.toContain("a larger atlas");
  });

  it("carries both denominators for the delivered under-resolved share", () => {
    // 650/711 packable and 650/883 overall answer different questions, and
    // reporting the smaller share against the larger denominator flatters.
    const delivered = readJson("stage0-hierarchy").leafResolutionLadder.deliveredLadder;
    expect(delivered.underResolvedShareOfPackable)
      .toBeCloseTo(delivered.underResolvedCellCount / delivered.cellsMeasured, 6);
    expect(delivered.underResolvedShareOfPackable).toBeGreaterThan(delivered.underResolvedShareOfAllCells);
  });

  it("rejects 'all leaves resident' as a bound, with its counterexample count", () => {
    const rejected = readJson("stage0-hierarchy").cutIndependentBound.allLeavesRejectedAsBound;
    expect(rejected.internalNodesCostlierThanTheirChildren).toBeGreaterThan(0);
  });

  it("states the geometry limitation rather than leaving it to be inferred", () => {
    const hierarchy = readJson("stage0-hierarchy");
    expect(hierarchy.hierarchy.geometryLimitation).toContain("DOES NOT REDUCE GEOMETRY RESIDENCY AT ALL");
    // The swept geometry worst case IS the whole island's, and that identity is
    // the evidence for the claim, so it must hold.
    expect(hierarchy.worstCaseResidency.geometryGpuBytes)
      .toBe(hierarchy.cutIndependentBound.allLeavesRejectedAsBound.allLeavesGeometryGpuBytes);
  });
});

describe("the sampling record's own arithmetic holds", () => {
  // A reading typed by hand, or a pose silently edited to look better, should
  // fail here rather than sit in a committed record looking plausible.
  const results = readJson("sampling-results").results;

  it("has every pose the instrument pre-registered, and no others", () => {
    const poses = readJson("bake-pre-registration").blenderAgreementInstrument.poses;
    const expected = poses.distancesMeters.flatMap((d) => poses.azimuthsDegrees.map((a) => `${d}/${a}`));
    expect(results.map((entry) => `${entry.distanceMeters}/${entry.azimuthDegrees}`).sort()).toEqual(expected.sort());
  });

  it("partitions the union silhouette exactly", () => {
    for (const entry of results) {
      expect(entry.unionPixels).toBe(entry.intersectionPixels + entry.sourceOnlyPixels + entry.bakedOnlyPixels);
      expect(entry.intersectionOverUnion).toBeCloseTo(entry.intersectionPixels / entry.unionPixels, 6);
    }
  });

  it("reproduces each channel spread from its own per-channel ratios", () => {
    for (const entry of results) {
      // Recorded to six decimals; a difference of two such values carries at
      // most that precision, so the identity is checked to five.
      expect(entry.channelSpread).toBeCloseTo(Math.max(...entry.perChannelRatios) - Math.min(...entry.perChannelRatios), 5);
    }
  });

  it("reproduces the union ratio from the absolute luminances it also records", () => {
    for (const entry of results) {
      expect(entry.unionMeanLuminanceRatio).toBeCloseTo(entry.bakedMeanLuminance / entry.sourceMeanLuminance, 4);
      // Both operands are recorded to six decimals, so their difference carries
      // at most that precision; checked to five.
      expect(entry.absoluteLuminanceDelta).toBeCloseTo(entry.bakedMeanLuminance - entry.sourceMeanLuminance, 5);
    }
  });

  it("agrees with its own verdict about which barred poses missed", () => {
    const tone = readJson("sampling-results").result_tone;
    const bar = 0.05;
    const missed = results.filter((entry) => entry.barred && Math.abs(entry.unionMeanLuminanceRatio - 1) > bar);
    expect(missed).toHaveLength(tone.missingPoses.length);
    expect(tone.passed).toBe(results.filter((entry) => entry.barred).length - missed.length);
    expect(tone.verdict).toBe(missed.length > 0 ? "MISS" : "PASS");
    for (const entry of missed) {
      const declared = tone.missingPoses.find((pose) => pose.distanceMeters === entry.distanceMeters && pose.azimuthDegrees === entry.azimuthDegrees);
      expect(declared).toBeDefined();
      expect(declared.excess).toBeCloseTo(Math.abs(entry.unionMeanLuminanceRatio - 1) - bar, 6);
    }
  });

  it("names the unexplained residual rather than leaving it undiscussed", () => {
    const residual = readJson("sampling-results").diagnosis.unexplainedResidual;
    expect(residual.status).toContain("UNEXPLAINED");
    expect(residual.whatWouldSettleIt.length).toBeGreaterThan(0);
  });
});

describe("the v2 shading derivation cannot see a measurement", () => {
  // The anti-fitting protocol in prose is worth little. This reads the file.
  const source = readFileSync(join(repositoryRoot, "src", "release", "far-tier-shading.ts"), "utf8");

  it("imports only committed plan geometry", () => {
    const imports = [...source.matchAll(/^import .*?from "(.*?)";$/gmu)].map((match) => match[1]);
    expect(imports).toEqual(["../domain/deterministic-facade-generator-v3.ts"]);
  });

  it("uses no transcendental in the derivation path", () => {
    // Comments stripped first, so the check is about CODE and not about prose
    // that happens to name the thing it forbids.
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    for (const banned of ["Math.pow", "Math.exp", "Math.log", "Math.cos", "Math.sin", "**"]) {
      expect(code, `derivation uses ${banned}`).not.toContain(banned);
    }
  });

  it("never mentions a ratio, a pose, a camera or a luminance in the scalar's own path", () => {
    const scalar = source.slice(source.indexOf("export function farTierShadingTerm"));
    const band = scalar.indexOf("export function farTierRoofScalarBand");
    const scalarOnly = band < 0 ? scalar : scalar.slice(0, band);
    for (const banned of ["luminance", "Luminance", "ratio", "Ratio", "camera", "pose"]) {
      expect(scalarOnly, `scalar path mentions ${banned}`).not.toContain(banned);
    }
  });
});

describe("the instrument records pin what the code computes", () => {
  const root = join(repositoryRoot, "data", "far-tier-hlod-instrument-20260818");
  const read = (name) => JSON.parse(readFileSync(join(root, `${name}.json`), "utf8"));

  it("pins the spec hash the module actually produces", async () => {
    const { farTierInstrumentSpecHash } = await import("../src/release/far-tier-instrument.ts");
    expect(read("pinned-instrument-spec").specSha256).toBe(farTierInstrumentSpecHash());
  });

  it("pins the harness digest the generator actually produces", async () => {
    const { farTierInstrumentAssertionPython } = await import("../src/release/far-tier-instrument.ts");
    expect(read("pinned-instrument-spec").harness.sha256).toBe(sha256HexSync(farTierInstrumentAssertionPython()));
  });

  it("stores a spec whose own serialization reproduces the pinned hash", async () => {
    // The record embeds a COPY of the spec. If that copy drifts from the module,
    // the record documents an instrument nobody ran.
    const { farTierInstrumentSpecHash } = await import("../src/release/far-tier-instrument.ts");
    const { stableSerialize } = await import("../src/domain/deterministic-hash.ts");
    expect(sha256HexSync(stableSerialize(read("pinned-instrument-spec").spec))).toBe(farTierInstrumentSpecHash());
  });

  it("keeps the three hand-copies of the six-pose table in agreement", () => {
    // The same numbers appear in the baseline record, the gate record and the
    // ADR prose. Three copies is three chances to drift.
    const baseline = read("pinned-baseline").results;
    const gate = read("t004-gate-pre-registration").whatTheV1TileScores.rows;
    expect(gate).toHaveLength(baseline.length);
    for (const row of baseline) {
      const pose = `${row.distanceMeters}/${row.azimuthDegrees}`;
      const gateRow = gate.find((entry) => entry.pose === pose);
      expect(gateRow, `${pose} missing from the gate record`).toBeDefined();
      expect(gateRow.sourceMeanLuminance).toBe(row.sourceMeanLuminance);
      expect(gateRow.A1_value).toBe(row.unionMeanLuminanceRatio);
      expect(gateRow.A3_value).toBe(row.channelSpread);
      expect(gateRow.A2_value).toBeCloseTo(Math.abs(row.absoluteDifference), 8);
    }
    const adr = readFileSync(join(repositoryRoot, "docs", "decisions", "0058-far-tier-bake-architecture.md"), "utf8");
    for (const row of baseline) {
      expect(adr, `ADR omits ratio for ${row.distanceMeters}/${row.azimuthDegrees}`).toContain(String(row.unionMeanLuminanceRatio));
      expect(adr, `ADR omits spread for ${row.distanceMeters}/${row.azimuthDegrees}`).toContain(String(row.channelSpread));
    }
  });

  it("withdrew the refuted rooftop mechanism everywhere", () => {
    // The claim was refuted by ablation data co-landed on this same branch.
    const attribution = read("divergence-attribution").attributionOfSurvivingFindings.fourThousandAz235TooDark;
    expect(attribution.attribution).toContain("MECHANISM UNATTRIBUTED");
    expect(attribution.withdrawnMechanism.whyWithdrawn).toContain("REFUTED");
    expect(attribution.untestedCandidate).toContain("CANDIDATE, NOT A CONCLUSION");
    for (const file of ["docs/decisions/0058-far-tier-bake-architecture.md", "docs/implementation/20260818-far-tier-instrument-pin.md"]) {
      expect(readFileSync(join(repositoryRoot, file), "utf8")).not.toContain("consistent with T011's ablation");
    }
  });

  it("derives the dark-pose tolerance arithmetic from the baseline, not from prose", () => {
    // This sentence was committed WRONG once — it claimed the tile still missed
    // at a 0.08 dark tolerance when |0.942736 - 1| = 0.057264 passes it. So the
    // record's numbers are now recomputed here from the baseline rows.
    const baseline = read("pinned-baseline").results;
    const arithmetic = read("t004-gate-pre-registration").darkPoseToleranceArithmetic;
    const dark = baseline.filter((row) => row.sourceMeanLuminance < 0.10);
    expect(dark.length).toBeGreaterThan(0);
    const worst = dark.reduce((a, b) =>
      Math.abs(b.unionMeanLuminanceRatio - 1) > Math.abs(a.unionMeanLuminanceRatio - 1) ? b : a);
    const deficit = Math.abs(worst.unionMeanLuminanceRatio - 1);

    expect(arithmetic.worstDarkPose).toBe(`${worst.distanceMeters}/${worst.azimuthDegrees}`);
    expect(arithmetic.worstDarkPoseRatio).toBe(worst.unionMeanLuminanceRatio);
    expect(arithmetic.worstDarkPoseDeficit).toBeCloseTo(deficit, 6);

    // Every probed tolerance must agree with the inequality, including the two
    // the prose previously got backwards.
    for (const probe of arithmetic.probe) {
      expect(probe.verdict, `tolerance ${probe.tolerance} misreported`).toBe(deficit <= probe.tolerance ? "PASS" : "MISS");
    }
    // The inherited bar must still be the one that preserves the failure.
    expect(arithmetic.inheritedToleranceKeepsTheFailure.preservesFailure).toBe(0.05 < deficit);
    expect(arithmetic.correctedStatement).toContain(String(arithmetic.worstDarkPoseDeficit));
  });

  it("binds the whole spec-hash lineage in-tree, not only through git history", () => {
    const lineage = read("pinned-instrument-spec").specLineage;
    const ids = new Set(lineage.hashes.map((entry) => entry.specSha256));
    expect(ids.size).toBe(lineage.hashes.length);
    expect(lineage.baselineCapturedUnderSpecSha256).toBe(lineage.hashes[0].specSha256);
    expect(read("pinned-baseline").instrument.capturedUnderSpecSha256).toBe(lineage.baselineCapturedUnderSpecSha256);
    // And exactly one id per distinct spec: the current row must not reuse an
    // earlier row's specId.
    const current = lineage.hashes[lineage.hashes.length - 1];
    expect(lineage.hashes.filter((e) => e.specId === current.specId)).toHaveLength(1);
  });

  it("labels the prose-only groups instead of claiming everything is enforced", () => {
    const coverage = read("pinned-instrument-spec").enforcementCoverage;
    expect(coverage.proseOnlyUnenforced.length).toBeGreaterThanOrEqual(4);
    expect(coverage.honesty).toContain("PROSE-ONLY");
    const module = readFileSync(join(repositoryRoot, "src", "release", "far-tier-instrument.ts"), "utf8");
    expect(module).not.toContain("EXHAUSTIVE over the settings");
    expect(module).toContain("PROSE-ONLY AND UNENFORCED");
  });

  it("names the record whose raytracing-off column reproduces the baseline exactly", () => {
    const supersession = read("pinned-baseline").supersession;
    expect(supersession.statement).toContain("sampling-results.json");
    expect(supersession.rebaselineResultsRelationship.record).toContain("rebaseline-results.json");
    expect(supersession.rebaselineResultsRelationship.finding).toContain("IDENTICAL");
  });
});
