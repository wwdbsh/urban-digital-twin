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
  exteriorCellFixture,
  exteriorFixtureBaseIdentity,
  exteriorFixtureFetcher,
  shardExteriorFixtureCellAssembly,
  type ExteriorCellFixture,
} from "./exterior-cell-fixtures.ts";

const CLOSE_METERS = 180;

function rendered(outcome: ExteriorCellOutcome): ExteriorCellRenderPlan {
  if (outcome.kind !== "rendered") throw new Error(`expected a rendered cell, received ${outcome.kind}: ${JSON.stringify(outcome)}`);
  return outcome;
}

/**
 * Replace a package's bytes AND its root declaration, so a test asserts the
 * check it means to assert rather than riding on the checksum that precedes it.
 */
async function repin(fixture: ExteriorCellFixture, packageRef: string, content: string): Promise<void> {
  const bytes = new TextEncoder().encode(content);
  fixture.contents.set(packageRef, bytes);
  const declared = fixture.graph.roots.find((root) => root.audience === "public")!.artifacts.find((artifact) => artifact.relativeRef === packageRef)!;
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
 * The fail-closed outcome for these fixtures is `base-massing`, not `failed`:
 * `c2v1` is an INITIAL cell version, so its pinned fallback is the base identity
 * set. The existing verified base massing stays visible and no substitute
 * exterior geometry is invented — which is the behaviour under test, and it is
 * identical to the one the sidecar seam produces.
 */
async function failure(promise: Promise<ExteriorCellOutcome>): Promise<{ code: string; message: string }> {
  const outcome = await promise;
  if (outcome.kind !== "base-massing") throw new Error(`expected a base-massing fallback, received ${outcome.kind}: ${JSON.stringify(outcome)}`);
  expect(outcome.notice).toContain("no exterior geometry");
  return { code: outcome.code, message: outcome.message };
}

/**
 * The seam's load-bearing claim, tested as an EQUIVALENCE.
 *
 * A serving release moves each cell's assembly manifest out of `assemblies.json`
 * and into a fetched, checksum-pinned document, because at 2,567 B per shipped
 * asset the boot document reaches 115,499,836 B across the island and is fetched
 * whole before the first frame (ADR 0052 §2). The entire argument for being
 * allowed to do that is that nothing reaching the scene changes and nothing
 * verified is weakened.
 *
 * So these tests build ONE fixture, transform a copy into sharded form, and
 * compare the two. A list of properties could all pass while the rendered result
 * differed; an equivalence cannot.
 */
describe("per-cell assembly packages in the browser runtime", () => {
  it("renders identically to the in-assemblies.json form it was derived from", async () => {
    const inline = await exteriorCellFixture();
    const sharded = await exteriorCellFixture();
    shardExteriorFixtureCellAssembly(sharded, sharded.cellReleaseIds.c2v1);

    // The graph is still a valid release graph in sharded form: the new artifact
    // kind resolves to a decoded node, and nothing else moved.
    const shardedGraph = validateExteriorReleaseGraph(sharded.graph);
    expect(shardedGraph.ok, shardedGraph.ok ? "" : JSON.stringify(shardedGraph.issues, null, 2)).toBe(true);

    const inlinePlan = rendered(await runtimeFor(inline).runtime.loadCell("c2", "exploration", CLOSE_METERS));
    const shardedPlan = rendered(await runtimeFor(sharded).runtime.loadCell("c2", "exploration", CLOSE_METERS));

    // Everything the scene receives, compared in full: identity, provenance, the
    // selected LOD, the artifact ref, and the verified bytes themselves.
    expect(shardedPlan).toEqual(inlinePlan);
  });

  it("leaves every OTHER cell of the same release on the inline path", async () => {
    const inline = await exteriorCellFixture();
    const sharded = await exteriorCellFixture();
    shardExteriorFixtureCellAssembly(sharded, sharded.cellReleaseIds.c2v1);

    // The form is per cell. Sharding c2 must not disturb c1, which still
    // resolves out of `assemblies.json` exactly as it did.
    const inlineC1 = rendered(await runtimeFor(inline).runtime.loadCell("c1", "exploration", CLOSE_METERS));
    const shardedC1 = rendered(await runtimeFor(sharded).runtime.loadCell("c1", "exploration", CLOSE_METERS));
    expect(shardedC1).toEqual(inlineC1);
  });

  it("fetches exactly ONE extra artifact per cell, on the verified path", async () => {
    const inlineRefs: string[] = [];
    const shardedRefs: string[] = [];
    const inline = await exteriorCellFixture();
    const sharded = await exteriorCellFixture();
    const { packageRef } = shardExteriorFixtureCellAssembly(sharded, sharded.cellReleaseIds.c2v1);

    await runtimeFor(inline, { onRequest: (ref) => inlineRefs.push(ref) }).runtime.loadCell("c2", "exploration", CLOSE_METERS);
    await runtimeFor(sharded, { onRequest: (ref) => shardedRefs.push(ref) }).runtime.loadCell("c2", "exploration", CLOSE_METERS);

    expect(shardedRefs.filter((ref) => ref === packageRef)).toHaveLength(1);
    expect(shardedRefs.filter((ref) => ref !== packageRef).sort()).toEqual([...inlineRefs].sort());
  });

  it("caches the package under the same declaration-keyed entry every GLB uses", async () => {
    const sharded = await exteriorCellFixture();
    const { packageRef } = shardExteriorFixtureCellAssembly(sharded, sharded.cellReleaseIds.c2v1);
    const cache = new CitywideLruCache<Uint8Array>(64, 64 * 1024 * 1024);
    const { runtime } = runtimeFor(sharded, { cache });
    await runtime.loadCell("c2", "exploration", CLOSE_METERS);

    const declared = sharded.graph.roots.find((root) => root.audience === "public")!.artifacts.find((artifact) => artifact.kind === "cell-assembly-package")!;
    // Not a special case anywhere: one LRU entry keyed on ref AND checksum,
    // bytes counted against the same cap. `exterior-serving-residency.ts`
    // charges one package per resident cell for precisely this reason.
    expect(cache.get(exteriorArtifactCacheKey(packageRef, declared.checksumSha256))).toBeInstanceOf(Uint8Array);
  });

  describe("fails closed, at cell-load time rather than at construction", () => {
    it("refuses a package whose bytes do not match the pinned checksum", async () => {
      const sharded = await exteriorCellFixture();
      const { packageRef } = shardExteriorFixtureCellAssembly(sharded, sharded.cellReleaseIds.c2v1);
      // A different document of the RIGHT LENGTH, declaration NOT re-pinned, so
      // the byte-size gate cannot be what refuses it and the SHA-256 has to do
      // the work. Both gates run before a byte is parsed.
      const original = sharded.contents.get(packageRef)!;
      const replacement = new Uint8Array(original.length);
      replacement.fill(0x20);
      replacement.set(new TextEncoder().encode("{}"));
      sharded.contents.set(packageRef, replacement);
      const result = await failure(runtimeFor(sharded).runtime.loadCell("c2", "exploration", CLOSE_METERS));
      expect(result.code).toBe("checksum-mismatch");
    });

    it("refuses a package that is not parseable JSON", async () => {
      const sharded = await exteriorCellFixture();
      const { packageRef } = shardExteriorFixtureCellAssembly(sharded, sharded.cellReleaseIds.c2v1);
      await repin(sharded, packageRef, "{not json");
      const result = await failure(runtimeFor(sharded).runtime.loadCell("c2", "exploration", CLOSE_METERS));
      expect(result.code).toBe("cell-assembly-package-invalid");
      expect(result.message).toContain(packageRef);
    });

    it("refuses a structurally invalid package with its own code, not the boot code", async () => {
      const sharded = await exteriorCellFixture();
      const { packageRef } = shardExteriorFixtureCellAssembly(sharded, sharded.cellReleaseIds.c2v1);
      await repin(sharded, packageRef, `${JSON.stringify({ schemaVersion: "1.0", packageId: "assembly:bogus" }, null, 2)}\n`);
      const result = await failure(runtimeFor(sharded).runtime.loadCell("c2", "exploration", CLOSE_METERS));
      // `assembly-invalid` is the BOOT refusal of an inline package; this is a
      // different artifact and gets a code that points an operator at it.
      expect(result.code).toBe("cell-assembly-package-invalid");
    });

    it("refuses a well-formed package that binds a different cell release", async () => {
      const sharded = await exteriorCellFixture();
      const { packageRef } = shardExteriorFixtureCellAssembly(sharded, sharded.cellReleaseIds.c2v1);
      // A conforming manifest, correctly checksummed, declared under c2 — but it
      // is c1's package. The cell-release pin is what refuses it, and it is the
      // same pin the inline form applies.
      const c1 = sharded.assemblies.find((entry) => entry.cells.some((cell) => cell.cellId === "c1"))!;
      await repin(sharded, packageRef, `${JSON.stringify(c1, null, 2)}\n`);
      const result = await failure(runtimeFor(sharded).runtime.loadCell("c2", "exploration", CLOSE_METERS));
      expect(result.code).toBe("assembly-pin-mismatch");
      expect(result.message).toContain("packages no such cell");
    });

    it("refuses a package the active head does not list", async () => {
      const sharded = await exteriorCellFixture();
      shardExteriorFixtureCellAssembly(sharded, sharded.cellReleaseIds.c2v1);
      // The head pin remains the single statement of what this release serves,
      // in the sharded form exactly as in the inline one.
      sharded.index.defaultHead.assemblyPackageIds = sharded.index.defaultHead.assemblyPackageIds.filter((id) => !id.includes("c2"));
      const result = await failure(runtimeFor(sharded).runtime.loadCell("c2", "exploration", CLOSE_METERS));
      expect(result.code).toBe("assembly-pin-mismatch");
      expect(result.message).toContain("not listed by head");
    });

    it("boots even though a sharded package is broken, which is the stated timing change", async () => {
      const sharded = await exteriorCellFixture();
      const { packageRef } = shardExteriorFixtureCellAssembly(sharded, sharded.cellReleaseIds.c2v1);
      await repin(sharded, packageRef, "{not json");
      // ADR 0052 §2 states this in the open: a release whose Nth cell carries a
      // malformed manifest now CONSTRUCTS and serves its other cells, where the
      // inline form refused to construct at all. The blast radius is one cell.
      const { runtime } = runtimeFor(sharded);
      expect(rendered(await runtime.loadCell("c1", "exploration", CLOSE_METERS)).cellId).toBe("c1");
      expect((await failure(runtime.loadCell("c2", "exploration", CLOSE_METERS))).code).toBe("cell-assembly-package-invalid");
    });

    it("still refuses an INLINE package at construction, unchanged", async () => {
      const inline = await exteriorCellFixture();
      inline.assemblies[0] = { ...inline.assemblies[0]!, audience: "private" } as typeof inline.assemblies[0];
      // The inline path keeps its boot-time refusal: this seam is additive and
      // changes nothing for a release that does not use it.
      expect(() => runtimeFor(inline)).toThrow(ExteriorRuntimeError);
    });
  });
});
