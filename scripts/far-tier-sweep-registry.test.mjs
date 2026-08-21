/**
 * The emit path that would have destroyed the only record of sweep-2.
 *
 * `sweep-poses.json` is DERIVED from the ledger, so re-running `emit` looks like
 * a no-op. It was not. Sweep-2's registration — its settle rule, its vehicle
 * note, and the disclosure that one capture pass was discarded — lives in that
 * file under `sweeps[]`, and the tool has no way to reconstruct any of it,
 * because none of it is derivable from a ledger. A routine `emit` would have
 * overwritten the record AND rewritten the sidecar to the pre-amendment digest,
 * so the result would have verified cleanly and lost the evidence silently.
 *
 * The tool now fails closed. These tests hold that shut.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { refusalToOverwrite } from "./far-tier-sweep-registry-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const promotionRoot = join(repositoryRoot, "data", "far-tier-hlod-promotion-20260819");

const scratch = () => mkdtemp(join(tmpdir(), "far-tier-registry-"));
const EMITTED = `${JSON.stringify({ recordId: "x", poses: [{ poseId: "P1" }] }, null, 2)}\n`;

describe("refusalToOverwrite", () => {
  it("allows the first emit, when there is nothing to lose", async () => {
    expect(await refusalToOverwrite("sweep-poses", EMITTED, false, await scratch())).toBeNull();
  });

  it("allows an idempotent re-emit", async () => {
    const root = await scratch();
    await writeFile(join(root, "sweep-poses.json"), EMITTED);
    expect(await refusalToOverwrite("sweep-poses", EMITTED, false, root)).toBeNull();
  });

  it("REFUSES when the record carries a key the tool does not derive, and names it", async () => {
    // The exact shape of the near-miss: sweeps[] and sweepsNote appended by
    // hand, everything else identical.
    const root = await scratch();
    const amended = JSON.parse(EMITTED);
    amended.sweeps = [{ sweepId: "sweep-2", settleRule: "…" }];
    amended.sweepsNote = "appending a sweep never rewrites an earlier one";
    await writeFile(join(root, "sweep-poses.json"), `${JSON.stringify(amended, null, 2)}\n`);

    const refusal = await refusalToOverwrite("sweep-poses", EMITTED, false, root);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("REFUSING to overwrite sweep-poses.json");
    expect(refusal).toContain("Top-level keys that would be LOST: sweeps, sweepsNote.");
    // The operator must be told how to proceed, or the refusal is just a wall.
    expect(refusal).toContain("--force");
  });

  it("REFUSES on any byte difference, even when no key would be dropped", async () => {
    // Indentation, a reworded field, a reordered array: all of it is content
    // somebody may have committed on purpose.
    const root = await scratch();
    await writeFile(join(root, "sweep-poses.json"), `${JSON.stringify(JSON.parse(EMITTED), null, 1)}\n`);
    const refusal = await refusalToOverwrite("sweep-poses", EMITTED, false, root);
    expect(refusal).toContain("No top-level key would be dropped, but the bytes still differ.");
  });

  it("still refuses to be quiet under --force: it permits the write and says what it destroys", async () => {
    const root = await scratch();
    const amended = JSON.parse(EMITTED);
    amended.sweeps = [{ sweepId: "sweep-2" }];
    await writeFile(join(root, "sweep-poses.json"), `${JSON.stringify(amended, null, 2)}\n`);
    expect(await refusalToOverwrite("sweep-poses", EMITTED, true, root)).toBeNull();
  });

  it("does not mistake unreadable JSON for a safe overwrite", async () => {
    const root = await scratch();
    await writeFile(join(root, "sweep-poses.json"), "{ not json");
    const refusal = await refusalToOverwrite("sweep-poses", EMITTED, false, root);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("REFUSING to overwrite");
  });

  it("guards the exemption set on the same path, not only the pose registry", async () => {
    const root = await scratch();
    await writeFile(join(root, "sweep-exemptions.json"), `${JSON.stringify({ a: 1 }, null, 2)}\n`);
    expect(await refusalToOverwrite("sweep-exemptions", EMITTED, false, root)).not.toBeNull();
  });
});

describe("the committed record the guard is protecting", () => {
  it("still carries sweep-2's registration and its disclosures", async () => {
    const poses = JSON.parse(await readFile(join(promotionRoot, "sweep-poses.json"), "utf8"));
    const sweep2 = poses.sweeps.find((entry) => entry.sweepId === "sweep-2");
    expect(sweep2).toBeDefined();
    expect(sweep2.discardedCapture).toBeDefined();
    expect(sweep2.settleRule).toBeDefined();
    // The pose definitions are SHARED by both sweeps and were not re-chosen
    // after sweep-1's failure. That is the property a reader can verify.
    expect(poses.poses.map((pose) => pose.poseId)).toEqual(sweep2.posesUnchanged);
  });

  it("does not claim the sweep-2 prose was written before the captures", async () => {
    // It was not: the settle rule was written after the first pass was
    // discarded. The record says so in both places rather than in neither.
    const poses = JSON.parse(await readFile(join(promotionRoot, "sweep-poses.json"), "utf8"));
    const sweep2 = poses.sweeps.find((entry) => entry.sweepId === "sweep-2");
    expect(sweep2.registeredBefore).toContain("THAT WAS FALSE and is withdrawn");
    expect(sweep2.settleRule.statement).toContain("before any ACCEPTED capture");
    expect(sweep2.settleRule.statement).toContain("WRITTEN AFTER the first capture pass was discarded");
    // What WAS genuinely pre-registered is named with its commit, so the claim
    // is checkable instead of asserted.
    expect(sweep2.registeredBefore).toContain("3c5c64f");
    expect(sweep2.settleRule.statement).toContain("3c5c64f");
  });

  it("keeps every record digest-consistent with its sidecar", () => {
    for (const name of ["promoted-inventory", "sweep-exemptions", "sweep-poses", "sweep-results"]) {
      const declared = readFileSync(join(promotionRoot, `${name}.sha256`), "utf8").trim().split(/\s+/u)[0];
      const bytes = readFileSync(join(promotionRoot, `${name}.json`));
      const actual = createHash("sha256").update(bytes).digest("hex");
      expect(actual, name).toBe(declared);
    }
  });
});
