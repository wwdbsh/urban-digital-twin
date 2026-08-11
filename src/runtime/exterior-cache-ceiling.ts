/**
 * The BYTE ceiling of the shared exterior cache, re-derived at the raised entry
 * cap — ADR 0034 admissible response 1, second half.
 *
 * ADR 0034 permitted raising `EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries` only
 * together with a re-measurement of the byte ceiling against the raised cap, and
 * ADR 0035 precondition (a) repeated it in stronger terms: "not near binding at
 * 255 entries" is not a measurement at a larger cap, and wave `w03`'s assets are
 * heavier per asset than Lower-Manhattan's. This module is that re-derivation,
 * written as CODE rather than as prose so it is recomputed from the committed
 * inventories on every test run instead of being remembered from a document.
 *
 * ## Three different bounds, because only one of them is reachable
 *
 * "512 entries times a per-asset byte size" is not one number, and collapsing it
 * to one would be the estimate this task was told not to produce. The three are
 * computed and named separately:
 *
 * - **`compositionByteCeilingBytes`** — the sum of every promoted wave's own
 *   shipped asset bytes. This is the REACHABLE worst case for a promoted
 *   session and the only one of the three that is a fact rather than a model: a
 *   cache cannot hold more of a fixed set of releases than all of it, and when
 *   the whole promoted set fits inside the entry cap, holding all of it is
 *   exactly what a saturated session does. Every byte size comes from a
 *   committed `payload-inventory.json` (or, for Block 835 V3, from its committed
 *   payload tree), so this is measured, not modelled.
 *
 * - **`meanFillByteCeilingBytes`** — `maxCacheEntries` times the LARGEST per-wave
 *   MEAN asset size observed. This models a hypothetical future in which the cap
 *   is filled entirely with assets of the heaviest wave's average weight. It is
 *   the figure that answers "what does the raised cap cost if we keep promoting
 *   waves like the ones we have", and it is a model, labelled as one.
 *
 * - **`saturationFillByteCeilingBytes`** — `maxCacheEntries` times the single
 *   LARGEST asset observed anywhere. This is stated because it is the honest
 *   answer to "does the entry cap alone bound bytes", and the answer is NO: the
 *   heaviest asset in the promoted set is megabytes, and 512 of it would blow
 *   through 256 MiB. It is not reachable — no wave ships 512 copies of its
 *   largest building — but it is why `maxCachedBytes` was left at 256 MiB as a
 *   live backstop rather than being raised alongside the entry cap.
 *
 * `bindingConstraint` reports which cap a promoted composition meets first. It
 * is derived from the reachable bound, and the modelled bounds are reported
 * beside it rather than folded into it.
 *
 * ## What this module deliberately does NOT claim
 *
 * It says nothing about decoded GPU memory, which is not observable from the
 * loader and is computed — never measured — in the acceptance evidence. It says
 * nothing about how many entries a given camera path actually touches: that is a
 * runtime measurement, and the acceptance run reports it separately as derived
 * residency. This is the RELEASE-TIME bound, and the release-time bound is what
 * an immutable release has to be sized against.
 */

/** The one shape this module needs out of a committed `payload-inventory.json`. */
export interface ExteriorCacheInventoryFile {
  readonly path: string;
  readonly byteSize: number;
}

/** Every artifact the exterior loader caches as one LRU entry: a shipped GLB. */
const CACHED_ASSET_PATH = /^public\/assets\/.*\.glb$/u;

function fail(message: string): never {
  throw new Error(`Exterior cache ceiling: ${message}`);
}

/**
 * The cached-asset byte sizes of a committed inventory, in ascending order.
 *
 * One GLB is one LRU entry — the cache is keyed per artifact, so a resident
 * coarse level occupies an entry exactly as a fine one does — which is what
 * makes an entry count and an asset count the same number here.
 */
export function exteriorCacheAssetByteSizes(files: readonly ExteriorCacheInventoryFile[]): number[] {
  return files
    .filter((file) => CACHED_ASSET_PATH.test(file.path))
    .map((file) => file.byteSize)
    .sort((left, right) => left - right);
}

export interface ExteriorCacheWaveByteProfile {
  readonly releaseId: string;
  /** Cache entries this wave occupies: one per shipped GLB. */
  readonly assetEntries: number;
  readonly totalByteSize: number;
  readonly minByteSize: number;
  /** Upper of the two middle values for an even count. */
  readonly medianByteSize: number;
  /** Rounded to whole bytes; a fractional byte is not a measurement. */
  readonly meanByteSize: number;
  readonly maxByteSize: number;
}

export function exteriorCacheWaveByteProfile(input: {
  releaseId: string;
  assetByteSizes: readonly number[];
}): ExteriorCacheWaveByteProfile {
  const sizes = [...input.assetByteSizes].sort((left, right) => left - right);
  if (sizes.length === 0) fail(`release ${input.releaseId} declares no cached assets; its occupancy cannot be profiled.`);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return {
    releaseId: input.releaseId,
    assetEntries: sizes.length,
    totalByteSize: total,
    minByteSize: sizes[0]!,
    medianByteSize: sizes[Math.floor(sizes.length / 2)]!,
    meanByteSize: Math.round(total / sizes.length),
    maxByteSize: sizes[sizes.length - 1]!,
  };
}

export interface ExteriorCacheByteCeiling {
  readonly maxCacheEntries: number;
  readonly maxCachedBytes: number;
  readonly waves: readonly ExteriorCacheWaveByteProfile[];
  /** Entries the whole promoted composition occupies at release time. */
  readonly residentAssetEntries: number;
  readonly entryHeadroom: number;
  /** REACHABLE: every promoted byte resident at once. */
  readonly compositionByteCeilingBytes: number;
  readonly compositionByteCeilingRatio: number;
  /** MODELLED: the cap filled with assets of the heaviest wave's mean weight. */
  readonly worstMeanReleaseId: string;
  readonly worstMeanByteSize: number;
  readonly meanFillByteCeilingBytes: number;
  /** MODELLED and UNREACHABLE: the cap filled with copies of the largest asset. */
  readonly largestAssetReleaseId: string;
  readonly largestAssetByteSize: number;
  readonly saturationFillByteCeilingBytes: number;
  /** Which cap a promoted composition meets first, by the reachable bound. */
  readonly bindingConstraint: "entries" | "bytes";
  /** Whether the reachable bound stays inside the unchanged byte cap. */
  readonly bytesNonBindingForComposition: boolean;
  /** Whether the whole promoted composition fits the entry cap at all. */
  readonly fitsEntryCap: boolean;
}

/**
 * The re-derivation. Every input is a measured per-wave profile; nothing here is
 * a constant that could drift from the bytes it describes.
 *
 * `bindingConstraint` is deliberately computed from the two REACHABLE ratios —
 * entries used over the entry cap, bytes reachable over the byte cap — because
 * declaring bytes "non-binding" on the strength of an unreachable model would be
 * the same mistake in the other direction.
 */
export function exteriorCacheByteCeiling(input: {
  waves: readonly ExteriorCacheWaveByteProfile[];
  maxCacheEntries: number;
  maxCachedBytes: number;
}): ExteriorCacheByteCeiling {
  if (input.waves.length === 0) fail("no wave profiles were supplied; a ceiling over nothing is not a ceiling.");
  if (input.maxCacheEntries <= 0 || input.maxCachedBytes <= 0) fail("the cache caps must both be positive.");
  const residentAssetEntries = input.waves.reduce((sum, wave) => sum + wave.assetEntries, 0);
  const compositionByteCeilingBytes = input.waves.reduce((sum, wave) => sum + wave.totalByteSize, 0);
  const worstMean = input.waves.reduce((worst, wave) => (wave.meanByteSize > worst.meanByteSize ? wave : worst));
  const largest = input.waves.reduce((worst, wave) => (wave.maxByteSize > worst.maxByteSize ? wave : worst));
  const entryRatio = residentAssetEntries / input.maxCacheEntries;
  const byteRatio = compositionByteCeilingBytes / input.maxCachedBytes;
  return {
    maxCacheEntries: input.maxCacheEntries,
    maxCachedBytes: input.maxCachedBytes,
    waves: input.waves.map((wave) => ({ ...wave })),
    residentAssetEntries,
    entryHeadroom: input.maxCacheEntries - residentAssetEntries,
    compositionByteCeilingBytes,
    compositionByteCeilingRatio: byteRatio,
    worstMeanReleaseId: worstMean.releaseId,
    worstMeanByteSize: worstMean.meanByteSize,
    meanFillByteCeilingBytes: input.maxCacheEntries * worstMean.meanByteSize,
    largestAssetReleaseId: largest.releaseId,
    largestAssetByteSize: largest.maxByteSize,
    saturationFillByteCeilingBytes: input.maxCacheEntries * largest.maxByteSize,
    bindingConstraint: entryRatio >= byteRatio ? "entries" : "bytes",
    bytesNonBindingForComposition: compositionByteCeilingBytes <= input.maxCachedBytes,
    fitsEntryCap: residentAssetEntries <= input.maxCacheEntries,
  };
}

/**
 * The ADR 0030 eviction disclosure, carried in code beside the cap it is about.
 *
 * It is UNCHANGED in substance: eviction in the shared exterior LRU is
 * recency-only, there is no per-wave reservation, and nothing renders wrongly
 * when one wave evicts another because every re-fetch is re-verified against its
 * pin. What raising the entry cap changes is the BLAST RADIUS: more waves can be
 * co-resident, so more waves are exposed to each other's camera pressure, and
 * the cost of a silent re-fetch is still invisible in the metrics the runtime
 * publishes. Fixing it properly is per-wave residency policy, which stays
 * deferred against ADR 0024 rather than being improvised inside a promotion.
 */
export const EXTERIOR_CACHE_EVICTION_DISCLOSURE =
  "Eviction in the shared exterior LRU is RECENCY-ONLY, with no per-wave reservation and no per-wave residency floor; the cache also evicts on the byte cap, which is unchanged at 256 MiB. Raising maxCacheEntries from 256 to 512 does not alter that policy and does not repair it — it WIDENS its blast radius, because more promoted waves can now be co-resident and therefore more waves can evict each other's already-verified bytes under camera pressure. Nothing renders wrongly when that happens: every evicted artifact is re-fetched and re-verified against its pin before it reaches the scene. The cost is a silent re-fetch that the runtime's published metrics do not attribute to the wave that caused it. Per-wave residency policy remains deferred against ADR 0024." as const;
