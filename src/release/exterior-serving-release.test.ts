import { describe, expect, it } from "vitest";

import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { buildFixtureGlb } from "../runtime/exterior-cell-fixtures.ts";
import { createExteriorCellRuntime } from "../runtime/exterior-cell-runtime.ts";
import {
  validateExteriorCellDetailSidecar,
  validateExteriorReleaseGraph,
  type ExteriorArtifactRef,
  type ExteriorRootManifest,
} from "./exterior-release.ts";
import { replayMultiLodAssembly, validateMultiLodAssembly, type MultiLodAssemblyManifest } from "./multi-lod-assembly.ts";
import {
  buildServingCellDetailSidecar,
  buildServingCellRelease,
  buildServingIndex,
  buildServingOwnershipLedger,
  buildServingPrivateRoot,
  buildServingPublicRoot,
  buildServingSnapshot,
  exteriorServingReleaseId,
  exteriorServingRootChecksum,
  servingArtifactBlob,
  servingArtifactRef,
  servingAssemblyBlob,
  servingAssemblyPackageId,
  servingCellReleaseId,
  servingDocumentBlob,
  servingTilesetRef,
  transformRetentionAssemblyToServing,
  transformRetentionTilesetToServing,
} from "./exterior-serving-release.ts";
import { EXTERIOR_SERVING_TEXTURE_ADMISSION, EXTERIOR_SERVING_WAVES, exteriorServingApproval, exteriorServingWave } from "./exterior-serving-waves.ts";
import { EXTERIOR_COMPONENT_SCHEMA_VERSION, REQUIRED_EXTERIOR_COMPONENT_KINDS, type ExteriorComponentInventory } from "../domain/exterior-contract.ts";

/**
 * The pre-seam root-pin definition, kept here verbatim.
 *
 * Every release committed before ADR 0052 §2 was pinned by this exact
 * expression. D-B's whole claim is that the serving definition is bit-identical
 * to it whenever a root declares no `cell-assembly-package`, so the claim is
 * tested against the definition rather than against a remembered digest.
 */
function legacyRootChecksum(root: Omit<ExteriorRootManifest, "rootChecksumSha256">): string {
  return sha256HexSync(stableSerialize({ ...root, rootChecksumSha256: "" }));
}

const CITY = "city:udt-serving-fixture";
const CONFIG = "config:udt-serving-fixture";
const GENERATED_AT = "2026-08-17T00:00:00.000Z";
const RETENTION_RELEASE_ID = "udt-serving-fixture-cells-20260816-c1";
const SERVING_RELEASE_ID = exteriorServingReleaseId(RETENTION_RELEASE_ID);
const CELL_ID = "manhattan-exterior-cell-w09-000001-16-19298-17928";
const BUILDING_IDS = ["doitt:900001", "doitt:900002"] as const;
const REFUSED_ID = "doitt:900003";
const PLAN_HASH = "c".repeat(64);
const BOX = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

function fixtureInventory(buildingId: string): ExteriorComponentInventory {
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    buildingId,
    components: REQUIRED_EXTERIOR_COMPONENT_KINDS.map((kind) => ({
      componentId: `${buildingId}:${kind}`,
      kind,
      state: "generated" as const,
      uncertainty: "Synthetic serving-transform fixture; no real-world claim.",
      generator: {
        id: "urban-digital-twin:serving-fixture",
        version: "1.0.0",
        inputFingerprintSha256: sha256HexSync(`${buildingId}:${kind}`),
        seed: "serving-fixture",
        generatedAt: "2026-08-16T00:00:00.000Z",
        constraintSourceIds: [`source-ref:nyc.building-footprints:${buildingId}`],
      },
    })),
  };
}

function lodQuality(triangleCount: number): MultiLodAssemblyManifest["assets"][number]["lods"][number]["quality"] {
  return { triangleCount, materialCount: 1, textureCount: 0, budgets: { maxTriangles: 200_000, maxMaterials: 12, maxTextures: 4 } };
}

interface RetentionFixture {
  manifest: MultiLodAssemblyManifest;
  tileset: Record<string, unknown>;
  contents: Map<string, Uint8Array>;
}

/**
 * A synthetic RETENTION package in exactly the shape a `-c1` wave writes: one
 * cell, two LODs per asset, one tileset whose every chain is a `lod_1` wrapper
 * around a `lod_0` leaf.
 */
function buildRetentionFixture(): RetentionFixture {
  const contents = new Map<string, Uint8Array>();
  const artifacts: MultiLodAssemblyManifest["artifacts"] = [];
  const assets: MultiLodAssemblyManifest["assets"] = [];
  const chains: unknown[] = [];
  for (const buildingId of BUILDING_IDS) {
    const slug = buildingId.replaceAll(":", "-");
    const lods = (["lod_0", "lod_1"] as const).map((lodId) => {
      const relativeRef = `public/assets/${slug}__${lodId}.glb`;
      const triangleCount = 1;
      const bytes = buildFixtureGlb({
        canonicalFeatureId: buildingId,
        lodId,
        ownerCellId: CELL_ID,
        inventoryId: `inventory:${RETENTION_RELEASE_ID}:${buildingId}`,
        inventoryHashSha256: sha256HexSync(stableSerialize(fixtureInventory(buildingId))),
        evidenceShardId: `evidence-shard:${RETENTION_RELEASE_ID}:${buildingId}`,
        truthTiers: ["generated"],
        sourceDates: { capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" },
        predecessor: null,
        uncertainty: "Synthetic serving-transform fixture; no real-world claim.",
        planHashSha256: PLAN_HASH,
      });
      contents.set(relativeRef, bytes);
      artifacts.push({ logicalId: `glb:${buildingId}:${lodId}`, role: "glb", relativeRef, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes), ownerCellId: CELL_ID });
      return {
        lodId,
        artifactRef: relativeRef,
        geometricErrorMeters: lodId === "lod_0" ? 0 : 0.2,
        maxDistanceMeters: null,
        eligible: true,
        quality: lodQuality(triangleCount),
        silhouette: lodId === "lod_0" ? null : {
          status: "authoring-declared" as const,
          method: "projected-silhouette-ratio" as const,
          metricVersion: "1.0" as const,
          planHashSha256: PLAN_HASH,
          viewIds: ["view:east", "view:north"],
          deviationRatio: 0.001,
          maximumRatio: 0.02 as const,
        },
      };
    });
    assets.push({
      canonicalFeatureId: buildingId,
      ownerCellId: CELL_ID,
      inventoryId: `inventory:${RETENTION_RELEASE_ID}:${buildingId}`,
      inventoryHashSha256: sha256HexSync(stableSerialize(fixtureInventory(buildingId))),
      evidenceShardId: `evidence-shard:${RETENTION_RELEASE_ID}:${buildingId}`,
      truthTiers: ["generated"],
      sourceDates: { capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" },
      predecessor: null,
      uncertainty: "Synthetic serving-transform fixture; no real-world claim.",
      source: { kind: "facade-plan", planId: `facade-plan-v3:${buildingId}`, planHashSha256: PLAN_HASH },
      lods,
    });
    chains.push({
      boundingVolume: { box: BOX },
      geometricError: 0.2,
      refine: "REPLACE",
      content: { uri: `../../assets/${slug}__lod_1.glb` },
      children: [{ boundingVolume: { box: BOX }, geometricError: 0, refine: "REPLACE", content: { uri: `../../assets/${slug}__lod_0.glb` } }],
    });
  }
  const tileset = { asset: { version: "1.1" }, geometricError: 1, root: { boundingVolume: { box: BOX }, geometricError: 1, refine: "REPLACE", children: chains } };
  const tilesetBytes = new TextEncoder().encode(`${stableSerialize(tileset)}\n`);
  const tilesetRef = servingTilesetRef(CELL_ID);
  contents.set(tilesetRef, tilesetBytes);
  artifacts.push({ logicalId: `tileset:${CELL_ID}`, role: "tileset-json", relativeRef: tilesetRef, byteSize: tilesetBytes.byteLength, checksumSha256: sha256HexBytes(tilesetBytes), ownerCellId: null });
  const manifest: MultiLodAssemblyManifest = {
    schemaVersion: "1.0",
    packageId: `assembly:${RETENTION_RELEASE_ID}:${CELL_ID}`,
    audience: "public",
    generatedAt: "2026-08-16T00:00:00.000Z",
    immutable: true,
    release: { rootId: `root:${RETENTION_RELEASE_ID}:retention`, rootChecksumSha256: "a".repeat(64), releaseId: RETENTION_RELEASE_ID, cityId: CITY, configId: CONFIG, privatePredecessor: null },
    baseIdentitySet: { id: "retention-base", checksumSha256: "b".repeat(64) },
    ownershipLedger: { id: "retention-ledger", checksumSha256: "d".repeat(64) },
    cells: [{ cellId: CELL_ID, cellRelease: { id: "retention-cell", checksumSha256: "e".repeat(64) }, predecessor: null, buildingIds: [...BUILDING_IDS], membershipChecksumSha256: sha256HexSync(stableSerialize([...BUILDING_IDS].sort())) }],
    assets,
    artifacts,
    tilesetRef,
    declaredTotalBytes: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
  };
  return { manifest, tileset, contents };
}

const SERVING_PINS = {
  packageId: servingAssemblyPackageId(SERVING_RELEASE_ID, CELL_ID),
  generatedAt: GENERATED_AT,
  release: { rootId: `root:${SERVING_RELEASE_ID}:public`, rootChecksumSha256: "1".repeat(64), releaseId: SERVING_RELEASE_ID, cityId: CITY, configId: CONFIG, privatePredecessor: { id: `root:${SERVING_RELEASE_ID}:private`, checksumSha256: "2".repeat(64) } },
  baseIdentitySet: { id: "serving-base", checksumSha256: "3".repeat(64) },
  ownershipLedger: { id: "serving-ledger", checksumSha256: "4".repeat(64) },
  cellRelease: { id: servingCellReleaseId(SERVING_RELEASE_ID, CELL_ID), checksumSha256: "5".repeat(64) },
} as const;

function transformFixture(fixture: RetentionFixture): { manifest: MultiLodAssemblyManifest; contents: Map<string, Uint8Array> } {
  const servingTileset = transformRetentionTilesetToServing(fixture.tileset);
  const tilesetBytes = new TextEncoder().encode(`${stableSerialize(servingTileset)}\n`);
  const manifest = transformRetentionAssemblyToServing(fixture.manifest, {
    ...SERVING_PINS,
    tileset: { byteSize: tilesetBytes.byteLength, checksumSha256: sha256HexBytes(tilesetBytes) },
  });
  const contents = new Map<string, Uint8Array>();
  for (const artifact of manifest.artifacts) {
    contents.set(artifact.relativeRef, artifact.role === "tileset-json" ? tilesetBytes : fixture.contents.get(artifact.relativeRef)!);
  }
  return { manifest, contents };
}

describe("the -s1 root self-pin (ADR 0052 D-B)", () => {
  const artifact = (kind: ExteriorArtifactRef["kind"], logicalId: string): ExteriorArtifactRef => ({
    logicalId,
    kind,
    relativeRef: servingArtifactRef("public", kind, logicalId),
    byteSize: 1_024,
    checksumSha256: sha256HexSync(logicalId),
  });
  const draftWith = (artifacts: ExteriorArtifactRef[]): Omit<ExteriorRootManifest, "rootChecksumSha256"> => ({
    schemaVersion: "1.0",
    audience: "public",
    rootId: `root:${SERVING_RELEASE_ID}:public`,
    releaseId: SERVING_RELEASE_ID,
    cityId: CITY,
    configId: CONFIG,
    generatedAt: GENERATED_AT,
    immutable: true,
    artifactAllowlist: artifacts.map((entry) => entry.relativeRef).sort(),
    artifacts,
    approval: exteriorServingApproval(exteriorServingWave("w02")),
    predecessor: null,
    privatePredecessor: null,
    textureAdmission: EXTERIOR_SERVING_TEXTURE_ADMISSION,
  });

  it("is bit-identical to the pre-seam definition for a root that declares no assembly package", () => {
    const kinds = ["ownership-ledger", "cell-release", "inventory", "evidence", "rollout-snapshot", "cell-detail-sidecar"] as const;
    for (const kind of kinds) {
      const draft = draftWith([artifact(kind, `${kind}:one`), artifact(kind, `${kind}:two`)]);
      expect(exteriorServingRootChecksum(draft)).toBe(legacyRootChecksum(draft));
    }
    const mixed = draftWith(kinds.map((kind) => artifact(kind, `${kind}:only`)));
    expect(exteriorServingRootChecksum(mixed)).toBe(legacyRootChecksum(mixed));
  });

  it("excludes the byte accounting of assembly packages and nothing else", () => {
    const packages = [artifact("cell-assembly-package", "cell-release:a"), artifact("cell-assembly-package", "cell-release:b")];
    const base = draftWith([artifact("cell-release", "cell-release:a"), ...packages]);
    const pinned = exteriorServingRootChecksum(base);

    const rewritten = draftWith([
      artifact("cell-release", "cell-release:a"),
      { ...packages[0]!, byteSize: 999_999, checksumSha256: sha256HexSync("moved") },
      packages[1]!,
    ]);
    expect(exteriorServingRootChecksum(rewritten)).toBe(pinned);
    // …and the legacy definition would have moved, which is exactly why the
    // serving definition had to exist rather than be reused.
    expect(legacyRootChecksum(rewritten)).not.toBe(legacyRootChecksum(base));
  });

  it("keeps the package-id set, the package refs and every other artifact inside the pin", () => {
    const packages = [artifact("cell-assembly-package", "cell-release:a"), artifact("cell-assembly-package", "cell-release:b")];
    const pinned = exteriorServingRootChecksum(draftWith([artifact("cell-release", "cell-release:a"), ...packages]));

    const dropped = draftWith([artifact("cell-release", "cell-release:a"), packages[0]!]);
    expect(exteriorServingRootChecksum(dropped)).not.toBe(pinned);

    const renamed = draftWith([artifact("cell-release", "cell-release:a"), packages[0]!, { ...packages[1]!, logicalId: "cell-release:c" }]);
    expect(exteriorServingRootChecksum(renamed)).not.toBe(pinned);

    const moved = draftWith([artifact("cell-release", "cell-release:a"), packages[0]!, { ...packages[1]!, relativeRef: "public/cell-assembly-package/elsewhere.json" }]);
    expect(exteriorServingRootChecksum(moved)).not.toBe(pinned);

    const otherArtifactMoved = draftWith([{ ...artifact("cell-release", "cell-release:a"), byteSize: 4_096 }, ...packages]);
    expect(exteriorServingRootChecksum(otherArtifactMoved)).not.toBe(pinned);
  });
});

describe("the retention-to-serving assembly transform", () => {
  it("ships one LOD, drops the coarse artifacts, and recomputes the byte accounting", () => {
    const fixture = buildRetentionFixture();
    const { manifest } = transformFixture(fixture);

    expect(manifest.assets).toHaveLength(BUILDING_IDS.length);
    for (const asset of manifest.assets) {
      expect(asset.lods.map((lod) => lod.lodId)).toEqual(["lod_0"]);
      expect(asset.lods[0]!.maxDistanceMeters).toBeNull();
      expect(asset.lods[0]!.silhouette).toBeNull();
    }
    const glbRefs = manifest.artifacts.filter((artifact) => artifact.role === "glb").map((artifact) => artifact.relativeRef);
    expect(glbRefs.every((ref) => ref.endsWith("__lod_0.glb"))).toBe(true);
    expect(glbRefs).toHaveLength(BUILDING_IDS.length);
    expect(manifest.declaredTotalBytes).toBe(manifest.artifacts.reduce((total, artifact) => total + artifact.byteSize, 0));
    expect(manifest.declaredTotalBytes).toBeLessThan(fixture.manifest.declaredTotalBytes);
  });

  it("carries every building-facing fact through byte-identically", () => {
    const fixture = buildRetentionFixture();
    const { manifest } = transformFixture(fixture);
    for (const [index, asset] of manifest.assets.entries()) {
      const retained = fixture.manifest.assets[index]!;
      const carried = (value: MultiLodAssemblyManifest["assets"][number]) => ({
        canonicalFeatureId: value.canonicalFeatureId,
        ownerCellId: value.ownerCellId,
        inventoryId: value.inventoryId,
        inventoryHashSha256: value.inventoryHashSha256,
        evidenceShardId: value.evidenceShardId,
        truthTiers: value.truthTiers,
        sourceDates: value.sourceDates,
        uncertainty: value.uncertainty,
        source: value.source,
      });
      expect(carried(asset)).toEqual(carried(retained));
      const retainedLod0 = retained.lods.find((lod) => lod.lodId === "lod_0")!;
      expect(asset.lods[0]!.quality).toEqual(retainedLod0.quality);
      expect(asset.lods[0]!.artifactRef).toBe(retainedLod0.artifactRef);
    }
    // The packaged membership and its checksum are the retained cell's own.
    expect(manifest.cells[0]!.buildingIds).toEqual(fixture.manifest.cells[0]!.buildingIds);
    expect(manifest.cells[0]!.membershipChecksumSha256).toBe(fixture.manifest.cells[0]!.membershipChecksumSha256);
  });

  it("re-pins release identity and nothing else", () => {
    const fixture = buildRetentionFixture();
    const { manifest } = transformFixture(fixture);
    expect(manifest.packageId).toBe(SERVING_PINS.packageId);
    expect(manifest.release).toEqual(SERVING_PINS.release);
    expect(manifest.baseIdentitySet).toEqual(SERVING_PINS.baseIdentitySet);
    expect(manifest.ownershipLedger).toEqual(SERVING_PINS.ownershipLedger);
    expect(manifest.cells[0]!.cellRelease).toEqual(SERVING_PINS.cellRelease);
    expect(manifest.generatedAt).toBe(GENERATED_AT);
  });

  it("passes the structural validator and the full byte replay over the transformed bytes", async () => {
    const fixture = buildRetentionFixture();
    const { manifest, contents } = transformFixture(fixture);
    expect(validateMultiLodAssembly(manifest, { textureAdmission: "procedural-replay" }).ok).toBe(true);
    const replay = await replayMultiLodAssembly(manifest, contents, { textureAdmission: "procedural-replay" });
    expect(replay.ok ? null : replay.issues).toBeNull();
  });

  it("unwraps the tileset to its innermost tiles and leaves them otherwise untouched", () => {
    const fixture = buildRetentionFixture();
    const served = transformRetentionTilesetToServing(fixture.tileset) as { root: { children: Array<Record<string, unknown>> } };
    const retainedChains = (fixture.tileset.root as { children: Array<Record<string, unknown>> }).children;
    expect(served.root.children).toHaveLength(retainedChains.length);
    for (const [index, child] of served.root.children.entries()) {
      const leaf = (retainedChains[index]!.children as Array<Record<string, unknown>>)[0]!;
      expect(child).toEqual(leaf);
      expect(child.children).toBeUndefined();
    }
  });

  it("refuses a chain that is not the two-LOD shape it reduces", () => {
    const fixture = buildRetentionFixture();
    const flattened = structuredClone(fixture.tileset) as { root: { children: Array<Record<string, unknown>> } };
    delete flattened.root.children[0]!.children;
    expect(() => transformRetentionTilesetToServing(flattened)).toThrow(/exactly one finer LOD/u);

    const deeper = structuredClone(fixture.tileset) as { root: { children: Array<{ children: Array<Record<string, unknown>> }> } };
    deeper.root.children[0]!.children[0]!.children = [structuredClone(deeper.root.children[0]!.children[0]!)];
    expect(() => transformRetentionTilesetToServing(deeper)).toThrow(/deeper than the two LODs/u);
  });

  it("refuses an asset with no shipped LOD, and a manifest packaging more than one cell", () => {
    const fixture = buildRetentionFixture();
    const tileset = { byteSize: 10, checksumSha256: "6".repeat(64) };
    const missing = structuredClone(fixture.manifest);
    missing.assets[0]!.lods = missing.assets[0]!.lods.filter((lod) => lod.lodId !== "lod_0");
    expect(() => transformRetentionAssemblyToServing(missing, { ...SERVING_PINS, tileset })).toThrow(/exactly one is required/u);

    const twoCells = structuredClone(fixture.manifest);
    twoCells.cells = [twoCells.cells[0]!, { ...twoCells.cells[0]!, cellId: `${CELL_ID}-b` }];
    expect(() => transformRetentionAssemblyToServing(twoCells, { ...SERVING_PINS, tileset })).toThrow(/the serving form is exactly one/u);
  });
});

describe("the emitted serving release", () => {
  const approval = exteriorServingApproval(exteriorServingWave("w02"));
  const bounds = { west: -74.01, south: 40.71, east: -74.0, north: 40.72 };

  function buildRelease(): { index: unknown; graph: unknown; assemblies: unknown[]; contents: Map<string, Uint8Array> } {
    const fixture = buildRetentionFixture();
    const ledger = buildServingOwnershipLedger({
      releaseId: SERVING_RELEASE_ID,
      cityId: CITY,
      configId: CONFIG,
      cells: [{ cellId: CELL_ID, bounds, buildingIds: [...BUILDING_IDS, REFUSED_ID] }],
    });
    const cellRelease = buildServingCellRelease({
      releaseId: SERVING_RELEASE_ID,
      ledger,
      cell: ledger.cells[0]!,
      approval,
      availableBuildingIds: [...BUILDING_IDS],
      unavailableReasons: new Map([[REFUSED_ID, "Refused by the footprint-faithful V3 exterior grammar [synthetic]: fixture refusal. No geometry was invented."]]),
    });
    const cellReleaseBlob = servingArtifactBlob("public", "cell-release", cellRelease.cellReleaseId, cellRelease);

    const sidecar = buildServingCellDetailSidecar({
      releaseId: SERVING_RELEASE_ID,
      cellReleaseId: cellRelease.cellReleaseId,
      approval,
      rights: {
        license: {
          id: "license:nyc.building-footprints",
          termsUrl: "https://example.invalid/terms",
          attribution: "Synthetic fixture attribution",
          retention: { mode: "conditional", expiresAt: null, conditions: "fixture" },
          allowedUse: { privateDerivative: true, publicDisplay: true, derivativeConveyance: true, redistribution: true, runtimeTexture: false, trainingInput: false, generationInput: true, validationOnly: false },
          personalDataRestricted: false,
        },
        source: (building, capturedAt, updatedAt) => ({
          id: `source-ref:nyc.building-footprints:${building.buildingId}`,
          provider: "Synthetic",
          datasetId: "jh45-qr5r",
          sourceRecordId: building.sourceRecordId,
          sourceUrl: "https://example.invalid/dataset",
          sourceDate: updatedAt,
          observedAt: capturedAt,
          capturedAt,
          updatedAt,
          attribution: "Synthetic fixture attribution",
          licenseId: "license:nyc.building-footprints",
          approvalId: approval.id,
        }),
      },
      capture: { capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" },
      buildings: BUILDING_IDS.map((buildingId) => ({
        buildingId,
        sourceRefId: `source-ref:nyc.building-footprints:${buildingId}`,
        sourceRecordId: buildingId,
        inventory: fixtureInventory(buildingId),
        declaredInventoryHashSha256: sha256HexSync(stableSerialize(fixtureInventory(buildingId))),
      })),
    });
    const sidecarBlob = servingDocumentBlob("cell-detail-sidecar", cellRelease.cellReleaseId, sidecar);

    const privateLedgerBlob = servingArtifactBlob("private", "ownership-ledger", ledger.ledgerId, ledger);
    const publicLedgerBlob = servingArtifactBlob("public", "ownership-ledger", ledger.ledgerId, ledger);
    const snapshot = buildServingSnapshot({
      releaseId: SERVING_RELEASE_ID,
      ledger,
      generatedAt: GENERATED_AT,
      approval,
      cellReleaseRefs: new Map([[CELL_ID, { cellReleaseId: cellRelease.cellReleaseId, checksumSha256: cellReleaseBlob.ref.checksumSha256 }]]),
    });
    const snapshotBlob = servingArtifactBlob("public", "rollout-snapshot", snapshot.snapshotId, snapshot);

    const rootInput = { releaseId: SERVING_RELEASE_ID, ledger, generatedAt: GENERATED_AT, approval, textureAdmission: EXTERIOR_SERVING_TEXTURE_ADMISSION };
    const privateRoot = buildServingPrivateRoot(rootInput, privateLedgerBlob);
    const draft = buildServingPublicRoot({
      ...rootInput,
      privateRoot,
      artifacts: [cellReleaseBlob.ref, sidecarBlob.ref, publicLedgerBlob.ref, snapshotBlob.ref],
      assemblyPackageRefs: [{ logicalId: cellRelease.cellReleaseId, relativeRef: servingArtifactRef("public", "cell-assembly-package", cellRelease.cellReleaseId) }],
      predecessor: null,
    });

    const servingTileset = transformRetentionTilesetToServing(fixture.tileset);
    const tilesetBytes = new TextEncoder().encode(`${stableSerialize(servingTileset)}\n`);
    const assembly = transformRetentionAssemblyToServing(fixture.manifest, {
      packageId: servingAssemblyPackageId(SERVING_RELEASE_ID, CELL_ID),
      generatedAt: GENERATED_AT,
      release: { rootId: draft.root.rootId, rootChecksumSha256: draft.root.rootChecksumSha256, releaseId: SERVING_RELEASE_ID, cityId: CITY, configId: CONFIG, privatePredecessor: { id: privateRoot.rootId, checksumSha256: privateRoot.rootChecksumSha256 } },
      baseIdentitySet: { id: ledger.baseIdentitySet.id, checksumSha256: ledger.baseIdentitySet.checksumSha256 },
      ownershipLedger: { id: ledger.ledgerId, checksumSha256: publicLedgerBlob.ref.checksumSha256 },
      cellRelease: { id: cellRelease.cellReleaseId, checksumSha256: cellReleaseBlob.ref.checksumSha256 },
      tileset: { byteSize: tilesetBytes.byteLength, checksumSha256: sha256HexBytes(tilesetBytes) },
    });
    const assemblyBlob = servingAssemblyBlob(assembly, cellRelease.cellReleaseId);
    const publicRoot = draft.finalize(new Map([[cellRelease.cellReleaseId, { byteSize: assemblyBlob.ref.byteSize, checksumSha256: assemblyBlob.ref.checksumSha256 }]]));

    const contents = new Map<string, Uint8Array>();
    for (const artifact of assembly.artifacts) contents.set(artifact.relativeRef, artifact.role === "tileset-json" ? tilesetBytes : fixture.contents.get(artifact.relativeRef)!);
    contents.set(sidecarBlob.ref.relativeRef, sidecarBlob.bytes);
    contents.set(assemblyBlob.ref.relativeRef, assemblyBlob.bytes);

    return {
      index: buildServingIndex({
        releaseId: SERVING_RELEASE_ID,
        ledger,
        snapshot,
        snapshotChecksumSha256: snapshotBlob.ref.checksumSha256,
        assemblyPackageIds: [assembly.packageId],
        baseReleaseIds: ["manhattan-citywide-20260804"],
      }),
      graph: { schemaVersion: "1.0", roots: [privateRoot, publicRoot], ownershipLedger: ledger, cellReleases: [cellRelease], inventoryShards: [], evidenceShards: [], snapshots: [snapshot] },
      assemblies: [],
      contents,
    };
  }

  it("validates as a release graph with every shard and every package sharded out", () => {
    const release = buildRelease();
    const validation = validateExteriorReleaseGraph(release.graph);
    expect(validation.ok ? null : validation.issues).toBeNull();
    const graph = release.graph as { roots: ExteriorRootManifest[]; inventoryShards: unknown[]; evidenceShards: unknown[] };
    expect(graph.inventoryShards).toHaveLength(0);
    expect(graph.evidenceShards).toHaveLength(0);
    const publicRoot = graph.roots.find((root) => root.audience === "public")!;
    expect(publicRoot.artifacts.filter((artifact) => artifact.kind === "cell-assembly-package")).toHaveLength(1);
    expect(publicRoot.artifacts.filter((artifact) => artifact.kind === "inventory" || artifact.kind === "evidence")).toHaveLength(0);
  });

  it("boots the runtime with an empty assemblies.json, which is the whole point of the seam", () => {
    const release = buildRelease();
    expect(() => createExteriorCellRuntime(
      { index: release.index, graph: release.graph, assemblies: release.assemblies },
      { kind: "default" },
      { fetchArtifact: async () => new Uint8Array(), baseIdentity: { releaseId: "manhattan-citywide-20260804", has: () => true } },
    )).not.toThrow();
  });

  it("emits a sidecar that binds its own cell release", () => {
    const release = buildRelease();
    const graph = release.graph as { roots: ExteriorRootManifest[]; cellReleases: Array<{ cellReleaseId: string }> };
    const publicRoot = graph.roots.find((root) => root.audience === "public")!;
    const declared = publicRoot.artifacts.find((artifact) => artifact.kind === "cell-detail-sidecar")!;
    const sidecar = JSON.parse(new TextDecoder().decode(release.contents.get(declared.relativeRef)!));
    const validation = validateExteriorCellDetailSidecar(sidecar, { cell: graph.cellReleases[0] as never, artifactRef: declared.relativeRef });
    expect(validation.ok ? null : validation.issues).toBeNull();
  });
});

describe("the sidecar inventory cross-check", () => {
  it("refuses an inventory whose hash is not the one the retained manifest declared", () => {
    const approval = exteriorServingApproval(exteriorServingWave("w02"));
    expect(() => buildServingCellDetailSidecar({
      releaseId: SERVING_RELEASE_ID,
      cellReleaseId: servingCellReleaseId(SERVING_RELEASE_ID, CELL_ID),
      approval,
      rights: {
        license: {
          id: "license:nyc.building-footprints",
          termsUrl: "https://example.invalid/terms",
          attribution: "Synthetic",
          retention: { mode: "conditional", expiresAt: null, conditions: "fixture" },
          allowedUse: { privateDerivative: true, publicDisplay: true, derivativeConveyance: true, redistribution: true, runtimeTexture: false, trainingInput: false, generationInput: true, validationOnly: false },
          personalDataRestricted: false,
        },
        source: () => { throw new Error("unreachable: the hash check runs first."); },
      },
      capture: { capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" },
      buildings: [{
        buildingId: BUILDING_IDS[0],
        sourceRefId: `source-ref:nyc.building-footprints:${BUILDING_IDS[0]}`,
        sourceRecordId: BUILDING_IDS[0],
        inventory: fixtureInventory(BUILDING_IDS[0]),
        declaredInventoryHashSha256: "f".repeat(64),
      }],
    })).toThrow(/would describe different geometry from the bytes it carries/u);
  });
});

describe("the serving wave table", () => {
  it("names one release per wave the island ledger declares, and derives every id from its retention package", () => {
    expect(EXTERIOR_SERVING_WAVES).toHaveLength(6);
    for (const entry of EXTERIOR_SERVING_WAVES) {
      expect(entry.servingReleaseId).toBe(exteriorServingReleaseId(entry.retentionReleaseId));
      expect(entry.servingReleaseId.endsWith("-s1")).toBe(true);
      expect(entry.generatedBuildingCount + entry.tombstonedBuildingCount).toBe(entry.ownedBuildingCount);
    }
  });

  it("refuses to derive a serving id from anything that is not a retention release", () => {
    expect(() => exteriorServingReleaseId("manhattan-lower-manhattan-cells-20260812-p1")).toThrow(/not a retention release id/u);
  });
});
