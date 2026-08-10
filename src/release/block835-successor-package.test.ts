import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import { DETERMINISTIC_FACADE_V2_UNCERTAINTY } from "../domain/deterministic-facade-generator-v2";
import { sha256HexBytes } from "../domain/deterministic-hash";
import {
  BLOCK835_QUALITY_BUDGETS,
  type SilhouetteMeasurementFile,
} from "./block835-reference-package";
import {
  BLOCK835_SUCCESSOR_LOD1_GEOMETRIC_ERROR_METERS,
  assembleBlock835SuccessorPackage,
  successorEvidenceShardId,
  successorPredecessorPins,
  type AssembledSuccessor,
} from "./block835-successor-package";
import {
  multiLodAssemblyFingerprint,
  replayMultiLodAssembly,
  serializeMultiLodAssembly,
  type MultiLodAssemblyManifest,
} from "./multi-lod-assembly";

const release = releaseJson as unknown;
// Vitest runs from the repository root, and the release checksum must digest the
// raw `release.json` bytes exactly as the build CLI does, or the pinned
// release/predecessor checksums diverge from the committed package.
function readBytes(path: string): Uint8Array { return new Uint8Array(readFileSync(path)); }
function readText(path: string): string { return new TextDecoder("utf-8", { fatal: true }).decode(readBytes(path)); }
const RELEASE_CHECKSUM = sha256HexBytes(readBytes("public/data/manhattan-esb-block-exterior-pilot-20260805/release.json"));

const SUCCESSOR_ROOT = "public/data/manhattan-esb-block-reference-20260811/";
const PREDECESSOR_ROOT = "public/data/manhattan-esb-block-reference-20260810/";
/** Frozen identity of the V1 package this one supersedes without editing. */
const PREDECESSOR_PACKAGE_ID = "manhattan-esb-block-reference-20260810";
const PREDECESSOR_FINGERPRINT = "8b0bd07b94b74a0e62ffb6657c76aecf4d638fa0178a40bfe8a1342679d4f26c";
const NO_EVIDENCE_SENTINEL_PREFIX = "evidence-shard:none:";

function committedManifest(root: string): MultiLodAssemblyManifest {
  return JSON.parse(readText(`${root}manifest.json`)) as MultiLodAssemblyManifest;
}

/**
 * A single build from the *committed* inputs: the pinned pilot release digested
 * as raw bytes, the committed Blender silhouette measurements, and the frozen
 * 20260810 manifest for predecessor pins. Every assertion below reads this one
 * build so a drift in any committed input fails the whole file, not one case.
 */
let cached: AssembledSuccessor | null = null;
function assembled(): AssembledSuccessor {
  cached ??= assembleBlock835SuccessorPackage({
    release,
    releaseChecksumSha256: RELEASE_CHECKSUM,
    measurements: JSON.parse(readText("data/manhattan-esb-block-reference-20260811/silhouette-measurements.json")) as SilhouetteMeasurementFile,
    predecessor: successorPredecessorPins(committedManifest(PREDECESSOR_ROOT)),
  });
  return cached;
}

describe("Block 835 generative-completion successor package", () => {
  it("ships every asset as entirely generated geometry with no absent or evidence-backed component", () => {
    const manifest = assembled().manifest;
    expect(manifest.assets).toHaveLength(14);
    for (const asset of manifest.assets) {
      // V2 cannot express `absent`: the five kinds V1 declared absent are now
      // real geometry, so a single `generated` tier is the whole truth envelope.
      expect(asset.truthTiers).toEqual(["generated"]);
      expect(asset.truthTiers).not.toContain("absent");
      expect(asset.truthTiers).not.toContain("evidence-backed");
      expect(asset.uncertainty).toBe(DETERMINISTIC_FACADE_V2_UNCERTAINTY);
      expect(asset.source.kind).toBe("facade-plan");
    }
  });

  it("binds every asset to its truthful per-building evidence shard rather than the 20260810 sentinel", () => {
    for (const asset of assembled().manifest.assets) {
      expect(asset.evidenceShardId).toBe(successorEvidenceShardId(asset.canonicalFeatureId));
      expect(asset.evidenceShardId).toContain(asset.canonicalFeatureId);
      // The 20260810 package named the absence of evidence; this one points at a
      // shard the canary graph actually carries, so the sentinel must be gone.
      expect(asset.evidenceShardId.startsWith(NO_EVIDENCE_SENTINEL_PREFIX)).toBe(false);
      for (const lod of asset.lods) expect(lod.artifactRef.startsWith("private/")).toBe(true);
    }
    expect(new Set(assembled().manifest.assets.map((asset) => asset.evidenceShardId)).size).toBe(14);
  });

  it("pins the frozen 20260810 package as its predecessor at cell and asset level", () => {
    const previous = committedManifest(PREDECESSOR_ROOT);
    const manifest = assembled().manifest;
    // Supersession is expressed by pins, never by editing the predecessor.
    expect(manifest.cells[0]!.predecessor).toEqual(previous.cells[0]!.cellRelease);
    for (const asset of manifest.assets) {
      const previousAsset = previous.assets.find((entry) => entry.canonicalFeatureId === asset.canonicalFeatureId);
      const previousLod0 = previousAsset?.lods.find((lod) => lod.lodId === "lod_0");
      const previousArtifact = previous.artifacts.find((entry) => entry.relativeRef === previousLod0?.artifactRef);
      expect(previousArtifact).toBeDefined();
      expect(asset.predecessor?.id).toBe(`${PREDECESSOR_PACKAGE_ID}:${asset.canonicalFeatureId}:lod_0`);
      expect(asset.predecessor?.checksumSha256).toBe(previousArtifact!.checksumSha256);
    }
  });

  it("keeps every LOD inside the approved triangle, material and texture budgets", () => {
    for (const asset of assembled().manifest.assets) {
      expect(asset.lods.map((lod) => lod.lodId)).toEqual(["lod_0", "lod_1"]);
      for (const lod of asset.lods) {
        expect(lod.quality.triangleCount).toBeLessThanOrEqual(BLOCK835_QUALITY_BUDGETS.maxTriangles);
        expect(lod.quality.materialCount).toBeLessThanOrEqual(BLOCK835_QUALITY_BUDGETS.maxMaterials);
        expect(lod.quality.textureCount).toBe(0);
      }
      // LOD 1 drops only recesses and flush trim, so it is never heavier than
      // LOD 0 and — because only protrusions move a silhouette — never deviates.
      expect(asset.lods[1]!.quality.triangleCount).toBeLessThanOrEqual(asset.lods[0]!.quality.triangleCount);
      expect(asset.lods[0]!.geometricErrorMeters).toBe(0);
      expect(asset.lods[0]!.silhouette).toBeNull();
      expect(asset.lods[1]!.geometricErrorMeters).toBe(BLOCK835_SUCCESSOR_LOD1_GEOMETRIC_ERROR_METERS);
      expect(asset.lods[1]!.silhouette?.deviationRatio).toBeLessThanOrEqual(0.02);
    }
  });

  it("keeps the committed successor package on disk identical to a fresh deterministic build", () => {
    const built = assembled();
    const committed = committedManifest(SUCCESSOR_ROOT);
    // Rebuilt from the committed inputs, not synthetic ones, so a grammar or
    // tessellation change can no longer leave the shipped package stale.
    expect(multiLodAssemblyFingerprint(committed)).toBe(multiLodAssemblyFingerprint(built.manifest));
    expect(serializeMultiLodAssembly(committed)).toBe(serializeMultiLodAssembly(built.manifest));
    expect(committed.artifacts).toHaveLength(29);
    for (const artifact of committed.artifacts) {
      const bytes = readBytes(`${SUCCESSOR_ROOT}${artifact.relativeRef}`);
      expect(bytes.byteLength).toBe(artifact.byteSize);
      expect(sha256HexBytes(bytes)).toBe(artifact.checksumSha256);
      expect(sha256HexBytes(built.contents.get(artifact.relativeRef)!)).toBe(artifact.checksumSha256);
    }
    expect(committed.declaredTotalBytes).toBe(committed.artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0));
  });

  it("replays through the multi-LOD assembly contract with texture-free enforced", async () => {
    const built = assembled();
    const replay = await replayMultiLodAssembly(built.manifest, built.contents, { requireTextureFreeAssembly: true });
    expect(replay.ok ? null : replay.issues).toBeNull();
  });

  it("leaves the frozen 20260810 package untouched by the V2 grammar", () => {
    const previous = committedManifest(PREDECESSOR_ROOT);
    expect(previous.packageId).toBe(PREDECESSOR_PACKAGE_ID);
    expect(multiLodAssemblyFingerprint(previous)).toBe(PREDECESSOR_FINGERPRINT);
    // No V2 identifier may leak backwards into the frozen package: it must keep
    // citing the V1 plan ids and its own no-evidence sentinel.
    const serialized = serializeMultiLodAssembly(previous);
    expect(serialized).not.toContain("20260811");
    expect(serialized).not.toContain("facade-plan-v2");
    expect(serialized).not.toContain(DETERMINISTIC_FACADE_V2_UNCERTAINTY);
    for (const asset of previous.assets) expect(asset.evidenceShardId.startsWith(NO_EVIDENCE_SENTINEL_PREFIX)).toBe(true);
  });
});
