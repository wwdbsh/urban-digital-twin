/**
 * ADR 0034 admissible response 1, executed and checked — and then OUTGROWN.
 *
 * The entry cap moved from 256 to 512 at T018. ADR 0034 permitted that only
 * together with a re-derivation of the BYTE ceiling at the raised cap, and
 * ADR 0035 precondition (a) required the re-derivation to read the promoted
 * waves' own committed inventories rather than a remembered number. This suite
 * was that re-derivation and it still is, for the curated composition.
 *
 * ## What the T005 serving promotion did to the question
 *
 * The module under test answers a RELEASE-TIME question: can the cache hold the
 * whole promoted composition at once? For a curated composition that question
 * had a yes, and the yes was the ceiling — a cache cannot hold more of a fixed
 * set of releases than all of it. The six `-s1` serving releases are 44,989
 * assets and 4.679 GB, and the answer is now an emphatic NO by two orders of
 * magnitude. That is not a regression and it is not a cap that needs raising:
 * no entry cap holds the island, none is meant to, and the bound that matters
 * becomes how much the SCHEDULER can make resident at once.
 *
 * So this suite keeps doing exactly what it did — deriving the composition
 * ceiling from committed inventories, never from a remembered number — and it
 * now says plainly that for the shipped composition the ceiling is not reachable
 * and not the binding constraint. `exterior-serving-residency.ts` computes the
 * bound that IS binding, and this file asserts the handover rather than leaving
 * a reader to notice that a green suite stopped describing the product.
 *
 * It is NEVER skipped. Every byte size it uses is committed to this repository:
 * the curated waves carry a `payload-inventory.json` under `data/` (Block 835 V3
 * carries a committed payload tree instead), and each serving release carries
 * its own committed `payload-inventory.json`. No untracked payload directory is
 * required, so the arithmetic is recomputed on a fresh clone and on CI rather
 * than only on the machine that emitted the wave.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXTERIOR_CACHE_EVICTION_DISCLOSURE,
  exteriorCacheAssetByteSizes,
  exteriorCacheByteCeiling,
  exteriorCacheWaveByteProfile,
  exteriorPromotedCacheProfiles,
  type ExteriorCacheWaveByteProfile,
} from "./exterior-cache-ceiling";
import { EXTERIOR_RUNTIME_BUDGETS } from "./exterior-cell-runtime";
import { BLOCK835_MEMBERSHIP_BUILDING_IDS, EXTERIOR_DEFAULT_ACTIVATIONS } from "./exterior-default-activation";

const MIB = 1024 * 1024;

/** Block 835 V3 ships BOTH canonical LODs per building; the others ship one. */
const BLOCK835_SHIPPED_LOD_COUNT = 2;
const BLOCK835_ASSETS_ROOT = "public/data/manhattan-exterior-cells-20260811-v3/public/assets";

/**
 * The entry cap the CURATED composition was sized against.
 *
 * A literal, because every statement below about what T018 and T020 and T022
 * measured is a statement about 512 and must stay one after the constant moved
 * to 1,024. A historical figure that silently followed a moving constant would
 * stop being a historical figure.
 */
const CURATED_ENTRY_CAP = 512;

function readJsonText(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

function inventoryProfile(releaseId: string, path: string): ExteriorCacheWaveByteProfile {
  const inventory = JSON.parse(readJsonText(path)) as { releaseId: string; files: { path: string; byteSize: number }[] };
  expect(inventory.releaseId).toBe(releaseId);
  return exteriorCacheWaveByteProfile({ releaseId, assetByteSizes: exteriorCacheAssetByteSizes(inventory.files) });
}

/**
 * Block 835 V3 has no `payload-inventory.json` — it predates that record — so
 * its profile is read from its COMMITTED payload tree. That is still committed
 * bytes rather than an untracked local build, which is what keeps this gate from
 * being skippable. The sizes are the lengths of the bytes themselves rather than
 * a stat, so what is measured is exactly what a browser would fetch.
 */
function block835Profile(): ExteriorCacheWaveByteProfile {
  const sizes = readdirSync(BLOCK835_ASSETS_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".glb"))
    .map((entry) => readFileSync(`${entry.parentPath}/${entry.name}`).byteLength);
  return exteriorCacheWaveByteProfile({ releaseId: "manhattan-exterior-cells-20260811-v3", assetByteSizes: sizes });
}

const block835 = block835Profile();
const midtown = inventoryProfile("manhattan-midtown-core-cells-20260811-v3", "data/midtown-core-20260811-v3/payload-inventory.json");
const lowerManhattan = inventoryProfile("manhattan-lower-manhattan-cells-20260812-p1", "data/lower-manhattan-20260812-p1/payload-inventory.json");
const southernRemainder = inventoryProfile("manhattan-southern-remainder-cells-20260812-p1", "data/southern-remainder-20260812-p1/payload-inventory.json");
const centralUpperManhattan = inventoryProfile("manhattan-central-upper-manhattan-cells-20260812-p1", "data/central-upper-manhattan-20260812-p1/payload-inventory.json");
const northernManhattan = inventoryProfile("manhattan-northern-manhattan-cells-20260812-p1", "data/northern-manhattan-20260812-p1/payload-inventory.json");

/** The six serving releases, read from their own committed inventories. */
const SERVING_RELEASE_IDS = [
  "manhattan-exterior-cells-20260811-v3-s1",
  "manhattan-midtown-core-cells-20260811-v3-s1",
  "manhattan-lower-manhattan-cells-20260812-s1",
  "manhattan-southern-remainder-cells-20260812-s1",
  "manhattan-central-upper-manhattan-cells-20260812-s1",
  "manhattan-northern-manhattan-cells-20260812-s1",
] as const;
const servingProfiles = SERVING_RELEASE_IDS.map((releaseId) => inventoryProfile(releaseId, `data/${releaseId}/payload-inventory.json`));

/**
 * Where each release's measured bytes come from, keyed by release id.
 *
 * This is a REGISTRY, not the composition. The composition is derived from
 * `EXTERIOR_DEFAULT_ACTIVATIONS` below, so promoting a wave fails here until its
 * bytes are registered rather than quietly producing a ceiling that omits it.
 *
 * THE GUARD HAS NOW FIRED THREE TIMES, and the third is the reason the serving
 * rows exist. It fired at T020 for `manhattan-central-upper-manhattan-cells-20260812-p1`
 * and at T022 for `manhattan-northern-manhattan-cells-20260812-p1`, both with the
 * "has no measured byte profile" message, before their rows existed. At T005 it
 * fired again for all six `-s1` releases at once, on the first run after the
 * promotion records changed — which is precisely the behaviour the derivation was
 * written for at T018 and precisely what a hand-listed composition would have
 * done silently, in this case understating the promoted composition by 4.6 GB.
 */
const BYTE_PROFILES = new Map<string, ExteriorCacheWaveByteProfile>([
  [block835.releaseId, block835],
  [midtown.releaseId, midtown],
  [lowerManhattan.releaseId, lowerManhattan],
  [southernRemainder.releaseId, southernRemainder],
  [centralUpperManhattan.releaseId, centralUpperManhattan],
  [northernManhattan.releaseId, northernManhattan],
  ...servingProfiles.map((profile) => [profile.releaseId, profile] as const),
]);

/** The composition this build actually promotes, in promotion-record order. */
const PROMOTED_PROFILES = exteriorPromotedCacheProfiles({ records: EXTERIOR_DEFAULT_ACTIVATIONS, profiles: BYTE_PROFILES });

/**
 * The composition this build promoted UNTIL the serving promotion, derived from
 * the promotion records rather than listed by hand.
 *
 * Each serving record carries the curated record it replaced as its
 * `predecessor`, so "the previous composition" is a property of the shipped
 * records and not a literal array someone has to keep in step. That is the same
 * derivation discipline the T018 review imposed, applied one level down.
 */
const CURATED_RECORDS = EXTERIOR_DEFAULT_ACTIVATIONS.map((record) => (record.enabled ? record.predecessor : record));
const CURATED_PROFILES = exteriorPromotedCacheProfiles({ records: CURATED_RECORDS, profiles: BYTE_PROFILES });

describe("the exterior entry cap", () => {
  it("is 1,024, with the byte cap deliberately unchanged at 256 MiB", () => {
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(1_024);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes).toBe(256 * MIB);
    // One doubling, twice, and the byte cap never moved. It is the same
    // backstop it was at 256 entries and it is doing more work than ever.
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(CURATED_ENTRY_CAP * 2);
  });

  /**
   * The blocker the FIRST raise existed to clear, restated from the two waves it
   * was measured on. 255 of 256 is what ADR 0034 recorded and ADR 0035 carried
   * forward as the promotion precondition; at 512 the same three waves left 257
   * entries, which is the headroom the curated `w03` subset was sized against.
   */
  it("cleared the 255-of-256 blocker that stopped a fourth curated promotion", () => {
    const promoted = block835.assetEntries + midtown.assetEntries + lowerManhattan.assetEntries;
    expect(block835.assetEntries).toBe(BLOCK835_MEMBERSHIP_BUILDING_IDS.length * BLOCK835_SHIPPED_LOD_COUNT);
    expect(promoted).toBe(255);
    expect(256 - promoted).toBe(1);
    expect(CURATED_ENTRY_CAP - promoted).toBe(257);
  });
});

describe("the byte ceiling re-derived at the curated cap", () => {
  const ceiling = exteriorCacheByteCeiling({
    waves: [block835, midtown, lowerManhattan],
    maxCacheEntries: CURATED_ENTRY_CAP,
    maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
  });

  /**
   * The per-wave profiles, pinned to the committed bytes they were measured
   * from. They are asserted rather than merely reported so that a wave whose
   * payload changed weight cannot slip a stale ceiling past this suite.
   */
  it("measures each curated wave's per-asset byte profile from its committed record", () => {
    expect(block835).toMatchObject({ assetEntries: 28, totalByteSize: 7_037_116, maxByteSize: 3_716_836 });
    expect(midtown).toMatchObject({ assetEntries: 156, totalByteSize: 20_884_440, maxByteSize: 1_882_048 });
    expect(lowerManhattan).toMatchObject({ assetEntries: 71, totalByteSize: 41_189_232, maxByteSize: 4_269_904 });
    // Lower-Manhattan is the heaviest per asset by mean: it is textured LOD 0
    // over the World Trade Center site, where the sourced rings are large.
    expect(ceiling.worstMeanReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
    expect(lowerManhattan.meanByteSize).toBe(580_130);
  });

  /**
   * The REACHABLE bound, and the reason bytes stayed non-binding: the whole
   * curated composition was 69.1 MB, which is 26% of a byte cap that did not
   * move. A cache cannot hold more of a fixed set of releases than all of it,
   * and all of it fit the entry cap, so this was the ceiling rather than a model
   * of one.
   */
  it("bounds the three-wave curated composition by its own total bytes, well inside 256 MiB", () => {
    expect(ceiling.residentAssetEntries).toBe(255);
    expect(ceiling.entryHeadroom).toBe(257);
    expect(ceiling.fitsEntryCap).toBe(true);
    expect(ceiling.compositionByteCeilingBytes).toBe(69_110_788);
    expect(ceiling.compositionByteCeilingBytes / MIB).toBeCloseTo(65.91, 2);
    expect(ceiling.compositionByteCeilingRatio).toBeLessThan(0.27);
    expect(ceiling.bytesNonBindingForComposition).toBe(true);
    expect(ceiling.bindingConstraint).toBe("entries");
  });

  /**
   * The MODELLED bound, labelled as one. 512 entries of the heaviest wave's
   * MEAN asset is 283 MiB, which is ABOVE the unchanged 256 MiB byte cap — so
   * the honest statement was never "bytes can never bind at 512 entries", it was
   * "bytes do not bind for this composition, and the byte cap is what stops a
   * heavier future composition from filling all 512 entries". That is precisely
   * why `maxCachedBytes` was left where it was, and the serving composition is
   * the heavier future the sentence was written about.
   */
  it("states the modelled fills, including the one that exceeds the byte cap", () => {
    expect(ceiling.meanFillByteCeilingBytes).toBe(CURATED_ENTRY_CAP * 580_130);
    expect(ceiling.meanFillByteCeilingBytes / MIB).toBeCloseTo(283.27, 2);
    expect(ceiling.meanFillByteCeilingBytes).toBeGreaterThan(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
    // Unreachable, and stated because it is the answer to "does the entry cap
    // alone bound bytes": no.
    expect(ceiling.largestAssetReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
    expect(ceiling.saturationFillByteCeilingBytes).toBe(CURATED_ENTRY_CAP * 4_269_904);
    expect(ceiling.saturationFillByteCeilingBytes).toBeGreaterThan(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes * 8);
  });

  it("refuses a ceiling over no waves, and a non-positive cap", () => {
    expect(() => exteriorCacheByteCeiling({ waves: [], maxCacheEntries: 512, maxCachedBytes: 256 * MIB }))
      .toThrow(/a ceiling over nothing/u);
    expect(() => exteriorCacheByteCeiling({ waves: [block835], maxCacheEntries: 0, maxCachedBytes: 256 * MIB }))
      .toThrow(/must both be positive/u);
    expect(() => exteriorCacheWaveByteProfile({ releaseId: "empty", assetByteSizes: [] }))
      .toThrow(/declares no cached assets/u);
  });

  it("counts one LRU entry per shipped GLB and nothing else", () => {
    expect(exteriorCacheAssetByteSizes([
      { path: "public/assets/a.glb", byteSize: 3 },
      { path: "public/assets/nested/b.glb", byteSize: 1 },
      { path: "public/cell-release/c.json", byteSize: 9 },
      { path: "private/assets/d.glb", byteSize: 9 },
      { path: "public/tiles/e.png", byteSize: 9 },
    ])).toEqual([1, 3]);
  });
});

describe("the byte ceiling with the FOURTH curated wave promoted", () => {
  /**
   * The T018 composition, still DERIVED rather than hand-listed: it is the
   * predecessor chain of this build's records with the fifth AND SIXTH waves
   * rolled back, which the module already models as "not resident". That keeps
   * this historical statement on the same derivation as the live one instead of
   * reintroducing the literal array the T018 review removed. The set of releases
   * to withdraw is named rather than counted, so a seventh promotion would have
   * to be added here explicitly instead of silently inflating a historical
   * figure.
   */
  const AFTER_T018 = new Set([centralUpperManhattan.releaseId, northernManhattan.releaseId]);
  const ceiling = exteriorCacheByteCeiling({
    waves: exteriorPromotedCacheProfiles({
      records: CURATED_RECORDS.map((record) => (
        record.enabled && AFTER_T018.has(record.releaseId)
          ? { enabled: false as const, releaseId: null }
          : record
      )),
      profiles: BYTE_PROFILES,
    }),
    maxCacheEntries: CURATED_ENTRY_CAP,
    maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
  });

  /**
   * Wave w03's curated subset is LIGHTER per asset than Lower-Manhattan's —
   * 223,618 B mean against 580,130 B — so promoting 179 more assets added
   * 38.2 MiB and left bytes non-binding by the same wide margin.
   */
  it("stayed entry-bound, at 434 of 512 entries and 104.08 MiB of 256 MiB", () => {
    expect(southernRemainder.assetEntries).toBe(179);
    expect(southernRemainder.totalByteSize).toBe(40_027_708);
    expect(southernRemainder.meanByteSize).toBe(223_618);
    expect(ceiling.residentAssetEntries).toBe(434);
    expect(ceiling.entryHeadroom).toBe(78);
    expect(ceiling.fitsEntryCap).toBe(true);
    expect(ceiling.compositionByteCeilingBytes).toBe(109_138_496);
    expect(ceiling.compositionByteCeilingBytes / MIB).toBeCloseTo(104.08, 2);
    expect(ceiling.compositionByteCeilingRatio).toBeLessThan(0.41);
    expect(ceiling.bytesNonBindingForComposition).toBe(true);
    expect(ceiling.bindingConstraint).toBe("entries");
    // Entries, not bytes, is what waves w04 and w05 had left: 78 of 512.
    expect(ceiling.entryHeadroom / CURATED_ENTRY_CAP).toBeLessThan(0.16);
  });

  it("keeps the heaviest per-asset wave, and therefore the modelled fill, unchanged", () => {
    expect(ceiling.worstMeanReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
    expect(ceiling.meanFillByteCeilingBytes).toBe(CURATED_ENTRY_CAP * 580_130);
    expect(ceiling.largestAssetReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
  });
});

describe("the byte ceiling with the FIFTH curated wave promoted", () => {
  /**
   * The T020 composition, still DERIVED rather than hand-listed: the predecessor
   * chain with the SIXTH wave rolled back, which the module already models as
   * "not resident". Same shape as the four-wave statement above, and for the same
   * reason — a historical arithmetic that stops being derived stops being checked.
   */
  const ceiling = exteriorCacheByteCeiling({
    waves: exteriorPromotedCacheProfiles({
      records: CURATED_RECORDS.map((record) => (
        record.enabled && record.releaseId === northernManhattan.releaseId
          ? { enabled: false as const, releaseId: null }
          : record
      )),
      profiles: BYTE_PROFILES,
    }),
    maxCacheEntries: CURATED_ENTRY_CAP,
    maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
  });

  /**
   * Wave w04's curated subset is HEAVIER per asset than wave w03's — 359,234 B
   * mean against 223,618 B, because the Central Park West wall is towers rather
   * than mid-rise stock — but it is only 40 assets, so it added 13.7 MiB and the
   * composition stayed entry-bound by a wide margin.
   *
   * 474 of 512 entries was the whole promoted set, and the 38 entries left were
   * NOT the reserve: ADR 0036's split reserved 36 for wave w05 out of the 78
   * that were free before that promotion, and it spent 40 of its 42.
   */
  it("stayed entry-bound, at 474 of 512 entries and 117.79 MiB of 256 MiB", () => {
    expect(centralUpperManhattan.assetEntries).toBe(40);
    expect(centralUpperManhattan.totalByteSize).toBe(14_369_372);
    expect(centralUpperManhattan.meanByteSize).toBe(359_234);
    expect(ceiling.residentAssetEntries).toBe(474);
    expect(ceiling.entryHeadroom).toBe(38);
    expect(ceiling.fitsEntryCap).toBe(true);
    expect(ceiling.compositionByteCeilingBytes).toBe(123_507_868);
    expect(ceiling.compositionByteCeilingBytes / MIB).toBeCloseTo(117.79, 2);
    expect(ceiling.compositionByteCeilingRatio).toBeLessThan(0.47);
    expect(ceiling.bytesNonBindingForComposition).toBe(true);
    expect(ceiling.bindingConstraint).toBe("entries");
  });

  /**
   * The reserve, stated in cache arithmetic rather than only in the release
   * record: the promotion spent 40 of the 42 it was allotted, so 38 entries
   * remained — two more than the 36 wave `w05` was reserved.
   */
  it("left at least the 36 entries the split reserved for wave w05", () => {
    expect(ceiling.entryHeadroom).toBeGreaterThanOrEqual(36);
    expect(ceiling.entryHeadroom - 36).toBe(2);
  });

  it("keeps the heaviest per-asset wave, and therefore the modelled fill, unchanged", () => {
    expect(ceiling.worstMeanReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
    expect(ceiling.meanFillByteCeilingBytes).toBe(CURATED_ENTRY_CAP * 580_130);
    expect(ceiling.largestAssetReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
  });
});

describe("the byte ceiling with the SIXTH and LAST curated wave promoted", () => {
  // DERIVED from the predecessor chain of the promotion records, never listed by
  // hand — see `CURATED_PROFILES` and the derivation suite below.
  const ceiling = exteriorCacheByteCeiling({
    waves: CURATED_PROFILES,
    maxCacheEntries: CURATED_ENTRY_CAP,
    maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
  });

  /**
   * The composition this build shipped until the serving promotion, and the last
   * one the CURATED ledger could produce: six waves declared, six promoted.
   *
   * Wave `w05`'s curated subset is the LIGHTEST per asset of the four textured
   * waves — 175,823 B mean against wave `w04`'s 359,234 B — because central
   * Harlem's stock is smaller-footprint and lower than the Central Park West
   * wall. Twenty-four assets added 4.02 MiB and the composition stayed
   * entry-bound by the same wide margin.
   *
   * 498 of 512 entries was the WHOLE promoted set of the whole ledger, and the 14
   * entries left over were headroom with no wave left to reserve them for.
   */
  it("stayed entry-bound, at 498 of 512 entries and 121.81 MiB of 256 MiB", () => {
    expect(northernManhattan.assetEntries).toBe(24);
    expect(northernManhattan.totalByteSize).toBe(4_219_756);
    expect(northernManhattan.meanByteSize).toBe(175_823);
    expect(ceiling.residentAssetEntries).toBe(498);
    expect(ceiling.entryHeadroom).toBe(14);
    expect(ceiling.fitsEntryCap).toBe(true);
    expect(ceiling.compositionByteCeilingBytes).toBe(127_727_624);
    expect(ceiling.compositionByteCeilingBytes / MIB).toBeCloseTo(121.81, 2);
    expect(ceiling.compositionByteCeilingRatio).toBeLessThan(0.48);
    expect(ceiling.bytesNonBindingForComposition).toBe(true);
    expect(ceiling.bindingConstraint).toBe("entries");
  });

  /**
   * The reservation, closed out in cache arithmetic rather than only in the
   * release record: T020 promised this wave 36 entries out of the 78 that were
   * free before its own promotion, and this promotion spent 24 of them. BOTH
   * halves of the arithmetic are asserted — what the reservation allowed and what
   * was actually taken — because "it fit" and "it fit with room" are different
   * statements.
   */
  it("spent 24 of the 36 reserved entries and closed the curated ledger with 14 free", () => {
    const fiveWaveResident = 474;
    expect(ceiling.residentAssetEntries - northernManhattan.assetEntries).toBe(fiveWaveResident);
    expect(northernManhattan.assetEntries).toBeLessThanOrEqual(36);
    expect(36 - northernManhattan.assetEntries).toBe(12);
    expect(ceiling.entryHeadroom).toBe(CURATED_ENTRY_CAP - fiveWaveResident - northernManhattan.assetEntries);
  });

  it("keeps the heaviest per-asset wave, and therefore the modelled fill, unchanged", () => {
    expect(ceiling.worstMeanReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
    expect(ceiling.meanFillByteCeilingBytes).toBe(CURATED_ENTRY_CAP * 580_130);
    expect(ceiling.largestAssetReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
  });
});

describe("the SERVING composition, where the composition ceiling stops being a bound", () => {
  const ceiling = exteriorCacheByteCeiling({
    waves: PROMOTED_PROFILES,
    maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
    maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
  });

  /**
   * Per-wave profiles for the six serving releases, from their own committed
   * inventories. Asserted for the same reason the curated ones are: a wave whose
   * payload changed weight must not slip a stale ceiling past this suite.
   *
   * Note what happened to the per-asset MEANS. The curated subsets were chosen
   * on skyline value, so they were the biggest buildings of their areas —
   * Lower-Manhattan's 71 curated assets average 580,130 B. Serving the same wave
   * in full averages 115,899 B, because the other 6,311 buildings of Lower
   * Manhattan are ordinary. Curating for the skyline made the promoted bytes
   * roughly five times heavier per asset than the city actually is.
   */
  it("measures each serving wave's per-asset byte profile from its committed inventory", () => {
    expect(servingProfiles.map((profile) => ({ id: profile.releaseId, entries: profile.assetEntries, total: profile.totalByteSize, mean: profile.meanByteSize }))).toEqual([
      { id: "manhattan-exterior-cells-20260811-v3-s1", entries: 14, total: 7_533_100, mean: 538_079 },
      { id: "manhattan-midtown-core-cells-20260811-v3-s1", entries: 7_179, total: 1_269_329_072, mean: 176_811 },
      { id: "manhattan-lower-manhattan-cells-20260812-s1", entries: 6_382, total: 739_668_716, mean: 115_899 },
      { id: "manhattan-southern-remainder-cells-20260812-s1", entries: 9_560, total: 868_474_880, mean: 90_845 },
      { id: "manhattan-central-upper-manhattan-cells-20260812-s1", entries: 11_682, total: 1_057_450_304, mean: 90_520 },
      { id: "manhattan-northern-manhattan-cells-20260812-s1", entries: 10_172, total: 736_766_996, mean: 72_431 },
    ]);
    // The curated wave was five times heavier per asset than serving the same
    // ground in full. Stated as a comparison because it is the reason the old
    // ceiling's "heaviest wave" reasoning does not carry over.
    expect(Math.round(lowerManhattan.meanByteSize / servingProfiles[2]!.meanByteSize)).toBe(5);
  });

  /**
   * THE HANDOVER, stated as an assertion rather than as prose.
   *
   * The whole promoted composition is 44,989 entries and 4.679 GB. It does not
   * fit the entry cap — it is 43.9 times it — and it does not fit the byte cap,
   * at 17.4 times. `fitsEntryCap` is false and that is CORRECT rather than a
   * failure: a cache is not expected to hold a city.
   *
   * What this means is that the composition ceiling, which was the REACHABLE
   * bound for every curated composition, is now unreachable and says nothing
   * about a session. The reachable bound moved to `exterior-serving-residency.ts`,
   * which asks the question this module cannot: how much can the scheduler make
   * resident at once. That answer is 599 entries and 235.56 MiB at the worst
   * anchor, and it is where the promotion was actually sized.
   */
  it("no longer fits either cap, and hands the reachable bound to the residency module", () => {
    expect(ceiling.residentAssetEntries).toBe(44_989);
    expect(ceiling.compositionByteCeilingBytes).toBe(4_679_223_068);
    expect(ceiling.fitsEntryCap).toBe(false);
    expect(ceiling.bytesNonBindingForComposition).toBe(false);
    expect(ceiling.entryHeadroom).toBe(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries - 44_989);
    expect(ceiling.entryHeadroom).toBeLessThan(0);
    // How far past each cap, so "does not fit" is a magnitude and not a verdict.
    expect(Number((ceiling.residentAssetEntries / EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toFixed(1))).toBe(43.9);
    expect(Number((ceiling.compositionByteCeilingRatio).toFixed(1))).toBe(17.4);
    // Entries overflow proportionally more than bytes, which is what makes the
    // composition "entry-bound" here — a label that is arithmetically true and
    // operationally meaningless, because neither bound is reachable.
    expect(ceiling.bindingConstraint).toBe("entries");
  });

  /**
   * The island totals, cross-checked against the number the retention evidence
   * and the promotion records independently state. Three records derived from
   * different files agreeing on 44,989 is worth an assertion.
   */
  it("sums to the island the ledger declares: 44,989 served assets", () => {
    expect(servingProfiles.reduce((sum, profile) => sum + profile.assetEntries, 0)).toBe(44_989);
    expect(PROMOTED_PROFILES.reduce((sum, profile) => sum + profile.assetEntries, 0)).toBe(44_989);
  });
});

describe("the composition is derived from the promotion records", () => {
  it("resolves exactly the enabled promoted releases, in record order", () => {
    const enabled = EXTERIOR_DEFAULT_ACTIVATIONS.filter((record) => record.enabled).map((record) => record.releaseId);
    expect(PROMOTED_PROFILES.map((profile) => profile.releaseId)).toEqual(enabled);
    expect(PROMOTED_PROFILES).toHaveLength(6);
    expect(enabled).toEqual([...SERVING_RELEASE_IDS]);
  });

  it("resolves the curated predecessors just as strictly, in the same order", () => {
    expect(CURATED_PROFILES.map((profile) => profile.releaseId)).toEqual([
      block835.releaseId, midtown.releaseId, lowerManhattan.releaseId,
      southernRemainder.releaseId, centralUpperManhattan.releaseId, northernManhattan.releaseId,
    ]);
  });

  /**
   * THE PRE-FIX REPRO. Before this derivation existed the waves were a literal
   * array in this file, so a newly promoted wave changed
   * `EXTERIOR_DEFAULT_ACTIVATIONS` and changed NOTHING here: the ceiling kept
   * describing the old set and stayed green while understating the composition by
   * a whole release. Both halves are asserted, so the contrast is the test rather
   * than a comment about one.
   */
  it("FAILS on an enabled promoted release with no byte profile, where a hand-listed set passed silently", () => {
    const unregistered = { enabled: true as const, releaseId: "manhattan-seventh-wave-cells-20260813" };
    const withSeventhWave = [...EXTERIOR_DEFAULT_ACTIVATIONS, unregistered];

    // The OLD shape: a literal list. It ignores the new record entirely and
    // produces a confident, wrong ceiling for a build that promotes seven waves.
    const handListed = exteriorCacheByteCeiling({
      waves: servingProfiles,
      maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
      maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
    });
    expect(handListed.residentAssetEntries).toBe(44_989);
    expect(handListed.waves).toHaveLength(6);

    // The derived shape refuses, and names the release it could not account for.
    // THIS IS THE SAME REFUSAL THAT FIRED AT T020, AT T022, AND AGAIN AT T005 on
    // all six real serving records, before their byte-profile rows existed.
    expect(() => exteriorPromotedCacheProfiles({ records: withSeventhWave, profiles: BYTE_PROFILES }))
      .toThrow(/manhattan-seventh-wave-cells-20260813 has no measured byte profile/u);
  });

  it("skips a wave rolled back to base, because it is genuinely not resident", () => {
    const rolledBack = EXTERIOR_DEFAULT_ACTIVATIONS.map((record) => (
      record.enabled && record.releaseId === "manhattan-southern-remainder-cells-20260812-s1"
        ? { enabled: false as const, releaseId: null }
        : record
    ));
    const profiles = exteriorPromotedCacheProfiles({ records: rolledBack, profiles: BYTE_PROFILES });
    expect(profiles.map((profile) => profile.releaseId)).not.toContain("manhattan-southern-remainder-cells-20260812-s1");
    expect(profiles).toHaveLength(5);
    const ceiling = exteriorCacheByteCeiling({ waves: profiles, maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries, maxCachedBytes: 256 * MIB });
    // 44,989 resident minus the 9,560 the withdrawn wave occupied. The rollback
    // is per record, so the other five waves stay resident.
    expect(ceiling.residentAssetEntries).toBe(44_989 - 9_560);
    expect(ceiling.residentAssetEntries).toBe(35_429);
  });

  it("refuses a mislabelled profile and an empty composition", () => {
    expect(() => exteriorPromotedCacheProfiles({
      records: [{ enabled: true, releaseId: block835.releaseId }],
      profiles: new Map([[block835.releaseId, midtown]]),
    })).toThrow(/describes manhattan-midtown-core-cells-20260811-v3/u);
    expect(() => exteriorPromotedCacheProfiles({
      records: [{ enabled: false, releaseId: null }],
      profiles: BYTE_PROFILES,
    })).toThrow(/no enabled promotion record resolved a byte profile/u);
  });
});

describe("the ADR 0030 eviction disclosure at the raised cap", () => {
  /**
   * The disclosure is unchanged in substance and WIDER in blast radius, and the
   * constant says both. It is asserted rather than left as prose because the
   * failure mode ADR 0030 named — a limitation that quietly stops being restated
   * once the number it was about has moved — is exactly what a raise invites, and
   * this cap has now been raised twice.
   */
  it("still holds, and says that raising the cap widens it", () => {
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/RECENCY-ONLY/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/no per-wave reservation/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/WIDENS its blast radius/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/re-verified against its pin/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/256 to 512/u);
  });

  /**
   * And it names what the SERVING composition changed, which is not the policy
   * but how often the policy is exercised. A disclosure that only mentioned the
   * cap doubling would understate a composition where every promoted release has
   * content in every cell it owns.
   */
  it("names the serving composition's wider exposure, not just the larger cap", () => {
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/512 to 1024/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/normal case/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/1\.79 evictions per decision/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/92\.0%/u);
  });
});
