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
export type Vec2 = readonly [number, number];

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
  /** Required exactly when this quad's material samples a texture; ignored otherwise. */
  uv?: readonly [Vec2, Vec2, Vec2, Vec2];
}

/**
 * One triangle, wound counter-clockwise when viewed from its outward face.
 *
 * The closed profile has always accepted arbitrary indexed `TRIANGLES`; only
 * this writer was quad-only, which forced every generated cap to decompose into
 * quads. A concave footprint cannot: its roof and setback decks triangulate into
 * an odd, non-quad fan. Triangles are written *after* the quads inside each
 * material bucket, so a quad-only input still produces the exact bytes it did
 * before this type existed and every committed package stays byte-frozen.
 */
export interface CanonicalGlbTri {
  materialIndex: number;
  a: Vec3;
  b: Vec3;
  c: Vec3;
  /** Required exactly when this triangle's material samples a texture. */
  uv?: readonly [Vec2, Vec2, Vec2];
}

export interface CanonicalGlbCounts { triangleCount: number; materialCount: number; textureCount: number }

/**
 * One embedded detail tile.
 *
 * The writer takes finished bytes and never encodes an image itself: the bytes
 * must come from a source the release validator can REPLAY, which today means
 * `procedural-texture.ts` and nothing else. Keeping the encoder out of the
 * writer is what stops "the writer can embed a PNG" from becoming "the writer
 * can embed any PNG".
 */
export interface CanonicalGlbImage {
  mimeType: "image/png";
  bytes: Uint8Array;
}

/**
 * The optional texture set for one GLB.
 *
 * `materialImage` is parallel to `materials`: an entry names the image that
 * material samples through `baseColorTexture`, or `null` for an untextured
 * material. Images no used material references are dropped rather than embedded,
 * so an unreferenced image can never ride along in the bytes.
 */
export interface CanonicalGlbTextureSet {
  images: readonly CanonicalGlbImage[];
  materialImage: readonly (number | null)[];
}

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const ARRAY_BUFFER_TARGET = 34962;
const ELEMENT_ARRAY_BUFFER_TARGET = 34963;
const FLOAT_COMPONENT = 5126;
const UNSIGNED_INT_COMPONENT = 5125;
/** REPEAT on both axes: a detail tile is meaningless without it. */
const WRAP_REPEAT = 10497;

function align4(value: number): number { return Math.ceil(value / 4) * 4; }

/**
 * Rounds through Float32 so the JSON accessor bounds equal the stored BIN
 * values exactly; a double-valued min/max would drift from the shipped bytes.
 */
function f32(value: number): number { return Math.fround(value); }

export interface CanonicalGlbResult { bytes: Uint8Array; counts: CanonicalGlbCounts }

export function writeCanonicalGlb(options: {
  quads: readonly CanonicalGlbQuad[];
  /** Optional and appended after the quads of the same material; see `CanonicalGlbTri`. */
  triangles?: readonly CanonicalGlbTri[];
  materials: readonly CanonicalGlbMaterial[];
  metadata: Readonly<Record<string, unknown>>;
  /**
   * Optional embedded detail tiles.
   *
   * Omitting it reproduces the untextured writer's bytes EXACTLY — not
   * approximately, and not "modulo formatting". Every committed V1/V2/V3 and
   * Midtown package is byte-frozen against that path, so the textured branch
   * adds JSON keys and bufferViews only when this option is present, and
   * `canonical-glb.test.ts` pins the frozen digest.
   */
  textures?: CanonicalGlbTextureSet;
}): CanonicalGlbResult {
  const { quads, materials, metadata } = options;
  const triangles = options.triangles ?? [];
  if (quads.length === 0 && triangles.length === 0) throw new Error("Canonical GLB requires at least one quad or triangle.");
  const textureSet = options.textures;
  if (textureSet) {
    if (textureSet.materialImage.length !== materials.length) throw new Error("Canonical GLB texture set must name one image slot per declared material.");
    for (const image of textureSet.images) {
      if (image.mimeType !== "image/png") throw new Error("Canonical GLB embeds PNG detail tiles only.");
      if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0) throw new Error("Canonical GLB image bytes are empty.");
    }
    for (const slot of textureSet.materialImage) {
      if (slot === null) continue;
      if (!Number.isSafeInteger(slot) || slot < 0 || slot >= textureSet.images.length) throw new Error("Canonical GLB material cites an undeclared image.");
    }
  }
  interface Bucket { quads: CanonicalGlbQuad[]; triangles: CanonicalGlbTri[] }
  const grouped = new Map<number, Bucket>();
  const bucketFor = (materialIndex: number): Bucket => {
    if (!Number.isSafeInteger(materialIndex) || materialIndex < 0 || materialIndex >= materials.length) throw new Error("Canonical GLB quad cites an undeclared material.");
    let bucket = grouped.get(materialIndex);
    if (!bucket) { bucket = { quads: [], triangles: [] }; grouped.set(materialIndex, bucket); }
    return bucket;
  };
  for (const quad of quads) bucketFor(quad.materialIndex).quads.push(quad);
  for (const triangle of triangles) bucketFor(triangle.materialIndex).triangles.push(triangle);
  const usedMaterialIndexes = [...grouped.keys()].sort((left, right) => left - right);

  // Only images a USED material samples are embedded, and they are renumbered
  // into that order. An image nothing draws is dropped, which closes the one
  // route by which an unreferenced payload could sit inside a conforming GLB.
  const embeddedImageIndexes: number[] = [];
  if (textureSet) {
    for (const materialIndex of usedMaterialIndexes) {
      const slot = textureSet.materialImage[materialIndex] ?? null;
      if (slot !== null && !embeddedImageIndexes.includes(slot)) embeddedImageIndexes.push(slot);
    }
    embeddedImageIndexes.sort((left, right) => left - right);
  }
  const textureOfImage = new Map(embeddedImageIndexes.map((imageIndex, position) => [imageIndex, position]));
  const textureOfMaterial = (materialIndex: number): number | null => {
    if (!textureSet) return null;
    const slot = textureSet.materialImage[materialIndex] ?? null;
    return slot === null ? null : textureOfImage.get(slot) ?? null;
  };

  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const primitives: Array<Record<string, unknown>> = [];
  const segments: Uint8Array[] = [];
  let offset = 0;
  let triangleCount = 0;

  usedMaterialIndexes.forEach((materialIndex, primitiveIndex) => {
    const bucket = grouped.get(materialIndex)!;
    const textureIndex = textureOfMaterial(materialIndex);
    const vertexCount = bucket.quads.length * 4 + bucket.triangles.length * 3;
    const indexCount = bucket.quads.length * 6 + bucket.triangles.length * 3;
    const positions = new Float32Array(vertexCount * 3);
    const coordinates = textureIndex === null ? null : new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(indexCount);
    const writeCoordinate = (uv: Vec2 | undefined, vertexIndex: number): void => {
      if (!coordinates) return;
      if (!uv) throw new Error("Canonical GLB face on a textured material carries no UV coordinates.");
      for (let axis = 0; axis < 2; axis += 1) {
        const value = f32(uv[axis]!);
        if (!Number.isFinite(value)) throw new Error("Canonical GLB face contains a non-finite UV coordinate.");
        coordinates[vertexIndex * 2 + axis] = value;
      }
    };
    const minimum: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const maximum: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const writeCorner = (corner: Vec3, vertexIndex: number): void => {
      const base = vertexIndex * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = f32(corner[axis]!);
        if (!Number.isFinite(value)) throw new Error("Canonical GLB quad contains a non-finite coordinate.");
        positions[base + axis] = value;
        if (value < minimum[axis]!) minimum[axis] = value;
        if (value > maximum[axis]!) maximum[axis] = value;
      }
    };
    bucket.quads.forEach((quad, quadIndex) => {
      quad.corners.forEach((corner, cornerIndex) => writeCorner(corner, quadIndex * 4 + cornerIndex));
      for (let cornerIndex = 0; cornerIndex < 4; cornerIndex += 1) writeCoordinate(quad.uv?.[cornerIndex], quadIndex * 4 + cornerIndex);
      const first = quadIndex * 4;
      indices.set([first, first + 1, first + 2, first, first + 2, first + 3], quadIndex * 6);
    });
    const triangleVertexBase = bucket.quads.length * 4;
    const triangleIndexBase = bucket.quads.length * 6;
    bucket.triangles.forEach((triangle, triangleIndex) => {
      const first = triangleVertexBase + triangleIndex * 3;
      writeCorner(triangle.a, first);
      writeCorner(triangle.b, first + 1);
      writeCorner(triangle.c, first + 2);
      writeCoordinate(triangle.uv?.[0], first);
      writeCoordinate(triangle.uv?.[1], first + 1);
      writeCoordinate(triangle.uv?.[2], first + 2);
      indices.set([first, first + 1, first + 2], triangleIndexBase + triangleIndex * 3);
    });
    triangleCount += bucket.quads.length * 2 + bucket.triangles.length;

    const positionBytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
    const indexBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
    const positionAccessor = accessors.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: positionBytes.byteLength, target: ARRAY_BUFFER_TARGET });
    accessors.push({ bufferView: bufferViews.length - 1, componentType: FLOAT_COMPONENT, count: vertexCount, type: "VEC3", min: [...minimum], max: [...maximum] });
    segments.push(positionBytes); offset += positionBytes.byteLength;
    let coordinateAccessor: number | null = null;
    if (coordinates) {
      const coordinateBytes = new Uint8Array(coordinates.buffer, coordinates.byteOffset, coordinates.byteLength);
      bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: coordinateBytes.byteLength, target: ARRAY_BUFFER_TARGET });
      coordinateAccessor = accessors.length;
      accessors.push({ bufferView: bufferViews.length - 1, componentType: FLOAT_COMPONENT, count: vertexCount, type: "VEC2" });
      segments.push(coordinateBytes); offset += coordinateBytes.byteLength;
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: indexBytes.byteLength, target: ELEMENT_ARRAY_BUFFER_TARGET });
    const indexAccessor = accessors.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: UNSIGNED_INT_COMPONENT, count: indexCount, type: "SCALAR" });
    segments.push(indexBytes); offset += indexBytes.byteLength;

    primitives.push({
      attributes: coordinateAccessor === null ? { POSITION: positionAccessor } : { POSITION: positionAccessor, TEXCOORD_0: coordinateAccessor },
      indices: indexAccessor, material: primitiveIndex, mode: 4,
    });
  });

  // Image views come AFTER every geometry view, each padded to the 4-byte
  // alignment the profile's gap rule allows, so the BIN stays gap-free and the
  // untextured layout above is untouched.
  const imageViewIndexes: number[] = [];
  if (textureSet) {
    for (const imageIndex of embeddedImageIndexes) {
      const image = textureSet.images[imageIndex]!;
      imageViewIndexes.push(bufferViews.length);
      bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: image.bytes.byteLength });
      segments.push(image.bytes); offset += image.bytes.byteLength;
      const padding = align4(offset) - offset;
      if (padding > 0) { segments.push(new Uint8Array(padding)); offset += padding; }
    }
  }

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
      const textureIndex = textureOfMaterial(materialIndex);
      return {
        pbrMetallicRoughness: {
          baseColorFactor: [...material.baseColorFactor],
          ...(textureIndex === null ? {} : { baseColorTexture: { index: textureIndex } }),
          metallicFactor: material.metallicFactor,
          roughnessFactor: material.roughnessFactor,
        },
      };
    }),
    // Absent entirely when no texture set was supplied, so the untextured JSON
    // is byte-for-byte what it was before this branch existed.
    ...(imageViewIndexes.length === 0 ? {} : {
      images: imageViewIndexes.map((bufferView) => ({ bufferView, mimeType: "image/png" })),
      samplers: [{ wrapS: WRAP_REPEAT, wrapT: WRAP_REPEAT }],
      textures: imageViewIndexes.map((_, source) => ({ sampler: 0, source })),
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
  return { bytes, counts: { triangleCount, materialCount: usedMaterialIndexes.length, textureCount: imageViewIndexes.length } };
}
