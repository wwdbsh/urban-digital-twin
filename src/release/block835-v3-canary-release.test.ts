import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sha256HexBytes, stableSerialize } from "../domain/deterministic-hash.ts";
import { validateExteriorReleaseGraph, type ExteriorReleaseGraph } from "./exterior-release.ts";
import { validateExteriorCellReleaseIndex } from "../runtime/exterior-cell-runtime.ts";
import { validateMultiLodAssembly } from "./multi-lod-assembly.ts";
import { BLOCK835_CANARY_PILOT_RELEASE_PATH, BLOCK835_CANARY_V2_PROFILE, buildBlock835CanaryRelease } from "./block835-canary-release.ts";
import { BLOCK835_V3_STYLE_OVERRIDES, ESB_FACADE_MATERIAL_RECORD_ID } from "./block835-facade-material-intake.ts";
import { DETERMINISTIC_FACADE_V3_CITED_STYLE_UNCERTAINTY, DETERMINISTIC_FACADE_V3_UNCERTAINTY } from "../domain/deterministic-facade-generator-v3.ts";
import {
  BLOCK835_V3_CANARY_APPROVAL,
  BLOCK835_V3_CANARY_INPUT_PACKAGE_ID,
  BLOCK835_V3_CANARY_PROFILE,
  BLOCK835_V3_CANARY_RELEASE_ID,
} from "./block835-v3-canary-release.ts";

const OUTPUT = `public/data/${BLOCK835_V3_CANARY_RELEASE_ID}`;
const V2_OUTPUT = "public/data/manhattan-exterior-cells-20260811";

function read(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
function json(path: string): unknown {
  return JSON.parse(new TextDecoder().decode(read(path))) as unknown;
}

function input(profile = BLOCK835_V3_CANARY_PROFILE) {
  const manifest = json(`${profile.inputPackageDirectory}/manifest.json`) as { artifacts: { relativeRef: string }[] };
  const packageBytes = new Map<string, Uint8Array>();
  for (const artifact of manifest.artifacts) packageBytes.set(artifact.relativeRef, read(`${profile.inputPackageDirectory}/${artifact.relativeRef}`));
  return { manifest, packageBytes, pilotRelease: json(BLOCK835_CANARY_PILOT_RELEASE_PATH) };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

describe("Block 835 V3 successor exterior release", () => {
  it("promotes the V3 package and matches the emitted directory byte for byte", () => {
    const built = buildBlock835CanaryRelease(input(), BLOCK835_V3_CANARY_PROFILE);
    expect(built.index.releaseId).toBe(BLOCK835_V3_CANARY_RELEASE_ID);
    expect(built.assemblies[0]!.packageId).toBe(BLOCK835_V3_CANARY_INPUT_PACKAGE_ID);
    for (const [path, bytes] of built.files) {
      expect(bytesEqual(bytes, read(`${OUTPUT}/${path}`)), `drift in ${path}`).toBe(true);
    }
    expect(built.files.size).toBeGreaterThan(0);
  });

  it("refuses a cited facade style the rights-cleared admission does not produce", () => {
    // The attack this closes: `citedStyle` was the one trust-bearing field on
    // the emit path that was COPIED from the private input manifest rather than
    // re-derived, while the inventory beside it is rebuilt and hash-compared and
    // truth tiers are admitted against the rebuilt inventory. A manifest-only
    // edit could therefore attach a sourced-material citation — with a provider,
    // a URL and an attribution line the details panel renders verbatim — to a
    // building no intake record covers, and nothing before the runtime looked.
    const forged = input();
    const manifest = forged.manifest as unknown as {
      assets: { canonicalFeatureId: string; citedStyle?: unknown }[];
    };
    const victim = manifest.assets.find((asset) => asset.canonicalFeatureId !== "doitt:778052")!;
    expect(victim.citedStyle).toBeUndefined();
    victim.citedStyle = {
      styleClass: "stone-neutral",
      evidenceRecordId: ESB_FACADE_MATERIAL_RECORD_ID,
      fact: "Invented facade-material claim that no admitted intake record makes.",
      provider: "wikipedia",
      sourceUrl: "https://en.wikipedia.org/wiki/Empire_State_Building",
      attribution: "Wikipedia contributors",
    };
    expect(() => buildBlock835CanaryRelease(forged, BLOCK835_V3_CANARY_PROFILE))
      .toThrow(/cannot re-derive from the rights-cleared intake admission/u);
    expect(() => buildBlock835CanaryRelease(forged, BLOCK835_V3_CANARY_PROFILE)).toThrow(new RegExp(victim.canonicalFeatureId, "u"));
  });

  it("refuses a DROPPED citation as well, so the check closes both directions", () => {
    // The mirror case: silently removing the citation from the one building
    // that genuinely carries one would ship a cited style class while telling
    // the user nothing sourced it.
    const stripped = input();
    const manifest = stripped.manifest as unknown as {
      assets: { canonicalFeatureId: string; citedStyle?: unknown }[];
    };
    const cited = manifest.assets.find((asset) => asset.canonicalFeatureId === "doitt:778052")!;
    expect(cited.citedStyle).toBeDefined();
    delete cited.citedStyle;
    expect(() => buildBlock835CanaryRelease(stripped, BLOCK835_V3_CANARY_PROFILE))
      .toThrow(/cannot re-derive from the rights-cleared intake admission/u);
  });

  it("builds byte-identical output on repeated runs", () => {
    const first = buildBlock835CanaryRelease(input(), BLOCK835_V3_CANARY_PROFILE);
    const second = buildBlock835CanaryRelease(input(), BLOCK835_V3_CANARY_PROFILE);
    expect([...second.files.keys()].sort()).toEqual([...first.files.keys()].sort());
    for (const [path, bytes] of first.files) expect(bytesEqual(bytes, second.files.get(path)!), `drift in ${path}`).toBe(true);
    expect(stableSerialize(second.graph)).toBe(stableSerialize(first.graph));
    expect(stableSerialize(second.index)).toBe(stableSerialize(first.index));
  });

  it("emits a valid graph, assembly and runtime index over the same fourteen buildings", () => {
    const built = buildBlock835CanaryRelease(input(), BLOCK835_V3_CANARY_PROFILE);
    const graphResult = validateExteriorReleaseGraph(json(`${OUTPUT}/release-graph.json`));
    expect(graphResult.ok ? [] : graphResult.issues).toEqual([]);
    const indexResult = validateExteriorCellReleaseIndex(json(`${OUTPUT}/index.json`));
    expect(indexResult.ok ? [] : indexResult.issues).toEqual([]);
    const assemblyResult = validateMultiLodAssembly((json(`${OUTPUT}/assemblies.json`) as unknown[])[0]);
    expect(assemblyResult.ok ? [] : assemblyResult.issues).toEqual([]);

    const cell = built.graph.cellReleases[0]!;
    expect(cell.buildingDetails).toHaveLength(14);
    for (const detail of cell.buildingDetails) {
      expect(detail.status).toBe("available");
      // V3 is UNTEXTURED. The textured package is a separately gated admission
      // and is not what this release promotes.
      if (detail.status === "available") expect(detail.runtimeTexture).toBe(false);
    }
    for (const shard of built.graph.evidenceShards) {
      expect(shard.graph.licenses[0]!.allowedUse.runtimeTexture).toBe(false);
      expect(shard.graph.approvals[0]!.fingerprintSha256).toBe(BLOCK835_V3_CANARY_APPROVAL.fingerprintSha256);
    }
    // The successor owns exactly the predecessor's identities: this promotion
    // changes how each building is drawn, never which buildings the wave owns.
    const v2Cell = (json(`${V2_OUTPUT}/release-graph.json`) as ExteriorReleaseGraph).cellReleases[0]!;
    expect([...cell.buildingIds].sort()).toEqual([...v2Cell.buildingIds].sort());
  });

  it("carries the five refused-setback assets as an admitted, explained absence", () => {
    const built = buildBlock835CanaryRelease(input(), BLOCK835_V3_CANARY_PROFILE);
    const refused = built.graph.inventoryShards.filter((shard) => shard.inventory.components.some((component) => component.state === "absent"));
    expect(refused).toHaveLength(5);
    for (const shard of refused) {
      const absent = shard.inventory.components.filter((component) => component.state === "absent");
      // Only setbacks, and only with the grammar's own refusal disclosure.
      expect(absent.map((component) => component.kind)).toEqual(["setbacks"]);
      expect(absent[0]!.state === "absent" && absent[0]!.reason).toContain("refused rather than repaired");
    }
  });

  it("ships the cited facade-material citation on exactly one asset, and the standard statement on the other thirteen", () => {
    const assembly = buildBlock835CanaryRelease(input(), BLOCK835_V3_CANARY_PROFILE).assemblies[0]!;
    const cited = assembly.assets.filter((asset) => asset.citedStyle !== undefined);
    expect(cited.map((asset) => asset.canonicalFeatureId)).toEqual(["doitt:778052"]);
    expect([...BLOCK835_V3_STYLE_OVERRIDES.keys()]).toEqual(cited.map((asset) => asset.canonicalFeatureId));
    const esb = cited[0]!;
    expect(esb.citedStyle!.evidenceRecordId).toBe(ESB_FACADE_MATERIAL_RECORD_ID);
    expect(esb.citedStyle!.styleClass).toBe("stone-neutral");
    expect(esb.citedStyle!.fact).toContain("Indiana limestone");
    expect(esb.citedStyle!.provider).toBe("wikipedia");
    // The uncertainty statement follows the citation, per asset, so the cited
    // asset cannot wear the "derived from no observation" wording.
    expect(esb.uncertainty).toBe(DETERMINISTIC_FACADE_V3_CITED_STYLE_UNCERTAINTY);
    for (const asset of assembly.assets) {
      if (asset.canonicalFeatureId === "doitt:778052") continue;
      expect(asset.citedStyle, `${asset.canonicalFeatureId} must carry no citation`).toBeUndefined();
      expect(asset.uncertainty).toBe(DETERMINISTIC_FACADE_V3_UNCERTAINTY);
    }
    // A cited style class is not a texture, and the release still ships none.
    expect(assembly.assets.every((asset) => asset.lods.every((lod) => lod.quality.textureCount === 0))).toBe(true);
  });

  it("changed materials only: the cited override moved no geometry, so the measured frame gate still holds", () => {
    // The V3 package is the pre-override lineage this one supersedes. Per-LOD
    // triangle, quad and vertex counts must be identical across all fourteen,
    // which is what makes the P0 frame measurement valid for these bytes.
    const before = JSON.parse(new TextDecoder().decode(read("public/data/manhattan-esb-block-reference-20260811-v3/manifest.json"))) as {
      assets: { canonicalFeatureId: string; lods: { lodId: string; quality: Record<string, number> }[] }[];
    };
    const after = buildBlock835CanaryRelease(input(), BLOCK835_V3_CANARY_PROFILE).assemblies[0]!;
    const key = (asset: { canonicalFeatureId: string; lods: { lodId: string; quality: Record<string, number> }[] }) =>
      asset.lods.map((lod) => `${lod.lodId}:${lod.quality.triangleCount}:${lod.quality.materialCount}:${lod.quality.textureCount}`).join("|");
    const beforeById = new Map(before.assets.map((asset) => [asset.canonicalFeatureId, key(asset)]));
    for (const asset of after.assets) {
      expect(key(asset as never), `${asset.canonicalFeatureId} geometry cost changed`).toBe(beforeById.get(asset.canonicalFeatureId));
    }
    expect(after.assets).toHaveLength(before.assets.length);
  });

  it("writes no private byte and pins its private ancestry by checksum alone", () => {
    const built = buildBlock835CanaryRelease(input(), BLOCK835_V3_CANARY_PROFILE);
    const privateRoot = built.graph.roots.find((root) => root.audience === "private")!;
    const publicRoot = built.graph.roots.find((root) => root.audience === "public")!;
    expect(privateRoot.artifacts).toHaveLength(1);
    expect(publicRoot.privatePredecessor).toEqual({ rootId: privateRoot.rootId, rootChecksumSha256: privateRoot.rootChecksumSha256 });
    for (const path of built.files.keys()) expect(path.startsWith("private/")).toBe(false);
    expect([...built.files.keys()].some((path) => path.toLowerCase().includes("private"))).toBe(false);
  });

  it("leaves the frozen V2 release reachable and byte-identical through the same emitter", () => {
    // The parameterisation must not be a rewrite of V2. Rebuilding V2 through
    // the now-two-profile emitter has to reproduce the committed bytes exactly.
    const v2 = buildBlock835CanaryRelease(input(BLOCK835_CANARY_V2_PROFILE), BLOCK835_CANARY_V2_PROFILE);
    for (const [path, bytes] of v2.files) expect(bytesEqual(bytes, read(`${V2_OUTPUT}/${path}`)), `V2 drift in ${path}`).toBe(true);
    // ...and the two releases share no logical node identity.
    const v3 = buildBlock835CanaryRelease(input(), BLOCK835_V3_CANARY_PROFILE);
    expect(v3.graph.ownershipLedger.ledgerId).not.toBe(v2.graph.ownershipLedger.ledgerId);
    expect(v3.graph.snapshots[0]!.snapshotId).not.toBe(v2.graph.snapshots[0]!.snapshotId);
    expect(v3.graph.cellReleases[0]!.cellReleaseId).not.toBe(v2.graph.cellReleases[0]!.cellReleaseId);
  });

  it("refuses an input package that is not the one this profile promotes", () => {
    expect(() => buildBlock835CanaryRelease(input(BLOCK835_CANARY_V2_PROFILE), BLOCK835_V3_CANARY_PROFILE)).toThrow(/input package is manhattan-esb-block-reference-20260811,/);
    expect(() => buildBlock835CanaryRelease(input(), BLOCK835_CANARY_V2_PROFILE)).toThrow(/input package is manhattan-esb-block-reference-20260811-v3e,/);
  });

  it("declares every emitted public artifact at its emitted checksum", () => {
    const built = buildBlock835CanaryRelease(input(), BLOCK835_V3_CANARY_PROFILE);
    const publicRoot = built.graph.roots.find((root) => root.audience === "public")!;
    for (const artifact of publicRoot.artifacts) {
      const bytes = read(`${OUTPUT}/${artifact.relativeRef}`);
      expect(sha256HexBytes(bytes), `${artifact.relativeRef} checksum`).toBe(artifact.checksumSha256);
      expect(bytes.byteLength).toBe(artifact.byteSize);
    }
  });
});
