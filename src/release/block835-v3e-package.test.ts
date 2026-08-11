/**
 * Drift gate for the committed `-v3e` package.
 *
 * `-v3` has had a rebuild-versus-committed test since T025; `-v3e` — the
 * evidence-cited successor this build actually promotes — shipped without one,
 * and its determinism fingerprint existed only in prose. A committed package
 * whose only record of correctness is a sentence in a document is a package
 * nobody is checking: an edit to the intake ledger, the override map, the
 * uncertainty resolution or the writer would move these bytes silently.
 *
 * The fingerprint below was obtained by REBUILDING, not by copying the number
 * out of the implementation record.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import {
  DETERMINISTIC_FACADE_V3_CITED_STYLE_UNCERTAINTY,
  DETERMINISTIC_FACADE_V3_UNCERTAINTY,
} from "../domain/deterministic-facade-generator-v3.ts";
import { sha256HexBytes } from "../domain/deterministic-hash.ts";
import { type SilhouetteMeasurementFile } from "./block835-reference-package.ts";
import { BLOCK835_V3_STYLE_OVERRIDES } from "./block835-facade-material-intake.ts";
import {
  BLOCK835_V3E_PROFILE,
  BLOCK835_V3_PACKAGE_ID,
  assembleBlock835V3Package,
  v3PredecessorPins,
  type AssembledV3,
} from "./block835-v3-package.ts";
import {
  multiLodAssemblyFingerprint,
  replayMultiLodAssembly,
  serializeMultiLodAssembly,
  type MultiLodAssemblyManifest,
} from "./multi-lod-assembly.ts";

const V3E_ROOT = "public/data/manhattan-esb-block-reference-20260811-v3e/";
const V3_ROOT = "public/data/manhattan-esb-block-reference-20260811-v3/";
const V3E_DATA = "data/manhattan-esb-block-reference-20260811-v3e/";

/**
 * Rebuilt fingerprint of the committed `-v3e` manifest.
 *
 * Verified by rebuild rather than transcribed from the implementation record,
 * which is the whole point of this file.
 */
const V3E_FINGERPRINT = "7acd2a1585518be556fe4ae63a7cd546e9b726d6162b009149d67cea7382c54e";

function readBytes(path: string): Uint8Array { return new Uint8Array(readFileSync(path)); }
function readText(path: string): string { return new TextDecoder("utf-8", { fatal: true }).decode(readBytes(path)); }
function committedManifest(root: string): MultiLodAssemblyManifest {
  return JSON.parse(readText(`${root}manifest.json`)) as MultiLodAssemblyManifest;
}

const RELEASE_CHECKSUM = sha256HexBytes(readBytes("public/data/manhattan-esb-block-exterior-pilot-20260805/release.json"));

let cached: AssembledV3 | null = null;
function assembled(): AssembledV3 {
  cached ??= assembleBlock835V3Package({
    release: releaseJson as unknown,
    releaseChecksumSha256: RELEASE_CHECKSUM,
    measurements: JSON.parse(readText(`${V3E_DATA}silhouette-measurements.json`)) as SilhouetteMeasurementFile,
    // `-v3e` pins `-v3` exactly as `-v3` pins the V2 package.
    predecessor: v3PredecessorPins(committedManifest(V3_ROOT), BLOCK835_V3_PACKAGE_ID),
    profile: BLOCK835_V3E_PROFILE,
  });
  return cached;
}

describe("committed -v3e package versus a fresh deterministic build", () => {
  it("keeps the committed bytes identical to a rebuild", () => {
    const built = assembled();
    const committed = committedManifest(V3E_ROOT);
    expect(multiLodAssemblyFingerprint(committed)).toBe(multiLodAssemblyFingerprint(built.manifest));
    expect(serializeMultiLodAssembly(committed)).toBe(serializeMultiLodAssembly(built.manifest));
    expect(committed.artifacts).toHaveLength(29);
    for (const artifact of committed.artifacts) {
      const bytes = readBytes(`${V3E_ROOT}${artifact.relativeRef}`);
      expect(bytes.byteLength).toBe(artifact.byteSize);
      expect(sha256HexBytes(bytes)).toBe(artifact.checksumSha256);
      // The rebuild produces the same bytes, not merely the same declaration.
      expect(sha256HexBytes(built.contents.get(artifact.relativeRef)!)).toBe(artifact.checksumSha256);
    }
    expect(committed.declaredTotalBytes).toBe(committed.artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0));
  });

  it("pins the rebuilt fingerprint as a constant, so a silent rebuild-and-recommit is still drift", () => {
    // Without this the test above would pass for ANY self-consistent pair of
    // committed bytes and rebuild, including a package somebody quietly
    // regenerated after changing the grammar.
    expect(multiLodAssemblyFingerprint(assembled().manifest)).toBe(V3E_FINGERPRINT);
    expect(multiLodAssemblyFingerprint(committedManifest(V3E_ROOT))).toBe(V3E_FINGERPRINT);
    // A successor is not its predecessor.
    expect(V3E_FINGERPRINT).not.toBe(multiLodAssemblyFingerprint(committedManifest(V3_ROOT)));
  });

  it("leaves the -v3 package it supersedes byte-untouched", () => {
    const v3 = committedManifest(V3_ROOT);
    expect(v3.packageId).toBe(BLOCK835_V3_PACKAGE_ID);
    for (const artifact of v3.artifacts) {
      expect(sha256HexBytes(readBytes(`${V3_ROOT}${artifact.relativeRef}`))).toBe(artifact.checksumSha256);
    }
  });

  it("carries the cited style on exactly the admitted building, and the cited uncertainty with it", () => {
    const manifest = assembled().manifest;
    const cited = manifest.assets.filter((asset) => asset.citedStyle !== undefined);
    expect(cited.map((asset) => asset.canonicalFeatureId)).toEqual(["doitt:778052"]);
    expect([...BLOCK835_V3_STYLE_OVERRIDES.keys()]).toEqual(["doitt:778052"]);
    expect(cited[0]!.uncertainty).toBe(DETERMINISTIC_FACADE_V3_CITED_STYLE_UNCERTAINTY);
    for (const asset of manifest.assets) {
      if (asset.citedStyle !== undefined) continue;
      expect(asset.uncertainty).toBe(DETERMINISTIC_FACADE_V3_UNCERTAINTY);
    }
  });

  it("keeps thirteen plan hashes identical to -v3 and moves only the cited one", () => {
    const built = assembled().manifest;
    const v3 = committedManifest(V3_ROOT);
    const v3ById = new Map(v3.assets.map((asset) => [asset.canonicalFeatureId, asset]));
    const moved: string[] = [];
    for (const asset of built.assets) {
      const previous = v3ById.get(asset.canonicalFeatureId)!;
      const before = previous.source.kind === "facade-plan" ? previous.source.planHashSha256 : null;
      const after = asset.source.kind === "facade-plan" ? asset.source.planHashSha256 : null;
      if (before !== after) moved.push(asset.canonicalFeatureId);
      // Every asset pins the -v3 asset it supersedes, whether or not its plan moved.
      expect(asset.predecessor?.id).toBe(`${BLOCK835_V3_PACKAGE_ID}:${asset.canonicalFeatureId}:lod_0`);
    }
    expect(moved).toEqual(["doitt:778052"]);
  });

  it("replays through the multi-LOD assembly contract with texture-free enforced", async () => {
    const built = assembled();
    const replay = await replayMultiLodAssembly(built.manifest, built.contents);
    expect(replay.ok).toBe(true);
    for (const asset of built.manifest.assets) {
      for (const lod of asset.lods) expect(lod.quality.textureCount).toBe(0);
    }
  });
});
