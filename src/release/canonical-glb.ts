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
 * Explicit sampler filtering for the embedded detail tiles.
 *
 * glTF makes `minFilter`/`magFilter` OPTIONAL, and an absent pair means "the
 * renderer picks". That is not a neutral default: a detail tile repeated tens or
 * hundreds of times across one facade is exactly the regime where an
 * unmipmapped, nearest-neighbour or renderer-chosen filter produces moire, and
 * "whatever the renderer picks" is not a property shipped bytes can be validated
 * against. Naming the pair makes the filtering a decided, reviewable property of
 * the artifact rather than a per-renderer accident.
 *
 * The closed glTF profile in `multi-lod-assembly.ts` has always validated both
 * fields against closed value sets, so nothing about the wire format changes.
 */
export interface CanonicalGlbSamplerFilter {
  /** One of the glTF magnification filters: NEAREST (9728) or LINEAR (9729). */
  magFilter: number;
  /** One of the six glTF minification filters, including the four mipmapped ones. */
  minFilter: number;
}

/** LINEAR magnification with trilinear (LINEAR_MIPMAP_LINEAR) minification. */
export const GLB_SAMPLER_FILTER_TRILINEAR: CanonicalGlbSamplerFilter = { magFilter: 9729, minFilter: 9987 };

const GLB_MAG_FILTERS = new Set([9728, 9729]);
const GLB_MIN_FILTERS = new Set([9728, 9729, 9984, 9985, 9986, 9987]);

/**
 * The optional texture set for one GLB.
 *
 * `materialImage` is parallel to `materials`: an entry names the image that
 * material samples through `baseColorTexture`, or `null` for an untextured
 * material. Images no used material references are dropped rather than embedded,
 * so an unreferenced image can never ride along in the bytes.
 *
 * `filter` is OPTIONAL and absent by default, which reproduces the wrap-only
 * sampler this writer emitted before the field existed. Every committed textured
 * artifact is pinned against that shape, so adding the field cannot move a
 * frozen byte; a package that wants decided filtering opts in explicitly.
 */
export interface CanonicalGlbTextureSet {
  images: readonly CanonicalGlbImage[];
  materialImage: readonly (number | null)[];
  filter?: CanonicalGlbSamplerFilter;
}

/**
 * One detail tile referenced by RELATIVE URI instead of embedded in the BIN.
 *
 * The bytes live once per release, as a declared package artifact, and every
 * GLB that draws that class names the same URI. This is the whole mechanism
 * behind the shared-class-texture work: Cesium's texture cache keys an embedded
 * image by the OWNING MODEL's absolute URL, so 941 embedded copies of four
 * tiles decode into 941 GPU textures with zero content dedupe, while an
 * external image is keyed by its own resolved absolute URI and therefore
 * collapses to one GPU texture per distinct URI.
 *
 * The URI is deliberately not a byte payload: this writer still never encodes
 * an image, and the release validator still REPLAYS the referenced artifact
 * against `procedural-texture.ts`. Moving the bytes out of the GLB moves where
 * the replay happens, never whether it happens.
 */
export interface CanonicalGlbUriImage {
  mimeType: "image/png";
  /**
   * Strict relative reference resolved against the GLB's own location. The
   * authoritative containment rule -- canonical segments, no escape past the
   * package root, audience-rooted resolution, and resolution to a DECLARED
   * texture artifact -- lives in `validateProceduralTextureUriGlb`; the check
   * here is a cheap shape guard so a malformed URI cannot reach shipped bytes.
   */
  uri: string;
}

/** The URI-image sibling of `CanonicalGlbTextureSet`; identical in every other respect. */
export interface CanonicalGlbUriTextureSet {
  images: readonly CanonicalGlbUriImage[];
  materialImage: readonly (number | null)[];
  filter?: CanonicalGlbSamplerFilter;
}

/**
 * The same relative-reference shape `resolveTilesetUri` accepts in
 * `multi-lod-assembly.ts`: no absolute path, no scheme, no percent/query/
 * fragment/backslash, no control characters, and canonical segments only.
 */
function isStrictRelativeImageUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/")) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) || /[%?#\\]/u.test(value)) return false;
  if ([...value].some((part) => part.charCodeAt(0) <= 0x20 || part.charCodeAt(0) === 0x7f)) return false;
  return value.split("/").every((segment) => segment === ".." || /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment));
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
  /**
   * Optional EXTERNAL detail tiles, mutually exclusive with `textures`.
   *
   * Supplying neither reproduces the untextured bytes; supplying `textures`
   * reproduces the embedded bytes EXACTLY, because this branch adds no key and
   * no bufferView to that path. Every geometry accessor, UV, material, sampler
   * and texture record is produced by the same code in both texture modes --
   * only where the image bytes live differs.
   */
  uriTextures?: CanonicalGlbUriTextureSet;
}): CanonicalGlbResult {
  const { quads, materials, metadata } = options;
  const triangles = options.triangles ?? [];
  if (quads.length === 0 && triangles.length === 0) throw new Error("Canonical GLB requires at least one quad or triangle.");
  const embeddedSet = options.textures;
  const uriSet = options.uriTextures;
  if (embeddedSet && uriSet) throw new Error("Canonical GLB accepts embedded or external-URI detail tiles, never both.");
  const textureSet: { images: readonly { mimeType: string }[]; materialImage: readonly (number | null)[]; filter?: CanonicalGlbSamplerFilter } | undefined = embeddedSet ?? uriSet;
  if (textureSet) {
    if (textureSet.materialImage.length !== materials.length) throw new Error("Canonical GLB texture set must name one image slot per declared material.");
    for (const image of embeddedSet?.images ?? []) {
      if (image.mimeType !== "image/png") throw new Error("Canonical GLB embeds PNG detail tiles only.");
      if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0) throw new Error("Canonical GLB image bytes are empty.");
    }
    for (const image of uriSet?.images ?? []) {
      if (image.mimeType !== "image/png") throw new Error("Canonical GLB references PNG detail tiles only.");
      if (!isStrictRelativeImageUri(image.uri)) throw new Error("Canonical GLB image URI is not a strict local relative reference.");
    }
    for (const slot of textureSet.materialImage) {
      if (slot === null) continue;
      if (!Number.isSafeInteger(slot) || slot < 0 || slot >= textureSet.images.length) throw new Error("Canonical GLB material cites an undeclared image.");
    }
    if (textureSet.filter !== undefined && (!GLB_MAG_FILTERS.has(textureSet.filter.magFilter) || !GLB_MIN_FILTERS.has(textureSet.filter.minFilter))) {
      throw new Error("Canonical GLB sampler filter is outside the closed glTF filter sets.");
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

  // Only images a USED material samples are kept, and they are renumbered into
  // that order. An image nothing draws is dropped, which closes the one route
  // by which an unreferenced payload could sit inside a conforming GLB. The
  // rule is identical for embedded and external images; only the emission
  // below differs.
  const usedImageIndexes: number[] = [];
  if (textureSet) {
    for (const materialIndex of usedMaterialIndexes) {
      const slot = textureSet.materialImage[materialIndex] ?? null;
      if (slot !== null && !usedImageIndexes.includes(slot)) usedImageIndexes.push(slot);
    }
    usedImageIndexes.sort((left, right) => left - right);
  }
  const textureOfImage = new Map(usedImageIndexes.map((imageIndex, position) => [imageIndex, position]));
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
  if (embeddedSet) {
    for (const imageIndex of usedImageIndexes) {
      const image = embeddedSet.images[imageIndex]!;
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
    // `usedImageIndexes.length` is identical to `imageViewIndexes.length` on the
    // embedded path (the loop above pushes exactly one view per used image), so
    // the frozen embedded bytes are unmoved; it is simply also correct when the
    // images are external and no view exists.
    ...(usedImageIndexes.length === 0 ? {} : {
      images: embeddedSet
        ? imageViewIndexes.map((bufferView) => ({ bufferView, mimeType: "image/png" }))
        : usedImageIndexes.map((imageIndex) => ({ uri: uriSet!.images[imageIndex]!.uri, mimeType: "image/png" })),
      // Filter keys are emitted only when the caller decided them, so the
      // wrap-only sampler an existing textured package ships is unchanged.
      samplers: [{ ...(textureSet?.filter ? { magFilter: textureSet.filter.magFilter, minFilter: textureSet.filter.minFilter } : {}), wrapS: WRAP_REPEAT, wrapT: WRAP_REPEAT }],
      textures: usedImageIndexes.map((_, source) => ({ sampler: 0, source })),
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
  return { bytes, counts: { triangleCount, materialCount: usedMaterialIndexes.length, textureCount: usedImageIndexes.length } };
}
