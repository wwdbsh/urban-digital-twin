/**
 * Runtime loader for the near-tier ground embellishment release (Task T010).
 *
 * This is a SEPARATE loading path from `./ground-release-runtime.ts`, on
 * purpose and by the T009 architect's requirement. That module's asset loop
 * refuses any non-base class outright, and widening it would have made one
 * loader responsible for two contracts with opposite tier rules — a flat asset
 * must declare exactly one unbounded flat tier, an embellishment asset must
 * declare at least one finite `near-3d` tier and no flat tier at all. So the
 * guard there stays exactly as it was and the second contract is served here.
 *
 * What is NOT duplicated:
 *
 * - **The validators.** `validateGroundReleaseGraph` (T005) already knows both
 *   halves of the tier contract, so this module calls it rather than restating
 *   any rule. The embellishment release passes it unmodified.
 * - **The identity re-derivation.** The manifest declares no checksum for
 *   `ledger.json`, `features.json` or `parts.json` here either, so the same
 *   binding closes the same gap: `groundOwnershipLedgerId` over the loaded
 *   ledger must equal the `ownershipLedgerId` the document pins, and the
 *   ledger's pinned `baseIdentitySet.checksumSha256` must re-derive from the
 *   loaded features and parts (inside the graph validator).
 * - **The digest and the request gate.** Imported from the flat runtime, so
 *   there is exactly one hash path and one concurrency ceiling in this family.
 *
 * What is different, and why:
 *
 * 1. **Fail-closed points AWAY from the base.** A flat-ground failure removes
 *    the ground. An embellishment failure removes only the embellishment: the
 *    flat base is a separate release, loaded by a separate loader, in separate
 *    state, and nothing in this module can reach it. That is the whole
 *    architectural reason for the split, not merely a convention.
 * 2. **Serving is gated to a canary wave.** `GROUND_EMBELLISHMENT_CANARY_WAVES`
 *    names the wave ids; the level-14 tile rows come from `EXTERIOR_WAVE_PLAN`,
 *    which is the coverage contract the building waves already run on. T011
 *    widens this to every wave by changing the constant, and nothing else.
 * 3. **Activation is by measured distance against the TIER's own ceiling.**
 *    The 400 m in this release is read off `tier.maxDistanceMeters` per asset,
 *    never from a constant in this file — the same discipline
 *    `selectExteriorLod` applies to a building LOD. A release that ships a
 *    different ceiling changes behaviour without a code change.
 * 4. **A per-artifact serving ceiling exists.** T009 recorded that its largest
 *    artifact is 94.6% of `CITYWIDE_BUDGETS.geometryShardBytes` and that
 *    nothing gated it. It is gated here: an artifact over that ceiling is
 *    refused and named, rather than drawn because it happened to fit today.
 */

import {
  GROUND_EMBELLISHMENT_CLASSES,
  isGroundEmbellishmentClass,
  type GroundEmbellishmentClass,
  type GroundFeature,
} from "../domain/ground.ts";
import { CITYWIDE_BUDGETS } from "../release/citywide-release.ts";
import { EXTERIOR_WAVE_PLAN, type ExteriorWaveId } from "../release/exterior-wave-ledger.ts";
import {
  GROUND_PARTITION_SCHEMES,
  MANHATTAN_GROUND_EXTENT,
  groundCellTileKey,
  groundOwnershipLedgerId,
  groundPartitionTiles,
  validateGroundReleaseGraph,
  type GroundAssetEntry,
  type GroundBounds,
  type GroundOwnershipCell,
  type GroundOwnershipLedger,
  type GroundReleaseDocument,
} from "../release/ground-release.ts";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE } from "./citywide-overview-cell-extents.ts";
import { unitDistanceMeters } from "./exterior-visibility-scheduler.ts";
import {
  GroundArtifactCache,
  GroundRequestGate,
  groundArtifactSha256,
  groundCacheKey,
  type GroundFetcher,
} from "./ground-release-runtime.ts";
import { isSafeReleaseArtifactReference } from "./path-security.ts";

export const MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID = "manhattan-ground-embellishment-20260825";
export const GROUND_EMBELLISHMENT_ARTIFACT_SCHEMA_VERSION = "manhattan-ground-embellishment-artifact-1";

/**
 * The canary's scope: which building waves may serve near-tier embellishments.
 *
 * One wave this cycle. The list is the ONLY thing that has to change for T011
 * to serve the island — every consumer below derives its rows from whatever is
 * named here, and nothing anywhere hardcodes "midtown".
 */
export const GROUND_EMBELLISHMENT_CANARY_WAVES: readonly ExteriorWaveId[] = ["midtown-core"];

/**
 * The most level-14 cells a single ground point can be within 400 m of: four.
 *
 * DERIVED, not chosen. A level-14 cell spans 180/2^14 degrees of latitude,
 * which is about 1.22 km at this latitude and is the cell's shorter side. Any
 * activation radius below that cannot reach past the cells meeting at the
 * nearest corner, so the worst case is the 2x2 block around a corner. The
 * ceiling is therefore a fact about the partition rather than a budget somebody
 * picked, and `ground-embellishment-runtime.test.ts` re-derives it.
 */
export const GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS = 4;

/**
 * Residency ceilings for the near tier, both borrowed or derived.
 *
 * `maxArtifactBytes` is `CITYWIDE_BUDGETS.geometryShardBytes` — the ceiling the
 * rest of this application's shard-shaped JSON already lives under, and the one
 * T009's watch item measured its largest artifact against. `maxCachedBytes` is
 * that ceiling times the number of cells that can be active at once, so the
 * cache cannot hold more than the scene can legitimately be showing.
 */
export const GROUND_EMBELLISHMENT_BUDGETS = {
  maxArtifactBytes: CITYWIDE_BUDGETS.geometryShardBytes,
  maxActiveCells: GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS,
  maxCachedBytes: CITYWIDE_BUDGETS.geometryShardBytes * GROUND_EMBELLISHMENT_MAX_ACTIVE_CELLS,
  maxConcurrentRequests: CITYWIDE_BUDGETS.maxConcurrentRequests,
} as const;

/** The planar metric the exterior scheduler measures its own cell distances in. */
const DISTANCE_METRIC = {
  metersPerDegreeLongitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLongitude,
  metersPerDegreeLatitude: CITYWIDE_OVERVIEW_CELL_EXTENTS_SOURCE.metersPerDegreeLatitude,
} as const;

// ---------------------------------------------------------------------------
// Artifact shape
// ---------------------------------------------------------------------------

/** The authored vertical profile a renderer extrudes the shipped alignment by. */
export interface GroundEmbellishmentProfile {
  topElevationMeters: number;
  roadbedElevationMeters: number;
  authoredRiseMeters: number;
  profileIsEstimated: boolean;
}

export interface GroundEmbellishmentDerivation {
  algorithm: string;
  inputDataset: string;
  note: string;
  profile: GroundEmbellishmentProfile;
}

export interface GroundEmbellishmentMultiLineString {
  type: "MultiLineString";
  coordinates: number[][][];
}

export interface GroundEmbellishmentArtifactPart {
  partId: string;
  canonicalFeatureId: string;
  clipped: boolean;
  boundaryCoincident: boolean;
  geometry: GroundEmbellishmentMultiLineString;
  sourceProperties?: Record<string, unknown>;
}

export interface GroundEmbellishmentCellArtifact {
  schemaVersion: string;
  releaseId: string;
  cellId: string;
  class: GroundEmbellishmentClass;
  cellBounds: GroundBounds;
  coordinateDecimals: number;
  claimLevel: "estimated";
  derivation: GroundEmbellishmentDerivation;
  partCount: number;
  parts: GroundEmbellishmentArtifactPart[];
}

/** A verified artifact plus the byte size that was hashed to admit it. */
export interface LoadedGroundEmbellishmentArtifact {
  artifact: GroundEmbellishmentCellArtifact;
  byteSize: number;
  checksumSha256: string;
}

/** One cell the canary may serve, with the ceiling the release itself declares. */
export interface GroundEmbellishmentServingCell {
  cellId: string;
  groundClass: GroundEmbellishmentClass;
  bounds: GroundBounds;
  /** The tier's own `maxDistanceMeters`. Never a runtime constant. */
  maxDistanceMeters: number;
  /** Ledger order, the deterministic tiebreak. */
  order: number;
}

export interface LoadedGroundEmbellishmentRelease {
  releaseId: string;
  document: GroundReleaseDocument;
  ledger: GroundOwnershipLedger;
  features: readonly GroundFeature[];
  shippedClasses: readonly GroundEmbellishmentClass[];
  partitionTileLevel: number;
  coverage: GroundBounds;
  /** The level-14 tile rows the canary wave set covers. */
  canaryTileRows: ReadonlySet<number>;
  /** Cells inside the canary wave that ship at least one embellishment asset. */
  servingCells: readonly GroundEmbellishmentServingCell[];
  feature(canonicalFeatureId: string): GroundFeature | undefined;
  cell(cellId: string): { cell: GroundOwnershipCell; assets: ReadonlyMap<GroundEmbellishmentClass, GroundAssetEntry> } | undefined;
  loadCellClass(cellId: string, groundClass: GroundEmbellishmentClass, signal?: AbortSignal): Promise<LoadedGroundEmbellishmentArtifact>;
  cached(cellId: string, groundClass: GroundEmbellishmentClass): LoadedGroundEmbellishmentArtifact | undefined;
  retain(keep: ReadonlySet<string>): number;
  residency(): { entries: number; bytes: number; evictions: number };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBasePath(basePath: string): string {
  if (!basePath.startsWith(`/data/${MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID}/`) || !basePath.endsWith("/")) {
    throw new Error("Ground embellishment base path is not the approved local release root.");
  }
  return basePath;
}

function localDataPath(basePath: string, fileName: string): string {
  if (!/^[a-z0-9._-]+\.json$/u.test(fileName) || fileName.includes("..")) throw new Error("Ground embellishment data path is unsafe.");
  return `${basePath}${fileName}`;
}

async function fetchJson(fetcher: GroundFetcher, url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Ground embellishment request failed (${response.status}) for ${url}.`);
  return response.json();
}

// ---------------------------------------------------------------------------
// Canary wave gating
// ---------------------------------------------------------------------------

/**
 * The level-14 tile rows a set of wave ids covers.
 *
 * Read out of `EXTERIOR_WAVE_PLAN` rather than restated: those ranges ARE the
 * coverage contract the building waves were accepted against, and a curb ring
 * that disagreed with the buildings it sits beside would be a second, silent
 * geography. A wave with no row range (Block 835, a declared set carved out of
 * a tile) contributes nothing here and is rejected rather than ignored, because
 * "serve embellishments for a declared building set" is a question this task
 * did not answer.
 */
export function groundEmbellishmentCanaryTileRows(waveIds: readonly ExteriorWaveId[] = GROUND_EMBELLISHMENT_CANARY_WAVES): ReadonlySet<number> {
  const rows = new Set<number>();
  for (const waveId of waveIds) {
    const wave = EXTERIOR_WAVE_PLAN.find((candidate) => candidate.waveId === waveId);
    if (!wave) throw new Error(`Ground embellishment canary names unknown wave ${waveId}.`);
    if (wave.tileRowRange === null) throw new Error(`Wave ${waveId} owns no tile rows; it cannot scope a ground embellishment canary.`);
    for (let rowY = wave.tileRowRange.northRowY; rowY <= wave.tileRowRange.southRowY; rowY += 1) rows.add(rowY);
  }
  return rows;
}

/** Whether a ground cell's level-14 row falls inside the canary wave set. */
export function isGroundEmbellishmentCanaryCell(cellId: string, rows: ReadonlySet<number>): boolean {
  let tile;
  try {
    tile = groundCellTileKey(cellId);
  } catch {
    return false;
  }
  return tile.level === 14 && rows.has(tile.y);
}

// ---------------------------------------------------------------------------
// Distance activation
// ---------------------------------------------------------------------------

export interface GroundEmbellishmentActivationInput {
  /** The settled camera's ground point, the same one the flat streaming pass centres on. */
  groundCenter: { longitude: number; latitude: number } | null | undefined;
  cells: readonly GroundEmbellishmentServingCell[];
  maxActiveCells?: number;
}

export interface GroundEmbellishmentActivation {
  cellId: string;
  groundClass: GroundEmbellishmentClass;
  distanceMeters: number;
  key: string;
}

/**
 * Which canary cells the camera is close enough to serve, deterministically.
 *
 * `unitDistanceMeters` is the exact function whose results the exterior
 * scheduler publishes as `distanceMetersByUnitId`, measured in the same frozen
 * planar metric — so this is the existing measured-distance machinery applied
 * to a ground cell rectangle, not a second distance policy. (The scheduler's
 * published map itself cannot be reused directly: it is keyed by exterior cell
 * ids, and a ground cell is a different partition with different ids.)
 *
 * No ground centre means no activation. A camera whose footprint has not
 * settled has no defensible distance, and guessing one would make the near tier
 * flicker on a pose nobody is looking from.
 */
export function activeGroundEmbellishmentCells(input: GroundEmbellishmentActivationInput): GroundEmbellishmentActivation[] {
  const center = input.groundCenter;
  if (!center || !Number.isFinite(center.longitude) || !Number.isFinite(center.latitude)) return [];
  const maxActiveCells = input.maxActiveCells ?? GROUND_EMBELLISHMENT_BUDGETS.maxActiveCells;
  const ranked = input.cells
    .map((cell) => ({
      cell,
      distanceMeters: unitDistanceMeters(cell.bounds, center.longitude, center.latitude, DISTANCE_METRIC),
    }))
    .filter((entry) => entry.distanceMeters <= entry.cell.maxDistanceMeters)
    .sort((left, right) => (left.distanceMeters === right.distanceMeters
      ? left.cell.order - right.cell.order
      : left.distanceMeters - right.distanceMeters));
  return ranked.slice(0, maxActiveCells).map((entry) => ({
    cellId: entry.cell.cellId,
    groundClass: entry.cell.groundClass,
    distanceMeters: entry.distanceMeters,
    key: groundCacheKey(entry.cell.cellId, entry.cell.groundClass),
  }));
}

// ---------------------------------------------------------------------------
// Per-cell artifact validation
// ---------------------------------------------------------------------------

export interface GroundEmbellishmentArtifactExpectation {
  releaseId: string;
  cellId: string;
  groundClass: GroundEmbellishmentClass;
  cellBounds: GroundBounds;
  ownedPartIds: ReadonlySet<string>;
  knownFeatureIds: ReadonlySet<string>;
}

function validLine(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length < 2) return false;
  return value.every((position) => Array.isArray(position)
    && position.length >= 2
    && typeof position[0] === "number" && Number.isFinite(position[0]) && Math.abs(position[0]) <= 180
    && typeof position[1] === "number" && Number.isFinite(position[1]) && Math.abs(position[1]) <= 90);
}

function validProfile(value: unknown): value is GroundEmbellishmentProfile {
  if (!record(value)) return false;
  const numeric = (["topElevationMeters", "roadbedElevationMeters", "authoredRiseMeters"] as const)
    .every((field) => typeof value[field] === "number" && Number.isFinite(value[field]));
  return numeric && value.profileIsEstimated === true && (value.topElevationMeters as number) > (value.roadbedElevationMeters as number);
}

/**
 * Structural and RELATIONAL validation of one per-cell embellishment artifact.
 *
 * Same standard as the flat artifact validator, with three additions the flat
 * shape has no analogue for: the geometry is a MultiLineString rather than a
 * MultiPolygon, the claim level must literally be `estimated` (a curb that
 * arrived claiming to be source-backed is a corrupted claim, not a better one),
 * and the vertical profile must be present, estimated, and a genuine rise —
 * because a renderer extrudes from it, and a zero or missing profile would draw
 * a degenerate solid while still calling itself a curb.
 */
export function validateGroundEmbellishmentCellArtifact(
  value: unknown,
  expectation: GroundEmbellishmentArtifactExpectation,
): GroundEmbellishmentCellArtifact {
  const label = `${expectation.cellId}/${expectation.groundClass}`;
  if (!record(value)) throw new Error(`Ground embellishment artifact for ${label} is not an object.`);
  if (value.schemaVersion !== GROUND_EMBELLISHMENT_ARTIFACT_SCHEMA_VERSION) throw new Error(`Ground embellishment artifact ${label} declares an unsupported schema.`);
  if (value.releaseId !== expectation.releaseId) throw new Error(`Ground embellishment artifact ${label} names release ${String(value.releaseId)}.`);
  if (value.cellId !== expectation.cellId) throw new Error(`Ground embellishment artifact ${label} names cell ${String(value.cellId)}.`);
  if (value.class !== expectation.groundClass) throw new Error(`Ground embellishment artifact ${label} names class ${String(value.class)}.`);
  if (value.claimLevel !== "estimated") throw new Error(`Ground embellishment artifact ${label} declares claim level ${String(value.claimLevel)}; an embellishment is always estimated.`);
  if (!record(value.cellBounds)
    || value.cellBounds.west !== expectation.cellBounds.west
    || value.cellBounds.south !== expectation.cellBounds.south
    || value.cellBounds.east !== expectation.cellBounds.east
    || value.cellBounds.north !== expectation.cellBounds.north) {
    throw new Error(`Ground embellishment artifact ${label} declares bounds that are not its own partition tile.`);
  }
  if (!record(value.derivation) || !validProfile(value.derivation.profile)) {
    throw new Error(`Ground embellishment artifact ${label} carries no estimated vertical profile; a renderer has nothing to extrude honestly.`);
  }
  if (!Array.isArray(value.parts) || value.parts.length === 0) throw new Error(`Ground embellishment artifact ${label} carries no parts.`);
  if (value.partCount !== value.parts.length) throw new Error(`Ground embellishment artifact ${label} declares ${String(value.partCount)} parts and carries ${value.parts.length}.`);
  const seen = new Set<string>();
  for (const part of value.parts) {
    if (!record(part)) throw new Error(`Ground embellishment artifact ${label} carries a non-object part.`);
    if (typeof part.partId !== "string" || !expectation.ownedPartIds.has(part.partId)) {
      throw new Error(`Ground embellishment artifact ${label} carries part ${String(part.partId)}, which cell ${expectation.cellId} does not own.`);
    }
    if (seen.has(part.partId)) throw new Error(`Ground embellishment artifact ${label} carries part ${part.partId} twice.`);
    seen.add(part.partId);
    if (typeof part.canonicalFeatureId !== "string" || !expectation.knownFeatureIds.has(part.canonicalFeatureId)) {
      throw new Error(`Ground embellishment artifact ${label} carries part ${part.partId} for unknown feature ${String(part.canonicalFeatureId)}.`);
    }
    const geometry = part.geometry;
    if (!record(geometry) || geometry.type !== "MultiLineString" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      throw new Error(`Ground embellishment artifact ${label} carries part ${part.partId} without MultiLineString geometry.`);
    }
    for (const line of geometry.coordinates) {
      if (!validLine(line)) throw new Error(`Ground embellishment artifact ${label} carries part ${part.partId} with an invalid line.`);
    }
  }
  return value as unknown as GroundEmbellishmentCellArtifact;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadGroundEmbellishmentRelease(
  basePath = `/data/${MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID}/`,
  signal?: AbortSignal,
  fetcher: GroundFetcher = globalThis.fetch.bind(globalThis),
  canaryWaves: readonly ExteriorWaveId[] = GROUND_EMBELLISHMENT_CANARY_WAVES,
): Promise<LoadedGroundEmbellishmentRelease> {
  const normalizedPath = normalizeBasePath(basePath);
  const [documentValue, ledgerValue, featuresValue, partsValue] = await Promise.all([
    fetchJson(fetcher, localDataPath(normalizedPath, "release.json"), signal),
    fetchJson(fetcher, localDataPath(normalizedPath, "ledger.json"), signal),
    fetchJson(fetcher, localDataPath(normalizedPath, "features.json"), signal),
    fetchJson(fetcher, localDataPath(normalizedPath, "parts.json"), signal),
  ]);

  const graph = validateGroundReleaseGraph({ ledger: ledgerValue, document: documentValue, features: featuresValue, parts: partsValue });
  if (!graph.ok) {
    throw new Error(`Ground embellishment release failed closed: ${graph.issues.slice(0, 4).map((entry) => `${entry.path} ${entry.message}`).join("; ")}`);
  }
  const { ledger, document, features } = graph.value;
  if (document.releaseId !== MANHATTAN_GROUND_EMBELLISHMENT_RELEASE_ID) throw new Error(`Ground embellishment release id mismatch: ${document.releaseId}.`);

  const derivedLedgerId = groundOwnershipLedgerId({
    cityId: ledger.cityId,
    configId: ledger.configId,
    partitionSchemeId: ledger.partitionSchemeId,
    extentId: MANHATTAN_GROUND_EXTENT.extentId,
    coverage: ledger.coverage,
    baseIdentitySet: ledger.baseIdentitySet,
    cells: ledger.cells,
  });
  if (derivedLedgerId !== ledger.ledgerId) {
    throw new Error("Ground embellishment ownership ledger identity does not re-derive from its own contents; the ledger failed closed.");
  }
  const partition = groundPartitionTiles(MANHATTAN_GROUND_EXTENT, ledger.partitionSchemeId);
  if (partition.tiles.length !== ledger.cells.length
    || partition.coverage.west !== ledger.coverage.west
    || partition.coverage.south !== ledger.coverage.south
    || partition.coverage.east !== ledger.coverage.east
    || partition.coverage.north !== ledger.coverage.north) {
    throw new Error("Ground embellishment ownership ledger does not partition the declared Manhattan extent.");
  }
  const tileLevel = GROUND_PARTITION_SCHEMES[ledger.partitionSchemeId as keyof typeof GROUND_PARTITION_SCHEMES]?.tileLevel;
  if (tileLevel === undefined) throw new Error(`Unknown ground partition scheme ${ledger.partitionSchemeId}.`);

  const featureById = new Map(features.map((feature) => [feature.canonicalFeatureId, feature]));
  const knownFeatureIds = new Set(featureById.keys());
  const cellIndex = new Map<string, { cell: GroundOwnershipCell; assets: Map<GroundEmbellishmentClass, GroundAssetEntry>; ownedPartIds: Set<string> }>();
  for (const cell of ledger.cells) {
    cellIndex.set(cell.cellId, { cell, assets: new Map(), ownedPartIds: new Set(cell.partIds) });
  }

  // The mirror image of the flat loader's guard, and the reason this module
  // exists. That one refuses everything that is not a base class; this one
  // refuses everything that is not an embellishment class, so neither release
  // can be served by the loader written for the other.
  const shipped = new Set<GroundEmbellishmentClass>();
  for (const asset of document.assets) {
    const entry = cellIndex.get(asset.cellId);
    if (!entry) throw new Error(`Ground embellishment asset ${asset.assetId} names a cell outside the ownership ledger.`);
    if (!isGroundEmbellishmentClass(asset.class)) throw new Error(`Ground embellishment asset ${asset.assetId} declares class ${asset.class}, which is not an embellishment class; this loader serves embellishments only.`);
    if (entry.assets.has(asset.class)) throw new Error(`Ground embellishment cell ${asset.cellId} declares class ${asset.class} twice.`);
    entry.assets.set(asset.class, asset);
    shipped.add(asset.class);
  }

  const canaryTileRows = groundEmbellishmentCanaryTileRows(canaryWaves);
  const servingCells: GroundEmbellishmentServingCell[] = [];
  for (const cell of ledger.cells) {
    const entry = cellIndex.get(cell.cellId)!;
    if (entry.assets.size === 0) continue;
    if (!isGroundEmbellishmentCanaryCell(cell.cellId, canaryTileRows)) continue;
    for (const groundClass of GROUND_EMBELLISHMENT_CLASSES) {
      const asset = entry.assets.get(groundClass);
      if (!asset) continue;
      const tier = nearTier(asset);
      servingCells.push({ cellId: cell.cellId, groundClass, bounds: cell.bounds, maxDistanceMeters: tier.maxDistanceMeters, order: cell.order });
    }
  }

  const cache = new GroundArtifactCache<LoadedGroundEmbellishmentArtifact>(GROUND_EMBELLISHMENT_BUDGETS.maxCachedBytes);
  const gate = new GroundRequestGate(GROUND_EMBELLISHMENT_BUDGETS.maxConcurrentRequests);
  const inFlight = new Map<string, Promise<LoadedGroundEmbellishmentArtifact>>();

  const loadCellClass = async (
    cellId: string,
    groundClass: GroundEmbellishmentClass,
    requestSignal?: AbortSignal,
  ): Promise<LoadedGroundEmbellishmentArtifact> => {
    const key = groundCacheKey(cellId, groundClass);
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const entry = cellIndex.get(cellId);
    const asset = entry?.assets.get(groundClass);
    if (!entry || !asset) throw new Error(`Ground embellishment release ships no ${groundClass} artifact for cell ${cellId}.`);
    // Serving stays inside the canary even if a caller asks outside it, so a
    // stale key from a previous wave set cannot quietly widen the scope.
    if (!isGroundEmbellishmentCanaryCell(cellId, canaryTileRows)) {
      throw new Error(`Ground embellishment cell ${cellId} is outside the canary wave scope and is not served.`);
    }
    const tier = nearTier(asset);
    if (!isSafeReleaseArtifactReference(tier.artifactRef)) throw new Error(`Ground embellishment artifact reference ${tier.artifactRef} is unsafe.`);
    const request = gate.run(async () => {
      const url = `${normalizedPath}${tier.artifactRef}`;
      const response = await fetcher(url, { signal: requestSignal ?? signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Ground embellishment artifact request failed (${response.status}) for ${tier.artifactRef}.`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > GROUND_EMBELLISHMENT_BUDGETS.maxArtifactBytes) {
        throw new Error(`Ground embellishment artifact ${tier.artifactRef} is ${bytes.byteLength} bytes, over the ${GROUND_EMBELLISHMENT_BUDGETS.maxArtifactBytes}-byte serving ceiling; it is refused rather than streamed.`);
      }
      const digest = await groundArtifactSha256(bytes);
      if (digest !== tier.checksumSha256) throw new Error(`Ground embellishment artifact checksum mismatch for ${tier.artifactRef}.`);
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      const artifact = validateGroundEmbellishmentCellArtifact(parsed, {
        releaseId: document.releaseId,
        cellId,
        groundClass,
        cellBounds: entry.cell.bounds,
        ownedPartIds: entry.ownedPartIds,
        knownFeatureIds,
      });
      const loaded: LoadedGroundEmbellishmentArtifact = { artifact, byteSize: bytes.byteLength, checksumSha256: digest };
      cache.set(key, loaded);
      return loaded;
    }).finally(() => { inFlight.delete(key); });
    inFlight.set(key, request);
    return request;
  };

  return {
    releaseId: document.releaseId,
    document,
    ledger,
    features,
    shippedClasses: GROUND_EMBELLISHMENT_CLASSES.filter((groundClass) => shipped.has(groundClass)),
    partitionTileLevel: tileLevel,
    coverage: ledger.coverage,
    canaryTileRows,
    servingCells,
    feature: (canonicalFeatureId) => featureById.get(canonicalFeatureId),
    cell: (cellId) => {
      const entry = cellIndex.get(cellId);
      return entry ? { cell: entry.cell, assets: entry.assets } : undefined;
    },
    loadCellClass,
    cached: (cellId, groundClass) => cache.get(groundCacheKey(cellId, groundClass)),
    retain: (keep) => cache.retain(keep),
    residency: () => ({ entries: cache.size(), bytes: cache.bytes(), evictions: cache.evictionCount() }),
  };
}

/**
 * The finite near tier an embellishment asset is served from.
 *
 * `maxDistanceMeters` is read here and nowhere else, so the activation ring is
 * always the release's declared number. An asset with no finite near tier is
 * unservable rather than served at some default: the T009 tier contract already
 * requires one, and inventing a fallback would hide a release defect.
 */
function nearTier(asset: GroundAssetEntry): { artifactRef: string; checksumSha256: string; maxDistanceMeters: number } {
  const tier = asset.tiers.find((candidate) => candidate.kind === "near-3d"
    && typeof candidate.maxDistanceMeters === "number"
    && Number.isFinite(candidate.maxDistanceMeters)
    && candidate.maxDistanceMeters > 0);
  if (!tier) throw new Error(`Ground embellishment asset ${asset.assetId} declares no finite near-3d tier.`);
  return { artifactRef: tier.artifactRef, checksumSha256: tier.checksumSha256, maxDistanceMeters: tier.maxDistanceMeters as number };
}

/**
 * An embellishment failure names itself and says what it did NOT take with it.
 *
 * The flat base is a different release behind a different loader, so this
 * message can promise the base is untouched without checking anything: there is
 * no code path from here to it.
 */
export function groundEmbellishmentFailureMessage(error: unknown): string {
  const prefix = error instanceof Error ? error.message : "The near-tier curb embellishment failed closed.";
  return `${prefix} Near-tier curbs were disabled; the cartographic ground base was left unchanged.`;
}
