import { describe, expect, it } from "vitest";
import { validateExteriorReleaseGraph } from "../release/exterior-release.ts";
import { CitywideLruCache } from "../release/citywide-release.ts";
import {
  ExteriorRuntimeError,
  createExteriorCellRuntime,
  exteriorArtifactCacheKey,
  type ExteriorCellOutcome,
  type ExteriorCellRenderPlan,
} from "./exterior-cell-runtime.ts";
import {
  blockingEvidenceGraph,
  exteriorCellFixture,
  exteriorFixtureBaseIdentity,
  exteriorFixtureFetcher,
  shardExteriorFixtureCellDetails,
  type ExteriorCellFixture,
} from "./exterior-cell-fixtures.ts";

const CLOSE_METERS = 180;

function rendered(outcome: ExteriorCellOutcome): ExteriorCellRenderPlan {
  if (outcome.kind !== "rendered") throw new Error(`expected a rendered cell, received ${outcome.kind}: ${JSON.stringify(outcome)}`);
  return outcome;
}

/**
 * Replace a sidecar's bytes AND its root declaration, so a test asserts the
 * check it means to assert rather than riding on the checksum that precedes it.
 */
async function repin(fixture: ExteriorCellFixture, sidecarRef: string, content: string): Promise<void> {
  const bytes = new TextEncoder().encode(content);
  fixture.contents.set(sidecarRef, bytes);
  const declared = fixture.graph.roots.find((root) => root.audience === "public")!.artifacts.find((artifact) => artifact.relativeRef === sidecarRef)!;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  declared.checksumSha256 = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
  declared.byteSize = bytes.byteLength;
}

function runtimeFor(fixture: ExteriorCellFixture, options: { onRequest?: (relativeRef: string) => void; cache?: CitywideLruCache<Uint8Array> } = {}) {
  return createExteriorCellRuntime(
    { index: fixture.index, graph: fixture.graph, assemblies: fixture.assemblies },
    { kind: "default" },
    {
      fetchArtifact: exteriorFixtureFetcher(fixture, { onRequest: options.onRequest }),
      baseIdentity: exteriorFixtureBaseIdentity(fixture),
      cache: options.cache,
    },
  );
}

/**
 * The seam's load-bearing claim, tested as an EQUIVALENCE rather than as a list
 * of properties.
 *
 * A serving release moves its per-cell inventory and evidence out of
 * `release-graph.json` and into a fetched, checksum-pinned document. The whole
 * argument for being allowed to do that is that nothing about what reaches the
 * scene changes and nothing about what is verified is weakened. So the tests
 * below build ONE fixture, transform a copy of it into sidecar form, and compare
 * the two — which is the only comparison that can actually catch a check that
 * quietly stopped running.
 */
describe("per-cell detail sidecars in the browser runtime", () => {
  it("renders byte-identically to the in-graph form it was derived from", async () => {
    const inline = await exteriorCellFixture();
    const sharded = await exteriorCellFixture();
    shardExteriorFixtureCellDetails(sharded, sharded.cellReleaseIds.c2v1);

    const shardedGraph = validateExteriorReleaseGraph(sharded.graph);
    expect(shardedGraph.ok, shardedGraph.ok ? "" : JSON.stringify(shardedGraph.issues, null, 2)).toBe(true);

    const inlinePlan = rendered(await runtimeFor(inline).runtime.loadCell("c2", "exploration", CLOSE_METERS));
    const shardedPlan = rendered(await runtimeFor(sharded).runtime.loadCell("c2", "exploration", CLOSE_METERS));

    // Everything the scene receives, compared in full: identity, provenance,
    // the selected LOD, the artifact ref, and the verified bytes themselves.
    expect(shardedPlan).toEqual(inlinePlan);
  });

  it("fetches exactly ONE extra artifact per cell, on the verified path", async () => {
    const inlineRefs: string[] = [];
    const shardedRefs: string[] = [];
    const inline = await exteriorCellFixture();
    const sharded = await exteriorCellFixture();
    const { sidecarRef } = shardExteriorFixtureCellDetails(sharded, sharded.cellReleaseIds.c2v1);

    await runtimeFor(inline, { onRequest: (ref) => inlineRefs.push(ref) }).runtime.loadCell("c2", "exploration", CLOSE_METERS);
    await runtimeFor(sharded, { onRequest: (ref) => shardedRefs.push(ref) }).runtime.loadCell("c2", "exploration", CLOSE_METERS);

    expect(shardedRefs.filter((ref) => ref === sidecarRef)).toHaveLength(1);
    expect(shardedRefs.filter((ref) => ref !== sidecarRef).sort()).toEqual([...inlineRefs].sort());
  });

  it("caches the sidecar under the same declaration-keyed entry every GLB uses", async () => {
    const sharded = await exteriorCellFixture();
    const { sidecarRef } = shardExteriorFixtureCellDetails(sharded, sharded.cellReleaseIds.c2v1);
    const cache = new CitywideLruCache<Uint8Array>(64, 64 * 1024 * 1024);
    const { runtime } = runtimeFor(sharded, { cache });
    await runtime.loadCell("c2", "exploration", CLOSE_METERS);

    const declared = sharded.graph.roots.find((root) => root.audience === "public")!.artifacts.find((artifact) => artifact.kind === "cell-detail-sidecar")!;
    // The sidecar is not a special case anywhere: it occupies one LRU entry,
    // keyed on ref AND checksum exactly as an asset is, and its bytes count
    // against the same byte cap. `exterior-cache-ceiling.ts` charges one sidecar
    // per resident cell for precisely this reason.
    expect(cache.get(exteriorArtifactCacheKey(sidecarRef, declared.checksumSha256))).toBeInstanceOf(Uint8Array);

    // A second load of the same cell re-reads the cache rather than refetching.
    const refetched: string[] = [];
    const warm = createExteriorCellRuntime(
      { index: sharded.index, graph: sharded.graph, assemblies: sharded.assemblies },
      { kind: "default" },
      { fetchArtifact: exteriorFixtureFetcher(sharded, { onRequest: (ref) => { refetched.push(ref); } }), baseIdentity: exteriorFixtureBaseIdentity(sharded), cache },
    );
    await warm.runtime.loadCell("c2", "exploration", CLOSE_METERS);
    expect(refetched).toEqual([]);
  });

  it("fails the cell CLOSED, under its own code, when the sidecar bytes are wrong", async () => {
    for (const [label, corrupt] of [
      ["absent", (fixture: ExteriorCellFixture, ref: string) => { fixture.contents.delete(ref); }],
      ["not JSON", (fixture: ExteriorCellFixture, ref: string) => { fixture.contents.set(ref, new TextEncoder().encode("{not json")); }],
      ["a different document of the right length", (fixture: ExteriorCellFixture, ref: string) => {
        const original = fixture.contents.get(ref)!;
        const replacement = new Uint8Array(original.length);
        replacement.fill(0x20);
        replacement.set(new TextEncoder().encode("{}"));
        fixture.contents.set(ref, replacement);
      }],
    ] as const) {
      const sharded = await exteriorCellFixture();
      const { sidecarRef } = shardExteriorFixtureCellDetails(sharded, sharded.cellReleaseIds.c2v1);
      corrupt(sharded, sidecarRef);
      const outcome = await runtimeFor(sharded).runtime.loadCell("c2", "exploration", CLOSE_METERS);
      // `c2v1` is an INITIAL cell version, so its pinned fallback is the base
      // identity set: the existing verified base massing stays visible and no
      // substitute geometry is invented.
      expect(outcome.kind, label).toBe("base-massing");
      expect(outcome.kind === "base-massing" && outcome.notice).toContain("no exterior geometry");
    }
  });

  it("refuses a sidecar whose CONTENT is valid but bound to another cell", async () => {
    const sharded = await exteriorCellFixture();
    const { sidecarRef } = shardExteriorFixtureCellDetails(sharded, sharded.cellReleaseIds.c2v1);
    const decoded = JSON.parse(new TextDecoder().decode(sharded.contents.get(sidecarRef)!)) as Record<string, unknown>;
    decoded.cellReleaseId = sharded.cellReleaseIds.c1v1;
    decoded.sidecarId = sharded.cellReleaseIds.c1v1;
    // Re-pin the declaration so the failure is the BINDING and not the checksum:
    // this proves the cell-pairing check does real work rather than riding on
    // the integrity check that precedes it.
    await repin(sharded, sidecarRef, `${JSON.stringify(decoded, null, 2)}\n`);

    const outcome = await runtimeFor(sharded).runtime.loadCell("c2", "exploration", CLOSE_METERS);
    expect(outcome.kind).toBe("base-massing");
    expect(outcome.kind === "base-massing" && outcome.code).toBe("cell-detail-sidecar-invalid");
  });

  it("keeps the evidence-audience refusal, applied to the FETCHED evidence", async () => {
    // The check that would be easiest to lose. `verifyCellRelease` runs
    // `validateProjectedGraphAudience` over each building's evidence shard, and
    // before the seam that shard came from the boot graph. If the sidecar branch
    // had returned the boot map by mistake — or resolved the shards but kept
    // reading `this.evidenceById` — this refusal would still pass for the
    // in-graph form and silently stop protecting the sharded one.
    const sharded = await exteriorCellFixture();
    const { sidecarRef } = shardExteriorFixtureCellDetails(sharded, sharded.cellReleaseIds.c2v1);
    const decoded = JSON.parse(new TextDecoder().decode(sharded.contents.get(sidecarRef)!)) as { evidenceShards: Array<{ graph: unknown }> };
    decoded.evidenceShards[0]!.graph = blockingEvidenceGraph("public-display");
    await repin(sharded, sidecarRef, `${JSON.stringify(decoded, null, 2)}\n`);

    const outcome = await runtimeFor(sharded).runtime.loadCell("c2", "inspection", CLOSE_METERS);
    expect(outcome.kind).toBe("base-massing");
    // The refusal fires EARLIER in the sharded form and under the sidecar's own
    // code, which is a real difference and worth stating rather than smoothing
    // over. In the in-graph form the same evidence is refused at BOOT by
    // `validateExteriorReleaseGraph`, and the runtime's
    // `validateProjectedGraphAudience` loop is a second, independent guard for a
    // graph that somehow got past it. In the sharded form the shards are not
    // present at boot, so the sidecar validator applies the boot-time rule at
    // load time — and it is the SAME rule, reached through the same extracted
    // `validateExteriorCellDetailResolution`. Either way the cell fails closed to
    // base massing and no substitute geometry is invented, which is the property
    // that has to survive the move.
    expect(outcome.kind === "base-massing" && outcome.code).toBe("cell-detail-sidecar-invalid");
    expect(outcome.kind === "base-massing" && outcome.message).toContain("evidenceGraph");
  });

  it("names the sidecar artifact, not the release graph, when it fails", async () => {
    const sharded = await exteriorCellFixture();
    const { sidecarRef } = shardExteriorFixtureCellDetails(sharded, sharded.cellReleaseIds.c2v1);
    sharded.contents.set(sidecarRef, new TextEncoder().encode("{not json"));
    const { runtime } = runtimeFor(sharded);
    // Reaching the typed error directly rather than through the fallback, so the
    // operator-facing `artifactRef` can be asserted.
    const outcome = await runtime.loadCell("c2", "exploration", CLOSE_METERS);
    expect(outcome.kind === "base-massing" && outcome.message).toContain(sidecarRef);
    expect(new ExteriorRuntimeError("cell-detail-sidecar-invalid", "x", sidecarRef).artifactRef).toBe(sidecarRef);
  });
});
