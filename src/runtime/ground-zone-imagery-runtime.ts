/**
 * Runtime loader for the zone orthoimagery release (Task T013).
 *
 * A THIRD sibling in the ground family, next to `./ground-release-runtime.ts`
 * (flat cartographic base, T007) and `./ground-embellishment-runtime.ts`
 * (near-tier curbs, T010). It is a separate module for the same architectural
 * reason the curb loader is: the flat loader's asset loop refuses anything that
 * is not a base class shipping exactly one unbounded flat tier, and that guard
 * is left BYTE-IDENTICAL here. Imagery is not a tier of that contract at all —
 * it is a drape keyed by the same (cell, class) pair — so it gets its own
 * loader rather than a widened one.
 *
 * ## The fail-closed direction, which is the whole point
 *
 * Nothing in this module can reach the flat base. It never touches the base
 * release's cache, its primitives, or its state; it only READS the loaded base
 * to pin compatibility. Three failure grades, all pointing away from the
 * polygons:
 *
 * 1. **Document or pin failure** — the release document is malformed, or its
 *    mirrored assets are not the base release's assets verbatim. The whole
 *    imagery layer is refused; every zone keeps its flat colour fill.
 * 2. **Index checksum failure** — `zone-imagery.json` does not hash to the
 *    `zoneImagery.checksumSha256` the release document pins. Same outcome: the
 *    ENTIRE layer drops, because an index nobody can verify cannot be trusted
 *    to say which bytes belong to which zone.
 * 3. **Per-texture checksum failure** — one JPEG's bytes do not match the
 *    digest the verified index declares. That ONE drape is refused and named;
 *    every other drape, and every polygon, is untouched.
 *
 * ## Why the assets array is mirrored, and what mirroring buys
 *
 * The release ships the base release's park, plaza and water assets verbatim
 * (162 of the base's 352) and no artifact of its own for them. That is a
 * compatibility pin, not redundancy: a texture is registered against a specific
 * polygon geometry, so if the base release is ever regenerated the mirrored
 * `contentSha256` values stop matching and this loader refuses the whole layer
 * rather than draping 2024 imagery over geometry it was never registered
 * against. `assertZoneImageryCompatibility` is that check, and it is run before
 * a single texture byte is requested.
 *
 * ## Budgets are borrowed, and the accounting is shared with the flat pass
 *
 * `maxCachedBytes` is `GROUND_RUNTIME_BUDGETS.maxCachedBytes` — the same
 * borrowed `CITYWIDE_BUDGETS.maxLoadedBytes` the flat ground already lives
 * under — and `maxTextureBytes` is `CITYWIDE_BUDGETS.geometryShardBytes`, the
 * per-artifact ceiling T010 established for this family. The cache is a
 * separate object with the same ceiling rather than one shared pool: a texture
 * and a polygon artifact are evicted for different reasons and a shared pool
 * would let a large drape evict the geometry it is draping. Both resident
 * numbers are reported so the shared ceiling is visible rather than implied,
 * and `retain` is driven from the flat pass's own visible-key set at the same
 * call site, so the two caches always agree about what is on screen.
 */

import { isGroundClass, type GroundClass } from "../domain/ground.ts";
import { CITYWIDE_BUDGETS } from "../release/citywide-release.ts";
import type { GroundAssetEntry, GroundBounds } from "../release/ground-release.ts";
import {
  GROUND_RUNTIME_BUDGETS,
  GroundArtifactCache,
  GroundRequestGate,
  groundArtifactSha256,
  groundCacheKey,
  type GroundFetcher,
  type LoadedGroundRelease,
} from "./ground-release-runtime.ts";
import { isSafeReleaseArtifactReference } from "./path-security.ts";

export const MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID = "manhattan-ground-zone-imagery-20260826";
export const ZONE_IMAGERY_INDEX_SCHEMA_VERSION = "manhattan-zone-imagery-index-1";

/**
 * The three classes this release textures, in the flat pass's own draw order.
 *
 * Roadbed and sidewalk are deliberately absent: they are the classes the near
 * tier already embellishes with 3D curbs, and the imagery build refused them.
 * Nothing here may widen that set — an index entry naming any other class fails
 * the whole layer closed.
 */
export const ZONE_IMAGERY_CLASSES: readonly GroundClass[] = ["water", "park", "plaza"];

export function isZoneImageryClass(value: unknown): value is GroundClass {
  return typeof value === "string" && (ZONE_IMAGERY_CLASSES as readonly string[]).includes(value);
}

/** Borrowed ceilings; see the module header for why each number is the number it is. */
export const ZONE_IMAGERY_BUDGETS = {
  maxCachedBytes: GROUND_RUNTIME_BUDGETS.maxCachedBytes,
  maxTextureBytes: CITYWIDE_BUDGETS.geometryShardBytes,
  maxConcurrentRequests: GROUND_RUNTIME_BUDGETS.maxConcurrentRequests,
} as const;

export interface ZoneImageryEntry {
  /** `<cellId>/<class>`, the same residency key the flat pass uses. */
  zoneRef: string;
  cellId: string;
  class: GroundClass;
  artifactRef: string;
  checksumSha256: string;
  byteSize: number;
  /** The ownership cell's full WGS84 rectangle; the texture covers exactly this. */
  bounds: GroundBounds;
  pixelWidth: number;
  pixelHeight: number;
  coveredPixelFraction: number;
}

export interface ZoneImageryRefusal {
  zoneRef: string;
  cellId: string;
  class: GroundClass;
  reason: string;
}

/** A verified texture plus the image source the renderer may hand to Cesium. */
export interface LoadedZoneTexture {
  key: string;
  entry: ZoneImageryEntry;
  byteSize: number;
  checksumSha256: string;
  /** Blob or data URL over the VERIFIED bytes. Never a remote address. */
  imageSource: string;
  release(): void;
}

export interface ZoneImageryProvenance {
  attribution: string;
  disclaimer: string;
  termsUrl: string;
  sourceEpoch: string;
  localOnly: boolean;
  runtimeExternalNetwork: boolean;
}

export interface LoadedGroundZoneImageryRelease {
  releaseId: string;
  baseReleaseId: string;
  captureYear: number;
  attribution: string;
  provenance: ZoneImageryProvenance;
  generatedAt: string;
  targetGroundSampleDistanceMeters: number;
  /** The digest the release document pinned and the loaded index actually hashed to. */
  indexChecksumSha256: string;
  /** Textures the index ships, after validation. */
  entryCount: number;
  /** Zones the BUILD refused, with the sentence it refused them with. */
  refusals: readonly ZoneImageryRefusal[];
  entry(cellId: string, groundClass: GroundClass): ZoneImageryEntry | undefined;
  hasTexture(cellId: string, groundClass: GroundClass): boolean;
  refusal(cellId: string, groundClass: GroundClass): ZoneImageryRefusal | undefined;
  loadTexture(cellId: string, groundClass: GroundClass, signal?: AbortSignal): Promise<LoadedZoneTexture>;
  cachedTexture(cellId: string, groundClass: GroundClass): LoadedZoneTexture | undefined;
  retain(keep: ReadonlySet<string>): number;
  residency(): { entries: number; bytes: number; evictions: number };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hexDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeBasePath(basePath: string): string {
  if (!basePath.startsWith(`/data/${MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID}/`) || !basePath.endsWith("/")) {
    throw new Error("Zone imagery base path is not the approved local release root.");
  }
  return basePath;
}

// ---------------------------------------------------------------------------
// Image source
// ---------------------------------------------------------------------------

/**
 * Turns verified bytes into something Cesium's `Image` material can sample.
 *
 * Injectable so a test can observe exactly which bytes reached the renderer,
 * and so no environment detail decides whether a drape is admitted. The default
 * prefers an object URL and falls back to a data URL where object URLs are not
 * available; both address the SAME verified buffer, and neither is a network
 * address, which is what keeps `runtimeExternalNetwork: false` true at runtime.
 */
export type ZoneTextureImageSourceFactory = (bytes: ArrayBuffer) => { imageSource: string; release: () => void };

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    out += base64Alphabet[first >> 2];
    out += base64Alphabet[((first & 0b11) << 4) | ((second ?? 0) >> 4)];
    out += second === undefined ? "=" : base64Alphabet[((second & 0b1111) << 2) | ((third ?? 0) >> 6)];
    out += third === undefined ? "=" : base64Alphabet[third & 0b111111];
  }
  return out;
}

export const defaultZoneTextureImageSourceFactory: ZoneTextureImageSourceFactory = (bytes) => {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof Blob === "function") {
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    return { imageSource: objectUrl, release: () => { URL.revokeObjectURL(objectUrl); } };
  }
  return { imageSource: `data:image/jpeg;base64,${base64(new Uint8Array(bytes))}`, release: () => {} };
};

// ---------------------------------------------------------------------------
// Document and index validation
// ---------------------------------------------------------------------------

export interface ZoneImageryReleasePin {
  artifactRef: string;
  checksumSha256: string;
  captureYear: number;
  attribution: string;
  zoneRef: string;
}

/**
 * The compatibility pin, run before any texture byte is requested.
 *
 * Every asset the imagery release mirrors must be the base release's asset
 * VERBATIM — same asset id, cell, class, content digest and tier list — and the
 * mirrored set must be exactly the base's zone-class assets: no absentee, no
 * stranger. A regenerated base release therefore drops the whole imagery layer
 * instead of draping 2024 pixels over polygons the build never saw.
 */
export function assertZoneImageryCompatibility(assets: readonly GroundAssetEntry[], base: LoadedGroundRelease): void {
  const expected = base.document.assets.filter((asset) => isZoneImageryClass(asset.class));
  if (assets.length !== expected.length) {
    throw new Error(`Zone imagery mirrors ${assets.length} base assets; release ${base.releaseId} ships ${expected.length} zone-class assets.`);
  }
  const mirrored = new Map(assets.map((asset) => [asset.assetId, asset]));
  for (const asset of expected) {
    const candidate = mirrored.get(asset.assetId);
    if (!candidate) throw new Error(`Zone imagery does not mirror base asset ${asset.assetId}.`);
    if (candidate.cellId !== asset.cellId || candidate.class !== asset.class || candidate.contentSha256 !== asset.contentSha256) {
      throw new Error(`Zone imagery mirrors base asset ${asset.assetId} with different identity or content; the base release was regenerated.`);
    }
    if (candidate.tiers.length !== asset.tiers.length) throw new Error(`Zone imagery mirrors base asset ${asset.assetId} with a different tier list.`);
    for (const [index, tier] of asset.tiers.entries()) {
      const candidateTier = candidate.tiers[index]!;
      if (candidateTier.tierId !== tier.tierId || candidateTier.kind !== tier.kind
        || candidateTier.artifactRef !== tier.artifactRef || candidateTier.checksumSha256 !== tier.checksumSha256
        || candidateTier.maxDistanceMeters !== tier.maxDistanceMeters) {
        throw new Error(`Zone imagery mirrors base tier ${tier.tierId} with different bytes; the base release was regenerated.`);
      }
    }
  }
}

/** Structural validation of the imagery release document, plus the pin it carries. */
export function validateZoneImageryReleaseDocument(value: unknown, base: LoadedGroundRelease): ZoneImageryReleasePin & { provenance: ZoneImageryProvenance; generatedAt: string } {
  if (!record(value)) throw new Error("Zone imagery release document is not an object.");
  if (value.releaseId !== MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID) throw new Error(`Zone imagery release id mismatch: ${String(value.releaseId)}.`);
  if (value.cityId !== base.ledger.cityId) throw new Error("Zone imagery release names a different city than the ground base.");
  if (value.partitionSchemeId !== base.ledger.partitionSchemeId) throw new Error("Zone imagery release does not use the ground base's partition scheme.");
  if (value.ownershipLedgerId !== base.ledger.ledgerId) throw new Error("Zone imagery release pins a different ownership ledger than the loaded ground base.");
  if (value.immutable !== true) throw new Error("Zone imagery release is not declared immutable.");
  if (!Array.isArray(value.assets)) throw new Error("Zone imagery release declares no mirrored assets.");
  assertZoneImageryCompatibility(value.assets as readonly GroundAssetEntry[], base);

  const provenanceValue = value.provenance;
  if (!record(provenanceValue)
    || !nonEmptyString(provenanceValue.attribution)
    || !nonEmptyString(provenanceValue.disclaimer)
    || !nonEmptyString(provenanceValue.termsUrl)
    || !nonEmptyString(provenanceValue.sourceEpoch)) {
    throw new Error("Zone imagery release does not carry complete provenance.");
  }
  // A local release that admitted a runtime provider request would break the
  // local-only invariant the whole ground family is built on, so it is refused
  // here rather than discovered in a network tab.
  if (provenanceValue.localOnly !== true || provenanceValue.runtimeExternalNetwork !== false) {
    throw new Error("Zone imagery release does not declare itself local-only with no runtime external network.");
  }
  const pin = value.zoneImagery;
  if (!record(pin)) throw new Error("Zone imagery release declares no imagery index.");
  if (pin.artifactRef !== "zone-imagery.json") throw new Error(`Zone imagery index reference ${String(pin.artifactRef)} is not the approved index.`);
  if (!hexDigest(pin.checksumSha256)) throw new Error("Zone imagery index declares no SHA-256 digest.");
  if (!positiveInteger(pin.captureYear)) throw new Error("Zone imagery index declares no capture year.");
  if (!nonEmptyString(pin.attribution)) throw new Error("Zone imagery index declares no attribution.");
  if (!nonEmptyString(pin.zoneRef)) throw new Error("Zone imagery index declares no zone reference.");
  if (!nonEmptyString(value.generatedAt)) throw new Error("Zone imagery release declares no generation timestamp.");
  return {
    artifactRef: pin.artifactRef,
    checksumSha256: pin.checksumSha256,
    captureYear: pin.captureYear,
    attribution: pin.attribution,
    zoneRef: pin.zoneRef,
    generatedAt: value.generatedAt,
    provenance: {
      attribution: provenanceValue.attribution,
      disclaimer: provenanceValue.disclaimer,
      termsUrl: provenanceValue.termsUrl,
      sourceEpoch: provenanceValue.sourceEpoch,
      localOnly: true,
      runtimeExternalNetwork: false,
    },
  };
}

export interface ValidatedZoneImageryIndex {
  captureYear: number;
  attribution: string;
  generatedAt: string;
  targetGroundSampleDistanceMeters: number;
  entries: ZoneImageryEntry[];
  refusals: ZoneImageryRefusal[];
}

/**
 * Structural AND relational validation of the verified index.
 *
 * The relational half is what a checksum cannot do. A texture is only drawable
 * if the base release actually ships a polygon for that (cell, class) and if
 * the texture's declared bounds are that cell's own rectangle to the double —
 * anything else would drape pixels across ground the cell does not own, which
 * is precisely the misregistration the T012 contract bounds at about one pixel.
 */
export function validateZoneImageryIndex(value: unknown, base: LoadedGroundRelease, pin: ZoneImageryReleasePin): ValidatedZoneImageryIndex {
  if (!record(value)) throw new Error("Zone imagery index is not an object.");
  if (value.schemaVersion !== ZONE_IMAGERY_INDEX_SCHEMA_VERSION) throw new Error(`Zone imagery index declares an unsupported schema ${String(value.schemaVersion)}.`);
  if (value.releaseId !== MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID) throw new Error(`Zone imagery index names release ${String(value.releaseId)}.`);
  if (value.baseReleaseId !== base.releaseId) throw new Error(`Zone imagery index was built against ${String(value.baseReleaseId)}, not the loaded base ${base.releaseId}.`);
  if (value.partitionSchemeId !== base.ledger.partitionSchemeId) throw new Error("Zone imagery index does not use the ground base's partition scheme.");
  if (value.captureYear !== pin.captureYear) throw new Error("Zone imagery index and release document disagree about the capture year.");
  if (value.attribution !== pin.attribution) throw new Error("Zone imagery index and release document disagree about attribution.");
  if (!nonEmptyString(value.generatedAt)) throw new Error("Zone imagery index declares no generation timestamp.");
  const gsd = value.targetGroundSampleDistanceMeters;
  if (typeof gsd !== "number" || !Number.isFinite(gsd) || gsd <= 0) throw new Error("Zone imagery index declares no ground sample distance.");
  if (!Array.isArray(value.entries) || value.entries.length === 0) throw new Error("Zone imagery index carries no textures.");
  if (!Array.isArray(value.refusals)) throw new Error("Zone imagery index carries no refusal list.");

  const entries: ZoneImageryEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of value.entries) {
    if (!record(candidate)) throw new Error("Zone imagery index carries a non-object entry.");
    const cellId = candidate.cellId;
    const groundClass = candidate.class;
    if (typeof cellId !== "string" || !isGroundClass(groundClass)) throw new Error("Zone imagery index carries an entry without a cell and class.");
    if (!isZoneImageryClass(groundClass)) throw new Error(`Zone imagery index carries class ${groundClass}, which this release does not texture.`);
    const key = groundCacheKey(cellId, groundClass);
    if (seen.has(key)) throw new Error(`Zone imagery index carries ${key} twice.`);
    seen.add(key);
    if (candidate.zoneRef !== key) throw new Error(`Zone imagery entry ${key} declares zone reference ${String(candidate.zoneRef)}.`);
    const cell = base.cell(cellId);
    if (!cell) throw new Error(`Zone imagery entry ${key} names a cell outside the ground ownership ledger.`);
    if (!base.hasArtifact(cellId, groundClass)) throw new Error(`Zone imagery entry ${key} textures a zone the ground base does not ship.`);
    const bounds = candidate.bounds;
    if (!record(bounds)
      || bounds.west !== cell.cell.bounds.west
      || bounds.south !== cell.cell.bounds.south
      || bounds.east !== cell.cell.bounds.east
      || bounds.north !== cell.cell.bounds.north) {
      throw new Error(`Zone imagery entry ${key} declares bounds that are not its ownership cell's rectangle.`);
    }
    if (!hexDigest(candidate.checksumSha256)) throw new Error(`Zone imagery entry ${key} declares no SHA-256 digest.`);
    if (!positiveInteger(candidate.byteSize)) throw new Error(`Zone imagery entry ${key} declares no byte size.`);
    if (candidate.byteSize > ZONE_IMAGERY_BUDGETS.maxTextureBytes) {
      throw new Error(`Zone imagery entry ${key} declares ${candidate.byteSize} bytes, over the ${ZONE_IMAGERY_BUDGETS.maxTextureBytes}-byte per-texture ceiling.`);
    }
    if (!positiveInteger(candidate.pixelWidth) || !positiveInteger(candidate.pixelHeight)) throw new Error(`Zone imagery entry ${key} declares no pixel extent.`);
    const covered = candidate.coveredPixelFraction;
    if (typeof covered !== "number" || !Number.isFinite(covered) || covered <= 0 || covered > 1) throw new Error(`Zone imagery entry ${key} declares no covered pixel fraction.`);
    if (typeof candidate.artifactRef !== "string" || !isSafeReleaseArtifactReference(candidate.artifactRef)) {
      throw new Error(`Zone imagery entry ${key} declares an unsafe artifact reference.`);
    }
    if (candidate.artifactRef !== `artifacts/${cellId}/${groundClass}.jpg`) {
      throw new Error(`Zone imagery entry ${key} points at ${candidate.artifactRef}, which is not its own texture path.`);
    }
    entries.push({
      zoneRef: key,
      cellId,
      class: groundClass,
      artifactRef: candidate.artifactRef,
      checksumSha256: candidate.checksumSha256,
      byteSize: candidate.byteSize,
      bounds: { west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north },
      pixelWidth: candidate.pixelWidth,
      pixelHeight: candidate.pixelHeight,
      coveredPixelFraction: covered,
    });
  }

  const refusals: ZoneImageryRefusal[] = [];
  for (const candidate of value.refusals) {
    if (!record(candidate)) throw new Error("Zone imagery index carries a non-object refusal.");
    const cellId = candidate.cellId;
    const groundClass = candidate.class;
    if (typeof cellId !== "string" || !isZoneImageryClass(groundClass) || !nonEmptyString(candidate.reason)) {
      throw new Error("Zone imagery index carries a refusal without a zone and a reason.");
    }
    const key = groundCacheKey(cellId, groundClass);
    if (seen.has(key)) throw new Error(`Zone imagery index both textures and refuses ${key}.`);
    refusals.push({ zoneRef: key, cellId, class: groundClass, reason: candidate.reason });
  }

  return {
    captureYear: pin.captureYear,
    attribution: pin.attribution,
    generatedAt: value.generatedAt,
    targetGroundSampleDistanceMeters: gsd,
    entries,
    refusals,
  };
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadGroundZoneImageryRelease(
  base: LoadedGroundRelease,
  basePath = `/data/${MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID}/`,
  signal?: AbortSignal,
  fetcher: GroundFetcher = globalThis.fetch.bind(globalThis),
  imageSourceFactory: ZoneTextureImageSourceFactory = defaultZoneTextureImageSourceFactory,
): Promise<LoadedGroundZoneImageryRelease> {
  const normalizedPath = normalizeBasePath(basePath);

  const documentResponse = await fetcher(`${normalizedPath}release.json`, { signal, cache: "no-store" });
  if (!documentResponse.ok) throw new Error(`Zone imagery release request failed (${documentResponse.status}).`);
  const pin = validateZoneImageryReleaseDocument(await documentResponse.json(), base);

  // THE INDEX GATE. The index is hashed as BYTES before it is parsed as JSON:
  // a tampered index never becomes an object this process reasons about, and a
  // mismatch removes the entire layer rather than a suspicious subset of it.
  const indexResponse = await fetcher(`${normalizedPath}${pin.artifactRef}`, { signal, cache: "no-store" });
  if (!indexResponse.ok) throw new Error(`Zone imagery index request failed (${indexResponse.status}).`);
  const indexBytes = await indexResponse.arrayBuffer();
  const indexDigest = await groundArtifactSha256(indexBytes);
  if (indexDigest !== pin.checksumSha256) {
    throw new Error(`Zone imagery index checksum mismatch (${indexDigest} declared ${pin.checksumSha256}); the whole imagery layer was refused.`);
  }
  const index = validateZoneImageryIndex(JSON.parse(new TextDecoder().decode(indexBytes)), base, pin);

  const entryByKey = new Map(index.entries.map((entry) => [entry.zoneRef, entry]));
  const refusalByKey = new Map(index.refusals.map((refusal) => [refusal.zoneRef, refusal]));
  const cache = new GroundArtifactCache<LoadedZoneTexture>(
    ZONE_IMAGERY_BUDGETS.maxCachedBytes,
    // The image source is a handle over the verified bytes, so eviction has to
    // release it or a long pan leaks one object URL per drape it left behind.
    (_key, texture) => { texture.release(); },
  );
  const gate = new GroundRequestGate(ZONE_IMAGERY_BUDGETS.maxConcurrentRequests);
  const inFlight = new Map<string, Promise<LoadedZoneTexture>>();

  const loadTexture = async (cellId: string, groundClass: GroundClass, requestSignal?: AbortSignal): Promise<LoadedZoneTexture> => {
    const key = groundCacheKey(cellId, groundClass);
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending;
    const entry = entryByKey.get(key);
    if (!entry) throw new Error(`Zone imagery ships no texture for ${key}.`);
    const request = gate.run(async () => {
      const response = await fetcher(`${normalizedPath}${entry.artifactRef}`, { signal: requestSignal ?? signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Zone imagery texture request failed (${response.status}) for ${entry.artifactRef}.`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== entry.byteSize) {
        throw new Error(`Zone imagery texture ${key} is ${bytes.byteLength} bytes; the index declares ${entry.byteSize}.`);
      }
      const digest = await groundArtifactSha256(bytes);
      if (digest !== entry.checksumSha256) throw new Error(`Zone imagery texture checksum mismatch for ${entry.artifactRef}; this drape was refused.`);
      const image = imageSourceFactory(bytes);
      const loaded: LoadedZoneTexture = {
        key,
        entry,
        byteSize: bytes.byteLength,
        checksumSha256: digest,
        imageSource: image.imageSource,
        release: image.release,
      };
      cache.set(key, loaded);
      return loaded;
    }).finally(() => { inFlight.delete(key); });
    inFlight.set(key, request);
    return request;
  };

  return {
    releaseId: MANHATTAN_GROUND_ZONE_IMAGERY_RELEASE_ID,
    baseReleaseId: base.releaseId,
    captureYear: index.captureYear,
    attribution: index.attribution,
    provenance: pin.provenance,
    generatedAt: pin.generatedAt,
    targetGroundSampleDistanceMeters: index.targetGroundSampleDistanceMeters,
    indexChecksumSha256: indexDigest,
    entryCount: index.entries.length,
    refusals: index.refusals,
    entry: (cellId, groundClass) => entryByKey.get(groundCacheKey(cellId, groundClass)),
    hasTexture: (cellId, groundClass) => entryByKey.has(groundCacheKey(cellId, groundClass)),
    refusal: (cellId, groundClass) => refusalByKey.get(groundCacheKey(cellId, groundClass)),
    loadTexture,
    cachedTexture: (cellId, groundClass) => cache.get(groundCacheKey(cellId, groundClass)),
    retain: (keep) => cache.retain(keep),
    residency: () => ({ entries: cache.size(), bytes: cache.bytes(), evictions: cache.evictionCount() }),
  };
}

/** Never imply the polygons went away when only the drape did. */
export function groundZoneImageryFailureMessage(error: unknown): string {
  const prefix = error instanceof Error ? error.message : "The zone orthoimagery layer failed closed.";
  return `${prefix} Zone orthoimagery was disabled; parks, plazas and water still draw as verified flat polygons.`;
}
