/* global TextDecoder */
/**
 * The goal's own acceptance record, and the discipline it claims to follow.
 *
 * Two things are bound here. That the record matches its sidecar, because an
 * acceptance record that can be edited after it is cited is not one. And that
 * the frozen record it AMENDS is byte-identical, because the whole amendment
 * convention rests on the amended document never being touched.
 *
 * What is NOT bound: any verdict's prose. These tests hold the discipline shut,
 * not the conclusions — a later task that honestly changes a verdict should not
 * have to fight a test to do it.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join("data", "manhattan-hlod-far-tier-acceptance-20260822");
const AMENDED = join("data", "exterior-completion-acceptance-20260817");
const readText = (path) => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const readRecord = (root, name) => {
  const text = readText(join(root, `${name}.json`));
  const declared = readText(join(root, `${name}.sha256`)).trim().split(/\s+/u)[0];
  expect(createHash("sha256").update(text).digest("hex"), `${name}.json does not match its sidecar`).toBe(declared);
  return JSON.parse(text);
};

describe("the goal acceptance record", () => {
  it("matches its sidecar, and every record in its directory does", () => {
    const names = readdirSync(ROOT).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/u, ""));
    expect(names).toContain("reconciliation");
    for (const name of names) expect(readRecord(ROOT, name), name).toBeTypeOf("object");
  });

  it("covers every criterion the goal declares, with no gaps and no duplicates", () => {
    const record = readRecord(ROOT, "reconciliation");
    expect(record.criteriaCount).toBe(11);
    const indexes = record.verdicts.map((v) => v.index).sort((a, b) => a - b);
    expect(indexes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const verdict of record.verdicts) {
      expect(["MET", "MET-AS-ADJUDICATED", "NOT-MET"], `criterion ${verdict.index}`).toContain(verdict.verdict);
      expect(verdict.evidence.length, `criterion ${verdict.index} has no evidence`).toBeGreaterThan(0);
    }
  });

  it("gives every NOT-MET a stop report rather than leaving it bare", () => {
    const record = readRecord(ROOT, "reconciliation");
    const notMet = record.verdicts.filter((v) => v.verdict === "NOT-MET");
    expect(notMet.length).toBe(4);
    for (const verdict of notMet) expect(verdict.stopReport, `criterion ${verdict.index}`).toBeTruthy();
  });

  it("cites a committed record for every criterion that claims evidence", () => {
    // An artifact citation whose file is gone, or whose hash has moved, is a
    // citation of something that no longer exists.
    const record = readRecord(ROOT, "reconciliation");
    let checked = 0;
    for (const verdict of record.verdicts) {
      for (const artifact of verdict.artifacts ?? []) {
        expect(existsSync(artifact.path), `${artifact.path} is cited but absent`).toBe(true);
        expect(sha256(artifact.path), artifact.path).toBe(artifact.sha256);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe("the residual register", () => {
  it("names every residual with an owner and a citation that resolves", () => {
    const record = readRecord(ROOT, "reconciliation");
    expect(record.residualRegister.length).toBeGreaterThanOrEqual(14);
    for (const residual of record.residualRegister) {
      expect(residual.id, JSON.stringify(residual).slice(0, 60)).toMatch(/^R\d+$/u);
      expect(residual.owner, residual.id).toBeTruthy();
      expect(residual.severity, residual.id).toBeTruthy();
      for (const artifact of residual.evidence ?? []) {
        expect(existsSync(artifact.path), `${residual.id}: ${artifact.path}`).toBe(true);
        expect(sha256(artifact.path), `${residual.id}: ${artifact.path}`).toBe(artifact.sha256);
      }
    }
  });

  it("keeps the residuals this goal must not be read as having closed", () => {
    const ids = new Set(readRecord(ROOT, "reconciliation").residualRegister.map((r) => r.title));
    const joined = [...ids].join(" | ");
    expect(joined).toMatch(/D-11/u);
    expect(joined).toMatch(/shed-tone/u);
    expect(joined).toMatch(/Cross-machine determinism/u);
    expect(joined).toMatch(/Eviction policy is NONE/u);
  });
});

describe("the amendment discipline", () => {
  it("leaves the amended record BYTE-IDENTICAL to its own sidecar", () => {
    // The entire convention rests on this. If the amended document can drift,
    // an amendment-by-statement is just an edit with extra steps.
    for (const name of ["reconciliation", "refusal-code-mapping"]) {
      const text = readText(join(AMENDED, `${name}.json`));
      const declared = readText(join(AMENDED, `${name}.sha256`)).trim().split(/\s+/u)[0];
      expect(createHash("sha256").update(text).digest("hex"), `${name}.json in the AMENDED record has drifted`).toBe(declared);
    }
  });

  it("does not change the amended verdict, and says so", () => {
    const amendment = readRecord(ROOT, "reconciliation").amendments.find((a) => a.criterion === 4);
    expect(amendment).toBeDefined();
    expect(amendment.amends).toBe("data/exterior-completion-acceptance-20260817/reconciliation.json");
    expect(amendment.change).toMatch(/NO VERDICT CHANGE/u);
    expect(amendment.historyPreserved).toMatch(/NOT edited/u);
  });

  it("cites the amended record by path and task only, never by hash", () => {
    // The convention that record set for itself: it embeds successor hashes in
    // its own closures, so a hash citation here would be circular.
    const amendment = readRecord(ROOT, "reconciliation").amendments.find((a) => a.criterion === 4);
    expect(amendment.citationConvention).toMatch(/never by hash/u);
    expect(amendment).not.toHaveProperty("amendsSha256");
  });

  it("leaves the goal's own criterion 4 NOT-MET", () => {
    // The amendment characterises an evidence gap. It does not close one, and a
    // future edit that quietly promotes it should fail here.
    const criterion = readRecord(ROOT, "reconciliation").verdicts.find((v) => v.index === 4);
    expect(criterion.verdict).toBe("NOT-MET");
    expect(criterion.stopReport).toMatch(/characterised, not closed/u);
  });
});

describe("the completion decision is presented, not taken", () => {
  it("states plainly that it is the user's", () => {
    const decision = readRecord(ROOT, "reconciliation").completionDecision;
    expect(decision.statement).toMatch(/DOES NOT TAKE THE COMPLETION DECISION/u);
    expect(decision.theQuestionForTheUser).toBeTruthy();
  });

  it("lays out both sides rather than only the passing one", () => {
    const decision = readRecord(ROOT, "reconciliation").completionDecision;
    expect(decision.whatIsHonestlyNOTMET.length).toBe(4);
    expect(decision.whatIsMETWithAdjudication.length).toBeGreaterThanOrEqual(5);
    expect(decision.whatThisRecordWillNotDo).toMatch(/Flip a NOT-MET to MET/u);
  });
});
