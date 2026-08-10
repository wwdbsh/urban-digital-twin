/**
 * Deterministic writer for the closed, texture-free GLB profile that
 * `validateGltfJson`/`validateTextureFreeGlb` in `multi-lod-assembly.ts` accept.
 *
 * The profile is deliberately narrower than glTF 2.0: `asset` carries only
 * `version`, no `name` survives anywhere, extensions are forbidden, every
 * bufferView must be accessor-referenced, the BIN must be gap-free from offset
 * zero, and the single root `extras.urbanDigitalTwin` record is the only
 * metadata surface. Blender's own exporter cannot emit that profile (it writes
 * `asset.generator`, object names, and an unreferenced tail), so shipped bytes
 * are written here while Blender remains the authoring/inspection authority.
 */

export type Vec3 = readonly [number, number, number];

export interface CanonicalGlbMaterial {
  /** Normalized sRGB palette factor; not a colorimetric claim about the real building. */
  baseColorFactor: readonly [number, number, number, number];
  metallicFactor: number;
  roughnessFactor: number;
}

/** One planar quad, wound counter-clockwise when viewed from its outward face. */
export interface CanonicalGlbQuad {
  materialIndex: number;
  corners: readonly [Vec3, Vec3, Vec3, Vec3];
}

export interface CanonicalGlbCounts { triangleCount: number; materialCount: number; textureCount: number }

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const ARRAY_BUFFER_TARGET = 34962;
const ELEMENT_ARRAY_BUFFER_TARGET = 34963;
const FLOAT_COMPONENT = 5126;
const UNSIGNED_INT_COMPONENT = 5125;

function align4(value: number): number { return Math.ceil(value / 4) * 4; }

/**
 * Rounds through Float32 so the JSON accessor bounds equal the stored BIN
 * values exactly; a double-valued min/max would drift from the shipped bytes.
 */
function f32(value: number): number { return Math.fround(value); }

export interface CanonicalGlbResult { bytes: Uint8Array; counts: CanonicalGlbCounts }

export function writeCanonicalGlb(options: {
  quads: readonly CanonicalGlbQuad[];
  materials: readonly CanonicalGlbMaterial[];
  metadata: Readonly<Record<string, unknown>>;
}): CanonicalGlbResult {
  const { quads, materials, metadata } = options;
  if (quads.length === 0) throw new Error("Canonical GLB requires at least one quad.");
  const grouped = new Map<number, CanonicalGlbQuad[]>();
  for (const quad of quads) {
    if (!Number.isSafeInteger(quad.materialIndex) || quad.materialIndex < 0 || quad.materialIndex >= materials.length) throw new Error("Canonical GLB quad cites an undeclared material.");
    const bucket = grouped.get(quad.materialIndex);
    if (bucket) bucket.push(quad); else grouped.set(quad.materialIndex, [quad]);
  }
  const usedMaterialIndexes = [...grouped.keys()].sort((left, right) => left - right);

  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const primitives: Array<Record<string, unknown>> = [];
  const segments: Uint8Array[] = [];
  let offset = 0;
  let triangleCount = 0;

  usedMaterialIndexes.forEach((materialIndex, primitiveIndex) => {
    const bucket = grouped.get(materialIndex)!;
    const vertexCount = bucket.length * 4;
    const indexCount = bucket.length * 6;
    const positions = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(indexCount);
    const minimum: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const maximum: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    bucket.forEach((quad, quadIndex) => {
      quad.corners.forEach((corner, cornerIndex) => {
        const base = (quadIndex * 4 + cornerIndex) * 3;
        for (let axis = 0; axis < 3; axis += 1) {
          const value = f32(corner[axis]!);
          if (!Number.isFinite(value)) throw new Error("Canonical GLB quad contains a non-finite coordinate.");
          positions[base + axis] = value;
          if (value < minimum[axis]!) minimum[axis] = value;
          if (value > maximum[axis]!) maximum[axis] = value;
        }
      });
      const first = quadIndex * 4;
      indices.set([first, first + 1, first + 2, first, first + 2, first + 3], quadIndex * 6);
    });
    triangleCount += bucket.length * 2;

    const positionBytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
    const indexBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: positionBytes.byteLength, target: ARRAY_BUFFER_TARGET });
    segments.push(positionBytes); offset += positionBytes.byteLength;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: indexBytes.byteLength, target: ELEMENT_ARRAY_BUFFER_TARGET });
    segments.push(indexBytes); offset += indexBytes.byteLength;

    const positionAccessor = primitiveIndex * 2;
    accessors.push({ bufferView: positionAccessor, componentType: FLOAT_COMPONENT, count: vertexCount, type: "VEC3", min: [...minimum], max: [...maximum] });
    accessors.push({ bufferView: positionAccessor + 1, componentType: UNSIGNED_INT_COMPONENT, count: indexCount, type: "SCALAR" });
    primitives.push({ attributes: { POSITION: positionAccessor }, indices: positionAccessor + 1, material: primitiveIndex, mode: 4 });
  });

  const binLength = align4(offset);
  const bin = new Uint8Array(binLength);
  let cursor = 0;
  for (const segment of segments) { bin.set(segment, cursor); cursor += segment.byteLength; }

  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: binLength }],
    bufferViews,
    accessors,
    meshes: [{ primitives }],
    materials: usedMaterialIndexes.map((materialIndex) => {
      const material = materials[materialIndex]!;
      return { pbrMetallicRoughness: { baseColorFactor: [...material.baseColorFactor], metallicFactor: material.metallicFactor, roughnessFactor: material.roughnessFactor } };
    }),
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    extras: { urbanDigitalTwin: metadata },
  };

  const jsonRaw = new TextEncoder().encode(JSON.stringify(json));
  const jsonBytes = new Uint8Array(align4(jsonRaw.byteLength));
  jsonBytes.fill(0x20);
  jsonBytes.set(jsonRaw);
  const total = 12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, GLB_MAGIC, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true); view.setUint32(16, GLB_JSON_CHUNK, true);
  bytes.set(jsonBytes, 20);
  const binHeader = 20 + jsonBytes.byteLength;
  view.setUint32(binHeader, bin.byteLength, true); view.setUint32(binHeader + 4, GLB_BIN_CHUNK, true);
  bytes.set(bin, binHeader + 8);
  return { bytes, counts: { triangleCount, materialCount: usedMaterialIndexes.length, textureCount: 0 } };
}
