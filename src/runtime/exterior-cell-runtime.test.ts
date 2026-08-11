import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateExteriorReleaseGraph } from "../release/exterior-release.ts";
import { validateMultiLodAssembly } from "../release/multi-lod-assembly.ts";
import { CitywideLruCache } from "../release/citywide-release.ts";
import { AggregateRequestBudget } from "./composed-release-runtime.ts";
import {
  ExteriorCellRuntime,
  ExteriorRuntimeError,
  assertPublicExteriorArtifactRef,
  createExteriorCellRuntime,
  loadExteriorCellRuntime,
  resolveExteriorHead,
  validateExteriorCellReleaseIndex,
  type ExteriorCellOutcome,
  type ExteriorCellRenderPlan,
  type ExteriorHeadRequest,
} from "./exterior-cell-runtime.ts";
import {
  EXTERIOR_FIXTURE_BASE_RELEASE_ID,
  blockingEvidenceGraph,
  buildFixtureGlb,
  corruptExteriorFixturePackage,
  exteriorCellFixture,
  exteriorFixtureBaseIdentity,
  exteriorCellFixtureReleaseFiles,
  exteriorFixtureFetcher,
  replaceExteriorFixtureGlb,
  type ExteriorCellFixture,
} from "./exterior-cell-fixtures.ts";

const CLOSE_METERS = 180;
const FAR_METERS = 600;

function rendered(outcome: ExteriorCellOutcome): ExteriorCellRenderPlan {
  if (outcome.kind !== "rendered") throw new Error(`expected a rendered cell, received ${outcome.kind}: ${JSON.stringify(outcome)}`);
  return outcome;
}

async function runtimeFor(
  fixture: ExteriorCellFixture,
  overrides: {
    request?: ExteriorHeadRequest;
    baseIdentityHas?: (featureId: string) => boolean;
    onRequest?: (relativeRef: string) => Promise<void> | void;
    cache?: CitywideLruCache<Uint8Array>;
    sharedBudget?: AggregateRequestBudget;
  } = {},
) {
  const identity = exteriorFixtureBaseIdentity(fixture);
  return createExteriorCellRuntime(
    { index: fixture.index, graph: fixture.graph, assemblies: fixture.assemblies },
    overrides.request ?? { kind: "default" },
    {
      fetchArtifact: exteriorFixtureFetcher(fixture, { onRequest: overrides.onRequest }),
      baseIdentity: overrides.baseIdentityHas ? { releaseId: identity.releaseId, has: overrides.baseIdentityHas } : identity,
      cache: overrides.cache,
      sharedBudget: overrides.sharedBudget,
    },
  );
}

describe("exterior cell fixture graph", () => {
  it("is a valid public exterior release graph with valid assembly packages", async () => {
    const fixture = await exteriorCellFixture();
    const graph = validateExteriorReleaseGraph(fixture.graph);
    expect(graph.ok, graph.ok ? "" : JSON.stringify(graph.issues, null, 2)).toBe(true);
    for (const assembly of fixture.assemblies) {
      const result = validateMultiLodAssembly(assembly);
      expect(result.ok, result.ok ? "" : `${assembly.packageId}: ${JSON.stringify(result.issues, null, 2)}`).toBe(true);
    }
    expect(validateExteriorCellReleaseIndex(fixture.index).ok).toBe(true);
  });

  it("rejects an index that is not public-audience, not local-only, or names a canary that aliases the default", async () => {
    const fixture = await exteriorCellFixture();
    for (const mutate of [
      (index: Record<string, unknown>) => { index.audience = "private"; },
      (index: Record<string, unknown>) => { index.localOnly = false; },
      (index: Record<string, unknown>) => { index.runtimeExternalNetwork = true; },
      (index: Record<string, unknown>) => { (index.canaryHeads as unknown[]) = [structuredClone(index.defaultHead)]; },
    ]) {
      const mutated = structuredClone(fixture.index) as unknown as Record<string, unknown>;
      mutate(mutated);
      expect(validateExteriorCellReleaseIndex(mutated).ok).toBe(false);
    }
  });
});

describe("exterior cell runtime profiles", () => {
  it("preserves canonical identity, provenance, and release origin across a profile change", async () => {
    const fixture = await exteriorCellFixture();
    const { runtime } = await runtimeFor(fixture);
    const exploration = rendered(await runtime.loadCell("c1", "exploration", CLOSE_METERS));
    const inspection = rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS));

    const stable = (plan: ExteriorCellRenderPlan) => ({
      cellId: plan.cellId,
      cellReleaseId: plan.cellReleaseId,
      cellReleaseVersion: plan.cellReleaseVersion,
      assemblyPackageId: plan.assemblyPackageId,
      representation: plan.representation,
      notice: plan.notice,
      assets: plan.assets.map((asset) => ({
        canonicalFeatureId: asset.canonicalFeatureId,
        ownerCellId: asset.ownerCellId,
        provenance: asset.provenance,
      })),
    });
    expect(stable(exploration)).toEqual(stable(inspection));
    expect(runtime.origin).toBe("default");
    expect(runtime.snapshot.snapshotId).toBe(fixture.snapshotIds.v2);

    // Only the selected representation differs.
    expect(inspection.assets[0]!.lodId).toBe("lod-0");
    expect(exploration.assets[0]!.lodId).toBe("lod-1");
    expect(inspection.assets[0]!.checksumSha256).not.toBe(exploration.assets[0]!.checksumSha256);
    expect(inspection.assets[0]!.geometricErrorMeters).toBe(0);
    expect(exploration.assets[0]!.geometricErrorMeters).toBe(2);
  });

  it("converges on the only covering LOD beyond the finest declared distance", async () => {
    const fixture = await exteriorCellFixture();
    const { runtime } = await runtimeFor(fixture);
    const exploration = rendered(await runtime.loadCell("c1", "exploration", FAR_METERS));
    const inspection = rendered(await runtime.loadCell("c1", "inspection", FAR_METERS));
    expect(exploration.assets[0]!.lodId).toBe("lod-1");
    expect(inspection.assets[0]!.lodId).toBe("lod-1");
  });

  it("hands back verified bytes rather than a path so nothing is refetched for rendering", async () => {
    const fixture = await exteriorCellFixture();
    const requests: string[] = [];
    const { runtime } = await runtimeFor(fixture, { onRequest: (ref) => { requests.push(ref); } });
    const first = rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS));
    const second = rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS));
    expect(first.assets[0]!.bytes.byteLength).toBe(first.assets[0]!.byteSize);
    expect(second.assets[0]!.bytes).toBe(first.assets[0]!.bytes);
    expect(requests).toHaveLength(1);
    const metrics = runtime.getMetrics();
    expect(metrics.cacheEntries).toBe(1);
    expect(metrics.cachedBytes).toBe(first.assets[0]!.byteSize);
    expect(metrics.loadedArtifactCount).toBe(1);
  });
});

describe("exterior canary and default head selection", () => {
  it("uses the operator-pinned default head and never a canary by default", async () => {
    const fixture = await exteriorCellFixture();
    const { runtime, head } = await runtimeFor(fixture);
    expect(head.origin).toBe("default");
    expect(head.notice).toBeNull();
    expect(runtime.snapshot.snapshotId).toBe(fixture.snapshotIds.v2);
    expect(rendered(await runtime.loadCell("c2", "inspection", CLOSE_METERS)).cellReleaseId).toBe(fixture.cellReleaseIds.c2v1);
  });

  it("resolves an explicitly pinned canary and flags its origin", async () => {
    const fixture = await exteriorCellFixture();
    const { runtime, head } = await runtimeFor(fixture, { request: { kind: "canary", snapshotId: fixture.snapshotIds.v3 } });
    expect(head.origin).toBe("canary");
    expect(head.notice).toBeNull();
    expect(runtime.origin).toBe("canary");
    expect(runtime.snapshot.snapshotId).toBe(fixture.snapshotIds.v3);
    expect(rendered(await runtime.loadCell("c2", "inspection", CLOSE_METERS)).cellReleaseId).toBe(fixture.cellReleaseIds.c2v2);
  });

  it("falls back to the pinned default with an explicit notice when a shared canary link is unknown here", async () => {
    const fixture = await exteriorCellFixture();
    const resolution = resolveExteriorHead(fixture.index, { kind: "canary", snapshotId: "snapshot:not-pinned-here" });
    expect(resolution.origin).toBe("default");
    expect(resolution.pin.snapshotId).toBe(fixture.snapshotIds.v2);
    expect(resolution.notice).toContain("snapshot:not-pinned-here");
    expect(resolution.notice).toContain(fixture.snapshotIds.v2);
    const { runtime } = await runtimeFor(fixture, { request: { kind: "canary", snapshotId: "snapshot:not-pinned-here" } });
    expect(runtime.origin).toBe("default");
    expect(runtime.snapshot.snapshotId).toBe(fixture.snapshotIds.v2);
  });
});

describe("exterior fail-closed fallback", () => {
  it("renders the checksum-pinned predecessor when a versioned cell fails verification", async () => {
    const fixture = await exteriorCellFixture();
    corruptExteriorFixturePackage(fixture, fixture.assemblyPackageIds.c1v2);
    const { runtime } = await runtimeFor(fixture);
    const outcome = rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS));
    expect(outcome.representation).toBe("predecessor");
    expect(outcome.cellReleaseId).toBe(fixture.cellReleaseIds.c1v1);
    expect(outcome.assemblyPackageId).toBe(fixture.assemblyPackageIds.c1v1);
    expect(outcome.notice).toContain(fixture.cellReleaseIds.c1v1);
    expect(runtime.getMetrics().fallbackCellCount).toBe(1);
  });

  it("isolates a cell whose head and pinned predecessor both fail, never substituting another cell", async () => {
    const fixture = await exteriorCellFixture();
    corruptExteriorFixturePackage(fixture, fixture.assemblyPackageIds.c1v2);
    corruptExteriorFixturePackage(fixture, fixture.assemblyPackageIds.c1v1);
    const { runtime } = await runtimeFor(fixture);
    const failed = await runtime.loadCell("c1", "inspection", CLOSE_METERS);
    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed") throw new Error("expected an isolated failure");
    expect(failed.code).toBe("checksum-mismatch");
    expect(failed.notice).toContain("no exterior geometry is shown");
    // The sibling cell is untouched: failure is per-cell, never global.
    expect(rendered(await runtime.loadCell("c2", "inspection", CLOSE_METERS)).cellReleaseId).toBe(fixture.cellReleaseIds.c2v1);
    expect(runtime.getMetrics().failedCellCount).toBe(1);
  });

  it("keeps the verified base massing when an initial-version cell fails to its pinned base", async () => {
    const fixture = await exteriorCellFixture();
    corruptExteriorFixturePackage(fixture, fixture.assemblyPackageIds.c2v1);
    const { runtime } = await runtimeFor(fixture);
    const outcome = await runtime.loadCell("c2", "inspection", CLOSE_METERS);
    expect(outcome.kind).toBe("base-massing");
    if (outcome.kind !== "base-massing") throw new Error("expected a pinned-base fallback");
    expect(outcome.code).toBe("checksum-mismatch");
    expect(outcome.notice).toContain("carries no exterior geometry");
    expect(outcome.notice).toContain("base massing");
  });

  it("never follows more than one fallback hop", async () => {
    const fixture = await exteriorCellFixture();
    // Canary head renders c2:v2, whose pinned predecessor is c2:v1. Corrupting
    // both must not walk on to c2:v1's own pinned-base fallback.
    corruptExteriorFixturePackage(fixture, fixture.assemblyPackageIds.c2v2);
    corruptExteriorFixturePackage(fixture, fixture.assemblyPackageIds.c2v1);
    const { runtime } = await runtimeFor(fixture, { request: { kind: "canary", snapshotId: fixture.snapshotIds.v3 } });
    const outcome = await runtime.loadCell("c2", "inspection", CLOSE_METERS);
    expect(outcome.kind).toBe("failed");
  });
});

describe("exterior public-root and per-artifact admission", () => {
  it("refuses a private or unsafe artifact reference before any fetch", async () => {
    expect(() => assertPublicExteriorArtifactRef("private/assets/a.glb")).toThrow(ExteriorRuntimeError);
    expect(() => assertPublicExteriorArtifactRef("public/../private/a.glb")).toThrow(ExteriorRuntimeError);
    expect(() => assertPublicExteriorArtifactRef("public/assets/%2e%2e/a.glb")).toThrow(ExteriorRuntimeError);
    expect(() => assertPublicExteriorArtifactRef("/public/a.glb")).toThrow(ExteriorRuntimeError);
    expect(() => assertPublicExteriorArtifactRef("public/private-notes/a.glb")).toThrow(/public audience root/u);
    expect(assertPublicExteriorArtifactRef("public/assemblies/x/assets/a.glb")).toBe("public/assemblies/x/assets/a.glb");

    const fixture = await exteriorCellFixture();
    const assembly = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c1v2)!;
    const glb = assembly.artifacts.find((entry) => entry.role === "glb")!;
    glb.relativeRef = "private/assets/leaked.glb";
    assembly.assets[0]!.lods[0]!.artifactRef = "private/assets/leaked.glb";
    const requests: string[] = [];
    expect(() => createExteriorCellRuntime(
      { index: fixture.index, graph: fixture.graph, assemblies: fixture.assemblies },
      { kind: "default" },
      { fetchArtifact: exteriorFixtureFetcher(fixture, { onRequest: (ref) => { requests.push(ref); } }), baseIdentity: exteriorFixtureBaseIdentity(fixture) },
    )).toThrow(/failed closed/u);
    expect(requests).toEqual([]);
  });

  it("rejects a GLB whose bytes fail the declared checksum", async () => {
    const fixture = await exteriorCellFixture();
    const assembly = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c2v1)!;
    const artifact = assembly.artifacts.find((entry) => entry.role === "glb")!;
    artifact.checksumSha256 = "f".repeat(64);
    const { runtime } = await runtimeFor(fixture);
    const outcome = await runtime.loadCell("c2", "inspection", CLOSE_METERS);
    expect(outcome.kind).toBe("base-massing");
    if (outcome.kind !== "base-massing") throw new Error("expected fail-closed");
    expect(outcome.code).toBe("checksum-mismatch");
    expect(runtime.getMetrics().failedArtifactCount).toBeGreaterThan(0);
  });

  it("rejects a public GLB that embeds imagery even when no material references it", async () => {
    const fixture = await exteriorCellFixture();
    const assembly = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c2v1)!;
    const asset = assembly.assets[0]!;
    const smuggled = buildFixtureGlb({
      canonicalFeatureId: asset.canonicalFeatureId,
      ownerCellId: asset.ownerCellId,
      inventoryId: asset.inventoryId,
      inventoryHashSha256: asset.inventoryHashSha256,
      evidenceShardId: asset.evidenceShardId,
      truthTiers: [...asset.truthTiers],
      sourceDates: { ...asset.sourceDates },
      predecessor: asset.predecessor,
      uncertainty: asset.uncertainty,
      lodId: "lod-0",
      planHashSha256: asset.source.kind === "facade-plan" ? asset.source.planHashSha256 : "",
    }, (json) => {
      (json.bufferViews as Array<Record<string, unknown>>).push({ buffer: 0, byteOffset: 0, byteLength: 4 });
      json.images = [{ bufferView: 2, mimeType: "image/png" }];
      json.textures = [{ source: 0 }];
    });
    await replaceExteriorFixtureGlb(fixture, fixture.assemblyPackageIds.c2v1, "lod-0", smuggled);
    const { runtime } = await runtimeFor(fixture);
    const outcome = await runtime.loadCell("c2", "inspection", CLOSE_METERS);
    expect(outcome.kind).toBe("base-massing");
    if (outcome.kind !== "base-massing") throw new Error("expected fail-closed");
    expect(outcome.code).toBe("glb-invalid");
    expect(outcome.message).toContain("embedded-image-gate");
  });

  it("rejects a package that declares a texture for the public audience", async () => {
    const fixture = await exteriorCellFixture();
    const assembly = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c1v2)!;
    assembly.assets[0]!.lods[0]!.quality = { triangleCount: 1, materialCount: 1, textureCount: 1, budgets: { maxTriangles: 2, maxMaterials: 1, maxTextures: 1 } };
    expect(() => createExteriorCellRuntime(
      { index: fixture.index, graph: fixture.graph, assemblies: fixture.assemblies },
      { kind: "default" },
      { fetchArtifact: exteriorFixtureFetcher(fixture), baseIdentity: exteriorFixtureBaseIdentity(fixture) },
    )).toThrow(/declared-texture-forbidden/u);
  });

  it("fails closed when an exterior canonical feature is not in the active base identity set", async () => {
    const fixture = await exteriorCellFixture();
    const { runtime } = await runtimeFor(fixture, { baseIdentityHas: (id) => id === fixture.buildingIds.c2 });
    const outcome = await runtime.loadCell("c1", "inspection", CLOSE_METERS);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("expected base incompatibility");
    expect(outcome.code).toBe("base-incompatible");
    expect(runtime.compatibleWith(EXTERIOR_FIXTURE_BASE_RELEASE_ID)).toBe(true);
    expect(runtime.compatibleWith("manhattan-esb-block-exterior-pilot-20260805")).toBe(false);
    expect(runtime.compatibleWith(null)).toBe(false);
  });

  it("rejects a valid-but-different assembly package offered for a valid snapshot", async () => {
    const fixture = await exteriorCellFixture();
    // A structurally valid package that pins the wrong cell release, relabeled
    // with the head's expected package ID.
    const impostor = structuredClone(fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c2v1)!);
    impostor.packageId = fixture.assemblyPackageIds.c1v2;
    const assemblies = fixture.assemblies.filter((entry) => entry.packageId !== fixture.assemblyPackageIds.c1v2 && entry.packageId !== fixture.assemblyPackageIds.c1v1);
    const { runtime } = createExteriorCellRuntime(
      { index: fixture.index, graph: fixture.graph, assemblies: [...assemblies, impostor] },
      { kind: "default" },
      { fetchArtifact: exteriorFixtureFetcher(fixture), baseIdentity: exteriorFixtureBaseIdentity(fixture) },
    );
    const outcome = await runtime.loadCell("c1", "inspection", CLOSE_METERS);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("expected an assembly pin rejection");
    expect(outcome.message).toContain("No assembly package binds cell release");
  });

  it("refuses evidence whose projected approval exclusions forbid public conveyance", async () => {
    const fixture = await exteriorCellFixture();
    const graph = structuredClone(fixture.graph);
    graph.evidenceShards.find((shard) => shard.shardId === "evidence:b2:v1")!.graph = blockingEvidenceGraph("public-display");
    const runtime = new ExteriorCellRuntime(
      { index: fixture.index, graph, assemblies: fixture.assemblies },
      resolveExteriorHead(fixture.index, { kind: "default" }),
      { fetchArtifact: exteriorFixtureFetcher(fixture), baseIdentity: exteriorFixtureBaseIdentity(fixture) },
    );
    const outcome = await runtime.loadCell("c2", "inspection", CLOSE_METERS);
    expect(outcome.kind).toBe("base-massing");
    if (outcome.kind !== "base-massing") throw new Error("expected the audience guard to fail closed");
    expect(outcome.code).toBe("evidence-audience-forbidden");
  });
});

describe("exterior request and cache budgets", () => {
  it("fails a single artifact closed when it cannot fit the exterior cache budget, without fetching it", async () => {
    const fixture = await exteriorCellFixture();
    const requests: string[] = [];
    const { runtime } = await runtimeFor(fixture, { cache: new CitywideLruCache<Uint8Array>(4, 16), onRequest: (ref) => { requests.push(ref); } });
    const outcome = await runtime.loadCell("c2", "inspection", CLOSE_METERS);
    expect(outcome.kind).toBe("base-massing");
    if (outcome.kind !== "base-massing") throw new Error("expected the budget guard to fail closed");
    expect(outcome.code).toBe("artifact-exceeds-cache-budget");
    expect(requests).toEqual([]);
  });

  it("retains verified bytes within the declared entry and byte ceilings", async () => {
    const fixture = await exteriorCellFixture();
    const { runtime } = await runtimeFor(fixture);
    await runtime.loadCell("c1", "inspection", CLOSE_METERS);
    await runtime.loadCell("c1", "exploration", CLOSE_METERS);
    await runtime.loadCell("c2", "inspection", CLOSE_METERS);
    const metrics = runtime.getMetrics();
    expect(metrics.maxCacheEntries).toBe(256);
    expect(metrics.maxCachedBytes).toBe(256 * 1024 * 1024);
    expect(metrics.cacheEntries).toBe(3);
    expect(metrics.cachedBytes).toBeLessThanOrEqual(metrics.maxCachedBytes);
    expect(metrics.requestedArtifactCount).toBe(3);
    expect(metrics.loadedArtifactCount).toBe(3);
  });

  it("never exceeds the app-wide shared concurrency ceiling under aggregate load", async () => {
    const fixture = await exteriorCellFixture();
    const budget = new AggregateRequestBudget();
    let inFlight = 0;
    let observedPeak = 0;
    const gate = async () => {
      inFlight += 1;
      observedPeak = Math.max(observedPeak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    };
    // Simulate a concurrent citywide/civic wave sharing the same budget.
    const citywide = Array.from({ length: 8 }, async () => {
      const release = await budget.acquire();
      try { await gate(); } finally { release(); }
    });
    const { runtime } = await runtimeFor(fixture, { sharedBudget: budget, onRequest: gate });
    const exterior = [
      runtime.loadCell("c1", "inspection", CLOSE_METERS),
      runtime.loadCell("c1", "exploration", CLOSE_METERS),
      runtime.loadCell("c2", "inspection", CLOSE_METERS),
      runtime.loadCell("c2", "exploration", CLOSE_METERS),
    ];
    await Promise.all([...citywide, ...exterior]);
    expect(budget.maxConcurrent).toBe(4);
    expect(budget.peakConcurrency()).toBeLessThanOrEqual(4);
    expect(observedPeak).toBeLessThanOrEqual(4);
    expect(runtime.getMetrics().maxConcurrentRequests).toBe(4);
    expect(runtime.getMetrics().peakConcurrentRequests).toBeLessThanOrEqual(4);
  });
});

describe("exterior local-only loader", () => {
  it("reads only same-origin paths under the approved local release root", async () => {
    const fixture = await exteriorCellFixture();
    const seen: string[] = [];
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      seen.push(url);
      const relative = url.replace("/data/udt-fixture-exterior-cells/", "");
      if (relative === "index.json") return new Response(JSON.stringify(fixture.index));
      if (relative === "release-graph.json") return new Response(JSON.stringify(fixture.graph));
      if (relative === "assemblies.json") return new Response(JSON.stringify(fixture.assemblies));
      const bytes = fixture.contents.get(relative);
      if (!bytes) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(bytes));
    };
    const { runtime } = await loadExteriorCellRuntime("/data/udt-fixture-exterior-cells/", {
      fetcher,
      baseIdentity: exteriorFixtureBaseIdentity(fixture),
    });
    expect(rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS)).cellReleaseId).toBe(fixture.cellReleaseIds.c1v2);
    expect(seen.every((url) => url.startsWith("/data/udt-fixture-exterior-cells/"))).toBe(true);
    expect(seen.some((url) => url.includes("private"))).toBe(false);

    await expect(loadExteriorCellRuntime("https://example.invalid/data/x/", { fetcher, baseIdentity: exteriorFixtureBaseIdentity(fixture) })).rejects.toThrow(/approved local release root/u);
    await expect(loadExteriorCellRuntime("/data/../assets/", { fetcher, baseIdentity: exteriorFixtureBaseIdentity(fixture) })).rejects.toThrow(/approved local release root/u);
  });
});

describe("exterior assembly admission and cache keying", () => {
  it("keeps the default head working when a canary-only package is invalid", async () => {
    const fixture = await exteriorCellFixture();
    // c2:v2 is pinned only by the canary head; corrupting it must not disable
    // the operator-pinned default head.
    const canaryOnly = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c2v2)!;
    canaryOnly.assets[0]!.lods[0]!.quality = { triangleCount: 1, materialCount: 1, textureCount: 1, budgets: { maxTriangles: 2, maxMaterials: 1, maxTextures: 1 } };

    const { runtime } = await runtimeFor(fixture);
    expect(rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS)).cellReleaseId).toBe(fixture.cellReleaseIds.c1v2);
    expect(rendered(await runtime.loadCell("c2", "inspection", CLOSE_METERS)).cellReleaseId).toBe(fixture.cellReleaseIds.c2v1);
    expect(runtime.droppedAssemblyPackages.map((entry) => entry.packageId)).toContain(fixture.assemblyPackageIds.c2v2);
    expect(runtime.droppedAssemblyPackages.find((entry) => entry.packageId === fixture.assemblyPackageIds.c2v2)?.reason).toContain("structurally invalid");

    // The same corruption inside a head-pinned package still fails closed.
    await expect(runtimeFor(fixture, { request: { kind: "canary", snapshotId: fixture.snapshotIds.v3 } })).rejects.toThrow(/pinned by head/u);
  });

  it("records packages the active head does not pin instead of using them", async () => {
    const fixture = await exteriorCellFixture();
    const { runtime } = await runtimeFor(fixture);
    expect(runtime.droppedAssemblyPackages).toEqual([{ packageId: fixture.assemblyPackageIds.c2v2, reason: `not listed by head ${fixture.snapshotIds.v2}` }]);
  });

  it("treats two packages binding the same cell release as ambiguous, not first-match-wins", async () => {
    const fixture = await exteriorCellFixture();
    const duplicate = structuredClone(fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c1v2)!);
    const { runtime } = createExteriorCellRuntime(
      { index: fixture.index, graph: fixture.graph, assemblies: [...fixture.assemblies, duplicate] },
      { kind: "default" },
      { fetchArtifact: exteriorFixtureFetcher(fixture), baseIdentity: exteriorFixtureBaseIdentity(fixture) },
    );
    const outcome = await runtime.loadCell("c1", "inspection", CLOSE_METERS);
    // The head fails ambiguously; its pinned predecessor is unambiguous and renders.
    expect(rendered(outcome).representation).toBe("predecessor");
    expect(rendered(outcome).notice).toContain("assembly-pin-mismatch");
  });

  it("verifies each declaration independently when one path is pinned to two checksums", async () => {
    const fixture = await exteriorCellFixture();
    const c1 = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c1v2)!;
    const c2 = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c2v1)!;
    const shared = c1.artifacts.find((entry) => entry.role === "glb" && entry.relativeRef === c1.assets[0]!.lods[0]!.artifactRef)!;

    // c2's finest LOD is re-pointed at c1's path but keeps its own checksum, so
    // a path-only cache would cross-serve bytes verified against a different pin.
    const c2Lod = c2.assets[0]!.lods[0]!;
    const c2Artifact = c2.artifacts.find((entry) => entry.relativeRef === c2Lod.artifactRef)!;
    const c2Checksum = c2Artifact.checksumSha256;
    c2Artifact.relativeRef = shared.relativeRef;
    c2Lod.artifactRef = shared.relativeRef;
    // Match the declared size so the byte-size guard passes and the checksum
    // guard is the one that must fire on the second, differently-pinned load.
    c2Artifact.byteSize = shared.byteSize;
    c2Artifact.checksumSha256 = c2Checksum;
    c2.declaredTotalBytes = c2.artifacts.reduce((sum, entry) => sum + entry.byteSize, 0);

    const { runtime } = await runtimeFor(fixture);
    expect(rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS)).assets[0]!.checksumSha256).toBe(shared.checksumSha256);
    const crossServed = await runtime.loadCell("c2", "inspection", CLOSE_METERS);
    expect(crossServed.kind).toBe("base-massing");
    if (crossServed.kind !== "base-massing") throw new Error("expected independent verification");
    expect(crossServed.code).toBe("checksum-mismatch");
  });
});

describe("emitted local exterior fixture release", () => {
  const ROOT = "public/data/udt-fixture-exterior-cells";
  const emittedPaths = (): string[] => readdirSync(ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => (entry.parentPath === ROOT ? entry.name : `${entry.parentPath.slice(ROOT.length + 1)}/${entry.name}`))
    .sort();

  it("matches the deterministic generator byte for byte and contains no private artifact", async () => {
    const expected = exteriorCellFixtureReleaseFiles(await exteriorCellFixture());
    const emitted = emittedPaths();
    expect(emitted, "run `pnpm exterior-cells:emit-fixture` to regenerate").toEqual([...expected.keys()].sort());
    expect(emitted.some((path) => path === "private" || path.startsWith("private/") || path.includes("/private/"))).toBe(false);
    for (const [path, bytes] of expected) {
      expect(new Uint8Array(readFileSync(`${ROOT}/${path}`)), path).toEqual(bytes);
    }
  });

  it("pins the base releases the app actually loads and names an obviously synthetic release", () => {
    const index: unknown = JSON.parse(new TextDecoder().decode(readFileSync(`${ROOT}/index.json`)));
    const validated = validateExteriorCellReleaseIndex(index);
    expect(validated.ok, validated.ok ? "" : JSON.stringify(validated.issues)).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.releaseId).toBe("udt-fixture-exterior-cells");
    expect(validated.value.baseCompatibility.baseReleaseIds).toEqual(["manhattan-citywide-20260804", "manhattan-civic-context-20260804"]);
    expect(validated.value.localOnly).toBe(true);
    expect(validated.value.runtimeExternalNetwork).toBe(false);
    expect(validated.value.canaryHeads).toHaveLength(1);
  });

  it("loads end to end from the emitted release through the same-origin local loader", async () => {
    const seen: string[] = [];
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      seen.push(url);
      const path = url.replace("/data/udt-fixture-exterior-cells/", "");
      try {
        return new Response(new Uint8Array(readFileSync(`${ROOT}/${path}`)));
      } catch {
        return new Response(null, { status: 404 });
      }
    };
    const { runtime } = await loadExteriorCellRuntime("/data/udt-fixture-exterior-cells/", {
      fetcher,
      baseIdentity: { releaseId: "manhattan-citywide-20260804", has: () => true },
    });
    expect(runtime.compatibleWith("manhattan-citywide-20260804")).toBe(true);
    expect(runtime.compatibleWith("manhattan-civic-context-20260804")).toBe(true);
    const plan = rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS));
    expect(plan.assets[0]!.canonicalFeatureId).toBe("doitt:778052");
    expect(seen.every((url) => url.startsWith("/data/udt-fixture-exterior-cells/"))).toBe(true);
    expect(seen.some((url) => url.includes("private"))).toBe(false);
  });
});

/**
 * Bounded availability (ADR 0029). A release may deliberately ship cells that
 * carry no exterior geometry. Those must never be reported as verification
 * failures, and a genuine failure must keep its alarming path unchanged.
 */
describe("exterior bounded availability", () => {
  /** Tombstones cell `c2` in place: every detail unavailable, orphan shards removed. */
  function tombstoneC2(fixture: ExteriorCellFixture): void {
    const graph = fixture.graph as {
      cellReleases: { cellId: string; cellReleaseId: string; buildingIds: string[]; buildingDetails: unknown[] }[];
      inventoryShards: { inventoryId: string }[];
      evidenceShards: { shardId: string }[];
      roots: { audience: string; artifacts: { kind: string; logicalId: string; relativeRef: string }[]; artifactAllowlist: string[] }[];
    };
    const orphanedInventories = new Set<string>();
    const orphanedEvidence = new Set<string>();
    for (const cell of graph.cellReleases) {
      if (cell.cellId !== "c2") continue;
      for (const detail of cell.buildingDetails as { status: string; inventoryId?: string; evidenceShardId?: string }[]) {
        if (detail.status === "available") {
          if (detail.inventoryId) orphanedInventories.add(detail.inventoryId);
          if (detail.evidenceShardId) orphanedEvidence.add(detail.evidenceShardId);
        }
      }
      cell.buildingDetails = cell.buildingIds.map((buildingId) => ({
        buildingId,
        status: "unavailable",
        tombstoneId: `tombstone:${cell.cellReleaseId}:${buildingId}`,
        reason: "Not scheduled for exterior materialization in this release.",
        previousInventoryId: null,
      }));
    }
    // An unreferenced shard would leave the graph open, so they go too.
    graph.inventoryShards = graph.inventoryShards.filter((shard) => !orphanedInventories.has(shard.inventoryId));
    graph.evidenceShards = graph.evidenceShards.filter((shard) => !orphanedEvidence.has(shard.shardId));
    for (const root of graph.roots) {
      root.artifacts = root.artifacts.filter((artifact) =>
        !((artifact.kind === "inventory" && orphanedInventories.has(artifact.logicalId))
          || (artifact.kind === "evidence" && orphanedEvidence.has(artifact.logicalId))));
      root.artifactAllowlist = root.artifacts.map((artifact) => artifact.relativeRef);
    }
  }

  it("reports a deliberately unshipped cell as a non-failure, without fetching anything", async () => {
    const fixture = await exteriorCellFixture();
    tombstoneC2(fixture);
    expect(validateExteriorReleaseGraph(fixture.graph).ok).toBe(true);
    const seen: string[] = [];
    const { runtime } = await runtimeFor(fixture, { onRequest: (ref) => { seen.push(ref); } });
    const outcome = await runtime.loadCell("c2", "inspection", CLOSE_METERS);

    expect(outcome.kind).toBe("not-shipped");
    if (outcome.kind !== "not-shipped") throw new Error("expected a bounded-availability outcome");
    expect(outcome.unavailableBuildingCount).toBeGreaterThan(0);
    // Truthful, non-alarming, and explicit that nothing was substituted.
    expect(outcome.notice).toContain("ships no exterior geometry in this release");
    expect(outcome.notice).not.toContain("failed verification");
    // Costs no request, so it consumes none of the shared cache budget.
    expect(seen).toEqual([]);

    const metrics = runtime.getMetrics();
    expect(metrics.notShippedCellCount).toBe(1);
    expect(metrics.failedCellCount).toBe(0);
    expect(metrics.fallbackCellCount).toBe(0);
    expect(metrics.cacheEntries).toBe(0);
  });

  it("keeps a genuinely failing cell on the alarming pinned-base path", async () => {
    const fixture = await exteriorCellFixture();
    tombstoneC2(fixture);
    // c1 still ships real geometry, so corrupting it is a real failure.
    corruptExteriorFixturePackage(fixture, fixture.assemblyPackageIds.c1v2);
    corruptExteriorFixturePackage(fixture, fixture.assemblyPackageIds.c1v1);
    const { runtime } = await runtimeFor(fixture);
    const failed = await runtime.loadCell("c1", "inspection", CLOSE_METERS);

    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed") throw new Error("expected an isolated failure");
    expect(failed.code).toBe("checksum-mismatch");
    expect(failed.notice).toContain("no exterior geometry is shown");
    // A real failure and a deliberate tombstone stay distinguishable.
    expect((await runtime.loadCell("c2", "inspection", CLOSE_METERS)).kind).toBe("not-shipped");
    expect(runtime.getMetrics().failedCellCount).toBe(1);
    expect(runtime.getMetrics().notShippedCellCount).toBe(1);
  });

  it("leaves the unmodified fixture path entirely unchanged", async () => {
    const fixture = await exteriorCellFixture();
    const { runtime } = await runtimeFor(fixture);
    expect(rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS)).representation).toBe("head");
    expect(rendered(await runtime.loadCell("c2", "inspection", CLOSE_METERS)).representation).toBe("head");
    expect(runtime.getMetrics().notShippedCellCount).toBe(0);
  });
});
