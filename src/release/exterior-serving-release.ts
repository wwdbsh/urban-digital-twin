/**
 * The `-s1` SERVING transform: a retained `-c1` wave becomes a servable release.
 *
 * T004 retained the full island as six `-c1` retention packages — both LODs,
 * 6.2 GB, one assembly manifest per ownership cell, payload gitignored and no
 * runtime index anywhere. This module is the transform that turns one of those
 * retained waves into a release the browser can actually load, and its whole
 * design is contained in one sentence: **it regenerates no geometry**.
 *
 * ## Why a transform and not a build
 *
 * The obvious route was to call the wave release builder (`buildMidtownCoreRelease`)
 * with a full materialization, exactly as every curated `-p1` wave was cut. That
 * route is rejected here for two independent reasons.
 *
 * The first is evidence. The `-c1` bytes are what T004 validated, byte-replayed
 * and committed an inventory for. A serving release that re-materializes the
 * same buildings produces a second set of bytes which is *believed* to be equal
 * and is never checked to be — and the whole point of retention was that the
 * committed inventory keeps the emitted bytes checkable. Deriving the serving
 * manifest FROM the retained manifest keeps one set of bytes with one lineage,
 * and makes the equality a property this repository can test rather than assume.
 *
 * The second is cost. `buildMidtownCoreRelease` holds a whole wave's
 * materialization in memory at once; wave `w04` is 11,721 buildings across two
 * LODs. The island took nine hours to generate. Re-generating it to serve it
 * would take nine more, for bytes that already exist on disk.
 *
 * So the serving manifest is a PURE TRANSFORMATION of the retention manifest:
 * identity re-pinned to the new release, `lod_1` dropped, the tileset chain
 * unwrapped to its innermost tile, and the byte accounting recomputed. Nothing
 * else moves. `exterior-serving-release.test.ts` pins that the transform is
 * total and that its output passes `validateMultiLodAssembly` — and the wave
 * commits pin that it passes `replayMultiLodAssembly` over the real retained
 * bytes, which is the statement that actually matters.
 *
 * ## What single-LOD means, and why
 *
 * A `-c1` package ships `lod_0` and `lod_1` for every building. The serving
 * release ships `lod_0` ONLY. That is not a quality decision made here — it is
 * ADR 0052 §2's boot-weight measurement: the two-LOD manifest costs 3,932 B per
 * shipped asset against the single-LOD 2,567 B, and at 44,989 assets that
 * difference is 61 MiB of manifest before the difference in geometry bytes.
 * The retained `lod_1` bytes are not deleted and not disowned; they stay in the
 * `-c1` package, which stays exactly as T004 committed it.
 *
 * Dropping the coarse LOD is representable precisely because the finest LOD is
 * unbounded: `maxDistanceMeters: null` on `lod_0` means no camera distance can
 * leave an asset without an eligible representation, which is the same shape
 * every curated `-p1` wave already ships.
 *
 * ## The root self-pin (ADR 0052 §2, decision D-B)
 *
 * A `-s1` release has a circularity the curated releases do not. Every assembly
 * package pins `release.rootChecksumSha256`, and under the assembly seam every
 * package is a root-declared artifact whose byte size and checksum the root
 * declares. Root pins package pins root.
 *
 * `exteriorServingRootChecksum` breaks it by excluding EXACTLY the `byteSize`
 * and `checksumSha256` of `cell-assembly-package` entries and nothing else. The
 * package-id SET stays inside the pin — that is the `ownedCellIds` precedent
 * from the retention root — so a dropped, added or renamed package is still a
 * detectable edit; only the two fields that cannot be known before the package
 * exists are blanked. For any root that declares no `cell-assembly-package` the
 * function is bit-identical to the existing `sha256HexSync(stableSerialize({
 * ...root, rootChecksumSha256: "" }))`, which `exterior-serving-release.test.ts`
 * pins against every committed release root.
 */

import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  isExteriorComponentReleaseEligible,
  type ExteriorApprovalEvidence,
  type ExteriorComponentInventory,
  type ExteriorEvidenceGraph,
  type ExteriorLicenseEvidence,
  type ExteriorSourceEvidence,
} from "../domain/exterior-contract.ts";
import { getSourceRegistryEntry } from "../data/source-registry.ts";
import {
  EXTERIOR_RELEASE_SCHEMA_VERSION,
  type ExteriorArtifactKind,
  type ExteriorArtifactRef,
  type ExteriorBuildingDetail,
  type ExteriorCellDetailSidecar,
  type ExteriorCellRelease,
  type ExteriorEvidenceShard,
  type ExteriorInventoryShard,
  type ExteriorOwnershipCell,
  type ExteriorOwnershipLedger,
  type ExteriorReleaseAudience,
  type ExteriorRolloutSnapshot,
  type ExteriorRootManifest,
  type ExteriorTextureAdmission,
  type Wgs84Bounds,
} from "./exterior-release.ts";
import {
  serializeMultiLodAssembly,
  type AssemblyArtifact,
  type AssemblyAsset,
  type AssemblyLod,
  type ImmutablePin,
  type MultiLodAssemblyManifest,
} from "./multi-lod-assembly.ts";
import { midtownCoreConveyanceRights } from "./midtown-core-release.ts";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const EXTERIOR_SERVING_SUFFIX = "-s1" as const;
export const EXTERIOR_RETENTION_SUFFIX = "-c1" as const;
/** The one LOD a serving release ships. See the module docblock. */
export const EXTERIOR_SERVING_SHIPPED_LOD_ID = "lod_0" as const;
export const EXTERIOR_SERVING_CELL_RELEASE_VERSION = "v1" as const;
export const EXTERIOR_SERVING_SOURCE_REGISTRY_ID = "nyc.building-footprints" as const;

const encoder = new TextEncoder();
function encode(value: string): Uint8Array { return encoder.encode(value); }
function slug(value: string): string { return value.replaceAll(":", "-"); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
export function servingFail(message: string): never { throw new Error(`Exterior serving release: ${message}`); }

/** `…-c1` becomes `…-s1`; anything else is refused rather than suffixed blindly. */
export function exteriorServingReleaseId(retentionReleaseId: string): string {
  if (!retentionReleaseId.endsWith(EXTERIOR_RETENTION_SUFFIX)) {
    servingFail(`${retentionReleaseId} is not a retention release id (expected a ${EXTERIOR_RETENTION_SUFFIX} suffix).`);
  }
  return `${retentionReleaseId.slice(0, -EXTERIOR_RETENTION_SUFFIX.length)}${EXTERIOR_SERVING_SUFFIX}`;
}

export function servingArtifactRef(audience: ExteriorReleaseAudience, kind: ExteriorArtifactKind, logicalId: string): string {
  return `${audience}/${kind}/${slug(logicalId)}.json`;
}
export function servingPrivateRootId(releaseId: string): string { return `root:${releaseId}:private`; }
export function servingPublicRootId(releaseId: string): string { return `root:${releaseId}:public`; }
export function servingPrivateReleaseId(releaseId: string): string { return `${releaseId}-private`; }
export function servingSnapshotId(releaseId: string): string { return `snapshot:${releaseId}:v1`; }
export function servingApprovalId(releaseId: string): string { return `approval:${releaseId}:full-city-serving`; }
export function servingLedgerId(releaseId: string, fingerprint: string): string { return `ownership-ledger:${releaseId}:${fingerprint}`; }
export function servingBaseIdentitySetId(releaseId: string, fingerprint: string): string { return `${releaseId}:exterior-base-identity:${fingerprint}`; }
export function servingCellReleaseId(releaseId: string, cellId: string): string {
  return `cell-release:${releaseId}:${cellId}:${EXTERIOR_SERVING_CELL_RELEASE_VERSION}`;
}
export function servingAssemblyPackageId(releaseId: string, cellId: string): string { return `assembly:${releaseId}:${cellId}`; }
/**
 * Inventory and evidence-shard ids, scoped to the RETENTION release.
 *
 * These two take a `recordReleaseId`, not this release's id, and that is the
 * whole of D-C. A serving release republishes the retained records rather than
 * minting its own, because the retained ids are already inside bytes that cannot
 * be rewritten: every `-c1` GLB carries `inventoryId` and `evidenceShardId` in
 * its canonical `urbanDigitalTwin` metadata, and `verifyGlb` requires that
 * metadata to be byte-equal to the assembly asset that declares it. The serving
 * assembly manifest is a pure transform of the retained one and carries those
 * asset ids through untouched (see `transformRetentionAssemblyToServing`), so a
 * cell release that minted `-s1`-scoped ids would disagree with its own manifest
 * and every cell would fail `assembly-pin-mismatch` at load.
 *
 * Re-minting the manifests instead is not available: doing so rewrites the very
 * field the GLB bytes are pinned against, and those bytes are immutable T004
 * evidence. So the ids move, and the record ids are the retained ones.
 *
 * Nothing outside this pairing constrains the strings. `validateExteriorReleaseGraph`
 * and `validateExteriorCellDetailSidecar` check internal consistency only — that
 * a cited id resolves, once, within the same audience — and never that an id is
 * prefixed by the release carrying it. The scoping is therefore a statement about
 * PROVENANCE: the inventory and the evidence come from the retention release
 * named here, and the serving release says so in the id rather than claiming
 * authorship of records it copied.
 *
 * A tombstone is different and stays `-s1`-scoped below: no retained record
 * exists for a building the retention wave refused, so the serving release is
 * the author of that statement and names itself.
 */
export function servingInventoryId(recordReleaseId: string, buildingId: string): string { return `inventory:${recordReleaseId}:${buildingId}`; }
export function servingEvidenceShardId(recordReleaseId: string, buildingId: string): string { return `evidence-shard:${recordReleaseId}:${buildingId}`; }
export function servingTombstoneId(releaseId: string, buildingId: string): string { return `tombstone:${releaseId}:${buildingId}`; }
/** Per-cell tileset, at the same path the retention package uses. */
export function servingTilesetRef(cellId: string): string { return `public/tiles/${cellId}/tileset.json`; }
export function servingTilesetLogicalId(cellId: string): string { return `tileset:${cellId}`; }

// ---------------------------------------------------------------------------
// D-B: the root self-pin
// ---------------------------------------------------------------------------

/**
 * The immutable root checksum, with the assembly-package byte accounting held
 * outside the pin.
 *
 * See the module docblock for why. The blanking is applied to a COPY, in the
 * declared order, so the serialized shape is otherwise byte-identical to what
 * the pre-seam definition hashed.
 */
export function exteriorServingRootChecksum(
  root: Omit<ExteriorRootManifest, "rootChecksumSha256"> & { rootChecksumSha256?: string },
): string {
  return sha256HexSync(stableSerialize({
    ...root,
    rootChecksumSha256: "",
    artifacts: root.artifacts.map((artifact) => artifact.kind === "cell-assembly-package"
      ? { ...artifact, byteSize: 0, checksumSha256: "" }
      : artifact),
  }));
}

// ---------------------------------------------------------------------------
// The tileset transform
// ---------------------------------------------------------------------------

interface RetentionTile {
  boundingVolume: unknown;
  geometricError: number;
  refine?: string;
  transform?: unknown;
  content?: { uri: string };
  children?: RetentionTile[];
}

/**
 * The retained two-LOD tileset, reduced to its innermost tiles.
 *
 * A `-c1` tileset root holds one chain per asset: a `lod_1` tile at geometric
 * error 0.2 wrapping a `lod_0` leaf at 0. `validateTileset` requires the chain
 * to mirror the manifest's LOD list exactly, so dropping `lod_1` from the
 * manifest without unwrapping the tileset produces a package that fails its own
 * replay. The unwrap REPLACES each chain with its leaf and touches nothing else:
 * bounding volume, transform and content URI are the leaf's own, unmodified.
 *
 * It is deliberately strict. A chain that is not exactly "one wrapper, one leaf"
 * is a shape this transform was not written for, and guessing at it would be the
 * one way a serving release could silently ship different geometry from the
 * retained bytes it claims to carry.
 */
export function transformRetentionTilesetToServing(value: unknown, shippedLodSuffix = `__${EXTERIOR_SERVING_SHIPPED_LOD_ID}.glb`): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) servingFail("retention tileset must be an object.");
  const document = value as Record<string, unknown>;
  const root = document.root;
  if (typeof root !== "object" || root === null || Array.isArray(root)) servingFail("retention tileset root must be an object.");
  const rootTile = root as unknown as RetentionTile;
  const children = rootTile.children;
  if (!Array.isArray(children) || children.length === 0) servingFail("retention tileset root must carry one LOD chain per asset.");
  const leaves = children.map((chain, index) => {
    if (!Array.isArray(chain.children) || chain.children.length !== 1) {
      servingFail(`retention tileset chain [${index}] does not refine to exactly one finer LOD.`);
    }
    const leaf = chain.children[0]!;
    if (leaf.children !== undefined && (leaf.children as RetentionTile[]).length !== 0) {
      servingFail(`retention tileset chain [${index}] is deeper than the two LODs this transform reduces.`);
    }
    const uri = leaf.content?.uri;
    if (typeof uri !== "string" || !uri.endsWith(shippedLodSuffix)) {
      servingFail(`retention tileset chain [${index}] innermost content ${String(uri)} is not the shipped LOD.`);
    }
    if (leaf.geometricError !== 0) servingFail(`retention tileset chain [${index}] innermost tile does not declare zero geometric error.`);
    // The leaf, exactly as retained: an object literal rebuild would reorder
    // keys and would have to guess which optional fields were present.
    const { children: _dropped, ...rest } = leaf as RetentionTile & { children?: unknown };
    void _dropped;
    return rest;
  });
  return { ...document, root: { ...(root as Record<string, unknown>), children: leaves } };
}

// ---------------------------------------------------------------------------
// The assembly transform
// ---------------------------------------------------------------------------

export interface ServingAssemblyPins {
  packageId: string;
  generatedAt: string;
  release: { rootId: string; rootChecksumSha256: string; releaseId: string; cityId: string; configId: string; privatePredecessor: ImmutablePin | null };
  baseIdentitySet: ImmutablePin;
  ownershipLedger: ImmutablePin;
  cellRelease: ImmutablePin;
  /** The transformed tileset's own accounting, which only the caller can know. */
  tileset: { byteSize: number; checksumSha256: string };
}

/**
 * One retained cell manifest, re-pinned to a serving release and reduced to the
 * shipped LOD.
 *
 * Everything that describes the BUILDING — canonical identity, inventory hash,
 * evidence shard id, truth tiers, source dates, uncertainty, plan id and plan
 * hash, and the shipped LOD's measured quality — is carried through untouched.
 * Everything that describes the RELEASE is replaced from `pins`. There is no
 * third category, which is the property that makes "pure transformation"
 * checkable rather than rhetorical.
 */
export function transformRetentionAssemblyToServing(
  retention: MultiLodAssemblyManifest,
  pins: ServingAssemblyPins,
): MultiLodAssemblyManifest {
  if (retention.cells.length !== 1) servingFail(`retention manifest ${retention.packageId} packages ${retention.cells.length} cells; the serving form is exactly one.`);
  const cell = retention.cells[0]!;
  // ANCHORED, not a substring search. A cell-release id is
  // `cell-release:<releaseId>:<cellId>:<version>`, so the cell it names is the
  // segment before the version — and the check is that the pin ENDS WITH
  // `:<cellId>:<version>`. The previous form fell back to
  // `pins.cellRelease.id.includes(cell.cellId)`, which would accept a pin naming
  // any cell whose id merely CONTAINS this one's. Nothing collides in the
  // committed ledger today (verified across all 883 ids: no cell id is a
  // substring of another), so this changes no emitted byte; what it removes is a
  // fallback that would silently pass on the day a cell-id scheme made one a
  // prefix of another, which is exactly the day a package would be pinned to the
  // wrong cell release.
  const expectedSuffix = `:${cell.cellId}:${EXTERIOR_SERVING_CELL_RELEASE_VERSION}`;
  if (pins.cellRelease.id.split(":")[2] !== cell.cellId && !pins.cellRelease.id.endsWith(expectedSuffix)) {
    servingFail(`retention manifest ${retention.packageId} packages cell ${cell.cellId}, which the supplied cell-release pin ${pins.cellRelease.id} does not name.`);
  }

  const shippedRefs = new Set<string>();
  const assets: AssemblyAsset[] = retention.assets.map((asset) => {
    const shipped = asset.lods.filter((lod) => lod.lodId === EXTERIOR_SERVING_SHIPPED_LOD_ID);
    if (shipped.length !== 1) servingFail(`asset ${asset.canonicalFeatureId} declares ${shipped.length} ${EXTERIOR_SERVING_SHIPPED_LOD_ID} entries; exactly one is required.`);
    const lod: AssemblyLod = { ...shipped[0]!, silhouette: null, maxDistanceMeters: null };
    if (lod.geometricErrorMeters !== 0) servingFail(`asset ${asset.canonicalFeatureId} ships a nonzero geometric error at ${EXTERIOR_SERVING_SHIPPED_LOD_ID}.`);
    shippedRefs.add(lod.artifactRef);
    return { ...asset, lods: [lod] };
  });

  const artifacts: AssemblyArtifact[] = [];
  for (const artifact of retention.artifacts) {
    if (artifact.role === "glb") { if (shippedRefs.has(artifact.relativeRef)) artifacts.push({ ...artifact }); continue; }
    if (artifact.role === "tileset-json") {
      artifacts.push({ ...artifact, relativeRef: servingTilesetRef(cell.cellId), byteSize: pins.tileset.byteSize, checksumSha256: pins.tileset.checksumSha256 });
      continue;
    }
    artifacts.push({ ...artifact });
  }
  if (artifacts.filter((artifact) => artifact.role === "glb").length !== assets.length) {
    servingFail(`retention manifest ${retention.packageId} does not declare exactly one ${EXTERIOR_SERVING_SHIPPED_LOD_ID} artifact per asset.`);
  }

  return {
    schemaVersion: retention.schemaVersion,
    packageId: pins.packageId,
    audience: "public",
    generatedAt: pins.generatedAt,
    immutable: true,
    release: { ...pins.release },
    baseIdentitySet: { ...pins.baseIdentitySet },
    ownershipLedger: { ...pins.ownershipLedger },
    cells: [{ ...cell, cellRelease: { ...pins.cellRelease }, predecessor: null }],
    assets,
    artifacts,
    tilesetRef: servingTilesetRef(cell.cellId),
    declaredTotalBytes: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
  };
}

/** The `-s2` serving generation: two LODs, a near ring and a mid ring (ADR 0057). */
export const EXTERIOR_TWO_LOD_SERVING_SUFFIX = "-s2" as const;
export const EXTERIOR_TWO_LOD_SERVING_COARSE_LOD_ID = "lod_1" as const;

/**
 * The near-ring bound written onto every served `lod_0`, in metres.
 *
 * DERIVED in ADR 0057 §1.4 from the committed extents census — the median cell
 * diagonal of 316.5 m, rounded up to the next 100 m under a named convention —
 * and re-derived by `exterior-two-lod-residency.test.ts`. It is deliberately NOT
 * a scheduler distance-band edge: ADR 0044 §1.1 recorded that those are sort
 * keys rather than admission tests, and at 1,200 m the mid ring holds no
 * resident cell at all.
 */
export const EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS = 400;

/**
 * One retained `-c2` cell manifest, re-pinned to an `-s2` serving release and
 * kept at BOTH levels.
 *
 * ## Why this is a separate function from the `-s1` transform
 *
 * `transformRetentionAssemblyToServing` reduces a manifest to one level and
 * writes `maxDistanceMeters: null` onto it. That is the correct shape for what
 * `-s1` ships and it is left exactly as it is: it describes a promoted release,
 * and a transform that changed under a successor would change what the frozen
 * drift test is checking.
 *
 * ## The thresholds are the tier
 *
 * `lod_0` is bounded at the near ring and `lod_1` is unbounded beyond it. Under
 * finest-that-covers — the default selection semantics from ADR 0057 Part 0 —
 * that resolves `lod_0` within the ring and `lod_1` outside it, which IS the
 * mid-distance ring the contract asks for. Nothing in the scheduler decides it;
 * the scheduler decides residency only.
 *
 * ## The ADR 0050 exception, carried rather than re-derived
 *
 * A measured-fallback parent's `lod_1` is INELIGIBLE, because its coarse level
 * was never honest coarse geometry — it is full geometry wearing a coarse label.
 * Bounding such an asset's `lod_0` would leave it resolving NOTHING beyond the
 * ring: `lod-unavailable`, a blank building. So a fallback parent keeps
 * `lod_0` UNBOUNDED and its ineligible `lod_1` is carried through untouched.
 * The condition is read off the retained manifest rather than recomputed, so
 * this cannot disagree with the census that declared it.
 *
 * ## The silhouette record is PRESERVED, not nulled
 *
 * `-s1` nulls it because a single-LOD package declares no transition. A two-LOD
 * package must carry the coarse level's measurement or `validateMultiLodAssembly`
 * refuses it — correctly, since an unmeasured coarse level is exactly what the
 * 2% cap exists to prevent.
 */
export function transformRetentionAssemblyToTwoLodServing(
  retention: MultiLodAssemblyManifest,
  pins: ServingAssemblyPins,
  options: { nearRingMeters: number },
): MultiLodAssemblyManifest {
  if (retention.cells.length !== 1) servingFail(`retention manifest ${retention.packageId} packages ${retention.cells.length} cells; the serving form is exactly one.`);
  if (!(options.nearRingMeters > 0)) servingFail("the near-ring bound must be a positive distance.");
  const cell = retention.cells[0]!;
  const expectedSuffix = `:${cell.cellId}:${EXTERIOR_SERVING_CELL_RELEASE_VERSION}`;
  if (pins.cellRelease.id.split(":")[2] !== cell.cellId && !pins.cellRelease.id.endsWith(expectedSuffix)) {
    servingFail(`retention manifest ${retention.packageId} packages cell ${cell.cellId}, which the supplied cell-release pin ${pins.cellRelease.id} does not name.`);
  }

  const shippedRefs = new Set<string>();
  const assets: AssemblyAsset[] = retention.assets.map((asset) => {
    const fine = asset.lods.filter((lod) => lod.lodId === EXTERIOR_SERVING_SHIPPED_LOD_ID);
    const coarse = asset.lods.filter((lod) => lod.lodId === EXTERIOR_TWO_LOD_SERVING_COARSE_LOD_ID);
    if (fine.length !== 1) servingFail(`asset ${asset.canonicalFeatureId} declares ${fine.length} ${EXTERIOR_SERVING_SHIPPED_LOD_ID} entries; exactly one is required.`);
    if (coarse.length !== 1) servingFail(`asset ${asset.canonicalFeatureId} declares ${coarse.length} ${EXTERIOR_TWO_LOD_SERVING_COARSE_LOD_ID} entries; a two-LOD serving release requires exactly one.`);
    const retainedFine = fine[0]!;
    const retainedCoarse = coarse[0]!;
    if (retainedFine.geometricErrorMeters !== 0) servingFail(`asset ${asset.canonicalFeatureId} ships a nonzero geometric error at ${EXTERIOR_SERVING_SHIPPED_LOD_ID}.`);
    if (!retainedFine.eligible) servingFail(`asset ${asset.canonicalFeatureId} declares its ${EXTERIOR_SERVING_SHIPPED_LOD_ID} ineligible; there would be nothing to serve in the near ring.`);

    // ADR 0050. Read off the retained manifest, never recomputed here.
    const measuredFallback = !retainedCoarse.eligible;
    if (!measuredFallback && retainedCoarse.silhouette === null) {
      servingFail(`asset ${asset.canonicalFeatureId} ships an eligible ${EXTERIOR_TWO_LOD_SERVING_COARSE_LOD_ID} with no silhouette measurement; a coarse level nobody measured cannot be served.`);
    }
    const lods: AssemblyLod[] = [
      {
        ...retainedFine,
        silhouette: null,
        // A fallback parent keeps an UNBOUNDED fine level, because its coarse
        // level cannot cover anything and a bounded fine level would leave it
        // resolving nothing at range.
        maxDistanceMeters: measuredFallback ? null : options.nearRingMeters,
      },
      { ...retainedCoarse, maxDistanceMeters: null },
    ];
    shippedRefs.add(retainedFine.artifactRef);
    shippedRefs.add(retainedCoarse.artifactRef);
    return { ...asset, lods };
  });

  const artifacts: AssemblyArtifact[] = [];
  for (const artifact of retention.artifacts) {
    if (artifact.role === "glb") { if (shippedRefs.has(artifact.relativeRef)) artifacts.push({ ...artifact }); continue; }
    if (artifact.role === "tileset-json") {
      artifacts.push({ ...artifact, relativeRef: servingTilesetRef(cell.cellId), byteSize: pins.tileset.byteSize, checksumSha256: pins.tileset.checksumSha256 });
      continue;
    }
    artifacts.push({ ...artifact });
  }
  if (artifacts.filter((artifact) => artifact.role === "glb").length !== assets.length * 2) {
    servingFail(`retention manifest ${retention.packageId} does not declare exactly two GLB artifacts per asset.`);
  }

  return {
    schemaVersion: retention.schemaVersion,
    packageId: pins.packageId,
    audience: "public",
    generatedAt: pins.generatedAt,
    immutable: true,
    release: { ...pins.release },
    baseIdentitySet: { ...pins.baseIdentitySet },
    ownershipLedger: { ...pins.ownershipLedger },
    cells: [{ ...cell, cellRelease: { ...pins.cellRelease }, predecessor: null }],
    assets,
    artifacts,
    tilesetRef: servingTilesetRef(cell.cellId),
    declaredTotalBytes: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
  };
}

// ---------------------------------------------------------------------------
// Release-graph parts
// ---------------------------------------------------------------------------

export interface ServingArtifactBlob { ref: ExteriorArtifactRef; bytes: Uint8Array }

/**
 * Audience-scoped artifact envelope, byte-identical in shape to the one every
 * curated wave emits. The audience is inside the hashed body, so the private and
 * public ownership-ledger blobs carry one logical ID and can never collide on
 * the graph's checksum-uniqueness rule.
 */
export function servingArtifactBlob(
  audience: ExteriorReleaseAudience,
  kind: ExteriorArtifactKind,
  logicalId: string,
  payload: unknown,
): ServingArtifactBlob {
  const relativeRef = servingArtifactRef(audience, kind, logicalId);
  const bytes = encode(`${stableSerialize({ schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION, audience, kind, logicalId, payload })}\n`);
  return { ref: { logicalId, kind, relativeRef, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) }, bytes };
}

/**
 * A fetched document's blob: the RAW document, not an envelope.
 *
 * Sidecars and assembly packages are parsed by the browser, so their bytes must
 * decode to exactly the object their validator expects. The envelope form above
 * is for artifacts the runtime only ever reads out of `release-graph.json`.
 */
export function servingDocumentBlob(kind: ExteriorArtifactKind, logicalId: string, document: unknown, serialized?: string): ServingArtifactBlob {
  const relativeRef = servingArtifactRef("public", kind, logicalId);
  const bytes = encode(serialized ?? `${stableSerialize(document)}\n`);
  return { ref: { logicalId, kind, relativeRef, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) }, bytes };
}

export function servingAssemblyBlob(manifest: MultiLodAssemblyManifest, cellReleaseId: string): ServingArtifactBlob {
  return servingDocumentBlob("cell-assembly-package", cellReleaseId, manifest, serializeMultiLodAssembly(manifest));
}

export interface ServingLedgerInput {
  releaseId: string;
  cityId: string;
  configId: string;
  /** The wave's cells, taken from the committed island ledger. */
  cells: ReadonlyArray<{ cellId: string; bounds: Wgs84Bounds; buildingIds: readonly string[] }>;
}

/**
 * The wave-scoped ownership ledger.
 *
 * Wave-scoped rather than island-scoped, on the curated `-p1` precedent: a
 * release's ledger enumerates the cells that release owns, its `baseIdentitySet`
 * is the exact membership of those cells, and `validateExteriorReleaseGraph`
 * checks both derivations. `order` is re-based to 0…n-1 because the graph
 * requires contiguity; the island-wide census order is a property of the census,
 * not of this release, and the runtime ranks by measured distance (ADR 0052 §1)
 * rather than by order.
 */
export function buildServingOwnershipLedger(input: ServingLedgerInput): ExteriorOwnershipLedger {
  const cells = [...input.cells].sort((left, right) => compareText(left.cellId, right.cellId));
  if (cells.length === 0) servingFail(`release ${input.releaseId} owns no cell.`);
  const owned = cells.flatMap((cell) => [...cell.buildingIds]);
  if (new Set(owned).size !== owned.length) servingFail(`release ${input.releaseId} declares a building owned by more than one cell.`);
  const membershipChecksum = sha256HexSync(stableSerialize([...owned].sort(compareText)));
  const coverage: Wgs84Bounds = {
    west: Math.min(...cells.map((cell) => cell.bounds.west)),
    south: Math.min(...cells.map((cell) => cell.bounds.south)),
    east: Math.max(...cells.map((cell) => cell.bounds.east)),
    north: Math.max(...cells.map((cell) => cell.bounds.north)),
  };
  const ledgerCells: ExteriorOwnershipCell[] = cells.map((cell, order) => ({
    cellId: cell.cellId,
    order,
    bounds: { ...cell.bounds },
    buildingIds: [...cell.buildingIds].sort(compareText),
    membershipChecksumSha256: sha256HexSync(stableSerialize([...cell.buildingIds].sort(compareText))),
  }));
  const fingerprint = sha256HexSync(stableSerialize({ releaseId: input.releaseId, cells: ledgerCells.map((cell) => cell.cellId), membershipChecksum })).slice(0, 16);
  return {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    ledgerId: servingLedgerId(input.releaseId, fingerprint),
    cityId: input.cityId,
    configId: input.configId,
    immutable: true,
    baseIdentitySet: {
      id: servingBaseIdentitySetId(input.releaseId, fingerprint),
      checksumSha256: membershipChecksum,
      buildingCount: owned.length,
    },
    coverage,
    cells: ledgerCells,
  };
}

export interface ServingCellReleaseInput {
  releaseId: string;
  /**
   * The retention release whose inventory and evidence records this release
   * republishes. See `servingInventoryId`: the available details below cite
   * ids scoped to THIS id, not to `releaseId`, because the retained GLB bytes
   * already name them and cannot be rewritten.
   */
  recordReleaseId: string;
  ledger: ExteriorOwnershipLedger;
  cell: ExteriorOwnershipCell;
  approval: ExteriorApprovalEvidence;
  /** Owned buildings this release ships, with their regenerated inventory ids. */
  availableBuildingIds: readonly string[];
  /** Owned buildings this release does not ship, with the stated reason. */
  unavailableReasons: ReadonlyMap<string, string>;
}

/**
 * One cell release: every owned building, once, with an explicit status.
 *
 * The two sets are checked to partition the owned membership exactly, because
 * that is the property `assemblyCellCoverage` relies on at load time and a
 * mismatch discovered in the browser is a mismatch discovered too late.
 */
export function buildServingCellRelease(input: ServingCellReleaseInput): ExteriorCellRelease {
  const cellReleaseId = servingCellReleaseId(input.releaseId, input.cell.cellId);
  const available = new Set(input.availableBuildingIds);
  const details: ExteriorBuildingDetail[] = [];
  for (const buildingId of [...input.cell.buildingIds].sort(compareText)) {
    if (available.has(buildingId)) {
      details.push({
        buildingId,
        status: "available",
        inventoryId: servingInventoryId(input.recordReleaseId, buildingId),
        evidenceShardId: servingEvidenceShardId(input.recordReleaseId, buildingId),
        runtimeTexture: false,
      });
      continue;
    }
    const reason = input.unavailableReasons.get(buildingId);
    if (reason === undefined) servingFail(`cell ${input.cell.cellId} owns ${buildingId}, which is neither shipped nor given a stated reason.`);
    details.push({
      buildingId,
      status: "unavailable",
      tombstoneId: servingTombstoneId(input.releaseId, buildingId),
      reason,
      previousInventoryId: null,
    });
  }
  for (const buildingId of available) if (!input.cell.buildingIds.includes(buildingId)) servingFail(`cell ${input.cell.cellId} ships ${buildingId}, which it does not own.`);
  return {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    cellReleaseId,
    version: EXTERIOR_SERVING_CELL_RELEASE_VERSION,
    audience: "public",
    artifactRef: servingArtifactRef("public", "cell-release", cellReleaseId),
    cityId: input.ledger.cityId,
    configId: input.ledger.configId,
    cellId: input.cell.cellId,
    bounds: { ...input.cell.bounds },
    ownershipLedgerId: input.ledger.ledgerId,
    baseIdentitySetId: input.ledger.baseIdentitySet.id,
    baseIdentitySetChecksumSha256: input.ledger.baseIdentitySet.checksumSha256,
    buildingIds: [...input.cell.buildingIds].sort(compareText),
    predecessor: null,
    promotion: { ...input.approval, exclusions: [...input.approval.exclusions] },
    fallback: { mode: "pinned-base", baseIdentitySetId: input.ledger.baseIdentitySet.id, checksumSha256: input.ledger.baseIdentitySet.checksumSha256 },
    buildingDetails: details,
    immutable: true,
  };
}

// ---------------------------------------------------------------------------
// Rights: license and per-building source evidence
// ---------------------------------------------------------------------------

export interface ServingSourceRights {
  license: ExteriorLicenseEvidence;
  source: (building: { buildingId: string; sourceRefId: string; sourceRecordId: string }, capturedAt: string, updatedAt: string) => ExteriorSourceEvidence;
}

/**
 * Rights read out of the approved source registry entry, never written here.
 *
 * This is the curated waves' `sourceRights` on the same registry entry and the
 * same conveyance-clause gate — `midtownCoreConveyanceRights` is imported rather
 * than restated so a reverted broadening fails the serving emitter closed for
 * the same reason and with the same message it fails a curated one.
 */
export function servingSourceRights(approvalId: string, licenseId: string): ServingSourceRights {
  const entry = getSourceRegistryEntry(EXTERIOR_SERVING_SOURCE_REGISTRY_ID);
  if (!entry) servingFail(`source registry entry ${EXTERIOR_SERVING_SOURCE_REGISTRY_ID} is absent.`);
  if (entry.datasetId !== "jh45-qr5r") servingFail(`source registry entry ${entry.id} no longer names dataset jh45-qr5r.`);
  if (entry.approval.state !== "approved") servingFail(`source registry entry ${entry.id} is not approved.`);
  if (entry.retention.maximumDays !== null) servingFail(`source registry entry ${entry.id} declares a retention expiry this release cannot carry.`);
  const conveyance = midtownCoreConveyanceRights(entry);
  const license: ExteriorLicenseEvidence = {
    id: licenseId,
    termsUrl: entry.termsUrl,
    attribution: entry.attribution,
    retention: { mode: "conditional", expiresAt: null, conditions: entry.retention.constraints },
    allowedUse: {
      privateDerivative: true,
      publicDisplay: conveyance.publicDisplay,
      derivativeConveyance: conveyance.derivativeConveyance,
      redistribution: conveyance.redistribution,
      runtimeTexture: false,
      trainingInput: false,
      generationInput: true,
      validationOnly: false,
    },
    personalDataRestricted: false,
  };
  return {
    license,
    source: (building, capturedAt, updatedAt) => {
      const expected = `source-ref:${entry.id}:${building.sourceRecordId}`;
      if (building.sourceRefId !== expected) servingFail(`building ${building.buildingId} cites source ref ${building.sourceRefId}, not the registry-derived ${expected}.`);
      return {
        id: building.sourceRefId,
        provider: entry.provider,
        datasetId: entry.datasetId,
        sourceRecordId: building.sourceRecordId,
        sourceUrl: entry.canonicalUrl,
        sourceDate: updatedAt,
        observedAt: capturedAt,
        capturedAt,
        updatedAt,
        attribution: entry.attribution,
        licenseId: license.id,
        approvalId,
      };
    },
  };
}

export interface ServingSidecarBuildingInput {
  buildingId: string;
  sourceRefId: string;
  sourceRecordId: string;
  inventory: ExteriorComponentInventory;
  /** The retained manifest's declared inventory hash, cross-checked here. */
  declaredInventoryHashSha256: string;
  /** The retained manifest asset's own `inventoryId`, cross-checked here. */
  declaredInventoryId: string;
  /** The retained manifest asset's own `evidenceShardId`, cross-checked here. */
  declaredEvidenceShardId: string;
}

export interface ServingSidecarInput {
  releaseId: string;
  /** The retention release whose records these shards are. See `servingInventoryId`. */
  recordReleaseId: string;
  cellReleaseId: string;
  approval: ExteriorApprovalEvidence;
  rights: ServingSourceRights;
  capture: { capturedAt: string; updatedAt: string };
  buildings: readonly ServingSidecarBuildingInput[];
}

/**
 * One ownership cell's inventory and evidence shards, as the fetched document
 * the C1 seam defined.
 *
 * The inventories are REGENERATED from the pinned base by the caller and their
 * hashes are compared against what the retained manifest declared. That
 * comparison is the whole reason a serving release can carry evidence it did not
 * itself materialize: an inventory whose hash differs from the retained
 * manifest's is not the inventory those bytes were validated under, and the
 * emitter stops rather than shipping a sidecar that describes different geometry
 * from the GLB beside it.
 */
export function buildServingCellDetailSidecar(input: ServingSidecarInput): ExteriorCellDetailSidecar {
  const artifactRef = servingArtifactRef("public", "cell-detail-sidecar", input.cellReleaseId);
  const inventoryShards: ExteriorInventoryShard[] = [];
  const evidenceShards: ExteriorEvidenceShard[] = [];
  for (const building of [...input.buildings].sort((left, right) => compareText(left.buildingId, right.buildingId))) {
    if (building.inventory.buildingId !== building.buildingId) servingFail(`inventory for ${building.buildingId} names building ${building.inventory.buildingId}.`);
    const inventoryHashSha256 = sha256HexSync(stableSerialize(building.inventory));
    if (inventoryHashSha256 !== building.declaredInventoryHashSha256) {
      servingFail(`regenerated inventory for ${building.buildingId} hashes ${inventoryHashSha256}, but the retained manifest declared ${building.declaredInventoryHashSha256}; the serving release would describe different geometry from the bytes it carries.`);
    }
    const ineligible = building.inventory.components.filter((component) => !isExteriorComponentReleaseEligible(component));
    if (ineligible.length > 0) servingFail(`asset ${building.buildingId} declares components no release may promote: ${ineligible.map((component) => `${component.kind} is ${component.state}`).join(", ")}.`);
    const inventoryId = servingInventoryId(input.recordReleaseId, building.buildingId);
    const evidenceShardId = servingEvidenceShardId(input.recordReleaseId, building.buildingId);
    // The binding to the immutable bytes. `verifyGlb` compares the GLB's
    // canonical `inventoryId`/`evidenceShardId` against the assembly asset's,
    // and the runtime then compares the asset's against the cell release detail
    // it renders under; the sidecar sits in the middle, because a shard the cell
    // release does not cite fails `validateExteriorCellDetailSidecar` and a cell
    // release that cites what the manifest does not fails `assembly-pin-mismatch`
    // in the browser. Checking the two ids HERE, against what the retained
    // manifest declared, makes that a build-time failure with a name on it
    // rather than a blank viewport.
    if (inventoryId !== building.declaredInventoryId || evidenceShardId !== building.declaredEvidenceShardId) {
      servingFail(`record ids for ${building.buildingId} derive ${inventoryId}/${evidenceShardId}, but the retained manifest declared ${building.declaredInventoryId}/${building.declaredEvidenceShardId}; the serving release would cite evidence the immutable GLB bytes do not name.`);
    }
    const source = input.rights.source(building, input.capture.capturedAt, input.capture.updatedAt);
    const constraintIds = [...new Set(building.inventory.components.flatMap((component) => component.state === "generated" ? component.generator.constraintSourceIds : []))];
    if (constraintIds.length !== 1 || constraintIds[0] !== source.id) servingFail(`inventory for ${building.buildingId} does not constrain exactly the ${source.id} source.`);
    inventoryShards.push({
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      shardId: inventoryId,
      audience: "public",
      artifactRef,
      inventoryId,
      inventory: building.inventory,
    });
    const graph: ExteriorEvidenceGraph = {
      schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
      sources: [source],
      licenses: [{ ...input.rights.license, allowedUse: { ...input.rights.license.allowedUse }, retention: { ...input.rights.license.retention } }],
      approvals: [{ ...input.approval, exclusions: [...input.approval.exclusions] }],
      evidence: [],
    };
    evidenceShards.push({
      schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
      shardId: evidenceShardId,
      audience: "public",
      artifactRef,
      inventoryId,
      graph,
    });
  }
  return {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    sidecarId: input.cellReleaseId,
    audience: "public",
    artifactRef,
    cellReleaseId: input.cellReleaseId,
    inventoryShards,
    evidenceShards,
  };
}

// ---------------------------------------------------------------------------
// Roots and snapshot
// ---------------------------------------------------------------------------

export interface ServingRootInput {
  releaseId: string;
  ledger: ExteriorOwnershipLedger;
  generatedAt: string;
  approval: ExteriorApprovalEvidence;
  textureAdmission: ExteriorTextureAdmission;
}

/**
 * The private root: one audience-scoped ownership-ledger blob and nothing else.
 *
 * The anti-leak shape every curated wave ships. No private byte is ever written
 * to the payload directory; the blob exists so the graph's two-root rule is
 * satisfied by a root that declares exactly what it owns.
 */
export function buildServingPrivateRoot(input: ServingRootInput, ledgerBlob: ServingArtifactBlob): ExteriorRootManifest {
  const draft: Omit<ExteriorRootManifest, "rootChecksumSha256"> = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    audience: "private",
    rootId: servingPrivateRootId(input.releaseId),
    releaseId: servingPrivateReleaseId(input.releaseId),
    cityId: input.ledger.cityId,
    configId: input.ledger.configId,
    generatedAt: input.generatedAt,
    immutable: true,
    artifactAllowlist: [ledgerBlob.ref.relativeRef],
    artifacts: [ledgerBlob.ref],
    approval: { ...input.approval, exclusions: [...input.approval.exclusions] },
    predecessor: null,
    privatePredecessor: null,
    textureAdmission: input.textureAdmission,
  };
  return { ...draft, rootChecksumSha256: exteriorServingRootChecksum(draft) };
}

export interface ServingPublicRootInput extends ServingRootInput {
  privateRoot: ExteriorRootManifest;
  /** Every public artifact EXCEPT the assembly packages, fully accounted. */
  artifacts: readonly ExteriorArtifactRef[];
  /** The assembly packages, whose byte accounting the pin excludes (D-B). */
  assemblyPackageRefs: readonly { logicalId: string; relativeRef: string }[];
  predecessor: { rootId: string; rootChecksumSha256: string } | null;
}

export interface ServingPublicRootDraft {
  root: ExteriorRootManifest;
  /** Fill each package's byteSize/checksumSha256 in place; the pin does not move. */
  finalize: (accounting: ReadonlyMap<string, { byteSize: number; checksumSha256: string }>) => ExteriorRootManifest;
}

/**
 * The public root, pinned BEFORE its assembly packages exist.
 *
 * `finalize` is the second half: it fills the byte accounting the pin
 * deliberately excludes and returns the root that is actually written. The
 * checksum is computed once, over the draft, and is asserted to be unchanged by
 * the fill — so a caller that filled the wrong artifact, or filled one the draft
 * did not declare, is refused rather than silently re-pinned.
 */
export function buildServingPublicRoot(input: ServingPublicRootInput): ServingPublicRootDraft {
  const placeholders: ExteriorArtifactRef[] = input.assemblyPackageRefs.map((entry) => ({
    logicalId: entry.logicalId,
    kind: "cell-assembly-package",
    relativeRef: entry.relativeRef,
    byteSize: 0,
    checksumSha256: "",
  }));
  const artifacts = [...input.artifacts, ...placeholders];
  const draft: Omit<ExteriorRootManifest, "rootChecksumSha256"> = {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    audience: "public",
    rootId: servingPublicRootId(input.releaseId),
    releaseId: input.releaseId,
    cityId: input.ledger.cityId,
    configId: input.ledger.configId,
    generatedAt: input.generatedAt,
    immutable: true,
    artifactAllowlist: artifacts.map((artifact) => artifact.relativeRef).sort(compareText),
    artifacts,
    approval: { ...input.approval, exclusions: [...input.approval.exclusions] },
    predecessor: input.predecessor,
    privatePredecessor: { rootId: input.privateRoot.rootId, rootChecksumSha256: input.privateRoot.rootChecksumSha256 },
    textureAdmission: input.textureAdmission,
  };
  const rootChecksumSha256 = exteriorServingRootChecksum(draft);
  const root: ExteriorRootManifest = { ...draft, rootChecksumSha256 };
  return {
    root,
    finalize: (accounting) => {
      if (accounting.size !== placeholders.length) servingFail(`the public root declares ${placeholders.length} assembly packages but ${accounting.size} were accounted.`);
      const filled = artifacts.map((artifact) => {
        if (artifact.kind !== "cell-assembly-package") return artifact;
        const entry = accounting.get(artifact.logicalId);
        if (!entry) servingFail(`assembly package ${artifact.logicalId} was declared by the root pin but never emitted.`);
        return { ...artifact, byteSize: entry.byteSize, checksumSha256: entry.checksumSha256 };
      });
      const finalized: ExteriorRootManifest = { ...draft, artifacts: filled, rootChecksumSha256 };
      const reChecked = exteriorServingRootChecksum({ ...finalized, rootChecksumSha256: undefined as unknown as string });
      if (reChecked !== rootChecksumSha256) servingFail("filling the assembly-package accounting moved the root pin, which the exclusion exists to prevent.");
      return finalized;
    },
  };
}

export interface ServingIndexInput {
  releaseId: string;
  ledger: ExteriorOwnershipLedger;
  snapshot: ExteriorRolloutSnapshot;
  snapshotChecksumSha256: string;
  /** Every per-cell package this release serves; the head is the whole set. */
  assemblyPackageIds: readonly string[];
  baseReleaseIds: readonly string[];
}

/**
 * The runtime index.
 *
 * `assemblyPackageIds` lists every per-cell package because the head pin is what
 * says which packages this release serves, and under the assembly seam there is
 * one per ownership cell rather than one per wave. That is O(cells) in the boot
 * document — 126 ids for `w02`, 883 island-wide — against the O(assets)
 * manifests the seam removed, which is the trade ADR 0052 §2 measured.
 */
export function buildServingIndex(input: ServingIndexInput): {
  schemaVersion: "1.0";
  releaseId: string;
  audience: "public";
  cityId: string;
  configId: string;
  defaultHead: { snapshotId: string; checksumSha256: string; assemblyPackageIds: string[] };
  canaryHeads: never[];
  baseCompatibility: { baseReleaseIds: string[] };
  localOnly: true;
  runtimeExternalNetwork: false;
} {
  const packageIds = [...input.assemblyPackageIds].sort(compareText);
  if (packageIds.length === 0) servingFail(`release ${input.releaseId} pins no assembly package.`);
  if (new Set(packageIds).size !== packageIds.length) servingFail(`release ${input.releaseId} pins a duplicate assembly package.`);
  return {
    schemaVersion: "1.0",
    releaseId: input.releaseId,
    audience: "public",
    cityId: input.ledger.cityId,
    configId: input.ledger.configId,
    defaultHead: { snapshotId: input.snapshot.snapshotId, checksumSha256: input.snapshotChecksumSha256, assemblyPackageIds: packageIds },
    canaryHeads: [],
    baseCompatibility: { baseReleaseIds: [...input.baseReleaseIds] },
    localOnly: true,
    runtimeExternalNetwork: false,
  };
}

export interface ServingSnapshotInput {
  releaseId: string;
  ledger: ExteriorOwnershipLedger;
  generatedAt: string;
  approval: ExteriorApprovalEvidence;
  cellReleaseRefs: ReadonlyMap<string, { cellReleaseId: string; checksumSha256: string }>;
}

export function buildServingSnapshot(input: ServingSnapshotInput): ExteriorRolloutSnapshot {
  const snapshotId = servingSnapshotId(input.releaseId);
  const cells = input.ledger.cells.map((cell) => {
    const entry = input.cellReleaseRefs.get(cell.cellId);
    if (!entry) servingFail(`snapshot is incomplete: cell ${cell.cellId} has no cell release.`);
    return { cellId: cell.cellId, cellReleaseId: entry.cellReleaseId, checksumSha256: entry.checksumSha256 };
  });
  return {
    schemaVersion: EXTERIOR_RELEASE_SCHEMA_VERSION,
    snapshotId,
    audience: "public",
    artifactRef: servingArtifactRef("public", "rollout-snapshot", snapshotId),
    cityId: input.ledger.cityId,
    configId: input.ledger.configId,
    ownershipLedgerId: input.ledger.ledgerId,
    baseIdentitySetId: input.ledger.baseIdentitySet.id,
    baseIdentitySetChecksumSha256: input.ledger.baseIdentitySet.checksumSha256,
    predecessor: null,
    rollbackTarget: null,
    cells,
    promotion: { ...input.approval, exclusions: [...input.approval.exclusions] },
    generatedAt: input.generatedAt,
    immutable: true,
  };
}
