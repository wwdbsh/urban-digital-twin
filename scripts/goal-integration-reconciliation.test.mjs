import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PROMOTED_PAYLOAD_INVENTORIES,
  RECONCILIATION_RECORD_PATH,
  WAVE_CENSUS_SOURCES,
  computeCensusClosure,
  computeCoverageReconciliation,
  computeLedgerClosure,
  computePromotedCoverage,
  repositoryRoot,
} from "./goal-integration-reconciliation-cli.mjs";

const record = JSON.parse(readFileSync(RECONCILIATION_RECORD_PATH, "utf8"));
const VERDICT_VOCABULARY = ["MET", "MET-AS-ADJUDICATED", "NOT-MET"];

/**
 * The record's `coverage` block is the ONLY part of this Goal's completion
 * argument that is arithmetic rather than judgement, so it is the part a test
 * can hold. Everything below either recomputes it from the committed ledger and
 * censuses, or checks that the judgement half obeys its own stated rules.
 */
describe("goal integration reconciliation — the coverage block cannot drift from the ledgers", () => {
  it("recomputes byte-equal to the committed record", () => {
    expect(computeCoverageReconciliation()).toEqual(record.coverage);
  });

  it("reports the Goal's four zero-violation claims as actually zero, one count at a time", () => {
    const { violations } = record.coverage;
    expect(violations.missingSpatialCells).toBe(0);
    expect(violations.missingAcceptedBuildingParents).toBe(0);
    expect(violations.duplicateCanonicalOwners).toBe(0);
    expect(violations.buildingsWithoutStyleClass).toBe(0);
    // The two closure counts that make the four above meaningful rather than vacuous.
    expect(violations.ownedBuildingsAccountedByNeither).toBe(0);
    expect(violations.stopCodesOutsideClosedVocabulary).toBe(0);
  });

  it("pins the ledger it reconciled by the committed checksum sidecar", () => {
    const sidecar = readFileSync(join(repositoryRoot, "data/normalized/manhattan-exterior-wave-ledger-20260804/ledger.sha256"), "utf8");
    expect(sidecar).toContain(record.coverage.ledger.ledgerChecksumSha256);
    expect(record.coverage.ledger.ledgerChecksumSha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("ledger closure", () => {
  const ledger = computeLedgerClosure();

  it("assigns every declared cell to exactly one wave and loses none", () => {
    expect(ledger.declaredCellCount).toBe(883);
    expect(ledger.observedCellCount).toBe(883);
    expect(ledger.waveCellSum).toBe(ledger.declaredCellCount);
    expect(ledger.missingCells).toBe(0);
    expect(ledger.duplicateCells).toBe(0);
  });

  it("owns every accepted canonical parent exactly once", () => {
    expect(ledger.declaredBaseBuildingCount).toBe(45_194);
    expect(ledger.observedBuildingIdCount).toBe(45_194);
    // Distinct equal to total is the duplicate check stated positively: an id
    // appearing in two cells would make these two numbers differ.
    expect(ledger.distinctBuildingIdCount).toBe(ledger.observedBuildingIdCount);
    expect(ledger.waveBuildingSum).toBe(ledger.declaredBaseBuildingCount);
  });

  it("agrees with the committed zero-finding reconciliation report rather than replacing it", () => {
    expect(ledger.committedReport.ok).toBe(true);
    expect(ledger.committedReport.counts).toEqual({ missing: 0, duplicate: 0, "cross-cell-duplicate": 0, stale: 0, changed: 0 });
    expect(ledger.committedReport.ownedBuildingCount).toBe(ledger.observedBuildingIdCount);
  });

  it("declares six waves whose per-wave counts match what the digest observes", () => {
    expect(ledger.waves).toHaveLength(6);
    for (const wave of ledger.waves) expect(wave.agrees).toBe(true);
  });
});

describe("census closure — every owned building is materialized or refused under a named stop code", () => {
  const census = computeCensusClosure();

  it("accounts for all six waves against one census each", () => {
    expect(census.waves.map((wave) => wave.waveId)).toEqual(WAVE_CENSUS_SOURCES.map((source) => source.waveId));
    expect(census.ownedBuildingCount).toBe(45_194);
    expect(census.materializedBuildingCount + census.refusedBuildingCount).toBe(census.ownedBuildingCount);
  });

  it("leaves no owned building accounted for by neither outcome, in any single wave", () => {
    for (const wave of census.waves) {
      expect(wave.unaccountedOwnedCount).toBe(0);
      expect(wave.refusalCodeSum).toBe(wave.refusedBuildingCount);
    }
  });

  it("draws every observed stop code from the closed vocabulary", () => {
    expect(census.unknownStopCodeCount).toBe(0);
    for (const code of census.observedStopCodes) expect(census.closedStopCodeVocabulary).toContain(code);
  });

  it("gives every materialized building a machine-readable style class", () => {
    // Named for what it counts. Criterion 12's "unclassified COMPONENTS" half
    // is carried by criterion 15's contract, which throws rather than shipping
    // a component outside the closed vocabulary — so a census could never find
    // one to count, and this metric does not claim to have looked.
    for (const wave of census.waves) expect(wave.buildingsWithoutStyleClass).toBe(0);
    expect(census.buildingsWithoutStyleClass).toBe(0);
  });

  it("does not round the refusal away: 899 of 45,194 parents ARE refused", () => {
    // This is the number criterion 1 is NOT-MET on, so it is asserted rather
    // than left to be read off a summary that could quietly change.
    expect(census.refusedBuildingCount).toBe(899);
    expect(census.materializedBuildingCount).toBe(44_295);
  });
});

describe("promoted default coverage — what a session with no URL parameter actually gets", () => {
  const promoted = computePromotedCoverage();

  it("promotes six waves, one per declared wave, each with a named approval", () => {
    expect(promoted.promotedWaveCount).toBe(6);
    for (const release of promoted.releases) {
      expect(release.approvalRef).toBeTruthy();
      expect(release.waveId).not.toBeNull();
    }
    expect(PROMOTED_PAYLOAD_INVENTORIES).toHaveLength(5);
  });

  it("keeps promoted BUILDINGS and shipped ASSETS as different numbers", () => {
    // Block 835 ships both canonical LODs for its 14 buildings, which is the
    // whole of the 14-entry gap. Collapsing the two counts would overstate
    // coverage by exactly that much.
    expect(promoted.promotedBuildingCount).toBe(484);
    expect(promoted.distinctPromotedBuildingCount).toBe(484);
    expect(promoted.shippedAssetCount).toBe(498);
    expect(promoted.shippedAssetCount - promoted.promotedBuildingCount).toBe(14);
  });

  it("stays inside the unchanged 512-entry cache contract with 14 entries of headroom", () => {
    expect(promoted.maxCacheEntries).toBe(512);
    expect(promoted.maxCachedBytes).toBe(256 * 1024 * 1024);
    expect(promoted.cacheEntryHeadroom).toBe(14);
    expect(promoted.shippedAssetCount).toBeLessThanOrEqual(promoted.maxCacheEntries);
  });

  it("never exceeds the Goal's concurrency ceiling of 8", () => {
    expect(promoted.maxConcurrentRequests).toBeLessThanOrEqual(8);
  });

  it("says how much of the city ships no exterior at all", () => {
    expect(promoted.declaredCellCount).toBe(883);
    expect(promoted.renderableCellCount).toBe(13);
    expect(promoted.tombstonedCellCount).toBe(870);
    expect(record.coverage.promotedSharePercent).toBeLessThan(2);
  });
});

describe("the verdict table obeys its own rules", () => {
  it("covers all 31 criteria exactly once, in order", () => {
    expect(record.criteriaCount).toBe(31);
    expect(record.verdicts).toHaveLength(31);
    expect(record.verdicts.map((entry) => entry.index)).toEqual(Array.from({ length: 31 }, (_, index) => index + 1));
  });

  it("draws every verdict from the closed three-value set", () => {
    expect(record.verdictVocabulary).toEqual(VERDICT_VOCABULARY);
    for (const entry of record.verdicts) expect(VERDICT_VOCABULARY).toContain(entry.verdict);
  });

  it("cites evidence for every criterion without exception", () => {
    for (const entry of record.verdicts) {
      expect(entry.evidence.length, `criterion ${entry.index}`).toBeGreaterThan(0);
      for (const line of entry.evidence) expect(line.length).toBeGreaterThan(20);
    }
  });

  it("makes an adjudication state its delta and a NOT-MET state what would close it", () => {
    // The two rules that keep this table from being a completion narrative: a
    // narrowing that does not say what it narrowed, and a failure with no
    // remedy, are both refused here rather than in review.
    for (const entry of record.verdicts) {
      if (entry.verdict === "MET-AS-ADJUDICATED") expect(entry.adjudicationDelta, `criterion ${entry.index}`).toBeTruthy();
      else expect(entry).not.toHaveProperty("adjudicationDelta");
      if (entry.verdict === "NOT-MET") expect(entry.stopReport, `criterion ${entry.index}`).toBeTruthy();
      else expect(entry).not.toHaveProperty("stopReport");
    }
  });

  it("keeps the stop report and the verdict counts in agreement", () => {
    const counts = {};
    for (const entry of record.verdicts) counts[entry.verdict] = (counts[entry.verdict] ?? 0) + 1;
    expect(counts).toEqual(record.verdictCounts);
    expect(record.stopReportCount).toBe(counts["NOT-MET"]);
  });

  it("pins the headline split, so a quiet re-grading shows up as a failing test", () => {
    // 17 / 8 / 6. Written as literals rather than derived, because the whole
    // point of the number is that it is the one a reader will quote.
    expect(record.verdictCounts).toEqual({ MET: 17, "MET-AS-ADJUDICATED": 8, "NOT-MET": 6 });
    expect(record.verdicts).toHaveLength(31);
  });

  it("names the six unmet criteria explicitly, so a later edit cannot quietly promote one", () => {
    const unmet = record.verdicts.filter((entry) => entry.verdict === "NOT-MET").map((entry) => entry.index);
    expect(unmet).toEqual([1, 7, 8, 22, 24, 30]);
  });

  it("digests the criterion texts it judged, so a reworded criterion is visible", () => {
    // This detects a criterion text edited INSIDE the record. It cannot detect
    // a criterion edited in the Goal itself, because `goal.json` lives in the
    // `.codex` ledger outside this repository and is deliberately not vendored
    // here. The derivation that ties this digest to the Goal — the exact
    // command, its path and its output — is recorded in ADR 0039 so it can be
    // re-run by hand against the live ledger.
    const joined = record.verdicts.map((entry) => entry.criterion).join("\n");
    expect(createHash("sha256").update(joined).digest("hex")).toBe(record.criteriaSha256);
    expect(record.criteriaSha256).toBe(record.criteriaDerivation.digest);
    expect(record.criteriaDerivation.source).toContain("goal.json");
  });

  it("records residual risks rather than closing the Goal silently", () => {
    expect(record.residualRisks.length).toBeGreaterThanOrEqual(5);
    expect(record.residualRisks.join(" ")).toContain("volume-identity");
  });
});
