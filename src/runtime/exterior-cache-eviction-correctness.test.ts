import { describe, expect, it } from "vitest";

import { CitywideLruCache } from "../release/citywide-release.ts";
import {
  commitExteriorCacheRelease,
  createExteriorCacheReleaseState,
  noteExteriorSceneRetired,
  planExteriorCacheRelease,
  queueExteriorCacheRelease,
  type ExteriorCacheReleaseState,
} from "./exterior-cache-release.ts";
import { acceptExteriorCellOutcomes, createExteriorCellLoadState, reconcileExteriorCellLoads } from "./exterior-cell-reconciliation.ts";
import {
  EXTERIOR_RUNTIME_BUDGETS,
  createExteriorCellRuntime,
  exteriorOutcomeCacheKeys,
  type ExteriorCellOutcome,
  type ExteriorCellRuntime,
} from "./exterior-cell-runtime.ts";
import {
  corruptExteriorFixturePackage,
  exteriorCellFixture,
  exteriorFixtureBaseIdentity,
  exteriorFixtureFetcher,
  type ExteriorCellFixture,
} from "./exterior-cell-fixtures.ts";

/**
 * Eviction correctness, proved under an INJECTED LOWERED BYTE CAP.
 *
 * ## Say the awkward part first: the SHIPPED caps cannot bind
 *
 * `EXTERIOR_RUNTIME_BUDGETS` is 512 entries and 256 MiB. ADR 0041 measured the
 * whole promoted composition resident at once — all 883 declared cells, every
 * wave, no scheduler — at **484 entries and 122,601,292 B**. Both are inside
 * both ceilings, with 28 entries and 133 MiB to spare. There is therefore no
 * camera anywhere in Manhattan at which the shipped caps evict, and no test
 * against the shipped caps could prove that eviction is correct, because it
 * would never fire.
 *
 * So the caps are LOWERED for these tests, per-instance, and nothing in
 * `EXTERIOR_RUNTIME_BUDGETS` changes. That is the honest shape: the mechanics
 * are proved at a cap that binds, and the constants stay where the measured
 * evidence put them. ADR 0042 records the same statement.
 *
 * ## What each test proves
 *
 *   (a) a scheduler EVICT actually shrinks `cache.bytes()` — and the same
 *       sequence WITHOUT the release seam does not, so the test distinguishes
 *       the seam from its absence rather than merely observing a small number;
 *   (b) a refetch after a release re-verifies its checksum. This one is
 *       near-tautological and is labelled as such: the cache key is
 *       `ref#sha256`, the fetcher passes `cache: "no-store"`, and every fetched
 *       artifact is hashed and compared before it is admitted, so byte-identity
 *       after a refetch is STRUCTURAL. It is tested anyway, including with a
 *       tampered second response, because a structural guarantee that nothing
 *       exercises is a structural guarantee nobody would notice losing;
 *   (c) the predecessor-fallback DOUBLE COST, measured, and disclosed as
 *       fault-injected.
 */

const CLOSE_METERS = 180;

/** Fixture cell bytes, read from the fixture rather than typed, so a fixture change is visible. */
async function fixtureRuntime(options: {
  fixture: ExteriorCellFixture;
  cache: CitywideLruCache<Uint8Array>;
  onRequest?: (relativeRef: string) => void;
  fetchOverride?: (relativeRef: string, original: Uint8Array) => Uint8Array;
}): Promise<ExteriorCellRuntime> {
  const base = exteriorFixtureFetcher(options.fixture, { onRequest: options.onRequest });
  return createExteriorCellRuntime(
    { index: options.fixture.index, graph: options.fixture.graph, assemblies: options.fixture.assemblies },
    { kind: "default" },
    {
      fetchArtifact: options.fetchOverride
        ? async (relativeRef, signal) => options.fetchOverride!(relativeRef, await base(relativeRef, signal))
        : base,
      baseIdentity: exteriorFixtureBaseIdentity(options.fixture),
      cache: options.cache,
    },
  ).runtime;
}

/**
 * The app's own eviction path, replayed without React.
 *
 * Reconcile against the scheduler's decision, queue what it dropped, mark the
 * viewport's revoke, then plan and commit. This is the SAME module sequence
 * `App.tsx` runs; what is not here is the effect that calls it.
 */
function evictAndRelease(
  releaseState: ExteriorCacheReleaseState,
  loadState: ReturnType<typeof createExteriorCellLoadState<ExteriorCellOutcome>>,
  scheduled: readonly string[],
  cache: CitywideLruCache<Uint8Array>,
  options: { seam?: boolean } = {},
): { droppedCellIds: readonly string[]; releasedKeyCount: number } {
  const before = new Map(loadState.outcomes);
  const { dropped } = reconcileExteriorCellLoads(loadState, scheduled);
  if (options.seam === false) return { droppedCellIds: dropped, releasedKeyCount: 0 };
  for (const cellId of dropped) {
    const outcome = before.get(cellId);
    if (!outcome) continue;
    const { keys, byteSize } = exteriorOutcomeCacheKeys(outcome);
    queueExteriorCacheRelease(releaseState, { releaseId: "fixture-wave", cellId, cacheKeys: keys, byteSize, reachedScene: true });
  }
  // The viewport's revoke, which in the app arrives as `onExteriorCellsRetired`.
  noteExteriorSceneRetired(releaseState, dropped);
  const publishedCacheKeys = new Set<string>();
  for (const outcome of loadState.outcomes.values()) for (const key of exteriorOutcomeCacheKeys(outcome).keys) publishedCacheKeys.add(key);
  const plan = planExteriorCacheRelease(releaseState, {
    inFlightCellIds: new Set(loadState.inFlight),
    requestedCellIds: new Set(loadState.requested),
    publishedCacheKeys,
  });
  commitExteriorCacheRelease(releaseState, plan, (key) => { cache.delete(key); });
  return { droppedCellIds: dropped, releasedKeyCount: plan.releaseKeys.length };
}

async function loadInto(
  runtime: ExteriorCellRuntime,
  loadState: ReturnType<typeof createExteriorCellLoadState<ExteriorCellOutcome>>,
  cellIds: readonly string[],
): Promise<void> {
  const { fresh } = reconcileExteriorCellLoads(loadState, cellIds);
  const outcomes = await Promise.all(fresh.map((cellId) => runtime.loadCell(cellId, "exploration", CLOSE_METERS)));
  acceptExteriorCellOutcomes(loadState, fresh, outcomes);
}

describe("the shipped exterior caps, stated plainly", () => {
  it("cannot bind for the promoted composition, which is why these tests lower them", () => {
    // ADR 0041's committed opt-in evidence, default variant, at both cameras.
    const WHOLE_COMPOSITION_ENTRIES = 484;
    const WHOLE_COMPOSITION_BYTES = 122_601_292;
    expect(WHOLE_COMPOSITION_ENTRIES).toBeLessThan(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries);
    expect(WHOLE_COMPOSITION_BYTES).toBeLessThan(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries - WHOLE_COMPOSITION_ENTRIES).toBe(28);
    expect(EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes - WHOLE_COMPOSITION_BYTES).toBe(145_834_164);
    // Unchanged by T003. The mechanics below are proved at an injected cap.
    expect(EXTERIOR_RUNTIME_BUDGETS).toEqual({ maxCacheEntries: 512, maxCachedBytes: 256 * 1024 * 1024, maxConcurrentRequests: 4 });
  });
});

describe("(a) a scheduler evict actually frees exterior cache bytes", () => {
  it("shrinks cache.bytes() with the seam, and does NOT shrink it without", async () => {
    // The same eviction, run twice, differing only in whether the release seam
    // is invoked. Without the seam the scheduler's decision is invisible to the
    // cache — which is exactly the state T002 shipped and T003 exists to change.
    const measure = async (seam: boolean) => {
      const fixture = await exteriorCellFixture();
      const cache = new CitywideLruCache<Uint8Array>(64, 64 * 1024);
      const runtime = await fixtureRuntime({ fixture, cache });
      const loadState = createExteriorCellLoadState<ExteriorCellOutcome>();
      const releaseState = createExteriorCacheReleaseState();
      await loadInto(runtime, loadState, ["c1", "c2"]);
      const resident = { entries: cache.size(), bytes: cache.bytes() };
      const { droppedCellIds, releasedKeyCount } = evictAndRelease(releaseState, loadState, ["c2"], cache, { seam });
      return { resident, droppedCellIds, releasedKeyCount, after: { entries: cache.size(), bytes: cache.bytes() }, releaseState };
    };

    const withSeam = await measure(true);
    const withoutSeam = await measure(false);

    // Both evicted the same cell.
    expect(withSeam.droppedCellIds).toEqual(["c1"]);
    expect(withoutSeam.droppedCellIds).toEqual(["c1"]);
    // Both held the same bytes before the eviction.
    expect(withSeam.resident).toEqual(withoutSeam.resident);
    expect(withSeam.resident.entries).toBe(2);

    // The seam frees the evicted cell's entry and its bytes.
    expect(withSeam.releasedKeyCount).toBe(1);
    expect(withSeam.after.entries).toBe(1);
    expect(withSeam.after.bytes).toBeLessThan(withSeam.resident.bytes);
    expect(withSeam.releaseState.releasedArtifactBytes).toBe(withSeam.resident.bytes - withSeam.after.bytes);

    // Without it, the decision changes nothing about the cache. This assertion
    // is the point of the test: it distinguishes the seam from its absence.
    expect(withoutSeam.after).toEqual(withoutSeam.resident);
  });

  it("frees bytes under an injected cap low enough that recency alone would have thrashed", async () => {
    // A cap the fixture composition genuinely exceeds, so the LRU's own
    // backstop is live. The seam still governs: what the scheduler evicted is
    // what leaves, and it leaves without waiting for recency pressure.
    const fixture = await exteriorCellFixture();
    const cache = new CitywideLruCache<Uint8Array>(64, 2_000);
    const runtime = await fixtureRuntime({ fixture, cache });
    const loadState = createExteriorCellLoadState<ExteriorCellOutcome>();
    const releaseState = createExteriorCacheReleaseState();
    await loadInto(runtime, loadState, ["c1", "c2"]);
    // 1,140 + 1,040 = 2,180 B against a 2,000 B cap: recency has already fired.
    expect(cache.bytes()).toBeLessThanOrEqual(2_000);
    expect(cache.evictionCount()).toBeGreaterThan(0);
    const residentBytes = cache.bytes();
    evictAndRelease(releaseState, loadState, [], cache);
    expect(cache.size()).toBe(0);
    expect(cache.bytes()).toBe(0);
    expect(cache.bytes()).toBeLessThan(residentBytes);
  });

  it("holds the bytes of a cell whose load is still in flight, then frees them when it settles", async () => {
    // The race the seam is built around, end to end against the real runtime.
    const fixture = await exteriorCellFixture();
    const cache = new CitywideLruCache<Uint8Array>(64, 64 * 1024);
    const runtime = await fixtureRuntime({ fixture, cache });
    const loadState = createExteriorCellLoadState<ExteriorCellOutcome>();
    const releaseState = createExteriorCacheReleaseState();

    const { fresh } = reconcileExteriorCellLoads(loadState, ["c1", "c2"]);
    const settle = Promise.all(fresh.map((cellId) => runtime.loadCell(cellId, "exploration", CLOSE_METERS)));
    // The scheduler evicts c1 while its load is on the wire. `inFlight` is not
    // cleared, and the plan must refuse to release against it.
    reconcileExteriorCellLoads(loadState, ["c2"]);
    expect(loadState.inFlight.has("c1")).toBe(true);
    const outcomes = await settle;
    const verdict = acceptExteriorCellOutcomes(loadState, fresh, outcomes);
    expect(verdict.discarded).toEqual(["c1"]);

    // The discarded outcome is the second door into the queue. Its bytes were
    // verified and cached and will never be published, so nothing built a Blob.
    const discarded = outcomes[fresh.indexOf("c1")]!;
    const { keys, byteSize } = exteriorOutcomeCacheKeys(discarded);
    queueExteriorCacheRelease(releaseState, { releaseId: "fixture-wave", cellId: "c1", cacheKeys: keys, byteSize, reachedScene: false });

    const before = cache.bytes();
    const publishedCacheKeys = new Set([...loadState.outcomes.values()].flatMap((outcome) => exteriorOutcomeCacheKeys(outcome).keys));
    const plan = planExteriorCacheRelease(releaseState, { inFlightCellIds: new Set(loadState.inFlight), requestedCellIds: new Set(loadState.requested), publishedCacheKeys });
    commitExteriorCacheRelease(releaseState, plan, (key) => { cache.delete(key); });
    expect(cache.bytes()).toBe(before - byteSize);
    // c2's bytes are untouched: it is still resident and still published.
    expect(cache.size()).toBe(1);
  });
});

describe("(b) a refetch after a release re-verifies", () => {
  it("re-requests the artifact and admits byte-identical bytes", async () => {
    // NEAR-TAUTOLOGICAL, and stated as such. The cache key is `ref#sha256`, the
    // local fetcher passes `cache: "no-store"`, and every fetched artifact is
    // hashed and compared to the pinned digest before admission. Byte-identity
    // after a refetch is therefore structural, not empirical. The test exists
    // because a structural guarantee nothing exercises is one nobody notices
    // losing.
    const fixture = await exteriorCellFixture();
    const cache = new CitywideLruCache<Uint8Array>(64, 64 * 1024);
    const requests: string[] = [];
    const runtime = await fixtureRuntime({ fixture, cache, onRequest: (ref) => { requests.push(ref); } });
    const loadState = createExteriorCellLoadState<ExteriorCellOutcome>();
    const releaseState = createExteriorCacheReleaseState();

    await loadInto(runtime, loadState, ["c1"]);
    const firstKeys = [...cache.keys()];
    const firstBytes = cache.get(firstKeys[0]!)!.slice();
    expect(requests).toHaveLength(1);

    evictAndRelease(releaseState, loadState, [], cache);
    expect(cache.size()).toBe(0);

    await loadInto(runtime, loadState, ["c1"]);
    // A second network request, not a cache hit: the release really removed it.
    expect(requests).toHaveLength(2);
    expect([...cache.keys()]).toEqual(firstKeys);
    expect(cache.get(firstKeys[0]!)).toEqual(firstBytes);
    expect(runtime.getMetrics().requestedArtifactCount).toBe(2);
  });

  it("fails the refetch closed when the second response does not match the pinned digest", async () => {
    // This is the half of (b) that is NOT a tautology: it shows the
    // verification runs on the REFETCH and not only on the first admission.
    const fixture = await exteriorCellFixture();
    const cache = new CitywideLruCache<Uint8Array>(64, 64 * 1024);
    const seen = new Map<string, number>();
    const runtime = await fixtureRuntime({
      fixture,
      cache,
      fetchOverride: (relativeRef, original) => {
        const count = (seen.get(relativeRef) ?? 0) + 1;
        seen.set(relativeRef, count);
        if (count === 1) return original;
        const tampered = new Uint8Array(original);
        tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
        return tampered;
      },
    });
    const loadState = createExteriorCellLoadState<ExteriorCellOutcome>();
    const releaseState = createExteriorCacheReleaseState();

    await loadInto(runtime, loadState, ["c1"]);
    expect(cache.size()).toBe(1);
    evictAndRelease(releaseState, loadState, [], cache);

    const refetched = await runtime.loadCell("c1", "exploration", CLOSE_METERS);
    // The tampered head fails its checksum and the pinned predecessor renders.
    // Nothing tampered ever reaches the scene, and nothing tampered is cached.
    expect(refetched.kind === "rendered" ? refetched.representation : refetched.kind).toBe("predecessor");
    expect(cache.keys().some((key) => key.includes("cell-c1-v2"))).toBe(false);
  });
});

describe("(c) the predecessor-fallback double cost, fault-injected", () => {
  it("charges the cache for the failed head AND the predecessor that replaced it", async () => {
    // FAULT-INJECTED, and disclosed as such: the head package's GLBs are
    // corrupted deliberately so the single-hop fallback runs. No promoted wave
    // is known to do this; what is being measured is the COST of the path when
    // it does, which ADR 0041 handed here as an unmeasured item.
    const fixture = await exteriorCellFixture();
    corruptExteriorFixturePackage(fixture, fixture.assemblyPackageIds.c1v2);
    const cache = new CitywideLruCache<Uint8Array>(64, 64 * 1024);
    const requests: string[] = [];
    const runtime = await fixtureRuntime({ fixture, cache, onRequest: (ref) => { requests.push(ref); } });

    const outcome = await runtime.loadCell("c1", "exploration", CLOSE_METERS);
    expect(outcome.kind === "rendered" ? outcome.representation : outcome.kind).toBe("predecessor");

    // Two requests for one rendered cell, and the failed head's bytes are NOT
    // cached — the pool never admits an artifact that failed verification — so
    // the double cost is paid in REQUESTS and hashing, not in residency.
    expect(requests).toHaveLength(2);
    expect(runtime.getMetrics().requestedArtifactCount).toBe(2);
    expect(runtime.getMetrics().failedArtifactCount).toBe(1);
    expect(cache.size()).toBe(1);
    expect(cache.keys().every((key) => key.includes("cell-c1-v1"))).toBe(true);

    // And the release seam charges the release against what is actually
    // resident: releasing this cell frees the predecessor's entry, once.
    const loadState = createExteriorCellLoadState<ExteriorCellOutcome>();
    const releaseState = createExteriorCacheReleaseState();
    reconcileExteriorCellLoads(loadState, ["c1"]);
    acceptExteriorCellOutcomes(loadState, ["c1"], [outcome]);
    const { releasedKeyCount } = evictAndRelease(releaseState, loadState, [], cache);
    expect(releasedKeyCount).toBe(1);
    expect(cache.size()).toBe(0);
  });
});
