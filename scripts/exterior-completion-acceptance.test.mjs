import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * THE DRIFT INSTRUMENT for the exterior-completion goal's acceptance record.
 *
 * The record's authority rests on three properties, and this file asserts all
 * three rather than trusting them:
 *
 *   1. IT MATCHES ITS SIDECAR. A closure record that can be edited after the
 *      goal is closed is not evidence.
 *   2. EVERY FIGURE IS FINDABLE. Any `data/…` file named in a verdict's prose
 *      must be declared as an artifact with a checksum, so a number quoted in a
 *      sentence can always be traced to a file whose bytes are pinned.
 *   3. IT CITES NO LEDGER PATH. `.claude/` and `.codex/` are untracked; a record
 *      citing them would be citing something a fresh clone cannot open.
 *
 * It deliberately does NOT judge whether the adjudications are correct. That is
 * what the evidence sentences are for, and no test can substitute for reading
 * them.
 */
const DIR = "data/exterior-completion-acceptance-20260817";
const RECORD_PATH = `${DIR}/reconciliation.json`;
const MAPPING_PATH = `${DIR}/refusal-code-mapping.json`;
const DATA_FILE_TOKEN = /\bdata\/[A-Za-z0-9._/-]+\.(?:json|md|png|ts|tsx|mjs)\b/gu;

const text = readFileSync(RECORD_PATH, "utf8");
const record = JSON.parse(text);
const mappingText = readFileSync(MAPPING_PATH, "utf8");
const mapping = JSON.parse(mappingText);

describe("the exterior-completion acceptance record is intact", () => {
  it("matches its committed checksum sidecar", () => {
    expect(readFileSync(`${DIR}/reconciliation.sha256`, "utf8")).toBe(`${createHash("sha256").update(text).digest("hex")}  reconciliation.json\n`);
    expect(readFileSync(`${DIR}/refusal-code-mapping.sha256`, "utf8")).toBe(`${createHash("sha256").update(mappingText).digest("hex")}  refusal-code-mapping.json\n`);
  });

  it("pins the criteria digest it judged", () => {
    expect(record.criteriaSha256).toBe("3630e3a1d86980ddca72d72d84e5f4ee27bd01e4e55390da140c0565e46d983b");
    expect(record.criteriaDerivation.digest).toBe(record.criteriaSha256);
    expect(record.criteriaCount).toBe(12);
    expect(record.verdicts).toHaveLength(12);
  });

  it("cites no ledger path in any field, because those paths do not exist on a clean checkout", () => {
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(".claude/");
    expect(serialized).not.toContain(".codex/");
  });
});

describe("the verdict table obeys its own rules", () => {
  it("draws every verdict from the closed three-value set, indexed 1..12 in order", () => {
    expect(record.verdictVocabulary).toEqual(["MET", "MET-AS-ADJUDICATED", "NOT-MET"]);
    expect(record.verdicts.map((entry) => entry.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const entry of record.verdicts) {
      expect(record.verdictVocabulary, `criterion ${entry.index}`).toContain(entry.verdict);
      expect(entry.evidence.length, `criterion ${entry.index} has no evidence`).toBeGreaterThan(0);
    }
  });

  it("reports counts that follow from its own verdicts", () => {
    // Derived, not typed: a summary that disagreed with the table it summarizes
    // would be the easiest possible way to overstate a closure.
    const counted = { MET: 0, "MET-AS-ADJUDICATED": 0, "NOT-MET": 0 };
    for (const entry of record.verdicts) counted[entry.verdict] += 1;
    expect(record.verdictCounts).toEqual(counted);
    expect(counted.MET + counted["MET-AS-ADJUDICATED"] + counted["NOT-MET"]).toBe(12);
  });

  it("keeps the summary CLAIM's numbers in agreement with the verdict table", () => {
    // THE EXACT DRIFT THIS CATCHES, and it is not hypothetical: the first
    // committed draft of this record carried a claim sentence reading "Three are
    // MET, eight are MET-AS-ADJUDICATED" — residue of a plan whose summary line
    // disagreed with its own itemized grade table. The verdicts were right, the
    // counts were right, and the one sentence a reader actually quotes was
    // wrong. Nothing in the record checked it.
    //
    // The numbers are now spelled out of verdictCounts by the generator; this
    // asserts the sentence still agrees with the table it summarizes.
    const spoken = record.claim.match(/(\d+) are MET, (\d+) are MET-AS-ADJUDICATED\b[^.]*?, and (\d+)\b/u);
    expect(spoken, "the claim sentence no longer states its counts in a checkable form").not.toBeNull();
    expect(Number(spoken[1])).toBe(record.verdictCounts.MET);
    expect(Number(spoken[2])).toBe(record.verdictCounts["MET-AS-ADJUDICATED"]);
    expect(Number(spoken[3])).toBe(record.verdictCounts["NOT-MET"]);
  });

  it("gives every NOT-MET an honest stop report and no one else one", () => {
    for (const entry of record.verdicts) {
      if (entry.verdict === "NOT-MET") {
        expect(typeof entry.stopReport, `criterion ${entry.index}`).toBe("string");
        expect(entry.stopReport.length, `criterion ${entry.index}`).toBeGreaterThan(20);
      } else {
        expect(entry.stopReport, `criterion ${entry.index} carries a stop report but is not NOT-MET`).toBeUndefined();
      }
    }
    expect(record.stopReportCount).toBe(record.verdicts.filter((entry) => entry.verdict === "NOT-MET").length);
  });

  it("refuses an unchecksummed data citation hiding in prose", () => {
    // The rule that makes the record traceable: naming a data file in a
    // sentence without declaring it as an artifact would put an unverifiable
    // figure in the record.
    let checked = 0;
    for (const entry of record.verdicts) {
      for (const line of entry.evidence) {
        const declared = new Set((line.artifacts ?? []).map((artifact) => artifact.path));
        for (const token of line.statement.match(DATA_FILE_TOKEN) ?? []) {
          expect(declared.has(token), `criterion ${entry.index} cites ${token} in prose without a checksum`).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("declares only artifacts that exist and whose checksums still match", () => {
    for (const entry of record.verdicts) {
      for (const line of entry.evidence) {
        for (const artifact of line.artifacts ?? []) {
          expect(existsSync(artifact.path), `criterion ${entry.index} cites missing ${artifact.path}`).toBe(true);
          expect(createHash("sha256").update(readFileSync(artifact.path)).digest("hex"), `${artifact.path} drifted`).toBe(artifact.sha256);
        }
      }
    }
  });
});

describe("criterion 4 is recorded as an honest stop, not softened", () => {
  const four = () => record.verdicts.find((entry) => entry.index === 4);

  it("stands NOT-MET and names why the gate is unreachable", () => {
    expect(four().verdict).toBe("NOT-MET");
    const prose = four().evidence.map((line) => line.statement).join(" ");
    expect(prose).toContain("lod_0");
    expect(prose).toContain("424");
    expect(prose).toContain("0.09160");
    expect(prose).toContain("doitt:401323");
    expect(prose).toContain("ROUTE 1");
    expect(prose).toContain("ROUTE 2");
  });

  it("keeps the per-wave fallback counts that make the claim checkable", () => {
    const prose = four().evidence.map((line) => line.statement).join(" ");
    for (const token of ["w00 0", "w01 4", "w02 114", "w03 289", "w04 3", "w05 14"]) {
      expect(prose, `criterion 4 omits ${token}`).toContain(token);
    }
  });
});

describe("the residual risks name the deltas rather than burying them", () => {
  it("continues the D-nn numbering from the prior records", () => {
    const ids = record.residualRisks.map((risk) => Number(/^D-(\d+):/u.exec(risk)[1]));
    // D-18 was the highest before this goal closed.
    expect(Math.min(...ids)).toBe(19);
    expect(ids).toEqual([...ids].sort((left, right) => left - right));
  });

  it("names every delta the closure rests on", () => {
    // Case-insensitive: the risks SHOUT their headline ("D-19: CRITERION 4 IS
    // NOT MET"), and asserting on case would be asserting on typography.
    const all = record.residualRisks.join(" ").toLowerCase();
    for (const token of ["criterion 4", "j4", "e-1f", "7,122.2", "4,703,921", "volume-identity-failed", "114", "94 of 94", "gitignored"]) {
      expect(all, `residual risks omit ${token}`).toContain(token.toLowerCase());
    }
  });
});

/**
 * The 899 -> 205 mapping. Derived from committed per-building vectors, never
 * re-measured, and asserted to partition the original refusal set exactly.
 */
describe("the refusal-code mapping partitions the original 899", () => {
  it("splits 899 into 694 recovered and 205 still refused, with no remainder", () => {
    expect(mapping.totals.before).toBe(899);
    expect(mapping.totals.recovered).toBe(694);
    expect(mapping.totals.refusedAfter).toBe(205);
    expect(mapping.partition.sum).toBe(899);
    expect(mapping.totals.recovered + mapping.totals.refusedAfter).toBe(899);
    // The 14 reclassified are a SUBSET of the 205, not a third bucket.
    expect(mapping.totals.reclassifiedButStillRefused).toBe(14);
    expect(mapping.totals.reclassifiedButStillRefused).toBeLessThan(mapping.totals.refusedAfter);
  });

  it("balances the transition matrix against both the before and after tallies", () => {
    const before = {};
    const after = {};
    for (const row of mapping.transitions) {
      before[row.beforeStopCode] = (before[row.beforeStopCode] ?? 0) + row.count;
      after[row.afterStopCode] = (after[row.afterStopCode] ?? 0) + row.count;
    }
    expect(after).toEqual(mapping.afterByStopCode);
    expect(mapping.transitions.reduce((sum, row) => sum + row.count, 0)).toBe(205);
    // Every before-code total in the matrix, plus what was recovered under that
    // code, must equal the original count for that code.
    for (const [code, originalCount] of Object.entries(mapping.beforeByStopCode)) {
      const stillRefused = before[code] ?? 0;
      const recovered = mapping.recoveredByBeforeStopCode[code] ?? 0;
      expect(stillRefused + recovered, `${code} does not balance`).toBe(originalCount);
    }
  });

  it("explains the 113 -> 114 inversion by a single priority-ordered migration", () => {
    expect(mapping.afterByStopCode["ring-area-below-floor"]).toBe(114);
    expect(mapping.beforeByStopCode["ring-area-below-floor"]).toBe(113);
    const migration = mapping.migrations.find((entry) => entry.from === "ring-vertex-count-unsupported" && entry.to === "ring-area-below-floor");
    expect(migration.count).toBe(1);
    expect(mapping.ringAreaBelowFloorInversion.arithmetic).toContain("113 unchanged + 1 migrated");
  });

  it("clears the two extension-eligible categories the contract names", () => {
    expect(mapping.afterByStopCode["source-height-below-grammar-minimum"]).toBeUndefined();
    expect(mapping.afterByStopCode["ring-vertex-count-unsupported"]).toBeUndefined();
    expect(mapping.beforeByStopCode["source-height-below-grammar-minimum"]).toBe(384);
    expect(mapping.beforeByStopCode["ring-vertex-count-unsupported"]).toBe(324);
  });

  it("keeps the volume-identity delta visible, since the adjudication turns on it", () => {
    expect(mapping.afterByStopCode["volume-identity-failed"]).toBe(43);
    expect(mapping.notClaimedHere.join(" ")).toContain("generator's own self-check");
  });

  it("is derived from the committed census, whose checksum still matches", () => {
    expect(existsSync(mapping.source.path)).toBe(true);
    expect(createHash("sha256").update(readFileSync(mapping.source.path)).digest("hex")).toBe(mapping.source.sha256);
    expect(mapping.source.rowCount).toBe(899);
  });
});
