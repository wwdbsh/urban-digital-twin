import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The drift instrument for `data/citywide-goal-acceptance-20260815/reconciliation.json`.
 *
 * THERE IS NO CLI, and that is the design rather than an omission. The prior
 * goal's T024 record carried a `coverage` block that was arithmetic over a
 * committed ledger, so a CLI could recompute it and a test could demand
 * byte-equality. Nothing in THIS goal's completion argument is recomputable:
 * every verdict is a judgement over capture records that a script cannot
 * re-derive. So the test is the whole instrument, and what it can hold, it
 * holds hard — the criteria digest, the closed vocabulary, the order, the
 * counts, the stop-report rule, and the sha256 of every committed artifact the
 * record cites. A figure that appears only in prose here is a figure nobody can
 * check, which is exactly what the artifact rule below refuses.
 */
const RECORD_PATH = "data/citywide-goal-acceptance-20260815/reconciliation.json";
const record = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
const VERDICT_VOCABULARY = ["MET", "MET-AS-ADJUDICATED", "NOT-MET"];

/**
 * Any `data/…` FILE token that appears in an evidence statement must also be
 * declared as a checksummed artifact of that same entry. Prose is where an
 * unverifiable citation would hide, so prose is where this looks.
 */
const DATA_FILE_TOKEN = /\bdata\/[A-Za-z0-9._/-]+\.(?:json|md|png|ts|tsx|mjs)\b/gu;

describe("citywide goal acceptance — the record cannot drift from the criteria it judged", () => {
  it("judges exactly the 12 declared criteria, once each, in declared order", () => {
    expect(record.criteriaCount).toBe(12);
    expect(record.verdicts).toHaveLength(12);
    expect(record.verdicts.map((entry) => entry.index)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });

  it("digests the criterion texts it judged, so a reworded criterion is visible", () => {
    // This detects a criterion edited INSIDE the record. It cannot detect one
    // edited in the Goal itself: the Goal ledger is not vendored here and is
    // untracked on a clean checkout, which is also why no field this test
    // reads names a path into it. The derivation command is recorded in the
    // record so it can be re-run by hand against the live ledger.
    const joined = record.verdicts.map((entry) => entry.criterion).join("\n");
    expect(createHash("sha256").update(joined).digest("hex")).toBe(record.criteriaSha256);
    expect(record.criteriaSha256).toBe(record.criteriaDerivation.digest);
    expect(record.criteriaDerivation.source).toContain("goal.json");
    expect(record.criteriaDerivation.goalContractSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("cites no ledger path in any field, because those paths do not exist on a clean checkout", () => {
    // A record that cited `.claude/…` or `.codex/…` would be citing something a
    // fresh clone cannot open. The reference is prose plus a digest instead.
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(".claude/");
    expect(serialized).not.toContain(".codex/");
  });
});

describe("the verdict table obeys its own rules", () => {
  it("draws every verdict from the closed three-value set", () => {
    expect(record.verdictVocabulary).toEqual(VERDICT_VOCABULARY);
    for (const entry of record.verdicts) expect(VERDICT_VOCABULARY).toContain(entry.verdict);
  });

  it("keeps the verdict counts and the stop-report count in agreement with the table", () => {
    const counts = {};
    for (const entry of record.verdicts) counts[entry.verdict] = (counts[entry.verdict] ?? 0) + 1;
    expect(counts).toEqual(record.verdictCounts);
    expect(record.stopReportCount).toBe(counts["NOT-MET"] ?? 0);
    expect(record.verdicts.filter((entry) => entry.stopReport !== undefined)).toHaveLength(record.stopReportCount);
  });

  it("pins the headline split, so a quiet re-grading shows up as a failing test", () => {
    // 8 / 3 / 1. Written as literals rather than derived, because the whole
    // point of the number is that it is the one a reader will quote — and
    // moving it has to be a deliberate, reviewed edit to this line.
    expect(record.verdictCounts).toEqual({ MET: 8, "MET-AS-ADJUDICATED": 3, "NOT-MET": 1 });
  });

  it("names the one unmet criterion explicitly, so a later edit cannot quietly promote it", () => {
    const unmet = record.verdicts.filter((entry) => entry.verdict === "NOT-MET").map((entry) => entry.index);
    // Criterion 7, the repeated-camera-path heap verdict. It is the only one.
    expect(unmet).toEqual([7]);
  });

  it("makes an adjudication state its delta and a NOT-MET state what would close it", () => {
    // The two rules that keep this table from being a completion narrative: a
    // narrowing that does not say what it narrowed, and a failure with no
    // remedy, are both refused here rather than in review.
    for (const entry of record.verdicts) {
      if (entry.verdict === "MET-AS-ADJUDICATED") expect(entry.adjudicationDelta?.length ?? 0, `criterion ${entry.index}`).toBeGreaterThan(20);
      else expect(entry, `criterion ${entry.index}`).not.toHaveProperty("adjudicationDelta");
      if (entry.verdict === "NOT-MET") expect(entry.stopReport?.length ?? 0, `criterion ${entry.index}`).toBeGreaterThan(20);
      else expect(entry, `criterion ${entry.index}`).not.toHaveProperty("stopReport");
    }
  });

  it("cites evidence for every criterion without exception", () => {
    for (const entry of record.verdicts) {
      expect(entry.evidence.length, `criterion ${entry.index}`).toBeGreaterThan(0);
      for (const line of entry.evidence) expect(line.statement.length, `criterion ${entry.index}`).toBeGreaterThan(20);
    }
  });
});

describe("every committed artifact this record cites still exists and still hashes to what is cited", () => {
  it("re-hashes every declared artifact", () => {
    let checked = 0;
    for (const entry of record.verdicts) {
      for (const line of entry.evidence) {
        for (const artifact of line.artifacts ?? []) {
          expect(artifact.path, `criterion ${entry.index}`).toMatch(/^data\//u);
          expect(artifact.sha256, artifact.path).toMatch(/^[0-9a-f]{64}$/u);
          expect(existsSync(artifact.path), `${artifact.path} is cited but absent`).toBe(true);
          expect(createHash("sha256").update(readFileSync(artifact.path)).digest("hex"), artifact.path).toBe(artifact.sha256);
          checked += 1;
        }
      }
    }
    // A rule that checked nothing would pass vacuously.
    expect(checked).toBeGreaterThan(20);
  });

  it("refuses an unchecksummed data citation hiding in prose", () => {
    // The rule that makes the one above meaningful: naming a data file in a
    // sentence without declaring it as an artifact would put an unverifiable
    // figure in the record.
    for (const entry of record.verdicts) {
      for (const line of entry.evidence) {
        const declared = new Set((line.artifacts ?? []).map((artifact) => artifact.path));
        for (const token of line.statement.match(DATA_FILE_TOKEN) ?? []) {
          expect(declared.has(token), `criterion ${entry.index} cites ${token} in prose without a checksum`).toBe(true);
        }
      }
    }
  });

  it("does not cite the superseded scheduler-on capture anywhere", () => {
    // D-16: the record is RETAINED on disk and must be cited nowhere. That is
    // an assertion, not a convention, because the file is a plausible-looking
    // station capture of the wrong bundle.
    expect(existsSync("data/citywide-default-flip-20260814/stations-scheduler-on.json")).toBe(true);
    for (const entry of record.verdicts) {
      for (const line of entry.evidence) {
        expect(line.statement, `criterion ${entry.index}`).not.toContain("stations-scheduler-on.json");
        for (const artifact of line.artifacts ?? []) expect(artifact.path).not.toContain("stations-scheduler-on.json");
      }
    }
  });
});

describe("residual risks are recorded rather than the goal being closed silently", () => {
  it("keeps every risk a readable string", () => {
    expect(record.residualRisks.length).toBeGreaterThanOrEqual(8);
    for (const risk of record.residualRisks) {
      expect(typeof risk).toBe("string");
      expect(risk.length).toBeGreaterThan(80);
    }
  });

  it("names each carried deferral by its number, so none is closed by omission", () => {
    const joined = record.residualRisks.join(" ");
    for (const marker of ["D-4", "D-8", "D-11", "D-12", "D-13", "D-14", "D-16", "D-17"]) {
      expect(joined, `${marker} is not carried`).toContain(marker);
    }
  });

  it("carries D-17 with the symbol, the call sites, the closing instrument and the user-visible failure", () => {
    // A risk stated as "the wiring is unguarded" is not actionable. These four
    // are what make it one, and they are asserted so a later edit cannot
    // soften it back into a sentence.
    const d17 = record.residualRisks.find((risk) => risk.includes("D-17"));
    expect(d17).toBeTruthy();
    expect(d17).toContain("applyDenseOwnership");
    expect(d17).toContain("CesiumViewport.tsx:2044");
    expect(d17).toContain(":2132");
    expect(d17).toContain(":2144");
    expect(d17).toContain("React harness");
    expect(d17).toContain("never reaches the screen");
  });

  it("states the D-13 and D-14 dispositions rather than leaving them as bare numbers", () => {
    const joined = record.residualRisks.join(" ");
    expect(joined).toContain("D-13 DISPOSITION");
    expect(joined).toContain("D-14 DISPOSITION");
  });
});
