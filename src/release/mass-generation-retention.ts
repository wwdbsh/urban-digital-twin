/**
 * The T004 mass-generation RETENTION package: successor profiles, the
 * checksum-pinned retention root, and the per-ownership-cell assembly manifest.
 *
 * ## Why a purpose-built validator exists, and why it widens no security gate
 *
 * `scripts/validate-multi-lod-assembly.mjs` is the PUBLIC package gate. It takes
 * a manifest path and, deliberately, no way to relax anything: its one flag
 * (`--require-texture-free`) is additive only, and a public package always
 * carries the embedded-image gate whether or not the operator asks for it. That
 * asymmetry is the whole reason the script is safe to point at untrusted bytes,
 * and it is why that file stays byte-untouched here.
 *
 * The retention waves need something that script cannot do. A `-c1` package is
 * textured under `procedural-replay` and sharded into ONE MANIFEST PER
 * OWNERSHIP CELL, because the CLI's 256 MiB in-memory replay bound makes a
 * whole-wave manifest infeasible — a wave is thousands of buildings and
 * gigabytes of GLB. Validating it needs a driver that walks every cell manifest
 * of a package and knows which admission policy the package was written under.
 *
 * The dangerous way to build that is a `--texture-admission` flag. It would turn
 * the admission decision into an OPERATOR ASSERTION: anyone able to run the
 * validator could declare `procedural-replay` over a package that never earned
 * it, and the embedded-image gate — the rights boundary between "generated from
 * named constants in this repository" and "derived from someone's photograph" —
 * would be one command-line token wide.
 *
 * So the policy is not an input. It is READ FROM THE PACKAGE'S OWN
 * CHECKSUM-PINNED ROOT:
 *
 *   1. the root is read by its declared byte size and hashed;
 *   2. its self-pin `rootChecksumSha256` is recomputed over its own canonical
 *      bytes and must agree, so a root edited to claim a policy it was not
 *      written under fails before any policy is read;
 *   3. `exteriorTextureAdmissionPolicyOf` — the SAME fail-closed reader the
 *      release emitter, the assembly validator and the runtime use — turns the
 *      root's declaration into the policy, where absent, malformed and unknown
 *      all mean `texture-free`;
 *   4. that policy, and nothing else, is handed to `validateMultiLodAssembly`
 *      and `replayMultiLodAssembly`.
 *
 * The validator therefore cannot admit a texture the package did not already
 * declare, and cannot be argued into it. It has strictly LESS authority than
 * the operator running it: there is no token, environment variable or flag that
 * reaches the admission decision. A package whose root says nothing is
 * validated texture-free and its textured GLBs fail — which is the fail-closed
 * direction. See ADR 0051.
 *
 * ## What a retention root is, and what it is NOT
 *
 * It is NOT an `ExteriorRootManifest`. That type's `artifactAllowlist` and its
 * closed `ExteriorArtifactKind` vocabulary describe a SERVING release — ownership
 * ledgers, cell releases, inventory and evidence shards, rollout snapshots — and
 * a retention package publishes none of those. Reusing it would have meant
 * either widening a closed security vocabulary to admit an "assembly-manifest"
 * kind, or filing manifests under a kind they are not. Both are worse than a
 * separate, smaller type that says only what is true.
 *
 * What IS reused is the admission vocabulary itself: `ExteriorTextureAdmission`
 * and its reader, unchanged. The retention root and a serving root therefore
 * cannot drift into two different ideas of what `procedural-replay` means.
 *
 * A retention package is never served. It is not in any runtime index, no
 * promoted default names it, and nothing in `src/runtime/` can reach it.
 */

import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import {
  V3_EXTENDED_GRAMMAR_OPTIONS,
  V3_ROOFTOP_HONESTY_OPTIONS,
} from "../domain/deterministic-facade-generator-v3.ts";
import { enuFrame, toEnuMeters } from "./block835-reference-package.ts";
import { V3T_QUALITY_BUDGETS } from "./block835-v3-package.ts";
import {
  exteriorTextureAdmissionPolicyOf,
  type ExteriorOwnershipCell,
  type ExteriorTextureAdmission,
  type ExteriorTextureAdmissionPolicy,
} from "./exterior-release.ts";
import type { MidtownCoreMaterializedBuilding, MidtownCoreShippedAsset } from "./midtown-core-release.ts";
import {
  sharedTextureArtifactRef,
  type V3WaveProfile,
} from "./midtown-core-v3-materialization.ts";
import {
  assemblyCellMembershipChecksum,
  type AssemblyArtifact,
  type AssemblyAsset,
  type AssemblyLod,
  type MultiLodAssemblyManifest,
} from "./multi-lod-assembly.ts";
import {
  PROCEDURAL_TEXTURE_PROFILE,
  PROCEDURAL_TEXTURE_SAMPLER_FILTER,
  proceduralTextureCatalog,
  type ProceduralTextureClass,
} from "./procedural-texture.ts";

const encoder = new TextEncoder();
function encode(value: string): Uint8Array { return encoder.encode(value); }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function slug(value: string): string { return value.replaceAll(":", "-"); }
function fail(message: string): never { throw new Error(`Mass-generation retention: ${message}`); }

export const MASS_GENERATION_RETENTION_SCHEMA_VERSION = "1.0" as const;

/** The suffix that names a retention successor of a frozen wave release. */
export const MASS_GENERATION_SUCCESSOR_SUFFIX = "-c1" as const;

/**
 * The admission envelope the retention waves generate under: the T003 grammar
 * extensions plus BOTH T004 rooftop honesty rules.
 *
 * ADR 0048 measured and withheld the extensions, and named the resolution it
 * withheld them FOR: "a successor release, not a constant edit" (R1 — the
 * envelope in the wave profile, frozen waves pinned to the shipped grammar, a
 * new approved wave selecting the extended one). This constant is that
 * selection and nothing wider. Every frozen wave profile keeps
 * `V3_FROZEN_WAVE_ADMISSION_ENVELOPE`, so no approved release's bytes move.
 */
export const MASS_GENERATION_ADMISSION_ENVELOPE = {
  ...V3_EXTENDED_GRAMMAR_OPTIONS,
  ...V3_ROOFTOP_HONESTY_OPTIONS,
} as const;

/**
 * Derives a wave's retention successor profile from the FROZEN profile it
 * succeeds.
 *
 * Spread-then-override, exactly as `exterior-t1-variants.ts` does it: seed,
 * tool, `generatedAt` and uncertainty arrive by spread and cannot be edited in
 * isolation, so a successor cannot silently acquire a different generator
 * identity than the wave it descends from. Only the fields the retention
 * decision actually changes are named here.
 */
export function massGenerationSuccessorProfile(base: V3WaveProfile): V3WaveProfile {
  if (base.releaseId.endsWith(MASS_GENERATION_SUCCESSOR_SUFFIX)) {
    fail(`${base.releaseId} is already a retention successor; deriving one from it would compound the suffix.`);
  }
  return {
    ...base,
    releaseId: `${base.releaseId}${MASS_GENERATION_SUCCESSOR_SUFFIX}`,
    admissionEnvelope: { ...MASS_GENERATION_ADMISSION_ENVELOPE },
    // ADR 0050. The cap is not relaxed; a building whose MEASURED deviation is
    // outside it emits full geometry at LOD 1 and declares that level
    // ineligible.
    lod1Policy: "measured-fallback",
    budgets: { ...V3T_QUALITY_BUDGETS },
    texture: PROCEDURAL_TEXTURE_PROFILE,
    textureFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
    // Shared URI delivery: the tiles ride once per package rather than once per
    // GLB, which is what makes a two-LOD textured island affordable at all.
    textureDelivery: "shared-uri",
  };
}

// ---------------------------------------------------------------------------
// Package paths
// ---------------------------------------------------------------------------

/** The retention root, relative to the package directory. */
export const RETENTION_ROOT_REF = "retention-root.json" as const;

/** One tileset per ownership cell; a whole-wave tileset is the thing being avoided. */
export function retentionTilesetRef(cellId: string): string {
  return `public/tiles/${slug(cellId)}/tileset.json`;
}

/** One assembly manifest per ownership cell. */
export function retentionCellManifestRef(cellId: string): string {
  return `public/assemblies/${slug(cellId)}.json`;
}

export function retentionCellPackageId(releaseId: string, cellId: string): string {
  return `assembly:${releaseId}:${cellId}`;
}

// ---------------------------------------------------------------------------
// The retention root
// ---------------------------------------------------------------------------

export interface RetentionCellManifestRef {
  cellId: string;
  relativeRef: string;
  byteSize: number;
  checksumSha256: string;
}

export interface RetentionReleaseRoot {
  schemaVersion: typeof MASS_GENERATION_RETENTION_SCHEMA_VERSION;
  rootId: string;
  /** Self-pin over this root's own canonical bytes with the field blanked. */
  rootChecksumSha256: string;
  releaseId: string;
  predecessorReleaseId: string;
  waveId: string;
  cityId: string;
  configId: string;
  generatedAt: string;
  immutable: true;
  /**
   * THE ONLY PLACE THE ADMISSION POLICY IS STATED. The validator reads it from
   * here and from nowhere else; there is no flag that reaches this decision.
   */
  textureAdmission: ExteriorTextureAdmission;
  baseIdentitySet: { id: string; checksumSha256: string };
  ownershipLedger: { id: string; checksumSha256: string };
  cellManifests: RetentionCellManifestRef[];
  /** What this package is and is not, carried in the bytes rather than in prose elsewhere. */
  retention: string;
}

/**
 * The root's IDENTITY PIN, over everything except its own checksum field and
 * its cell-manifest list.
 *
 * The two exclusions are not conveniences, they are forced. Each cell manifest
 * cites `release.rootChecksumSha256`, so a manifest's bytes depend on this
 * value; if this value in turn covered those bytes the definition would be
 * circular and no package could satisfy it. The list is therefore excluded and
 * the pin covers exactly the surface a manifest cites plus THE ADMISSION
 * POLICY — which is the whole point, since the policy is what the validator
 * reads out of this root and must not be editable after the fact.
 *
 * The cell-manifest list is not left unchecked. Every entry carries its
 * manifest's own SHA-256 and byte size, which the validator verifies on read,
 * and every manifest cross-cites this pin, so a manifest belonging to another
 * package — or a root re-pointed at manifests it did not produce — fails the
 * cross-check. What the exclusion costs is precisely one thing: the count of
 * manifests is not itself pinned, so the census accounting is what proves no
 * cell was dropped, and the validator refuses to compare it unless the whole
 * declared set was walked in that run.
 */
export function retentionRootChecksum(root: Omit<RetentionReleaseRoot, "rootChecksumSha256"> & { rootChecksumSha256?: string }): string {
  const identity = { ...root };
  delete (identity as { cellManifests?: unknown }).cellManifests;
  return sha256HexSync(stableSerialize({ ...identity, rootChecksumSha256: "" }));
}

export const RETENTION_STATEMENT =
  "T004 mass-generation retention package. It retains generated exterior bytes LOCALLY ONLY, under a gitignored payload directory, so a committed inventory can keep them checkable. Nothing here is conveyed, redistributed, published or served: no runtime index names this package, no promoted default selects it, and no approval envelope is widened by its existence. It succeeds a frozen wave release by identity only — that release's bytes, approval scope, licensing and retention terms are exactly as they were." as const;

/**
 * Fail-closed structural read of a retention root.
 *
 * Every failure returns the same shape rather than throwing, so a validator can
 * report the reason it refused instead of a stack trace.
 */
export function validateRetentionReleaseRoot(value: unknown): { ok: true; value: RetentionReleaseRoot } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const push = (message: string): void => { issues.push(message); };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, issues: ["root must be a JSON object."] };
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== MASS_GENERATION_RETENTION_SCHEMA_VERSION) push(`schemaVersion must be ${MASS_GENERATION_RETENTION_SCHEMA_VERSION}.`);
  if (root.immutable !== true) push("immutable must be literal true.");
  for (const key of ["rootId", "rootChecksumSha256", "releaseId", "predecessorReleaseId", "waveId", "cityId", "configId", "generatedAt", "retention"]) {
    if (typeof root[key] !== "string" || (root[key] as string).length === 0) push(`${key} must be a non-empty string.`);
  }
  if (typeof root.rootChecksumSha256 === "string" && !/^[0-9a-f]{64}$/u.test(root.rootChecksumSha256)) push("rootChecksumSha256 must be lowercase hex sha256.");
  for (const key of ["baseIdentitySet", "ownershipLedger"]) {
    const pin = root[key];
    if (typeof pin !== "object" || pin === null) { push(`${key} must be an immutable pin.`); continue; }
    const record = pin as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length === 0) push(`${key}.id must be a non-empty string.`);
    if (typeof record.checksumSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(record.checksumSha256)) push(`${key}.checksumSha256 must be lowercase hex sha256.`);
  }
  if (!Array.isArray(root.cellManifests) || root.cellManifests.length === 0) {
    push("cellManifests must be a non-empty array.");
  } else {
    const seenCells = new Set<string>();
    const seenRefs = new Set<string>();
    root.cellManifests.forEach((entry, index) => {
      if (typeof entry !== "object" || entry === null) { push(`cellManifests[${index}] must be an object.`); return; }
      const record = entry as Record<string, unknown>;
      if (typeof record.cellId !== "string" || record.cellId.length === 0) push(`cellManifests[${index}].cellId must be a non-empty string.`);
      else if (seenCells.has(record.cellId)) push(`cellManifests[${index}].cellId is declared twice: ${record.cellId}`);
      else seenCells.add(record.cellId);
      if (typeof record.relativeRef !== "string" || record.relativeRef.length === 0) push(`cellManifests[${index}].relativeRef must be a non-empty string.`);
      else if (seenRefs.has(record.relativeRef)) push(`cellManifests[${index}].relativeRef is declared twice: ${record.relativeRef}`);
      else seenRefs.add(record.relativeRef);
      if (typeof record.cellId === "string" && typeof record.relativeRef === "string" && record.relativeRef !== retentionCellManifestRef(record.cellId)) {
        push(`cellManifests[${index}].relativeRef does not match the ref its own cellId derives: ${record.relativeRef}`);
      }
      if (typeof record.byteSize !== "number" || !Number.isSafeInteger(record.byteSize) || record.byteSize <= 0) push(`cellManifests[${index}].byteSize must be a positive integer.`);
      if (typeof record.checksumSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(record.checksumSha256)) push(`cellManifests[${index}].checksumSha256 must be lowercase hex sha256.`);
    });
  }
  const admission = root.textureAdmission;
  if (typeof admission !== "object" || admission === null) push("textureAdmission must be declared; a retention root states its policy explicitly.");
  if (issues.length > 0) return { ok: false, issues };
  const candidate = root as unknown as RetentionReleaseRoot;
  // The self-pin is checked LAST and separately: a root that fails its own
  // checksum is not a root with a shape problem, it is a root that has been
  // edited since it was written, and the policy under it must not be read.
  const recomputed = retentionRootChecksum(candidate);
  if (recomputed !== candidate.rootChecksumSha256) {
    return { ok: false, issues: [`root self-pin disagrees with its own canonical bytes: declared ${candidate.rootChecksumSha256}, recomputed ${recomputed}.`] };
  }
  return { ok: true, value: candidate };
}

/**
 * The admission policy of a VERIFIED retention root.
 *
 * Deliberately takes the validated root rather than arbitrary JSON, so the
 * self-pin check above cannot be skipped on the way to the policy.
 */
export function retentionTextureAdmissionPolicy(root: RetentionReleaseRoot): ExteriorTextureAdmissionPolicy {
  return exteriorTextureAdmissionPolicyOf(root);
}

// ---------------------------------------------------------------------------
// Per-cell assembly manifest
// ---------------------------------------------------------------------------

export interface RetentionCellPackageInput {
  cell: ExteriorOwnershipCell;
  releaseId: string;
  generatedAt: string;
  cityId: string;
  configId: string;
  rootId: string;
  rootChecksumSha256: string;
  baseIdentitySet: { id: string; checksumSha256: string };
  ownershipLedger: { id: string; checksumSha256: string };
  /** Materialized buildings of THIS cell, each carrying both emitted LODs. */
  buildings: readonly MidtownCoreMaterializedBuilding[];
  /**
   * The enforced two-LOD descriptors AND the truth tiers the writer embedded,
   * keyed by canonical building id.
   */
  assemblyLods: ReadonlyMap<string, { lods: AssemblyLod[]; truthTiers: readonly string[] }>;
  inventoryId: (buildingId: string) => string;
  evidenceShardId: (buildingId: string) => string;
  uncertainty: string;
  /**
   * The capture chronology the writer embedded in every GLB. The replay
   * compares the manifest asset to those bytes, so this must be the SAME pair
   * the materialization was given, not a restatement of it.
   */
  sourceDates: { capturedAt: string | null; updatedAt: string | null };
}

export interface RetentionCellPackage {
  cellId: string;
  manifest: MultiLodAssemblyManifest;
  /** Bytes to write, keyed by package-relative ref: the tileset and the manifest. */
  files: Map<string, Uint8Array>;
  manifestRef: string;
  tilesetRef: string;
}

/**
 * Builds one ownership cell's two-LOD assembly manifest and its tileset.
 *
 * The cell is the validation unit because it is the largest unit that fits the
 * replay bound: a wave manifest would declare gigabytes and the CLI refuses
 * anything over 256 MiB in memory, by design.
 */
export function buildRetentionCellPackage(input: RetentionCellPackageInput): RetentionCellPackage {
  const { cell } = input;
  const buildings = [...input.buildings].sort((left, right) => compareText(left.buildingId, right.buildingId));
  if (buildings.length === 0) fail(`cell ${cell.cellId} packages no building; an empty cell manifest declares nothing to check.`);
  for (const building of buildings) {
    if (building.ownerCellId !== cell.cellId) fail(`building ${building.buildingId} is owned by ${building.ownerCellId}, not ${cell.cellId}.`);
  }

  const frame = enuFrame({
    longitude: (cell.bounds.west + cell.bounds.east) / 2,
    latitude: (cell.bounds.south + cell.bounds.north) / 2,
  });
  const cellBounds = {
    minimum: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    maximum: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };

  const glbArtifacts: AssemblyArtifact[] = [];
  const assets: AssemblyAsset[] = [];
  const tileChains: { canonicalFeatureId: string; tile: Record<string, unknown> }[] = [];
  const referencedTextureClasses = new Set<string>();

  for (const building of buildings) {
    const descriptor = input.assemblyLods.get(building.buildingId);
    if (!descriptor) fail(`building ${building.buildingId} has no assembly descriptor; the materialization was not asked for one.`);
    const lods = descriptor.lods;
    if (lods.length !== building.assets.length) {
      fail(`building ${building.buildingId} declares ${lods.length} levels against ${building.assets.length} emitted assets.`);
    }
    const assetByRef = new Map(building.assets.map((asset) => [asset.relativeRef, asset] as const));
    for (const lod of lods) {
      const asset = assetByRef.get(lod.artifactRef);
      if (!asset) fail(`level ${lod.lodId} of ${building.buildingId} names ${lod.artifactRef}, which this building did not emit.`);
      glbArtifacts.push({
        logicalId: `glb:${building.buildingId}:${lod.lodId}`,
        role: "glb",
        relativeRef: asset.relativeRef,
        byteSize: asset.byteSize,
        checksumSha256: asset.checksumSha256,
        ownerCellId: cell.cellId,
      });
      for (const textureClass of asset.sharedTextureClasses ?? []) referencedTextureClasses.add(textureClass);
    }

    // Both levels of one building occupy one place on the ground, so the tile
    // carries the FINE level's bounds and the coarse level rides the same
    // chain. A retention package is not served, so this tileset exists to
    // satisfy the assembly gate's own structural check rather than to stream.
    const fine = building.assets.find((asset) => asset.relativeRef === lods[0]!.artifactRef);
    if (!fine) fail(`building ${building.buildingId} emitted no fine level.`);
    const offset = toEnuMeters(frame, building.representative);
    const translation: [number, number, number] = [offset[0], 0, -offset[1]];
    for (let axis = 0; axis < 3; axis += 1) {
      cellBounds.minimum[axis] = Math.min(cellBounds.minimum[axis]!, fine.bounds.minimum[axis]! + translation[axis]!);
      cellBounds.maximum[axis] = Math.max(cellBounds.maximum[axis]!, fine.bounds.maximum[axis]! + translation[axis]!);
    }
    // The tileset expresses the LOD REFINEMENT CHAIN the assembly gate walks:
    // the coarsest level is the entry tile and refines to exactly one finer
    // level, and the finest is a zero-error leaf. Each tile's geometric error is
    // its own manifest level's, so the tileset cannot disagree with the
    // descriptors beside it.
    const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, translation[0], translation[1], translation[2], 1];
    const box = retentionTileBox(fine.bounds);
    // Folded FINEST FIRST so each step wraps the level below it: the fold's
    // last step is the coarsest level, which is the entry tile the gate walks.
    const chain = [...lods].reduce<Record<string, unknown> | null>((finer, level) => ({
      boundingVolume: { box },
      geometricError: level.geometricErrorMeters,
      refine: "REPLACE",
      transform,
      content: { uri: `../../${level.artifactRef.replace(/^public\//u, "")}` },
      ...(finer ? { children: [finer] } : {}),
    }), null);
    if (!chain) fail(`building ${building.buildingId} produced no tile chain.`);
    tileChains.push({ canonicalFeatureId: building.buildingId, tile: chain });

    assets.push({
      canonicalFeatureId: building.buildingId,
      ownerCellId: cell.cellId,
      inventoryId: input.inventoryId(building.buildingId),
      inventoryHashSha256: sha256HexSync(stableSerialize(building.inventory)),
      evidenceShardId: input.evidenceShardId(building.buildingId),
      truthTiers: [...descriptor.truthTiers] as AssemblyAsset["truthTiers"],
      sourceDates: { ...input.sourceDates },
      predecessor: building.predecessor ?? null,
      uncertainty: input.uncertainty,
      source: { kind: "facade-plan", planId: building.planId, planHashSha256: building.planHashSha256 },
      lods,
    });
  }

  const tileset = {
    asset: { version: "1.1" },
    geometricError: 1,
    root: {
      boundingVolume: {
        box: retentionTileBox({
          minimum: cellBounds.minimum as unknown as readonly [number, number, number],
          maximum: cellBounds.maximum as unknown as readonly [number, number, number],
        }),
      },
      geometricError: 1,
      refine: "REPLACE",
      children: [...tileChains].sort((left, right) => compareText(left.canonicalFeatureId, right.canonicalFeatureId)).map((chain) => chain.tile),
    },
  };
  const tilesetBytes = encode(JSON.stringify(tileset));
  const tilesetRef = retentionTilesetRef(cell.cellId);

  // ONLY the classes this cell's own GLBs reference. A release-wide list would
  // make an orphan of every class the cell does not draw, which the replay gate
  // refuses — correctly, since a package should not carry bytes nothing reads.
  const catalog = proceduralTextureCatalog();
  const textureArtifacts: AssemblyArtifact[] = [...referencedTextureClasses].sort(compareText).map((textureClass) => {
    const tile = catalog.get(textureClass as ProceduralTextureClass);
    if (!tile) fail(`detail tile ${textureClass} is not a class this repository's rasterizer produces.`);
    const relativeRef = sharedTextureArtifactRef(textureClass as ProceduralTextureClass);
    return { logicalId: `texture:${textureClass}`, role: "texture" as const, relativeRef, byteSize: tile.pngBytes.byteLength, checksumSha256: sha256HexBytes(tile.pngBytes), ownerCellId: null };
  });

  const artifacts: AssemblyArtifact[] = [
    ...glbArtifacts,
    ...textureArtifacts,
    { logicalId: `tileset:${cell.cellId}`, role: "tileset-json" as const, relativeRef: tilesetRef, byteSize: tilesetBytes.byteLength, checksumSha256: sha256HexBytes(tilesetBytes), ownerCellId: null },
  ].sort((left, right) => compareText(left.relativeRef, right.relativeRef));

  const packaged = cell.buildingIds.filter((buildingId) => buildings.some((building) => building.buildingId === buildingId));
  const manifest: MultiLodAssemblyManifest = {
    schemaVersion: "1.0",
    packageId: retentionCellPackageId(input.releaseId, cell.cellId),
    audience: "public",
    generatedAt: input.generatedAt,
    immutable: true,
    release: {
      rootId: input.rootId,
      rootChecksumSha256: input.rootChecksumSha256,
      releaseId: input.releaseId,
      cityId: input.cityId,
      configId: input.configId,
      privatePredecessor: null,
    },
    baseIdentitySet: { ...input.baseIdentitySet },
    ownershipLedger: { ...input.ownershipLedger },
    cells: [{
      cellId: cell.cellId,
      // A retention package publishes no cell RELEASE — nothing serves it, so
      // there is no promotion record to pin. The schema requires an immutable
      // pin here, so it carries the one immutable fact this package actually
      // has about the cell: the digest of the membership it packaged. It is
      // deliberately the same value as `membershipChecksumSha256` beside it,
      // rather than a fabricated release id with an invented checksum.
      cellRelease: { id: `cell-retention:${input.releaseId}:${cell.cellId}`, checksumSha256: assemblyCellMembershipChecksum(packaged) },
      predecessor: null,
      buildingIds: packaged,
      membershipChecksumSha256: assemblyCellMembershipChecksum(packaged),
    }],
    assets,
    artifacts,
    tilesetRef,
    declaredTotalBytes: artifacts.reduce((total, artifact) => total + artifact.byteSize, 0),
  };

  const manifestBytes = encode(`${JSON.stringify(manifest, null, 2)}\n`);
  return {
    cellId: cell.cellId,
    manifest,
    files: new Map<string, Uint8Array>([[tilesetRef, tilesetBytes], [retentionCellManifestRef(cell.cellId), manifestBytes]]),
    manifestRef: retentionCellManifestRef(cell.cellId),
    tilesetRef,
  };
}

function retentionTileBox(bounds: MidtownCoreShippedAsset["bounds"]): number[] {
  const center = [0, 1, 2].map((axis) => (bounds.minimum[axis]! + bounds.maximum[axis]!) / 2);
  const half = [0, 1, 2].map((axis) => Math.max((bounds.maximum[axis]! - bounds.minimum[axis]!) / 2, 0.001));
  return [
    center[0]!, center[1]!, center[2]!,
    half[0]!, 0, 0,
    0, half[1]!, 0,
    0, 0, half[2]!,
  ];
}
