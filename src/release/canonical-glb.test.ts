/**
 * The triangle path is additive. These tests exist to prove that: a quad-only
 * input must still produce the exact bytes the quad-only writer produced, or
 * every committed package (V1, V2, Midtown) silently drifts.
 */
import { describe, expect, it } from "vitest";
import { sha256HexBytes } from "../domain/deterministic-hash.ts";
import { writeCanonicalGlb, type CanonicalGlbMaterial, type CanonicalGlbQuad, type CanonicalGlbTri } from "./canonical-glb.ts";

const MATERIALS: readonly CanonicalGlbMaterial[] = [
  { baseColorFactor: [0.73, 0.48, 0.38, 1], metallicFactor: 0, roughnessFactor: 0.76 },
  { baseColorFactor: [0.44, 0.53, 0.58, 1], metallicFactor: 0.08, roughnessFactor: 0.18 },
  { baseColorFactor: [0.29, 0.36, 0.31, 1], metallicFactor: 0.12, roughnessFactor: 0.82 },
];

function quad(materialIndex: number, x: number, z: number): CanonicalGlbQuad {
  return { materialIndex, corners: [[x, 0, z], [x + 3.25, 0, z], [x + 3.25, 4.5, z], [x, 4.5, z]] };
}

const QUAD_ONLY_FIXTURE: readonly CanonicalGlbQuad[] = [quad(1, 0, 0), quad(0, 4, 0), quad(2, 8, 0), quad(0, 12, 0), quad(1, 16, 2.5)];
const QUAD_ONLY_METADATA = { note: "quad-only byte-identity fixture", version: 3 } as const;

/**
 * Produced by the quad-only writer as of commit 9120354, before
 * `CanonicalGlbTri` existed. It is a frozen byte claim, not a convenience
 * snapshot: if it moves, the committed release artifacts moved with it.
 */
const QUAD_ONLY_PRE_TRIANGLE_SHA256 = "2e5b6aa1558359a11b6693181f3f57bd97104ef51d3f510a06d7bb6d60117531";
const QUAD_ONLY_PRE_TRIANGLE_BYTE_LENGTH = 2_024;

function sha256(bytes: Uint8Array): string {
  return sha256HexBytes(bytes);
}

function glbJson(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Record<string, unknown>;
}

describe("quad-only output is unaffected by the triangle path", () => {
  it("reproduces the pre-triangle bytes exactly", () => {
    const written = writeCanonicalGlb({ quads: QUAD_ONLY_FIXTURE, materials: MATERIALS, metadata: QUAD_ONLY_METADATA });
    expect(sha256(written.bytes)).toBe(QUAD_ONLY_PRE_TRIANGLE_SHA256);
    expect(written.bytes.byteLength).toBe(QUAD_ONLY_PRE_TRIANGLE_BYTE_LENGTH);
    expect(written.counts).toEqual({ triangleCount: 10, materialCount: 3, textureCount: 0 });
  });

  it("treats an omitted and an empty triangle list identically", () => {
    const omitted = writeCanonicalGlb({ quads: QUAD_ONLY_FIXTURE, materials: MATERIALS, metadata: QUAD_ONLY_METADATA });
    const empty = writeCanonicalGlb({ quads: QUAD_ONLY_FIXTURE, triangles: [], materials: MATERIALS, metadata: QUAD_ONLY_METADATA });
    expect(sha256(empty.bytes)).toBe(sha256(omitted.bytes));
  });
});

describe("triangles ride in the same material-grouped primitives", () => {
  const triangles: readonly CanonicalGlbTri[] = [
    { materialIndex: 0, a: [0, 9, 0], b: [2, 9, 0], c: [1, 11, 0] },
    { materialIndex: 0, a: [2, 9, 0], b: [4, 9, 0], c: [3, 11, 0] },
    { materialIndex: 2, a: [0, 9, 5], b: [2, 9, 5], c: [1, 11, 5] },
  ];

  it("keeps one primitive per material rather than one per topology", () => {
    const written = writeCanonicalGlb({ quads: QUAD_ONLY_FIXTURE, triangles, materials: MATERIALS, metadata: {} });
    const json = glbJson(written.bytes) as { meshes: Array<{ primitives: unknown[] }>; materials: unknown[] };
    expect(json.meshes[0]!.primitives).toHaveLength(3);
    expect(json.materials).toHaveLength(3);
    expect(written.counts).toEqual({ triangleCount: 13, materialCount: 3, textureCount: 0 });
  });

  it("appends triangle vertices after the quad vertices of the same material", () => {
    const written = writeCanonicalGlb({ quads: [quad(0, 0, 0)], triangles: [{ materialIndex: 0, a: [7, 0, 0], b: [8, 0, 0], c: [7, 1, 0] }], materials: MATERIALS, metadata: {} });
    const json = glbJson(written.bytes) as { accessors: Array<{ count: number; type: string }> };
    // Four quad corners then three triangle corners; six quad indices then three.
    expect(json.accessors[0]).toMatchObject({ count: 7, type: "VEC3" });
    expect(json.accessors[1]).toMatchObject({ count: 9, type: "SCALAR" });
  });

  it("writes a triangle-only mesh without any quad", () => {
    const written = writeCanonicalGlb({ quads: [], triangles: [{ materialIndex: 1, a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }], materials: MATERIALS, metadata: {} });
    expect(written.counts).toEqual({ triangleCount: 1, materialCount: 1, textureCount: 0 });
    const json = glbJson(written.bytes) as { accessors: Array<{ min: number[]; max: number[] }> };
    expect(json.accessors[0]!.min).toEqual([0, 0, 0]);
    expect(json.accessors[0]!.max).toEqual([1, 1, 0]);
  });
});

describe("the writer still fails closed", () => {
  it("refuses an input with no geometry at all", () => {
    expect(() => writeCanonicalGlb({ quads: [], triangles: [], materials: MATERIALS, metadata: {} })).toThrow(/at least one quad or triangle/u);
  });

  it("refuses a triangle citing an undeclared material", () => {
    expect(() => writeCanonicalGlb({ quads: [], triangles: [{ materialIndex: 3, a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }], materials: MATERIALS, metadata: {} })).toThrow(/undeclared material/u);
  });

  it("refuses a non-finite triangle coordinate", () => {
    expect(() => writeCanonicalGlb({ quads: [], triangles: [{ materialIndex: 0, a: [0, 0, 0], b: [Number.NaN, 0, 0], c: [0, 1, 0] }], materials: MATERIALS, metadata: {} })).toThrow(/non-finite coordinate/u);
  });
});
