/* global console, process */
/**
 * T013 ATTRIBUTION STAGE — the albedo-mix half.
 *
 * WHY THIS EXISTS. The pinned six-pose capture shows the tile is already
 * relatively red-deficient at 400 m, where the atlas is drawn at a texel:pixel
 * ratio of 0.94 — that is, at NO minification at all. A defect present with no
 * minification cannot be a minification defect. What is left is that the tile's
 * ALBEDO MIX differs from the source's, per channel, before any renderer
 * touches it.
 *
 * The bake's own module doc names three appearance error classes it owns, and
 * two of them move colour: GLAZING AND TRIM are absorbed into the facade
 * material, and SETBACKS, tier insets and rooftop groups are filled in solid.
 * Each of those materials carries a DIFFERENT hue. Absorbing them is therefore
 * not only a loss of detail; it is a re-weighting of the cell's colour mix.
 *
 * This file computes that re-weighting exactly, from the same plans the bake
 * and the shipped `lod_0` emitter both read.
 *
 * WHAT IT IS NOT. It is a surface-area and projected-area model with a
 * Lambertian sun term and NO shadowing, NO inter-building occlusion and NO
 * self-occlusion. It cannot predict a rendered mean and does not try to. It
 * answers one question — in which DIRECTION and by roughly what MAGNITUDE does
 * the bake move the cell's per-channel albedo mix — and every number is
 * labelled with that limit.
 *
 * Usage:
 *   node --experimental-strip-types scripts/far-tier-hue-albedo-cli.mjs albedo
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { bakeCell, materializeCell, DEFAULT_CELL_ID } from "./far-tier-bake-cli.mjs";
import { FAR_TIER_BAKE_RECIPE, srgbToLinear, tileIntegrator } from "../src/release/far-tier-bake.ts";
import { buildMidtownCoreV3Plan } from "../src/release/midtown-core-v3-materialization.ts";
import { tessellateV3Plan } from "../src/domain/deterministic-facade-generator-v3.ts";
import { V3T_CALIBRATED_PALETTE, v3TextureClassFor, v3tCalibratedFactor } from "../src/release/block835-v3-package.ts";
import { proceduralTextureTile } from "../src/release/procedural-texture.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-hue-20260819";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const round = (value, digits = 9) => Number(value.toFixed(digits));
const spreadOf = (values) => Math.max(...values) - Math.min(...values);

// ---------------------------------------------------------------------------
// Geometry helpers. Newell's method, so a non-planar quad still yields the
// area and normal a renderer's triangulation approximates.
// ---------------------------------------------------------------------------

function newell(corners) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index];
    const next = corners[(index + 1) % corners.length];
    nx += (current[1] - next[1]) * (current[2] + next[2]);
    ny += (current[2] - next[2]) * (current[0] + next[0]);
    nz += (current[0] - next[0]) * (current[1] + next[1]);
  }
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
  // Millimetres in, square metres out.
  return { areaSquareMeters: length / 2 / 1_000_000, normal: length === 0 ? [0, 0, 1] : [nx / length, ny / length, nz / length] };
}

/** THE PINNED SUN, as a direction TOWARD the sun in ENU. */
function pinnedSunDirection() {
  const rx = (50 * Math.PI) / 180;
  const rz = (35 * Math.PI) / 180;
  // Blender: a SUN points along its local -Z; the direction toward the sun is
  // R * (0,0,1) with R = Rz(35) Ry(0) Rx(50).
  const afterX = [0, -Math.sin(rx), Math.cos(rx)];
  return [
    afterX[0] * Math.cos(rz) - afterX[1] * Math.sin(rz),
    afterX[0] * Math.sin(rz) + afterX[1] * Math.cos(rz),
    afterX[2],
  ];
}

/** The pinned pose's direction TOWARD the camera in ENU, recovered from the rig. */
function poseDirection(azimuthDegrees) {
  const elevation = (18 * Math.PI) / 180;
  const azimuth = (azimuthDegrees * Math.PI) / 180;
  return [Math.sin(azimuth) * Math.cos(elevation), -Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation)];
}

const dot3 = (left, right) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

// ---------------------------------------------------------------------------
// Material albedo, in linear light, exactly as each subject renders it
// ---------------------------------------------------------------------------

/**
 * The shipped `lod_0` material's average linear albedo.
 *
 * A textured source surface renders `baseColorFactor x srgbToLinear(texel)`, so
 * its area average over many tile periods is the factor times the tile's LINEAR
 * mean — the same `tileIntegrator.linearMean` the bake integrates against. That
 * equality is the point: it is why the two subjects are comparable at all.
 */
function sourceMaterialAlbedo(plan, materialId) {
  const hex = V3T_CALIBRATED_PALETTE[plan.styleClass]?.[materialId];
  const textureClass = v3TextureClassFor(plan.styleClass, materialId);
  const tileLinearMean = textureClass === null ? 1 : tileIntegrator(textureClass).linearMean;
  if (hex === undefined) {
    const material = plan.materials.find((candidate) => candidate.id === materialId);
    if (!material) throw new Error(`no material ${materialId} on plan ${plan.buildingId}`);
    const factor = [material.baseColorSrgb[0] / 255, material.baseColorSrgb[1] / 255, material.baseColorSrgb[2] / 255];
    return { role: material.role, albedo: factor.map((value) => value * tileLinearMean) };
  }
  const mean = textureClass === null ? 1 : proceduralTextureTile(textureClass).meanModulation;
  const factor = v3tCalibratedFactor(hex, mean);
  const material = plan.materials.find((candidate) => candidate.id === materialId);
  return { role: material?.role ?? "unknown", albedo: [factor[0] * tileLinearMean, factor[1] * tileLinearMean, factor[2] * tileLinearMean] };
}

// ---------------------------------------------------------------------------
// Weighted mixes
// ---------------------------------------------------------------------------

function mixer() {
  const total = { weight: 0, sums: [0, 0, 0] };
  return {
    add(weight, albedo) {
      if (!(weight > 0)) return;
      total.weight += weight;
      for (let c = 0; c < 3; c += 1) total.sums[c] += weight * albedo[c];
    },
    result() {
      return total.weight === 0 ? [0, 0, 0] : total.sums.map((sum) => sum / total.weight);
    },
    weight() { return total.weight; },
  };
}

async function albedo(cellId) {
  const context = await materializeCell(cellId);
  const baked = bakeCell(context);
  const { cell, sources, planChecksumSha256, profile } = context;

  const sun = pinnedSunDirection();
  const poses = [
    { distanceMeters: 400, azimuthDegrees: 55 }, { distanceMeters: 400, azimuthDegrees: 235 },
    { distanceMeters: 1200, azimuthDegrees: 55 }, { distanceMeters: 1200, azimuthDegrees: 235 },
    { distanceMeters: 4000, azimuthDegrees: 55 }, { distanceMeters: 4000, azimuthDegrees: 235 },
  ];
  const azimuths = [55, 235];

  // ---- SOURCE: the tessellation the shipped lod_0 emitter uses -------------
  const sourceTotal = mixer();
  const sourceByAzimuth = new Map(azimuths.map((azimuth) => [azimuth, { projected: mixer(), lit: mixer() }]));
  const sourceByRole = new Map();
  let sourceArea = 0;

  // ---- BAKED: the packed far-tier faces ------------------------------------
  const bakedTotal = mixer();
  const bakedByAzimuth = new Map(azimuths.map((azimuth) => [azimuth, { projected: mixer(), lit: mixer() }]));
  const bakedByKind = new Map();
  let bakedArea = 0;

  for (const buildingId of [...cell.buildingIds].sort()) {
    const source = sources.get(buildingId);
    if (!source) continue;
    let plan;
    try { plan = buildMidtownCoreV3Plan(source, planChecksumSha256, profile).plan; } catch { continue; }
    const tessellation = tessellateV3Plan(plan, { includeRecesses: true });
    const albedoCache = new Map();
    const albedoOf = (materialId) => {
      const cached = albedoCache.get(materialId);
      if (cached) return cached;
      const value = sourceMaterialAlbedo(plan, materialId);
      albedoCache.set(materialId, value);
      return value;
    };
    const consume = (materialId, corners) => {
      const { areaSquareMeters, normal } = newell(corners);
      if (!(areaSquareMeters > 0)) return;
      const { role, albedo: value } = albedoOf(materialId);
      sourceArea += areaSquareMeters;
      sourceTotal.add(areaSquareMeters, value);
      const row = sourceByRole.get(role) ?? { role, areaSquareMeters: 0, sums: [0, 0, 0] };
      row.areaSquareMeters += areaSquareMeters;
      for (let c = 0; c < 3; c += 1) row.sums[c] += areaSquareMeters * value[c];
      sourceByRole.set(role, row);
      for (const azimuth of azimuths) {
        const view = Math.max(0, dot3(normal, poseDirection(azimuth)));
        const light = Math.max(0, dot3(normal, sun));
        const entry = sourceByAzimuth.get(azimuth);
        entry.projected.add(areaSquareMeters * view, value);
        entry.lit.add(areaSquareMeters * view * light, value);
      }
    };
    for (const quad of tessellation.quads) consume(quad.materialId, quad.corners);
    for (const triangle of tessellation.triangles) consume(triangle.materialId, [triangle.a, triangle.b, triangle.c]);
  }

  // The baked tile's albedo per face is the atlas content itself, decoded.
  const atlas = baked.atlasPng;
  void atlas;
  const size = baked.packing.atlasPixels;
  const rgb = (await import("../src/release/far-tier-bake.ts")).bakeFarTierAtlas(baked.packing);
  for (const face of baked.packing.faces) {
    const rect = face.rect;
    const sums = [0, 0, 0];
    let texels = 0;
    for (let row = 0; row < rect.height; row += 1) {
      for (let column = 0; column < rect.width; column += 1) {
        const at = ((rect.y + row) * size + (rect.x + column)) * 3;
        texels += 1;
        for (let c = 0; c < 3; c += 1) sums[c] += srgbToLinear(rgb[at + c] / 255);
      }
    }
    const value = sums.map((sum) => sum / texels);
    const { normal } = newell(face.cornersMm);
    bakedArea += face.areaSquareMeters;
    bakedTotal.add(face.areaSquareMeters, value);
    const row = bakedByKind.get(face.kind) ?? { kind: face.kind, areaSquareMeters: 0, sums: [0, 0, 0] };
    row.areaSquareMeters += face.areaSquareMeters;
    for (let c = 0; c < 3; c += 1) row.sums[c] += face.areaSquareMeters * value[c];
    bakedByKind.set(face.kind, row);
    for (const azimuth of azimuths) {
      const view = Math.max(0, dot3(normal, poseDirection(azimuth)));
      const light = Math.max(0, dot3(normal, sun));
      const entry = bakedByAzimuth.get(azimuth);
      entry.projected.add(face.areaSquareMeters * view, value);
      entry.lit.add(face.areaSquareMeters * view * light, value);
    }
  }

  const compare = (bakedMix, sourceMix) => {
    const ratios = bakedMix.map((value, index) => value / sourceMix[index]);
    return {
      sourceAlbedoLinear: sourceMix.map((value) => round(value, 9)),
      bakedAlbedoLinear: bakedMix.map((value) => round(value, 9)),
      perChannelRatio: ratios.map((value) => round(value, 6)),
      channelSpread: round(spreadOf(ratios), 6),
      sourceRedOverBlue: round(sourceMix[0] / sourceMix[2], 6),
      bakedRedOverBlue: round(bakedMix[0] / bakedMix[2], 6),
      bakedRedOverBlueRelativeToSource: round((bakedMix[0] / bakedMix[2]) / (sourceMix[0] / sourceMix[2]), 6),
    };
  };

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:albedo-mix`,
    task: "T013",
    artifact: "far-tier-hue-attribution-albedo-mix",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. Surface areas and albedos, not a capture.",
    subject: {
      cellId: cell.cellId,
      recipeId: FAR_TIER_BAKE_RECIPE.recipeId,
      sourceSurfaceAreaSquareMeters: round(sourceArea, 3),
      bakedSurfaceAreaSquareMeters: round(bakedArea, 3),
      bakedOverSourceArea: round(bakedArea / sourceArea, 6),
    },
    method: {
      sourceAlbedo: "For each tessellated lod_0 surface: baseColorFactor x the class tile's LINEAR mean, which is the area average a textured surface renders over many tile periods.",
      bakedAlbedo: "For each packed far-tier face: the decoded mean of its own atlas content rect. The shipped bytes, not a model of them.",
      weightings: [
        "totalSurfaceArea — every surface, unweighted by view.",
        "projected — area x max(0, n . v) at the pinned pose azimuth, elevation 18 degrees.",
        "lit — projected x max(0, n . sun) under the pinned sun.",
      ],
      limitations: "NO shadowing, NO inter-building occlusion, NO self-occlusion, NO minification. This model cannot predict a rendered mean and no verdict here rests on its absolute values — only on the SIGN and rough MAGNITUDE of the baked-minus-source hue shift.",
    },
    totalSurfaceArea: compare(bakedTotal.result(), sourceTotal.result()),
    byAzimuth: azimuths.map((azimuth) => ({
      azimuthDegrees: azimuth,
      projected: compare(bakedByAzimuth.get(azimuth).projected.result(), sourceByAzimuth.get(azimuth).projected.result()),
      lit: compare(bakedByAzimuth.get(azimuth).lit.result(), sourceByAzimuth.get(azimuth).lit.result()),
    })),
    sourceCompositionByRole: [...sourceByRole.values()]
      .sort((left, right) => right.areaSquareMeters - left.areaSquareMeters)
      .map((row) => ({
        role: row.role,
        areaSquareMeters: round(row.areaSquareMeters, 3),
        areaShare: round(row.areaSquareMeters / sourceArea, 6),
        albedoLinear: row.sums.map((sum) => round(sum / row.areaSquareMeters, 9)),
        redOverBlue: round(row.sums[0] / row.sums[2], 6),
      })),
    bakedCompositionByKind: [...bakedByKind.values()]
      .sort((left, right) => right.areaSquareMeters - left.areaSquareMeters)
      .map((row) => ({
        kind: row.kind,
        areaSquareMeters: round(row.areaSquareMeters, 3),
        areaShare: round(row.areaSquareMeters / bakedArea, 6),
        albedoLinear: row.sums.map((sum) => round(sum / row.areaSquareMeters, 9)),
        redOverBlue: round(row.sums[0] / row.sums[2], 6),
      })),
    poses,
    notClaimedHere: [
      "No rendered mean is predicted here.",
      "No fix is proposed or applied.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "albedo-mix.json"), text);
  await writeFile(join(evidenceRoot, "albedo-mix.sha256"), `${sha256HexSync(text)}  albedo-mix.json\n`);
  console.log(serialize({
    ok: true,
    totalSurfaceArea: record.totalSurfaceArea,
    byAzimuth: record.byAzimuth,
    sourceRoles: record.sourceCompositionByRole,
    bakedKinds: record.bakedCompositionByKind,
    recordSha256: sha256HexSync(text),
  }));
}

const argv = process.argv.slice(2);
const command = argv[0] ?? "albedo";
const cellFlag = argv.indexOf("--cell");
const cellId = cellFlag >= 0 ? argv[cellFlag + 1] : DEFAULT_CELL_ID;
if (command !== "albedo") {
  console.error(`far-tier-hue-albedo: unknown command ${command}`);
  process.exit(1);
}
await albedo(cellId);
