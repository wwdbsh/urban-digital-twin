/**
 * Procedural facade detail tiles: a deterministic, replayable, image-free
 * texture profile.
 *
 * Every byte a package embeds under this profile is produced here, by a pure
 * function of the named constants in this file and nothing else. No image was
 * ingested, decoded, traced, sampled or reproduced to build it. That is not a
 * promise in a metadata string — it is a structural property the release
 * validator re-checks: `validateProceduralTextureGlb` recomputes the whole
 * catalogue and requires BYTE EQUALITY with every embedded PNG. A tile derived
 * from a photograph is unreproducible by definition, so it fails closed.
 *
 * Three deliberate narrowings make that gate cheap and total:
 *
 * 1. GRAYSCALE, PATTERN ONLY. A tile carries luminance modulation — where the
 *    joints, courses, mullions and weathering streaks fall — and no colour at
 *    all. Colour stays in the per-material `baseColorFactor` the V3 grammar
 *    already designs, and glTF multiplies the two. So the tile cannot encode a
 *    colour claim about a real building even in principle, and a warm mortar or
 *    a bronze spandrel is expressed by the factor, never by the tile.
 * 2. STORED DEFLATE, WRITTEN HERE. `node:zlib` output is not contractually
 *    stable across Node or zlib versions, and this profile's entire gate is
 *    cross-process byte equality. The encoder below emits uncompressed DEFLATE
 *    blocks, so the PNG bytes are a total function of the pixels.
 * 3. FOUR CLASSES, FOUR IMAGES. The catalogue is closed. A package may embed at
 *    most one image per class it actually uses.
 *
 * What the tiles do NOT claim: nothing here asserts the material, colour, age,
 * condition or cladding of any real building. The dimensions are conventional
 * construction modules; the calibration behind them is design reference, not
 * measurement. See ADR 0032.
 */

import { sha256HexBytes, sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";

export const PROCEDURAL_TEXTURE_PROFILE = "procedural-texture-v1" as const;
export type ProceduralTextureProfile = typeof PROCEDURAL_TEXTURE_PROFILE;

/**
 * Bumped whenever the rasterizer's *code* changes in a way that can move a
 * pixel. The parameters hash covers the constants; this covers the algorithm.
 */
export const PROCEDURAL_TEXTURE_RASTERIZER_VERSION = "1.0.0" as const;

export const PROCEDURAL_TEXTURE_CLASSES = [
  "brick-running-bond",
  "limestone-ashlar",
  "curtain-mullion-grid",
  "spandrel-panel",
] as const;
export type ProceduralTextureClass = (typeof PROCEDURAL_TEXTURE_CLASSES)[number];

/**
 * 128x128 per tile.
 *
 * 64 was tried first and REFUSED on the evidence. At 64 pixels a tile wide
 * enough to resolve a 10 mm mortar joint holds only one brick, so the per-unit
 * variation degenerates into whole-course banding and the wall reads as stripes
 * rather than masonry — visible in the flat-tile stills before the change. 128
 * buys a 4x4 brick tile at 6.25 mm/px horizontally and 2.09 mm/px vertically,
 * which resolves the joint AND decorrelates sixteen units.
 *
 * The cost is bounded and measured: 128x128 grayscale under stored DEFLATE is
 * 16,589 bytes, against a 24 KiB per-image cap and a 96 KiB per-GLB cap, so a
 * three-class asset spends about 49 KiB. The size is part of the parameters
 * hash: changing it is a profile change, not a tweak.
 */
export const PROCEDURAL_TEXTURE_TILE_PIXELS = 128 as const;

/**
 * A joint narrower than one pixel would vanish, and a vanished joint is the one
 * failure that makes the whole motif read as flat paint. Sub-pixel joints are
 * drawn one pixel wide, and the millimetre parameter stays the honest design
 * intent rather than being rounded to whatever the tile grid can resolve.
 */
export const JOINT_MINIMUM_PIXELS = 1 as const;

/**
 * Floor on a motif's mean modulation.
 *
 * The tile MULTIPLIES the material factor, so its mean is exactly how much
 * darker the textured surface reads than the flat V3 material — and in linear
 * light, not sRGB, so the loss is steeper than the number looks. Contrast and
 * colour fidelity trade directly against each other here: every millimetre of
 * legible joint is bought with mean luminance. This floor is where that trade
 * was stopped, and `V3T_CALIBRATED_PALETTE` compensates the residue by dividing
 * the target colour through the measured mean.
 */
export const PROCEDURAL_TEXTURE_MINIMUM_MEAN_MODULATION = 0.82 as const;

export const PROCEDURAL_TEXTURE_LIMITS = {
  /** One image per texture class, and the catalogue has four classes. */
  maxImagesPerGlb: 4,
  maxImageBytes: 24 * 1024,
  maxGlbImageBytes: 96 * 1024,
} as const;

/**
 * One motif's construction module, in millimetres, plus its weathering
 * modulation. Every field is an integer so the parameters hash is exact.
 *
 * Geometry convention: `unitLengthMm`/`unitHeightMm` are the FULL module
 * including its joint; the joint occupies the top `jointMm` of the module
 * vertically and the right `jointMm` horizontally. `vMm` runs UPWARD in the
 * world, so "below the sill" means a smaller `vMm`.
 */
export interface MotifParameters {
  /** Tile extent in millimetres; an exact multiple of the module in both axes. */
  tileUMm: number;
  tileVMm: number;
  unitLengthMm: number;
  unitHeightMm: number;
  jointMm: number;
  /** Horizontal shift applied to odd courses: half a module gives running bond. */
  courseOffsetMm: number;
  /** Luminance of the unit face itself; the level the calibrated palette targets. */
  fieldLuminance: number;
  /** Bedded mortar reads LIGHTER than its brick; a recessed joint or mullion reads DARKER. */
  jointLuminance: number;
  /** Peak per-unit luminance spread; the draw is a pure hash of the unit index. */
  unitVariationAmplitude: number;
  /** Shadow the course above casts on the head of the face below. */
  courseShadowMm: number;
  courseShadowDrop: number;
  /** Ambient darkening where the face meets its own bed joint. */
  bedShadowMm: number;
  bedShadowDrop: number;
  /** Spandrel / infill band at the foot of each module; 0 when the motif has none. */
  spandrelBandMm: number;
  spandrelDrop: number;
  /**
   * Height WITHIN THE MODULE at which weathering streaks begin, running
   * downward and fading over `streakLengthMm`.
   *
   * Module-local, not tile-local, and that is a seam decision rather than a
   * stylistic one. A fade anchored to the tile leaves the streaks at full
   * strength along the tile's top edge and at zero along its bottom edge, so
   * every vertical repeat draws a clean horizontal band across the wall. Anchored
   * to the module, the only discontinuity falls exactly on a bed joint or a
   * transom mullion, where the joint itself hides it.
   */
  sillVMm: number;
  /** May exceed `unitHeightMm`: a long fade makes the per-module step small. */
  streakLengthMm: number;
  streakColumns: number;
  streakDrop: number;
}

/**
 * The motif parameter table.
 *
 * These are conventional construction modules, chosen against a written
 * calibration brief assembled by viewing public reference imagery of Midtown
 * street walls. The brief's conclusions are TEXT — module sizes, joint widths,
 * where weathering collects — and were transcribed here as numbers. No image
 * was ingested, decoded, sampled, traced or reproduced at any point, and no
 * pixel of any photograph reached this repository. The numbers below assert a
 * plausible construction module, never the construction of any real building.
 */
export const PROCEDURAL_TEXTURE_PARAMETERS: Readonly<Record<ProceduralTextureClass, Readonly<MotifParameters>>> = {
  /**
   * Modular brick: 190 x 57 mm face on a 10 mm joint, laid in running bond, so
   * the module is 200 x 67 mm and the tile is four bricks by four courses. The
   * half-brick offset on the odd course is what keeps the repeat from reading as
   * a grid, and sixteen units per tile is what keeps the per-unit variation from
   * collapsing into course-wide banding.
   */
  "brick-running-bond": {
    tileUMm: 800, tileVMm: 268,
    unitLengthMm: 200, unitHeightMm: 67, jointMm: 10,
    courseOffsetMm: 100,
    fieldLuminance: 214,
    // Mortar is lighter than the brick it beds. Its warm pink-gray tone is a
    // COLOUR fact and lives in `baseColorFactor`; a grayscale tile can only
    // carry the lightness difference, and deliberately carries nothing else.
    jointLuminance: 248,
    unitVariationAmplitude: 16,
    courseShadowMm: 8, courseShadowDrop: 20,
    bedShadowMm: 6, bedShadowDrop: 12,
    spandrelBandMm: 0, spandrelDrop: 0,
    sillVMm: 67, streakLengthMm: 268, streakColumns: 20, streakDrop: 14,
  },
  /**
   * Limestone ashlar: 250 mm courses on an 8 mm joint with a 750 mm block and a
   * half-block break, the coursing that dominates the pre-war Midtown base. The
   * tile is three blocks by four courses. The 8 mm joint is sub-pixel at this
   * tile size and is drawn at the one-pixel floor; the millimetre value stays
   * the design intent rather than being rounded to what 128 pixels resolve.
   */
  "limestone-ashlar": {
    tileUMm: 2250, tileVMm: 1000,
    unitLengthMm: 750, unitHeightMm: 250, jointMm: 8,
    courseOffsetMm: 375,
    fieldLuminance: 234,
    // Ashlar is laid tight: the joint reads as a recessed shadow line, not as
    // the bedded mortar band a brick wall shows.
    jointLuminance: 176,
    unitVariationAmplitude: 10,
    courseShadowMm: 22, courseShadowDrop: 14,
    bedShadowMm: 16, bedShadowDrop: 8,
    spandrelBandMm: 0, spandrelDrop: 0,
    sillVMm: 250, streakLengthMm: 1000, streakColumns: 14, streakDrop: 20,
  },
  /**
   * Curtain wall: a 1400 mm bay on a 3600 mm floor-to-floor, 75 mm mullions, and
   * a 900 mm spandrel band at the foot of each floor; the tile is two bays by two
   * floors. The streaks start at the sill — the top of the spandrel — because
   * that is where water leaves the glass and runs onto the panel.
   */
  "curtain-mullion-grid": {
    tileUMm: 2800, tileVMm: 7200,
    unitLengthMm: 1400, unitHeightMm: 3600, jointMm: 75,
    courseOffsetMm: 0,
    fieldLuminance: 242,
    // Framed systems read the other way round: the mullion is the dark line.
    jointLuminance: 148,
    unitVariationAmplitude: 8,
    courseShadowMm: 90, courseShadowDrop: 12,
    bedShadowMm: 0, bedShadowDrop: 0,
    spandrelBandMm: 900, spandrelDrop: 30,
    sillVMm: 900, streakLengthMm: 900, streakColumns: 16, streakDrop: 22,
  },
  /**
   * Metal / spandrel panel: a 1200 x 600 mm panel on a 12 mm reveal, two panels
   * by four courses to the tile. Panels stack aligned, so there is no course
   * offset and the reveal grid is the whole motif.
   */
  "spandrel-panel": {
    tileUMm: 2400, tileVMm: 2400,
    unitLengthMm: 1200, unitHeightMm: 600, jointMm: 12,
    courseOffsetMm: 0,
    fieldLuminance: 238,
    jointLuminance: 162,
    unitVariationAmplitude: 6,
    courseShadowMm: 40, courseShadowDrop: 14,
    bedShadowMm: 30, bedShadowDrop: 10,
    spandrelBandMm: 0, spandrelDrop: 0,
    sillVMm: 600, streakLengthMm: 2400, streakColumns: 12, streakDrop: 16,
  },
};

// ---------------------------------------------------------------------------
// Parameters hash
// ---------------------------------------------------------------------------

/**
 * The declared identity of everything the rasterizer reads. A package pins this
 * in `extras.urbanDigitalTwin.textureProvenance`, and a validator that computes
 * a different value refuses the package rather than replaying against the wrong
 * constants.
 */
export function proceduralTextureParameters(): Record<string, unknown> {
  return {
    profile: PROCEDURAL_TEXTURE_PROFILE,
    rasterizerVersion: PROCEDURAL_TEXTURE_RASTERIZER_VERSION,
    tilePixels: PROCEDURAL_TEXTURE_TILE_PIXELS,
    jointMinimumPixels: JOINT_MINIMUM_PIXELS,
    classes: [...PROCEDURAL_TEXTURE_CLASSES],
    motifs: PROCEDURAL_TEXTURE_PARAMETERS,
  };
}

let cachedParametersHash: string | null = null;
export function proceduralTextureParametersHash(): string {
  cachedParametersHash ??= sha256HexSync(stableSerialize(proceduralTextureParameters()));
  return cachedParametersHash;
}

export interface ProceduralTextureProvenance {
  profile: ProceduralTextureProfile;
  rasterizerVersion: typeof PROCEDURAL_TEXTURE_RASTERIZER_VERSION;
  parametersHashSha256: string;
}

export function proceduralTextureProvenance(): ProceduralTextureProvenance {
  return {
    profile: PROCEDURAL_TEXTURE_PROFILE,
    rasterizerVersion: PROCEDURAL_TEXTURE_RASTERIZER_VERSION,
    parametersHashSha256: proceduralTextureParametersHash(),
  };
}

// ---------------------------------------------------------------------------
// Rasterizer
// ---------------------------------------------------------------------------

function clampLuminance(value: number): number {
  const rounded = Math.round(value);
  return rounded < 0 ? 0 : rounded > 255 ? 255 : rounded;
}

/**
 * Integer avalanche over the unit indices. Two multiplies and two xorshifts is
 * enough to decorrelate neighbouring bricks, and `Math.imul` keeps every
 * intermediate exactly 32-bit, so the draw is identical in every engine.
 */
function unitNoise(salt: number, unitIndex: number, courseIndex: number): number {
  let value = (salt ^ 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (unitIndex + 0x165667b1), 0x85ebca6b) >>> 0;
  value = (value ^ (value >>> 13)) >>> 0;
  value = Math.imul(value ^ (courseIndex + 0x27d4eb2f), 0xc2b2ae35) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

/** A stable per-class salt so two motifs never share a variation sequence. */
function classSalt(textureClass: ProceduralTextureClass): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < textureClass.length; index += 1) {
    value = Math.imul(value ^ textureClass.charCodeAt(index), 0x01000193) >>> 0;
  }
  return value;
}

/**
 * Rasterizes one motif into an 8-bit luminance field, row 0 first.
 *
 * The tile is periodic in both axes by construction: the tile extent is an exact
 * multiple of the module, the odd-course offset is half a module, and the streak
 * columns are counted across the tile rather than across the module. Nothing is
 * seeded by position outside the tile, so adjacent repeats meet exactly.
 *
 * Row order note: PNG row 0 is the TOP of the image and glTF puts image row 0 at
 * v = 0, while the UV writer maps world UP to increasing v. So image row 0 is the
 * BOTTOM of the wall, and `vMm` below runs upward with the row index.
 */
export function rasterizeProceduralTexture(textureClass: ProceduralTextureClass): Uint8Array {
  const motif = PROCEDURAL_TEXTURE_PARAMETERS[textureClass];
  const size = PROCEDURAL_TEXTURE_TILE_PIXELS;
  const salt = classSalt(textureClass);
  const pixelUMm = motif.tileUMm / size;
  const pixelVMm = motif.tileVMm / size;
  // Sub-pixel joints are widened to the one-pixel floor rather than dropped.
  const jointUMm = Math.max(motif.jointMm, JOINT_MINIMUM_PIXELS * pixelUMm);
  const jointVMm = Math.max(motif.jointMm, JOINT_MINIMUM_PIXELS * pixelVMm);
  const unitsPerTile = Math.max(1, Math.round(motif.tileUMm / motif.unitLengthMm));
  const coursesPerTile = Math.max(1, Math.round(motif.tileVMm / motif.unitHeightMm));

  const pixels = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 1) {
    const vMm = (row + 0.5) * pixelVMm;
    const courseIndex = Math.floor(vMm / motif.unitHeightMm);
    const vLocal = vMm - courseIndex * motif.unitHeightMm;
    const offset = courseIndex % 2 === 1 ? motif.courseOffsetMm : 0;
    for (let column = 0; column < size; column += 1) {
      const uMm = (column + 0.5) * pixelUMm;
      const uShift = uMm + offset;
      const unitIndex = Math.floor(uShift / motif.unitLengthMm);
      const uLocal = uShift - unitIndex * motif.unitLengthMm;
      const noise = unitNoise(salt, unitIndex % unitsPerTile, courseIndex % coursesPerTile);

      const inBedJoint = vLocal >= motif.unitHeightMm - jointVMm;
      const inHeadJoint = uLocal >= motif.unitLengthMm - jointUMm;
      let luminance: number;
      if (inBedJoint || inHeadJoint) {
        // Joints carry their own small variation so a long run never reads as a
        // drawn line, but they never carry the face's per-unit draw.
        luminance = motif.jointLuminance + ((noise >>> 3) % 5) - 2;
      } else {
        luminance = motif.fieldLuminance
          + (noise % (2 * motif.unitVariationAmplitude + 1)) - motif.unitVariationAmplitude;
        const faceTop = motif.unitHeightMm - jointVMm;
        if (motif.courseShadowMm > 0 && vLocal > faceTop - motif.courseShadowMm) {
          const depth = (vLocal - (faceTop - motif.courseShadowMm)) / motif.courseShadowMm;
          luminance -= motif.courseShadowDrop * depth;
        }
        if (motif.bedShadowMm > 0 && vLocal < motif.bedShadowMm) {
          luminance -= motif.bedShadowDrop * (1 - vLocal / motif.bedShadowMm);
        }
        if (motif.spandrelBandMm > 0 && vLocal < motif.spandrelBandMm) {
          luminance -= motif.spandrelDrop;
        }
      }

      // Weathering streaks run downward from the sill, joints included: grime
      // crosses a mortar line, it does not stop at one. The columns are counted
      // across the TILE so they repeat seamlessly sideways; the fade is measured
      // inside the MODULE so it never draws a band at the vertical repeat.
      if (motif.streakLengthMm > 0 && vLocal <= motif.sillVMm) {
        const streakColumn = Math.floor((uMm * motif.streakColumns) / motif.tileUMm) % motif.streakColumns;
        const draw = unitNoise(salt ^ 0x5bf03635, streakColumn, 0);
        if ((draw & 3) !== 0) {
          const fade = Math.min(1, (motif.sillVMm - vLocal) / motif.streakLengthMm);
          luminance -= (motif.streakDrop * (1 - fade) * (1 + ((draw >>> 5) % 4))) / 4;
        }
      }
      pixels[row * size + column] = clampLuminance(luminance);
    }
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// Pure PNG encoder
//
// Grayscale, 8-bit, no interlace, filter 0 on every row, and DEFLATE stored
// blocks. `node:zlib` is deliberately not used: its output is not contractually
// stable across Node/zlib versions, and this profile's gate is cross-process
// byte equality of the encoded PNG.
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFLATE_STORED_MAXIMUM = 0xffff;

let crcTable: Uint32Array | null = null;
function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (0xedb88320 ^ (value >>> 1)) >>> 0 : value >>> 1;
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let low = 1;
  let high = 0;
  for (const byte of bytes) {
    low = (low + byte) % 65521;
    high = (high + low) % 65521;
  }
  return ((high << 16) | low) >>> 0;
}

function beU32(value: number): Uint8Array {
  return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) { out.set(part, cursor); cursor += part.byteLength; }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
  const payload = concat([typeBytes, data]);
  return concat([beU32(data.byteLength), payload, beU32(crc32(payload))]);
}

/** zlib container (CMF 0x78 / FLG 0x01) around DEFLATE stored blocks. */
function storedDeflate(raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from([0x78, 0x01])];
  let offset = 0;
  do {
    const length = Math.min(DEFLATE_STORED_MAXIMUM, raw.byteLength - offset);
    const final = offset + length >= raw.byteLength ? 1 : 0;
    parts.push(Uint8Array.from([final, length & 0xff, (length >>> 8) & 0xff, ~length & 0xff, (~length >>> 8) & 0xff]));
    parts.push(raw.subarray(offset, offset + length));
    offset += length;
  } while (offset < raw.byteLength);
  parts.push(beU32(adler32(raw)));
  return concat(parts);
}

export function encodeGrayscalePng(width: number, height: number, luminance: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error("Procedural texture PNG requires positive integer dimensions.");
  if (luminance.byteLength !== width * height) throw new Error("Procedural texture PNG pixel count does not match its dimensions.");
  const raw = new Uint8Array(height * (width + 1));
  for (let row = 0; row < height; row += 1) {
    raw[row * (width + 1)] = 0; // filter type 0: none.
    raw.set(luminance.subarray(row * width, (row + 1) * width), row * (width + 1) + 1);
  }
  const header = concat([beU32(width), beU32(height), Uint8Array.from([8, 0, 0, 0, 0])]);
  return concat([PNG_SIGNATURE, pngChunk("IHDR", header), pngChunk("IDAT", storedDeflate(raw)), pngChunk("IEND", new Uint8Array())]);
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export interface ProceduralTextureTile {
  textureClass: ProceduralTextureClass;
  widthPixels: number;
  heightPixels: number;
  /** Millimetre extent one UV unit covers, so the writer can scale UVs. */
  tileUMm: number;
  tileVMm: number;
  pngBytes: Uint8Array;
  pngSha256: string;
  /** Mean modulation in [0,1]: how much darker the tile makes its material. */
  meanModulation: number;
}

function buildTile(textureClass: ProceduralTextureClass): ProceduralTextureTile {
  const motif = PROCEDURAL_TEXTURE_PARAMETERS[textureClass];
  const pixels = rasterizeProceduralTexture(textureClass);
  const pngBytes = encodeGrayscalePng(PROCEDURAL_TEXTURE_TILE_PIXELS, PROCEDURAL_TEXTURE_TILE_PIXELS, pixels);
  if (pngBytes.byteLength > PROCEDURAL_TEXTURE_LIMITS.maxImageBytes) throw new Error(`Procedural texture ${textureClass} exceeds the per-image byte cap.`);
  let sum = 0;
  for (const value of pixels) sum += value;
  const meanModulation = sum / (pixels.length * 255);
  if (meanModulation < PROCEDURAL_TEXTURE_MINIMUM_MEAN_MODULATION) throw new Error(`Procedural texture ${textureClass} darkens its material past the declared floor.`);
  return {
    textureClass,
    widthPixels: PROCEDURAL_TEXTURE_TILE_PIXELS,
    heightPixels: PROCEDURAL_TEXTURE_TILE_PIXELS,
    tileUMm: motif.tileUMm,
    tileVMm: motif.tileVMm,
    pngBytes,
    pngSha256: sha256HexBytes(pngBytes),
    meanModulation,
  };
}

let cachedCatalog: ReadonlyMap<ProceduralTextureClass, ProceduralTextureTile> | null = null;

/** Every tile the profile can legally embed, keyed by class. Pure and cached. */
export function proceduralTextureCatalog(): ReadonlyMap<ProceduralTextureClass, ProceduralTextureTile> {
  cachedCatalog ??= new Map(PROCEDURAL_TEXTURE_CLASSES.map((textureClass) => [textureClass, buildTile(textureClass)]));
  return cachedCatalog;
}

export function proceduralTextureTile(textureClass: ProceduralTextureClass): ProceduralTextureTile {
  const tile = proceduralTextureCatalog().get(textureClass);
  if (!tile) throw new Error(`Unknown procedural texture class: ${textureClass}`);
  return tile;
}

/**
 * The replay index: PNG checksum to the class that produces it.
 *
 * This is the honesty gate in one line. An embedded image whose checksum is not
 * in this map was not produced by this rasterizer from these constants, and a
 * source-derived tile never can be.
 */
export function proceduralTextureReplayIndex(): ReadonlyMap<string, ProceduralTextureClass> {
  return new Map([...proceduralTextureCatalog().values()].map((tile) => [tile.pngSha256, tile.textureClass]));
}

/** Structural shape check for the pinned provenance record; contents are replayed separately. */
export function isProceduralTextureProvenance(value: unknown): value is ProceduralTextureProvenance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 3
    && keys[0] === "parametersHashSha256" && keys[1] === "profile" && keys[2] === "rasterizerVersion"
    && record.profile === PROCEDURAL_TEXTURE_PROFILE
    && record.rasterizerVersion === PROCEDURAL_TEXTURE_RASTERIZER_VERSION
    && typeof record.parametersHashSha256 === "string"
    && record.parametersHashSha256 === proceduralTextureParametersHash();
}
