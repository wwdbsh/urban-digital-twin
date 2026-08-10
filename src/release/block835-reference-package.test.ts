import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import releaseJson from "../../public/data/manhattan-esb-block-exterior-pilot-20260805/release.json";
import { BLOCK_835_DOITT_IDS } from "../domain/commercial-frontage";
import { DETERMINISTIC_FACADE_UNCERTAINTY, validateDeterministicFacadePlan } from "../domain/deterministic-facade-generator";
import { REQUIRED_EXTERIOR_COMPONENT_KINDS } from "../domain/exterior-contract";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash";
import {
  BLOCK835_NO_EVIDENCE_SHARD_ID,
  BLOCK835_QUALITY_BUDGETS,
  BLOCK835_REGISTRATION_TOLERANCE,
  assembleBlock835ReferencePackage,
  buildBuildingPlan,
  decidePackageTarget,
  deriveBaseIdentityChecksum,
  planToEnu,
  readPilotBuildings,
  tessellatePlan,
  toGltfYUp,
  type SilhouetteMeasurementFile,
} from "./block835-reference-package";
import { multiLodAssemblyFingerprint, replayMultiLodAssembly, serializeMultiLodAssembly } from "./multi-lod-assembly";

const release = releaseJson as unknown;
// Must digest the raw release.json bytes exactly as the build CLI does, or the
// pinned release/predecessor checksums diverge from the committed package.
function readBytes(path: string): Uint8Array { return new Uint8Array(readFileSync(path)); }
function readText(path: string): string { return new TextDecoder("utf-8", { fatal: true }).decode(readBytes(path)); }
const RELEASE_CHECKSUM = sha256HexBytes(readBytes("public/data/manhattan-esb-block-exterior-pilot-20260805/release.json"));

function measurements(): SilhouetteMeasurementFile {
  return {
    schemaVersion: "1.0",
    packageId: "manhattan-esb-block-reference-20260810",
    method: "projected-silhouette-ratio",
    metricVersion: "1.0",
    tool: "blender-mcp",
    measuredAt: "2026-08-10T00:00:00.000Z",
    buildings: readPilotBuildings(release).map((building) => ({
      canonicalBuildingId: building.canonicalBuildingId,
      planHashSha256: buildBuildingPlan(building).plan.planHashSha256,
      viewIds: ["view:east", "view:north", "view:south", "view:west"],
      deviationRatio: 0.001,
    })),
  };
}

describe("Block 835 generated-exterior reference package", () => {
  it("derives the base identity set from exactly the 14 pinned pilot buildings", () => {
    const buildings = readPilotBuildings(release);
    const expected = [...BLOCK_835_DOITT_IDS].map((id) => `doitt:${id}`).sort();
    expect(buildings.map((building) => building.canonicalBuildingId).sort()).toEqual(expected);
    // The checksum rule must stay identical to `exterior-release.ts` ownership.
    expect(deriveBaseIdentityChecksum(buildings.map((building) => building.canonicalBuildingId))).toBe(sha256HexSync(stableSerialize([...expected].sort())));
  });

  it("emits canonical facade plans with the full component inventory and no evidence-backed claim", () => {
    for (const building of readPilotBuildings(release)) {
      const { plan } = buildBuildingPlan(building);
      expect(validateDeterministicFacadePlan(plan).ok).toBe(true);
      expect(plan.inventory.components.map((component) => component.kind).sort()).toEqual([...REQUIRED_EXTERIOR_COMPONENT_KINDS].sort());
      expect(plan.inventory.components.every((component) => component.state === "generated" || component.state === "absent")).toBe(true);
      expect(plan.uncertainty).toBe(DETERMINISTIC_FACADE_UNCERTAINTY);
      expect(plan.placements.some((placement) => placement.kind === "roof-equipment")).toBe(true);
      // Zero tenant, brand or signage assertions: signage stays explicitly
      // absent, and absence is stated as "not generated", never as "not there".
      const signage = plan.inventory.components.find((component) => component.kind === "signage")!;
      expect(signage.state).toBe("absent");
      expect(signage.state === "absent" ? signage.reason : "").toContain("this is not a claim");
      expect(plan.placements.some((placement) => placement.materialId === "material:glazing" && placement.kind === "window")).toBe(true);
    }
  });

  it("registers the exported massing against the pinned source footprint and height", () => {
    const assembled = assembleBlock835ReferencePackage({ release, releaseChecksumSha256: RELEASE_CHECKSUM, measurements: measurements() });
    expect(assembled.registration).toHaveLength(14);
    for (const entry of assembled.registration) {
      expect(entry.horizontalDeviationMeters).toBeLessThanOrEqual(BLOCK835_REGISTRATION_TOLERANCE.horizontalMeters);
      expect(entry.verticalDeviationMeters).toBeLessThanOrEqual(BLOCK835_REGISTRATION_TOLERANCE.verticalMeters);
      expect(entry.withinTolerance).toBe(true);
    }
  });

  it("replays byte-identically twice through the multi-LOD assembly contract", async () => {
    const first = assembleBlock835ReferencePackage({ release, releaseChecksumSha256: RELEASE_CHECKSUM, measurements: measurements() });
    const second = assembleBlock835ReferencePackage({ release, releaseChecksumSha256: RELEASE_CHECKSUM, measurements: measurements() });
    expect(multiLodAssemblyFingerprint(first.manifest)).toBe(multiLodAssemblyFingerprint(second.manifest));
    for (const [ref, bytes] of first.contents) expect(sha256HexBytes(bytes)).toBe(sha256HexBytes(second.contents.get(ref)!));

    const replay = await replayMultiLodAssembly(first.manifest, first.contents, { requireTextureFreeAssembly: true });
    expect(replay.ok ? null : replay.issues).toBeNull();
  });

  it("keeps every shipped asset inside the approved budgets and truth envelope", () => {
    const assembled = assembleBlock835ReferencePackage({ release, releaseChecksumSha256: RELEASE_CHECKSUM, measurements: measurements() });
    expect(assembled.manifest.audience).toBe("private");
    for (const asset of assembled.manifest.assets) {
      expect(asset.truthTiers).not.toContain("evidence-backed");
      expect(asset.evidenceShardId).toBe(BLOCK835_NO_EVIDENCE_SHARD_ID);
      expect(asset.source.kind).toBe("facade-plan");
      expect(asset.uncertainty).toBe(DETERMINISTIC_FACADE_UNCERTAINTY);
      expect(asset.lods.map((lod) => lod.lodId)).toEqual(["lod_0", "lod_1"]);
      expect(asset.lods[0]!.geometricErrorMeters).toBe(0);
      expect(asset.lods[0]!.silhouette).toBeNull();
      expect(asset.lods[1]!.silhouette?.deviationRatio).toBeLessThanOrEqual(0.02);
      for (const lod of asset.lods) {
        expect(lod.quality.triangleCount).toBeLessThanOrEqual(BLOCK835_QUALITY_BUDGETS.maxTriangles);
        expect(lod.quality.materialCount).toBeLessThanOrEqual(BLOCK835_QUALITY_BUDGETS.maxMaterials);
        expect(lod.quality.textureCount).toBe(0);
      }
      expect(asset.lods[1]!.quality.triangleCount).toBeLessThanOrEqual(asset.lods[0]!.quality.triangleCount);
    }
    for (const artifact of assembled.manifest.artifacts) expect(artifact.relativeRef.startsWith("private/")).toBe(true);
  });

  it("ships +Y-up glTF content while keeping tile-frame geometry in z-up ENU", () => {
    const assembled = assembleBlock835ReferencePackage({ release, releaseChecksumSha256: RELEASE_CHECKSUM, measurements: measurements() });
    const building = readPilotBuildings(release)[0]!;
    const context = buildBuildingPlan(building);
    const enu = planToEnu(context, tessellatePlan(context.plan, { includeFacadeDetail: false }).quads);
    const gltf = toGltfYUp(enu);
    // glTF 2.0 mandates +Y up and 3D Tiles re-rotates y-up to z-up, so the file
    // must carry (east, height, -north) or every building renders on its side.
    expect(gltf[0]!.corners[0]).toEqual([enu[0]!.corners[0][0], enu[0]!.corners[0][2], -enu[0]!.corners[0][1]]);
    const enuHeight = Math.max(...enu.flatMap((quad) => quad.corners.map((corner) => corner[2])));
    expect(Math.max(...gltf.flatMap((quad) => quad.corners.map((corner) => corner[1])))).toBe(enuHeight);

    // Tile bounding volumes stay in the z-up ENU tile frame: the vertical half
    // axis must track building height, not the horizontal footprint.
    const tileset = JSON.parse(new TextDecoder().decode(assembled.contents.get(assembled.manifest.tilesetRef)!)) as {
      root: { children: Array<{ boundingVolume: { box: number[] }; transform: number[] }> };
    };
    for (const child of tileset.root.children) {
      expect(child.boundingVolume.box[11]).toBeGreaterThan(0);
      expect(child.transform.slice(0, 12)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
      expect(child.transform[14]).toBe(0);
    }
    const esb = assembled.registration.find((entry) => entry.canonicalBuildingId === "doitt:778052")!;
    expect(esb.exportedRoofElevationMeters).toBeGreaterThan(300);
  });

  it("keeps the committed package on disk identical to a fresh deterministic build", () => {
    // Rebuilt from the committed inputs, not synthetic ones, so this is a true
    // drift gate over the frozen package.
    const committedMeasurements = JSON.parse(readText("data/manhattan-esb-block-reference-20260810/silhouette-measurements.json")) as SilhouetteMeasurementFile;
    const assembled = assembleBlock835ReferencePackage({ release, releaseChecksumSha256: RELEASE_CHECKSUM, measurements: committedMeasurements });
    const root = "public/data/manhattan-esb-block-reference-20260810/";
    const committed = JSON.parse(readText(`${root}manifest.json`)) as typeof assembled.manifest;
    // A tessellation change that is not rebuilt must fail here rather than
    // silently leaving the frozen package stale.
    expect(multiLodAssemblyFingerprint(committed)).toBe(multiLodAssemblyFingerprint(assembled.manifest));
    expect(serializeMultiLodAssembly(committed)).toBe(serializeMultiLodAssembly(assembled.manifest));
    for (const artifact of committed.artifacts) {
      const bytes = readBytes(`${root}${artifact.relativeRef}`);
      expect(bytes.byteLength).toBe(artifact.byteSize);
      expect(sha256HexBytes(bytes)).toBe(artifact.checksumSha256);
      expect(sha256HexBytes(assembled.contents.get(artifact.relativeRef)!)).toBe(artifact.checksumSha256);
    }
  });

  it("refuses to recursively delete any build target that is not this package", () => {
    const base = { packageDir: "/repo/public/data/pkg", scratchRoot: "/repo/artifacts", separator: "/" } as const;
    // `build` deletes its target, so an operator typo aimed at a pinned
    // immutable release must be refused before anything is removed.
    expect(decidePackageTarget({ ...base, targetDir: "/repo/public/data/manhattan-esb-block-exterior-pilot-20260805", existing: "directory", existingManifest: null }))
      .toEqual({ allowed: false, reason: expect.stringContaining("Refusing to write outside the package directory") as unknown as string });
    expect(decidePackageTarget({ ...base, targetDir: "/repo/artifacts-elsewhere", existing: "absent", existingManifest: null }).allowed).toBe(false);
    expect(decidePackageTarget({ ...base, targetDir: "/repo/artifacts/scratch", existing: "directory", existingManifest: null }).reason)
      .toContain("no manhattan-esb-block-reference-20260810 manifest");
    expect(decidePackageTarget({ ...base, targetDir: "/repo/artifacts/scratch", existing: "directory", existingManifest: JSON.stringify({ packageId: "manhattan-esb-block-exterior-pilot-20260805" }) }).reason)
      .toContain("owned by another package");
    expect(decidePackageTarget({ ...base, targetDir: "/repo/artifacts/scratch", existing: "directory", existingManifest: "not json" }).reason)
      .toContain("manifest is unreadable");
    expect(decidePackageTarget({ ...base, targetDir: "/repo/artifacts/scratch", existing: "file", existingManifest: null }).reason)
      .toContain("non-directory target");

    // Allowed: the canonical package directory, and scratch holding this package.
    expect(decidePackageTarget({ ...base, targetDir: "/repo/public/data/pkg", existing: "directory", existingManifest: JSON.stringify({ packageId: "manhattan-esb-block-reference-20260810" }) }).allowed).toBe(true);
    expect(decidePackageTarget({ ...base, targetDir: "/repo/artifacts/scratch", existing: "absent", existingManifest: null }).allowed).toBe(true);
  });

  it("rejects a silhouette measurement that is not bound to the shipped plan", () => {
    const stale = measurements();
    stale.buildings[0]!.planHashSha256 = "0".repeat(64);
    expect(() => assembleBlock835ReferencePackage({ release, releaseChecksumSha256: RELEASE_CHECKSUM, measurements: stale })).toThrow(/plan hash/iu);
  });
});
