/**
 * ADR 0034 admissible response 1, executed and checked.
 *
 * The entry cap moved from 256 to 512. ADR 0034 permitted that only together
 * with a re-derivation of the BYTE ceiling at the raised cap, and ADR 0035
 * precondition (a) required the re-derivation to read the promoted waves' own
 * committed inventories rather than a remembered number. This suite is that
 * re-derivation.
 *
 * It is NEVER skipped. Every byte size it uses is committed to this repository:
 * three of the four waves carry a `payload-inventory.json` under `data/`, and
 * Block 835 V3's payload tree is itself committed under `public/data/`. No
 * untracked payload directory is required, so the arithmetic is recomputed on a
 * fresh clone and on CI rather than only on the machine that emitted the wave.
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

/**
 * Where each promoted release's measured bytes come from, keyed by release id.
 *
 * This is a REGISTRY, not the composition. The composition is derived from
 * `EXTERIOR_DEFAULT_ACTIVATIONS` below, so promoting a fifth wave fails here
 * until its bytes are registered rather than quietly producing a four-wave
 * ceiling. Block 835 V3 predates the payload-inventory record and is read from
 * its committed payload tree; every other wave is read from its committed
 * inventory. Both are committed bytes, so nothing here needs an untracked tree.
 */
const BYTE_PROFILES = new Map<string, ExteriorCacheWaveByteProfile>([
  [block835.releaseId, block835],
  [midtown.releaseId, midtown],
  [lowerManhattan.releaseId, lowerManhattan],
  [southernRemainder.releaseId, southernRemainder],
]);

/** The composition this build actually promotes, in promotion-record order. */
const PROMOTED_PROFILES = exteriorPromotedCacheProfiles({ records: EXTERIOR_DEFAULT_ACTIVATIONS, profiles: BYTE_PROFILES });

describe("the raised exterior entry cap", () => {
  it("is 512, with the byte cap deliberately unchanged at 256 MiB", () => {
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBe(512);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes).toBe(256 * MIB);
  });

  /**
   * The blocker the raise exists to clear, restated from the two waves it was
   * measured on. 255 of 256 is what ADR 0034 recorded and ADR 0035 carried
   * forward as the promotion precondition; at 512 the same three waves leave 257
   * entries, which is the headroom the curated `w03` subset is sized against.
   */
  it("clears the 255-of-256 blocker that stopped a fourth promotion", () => {
    const promoted = block835.assetEntries + midtown.assetEntries + lowerManhattan.assetEntries;
    expect(block835.assetEntries).toBe(BLOCK835_MEMBERSHIP_BUILDING_IDS.length * BLOCK835_SHIPPED_LOD_COUNT);
    expect(promoted).toBe(255);
    expect(256 - promoted).toBe(1);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries - promoted).toBe(257);
  });
});

describe("the byte ceiling re-derived at the raised cap", () => {
  const ceiling = exteriorCacheByteCeiling({
    waves: [block835, midtown, lowerManhattan],
    maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
    maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
  });

  /**
   * The per-wave profiles, pinned to the committed bytes they were measured
   * from. They are asserted rather than merely reported so that a wave whose
   * payload changed weight cannot slip a stale ceiling past this suite.
   */
  it("measures each promoted wave's per-asset byte profile from its committed record", () => {
    expect(block835).toMatchObject({ assetEntries: 28, totalByteSize: 7_037_116, maxByteSize: 3_716_836 });
    expect(midtown).toMatchObject({ assetEntries: 156, totalByteSize: 20_884_440, maxByteSize: 1_882_048 });
    expect(lowerManhattan).toMatchObject({ assetEntries: 71, totalByteSize: 41_189_232, maxByteSize: 4_269_904 });
    // Lower-Manhattan is the heaviest per asset by mean: it is textured LOD 0
    // over the World Trade Center site, where the sourced rings are large.
    expect(ceiling.worstMeanReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
    expect(lowerManhattan.meanByteSize).toBe(580_130);
  });

  /**
   * The REACHABLE bound, and the reason bytes stay non-binding: the whole
   * promoted composition is 69.1 MB, which is 26% of a byte cap that did not
   * move. A cache cannot hold more of a fixed set of releases than all of it,
   * and all of it fits the entry cap, so this is the ceiling rather than a model
   * of one.
   */
  it("bounds the promoted composition by its own total bytes, well inside 256 MiB", () => {
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
   * the honest statement is not "bytes can never bind at 512 entries", it is
   * "bytes do not bind for this composition, and the byte cap is what stops a
   * heavier future composition from filling all 512 entries". That is precisely
   * why `maxCachedBytes` was left where it was.
   */
  it("states the modelled fills, including the one that exceeds the byte cap", () => {
    expect(ceiling.meanFillByteCeilingBytes).toBe(512 * 580_130);
    expect(ceiling.meanFillByteCeilingBytes / MIB).toBeCloseTo(283.27, 2);
    expect(ceiling.meanFillByteCeilingBytes).toBeGreaterThan(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
    // Unreachable, and stated because it is the answer to "does the entry cap
    // alone bound bytes": no.
    expect(ceiling.largestAssetReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
    expect(ceiling.saturationFillByteCeilingBytes).toBe(512 * 4_269_904);
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

describe("the byte ceiling with the FOURTH wave promoted", () => {
  // DERIVED from the promotion records, never listed by hand — see
  // `PROMOTED_PROFILES` and the derivation suite below.
  const ceiling = exteriorCacheByteCeiling({
    waves: PROMOTED_PROFILES,
    maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
    maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
  });

  /**
   * The composition this build actually ships. Wave w03's curated subset is
   * LIGHTER per asset than Lower-Manhattan's — 223,618 B mean against 580,130 B
   * — so promoting 179 more assets adds 38.2 MiB and leaves bytes non-binding by
   * the same wide margin.
   */
  it("stays entry-bound, at 434 of 512 entries and 104.08 MiB of 256 MiB", () => {
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
    // Entries, not bytes, is what waves w04 and w05 have left: 78 of 512.
    expect(ceiling.entryHeadroom / EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries).toBeLessThan(0.16);
  });

  it("keeps the heaviest per-asset wave, and therefore the modelled fill, unchanged", () => {
    expect(ceiling.worstMeanReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
    expect(ceiling.meanFillByteCeilingBytes).toBe(512 * 580_130);
    expect(ceiling.largestAssetReleaseId).toBe("manhattan-lower-manhattan-cells-20260812-p1");
  });
});

describe("the composition is derived from the promotion records", () => {
  it("resolves exactly the enabled promoted releases, in record order", () => {
    const enabled = EXTERIOR_DEFAULT_ACTIVATIONS.filter((record) => record.enabled).map((record) => record.releaseId);
    expect(PROMOTED_PROFILES.map((profile) => profile.releaseId)).toEqual(enabled);
    expect(PROMOTED_PROFILES).toHaveLength(4);
  });

  /**
   * THE PRE-FIX REPRO. Before this derivation existed the four waves were a
   * literal array in this file, so a fifth promoted wave changed
   * `EXTERIOR_DEFAULT_ACTIVATIONS` and changed NOTHING here: the ceiling kept
   * describing four waves and stayed green while understating the composition by
   * a whole release. Both halves are asserted, so the contrast is the test rather
   * than a comment about one.
   */
  it("FAILS on an enabled promoted release with no byte profile, where a hand-listed set passed silently", () => {
    const unregistered = { enabled: true as const, releaseId: "manhattan-fifth-wave-cells-20260813" };
    const withFifthWave = [...EXTERIOR_DEFAULT_ACTIVATIONS, unregistered];

    // The OLD shape: a literal list. It ignores the new record entirely and
    // produces a confident, wrong ceiling — 434 entries for a build that
    // promotes five waves.
    const handListed = exteriorCacheByteCeiling({
      waves: [block835, midtown, lowerManhattan, southernRemainder],
      maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
      maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
    });
    expect(handListed.residentAssetEntries).toBe(434);
    expect(handListed.waves).toHaveLength(4);

    // The derived shape refuses, and names the release it could not account for.
    expect(() => exteriorPromotedCacheProfiles({ records: withFifthWave, profiles: BYTE_PROFILES }))
      .toThrow(/manhattan-fifth-wave-cells-20260813 has no measured byte profile/u);
  });

  it("skips a wave rolled back to base, because it is genuinely not resident", () => {
    const rolledBack = EXTERIOR_DEFAULT_ACTIVATIONS.map((record) => (
      record.enabled && record.releaseId === southernRemainder.releaseId
        ? { enabled: false as const, releaseId: null }
        : record
    ));
    const profiles = exteriorPromotedCacheProfiles({ records: rolledBack, profiles: BYTE_PROFILES });
    expect(profiles.map((profile) => profile.releaseId)).not.toContain(southernRemainder.releaseId);
    expect(profiles).toHaveLength(3);
    const ceiling = exteriorCacheByteCeiling({ waves: profiles, maxCacheEntries: 512, maxCachedBytes: 256 * MIB });
    expect(ceiling.residentAssetEntries).toBe(255);
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
   * once the number it was about has moved — is exactly what a raise invites.
   */
  it("still holds, and says that raising the cap widens it", () => {
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/RECENCY-ONLY/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/no per-wave reservation/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/WIDENS its blast radius/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/re-verified against its pin/u);
    expect(EXTERIOR_CACHE_EVICTION_DISCLOSURE).toMatch(/256 to 512/u);
  });
});
