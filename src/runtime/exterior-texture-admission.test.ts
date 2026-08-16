/**
 * The versioned texture-admission seam (T028, Issue #50).
 *
 * ADR 0032 shipped procedural detail tiles into a PRIVATE package and listed
 * public admission as a precondition rather than a decision. This suite is the
 * infrastructure half of that precondition: it proves the admission is one
 * decision declared by the release, that it is inert until a release opts in,
 * that opting in relaxes exactly one rule and no other, and that the rights
 * boundary the whole design rests on is preserved.
 *
 * The most important test here is the one that did not exist before: the
 * RUNTIME — not the offline validator — refusing a textured package. The runtime
 * derived texture-freeness itself, with no policy in scope, and nothing tested
 * that derivation directly. A seam in the validator alone would have left the
 * runtime refusing on its own authority.
 */
import { describe, expect, it } from "vitest";
import {
  BLOCK835_V2_EXTERIOR_ACTIVATION,
  BLOCK835_V2_EXTERIOR_ROLLBACK,
  EXTERIOR_DEFAULT_ACTIVATIONS,
  exteriorRolledBackReleaseNotice,
} from "./exterior-default-activation.ts";
import { BLOCK835_V3_CANARY_APPROVAL_EXCLUSIONS, BLOCK835_V3_CANARY_APPROVAL_SCOPE } from "../release/block835-v3-canary-release.ts";
import { MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS, MIDTOWN_CORE_V3_APPROVAL_SCOPE } from "../release/midtown-core-v3-release.ts";
import {
  DEFAULT_EXTERIOR_TEXTURE_ADMISSION_POLICY,
  EXTERIOR_TEXTURE_ADMISSION_POLICIES,
  exteriorTextureAdmissionPolicyOf,
  validateExteriorReleaseGraph,
  type ExteriorReleaseGraph,
  type ExteriorTextureAdmission,
} from "../release/exterior-release.ts";
import {
  ASSEMBLY_ISSUE_DECLARED_TEXTURE_FORBIDDEN,
  ASSEMBLY_ISSUE_EMBEDDED_IMAGE_FORBIDDEN,
  ASSEMBLY_ISSUE_TEXTURE_PROVENANCE_REQUIRED,
  ASSEMBLY_ISSUE_TEXTURE_REPLAY_MISMATCH,
  ASSEMBLY_ISSUE_TEXTURE_SAMPLER_FILTER_REQUIRED,
  parseGlbV2,
  publiclyAdmittedSamplerFilter,
  replayMultiLodAssembly,
  requiresTextureFreeAssembly,
  validateGlbBinding,
  validateMultiLodAssembly,
} from "../release/multi-lod-assembly.ts";
import {
  PROCEDURAL_TEXTURE_PROFILE,
  PROCEDURAL_TEXTURE_SAMPLER_FILTER,
  proceduralTextureProvenance,
  proceduralTextureTile,
} from "../release/procedural-texture.ts";
import { GLB_SAMPLER_FILTER_TRILINEAR, writeCanonicalGlb } from "../release/canonical-glb.ts";
import { CitywideLruCache } from "../release/citywide-release.ts";
import {
  createExteriorCellRuntime,
  type ExteriorCellOutcome,
} from "./exterior-cell-runtime.ts";
import { RUNTIME_TEXTURE_BLOCKING_PROJECTED_EXCLUSIONS, validateProjectedGraphAudience } from "../domain/exterior-evidence-intake.ts";
import {
  blockingEvidenceGraph,
  exteriorCellFixture,
  exteriorFixtureBaseIdentity,
  exteriorFixtureFetcher,
  replaceExteriorFixtureGlb,
  type ExteriorCellFixture,
} from "./exterior-cell-fixtures.ts";

// The inspection profile at close range is what selects lod-0, which is the LOD
// the textured bytes ride on. The exploration profile selects lod-1 here, so a
// test written against it would exercise the manifest refusal only and never
// reach the GLB bytes at all.
const CLOSE_METERS = 180;

/** The generated-texture fact a release must carry to admit a procedural tile. */
const GENERATED_TEXTURE_FACT: ExteriorTextureAdmission = {
  policy: "procedural-replay",
  generatedTextureFact: {
    basis: "generated-texture",
    profile: "procedural-texture-v1",
    gate: "rasterizer-replay",
    evidenceBasis: null,
    samplerFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
    statement: "Grayscale pattern tiles rasterized in-repo from named constants, admitted only because every embedded image is regenerated and byte-compared on load. They derive from no source imagery and no evidence record, and assert nothing about any real building.",
  },
};

function glbMetadata(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as { extras: { urbanDigitalTwin: Record<string, unknown> } };
  return json.extras.urbanDigitalTwin;
}

/**
 * Swaps the fine LOD of one fixture package for a REAL textured GLB.
 *
 * "Real" is the load-bearing word: the image is an actual tile from this
 * repository's rasterizer, so the replay gate can pass on it. A fake PNG would
 * only ever prove that the replay gate refuses fakes, which is already tested
 * elsewhere; what needs proving here is that a legitimate tile gets through when
 * — and only when — a release admits it.
 */
async function texturedFixture(options: { corruptPixel?: boolean; dropProvenance?: boolean; wrapOnlySampler?: boolean } = {}): Promise<ExteriorCellFixture> {
  const fixture = await exteriorCellFixture();
  const packageId = fixture.assemblyPackageIds.c1v2;
  const assembly = fixture.assemblies.find((entry) => entry.packageId === packageId)!;
  const lod = assembly.assets[0]!.lods.find((entry) => entry.lodId === "lod-0")!;
  const previous = fixture.contents.get(lod.artifactRef)!;
  const tile = proceduralTextureTile("brick-running-bond");
  const pngBytes = new Uint8Array(tile.pngBytes);
  if (options.corruptPixel) pngBytes[pngBytes.length - 12] = (pngBytes[pngBytes.length - 12] ?? 0) ^ 0x5a;
  const metadata = {
    ...glbMetadata(previous),
    ...(options.dropProvenance ? {} : { textureProvenance: proceduralTextureProvenance() }),
  };
  const written = writeCanonicalGlb({
    quads: [{ materialIndex: 0, corners: [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
    materials: [{ baseColorFactor: [0.8, 0.6, 0.5, 1], metallicFactor: 0, roughnessFactor: 0.8 }],
    metadata,
    textures: {
      images: [{ mimeType: "image/png", bytes: pngBytes }],
      materialImage: [0],
      // Omitting the filter is exactly the shape the frozen -v3t package ships
      // and exactly the shape that measured badly in Cesium.
      ...(options.wrapOnlySampler ? {} : { filter: GLB_SAMPLER_FILTER_TRILINEAR }),
    },
  });
  expect(written.counts).toStrictEqual({ triangleCount: 2, materialCount: 1, textureCount: 1 });
  lod.quality = { triangleCount: 2, materialCount: 1, textureCount: 1, budgets: { maxTriangles: 2, maxMaterials: 1, maxTextures: 1 } };
  await replaceExteriorFixtureGlb(fixture, packageId, "lod-0", written.bytes);
  return fixture;
}

function admit(fixture: ExteriorCellFixture, admission: ExteriorTextureAdmission | null): ExteriorCellFixture {
  const root = fixture.graph.roots.find((entry) => entry.audience === "public")!;
  if (admission) root.textureAdmission = admission;
  else delete root.textureAdmission;
  return fixture;
}

/**
 * A refused head cell does not throw out of `loadCell`; the runtime falls back to
 * the checksum-pinned predecessor and says so, which is the designed behaviour.
 * So the refusal is asserted on BOTH surfaces: the runtime falls back with the
 * right failure code, and the offline replay names the exact gate that fired.
 * Asserting only the fallback would pass for any GLB error at all.
 */
async function expectRefusedByGate(fixture: ExteriorCellFixture, code: string, gateMessage: string): Promise<void> {
  const outcome = await loadCell(fixture);
  expect(outcome.kind).toBe("rendered");
  if (outcome.kind !== "rendered") return;
  expect(outcome.representation).toBe("predecessor");
  expect(outcome.notice).toContain(code);
  const assembly = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c1v2)!;
  const contents = new Map(assembly.artifacts.map((artifact) => [artifact.relativeRef, fixture.contents.get(artifact.relativeRef)!]));
  const replay = await replayMultiLodAssembly(assembly, contents, { textureAdmission: "procedural-replay", declaredSamplerFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER } });
  expect(replay.ok).toBe(false);
  expect(replay.ok === false && replay.issues.some((issue) => issue.message.includes(gateMessage))).toBe(true);
}

async function loadCell(fixture: ExteriorCellFixture): Promise<ExteriorCellOutcome> {
  const { runtime } = createExteriorCellRuntime(
    { index: fixture.index, graph: fixture.graph, assemblies: fixture.assemblies },
    { kind: "default" },
    {
      fetchArtifact: exteriorFixtureFetcher(fixture),
      baseIdentity: exteriorFixtureBaseIdentity(fixture),
      cache: new CitywideLruCache<Uint8Array>(8 * 1024 * 1024),
    },
  );
  return runtime.loadCell("c1", "inspection", CLOSE_METERS);
}

describe("the admission policy is one decision, declared by the release", () => {
  it("defaults to texture-free for absent, unknown and malformed declarations", () => {
    expect(DEFAULT_EXTERIOR_TEXTURE_ADMISSION_POLICY).toBe("texture-free");
    expect(EXTERIOR_TEXTURE_ADMISSION_POLICIES).toStrictEqual(["texture-free", "procedural-replay"]);
    expect(exteriorTextureAdmissionPolicyOf(null)).toBe("texture-free");
    expect(exteriorTextureAdmissionPolicyOf(undefined)).toBe("texture-free");
    expect(exteriorTextureAdmissionPolicyOf({})).toBe("texture-free");
    expect(exteriorTextureAdmissionPolicyOf({ textureAdmission: { policy: "anything-goes" } as unknown as ExteriorTextureAdmission })).toBe("texture-free");
  });

  it("keeps requireTextureFreeAssembly winning over any admission", () => {
    // The lineage flag could only ever ADD enforcement. It still can only add:
    // an intake-linked package stays texture-free no matter what a release says.
    expect(requiresTextureFreeAssembly("public", { textureAdmission: "procedural-replay", requireTextureFreeAssembly: true })).toBe(true);
    expect(requiresTextureFreeAssembly("private", { requireTextureFreeAssembly: true })).toBe(true);
    expect(requiresTextureFreeAssembly("public", { textureAdmission: "procedural-replay" })).toBe(false);
    expect(requiresTextureFreeAssembly("public", { textureAdmission: "texture-free" })).toBe(true);
    expect(requiresTextureFreeAssembly("public")).toBe(true);
  });

  it("refuses a declaration that is not exactly what it claims to be", async () => {
    const base = await exteriorCellFixture();
    const graphWith = (admission: unknown): ExteriorReleaseGraph => {
      const graph = structuredClone(base.graph);
      (graph.roots.find((entry) => entry.audience === "public") as unknown as Record<string, unknown>).textureAdmission = admission;
      return graph;
    };
    expect(validateExteriorReleaseGraph(graphWith({ policy: "texture-free" })).ok).toBe(true);
    expect(validateExteriorReleaseGraph(graphWith(GENERATED_TEXTURE_FACT)).ok).toBe(true);
    // procedural-replay without the fact that admits it
    expect(validateExteriorReleaseGraph(graphWith({ policy: "procedural-replay" })).ok).toBe(false);
    // texture-free carrying a fact it has no business carrying
    expect(validateExteriorReleaseGraph(graphWith({ policy: "texture-free", generatedTextureFact: GENERATED_TEXTURE_FACT.generatedTextureFact })).ok).toBe(false);
    // an evidence basis, which a generated tile does not have and must not claim
    expect(validateExteriorReleaseGraph(graphWith({ ...GENERATED_TEXTURE_FACT, generatedTextureFact: { ...GENERATED_TEXTURE_FACT.generatedTextureFact!, evidenceBasis: "intake:wikipedia:doitt-778052:facade-material" } })).ok).toBe(false);
    // the sampler filter the Cesium evidence decided is not optional
    expect(validateExteriorReleaseGraph(graphWith({ ...GENERATED_TEXTURE_FACT, generatedTextureFact: { ...GENERATED_TEXTURE_FACT.generatedTextureFact!, samplerFilter: { magFilter: 9728, minFilter: 9728 } } })).ok).toBe(false);
    expect(GENERATED_TEXTURE_FACT.generatedTextureFact!.samplerFilter).toStrictEqual({ ...GLB_SAMPLER_FILTER_TRILINEAR });
  });

  it("gives a package no way to declare its own admission", async () => {
    const fixture = await texturedFixture();
    const assembly = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c1v2)!;
    // The manifest has no admission field to set, so the only lever a package
    // has is its measured texture count -- and that is what gets refused.
    expect(Object.keys(assembly)).not.toContain("textureAdmission");
    const refused = validateMultiLodAssembly(assembly, { textureAdmission: "texture-free" });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.issues.some((issue) => issue.message === ASSEMBLY_ISSUE_DECLARED_TEXTURE_FORBIDDEN)).toBe(true);
    expect(validateMultiLodAssembly(assembly, { textureAdmission: "procedural-replay" }).ok).toBe(true);
  });
});

describe("the runtime refuses a textured package unless its release admits one", () => {
  it("refuses it under the default texture-free policy, in the runtime itself", async () => {
    // This is the case the runtime had no test for. It used to derive
    // texture-freeness from `audience === "public"` with no policy in scope, so
    // nothing proved the runtime would refuse the bytes rather than merely the
    // offline validator refusing the manifest.
    const fixture = admit(await texturedFixture(), null);
    await expect(loadCell(fixture)).rejects.toThrow(/failed closed/u);
  });

  it("refuses it when the release explicitly declares texture-free", async () => {
    const fixture = admit(await texturedFixture(), { policy: "texture-free" });
    await expect(loadCell(fixture)).rejects.toThrow(/failed closed/u);
  });

  it("admits it end to end when the release declares procedural-replay", async () => {
    const fixture = admit(await texturedFixture(), GENERATED_TEXTURE_FACT);
    const outcome = await loadCell(fixture);
    expect(outcome.kind).toBe("rendered");
    if (outcome.kind !== "rendered") return;
    const asset = outcome.assets.find((entry) => entry.lodId === "lod-0")!;
    expect(asset).toBeDefined();
    // The bytes that arrived are the textured ones, verified rather than assumed.
    expect(glbMetadata(asset.bytes).textureProvenance).toStrictEqual({ ...proceduralTextureProvenance() });
  });
});

describe("a public admission is only as good as the samplers in the bytes", () => {
  it("refuses a wrap-only textured GLB under procedural-replay, by name", async () => {
    // The root's generated-texture fact asserts LINEAR / LINEAR_MIPMAP_LINEAR.
    // Before this rule existed nothing checked the shipped samplers against it,
    // so a successor wave could declare trilinear in an immutable root and ship
    // the wrap-only bytes whose aliasing T028 actually measured.
    const fixture = admit(await texturedFixture({ wrapOnlySampler: true }), GENERATED_TEXTURE_FACT);
    await expectRefusedByGate(fixture, "glb-invalid", ASSEMBLY_ISSUE_TEXTURE_SAMPLER_FILTER_REQUIRED);
  });

  it("still accepts those same bytes on the private replay path", async () => {
    // The rule is CONDITIONAL and public-only. The frozen -v3t package ships
    // wrap-only samplers, is byte-frozen, and is not publicly admitted; nothing
    // about the private or replay-only path may move.
    const fixture = await texturedFixture({ wrapOnlySampler: true });
    const assembly = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c1v2)!;
    const asset = assembly.assets[0]!;
    const lod = asset.lods.find((entry) => entry.lodId === "lod-0")!;
    const parsed = parseGlbV2(fixture.contents.get(lod.artifactRef)!);
    // Private/replay-only: no admission in force, so no sampler requirement.
    expect(publiclyAdmittedSamplerFilter("private", { proceduralTextureProfile: PROCEDURAL_TEXTURE_PROFILE })).toBeNull();
    expect(publiclyAdmittedSamplerFilter("public", { textureAdmission: "texture-free" })).toBeNull();
    expect(() => validateGlbBinding(parsed, asset, lod, false, null)).not.toThrow();
    // ...and the same bytes fail the moment a public admission is in force.
    expect(() => validateGlbBinding(parsed, asset, lod, false, { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER })).toThrow(ASSEMBLY_ISSUE_TEXTURE_SAMPLER_FILTER_REQUIRED);
  });

  it("admits a trilinear GLB end to end, and pins where the pair comes from", async () => {
    const fixture = admit(await texturedFixture(), GENERATED_TEXTURE_FACT);
    const outcome = await loadCell(fixture);
    expect(outcome.kind === "rendered" && outcome.representation).toBe("head");
    // The enforced pair is the one the RELEASE declares, not a constant this
    // module chose: the root fact and the shipped samplers are the same numbers.
    expect(publiclyAdmittedSamplerFilter("public", { textureAdmission: "procedural-replay", declaredSamplerFilter: { magFilter: 9729, minFilter: 9987 } })).toStrictEqual({ magFilter: 9729, minFilter: 9987 });
    expect(GENERATED_TEXTURE_FACT.generatedTextureFact!.samplerFilter).toStrictEqual({ ...PROCEDURAL_TEXTURE_SAMPLER_FILTER });
  });
});

describe("procedural-replay opens exactly one door", () => {
  it("still requires provenance on any GLB that embeds an image", async () => {
    const fixture = admit(await texturedFixture({ dropProvenance: true }), GENERATED_TEXTURE_FACT);
    await expectRefusedByGate(fixture, "glb-invalid", ASSEMBLY_ISSUE_TEXTURE_PROVENANCE_REQUIRED);
  });

  it("still regenerates every tile and refuses one altered pixel", async () => {
    // The honesty claim is structural, and admission does not soften it: the
    // image is rasterized afresh from named constants and byte-compared, so a
    // tile this repository cannot reproduce fails even under an open policy.
    // The pixel is altered inside the PNG payload, and the manifest checksums
    // are re-derived over the altered bytes, so only regeneration catches it.
    const fixture = admit(await texturedFixture({ corruptPixel: true }), GENERATED_TEXTURE_FACT);
    await expectRefusedByGate(fixture, "glb-invalid", ASSEMBLY_ISSUE_TEXTURE_REPLAY_MISMATCH);
  });

  it("keeps runtimeTexture:false intact, because it is a RIGHTS predicate", async () => {
    // `runtimeTexture` asks whether the evidence a building CITES permits a
    // texture derived from it. A generated tile cites no evidence at all, so
    // flipping this to true would assert a permission nobody granted over a fact
    // nobody supplied. Admission travels on the release's generated-texture
    // fact instead, and the structural gate stays closed either way.
    const fixture = admit(await texturedFixture(), GENERATED_TEXTURE_FACT);
    const cellRelease = fixture.graph.cellReleases.find((entry) => entry.cellReleaseId === fixture.cellReleaseIds.c1v2)!;
    for (const detail of cellRelease.buildingDetails) {
      if (detail.status === "available") expect(detail.runtimeTexture).toBe(false);
    }
    // The admitted textured cell still renders with runtimeTexture:false, which
    // is the whole point: the tile got in on the release's generated-texture
    // fact, not on a rights claim about anybody's evidence.
    const outcome = await loadCell(fixture);
    expect(outcome.kind === "rendered" && outcome.representation).toBe("head");

    // And the structural gate is untouched and takes no admission parameter at
    // all, so no release can open it. A shard whose approval excludes runtime
    // texture is admissible for public display and inadmissible the moment a
    // detail claims a runtime texture -- under every policy, because the
    // function has no policy to consult.
    const restricted = blockingEvidenceGraph("runtime-texture");
    expect(validateProjectedGraphAudience(restricted, { audience: "public", runtimeTexture: false }).ok).toBe(true);
    expect(validateProjectedGraphAudience(restricted, { audience: "public", runtimeTexture: true }).ok).toBe(false);
    expect(RUNTIME_TEXTURE_BLOCKING_PROJECTED_EXCLUSIONS).toContain("runtime-texture");
  });

  it("keeps the texture-free gate itself byte-untouched for every other release", async () => {
    // A package that is texture-free by lineage stays texture-free under an
    // admitting release. NOTE what this particular refusal is: it fires at the
    // MANIFEST, on the declared textureCount, before any GLB is parsed. The
    // byte-layer half of the same gate is asserted separately below, because a
    // manifest that LIES about its texture count would sail past this one.
    const fixture = await texturedFixture();
    const assembly = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c1v2)!;
    const refused = validateMultiLodAssembly(assembly, { textureAdmission: "procedural-replay", requireTextureFreeAssembly: true });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.issues.some((issue) => issue.message === ASSEMBLY_ISSUE_DECLARED_TEXTURE_FORBIDDEN)).toBe(true);
  });

  it("refuses textured BYTES at the byte layer under texture-free, not merely a textured manifest", async () => {
    // The negative direction for the runtime's textureFree threading. A manifest
    // declaring textureCount 0 passes the manifest gate; the payload underneath
    // still embeds an image, and `validateGlbBinding` -- which is what the
    // runtime calls per artifact -- must be the thing that refuses it.
    const fixture = await texturedFixture();
    const assembly = fixture.assemblies.find((entry) => entry.packageId === fixture.assemblyPackageIds.c1v2)!;
    const asset = assembly.assets[0]!;
    const lod = asset.lods.find((entry) => entry.lodId === "lod-0")!;
    const parsed = parseGlbV2(fixture.contents.get(lod.artifactRef)!);
    // textureFree = true is exactly what the runtime derives for a release that
    // declares nothing, and it refuses the payload on the embedded-image gate.
    expect(() => validateGlbBinding(parsed, asset, lod, true, null)).toThrow(ASSEMBLY_ISSUE_EMBEDDED_IMAGE_FORBIDDEN);
    // ...and the same bytes are accepted with textureFree = false, so the
    // refusal is attributable to the threaded flag and to nothing else.
    expect(() => validateGlbBinding(parsed, asset, lod, false, null)).not.toThrow();
  });
});

describe("nothing committed adopts the new policy this cycle", () => {
  it("keeps the promoted V3 waves' TEXTURE-FREE approval text byte-frozen", () => {
    // The seam is INERT. The approval scope and exclusions are the text a
    // reader trusts, so they are asserted literally rather than paraphrased.
    expect(BLOCK835_V3_CANARY_APPROVAL_SCOPE).toContain("TEXTURE-FREE");
    expect(MIDTOWN_CORE_V3_APPROVAL_SCOPE).toContain("TEXTURE-FREE");
    for (const exclusions of [BLOCK835_V3_CANARY_APPROVAL_EXCLUSIONS, MIDTOWN_CORE_V3_APPROVAL_EXCLUSIONS]) {
      expect(exclusions).toContain("runtime textures of any kind, procedural or captured");
    }
  });

  it("leaves every shipped exterior release graph declaring no admission at all", async () => {
    const { readFileSync } = await import("node:fs");
    const roots = [
      "public/data/manhattan-exterior-cells-20260811/release-graph.json",
      "public/data/manhattan-exterior-cells-20260811-v3/release-graph.json",
    ].map((path) => JSON.parse(new TextDecoder().decode(readFileSync(path))) as ExteriorReleaseGraph);
    for (const graph of roots) {
      for (const root of graph.roots) {
        // Absent, not "texture-free": a committed root's bytes predate the
        // field, and this is what proves the field cost them nothing.
        expect(root.textureAdmission).toBeUndefined();
        expect(exteriorTextureAdmissionPolicyOf(root)).toBe("texture-free");
        expect(validateExteriorReleaseGraph(graph).ok).toBe(true);
      }
    }
  });
});

describe("rollback for a textured wave is a release reversion, never a build flag", () => {
  it("reverts by exporting the untextured predecessor record, which also gates the withdrawn release", () => {
    // The rollback UNIT is the default-activation record, exactly as it was for
    // V2 -> V3. There is deliberately no "textures off" switch: a flag would
    // change what the running application draws without changing which
    // checksum-pinned release it claims to be drawing, and the two would then
    // disagree with no record of why.
    //
    // The T005 serving promotion made the chain one link longer rather than
    // changing its shape: what the build promotes for this wave is the serving
    // release, whose predecessor is the curated V3 record, whose own predecessor
    // is the untextured V2 rollback target this case is about. The V3 record is
    // reached THROUGH the shipped set rather than imported, so a build that
    // stopped promoting this wave fails here instead of testing a constant
    // nothing points at.
    const serving = EXTERIOR_DEFAULT_ACTIVATIONS.find((record) => record.enabled && record.releaseId === "manhattan-exterior-cells-20260811-v3-s1");
    expect(serving?.enabled).toBe(true);
    if (!serving?.enabled) return;
    const promoted = serving.predecessor;
    expect(promoted.enabled).toBe(true);
    if (!promoted.enabled) return;
    expect(promoted.releaseId).toBe("manhattan-exterior-cells-20260811-v3");
    const predecessor = promoted.predecessor;
    expect(predecessor).toBe(BLOCK835_V2_EXTERIOR_ROLLBACK);
    expect(predecessor.enabled).toBe(true);
    if (!predecessor.enabled) return;
    // Reverting makes the predecessor the active default...
    expect(predecessor.releaseId).toBe(BLOCK835_V2_EXTERIOR_ACTIVATION.releaseId);
    // ...and simultaneously refuses promotion-era deep links into the withdrawn
    // successor, so a bookmark cannot keep rendering a wave nobody stands behind.
    expect(predecessor.rolledBackReleaseId).toBe(promoted.releaseId);
    expect(exteriorRolledBackReleaseNotice(promoted.releaseId, [predecessor])).not.toBeNull();
    // A successor that carried textures would revert the same way, to a
    // predecessor that does not: the reverted-to record is itself texture-free.
    expect(exteriorTextureAdmissionPolicyOf(null)).toBe("texture-free");
  });
});
