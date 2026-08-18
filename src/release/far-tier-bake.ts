/**
 * The far-tier HLOD bake: one ownership cell to one merged prism carrying one
 * baked facade atlas.
 *
 * WHAT IS BAKED, AND WHAT IS NOT
 *
 * Baked: the `factor x tile` composition the shipped `lod_0` assets perform at
 * render time is performed here, on the CPU, analytically, and written into a
 * single truecolour atlas. The composition semantics are the ones already
 * shipped — `V3T_CALIBRATED_PALETTE` through `v3tCalibratedFactor`, planar UVs
 * through the same `projectionBasis` construction `block835-v3-package.ts`
 * uses — so a far-tier wall carries the same coursing phase at the same world
 * position as the `lod_0` wall it stands in for.
 *
 * NOT baked, and each is an appearance error class this tier owns:
 *
 * 1. SETBACKS. The geometry is the sourced footprint extruded to the sourced
 *    top. Every tier inset, step and rooftop group is filled in solid. The
 *    committed census measured this prism against the massing it replaces at a
 *    median silhouette deviation of 0.045221 and a maximum of 0.628806. ADR
 *    0050's 2% cap does NOT cover it and this tier must never declare that cap.
 * 2. GLAZING AND TRIM. The V3 tessellation resolves window and trim surfaces as
 *    separate materials. The far tier resolves only the FACADE material of each
 *    wall zone; glazing and trim are absorbed into it. A curtain-wall building
 *    therefore loses its glazing tone at far range.
 * 3. LIGHTING AND OCCLUSION. Nothing is baked in. No ambient occlusion, no sky
 *    term, no inter-building shadowing. The atlas is albedo only.
 *
 * The base/shaft split IS resolved: `V3FacadeSurface` carries `baseMaterialId`,
 * `materialId` and `baseVMaxMm` per edge, so the bake reads the real zone
 * boundary from the plan rather than guessing one.
 *
 * DETERMINISM. Every function here is a total function of its arguments and the
 * frozen recipe. There is no sampling jitter, no map-iteration order, no clock
 * and no floating-point accumulation whose order depends on anything but the
 * declared sort. Blender is NEVER part of this path; it validates the result
 * and has no way to influence it.
 */

import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import { tessellateV3Plan } from "../domain/deterministic-facade-generator-v3.ts";
import type { V3FacadeSurface, V3Plan } from "../domain/deterministic-facade-generator-v3.ts";
import { V3T_CALIBRATED_PALETTE, v3TextureClassFor, v3tCalibratedFactor } from "./block835-v3-package.ts";
import type { CanonicalGlbQuad, CanonicalGlbTri, Vec2, Vec3 } from "./canonical-glb.ts";
import { proceduralTextureTile, rasterizeProceduralTexture, PROCEDURAL_TEXTURE_TILE_PIXELS } from "./procedural-texture.ts";
import type { ProceduralTextureClass } from "./procedural-texture.ts";

// ---------------------------------------------------------------------------
// The frozen recipe
// ---------------------------------------------------------------------------

/**
 * Every constant that can move a baked byte, in one object, hashed into every
 * artifact's provenance. Changing any field here is a recipe change: the hash
 * moves, the replay of an older tile stops reproducing, and that is the point.
 */
export const FAR_TIER_BAKE_RECIPE = {
  recipeId: "far-tier-hlod-bake-v1",

  /**
   * How a destination texel reads the source class tile.
   *
   * NEAREST names the RECONSTRUCTION: the tile is treated as piecewise
   * constant over its integer texel grid, with no interpolation between
   * texels. It does NOT mean one point sample per destination texel — at the
   * far tier one destination texel covers many tile periods (a brick module is
   * 800 x 268 mm against a ~1.4 m texel), so a single tap would return an
   * arbitrary phase of the coursing and the wall would read as noise. The
   * aggregation is therefore the EXACT area-weighted integral of that
   * piecewise-constant reconstruction over the texel's source footprint,
   * computed in closed form from a summed-area table. Exact, order-independent,
   * and free of any sample-count parameter.
   */
  sourceReconstruction: "nearest-piecewise-constant",
  sourceAggregation: "exact-area-weighted-box-integral",

  /**
   * THE GAMMA DECISION, settled before any byte was baked.
   *
   * glTF renders a base-colour-textured surface as `baseColorFactor x
   * baseColorTexture`, where the TEXTURE is sRGB-encoded and decoded to linear
   * before the multiply, and the FACTOR is already linear. The shipped tiles
   * are grayscale PNGs with no colour chunks, so they are sRGB-encoded by the
   * glTF default.
   *
   * The bake must reproduce what a viewer sees today, not correct it. So:
   *
   *   linear[c] = factor[c] * srgbToLinear(tileTexel / 255)
   *   atlas[c]  = round(255 * linearToSrgb(clamp(linear[c], 0, 1)))
   *
   * and the baked atlas is consumed with `baseColorFactor = [1,1,1,1]`.
   *
   * The naive alternative — multiplying in encoded space, `atlas = factor *
   * texel` — is NOT equivalent and is measurably darker in the midtones. It is
   * rejected here explicitly so that no later reader assumes it was overlooked.
   *
   * Note what this does NOT fix: the repository derives `factor` from a hex
   * string by dividing by 255 with no sRGB decode, so an sRGB-ish number is
   * being used in a linear slot. That is a pre-existing colorimetric
   * imprecision in the shipped assets. Reproducing it is correct for a bake
   * whose whole job is to match the shipped appearance; correcting it here
   * would make the far tier disagree with the near tier.
   */
  compositionSpace: "linear-light",
  textureTransferFunction: "srgb",
  factorTransferFunction: "linear-as-authored",
  bakedBaseColorFactor: [1, 1, 1, 1] as readonly number[],

  /**
   * Atlas packing order. NEVER map iteration order, which would make the bytes
   * depend on insertion history rather than on the data.
   */
  packingOrder: "descending-face-world-area,then-building-id-ascending,then-face-index-ascending",
  packingAlgorithm: "shelf-first-fit-in-declared-order",

  /**
   * Gutter texels around every packed face, filled by edge-clamp replication.
   *
   * Two, not one. The atlas ships without mips because PNG cannot carry a mip
   * chain, so the runtime generates them; at mip level 1 a one-texel gutter has
   * already been halved into nothing and neighbouring faces bleed across the
   * seam. Two survives level 1.
   */
  gutterTexels: 2,

  /**
   * Per-face texel floor. A face whose content rectangle would be smaller than
   * this on either axis carries no interior detail at all: it becomes a solid
   * block of its own area-weighted average colour. Below 4 texels a coursing
   * pattern is not resolved, it is aliased, and a flat average is both cheaper
   * and more honest than a wrong pattern.
   */
  faceTexelFloor: 4,

  /** Sampler the baked GLB declares. Mips are runtime-generated; see below. */
  samplerMagFilter: 9729,
  samplerMinFilter: 9987,
  bakedMipLevels: 0,
  mipRecommendation:
    "The atlas ships base level only, because PNG has no mip chain. The runtime must generate mips: at the far tier the texel ratio is near 1.0 by construction, so unmipped minification shimmers under camera motion. If a later profile needs baked mips it needs a container that can carry them (KTX2), which is a format change and a new admission decision, not a recipe tweak.",

  /** Cell-local frame, so float32 positions keep precision far from the origin. */
  frame: "cell-local-enu-metres-y-up",
  frameOriginRule: "cell.bounds south-west corner",
  frameScaleMetricId: "rect-euclidean-frozen-scale-v1",
  metersPerDegreeLongitude: 84_412.702,
  metersPerDegreeLatitude: 111_049.654,

  /** Roof caps only. A floor cap is invisible from every camera above grade. */
  capsEmitted: "roof",
} as const;

/**
 * RECIPE v2 — the packing half.
 *
 * v2 exists because v1 left the far tier with two defects the T002 records
 * measured and could not fix inside their own frozen bars: 172 of 883 ledger
 * cells could not be packed at any scale, and the cells that could were packed
 * at a median global resolution scale of 0.5.
 *
 * BOTH TRACE TO ONE DECISION: v1 gave a flat, constant-colour face a 4x4
 * content rect. A constant colour needs exactly ONE texel. The 4x4 was never a
 * quality choice — it fell out of reusing `faceTexelFloor` as both "below this,
 * stop resolving detail" and "this is how big a resolved-away face is". v2
 * separates them.
 *
 * v1 IS NOT TOUCHED. `FAR_TIER_BAKE_RECIPE` and `farTierRecipeHash()` are
 * byte-frozen, every v1 artifact still replays, and the T002 records remain
 * exactly as committed. v2 is selected explicitly by a caller and by nothing
 * else.
 *
 * `shading` STAYS NULL. Stage B derived a roof-only shading term, predicted the
 * verdict it implies, and HALTED at a pre-registered NO-GO without baking a v2
 * tile — so nothing was added to this object and its hash did not move for that
 * reason. See `data/far-tier-hlod-v2-20260818/stage-b-decomposition-and-prediction.json`.
 *
 * NOT FROZEN AGAINST ANY ARTIFACT. No v2 tile exists, so `farTierRecipeHashV2()`
 * pins nothing yet. It is a version identity, not a provenance commitment, and
 * it may still move before a v2 artifact is ever written.
 */
export const FAR_TIER_BAKE_RECIPE_V2 = {
  ...FAR_TIER_BAKE_RECIPE,
  recipeId: "far-tier-hlod-bake-v2",
  supersedes: FAR_TIER_BAKE_RECIPE.recipeId,

  /**
   * A resolved-away face carries ONE texel, not `faceTexelFloor` of them.
   *
   * `farTierGeometry` already samples texel CENTRES — `u0 = (x + 0.5) / size`
   * and `u1 = (x + width - 0.5) / size` — so at width 1 the two collapse to the
   * same coordinate and all four corners address the single texel. That is the
   * trick the roof fan has always used. The rendered result is identical to a
   * 4x4 block of the same colour; only the atlas cost differs.
   */
  flatFaceTexels: 1,

  /**
   * ONE gutter texel around a flat face, against two around a resolved one.
   *
   * Reasoned, not assumed. A flat face's four corners carry the SAME uv, so its
   * uv derivative across the face is identically zero, so the hardware selects
   * mip level 0 for it and never samples a level where a wider gutter would
   * matter. One texel of edge-clamped gutter is there to protect the bilinear
   * tap at level 0, where a magnifying sample at the exact texel centre can
   * drift into its neighbours by a floating-point epsilon.
   *
   * THE RESIDUAL, STATED HONESTLY AND NOT MINIMISED. Derivatives are computed
   * per 2x2 pixel quad, so a quad straddling a seam between two faces sees a
   * large false derivative and can select a high mip level for one pixel. The
   * gutter width does NOT decide whether that bleeds; it only decides WHICH mip
   * level it starts bleeding at. Two texels buys one more level than one texel,
   * and nothing more.
   *
   * AND THE EFFECT IS UNMEASURED AT THIS TIER'S OWN SERVING DISTANCES, where it
   * is least comfortable: the whole cell covers 5,889 pixels at 1,200 m and 516
   * at 4,000 m against a median 650 faces per leaf, so most covered pixels are
   * at or near a face boundary and the cross-primitive case is the common case
   * rather than the edge case. What bounds the damage is the CONTENT, not the
   * gutter — every flat face carries its own area average, so a bleed mixes two
   * similar constants. That is an argument about magnitude, not about absence,
   * and no still has been captured to check it.
   *
   * The alternative was measured rather than guessed: see the Stage A census
   * for the unpackable remainder at both gutter widths.
   */
  flatFaceGutterTexels: 1,

  /** Stage B replaces this with the derived shading descriptor. */
  shading: null,
} as const;

/**
 * RECIPE v3 — the zone-colour half, and nothing else.
 *
 * WHAT IT CHANGES AND WHY. T013 measured the far tier's hue deficit and
 * attributed it to SURFACE COMPOSITION rather than to anything in the colour
 * path. Two terms were measured: material absorption, and geometric
 * simplification. v3 addresses the FIRST and only the first.
 *
 * v1 gives a wall zone the colour of its FACADE material alone. The wall it
 * replaces is not made of facade alone: it carries windows, storefronts,
 * cornices, sign bands and balconies, and those materials sit at different
 * places in the palette — trim reads red-over-blue 2.008 against facade's
 * 1.482 and glazing's 1.194. Dropping them is a re-weighting of the cell's
 * colour, not merely a loss of detail. v3 makes a zone's colour the
 * AREA-WEIGHTED LINEAR-LIGHT AGGREGATE of the vertical surfaces the far-tier
 * wall stands in for on that wall's own footprint.
 *
 * WHAT IT DOES NOT CHANGE. It DERIVES FROM v1, not from v2: packing, gutters,
 * texel floors, geometry emission, UVs, the transfer functions and the atlas
 * layout are all v1's, so the only difference between a v1 tile and a v3 tile
 * of the same cell is the colour written into each texel. That isolation is
 * deliberate — it is what makes a capture comparison a measurement of the
 * change rather than of a rebuild.
 *
 * WHAT IS DELIBERATELY EXCLUDED FROM THE AGGREGATE, and this is a judgement
 * call recorded rather than buried:
 *
 * - HORIZONTAL SURFACES. Roof caps, setback decks and the ground ring are not
 *   what a wall replaces. The prism has its own roof cap and emits no ground.
 * - `material:metal`. Rooftop tanks, their legs and fire escapes are GEOMETRIC
 *   omissions of the prism, not materials absorbed into a wall. Folding them
 *   into a wall's colour would claim the wall stands in for a water tank. The
 *   honest scope is "aggregate what the WALL replaces on the wall's own
 *   footprint", and metal fails that test even where it hangs on a facade.
 *   Metal is 2.22 per cent of source surface area at red-over-blue 0.986, the
 *   least red entry in the palette, so excluding it leaves the aggregate very
 *   slightly REDDER than a metal-inclusive one would be.
 *
 * NOT FROZEN AGAINST ANY ARTIFACT UNTIL ONE IS BAKED AND RECORDED.
 */
export const FAR_TIER_BAKE_RECIPE_V3 = {
  ...FAR_TIER_BAKE_RECIPE,
  recipeId: "far-tier-hlod-bake-v3",
  supersedes: FAR_TIER_BAKE_RECIPE.recipeId,
  derivedFrom: "far-tier-hlod-bake-v1",

  /**
   * `facade-only` is v1's behaviour and remains the default everywhere, so a
   * caller cannot take this path by omission.
   */
  zoneColour: "area-correct-aggregate",
  zoneAggregationSpace: "linear-light-area-weighted",
  zoneAggregationIncludesRoles: ["facade", "glazing", "trim"] as readonly string[],
  zoneAggregationExcludesRoles: ["metal", "roof", "ground"] as readonly string[],
  zoneAggregationSurfaceFilter: "vertical-only: |normal.z| <= 0.5",
  zoneAggregationAttribution:
    "Every emitted source surface is attributed to the tier-0 ring edge whose outward normal it best faces, tie-broken by distance from the edge segment and then by the lower edge index; and to a zone by whether its centroid sits below or above that edge's base/shaft boundary. Attribution is total: the aggregate reports the share of vertical in-scope area it placed, and the bake refuses if any is lost.",
  zoneAggregationCarrier:
    "The aggregate is carried as the zone's FACTOR, divided through the zone's own class-tile linear mean, so the baked texel remains factor x tile modulation and the coursing phase v1 pins is untouched. The zone's class tile is still the FACADE material's; only the colour it is multiplied by changes.",
} as const;

export function farTierRecipeHashV3(): string {
  return sha256HexSync(stableSerialize(FAR_TIER_BAKE_RECIPE_V3));
}

/**
 * Parameters the bake path actually reads, resolved from any recipe.
 *
 * Every v2-only field falls back to the value that reproduces v1 EXACTLY, so a
 * v1 caller cannot take a v2 code path by omission. This is what lets v2 be
 * additive without forking the packer.
 */
export interface FarTierEffectiveParameters {
  gutterTexels: number;
  flatFaceGutterTexels: number;
  faceTexelFloor: number;
  flatFaceTexels: number;
  /** Linear-light multiplier applied to every zone factor; 1 means none. */
  shadingScalar: number;
  /** v1 colours a zone by its facade material alone; v3 aggregates. */
  zoneColourMode: "facade-only" | "area-correct-aggregate";
}

export function farTierEffectiveParameters(recipe: Record<string, unknown> = FAR_TIER_BAKE_RECIPE): FarTierEffectiveParameters {
  const gutterTexels = recipe.gutterTexels as number;
  const faceTexelFloor = recipe.faceTexelFloor as number;
  const shading = recipe.shading as { scalar?: number } | null | undefined;
  return {
    gutterTexels,
    flatFaceGutterTexels: (recipe.flatFaceGutterTexels as number | undefined) ?? gutterTexels,
    faceTexelFloor,
    flatFaceTexels: (recipe.flatFaceTexels as number | undefined) ?? faceTexelFloor,
    shadingScalar: shading?.scalar ?? 1,
    zoneColourMode: (recipe.zoneColour as FarTierEffectiveParameters["zoneColourMode"] | undefined) ?? "facade-only",
  };
}

export function farTierRecipeHashV2(): string {
  return sha256HexSync(stableSerialize(FAR_TIER_BAKE_RECIPE_V2));
}

export function farTierRecipeHash(): string {
  return sha256HexSync(stableSerialize(FAR_TIER_BAKE_RECIPE));
}

// ---------------------------------------------------------------------------
// Transfer functions
// ---------------------------------------------------------------------------

/** IEC 61966-2-1 sRGB electro-optical transfer function, on [0,1]. */
export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Its inverse. */
export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

// ---------------------------------------------------------------------------
// Exact periodic box integral over a class tile
//
// The tile repeats by wrapping, so a destination texel's footprint is a
// rectangle in tile space that may be many periods wide. Decomposing it into
// whole periods plus edge strips makes the integral exact and O(1), which is
// both faster and more defensible than any supersampling count.
// ---------------------------------------------------------------------------

export interface TileIntegrator {
  textureClass: ProceduralTextureClass;
  /** Mean of the tile in LINEAR light; not the same as `meanModulation`, which is encoded. */
  linearMean: number;
  /** Exact area-weighted mean over the tile-space rectangle, in linear light. */
  boxMean(u0: number, u1: number, v0: number, v1: number): number;
}

const integratorCache = new Map<ProceduralTextureClass, TileIntegrator>();

/**
 * Build (and memoize) the exact integrator for one class tile.
 *
 * The summed-area table is built over LINEAR values, because the GPU decodes an
 * sRGB texture before it filters it. Averaging the encoded bytes and decoding
 * afterwards would be a different — and wrong — number.
 */
export function tileIntegrator(textureClass: ProceduralTextureClass): TileIntegrator {
  const cached = integratorCache.get(textureClass);
  if (cached) return cached;

  const size = PROCEDURAL_TEXTURE_TILE_PIXELS;
  const luminance = rasterizeProceduralTexture(textureClass);
  const linear = new Float64Array(size * size);
  for (let index = 0; index < linear.length; index += 1) linear[index] = srgbToLinear(luminance[index]! / 255);

  // sat[(y)*(size+1) + x] = sum of linear over [0,x) x [0,y)
  const sat = new Float64Array((size + 1) * (size + 1));
  for (let y = 0; y < size; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < size; x += 1) {
      rowSum += linear[y * size + x]!;
      sat[(y + 1) * (size + 1) + (x + 1)] = sat[y * (size + 1) + (x + 1)]! + rowSum;
    }
  }
  const block = (x: number, y: number): number => sat[y * (size + 1) + x]!;
  const total = block(size, size);

  /** Integral over [0,x] x [0,y] for 0 <= x,y <= size, with fractional edges. */
  const partial = (x: number, y: number): number => {
    const ix = Math.min(size, Math.floor(x));
    const iy = Math.min(size, Math.floor(y));
    const fx = x - ix;
    const fy = y - iy;
    let sum = block(ix, iy);
    if (fx > 0 && ix < size) sum += fx * (block(ix + 1, iy) - block(ix, iy));
    if (fy > 0 && iy < size) sum += fy * (block(ix, iy + 1) - block(ix, iy));
    if (fx > 0 && fy > 0 && ix < size && iy < size) sum += fx * fy * linear[iy * size + ix]!;
    return sum;
  };

  /** Integral over [0,x] x [0,y] for any non-negative x,y, using periodicity. */
  const integral = (x: number, y: number): number => {
    const qx = Math.floor(x / size);
    const qy = Math.floor(y / size);
    const rx = x - qx * size;
    const ry = y - qy * size;
    return qx * qy * total + qx * partial(size, ry) + qy * partial(rx, size) + partial(rx, ry);
  };

  const integrator: TileIntegrator = {
    textureClass,
    linearMean: total / (size * size),
    boxMean(u0, u1, v0, v1) {
      const width = u1 - u0;
      const height = v1 - v0;
      if (!(width > 0) || !(height > 0)) {
        // A degenerate footprint has no area to average; read the single point.
        const px = ((Math.floor(u0 * size) % size) + size) % size;
        const py = ((Math.floor(v0 * size) % size) + size) % size;
        return linear[py * size + px]!;
      }
      // Shift both axes into the non-negative domain by whole periods, which is
      // exact because the integrand is periodic.
      const shiftU = Math.ceil(Math.max(0, -u0)) + 1;
      const shiftV = Math.ceil(Math.max(0, -v0)) + 1;
      const a0 = (u0 + shiftU) * size;
      const a1 = (u1 + shiftU) * size;
      const b0 = (v0 + shiftV) * size;
      const b1 = (v1 + shiftV) * size;
      const area = (a1 - a0) * (b1 - b0);
      return (integral(a1, b1) - integral(a0, b1) - integral(a1, b0) + integral(a0, b0)) / area;
    },
  };
  integratorCache.set(textureClass, integrator);
  return integrator;
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

type Vec3Mm = readonly [number, number, number];

function subtract(left: Vec3Mm, right: Vec3Mm): Vec3Mm { return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]; }
function cross(left: Vec3Mm, right: Vec3Mm): Vec3Mm {
  return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
}
function dot(left: Vec3Mm, right: Vec3Mm): number { return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]; }
/** `Math.sqrt` is correctly rounded by IEEE 754; `Math.hypot` is not, and these bytes ship. */
function normalize(vector: Vec3Mm): Vec3Mm {
  const length = Math.sqrt(dot(vector, vector));
  return length === 0 ? [0, 0, 1] : [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * The projection basis for one face, derived from the face's own corners.
 *
 * This is `block835-v3-package.ts`'s construction, reproduced rather than
 * imported because that one is module-private. It must not drift: the whole
 * point of using it is that a far-tier wall lands on the same coursing phase as
 * the `lod_0` wall standing at the same world position. `far-tier-bake.test.ts`
 * pins the agreement.
 */
export function farTierProjectionBasis(corners: readonly Vec3Mm[]): { uAxis: Vec3Mm; vAxis: Vec3Mm } {
  let normal: Vec3Mm = [0, 0, 0];
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index]!;
    const next = corners[(index + 1) % corners.length]!;
    normal = [
      normal[0] + (current[1] - next[1]) * (current[2] + next[2]),
      normal[1] + (current[2] - next[2]) * (current[0] + next[0]),
      normal[2] + (current[0] - next[0]) * (current[1] + next[1]),
    ];
  }
  const unit = normalize(normal);
  if (Math.abs(unit[2]) < Math.SQRT1_2) {
    const vAxis = normalize(subtract([0, 0, 1], [unit[0] * unit[2], unit[1] * unit[2], unit[2] * unit[2]]));
    return { uAxis: normalize(cross(vAxis, unit)), vAxis };
  }
  const uAxis = normalize(subtract([1, 0, 0], [unit[0] * unit[0], unit[1] * unit[0], unit[2] * unit[0]]));
  return { uAxis, vAxis: normalize(cross(unit, uAxis)) };
}

/** One vertical zone of a wall: a material, its class tile, and its baked factor. */
interface FaceZone {
  materialId: string;
  textureClass: ProceduralTextureClass | null;
  /** Linear-light RGB the zone multiplies its tile by. */
  factor: readonly [number, number, number];
  /** Height fraction of the face this zone starts and ends at, in [0,1]. */
  fromFraction: number;
  toFraction: number;
}

export interface FarTierFace {
  buildingId: string;
  /** Emission index inside the building; the declared final tiebreak. */
  faceIndex: number;
  kind: "wall" | "roof";
  /** World area in square metres; the primary packing sort key. */
  areaSquareMeters: number;
  /** Corners in plan-local millimetres, Z up, counter-clockwise from outside. */
  cornersMm: readonly Vec3Mm[];
  /** Metre offset from the building's plan origin to the cell origin. */
  offsetMeters: readonly [number, number];
  zones: readonly FaceZone[];
  /** Set by packing. */
  /**
   * Set by packing. `flat` is decided ONCE, by the packer, and carried here.
   *
   * It is deliberately not re-derived from the rect dimensions: a face that
   * legitimately sizes to exactly the texel floor on both axes is NOT flat, and
   * re-deriving the predicate from `width === floor && height === floor`
   * conflated the two and under-reported `flatFaceCount`.
   */
  rect?: { x: number; y: number; width: number; height: number; flat: boolean; gutter: number };
}

function paletteFactor(plan: V3Plan, materialId: string): { textureClass: ProceduralTextureClass | null; factor: [number, number, number] } {
  const hex = V3T_CALIBRATED_PALETTE[plan.styleClass]?.[materialId];
  const textureClass = v3TextureClassFor(plan.styleClass, materialId);
  if (hex === undefined) {
    // No calibrated entry: fall back to the plan's own quantized byte palette,
    // exactly as `v3GeometryForGlb` does when the palette has no entry.
    const material = plan.materials.find((candidate) => candidate.id === materialId);
    if (!material) throw new Error(`Far-tier bake found no material ${materialId} on plan ${plan.buildingId}.`);
    return { textureClass, factor: [material.baseColorSrgb[0] / 255, material.baseColorSrgb[1] / 255, material.baseColorSrgb[2] / 255] };
  }
  const mean = textureClass === null ? 1 : proceduralTextureTile(textureClass).meanModulation;
  const calibrated = v3tCalibratedFactor(hex, mean);
  return { textureClass, factor: [calibrated[0], calibrated[1], calibrated[2]] };
}

// ---------------------------------------------------------------------------
// Area-correct zone aggregation (recipe v3)
// ---------------------------------------------------------------------------

/** Roles a wall stands in for. `metal`, `roof` and `ground` are excluded; see the v3 recipe. */
const AGGREGATED_ROLES = new Set(["facade", "glazing", "trim"]);

/** Linear-light albedo one shipped `lod_0` material renders, averaged over many tile periods. */
function sourceMaterialAlbedo(plan: V3Plan, materialId: string): readonly [number, number, number] {
  const { textureClass, factor } = paletteFactor(plan, materialId);
  const tileLinearMean = textureClass === null ? 1 : tileIntegrator(textureClass).linearMean;
  return [factor[0] * tileLinearMean, factor[1] * tileLinearMean, factor[2] * tileLinearMean];
}

export interface FarTierZoneAggregate {
  /** Area-weighted linear-light albedo of every in-scope surface attributed here. */
  albedo: readonly [number, number, number];
  areaSquareMeters: number;
}

export interface FarTierAggregateResult {
  /** Keyed `edgeIndex:base` and `edgeIndex:shaft`. */
  zones: Map<string, FarTierZoneAggregate>;
  inScopeAreaSquareMeters: number;
  attributedAreaSquareMeters: number;
  excludedByRoleAreaSquareMeters: number;
  excludedAsHorizontalAreaSquareMeters: number;
}

/**
 * Attribute every vertical, in-scope source surface of one plan to a far-tier
 * wall zone, and aggregate its albedo by area.
 *
 * WHY THE TESSELLATION AND NOT THE PLAN'S BOOKKEEPING. `plan.surfaces` and
 * `plan.placements` describe INTENT; `tessellateV3Plan` emits what the shipped
 * `lod_0` asset actually renders, including recess reveals and attachment
 * sides. Aggregating the intent would silently disagree with the subject the
 * instrument measures. The cost is that attribution has to be geometric, which
 * is why it reports its own completeness and the caller refuses on a shortfall.
 */
export function farTierZoneAggregates(plan: V3Plan): FarTierAggregateResult {
  const roleById = new Map(plan.materials.map((material) => [material.id, material.role]));
  const ring = plan.tiers[0]!.ring;
  const baseZMm = Math.min(...plan.tiers.map((tier) => tier.baseZMm));

  // Each tier-0 ring edge, as an outward unit normal and a segment midpoint.
  const edges = ring.map((corner, index) => {
    const [ax, ay] = corner;
    const [bx, by] = ring[(index + 1) % ring.length]!;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.sqrt(dx * dx + dy * dy);
    // Counter-clockwise ring seen from outside: the outward normal is (dy, -dx).
    return {
      index,
      normal: length === 0 ? [0, 0] : [dy / length, -dx / length],
      midpoint: [(ax + bx) / 2, (ay + by) / 2],
    };
  });

  // The base/shaft boundary per edge, in ABSOLUTE plan Z, from the same tier-0
  // facade surfaces `farTierFacesForBuilding` reads.
  const boundaryByEdge = new Map<number, number>();
  for (const surface of plan.surfaces) {
    if (surface.kind !== "facade") continue;
    const facade = surface as V3FacadeSurface;
    if (facade.tierIndex !== 0) continue;
    const existing = boundaryByEdge.get(facade.edgeIndex);
    if (existing === undefined || facade.baseVMaxMm > existing) boundaryByEdge.set(facade.edgeIndex, facade.baseVMaxMm);
  }

  const zones = new Map<string, { sums: [number, number, number]; area: number }>();
  let inScope = 0;
  let attributed = 0;
  let excludedByRole = 0;
  let excludedHorizontal = 0;

  const albedoCache = new Map<string, readonly [number, number, number]>();
  const albedoOf = (materialId: string): readonly [number, number, number] => {
    const cached = albedoCache.get(materialId);
    if (cached) return cached;
    const value = sourceMaterialAlbedo(plan, materialId);
    albedoCache.set(materialId, value);
    return value;
  };

  const consume = (materialId: string, corners: readonly Vec3Mm[]): void => {
    const role = roleById.get(materialId);
    // Newell, so a non-planar quad still yields the area its triangulation shows.
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let index = 0; index < corners.length; index += 1) {
      const current = corners[index]!;
      const next = corners[(index + 1) % corners.length]!;
      nx += (current[1] - next[1]) * (current[2] + next[2]);
      ny += (current[2] - next[2]) * (current[0] + next[0]);
      nz += (current[0] - next[0]) * (current[1] + next[1]);
      cx += current[0];
      cy += current[1];
      cz += current[2];
    }
    const doubleArea = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(doubleArea > 0)) return;
    const areaSquareMeters = doubleArea / 2 / 1_000_000;
    const unitZ = nz / doubleArea;
    if (Math.abs(unitZ) > 0.5) { excludedHorizontal += areaSquareMeters; return; }
    if (role === undefined || !AGGREGATED_ROLES.has(role)) { excludedByRole += areaSquareMeters; return; }
    inScope += areaSquareMeters;

    const centroid = [cx / corners.length, cy / corners.length, cz / corners.length];
    const normal2d = [nx / doubleArea, ny / doubleArea];
    let best = edges[0]!;
    let bestFacing = -Infinity;
    let bestDistance = Infinity;
    for (const edge of edges) {
      const facing = normal2d[0]! * edge.normal[0]! + normal2d[1]! * edge.normal[1]!;
      const dx = centroid[0]! - edge.midpoint[0]!;
      const dy = centroid[1]! - edge.midpoint[1]!;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // Facing first, distance second, lower index last. Total and deterministic.
      if (facing > bestFacing + 1e-9 || (Math.abs(facing - bestFacing) <= 1e-9 && distance < bestDistance - 1e-9)) {
        best = edge;
        bestFacing = facing;
        bestDistance = distance;
      }
    }
    const boundary = baseZMm + (boundaryByEdge.get(best.index) ?? 0);
    const key = `${best.index}:${centroid[2]! < boundary ? "base" : "shaft"}`;
    const entry = zones.get(key) ?? { sums: [0, 0, 0] as [number, number, number], area: 0 };
    const albedo = albedoOf(materialId);
    entry.area += areaSquareMeters;
    for (let channel = 0; channel < 3; channel += 1) entry.sums[channel] = entry.sums[channel]! + areaSquareMeters * albedo[channel]!;
    zones.set(key, entry);
    attributed += areaSquareMeters;
  };

  const tessellation = tessellateV3Plan(plan, { includeRecesses: true });
  for (const quad of tessellation.quads) consume(quad.materialId, quad.corners);
  for (const triangle of tessellation.triangles) consume(triangle.materialId, [triangle.a, triangle.b, triangle.c]);

  return {
    zones: new Map([...zones].map(([key, entry]) => [key, {
      albedo: [entry.sums[0] / entry.area, entry.sums[1] / entry.area, entry.sums[2] / entry.area] as const,
      areaSquareMeters: entry.area,
    }])),
    inScopeAreaSquareMeters: inScope,
    attributedAreaSquareMeters: attributed,
    excludedByRoleAreaSquareMeters: excludedByRole,
    excludedAsHorizontalAreaSquareMeters: excludedHorizontal,
  };
}

/**
 * Raised when an aggregated zone colour would need a factor above 1.
 *
 * A factor above 1 is not merely out of the closed glTF profile's range: the
 * rasterizer clamps before encoding, so it would clip ONE channel before the
 * others and manufacture exactly the per-channel bias T013 spent a task
 * excluding. Refusing is the only honest response.
 */
export class FarTierAggregateOutOfRangeError extends Error {
  constructor(buildingId: string, zoneKey: string, factor: readonly number[]) {
    super(`Far-tier v3 aggregation produced a zone factor above 1 for ${buildingId} zone ${zoneKey}: [${factor.map((value) => value.toFixed(6)).join(", ")}]. Baking it would clamp one channel before the others and invent a per-channel bias.`);
    this.name = "FarTierAggregateOutOfRangeError";
  }
}

/**
 * How far above 1 an aggregated factor may land before the bake refuses.
 *
 * A zone whose in-scope surface is entirely its own facade material MUST
 * reproduce that material's factor exactly, and where the palette calibration
 * has already pushed that factor to the profile ceiling of 1 the round trip
 * through an area-weighted albedo and back through the class tile's linear mean
 * lands a few units in the last place above it. That is arithmetic noise and it
 * is snapped to 1 and COUNTED. Anything larger is a real overshoot and is
 * refused, because clamping it would clip one channel before the others.
 */
const AGGREGATE_UNITY_EPSILON = 1e-9;

export interface FarTierFacesOptions {
  zoneColourMode?: FarTierEffectiveParameters["zoneColourMode"];
  /** Filled in with the aggregation's completeness, when the caller wants it. */
  aggregateReport?: FarTierAggregateResult[];
  /** Filled in with every factor that needed snapping to the profile ceiling. */
  unitySnapReport?: Array<{ buildingId: string; zoneKey: string; overshoot: number }>;
}

/**
 * Enumerate one building's far-tier faces: the extruded outer ring plus a roof
 * cap, with each wall's base/shaft zones read from the plan's own facade
 * surfaces.
 */
export function farTierFacesForBuilding(
  plan: V3Plan,
  offsetMeters: readonly [number, number],
  options: FarTierFacesOptions = {},
): FarTierFace[] {
  const aggregating = options.zoneColourMode === "area-correct-aggregate";
  const aggregates = aggregating ? farTierZoneAggregates(plan) : null;
  if (aggregates && options.aggregateReport) options.aggregateReport.push(aggregates);
  const ring = plan.tiers[0]!.ring;
  const baseZMm = Math.min(...plan.tiers.map((tier) => tier.baseZMm));
  const topZMm = Math.max(...plan.tiers.map((tier) => tier.topZMm));
  const heightMm = topZMm - baseZMm;

  // Base-zone height per ring edge, from the tier-0 facade surfaces. A missing
  // surface means that edge has no base zone, not that the bake may guess one.
  const baseVMaxByEdge = new Map<number, V3FacadeSurface>();
  for (const surface of plan.surfaces) {
    if (surface.kind !== "facade") continue;
    const facade = surface as V3FacadeSurface;
    if (facade.tierIndex !== 0) continue;
    const existing = baseVMaxByEdge.get(facade.edgeIndex);
    if (!existing || facade.baseVMaxMm > existing.baseVMaxMm) baseVMaxByEdge.set(facade.edgeIndex, facade);
  }

  const faces: FarTierFace[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const [ax, ay] = ring[index]!;
    const [bx, by] = ring[(index + 1) % ring.length]!;
    // `Math.sqrt` is correctly rounded by IEEE 754; `Math.hypot` is not, and this
    // area is the primary packing sort key, so it decides shipped bytes.
    const edgeDx = bx - ax;
    const edgeDy = by - ay;
    const widthMm = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
    if (widthMm <= 0 || heightMm <= 0) continue;

    const facade = baseVMaxByEdge.get(index);
    const shaftId = facade?.materialId ?? "material:facade:shaft";
    const baseId = facade?.baseMaterialId ?? "material:facade:base";
    const baseVMaxMm = Math.max(0, Math.min(heightMm, facade?.baseVMaxMm ?? 0));
    const split = baseVMaxMm / heightMm;

    /**
     * The zone's factor. In `facade-only` mode this is v1's palette factor,
     * byte for byte. In aggregate mode the area-weighted albedo is divided
     * through the zone's own class-tile linear mean, so the rasterizer's
     * `factor x modulation` still averages to the aggregate over the zone.
     */
    const resolveZone = (materialId: string, zoneName: "base" | "shaft"): { textureClass: ProceduralTextureClass | null; factor: [number, number, number] } => {
      const palette = paletteFactor(plan, materialId);
      if (!aggregates) return palette;
      const aggregate = aggregates.zones.get(`${index}:${zoneName}`);
      if (!aggregate || !(aggregate.areaSquareMeters > 0)) return palette;
      const tileLinearMean = palette.textureClass === null ? 1 : tileIntegrator(palette.textureClass).linearMean;
      const factor: [number, number, number] = [
        aggregate.albedo[0] / tileLinearMean,
        aggregate.albedo[1] / tileLinearMean,
        aggregate.albedo[2] / tileLinearMean,
      ];
      const overshoot = Math.max(factor[0], factor[1], factor[2]) - 1;
      if (overshoot > AGGREGATE_UNITY_EPSILON) {
        throw new FarTierAggregateOutOfRangeError(plan.buildingId, `${index}:${zoneName}`, factor);
      }
      if (overshoot > 0) {
        options.unitySnapReport?.push({ buildingId: plan.buildingId, zoneKey: `${index}:${zoneName}`, overshoot });
        for (let channel = 0; channel < 3; channel += 1) if (factor[channel]! > 1) factor[channel] = 1;
      }
      return { textureClass: palette.textureClass, factor };
    };

    const shaft = resolveZone(shaftId, "shaft");
    const zones: FaceZone[] = [];
    if (split > 0) {
      const base = resolveZone(baseId, "base");
      zones.push({ materialId: baseId, textureClass: base.textureClass, factor: base.factor, fromFraction: 0, toFraction: split });
    }
    if (split < 1) zones.push({ materialId: shaftId, textureClass: shaft.textureClass, factor: shaft.factor, fromFraction: split, toFraction: 1 });

    faces.push({
      buildingId: plan.buildingId,
      faceIndex: index,
      kind: "wall",
      areaSquareMeters: (widthMm / 1_000) * (heightMm / 1_000),
      cornersMm: [[ax, ay, baseZMm], [bx, by, baseZMm], [bx, by, topZMm], [ax, ay, topZMm]],
      offsetMeters,
      zones,
    });
  }

  // One roof face per building. `material:roof` has no class tile by
  // construction, so it is a flat colour and needs no pattern resolution.
  const roof = paletteFactor(plan, "material:roof");
  let doubleArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[(index + 1) % ring.length]!;
    doubleArea += x1 * y2 - x2 * y1;
  }
  faces.push({
    buildingId: plan.buildingId,
    faceIndex: ring.length,
    kind: "roof",
    areaSquareMeters: Math.abs(doubleArea) / 2 / 1_000_000,
    cornersMm: ring.map(([x, y]) => [x, y, topZMm] as Vec3Mm),
    offsetMeters,
    zones: [{ materialId: "material:roof", textureClass: roof.textureClass, factor: roof.factor, fromFraction: 0, toFraction: 1 }],
  });
  return faces;
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

/** The declared order. Never map iteration order. */
export function farTierPackingOrder(faces: readonly FarTierFace[]): FarTierFace[] {
  return [...faces].sort((left, right) => {
    if (right.areaSquareMeters !== left.areaSquareMeters) return right.areaSquareMeters - left.areaSquareMeters;
    if (left.buildingId !== right.buildingId) return left.buildingId < right.buildingId ? -1 : 1;
    return left.faceIndex - right.faceIndex;
  });
}

function contentExtent(
  face: FarTierFace,
  texelWorldSizeMeters: number,
  parameters: FarTierEffectiveParameters,
): { width: number; height: number; flat: boolean } {
  const floor = parameters.faceTexelFloor;
  const flatExtent = parameters.flatFaceTexels;
  if (face.kind === "roof") {
    // A roof is a flat colour at every resolution; it never earns interior texels.
    return { width: flatExtent, height: flatExtent, flat: true };
  }
  const [a, b] = [face.cornersMm[0]!, face.cornersMm[1]!];
  // `Math.sqrt` is correctly rounded by IEEE 754; `Math.hypot` is not specified
  // to be, and this length decides a texel count that decides shipped bytes.
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const widthMeters = Math.sqrt(dx * dx + dy * dy) / 1_000;
  const heightMeters = (face.cornersMm[2]![2] - a[2]) / 1_000;
  const width = Math.round(widthMeters / texelWorldSizeMeters);
  const height = Math.round(heightMeters / texelWorldSizeMeters);
  // The floor decides WHETHER a face resolves; `flatFaceTexels` decides how big
  // it is once it does not. v1 conflated the two at 4, which is why a constant
  // colour cost sixteen texels.
  if (width < floor || height < floor) return { width: flatExtent, height: flatExtent, flat: true };
  return { width, height, flat: false };
}

export interface FarTierPacking {
  /** Resolved parameters this packing was produced under; the rasterizer reads them back. */
  parameters: FarTierEffectiveParameters;
  recipeId: string;
  atlasPixels: number;
  /** Global resolution scale actually applied; 1 when the target was affordable. */
  appliedScale: number;
  texelWorldSizeMeters: number;
  faces: readonly FarTierFace[];
  flatFaceCount: number;
  /** Texels occupied by content and gutters, over the atlas area. */
  occupancy: number;
}

/**
 * Raised when an atlas cannot hold a cell's faces at ANY declared scale.
 *
 * Distinct from every other failure this module can produce, because it means
 * something structural rather than something wrong with the input: each face
 * costs at least `(faceTexelFloor + 2 * gutterTexels)^2` texels however far the
 * global resolution is reduced, so an atlas has a fixed maximum face count. A
 * caller taking a feasibility census must be able to tell this apart from a
 * genuine error, or it will silently report bugs as infeasibility.
 */
export class FarTierPackingUnfeasibleError extends Error {
  readonly faceCount: number;
  readonly atlasPixels: number;
  readonly minimumTexelsPerFace: number;
  constructor(faceCount: number, atlasPixels: number, parameters: FarTierEffectiveParameters = farTierEffectiveParameters()) {
    const minimumTexelsPerFace = (parameters.flatFaceTexels + 2 * parameters.flatFaceGutterTexels) ** 2;
    super(`Far-tier bake could not pack ${faceCount} faces into a ${atlasPixels}px atlas at any declared scale; each face costs at least ${minimumTexelsPerFace} texels, so this atlas holds at most ${Math.floor((atlasPixels * atlasPixels) / minimumTexelsPerFace)}.`);
    this.name = "FarTierPackingUnfeasibleError";
    this.faceCount = faceCount;
    this.atlasPixels = atlasPixels;
    this.minimumTexelsPerFace = minimumTexelsPerFace;
  }
}

/**
 * Shelf-pack the faces in the declared order, shrinking the global resolution
 * by deterministic halvings until the atlas holds them.
 *
 * Shrinking is a real quality loss and it is REPORTED as `appliedScale`, never
 * silently absorbed.
 */
export function packFarTierAtlas(
  faces: readonly FarTierFace[],
  atlasPixels: number,
  targetTexelWorldSizeMeters: number,
  recipe: Record<string, unknown> = FAR_TIER_BAKE_RECIPE,
): FarTierPacking {
  const ordered = farTierPackingOrder(faces);
  const parameters = farTierEffectiveParameters(recipe);

  for (let step = 0; step < 24; step += 1) {
    const appliedScale = 2 ** (-step / 2);
    const texelWorldSizeMeters = targetTexelWorldSizeMeters / appliedScale;
    let shelfY = 0;
    let shelfHeight = 0;
    let cursorX = 0;
    let occupied = 0;
    let flatFaceCount = 0;
    let failed = false;
    const placed: FarTierFace[] = [];

    for (const face of ordered) {
      const extent = contentExtent(face, texelWorldSizeMeters, parameters);
      if (extent.flat) flatFaceCount += 1;
      // A flat face may carry a narrower gutter than a resolved one; see the v2
      // recipe for why that is safe and what it costs.
      const gutter = extent.flat ? parameters.flatFaceGutterTexels : parameters.gutterTexels;
      const boxWidth = extent.width + gutter * 2;
      const boxHeight = extent.height + gutter * 2;
      if (boxWidth > atlasPixels) { failed = true; break; }
      if (cursorX + boxWidth > atlasPixels) { shelfY += shelfHeight; shelfHeight = 0; cursorX = 0; }
      if (shelfY + boxHeight > atlasPixels) { failed = true; break; }
      placed.push({ ...face, rect: { x: cursorX + gutter, y: shelfY + gutter, width: extent.width, height: extent.height, flat: extent.flat, gutter } });
      cursorX += boxWidth;
      if (boxHeight > shelfHeight) shelfHeight = boxHeight;
      occupied += boxWidth * boxHeight;
    }

    if (!failed) {
      return { parameters, recipeId: recipe.recipeId as string, atlasPixels, appliedScale, texelWorldSizeMeters, faces: placed, flatFaceCount, occupancy: occupied / (atlasPixels * atlasPixels) };
    }
  }
  throw new FarTierPackingUnfeasibleError(faces.length, atlasPixels, parameters);
}

// ---------------------------------------------------------------------------
// The bake
// ---------------------------------------------------------------------------

/** Linear-light colour of one face at height fraction `t`, over tile-space rect. */
function zoneAt(face: FarTierFace, t: number): FaceZone {
  for (const zone of face.zones) if (t >= zone.fromFraction && t < zone.toFraction) return zone;
  return face.zones[face.zones.length - 1]!;
}

/**
 * Rasterize the packed faces into a truecolour atlas.
 *
 * Returns the RGB byte buffer in PNG row order (row 0 is the top of the image),
 * ready for `encodeRgbPng`.
 */
export function bakeFarTierAtlas(packing: FarTierPacking): Uint8Array {
  // FAIL CLOSED ON AN UNAPPLIED SHADING TERM.
  //
  // `farTierEffectiveParameters` resolves `shadingScalar` and the packing
  // carries it, so a recipe declaring one would travel into provenance and into
  // any hash computed over the recipe. This rasterizer does NOT apply it — the
  // Stage B halt left the term derived but unwired — so a recipe with a scalar
  // other than 1 would produce bytes that are lighter than the provenance
  // describing them. That is a silent lie about an artifact, which is worse
  // than a missing feature, so it is refused rather than ignored.
  if (packing.parameters.shadingScalar !== 1) {
    throw new Error(`Far-tier bake was given a shading scalar of ${packing.parameters.shadingScalar}, but this rasterizer does not apply one; baking would produce bytes that contradict the recipe recorded beside them.`);
  }
  const size = packing.atlasPixels;
  const rgb = new Uint8Array(size * size * 3);

  const put = (x: number, y: number, colour: readonly [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const at = (y * size + x) * 3;
    rgb[at] = colour[0]!;
    rgb[at + 1] = colour[1]!;
    rgb[at + 2] = colour[2]!;
  };

  const encode = (linear: readonly [number, number, number]): [number, number, number] => [
    Math.round(255 * linearToSrgb(Math.min(1, Math.max(0, linear[0])))),
    Math.round(255 * linearToSrgb(Math.min(1, Math.max(0, linear[1])))),
    Math.round(255 * linearToSrgb(Math.min(1, Math.max(0, linear[2])))),
  ];

  for (const face of packing.faces) {
    const rect = face.rect!;
    const { uAxis, vAxis } = farTierProjectionBasis(face.cornersMm);
    const a = face.cornersMm[0]!;
    const b = face.cornersMm[1]!;
    const top = face.cornersMm[2]!;

    // Precompute the face's tile-space extent along each axis.
    const uAtA = dot(a, uAxis);
    const uAtB = dot(b, uAxis);
    const vAtBottom = dot(a, vAxis);
    const vAtTop = dot(top, vAxis);

    const isFlat = rect.flat;

    // A flat face is one area-weighted average over all its zones.
    let flatColour: [number, number, number] | null = null;
    if (isFlat) {
      let accumulated: [number, number, number] = [0, 0, 0];
      for (const zone of face.zones) {
        const weight = zone.toFraction - zone.fromFraction;
        if (weight <= 0) continue;
        let modulation = 1;
        if (zone.textureClass !== null) {
          const tile = proceduralTextureTile(zone.textureClass);
          const integrator = tileIntegrator(zone.textureClass);
          const u0 = uAtA / tile.tileUMm;
          const u1 = uAtB / tile.tileUMm;
          const v0 = (vAtBottom + (vAtTop - vAtBottom) * zone.fromFraction) / tile.tileVMm;
          const v1 = (vAtBottom + (vAtTop - vAtBottom) * zone.toFraction) / tile.tileVMm;
          modulation = integrator.boxMean(Math.min(u0, u1), Math.max(u0, u1), Math.min(v0, v1), Math.max(v0, v1));
        }
        accumulated = [
          accumulated[0] + weight * zone.factor[0] * modulation,
          accumulated[1] + weight * zone.factor[1] * modulation,
          accumulated[2] + weight * zone.factor[2] * modulation,
        ];
      }
      flatColour = encode(accumulated);
    }

    for (let row = 0; row < rect.height; row += 1) {
      // Atlas rows run downward; the wall's bottom is the rect's LAST row.
      const t0 = 1 - (row + 1) / rect.height;
      const t1 = 1 - row / rect.height;
      const zone = zoneAt(face, (t0 + t1) / 2);
      for (let column = 0; column < rect.width; column += 1) {
        if (flatColour) { put(rect.x + column, rect.y + row, flatColour); continue; }
        const s0 = column / rect.width;
        const s1 = (column + 1) / rect.width;
        let modulation = 1;
        if (zone.textureClass !== null) {
          const tile = proceduralTextureTile(zone.textureClass);
          const integrator = tileIntegrator(zone.textureClass);
          const uA = (uAtA + (uAtB - uAtA) * s0) / tile.tileUMm;
          const uB = (uAtA + (uAtB - uAtA) * s1) / tile.tileUMm;
          const vA = (vAtBottom + (vAtTop - vAtBottom) * t0) / tile.tileVMm;
          const vB = (vAtBottom + (vAtTop - vAtBottom) * t1) / tile.tileVMm;
          modulation = integrator.boxMean(Math.min(uA, uB), Math.max(uA, uB), Math.min(vA, vB), Math.max(vA, vB));
        }
        put(rect.x + column, rect.y + row, encode([
          zone.factor[0] * modulation,
          zone.factor[1] * modulation,
          zone.factor[2] * modulation,
        ]));
      }
    }

    // Gutter: edge-clamp replication, so mip level 1 cannot pull a neighbour in.
    const gutter = rect.gutter;
    for (let ring = 1; ring <= gutter; ring += 1) {
      for (let column = -gutter; column < rect.width + gutter; column += 1) {
        const source = Math.min(rect.width - 1, Math.max(0, column));
        const topAt = ((rect.y) * size + (rect.x + source)) * 3;
        const bottomAt = ((rect.y + rect.height - 1) * size + (rect.x + source)) * 3;
        put(rect.x + column, rect.y - ring, [rgb[topAt]!, rgb[topAt + 1]!, rgb[topAt + 2]!]);
        put(rect.x + column, rect.y + rect.height - 1 + ring, [rgb[bottomAt]!, rgb[bottomAt + 1]!, rgb[bottomAt + 2]!]);
      }
      for (let row = -gutter; row < rect.height + gutter; row += 1) {
        const source = Math.min(rect.height - 1, Math.max(0, row));
        const leftAt = ((rect.y + source) * size + rect.x) * 3;
        const rightAt = ((rect.y + source) * size + rect.x + rect.width - 1) * 3;
        put(rect.x - ring, rect.y + row, [rgb[leftAt]!, rgb[leftAt + 1]!, rgb[leftAt + 2]!]);
        put(rect.x + rect.width - 1 + ring, rect.y + row, [rgb[rightAt]!, rgb[rightAt + 1]!, rgb[rightAt + 2]!]);
      }
    }
  }
  return rgb;
}

// ---------------------------------------------------------------------------
// Geometry emission
// ---------------------------------------------------------------------------

/** Plan-local millimetres, offset into the cell frame, to metres, then +Y up. */
function toCellFrame(corner: Vec3Mm, offsetMeters: readonly [number, number]): Vec3 {
  const east = corner[0] / 1_000 + offsetMeters[0];
  const north = corner[1] / 1_000 + offsetMeters[1];
  const up = corner[2] / 1_000;
  // Same determinant +1 mapping the shipped writers use, so winding survives.
  return [east, up, -north];
}

export interface FarTierGeometry {
  quads: CanonicalGlbQuad[];
  triangles: CanonicalGlbTri[];
}

/** Emit the merged prism with atlas UVs. New emission code; no generator is mutated. */
export function farTierGeometry(packing: FarTierPacking): FarTierGeometry {
  const size = packing.atlasPixels;
  const quads: CanonicalGlbQuad[] = [];
  const triangles: CanonicalGlbTri[] = [];

  // Emit in the declared packing order, so the geometry buffer order is the
  // same total order the atlas was packed in and neither depends on the other's
  // traversal.
  for (const face of packing.faces) {
    const rect = face.rect!;
    // Sample at texel CENTRES on the rect boundary, so bilinear magnification
    // cannot reach past the content into the gutter.
    const u0 = (rect.x + 0.5) / size;
    const u1 = (rect.x + rect.width - 0.5) / size;
    const v0 = (rect.y + 0.5) / size;
    const v1 = (rect.y + rect.height - 0.5) / size;

    if (face.kind === "wall") {
      const corners = face.cornersMm.map((corner) => toCellFrame(corner, face.offsetMeters)) as [Vec3, Vec3, Vec3, Vec3];
      quads.push({
        materialIndex: 0,
        corners,
        // corners are [a-bottom, b-bottom, b-top, a-top]; the atlas rect's last
        // row is the wall bottom, so bottom takes v1 and top takes v0.
        uv: [[u0, v1], [u1, v1], [u1, v0], [u0, v0]] as [Vec2, Vec2, Vec2, Vec2],
      });
      continue;
    }

    // Roof: a fan over the ring, entirely inside one flat rect, so every vertex
    // may take the rect's centre and the cap reads as one solid colour.
    const centre: Vec2 = [(u0 + u1) / 2, (v0 + v1) / 2];
    const ring = face.cornersMm;
    for (let index = 1; index < ring.length - 1; index += 1) {
      triangles.push({
        materialIndex: 0,
        a: toCellFrame(ring[0]!, face.offsetMeters),
        b: toCellFrame(ring[index]!, face.offsetMeters),
        c: toCellFrame(ring[index + 1]!, face.offsetMeters),
        uv: [centre, centre, centre] as [Vec2, Vec2, Vec2],
      });
    }
  }
  return { quads, triangles };
}
