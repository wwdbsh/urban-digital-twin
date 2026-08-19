/* global console, process */
/**
 * T013 ATTRIBUTION STAGE — the arithmetic half.
 *
 * Everything in this file is a total function of the committed recipe, the
 * committed source snapshot and the byte-identical v1 atlas. Blender is NEVER
 * on this path: it is asked only the questions arithmetic cannot answer.
 *
 * WHAT IT MEASURES, and why each is a hypothesis test rather than a statistic.
 *
 * The observed finding is a per-channel RATIO spread (baked/source, per
 * channel) that exceeds 0.02 at five of six pinned poses, with RED always the
 * deficit channel and the spread GROWING with distance. Distance changes
 * exactly one thing about the baked subject: how heavily its atlas is
 * minified. So every candidate mechanism is a claim about what minification,
 * quantization or the colour path does to the three channels UNEQUALLY.
 *
 * THE STRUCTURAL ASYMMETRY THIS FILE EXISTS TO QUANTIFY. The shipped `lod_0`
 * source carries colour in the glTF `baseColorFactor` — a LINEAR per-material
 * constant — and modulation in a GRAYSCALE sRGB texture, so all three channels
 * sample the SAME texel and any texture filtering, in any colour space,
 * multiplies all three by the SAME scalar. Its hue is filter-invariant BY
 * CONSTRUCTION. The far-tier bake moves colour INTO an sRGB-encoded truecolour
 * atlas and sets `baseColorFactor` to [1,1,1,1]. Every per-channel value now
 * passes through an 8-bit sRGB encode and through whatever filter the renderer
 * applies to a minified texture. That is the only place in the pipeline where
 * a channel can move relative to its neighbours.
 *
 * Usage:
 *   node --experimental-strip-types scripts/far-tier-hue-arithmetic-cli.mjs analyse
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync, stableSerialize } from "../src/domain/deterministic-hash.ts";
import { bakeCell, materializeCell, DEFAULT_CELL_ID } from "./far-tier-bake-cli.mjs";
import {
  FAR_TIER_BAKE_RECIPE,
  bakeFarTierAtlas,
  farTierProjectionBasis,
  linearToSrgb,
  srgbToLinear,
  tileIntegrator,
} from "../src/release/far-tier-bake.ts";
import { proceduralTextureTile, encodeRgbPng } from "../src/release/procedural-texture.ts";
import { V3T_CALIBRATED_PALETTE, v3TextureClassFor, v3tCalibratedFactor } from "../src/release/block835-v3-package.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-hue-20260819";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);
const workRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID);

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const round = (value, digits = 9) => Number(value.toFixed(digits));

// ---------------------------------------------------------------------------
// The float field behind the shipped bytes
//
// `bakeFarTierAtlas` returns bytes and discards the linear values it rounded.
// Quantization bias cannot be measured from the bytes alone, so the rasterizer
// is REPLICATED here to keep both. The replication is not trusted: it re-encodes
// its own float field and the caller refuses to continue unless the result is
// byte-identical to `bakeFarTierAtlas` on the same packing.
// ---------------------------------------------------------------------------

const dot = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

function zoneAt(face, t) {
  for (const zone of face.zones) if (t >= zone.fromFraction && t < zone.toFraction) return zone;
  return face.zones[face.zones.length - 1];
}

const encodeByte = (linear) => Math.round(255 * linearToSrgb(Math.min(1, Math.max(0, linear))));

/** COVERAGE codes for every atlas texel. */
const UNUSED = 0;
const CONTENT = 1;
const GUTTER = 2;

/**
 * Replicate `bakeFarTierAtlas`, keeping the pre-quantization linear field and a
 * per-texel coverage map alongside the bytes.
 */
function rasterizeWithFloats(packing) {
  const size = packing.atlasPixels;
  const rgb = new Uint8Array(size * size * 3);
  const linear = new Float64Array(size * size * 3);
  const coverage = new Uint8Array(size * size);
  /** Which face owns each content texel, so face-weighted statistics are possible. */
  const owner = new Int32Array(size * size).fill(-1);
  let clampedTexels = 0;
  let maxLinear = [0, 0, 0];

  const put = (x, y, colour, floats, code, faceIndex) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const at = (y * size + x) * 3;
    rgb[at] = colour[0];
    rgb[at + 1] = colour[1];
    rgb[at + 2] = colour[2];
    linear[at] = floats[0];
    linear[at + 1] = floats[1];
    linear[at + 2] = floats[2];
    coverage[y * size + x] = code;
    if (faceIndex !== undefined) owner[y * size + x] = faceIndex;
  };

  packing.faces.forEach((face, faceIndex) => {
    const rect = face.rect;
    const { uAxis, vAxis } = farTierProjectionBasis(face.cornersMm);
    const a = face.cornersMm[0];
    const b = face.cornersMm[1];
    const top = face.cornersMm[2];
    const uAtA = dot(a, uAxis);
    const uAtB = dot(b, uAxis);
    const vAtBottom = dot(a, vAxis);
    const vAtTop = dot(top, vAxis);

    const track = (value) => {
      for (let c = 0; c < 3; c += 1) {
        if (value[c] > maxLinear[c]) maxLinear[c] = value[c];
        if (value[c] >= 1) clampedTexels += 1;
      }
    };

    let flatColour = null;
    let flatLinear = null;
    if (rect.flat) {
      let accumulated = [0, 0, 0];
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
      flatLinear = accumulated;
      flatColour = [encodeByte(accumulated[0]), encodeByte(accumulated[1]), encodeByte(accumulated[2])];
      track(accumulated);
    }

    for (let row = 0; row < rect.height; row += 1) {
      const t0 = 1 - (row + 1) / rect.height;
      const t1 = 1 - row / rect.height;
      const zone = zoneAt(face, (t0 + t1) / 2);
      for (let column = 0; column < rect.width; column += 1) {
        if (flatColour) { put(rect.x + column, rect.y + row, flatColour, flatLinear, CONTENT, faceIndex); continue; }
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
        const value = [zone.factor[0] * modulation, zone.factor[1] * modulation, zone.factor[2] * modulation];
        track(value);
        put(rect.x + column, rect.y + row, [encodeByte(value[0]), encodeByte(value[1]), encodeByte(value[2])], value, CONTENT, faceIndex);
      }
    }

    const gutter = rect.gutter;
    for (let ring = 1; ring <= gutter; ring += 1) {
      for (let column = -gutter; column < rect.width + gutter; column += 1) {
        const source = Math.min(rect.width - 1, Math.max(0, column));
        const topAt = ((rect.y) * size + (rect.x + source)) * 3;
        const bottomAt = ((rect.y + rect.height - 1) * size + (rect.x + source)) * 3;
        put(rect.x + column, rect.y - ring, [rgb[topAt], rgb[topAt + 1], rgb[topAt + 2]], [linear[topAt], linear[topAt + 1], linear[topAt + 2]], GUTTER, faceIndex);
        put(rect.x + column, rect.y + rect.height - 1 + ring, [rgb[bottomAt], rgb[bottomAt + 1], rgb[bottomAt + 2]], [linear[bottomAt], linear[bottomAt + 1], linear[bottomAt + 2]], GUTTER, faceIndex);
      }
      for (let row = -gutter; row < rect.height + gutter; row += 1) {
        const source = Math.min(rect.height - 1, Math.max(0, row));
        const leftAt = ((rect.y + source) * size + rect.x) * 3;
        const rightAt = ((rect.y + source) * size + rect.x + rect.width - 1) * 3;
        put(rect.x - ring, rect.y + row, [rgb[leftAt], rgb[leftAt + 1], rgb[leftAt + 2]], [linear[leftAt], linear[leftAt + 1], linear[leftAt + 2]], GUTTER, faceIndex);
        put(rect.x + rect.width - 1 + ring, rect.y + row, [rgb[rightAt], rgb[rightAt + 1], rgb[rightAt + 2]], [linear[rightAt], linear[rightAt + 1], linear[rightAt + 2]], GUTTER, faceIndex);
      }
    }
  });

  return { rgb, linear, coverage, owner, clampedTexels, maxLinear };
}

// ---------------------------------------------------------------------------
// Channel statistics
// ---------------------------------------------------------------------------

const spreadOf = (ratios) => Math.max(...ratios) - Math.min(...ratios);

/** Mean of a linear RGB field over a predicate, per channel. */
function channelMean(linear, size, predicate) {
  const sums = [0, 0, 0];
  let count = 0;
  for (let index = 0; index < size * size; index += 1) {
    if (!predicate(index)) continue;
    count += 1;
    sums[0] += linear[index * 3];
    sums[1] += linear[index * 3 + 1];
    sums[2] += linear[index * 3 + 2];
  }
  return { means: sums.map((sum) => (count === 0 ? 0 : sum / count)), count };
}

/**
 * Mip pyramid by 2x2 box filter, in a declared colour space.
 *
 * "linear" is what a correct sRGB-aware filter does: decode, average, and the
 * average is the answer. "encoded" is what a filter that ignores the transfer
 * function does: average the 8-bit sRGB codes and decode afterwards. The two
 * differ by Jensen's inequality, and the size of the difference depends on the
 * VARIANCE of the encoded values inside each footprint — which is a per-channel
 * quantity.
 */
function mipPyramid(level0Linear, size, space) {
  const levels = [{ level: 0, size, linear: level0Linear }];
  let current = level0Linear;
  let currentSize = size;
  while (currentSize > 1) {
    const nextSize = currentSize / 2;
    const next = new Float64Array(nextSize * nextSize * 3);
    for (let y = 0; y < nextSize; y += 1) {
      for (let x = 0; x < nextSize; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          const at = [
            ((2 * y) * currentSize + (2 * x)) * 3 + c,
            ((2 * y) * currentSize + (2 * x + 1)) * 3 + c,
            ((2 * y + 1) * currentSize + (2 * x)) * 3 + c,
            ((2 * y + 1) * currentSize + (2 * x + 1)) * 3 + c,
          ];
          if (space === "linear") {
            next[(y * nextSize + x) * 3 + c] = (current[at[0]] + current[at[1]] + current[at[2]] + current[at[3]]) / 4;
          } else {
            const encoded = (linearToSrgb(current[at[0]]) + linearToSrgb(current[at[1]]) + linearToSrgb(current[at[2]]) + linearToSrgb(current[at[3]])) / 4;
            next[(y * nextSize + x) * 3 + c] = srgbToLinear(encoded);
          }
        }
      }
    }
    levels.push({ level: levels.length, size: nextSize, linear: next });
    current = next;
    currentSize = nextSize;
  }
  return levels;
}

function pyramidReport(level0Linear, size, space) {
  const levels = mipPyramid(level0Linear, size, space);
  const base = channelMean(levels[0].linear, levels[0].size, () => true).means;
  return levels.map((entry) => {
    const means = channelMean(entry.linear, entry.size, () => true).means;
    const ratios = means.map((value, index) => value / base[index]);
    return {
      level: entry.level,
      sizeTexels: entry.size,
      channelMeansLinear: means.map((value) => round(value, 9)),
      ratioToLevel0: ratios.map((value) => round(value, 6)),
      channelRatioSpread: round(spreadOf(ratios), 6),
      luminanceRatioToLevel0: round((0.2126 * means[0] + 0.7152 * means[1] + 0.0722 * means[2]) / (0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]), 6),
    };
  });
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

async function analyse(cellId) {
  const context = await materializeCell(cellId);
  const baked = bakeCell(context);
  const packing = baked.packing;
  const size = packing.atlasPixels;

  // The replication gate. If these bytes are not the shipped bytes, nothing
  // downstream is about the shipped tile and the run stops.
  const reference = bakeFarTierAtlas(packing);
  const replica = rasterizeWithFloats(packing);
  let byteMismatches = 0;
  for (let index = 0; index < reference.length; index += 1) if (reference[index] !== replica.rgb[index]) byteMismatches += 1;
  const atlasSha256 = sha256HexBytes(encodeRgbPng(size, size, replica.rgb));
  if (byteMismatches !== 0) {
    console.error(`far-tier-hue-arithmetic: the float replication differs from the shipped rasterizer in ${byteMismatches} bytes; refusing to reason about a different atlas.`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Census
  // -------------------------------------------------------------------------
  let unused = 0;
  let content = 0;
  let gutter = 0;
  for (let index = 0; index < size * size; index += 1) {
    if (replica.coverage[index] === UNUSED) unused += 1;
    else if (replica.coverage[index] === CONTENT) content += 1;
    else gutter += 1;
  }
  let unusedNonBlack = 0;
  for (let index = 0; index < size * size; index += 1) {
    if (replica.coverage[index] !== UNUSED) continue;
    if (replica.rgb[index * 3] !== 0 || replica.rgb[index * 3 + 1] !== 0 || replica.rgb[index * 3 + 2] !== 0) unusedNonBlack += 1;
  }

  const decoded = new Float64Array(size * size * 3);
  for (let index = 0; index < decoded.length; index += 1) decoded[index] = srgbToLinear(replica.rgb[index] / 255);

  const usedPredicate = (index) => replica.coverage[index] !== UNUSED;
  const contentPredicate = (index) => replica.coverage[index] === CONTENT;

  const wholeAtlas = channelMean(decoded, size, () => true);
  const usedOnly = channelMean(decoded, size, usedPredicate);
  const contentOnly = channelMean(decoded, size, contentPredicate);

  // -------------------------------------------------------------------------
  // H2 — sRGB quantization bias, per channel
  // -------------------------------------------------------------------------
  const analyticContent = channelMean(replica.linear, size, contentPredicate);
  const quantizedContent = channelMean(decoded, size, contentPredicate);
  const quantizationBias = quantizedContent.means.map((value, index) => value / analyticContent.means[index] - 1);

  // Face-world-area weighted, which is what a broadside view approximates.
  const areaSums = [0, 0, 0];
  const areaSumsAnalytic = [0, 0, 0];
  let areaTotal = 0;
  const perTexelArea = new Float64Array(packing.faces.length);
  packing.faces.forEach((face, faceIndex) => {
    const texels = Math.max(1, face.rect.width * face.rect.height);
    perTexelArea[faceIndex] = face.areaSquareMeters / texels;
  });
  for (let index = 0; index < size * size; index += 1) {
    if (replica.coverage[index] !== CONTENT) continue;
    const faceIndex = replica.owner[index];
    const weight = perTexelArea[faceIndex];
    areaTotal += weight;
    for (let c = 0; c < 3; c += 1) {
      areaSums[c] += weight * decoded[index * 3 + c];
      areaSumsAnalytic[c] += weight * replica.linear[index * 3 + c];
    }
  }
  const areaWeightedQuantized = areaSums.map((value) => value / areaTotal);
  const areaWeightedAnalytic = areaSumsAnalytic.map((value) => value / areaTotal);
  const quantizationBiasAreaWeighted = areaWeightedQuantized.map((value, index) => value / areaWeightedAnalytic[index] - 1);

  // -------------------------------------------------------------------------
  // H1 / H6 — what minification does, in each filtering colour space
  // -------------------------------------------------------------------------
  const pyramidLinear = pyramidReport(decoded, size, "linear");
  const pyramidEncoded = pyramidReport(decoded, size, "encoded");

  // The same two pyramids with the unused area filled with the used-area mean,
  // which is the "black filled in" instrumentation variant expressed
  // arithmetically. It separates BLACK DILUTION from CONTENT VARIANCE.
  const filled = new Float64Array(decoded);
  for (let index = 0; index < size * size; index += 1) {
    if (replica.coverage[index] !== UNUSED) continue;
    for (let c = 0; c < 3; c += 1) filled[index * 3 + c] = usedOnly.means[c];
  }
  const pyramidLinearFilled = pyramidReport(filled, size, "linear");
  const pyramidEncodedFilled = pyramidReport(filled, size, "encoded");

  // Pose to mip level. The tile's covered pixel counts are the pinned
  // baseline's own `unionPixels`, and the atlas carries `content + gutter`
  // texels, so the texel:pixel ratio at a pose is sqrt(usedTexels/pixels) and
  // the level is its base-2 logarithm. APPROXIMATE: it assumes the whole atlas
  // is on screen at once and ignores per-face footprint variation.
  const posePixels = [
    { distanceMeters: 400, azimuthDegrees: 55, unionPixels: 63724 },
    { distanceMeters: 400, azimuthDegrees: 235, unionPixels: 60356 },
    { distanceMeters: 1200, azimuthDegrees: 55, unionPixels: 5964 },
    { distanceMeters: 1200, azimuthDegrees: 235, unionPixels: 5918 },
    { distanceMeters: 4000, azimuthDegrees: 55, unionPixels: 524 },
    { distanceMeters: 4000, azimuthDegrees: 235, unionPixels: 517 },
  ];
  const usedTexels = content + gutter;
  const poseLevels = posePixels.map((pose) => {
    const texelPerPixel = Math.sqrt(usedTexels / pose.unionPixels);
    const level = Math.max(0, Math.log2(texelPerPixel));
    const interpolate = (report) => {
      const low = Math.min(report.length - 1, Math.floor(level));
      const high = Math.min(report.length - 1, low + 1);
      const t = level - low;
      return round(report[low].channelRatioSpread + t * (report[high].channelRatioSpread - report[low].channelRatioSpread), 6);
    };
    return {
      ...pose,
      texelPerPixel: round(texelPerPixel, 4),
      impliedMipLevel: round(level, 4),
      predictedSpreadLinearFilter: interpolate(pyramidLinear),
      predictedSpreadEncodedFilter: interpolate(pyramidEncoded),
    };
  });

  // -------------------------------------------------------------------------
  // H3 — the zone-factor colour path
  // -------------------------------------------------------------------------
  const styleClasses = [...new Set(baked.members.filter((member) => member.included).map((member) => member.styleClass))].sort();
  const factorRows = [];
  for (const styleClass of styleClasses) {
    const palette = V3T_CALIBRATED_PALETTE[styleClass];
    for (const materialId of Object.keys(palette).sort()) {
      const hex = palette[materialId];
      const target = [
        Number.parseInt(hex.slice(1, 3), 16) / 255,
        Number.parseInt(hex.slice(3, 5), 16) / 255,
        Number.parseInt(hex.slice(5, 7), 16) / 255,
      ];
      const textureClass = v3TextureClassFor(styleClass, materialId);
      const mean = textureClass === null ? 1 : proceduralTextureTile(textureClass).meanModulation;
      const factor = v3tCalibratedFactor(hex, mean);
      const perChannelScale = [factor[0] / target[0], factor[1] / target[1], factor[2] / target[2]];
      factorRows.push({
        styleClass,
        materialId,
        hex,
        textureClass,
        meanModulation: round(mean, 9),
        factor: [round(factor[0], 9), round(factor[1], 9), round(factor[2], 9)],
        perChannelScale: perChannelScale.map((value) => round(value, 12)),
        scaleSpread: round(spreadOf(perChannelScale), 15),
        maxChannel: round(Math.max(factor[0], factor[1], factor[2]), 9),
      });
    }
  }
  const worstScaleSpread = Math.max(...factorRows.map((row) => row.scaleSpread));
  const worstFactorChannel = Math.max(...factorRows.map((row) => row.maxChannel));

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:atlas-arithmetic`,
    task: "T013",
    artifact: "far-tier-hue-attribution-arithmetic",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. Every number here is a total function of the committed recipe, the pinned base snapshot and the byte-identical v1 atlas.",
    subject: {
      cellId: context.cell.cellId,
      atlasSha256,
      atlasSha256ExpectedFromProvenance: "c159e0508aeb7522620b799b83041461aecf34727f69209bd7efbf992f5c067a",
      atlasReproducesProvenance: atlasSha256 === "c159e0508aeb7522620b799b83041461aecf34727f69209bd7efbf992f5c067a",
      atlasPixels: size,
      recipeId: FAR_TIER_BAKE_RECIPE.recipeId,
    },
    replicationGate: {
      why: "Quantization bias is a statement about the values that were ROUNDED, which the shipped rasterizer discards. The rasterizer is replicated here to keep them, and the replication is verified rather than trusted.",
      byteMismatchesAgainstShippedRasterizer: byteMismatches,
      verdict: byteMismatches === 0 ? "PASS" : "FAIL",
    },
    atlasCensus: {
      totalTexels: size * size,
      contentTexels: content,
      gutterTexels: gutter,
      unusedTexels: unused,
      unusedShare: round(unused / (size * size), 6),
      unusedShareMatchesOccupancyRecord: round(1 - baked.packing.occupancy, 6),
      unusedTexelsThatAreNotPureBlack: unusedNonBlack,
      channelMeansLinear: {
        wholeAtlasIncludingUnused: wholeAtlas.means.map((value) => round(value, 9)),
        usedAreaOnly: usedOnly.means.map((value) => round(value, 9)),
        contentOnly: contentOnly.means.map((value) => round(value, 9)),
      },
      hueOfWholeAtlasAgainstUsedArea: {
        perChannelRatio: wholeAtlas.means.map((value, index) => round(value / usedOnly.means[index], 9)),
        spread: round(spreadOf(wholeAtlas.means.map((value, index) => value / usedOnly.means[index])), 9),
        statement: "Mixing any colour with BLACK in LINEAR light is a per-channel-EQUAL scaling. The three ratios above are identical to floating-point precision and the spread is at the rounding floor. Black area changes LUMINANCE and cannot change HUE, so long as the mixing happens in linear light.",
      },
    },
    hypotheses: {
      H1_blackAtlasDilution: {
        hypothesis: "The atlas's unused black area averages in under minification and moves the per-channel ratios.",
        testedBy: "Exact arithmetic over the real atlas: the whole-atlas channel means against the used-area channel means, and a full 2x2 box mip pyramid built in LINEAR light.",
        evidence: {
          unusedShare: round(unused / (size * size), 6),
          blackMixHueSpread: round(spreadOf(wholeAtlas.means.map((value, index) => value / usedOnly.means[index])), 12),
          linearPyramidWorstSpread: round(Math.max(...pyramidLinear.map((entry) => entry.channelRatioSpread)), 9),
          linearPyramidWorstLuminanceRatio: round(Math.min(...pyramidLinear.map((entry) => entry.luminanceRatioToLevel0)), 9),
        },
        verdict: "REJECTED as the hue mechanism — arithmetically, not empirically. A linear-light box filter preserves the per-channel mean of the whole atlas EXACTLY at every mip level, black area included, so it can move neither hue nor the whole-atlas luminance. Black dilution remains available as a LOCAL luminance mechanism where a footprint straddles the used/unused boundary; it is not available as a hue mechanism at all.",
      },
      H2_srgbQuantization: {
        hypothesis: "8-bit sRGB quantization floors the channels unequally, red hardest.",
        testedBy: "Comparing the pre-quantization linear field the rasterizer rounded against the decoded shipped bytes, over content texels, unweighted and face-world-area weighted.",
        evidence: {
          analyticContentMeansLinear: analyticContent.means.map((value) => round(value, 9)),
          quantizedContentMeansLinear: quantizedContent.means.map((value) => round(value, 9)),
          perChannelRelativeBias: quantizationBias.map((value) => round(value, 8)),
          perChannelRelativeBiasSpread: round(spreadOf(quantizationBias), 8),
          areaWeightedPerChannelRelativeBias: quantizationBiasAreaWeighted.map((value) => round(value, 8)),
          areaWeightedSpread: round(spreadOf(quantizationBiasAreaWeighted), 8),
        },
        verdict: "REJECTED as the cause; RETAINED as a small contributor with the RIGHT SIGN. Quantization does bias red lowest and blue highest, which is the observed pattern — but by a channel spread of about 0.0008 against measured pose spreads of 0.0160 to 0.0338. That is between 20 and 43 times too small. It is also frozen into the bytes and therefore identical at every distance, while the measured spread grows with distance.",
      },
      H3_zoneFactorColourPath: {
        hypothesis: "v3tCalibratedFactor or the palette lowers red systematically.",
        testedBy: "Per-channel arithmetic over every calibrated palette entry reachable in this cell.",
        evidence: {
          entriesChecked: factorRows.length,
          worstPerChannelScaleSpread: worstScaleSpread,
          worstFactorChannelValue: worstFactorChannel,
          clampedTexelChannelCount: replica.clampedTexels,
          maxLinearPerChannelBeforeClamp: replica.maxLinear.map((value) => round(value, 9)),
          rows: factorRows,
        },
        verdict: "REJECTED. The calibration scale is UNIFORM across the three channels by construction and measures uniform to floating-point precision, so it preserves the target's channel ratios exactly. It is also distance-invariant, which the distance-growing spread already argued against. No texel reaches the clamp, so the encoder's clamp cannot be clipping a channel either.",
      },
      H6_filteringColourSpace: {
        hypothesis: "Minification of the baked TRUECOLOUR atlas is not channel-neutral when the filter ignores the sRGB transfer function; the source's GRAYSCALE texture is immune by construction.",
        testedBy: "The same 2x2 box mip pyramid built twice — once in linear light, once on the 8-bit sRGB codes — over the real atlas, with and without the unused black area filled.",
        evidence: {
          pyramidLinear,
          pyramidEncoded,
          pyramidLinearUnusedFilledWithUsedAreaMean: pyramidLinearFilled,
          pyramidEncodedUnusedFilledWithUsedAreaMean: pyramidEncodedFilled,
          poseToMipLevel: poseLevels,
        },
        verdict: "REJECTED BY SIGN, and by the 400 m pose. A linear-light pyramid moves the channel ratios by exactly 0 at every level. An encoded-space pyramid moves them a great deal — but it attenuates the channel with the largest RELATIVE encoded variance hardest, and in this atlas that is BLUE. Its ratios run R > G > B at every level, the OPPOSITE order to the measured deficit, and by the level the 4,000 m pose implies it would open a spread of about 0.04 the wrong way. Neither filtering space can make red the deficit channel here.",
      },
    },
    structuralAsymmetry: {
      statement: "The shipped lod_0 source carries colour in the LINEAR glTF baseColorFactor and modulation in a GRAYSCALE sRGB texture. All three channels therefore sample the SAME texel, and any texture filter — in any colour space, at any mip level — multiplies all three by the SAME scalar. The source's hue is filter-invariant BY CONSTRUCTION.",
      bakeChange: "The far-tier bake moves colour INTO an sRGB-encoded truecolour atlas and sets baseColorFactor to [1,1,1,1]. Per-channel values now pass through an 8-bit sRGB encode and through the renderer's minification filter.",
      consequence: "Any per-channel non-neutrality in the encode or the filter is a defect the BAKED tile has and the SOURCE cannot have. That asymmetry is a property of the bake's representation choice, not of any one renderer.",
      codeEvidence: {
        sourceTextureIsGrayscale: "src/release/procedural-texture.ts rasterizes one luminance channel and writes it through encodeGrayscalePng.",
        sourceColourIsLinearFactor: "src/release/block835-v3-package.ts sets material baseColorFactor to v3tCalibratedFactor(hex, mean).",
        bakeColourIsInTheTexture: "src/release/far-tier-bake.ts encodes factor x modulation into the atlas and the bake CLI writes baseColorFactor [1,1,1,1].",
      },
    },
    notClaimedHere: [
      "This file measures the ATLAS. It does not measure a render, and no verdict about the pinned instrument's own filtering behaviour is drawn from it.",
      "A 2x2 box pyramid is a MODEL of minification, not the renderer's filter. It bounds and signs the effect; it does not reproduce EEVEE.",
      "No fix is proposed or applied.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(workRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "atlas-arithmetic.json"), text);
  await writeFile(join(evidenceRoot, "atlas-arithmetic.sha256"), `${sha256HexSync(text)}  atlas-arithmetic.json\n`);

  console.log(serialize({
    ok: true,
    atlasSha256,
    replicationByteMismatches: byteMismatches,
    unusedShare: round(unused / (size * size), 6),
    blackMixHueSpread: spreadOf(wholeAtlas.means.map((value, index) => value / usedOnly.means[index])),
    quantizationBias: quantizationBias.map((value) => round(value, 8)),
    quantizationBiasSpread: round(spreadOf(quantizationBias), 8),
    linearPyramidSpreads: pyramidLinear.map((entry) => entry.channelRatioSpread),
    encodedPyramidSpreads: pyramidEncoded.map((entry) => entry.channelRatioSpread),
    encodedPyramidRatios: pyramidEncoded.map((entry) => entry.ratioToLevel0),
    encodedFilledSpreads: pyramidEncodedFilled.map((entry) => entry.channelRatioSpread),
    poseLevels,
    worstScaleSpread,
    recordSha256: sha256HexSync(text),
  }));
}

const argv = process.argv.slice(2);
const command = argv[0] ?? "analyse";
const cellFlag = argv.indexOf("--cell");
const cellId = cellFlag >= 0 ? argv[cellFlag + 1] : DEFAULT_CELL_ID;
if (command !== "analyse") {
  console.error(`far-tier-hue-arithmetic: unknown command ${command}`);
  process.exit(1);
}
await analyse(cellId);
void stableSerialize;
