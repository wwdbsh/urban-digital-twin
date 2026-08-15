import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sha256HexBytes } from "../domain/deterministic-hash.ts";
import {
  ASSEMBLY_ISSUE_TEXTURE_REPLAY_MISMATCH,
  replayMultiLodAssembly,
  validateMultiLodAssembly,
  type MultiLodAssemblyManifest,
} from "./multi-lod-assembly.ts";
import { proceduralTextureReplayIndex } from "./procedural-texture.ts";

/**
 * The two fail-closed properties ADR 0046's retain decision rests on.
 *
 * ADR 0046 keeps the generated payload bytes rather than regenerating them in
 * the browser, and it argues that retaining them is safe because the bytes stay
 * STRUCTURALLY PROVABLE: a clone with the payload absent refuses rather than
 * degrades, and a payload whose embedded imagery is not what this repository's
 * own rasterizer produces refuses too. Both are asserted here rather than
 * described, so a change that quietly relaxes either one fails a gate.
 *
 * The committed Block 835 `-v3e` package is the fixture: it is the one
 * generated-exterior package whose bytes are git-tracked, so this test runs on a
 * fresh clone with no local payload build. The textured waves' payload
 * directories are deliberately untracked, which is exactly the fresh-clone
 * condition the first case models.
 */
const PACKAGE_DIRECTORY = "public/data/manhattan-esb-block-reference-20260811-v3e";

/** The house read pattern: this project types `readFileSync` as bytes-only. */
function read(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
function json(path: string): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read(path))) as unknown;
}

function readManifest(): MultiLodAssemblyManifest {
  const parsed = json(`${PACKAGE_DIRECTORY}/manifest.json`);
  const shape = validateMultiLodAssembly(parsed);
  if (!shape.ok) throw new Error(`fixture manifest is invalid: ${JSON.stringify(shape.issues)}`);
  return shape.value;
}

function readContents(manifest: MultiLodAssemblyManifest): Map<string, Uint8Array> {
  const contents = new Map<string, Uint8Array>();
  for (const artifact of manifest.artifacts) {
    contents.set(artifact.relativeRef, read(`${PACKAGE_DIRECTORY}/${artifact.relativeRef}`));
  }
  return contents;
}

describe("citywide retention fail-closed properties", () => {
  it("verifies the committed payload when it is present", async () => {
    const manifest = readManifest();
    const replay = await replayMultiLodAssembly(manifest, readContents(manifest));
    expect(replay.ok ? [] : replay.issues).toEqual([]);
    expect(replay.ok && replay.value.verifiedArtifacts.length).toBe(manifest.artifacts.length);
  });

  it("REFUSES when a retained payload artifact is absent, and names the artifact", async () => {
    const manifest = readManifest();
    const contents = readContents(manifest);
    const absent = [...contents.keys()].sort()[0]!;
    contents.delete(absent);

    const replay = await replayMultiLodAssembly(manifest, contents);
    expect(replay.ok).toBe(false);
    const issues = replay.ok ? [] : replay.issues;
    // Fail-closed AND legible: the refusal names the missing artifact rather
    // than reporting a count, which is what an operator on a fresh clone needs.
    expect(issues.some((issue) => issue.path === `contents.${absent}`)).toBe(true);
    expect(issues.some((issue) => issue.message === "Declared raw Uint8Array content is missing.")).toBe(true);
  });

  it("REFUSES a whole payload when every artifact is absent, rather than reporting an empty success", async () => {
    const manifest = readManifest();
    const replay = await replayMultiLodAssembly(manifest, new Map());
    expect(replay.ok).toBe(false);
    const issues = replay.ok ? [] : replay.issues;
    expect(issues.length).toBeGreaterThanOrEqual(manifest.artifacts.length);
  });

  it("resolves every procedural tile this repository ships by regenerating it, so a tampered image cannot resolve", () => {
    // The honesty gate's whole mechanism: the index is built by RASTERIZING each
    // tile and hashing the result, so membership in it is proof the bytes are
    // ones this repository produces rather than a declaration that they are.
    const replay = proceduralTextureReplayIndex();
    expect(replay.size).toBeGreaterThan(0);

    for (const digest of replay.keys()) {
      expect(replay.get(digest)).toBeTruthy();
      // A single flipped bit in the digest space is what a re-encoded or
      // substituted image looks like to the gate.
      const tampered = `${digest.slice(0, -1)}${digest.endsWith("0") ? "1" : "0"}`;
      expect(replay.get(tampered)).toBeUndefined();
    }
    expect(ASSEMBLY_ISSUE_TEXTURE_REPLAY_MISMATCH).toContain("byte-identical");
  });

  it("keeps the committed checksum record usable without the payload directory", () => {
    // The inventories are the committed record that survives payload deletion.
    // A retain decision that could not be reversed cheaply would be a trap; this
    // is the evidence that the reversal direction is a file deletion plus an
    // inventory revert, and that the inventory alone still pins every byte.
    const inventory = json("data/lower-manhattan-20260812-p1/payload-inventory.json") as {
      files: { path: string; byteSize: number; checksumSha256: string }[];
    };
    const glbs = inventory.files.filter((file) => file.path.endsWith(".glb"));
    expect(glbs.length).toBeGreaterThan(0);
    for (const file of glbs) {
      expect(file.checksumSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(file.byteSize).toBeGreaterThan(0);
    }
    // Sanity: the digest format the inventory pins is the one the gate compares.
    expect(sha256HexBytes(new Uint8Array([0]))).toMatch(/^[0-9a-f]{64}$/u);
  });
});
