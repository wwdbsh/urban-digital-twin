import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sha256HexBytes, stableSerialize } from "../domain/deterministic-hash.ts";
import { validateExteriorReleaseGraph, type ExteriorReleaseGraph } from "./exterior-release.ts";
import { validateExteriorCellReleaseIndex } from "../runtime/exterior-cell-runtime.ts";
import { validateMultiLodAssembly } from "./multi-lod-assembly.ts";
import { BLOCK835_CANARY_PILOT_RELEASE_PATH, BLOCK835_CANARY_V2_PROFILE, buildBlock835CanaryRelease } from "./block835-canary-release.ts";
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
    expect(() => buildBlock835CanaryRelease(input(), BLOCK835_CANARY_V2_PROFILE)).toThrow(/input package is manhattan-esb-block-reference-20260811-v3,/);
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
