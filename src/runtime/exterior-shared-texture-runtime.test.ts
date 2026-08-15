/**
 * The RUNTIME half of the shared-class-texture mechanism (T002, ADR 0047).
 *
 * `shared-texture-assembly.test.ts` proves the offline gate. This suite proves
 * the thing that gate cannot: that the BROWSER repeats it. The failure mode it
 * exists to make impossible is a runtime that accepts a URI-image release by
 * loosening a rule and then draws whatever the URI happens to point at.
 *
 * Four claims, each tested negatively as well as positively:
 *
 *   1. A release that declares shared tiles verifies them through the SAME path
 *      a GLB goes through — declared bytes, declared SHA-256, and the rasterizer
 *      replay — before any cell of it renders, and a cell whose class tiles do
 *      not verify fails closed rather than rendering untextured.
 *   2. The verification is SESSION-scoped: four tiles are verified once, not
 *      once per cell and not once per asset.
 *   3. Every asset gets a UNIQUE model URL, because Cesium keys a glTF's
 *      embedded buffers on the owning model's absolute URL and two assets
 *      sharing one URL would silently share one BIN.
 *   4. Every asset of one class gets the SAME texture URL and the SAME bytes,
 *      which is the entire deduplication claim.
 *
 * Identity, provenance and the details-panel fields are asserted here too,
 * because they are what a reader would most reasonably fear a byte-level change
 * like this could disturb.
 */
import { describe, expect, it } from "vitest";
import {
  createExteriorCellRuntime,
  sharedTextureArtifactRefs,
  type ExteriorCellOutcome,
  type ExteriorCellRenderPlan,
} from "./exterior-cell-runtime.ts";
import {
  exteriorCellFixture,
  exteriorFixtureBaseIdentity,
  exteriorFixtureFetcher,
  type ExteriorCellFixture,
} from "./exterior-cell-fixtures.ts";
import { CitywideLruCache } from "../release/citywide-release.ts";
import { GLB_SAMPLER_FILTER_TRILINEAR, writeCanonicalGlb } from "../release/canonical-glb.ts";
import {
  PROCEDURAL_TEXTURE_SAMPLER_FILTER,
  proceduralTextureCatalog,
  proceduralTextureProvenance,
  type ProceduralTextureClass,
} from "../release/procedural-texture.ts";
import type { ExteriorTextureAdmission } from "../release/exterior-release.ts";

/** The inspection profile at close range selects lod-0, which is the textured LOD. */
const CLOSE_METERS = 180;

const GENERATED_TEXTURE_FACT: ExteriorTextureAdmission = {
  policy: "procedural-replay",
  generatedTextureFact: {
    basis: "generated-texture",
    profile: "procedural-texture-v1",
    gate: "rasterizer-replay",
    evidenceBasis: null,
    samplerFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
    statement: "Grayscale pattern tiles rasterized in-repo from named constants, admitted only because every tile is regenerated and byte-compared on load. They derive from no source imagery and no evidence record, and assert nothing about any real building.",
  },
};

/** `public/assemblies/<pkg>/assets/x.glb` -> `public/textures/<class>.png`. */
const TEXTURE_URI = (textureClass: ProceduralTextureClass): string => `../../../textures/${textureClass}.png`;
const TEXTURE_REF = (textureClass: ProceduralTextureClass): string => `public/textures/${textureClass}.png`;

function glbMetadata(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as { extras: { urbanDigitalTwin: Record<string, unknown> } };
  return json.extras.urbanDigitalTwin;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

export interface SharedTextureFixtureOptions {
  /** Flip one IDAT byte of the declared tile: the PNG still parses, only replay can tell. */
  tamperTile?: boolean;
  /** Point the GLB at a contained path this package never declares. */
  undeclaredUri?: boolean;
  /** Declare the tile artifact but claim a cell for it. */
  tileClaimsCell?: boolean;
}

/**
 * Rewrites the fine LOD of the three head-pinned packages into REAL URI-image
 * GLBs and declares the tiles they reference as `role: "texture"` artifacts.
 *
 * "Real" is load-bearing: the tiles are actual output of this repository's
 * rasterizer, so the replay can pass on them. A fake tile would only prove that
 * fakes are refused, which is already proven; what needs proving here is that a
 * legitimate release gets through and a tampered one does not.
 */
async function sharedTextureFixture(options: SharedTextureFixtureOptions = {}): Promise<ExteriorCellFixture> {
  const fixture = await exteriorCellFixture();
  const root = fixture.graph.roots.find((entry) => entry.audience === "public")!;
  root.textureAdmission = GENERATED_TEXTURE_FACT;
  const packages: Array<{ packageId: string; textureClass: ProceduralTextureClass }> = [
    { packageId: fixture.assemblyPackageIds.c1v1, textureClass: "brick-running-bond" },
    { packageId: fixture.assemblyPackageIds.c1v2, textureClass: "brick-running-bond" },
    { packageId: fixture.assemblyPackageIds.c2v1, textureClass: "limestone-ashlar" },
  ];
  for (const { packageId, textureClass } of packages) {
    const assembly = fixture.assemblies.find((entry) => entry.packageId === packageId)!;
    const lod = assembly.assets[0]!.lods.find((entry) => entry.lodId === "lod-0")!;
    const previous = fixture.contents.get(lod.artifactRef)!;
    const written = writeCanonicalGlb({
      quads: [{ materialIndex: 0, corners: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
      materials: [{ baseColorFactor: [0.8, 0.6, 0.5, 1], metallicFactor: 0, roughnessFactor: 0.8 }],
      metadata: { ...glbMetadata(previous), textureProvenance: proceduralTextureProvenance() },
      uriTextures: {
        images: [{ mimeType: "image/png", uri: options.undeclaredUri ? "../../../textures/not-declared.png" : TEXTURE_URI(textureClass) }],
        materialImage: [0],
        filter: GLB_SAMPLER_FILTER_TRILINEAR,
      },
    });
    lod.quality = { triangleCount: 2, materialCount: 1, textureCount: 1, budgets: { maxTriangles: 2, maxMaterials: 1, maxTextures: 1 } };
    fixture.contents.set(lod.artifactRef, written.bytes);
    const glbArtifact = assembly.artifacts.find((entry) => entry.relativeRef === lod.artifactRef)!;
    glbArtifact.byteSize = written.bytes.byteLength;
    glbArtifact.checksumSha256 = await digest(written.bytes);

    const clean = proceduralTextureCatalog().get(textureClass)!.pngBytes;
    const tile = new Uint8Array(clean);
    if (options.tamperTile) tile[tile.byteLength - 8] = tile[tile.byteLength - 8]! ^ 0x01;
    const ref = TEXTURE_REF(textureClass);
    fixture.contents.set(ref, tile);
    assembly.artifacts.push({
      logicalId: `${packageId}:texture:${textureClass}`,
      role: "texture",
      relativeRef: ref,
      byteSize: tile.byteLength,
      checksumSha256: await digest(tile),
      ownerCellId: options.tileClaimsCell ? assembly.cells[0]!.cellId : null,
    });
    assembly.declaredTotalBytes = assembly.artifacts.reduce((sum, entry) => sum + entry.byteSize, 0);
  }
  return fixture;
}

function runtimeFor(fixture: ExteriorCellFixture, onRequest?: (relativeRef: string) => void, gate?: (relativeRef: string) => Promise<void>) {
  const hook = gate ?? onRequest;
  return createExteriorCellRuntime(
    { index: fixture.index, graph: fixture.graph, assemblies: fixture.assemblies },
    { kind: "default" },
    {
      fetchArtifact: exteriorFixtureFetcher(fixture, hook ? { onRequest: (relativeRef) => { onRequest?.(relativeRef); return gate?.(relativeRef); } } : {}),
      baseIdentity: exteriorFixtureBaseIdentity(fixture),
      cache: new CitywideLruCache<Uint8Array>(8 * 1024 * 1024),
      artifactUrlBase: "/data/udt-fixture-exterior-cells/",
    },
  ).runtime;
}

function rendered(outcome: ExteriorCellOutcome): ExteriorCellRenderPlan {
  expect(outcome.kind).toBe("rendered");
  if (outcome.kind !== "rendered") throw new Error("expected a rendered outcome");
  return outcome;
}

describe("a release that declares shared class tiles", () => {
  it("renders its head, binds every asset to verified tile bytes, and charges no object URL", async () => {
    const fixture = await sharedTextureFixture();
    const runtime = runtimeFor(fixture);
    const plan = rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS));
    expect(plan.representation).toBe("head");
    const asset = plan.assets[0]!;
    expect(asset.sharedTextures).toBeDefined();
    const binding = asset.sharedTextures!;
    // The URL is the release-relative artifact path: the same path the bytes
    // were fetched and verified from, so it is unique per artifact by
    // construction and identifies bytes rather than naming a place to go.
    expect(binding.modelUrl).toBe(`/data/udt-fixture-exterior-cells/${asset.artifactRef}`);
    expect(binding.glbRef).toBe(asset.artifactRef);
    expect([...binding.textureUrls.keys()]).toStrictEqual(["/data/udt-fixture-exterior-cells/public/textures/brick-running-bond.png"]);
    // Byte-identical to what this repository's rasterizer produces, which is
    // the honesty claim itself and not a proxy for it.
    expect([...binding.textureUrls.values()][0]).toStrictEqual(proceduralTextureCatalog().get("brick-running-bond")!.pngBytes);
  });

  it("verifies the tiles ONCE for the session, not once per cell or per asset", async () => {
    const fixture = await sharedTextureFixture();
    const requests: string[] = [];
    const runtime = runtimeFor(fixture, (relativeRef) => { requests.push(relativeRef); });
    await runtime.loadCell("c1", "inspection", CLOSE_METERS);
    await runtime.loadCell("c2", "inspection", CLOSE_METERS);
    await runtime.loadCell("c1", "inspection", CLOSE_METERS);
    const brick = requests.filter((ref) => ref === TEXTURE_REF("brick-running-bond"));
    const limestone = requests.filter((ref) => ref === TEXTURE_REF("limestone-ashlar"));
    // One request each, across two cells, three loads and (for brick) two
    // assembly packages: the shared exterior LRU serves the second package and
    // the per-package memo serves every later cell.
    expect(brick).toHaveLength(1);
    expect(limestone).toHaveLength(1);
  });

  it("hands two assets of one class the SAME url and the SAME bytes, which is the deduplication", async () => {
    const fixture = await sharedTextureFixture();
    const runtime = runtimeFor(fixture);
    const first = rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS)).assets[0]!;
    const runtimeAgain = runtimeFor(fixture);
    const second = rendered(await runtimeAgain.loadCell("c1", "inspection", CLOSE_METERS)).assets[0]!;
    const url = [...first.sharedTextures!.textureUrls.keys()][0]!;
    expect([...second.sharedTextures!.textureUrls.keys()][0]).toBe(url);
    // Within one runtime the very same array is handed out, so the four tiles
    // are four allocations for the whole session rather than four per asset.
    const c2 = rendered(await runtime.loadCell("c2", "inspection", CLOSE_METERS)).assets[0]!;
    expect([...c2.sharedTextures!.textureUrls.keys()][0]).not.toBe(url);
    const brickBytes = [...first.sharedTextures!.textureUrls.values()][0]!;
    const brickAgain = [...rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS)).assets[0]!.sharedTextures!.textureUrls.values()][0]!;
    expect(brickAgain).toBe(brickBytes);
  });

  it("gives every artifact a DISTINCT model url, because Cesium keys embedded buffers on it", async () => {
    const fixture = await sharedTextureFixture();
    const runtime = runtimeFor(fixture);
    const urls = new Set<string>();
    for (const cellId of ["c1", "c2"]) {
      for (const asset of rendered(await runtime.loadCell(cellId, "inspection", CLOSE_METERS)).assets) {
        const modelUrl = asset.sharedTextures!.modelUrl;
        // A repeat here is the collision that makes one model render another's
        // BIN, so it is asserted as a set property rather than eyeballed.
        expect(urls.has(modelUrl)).toBe(false);
        urls.add(modelUrl);
      }
    }
    expect(urls.size).toBe(2);
  });

  it("fails closed on a ONE-BYTE mutation of a declared tile", async () => {
    const fixture = await sharedTextureFixture({ tamperTile: true });
    const runtime = runtimeFor(fixture);
    const outcome = await runtime.loadCell("c1", "inspection", CLOSE_METERS);
    // Both the head and its pinned predecessor draw the tampered tile, so the
    // cell fails outright rather than degrading to an untextured render.
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.code).toBe("shared-texture-invalid");
    expect(outcome.message).toContain("rasterizer produces");
  });

  it("fails closed on a contained URI that names no declared artifact", async () => {
    const fixture = await sharedTextureFixture({ undeclaredUri: true });
    const runtime = runtimeFor(fixture);
    const outcome = await runtime.loadCell("c1", "inspection", CLOSE_METERS);
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.code).toBe("glb-invalid");
    expect(outcome.message).toContain("uri-undeclared");
  });

  it("refuses a tile that claims a cell, so a shared tile can never be charged to one", async () => {
    const fixture = await sharedTextureFixture({ tileClaimsCell: true });
    // The structural validator refuses the package outright, and because the
    // active head pins it the runtime fails closed at construction.
    expect(() => runtimeFor(fixture)).toThrow(/Shared texture ownerCellId must be null/u);
  });

  it("leaves identity, provenance and every details-panel field exactly as they were", async () => {
    const shared = rendered(await runtimeFor(await sharedTextureFixture()).loadCell("c1", "inspection", CLOSE_METERS));
    const plain = rendered(await runtimeFor(await exteriorCellFixture()).loadCell("c1", "inspection", CLOSE_METERS));
    const sharedAsset = shared.assets[0]!;
    const plainAsset = plain.assets[0]!;
    // The cell, release, representation and canonical identity are what the
    // pick path and the deep link are built from; the provenance block is what
    // the inspector renders. None of it may move because the tiles did.
    expect(shared.cellId).toBe(plain.cellId);
    expect(shared.cellReleaseId).toBe(plain.cellReleaseId);
    expect(shared.representation).toBe(plain.representation);
    expect(sharedAsset.canonicalFeatureId).toBe(plainAsset.canonicalFeatureId);
    expect(sharedAsset.ownerCellId).toBe(plainAsset.ownerCellId);
    expect(sharedAsset.lodId).toBe(plainAsset.lodId);
    expect(sharedAsset.provenance).toStrictEqual(plainAsset.provenance);
    // The one honest difference: the checksum, because the bytes changed.
    expect(sharedAsset.checksumSha256).not.toBe(plainAsset.checksumSha256);
  });

  it("leaves a release that declares no tile completely alone", async () => {
    const fixture = await exteriorCellFixture();
    const runtime = runtimeFor(fixture);
    const plan = rendered(await runtime.loadCell("c1", "inspection", CLOSE_METERS));
    // No binding, so the viewport takes the Blob path it always took. The
    // package fact is what decides, and it is readable on its own.
    expect(plan.assets.every((asset) => asset.sharedTextures === undefined)).toBe(true);
    expect(sharedTextureArtifactRefs(fixture.assemblies[0]!).size).toBe(0);
  });
});

describe("the session-scoped verification is not hostage to its first caller", () => {
  it("keeps a LIVE batch rendering when the batch that started verification aborts", async () => {
    // The failure this pins. The memoized verification promise used to be
    // created under the FIRST caller's AbortSignal, and `CitywideRequestPool`
    // rejects each caller's await when THAT caller's signal aborts. So:
    // batch 1 starts the tile fetch; batch 2 arrives and awaits the same
    // memoized promise; a height-bucket change aborts batch 1; batch 2 receives
    // batch 1's AbortError, `loadCell` re-throws it, and the wave's outcomes are
    // deleted — the wave blanks with no notice until residency changes.
    //
    // Serialising the two batches hides it, because a rejected verification is
    // forgotten and the second batch simply re-runs it. The defect only appears
    // while the two overlap, which is the ordinary case under a moving camera.
    const fixture = await sharedTextureFixture();
    let releaseTiles: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseTiles = resolve; });
    let tileRequested: () => void = () => {};
    const requested = new Promise<void>((resolve) => { tileRequested = resolve; });
    const runtime = runtimeFor(fixture, undefined, async (relativeRef) => {
      if (!relativeRef.startsWith("public/textures/")) return;
      tileRequested();
      await gate;
    });

    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const abandoned = runtime.loadCell("c1", "inspection", CLOSE_METERS, controllerA.signal);
    // The abandoned batch is EXPECTED to reject; that is not the defect, and its
    // rejection must not surface as an unhandled one.
    const abandonedOutcome = abandoned.then(() => "settled" as const, (error) => (error instanceof DOMException && error.name === "AbortError" ? "aborted" as const : "failed" as const));
    await requested;
    // Batch 2 joins while batch 1's verification is still in flight.
    // The SAME cell, so the same assembly package and therefore the same
    // memoized verification. A different package would have its own memo and
    // would hide the coupling entirely.
    const live = runtime.loadCell("c1", "inspection", CLOSE_METERS, controllerB.signal);
    await Promise.resolve();
    controllerA.abort();
    releaseTiles();
    expect(await abandonedOutcome).not.toBe("failed");

    // The live batch, under its OWN signal, must still render.
    const outcome = await live;
    expect(outcome.kind).toBe("rendered");
    if (outcome.kind !== "rendered") return;
    expect(outcome.representation).toBe("head");
    expect(outcome.assets[0]!.sharedTextures).toBeDefined();
  });
});
