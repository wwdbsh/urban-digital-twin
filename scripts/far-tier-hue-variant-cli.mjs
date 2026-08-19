/* global console, process, TextDecoder, TextEncoder */
/**
 * T013 ATTRIBUTION STAGE — the controlled instrumentation variant.
 *
 * THE QUESTION IT ANSWERS. The tile's hue sits below the source's at every
 * pinned pose, and the arithmetic has already shown the tile's WALL albedo
 * reproduces the source's FACADE albedo to five decimals. So the gap is not in
 * the facade colour. The bake's own module doc names what else it does to
 * colour: "The far tier resolves only the FACADE material of each wall zone;
 * glazing and trim are absorbed into it."
 *
 * This tool performs exactly that absorption on the SOURCE, and nothing else.
 * Geometry, topology, vertex data, UVs, normals, transforms and the whole
 * binary chunk are untouched; only the glTF material records for the glazing,
 * trim and metal roles are replaced by the facade material record of the same
 * vertical zone. The result is a subject with the SOURCE's geometry and the
 * TILE's palette. If the tile's hue deficit is the absorption, this variant
 * must move to meet it; if it does not, the absorption is not the mechanism.
 *
 * LABELLING. Every byte this writes is INSTRUMENTATION. It is gitignored, it is
 * digested into the committed record, it is never a release artifact, and it is
 * not a proposed recipe.
 *
 * Usage:
 *   node --experimental-strip-types scripts/far-tier-hue-variant-cli.mjs emit-absorbed-source
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { materializeCell, DEFAULT_CELL_ID, CAPTURE as SOURCE_CAPTURE } from "./far-tier-bake-cli.mjs";
import { buildMidtownCoreV3Plan } from "../src/release/midtown-core-v3-materialization.ts";
import { tessellateV3Plan } from "../src/domain/deterministic-facade-generator-v3.ts";
import {
  FAR_TIER_BAKE_RECIPE,
  bakeFarTierAtlas,
  farTierFacesForBuilding,
  farTierGeometry,
  farTierRecipeHash,
  linearToSrgb,
  packFarTierAtlas,
  tileIntegrator,
} from "../src/release/far-tier-bake.ts";
import {
  FAR_TIER_NEAR_EDGE_METERS,
  farTierBudgetContractHash,
  farTierResolution,
  farTierTexelWorldSizeMeters,
} from "../src/release/far-tier-budget.ts";
import { V3T_CALIBRATED_PALETTE, v3TextureClassFor, v3tCalibratedFactor } from "../src/release/block835-v3-package.ts";
import { proceduralTextureTile, encodeRgbPng } from "../src/release/procedural-texture.ts";
import { writeCanonicalGlb } from "../src/release/canonical-glb.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-hue-20260819";
const workRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID);
const sourceRoot = join(repositoryRoot, "artifacts/far-tier-hlod-20260818/sources");

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Which facade material each absorbed role folds into.
 *
 * The bake resolves ONE facade material per wall ZONE, so the absorption is
 * zone-preserving: a base-zone window folds into the base facade, not the
 * shaft's. `material:metal` has no zone and folds into the shaft, which is
 * where the fire escapes and rooftop metal it names actually sit.
 */
function absorbedInto(materialId) {
  if (materialId.startsWith("material:facade")) return null;
  if (materialId === "material:roof" || materialId === "material:ground") return null;
  if (materialId.endsWith(":base")) return "material:facade:base";
  return "material:facade:shaft";
}

function readGlbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength));
  return { json: JSON.parse(jsonText), jsonLength, rest: bytes.subarray(20 + jsonLength) };
}

function writeGlb(json, rest) {
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += " ";
  const jsonBytes = new TextEncoder().encode(text);
  const total = 12 + 8 + jsonBytes.length + rest.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.set(rest, 20 + jsonBytes.length);
  return out;
}

async function emit(cellId) {
  const context = await materializeCell(cellId);
  const { sources, planChecksumSha256, profile } = context;
  const outputRoot = join(workRoot, "variant-sources");
  await mkdir(join(outputRoot, "assets"), { recursive: true });

  const placements = JSON.parse(await readFile(join(sourceRoot, "placements.json"), "utf8"));
  const written = [];
  let absorbedMaterials = 0;
  let untouchedMaterials = 0;

  for (const asset of placements.assets) {
    const plan = buildMidtownCoreV3Plan(sources.get(asset.buildingId), planChecksumSha256, profile).plan;
    const bytes = new Uint8Array(await readFile(join(sourceRoot, "assets", asset.name)));
    const { json, rest } = readGlbJson(bytes);
    if (json.materials.length !== plan.materials.length) {
      console.error(`far-tier-hue-variant: ${asset.name} declares ${json.materials.length} materials against ${plan.materials.length} on its plan; refusing to guess the mapping.`);
      process.exit(1);
    }
    const indexById = new Map(plan.materials.map((material, index) => [material.id, index]));
    const replacements = [];
    for (let index = 0; index < plan.materials.length; index += 1) {
      const target = absorbedInto(plan.materials[index].id);
      if (target === null) { untouchedMaterials += 1; continue; }
      const donor = indexById.get(target);
      if (donor === undefined) { untouchedMaterials += 1; continue; }
      // WHOLE MATERIAL RECORD, not just the colour. The bake absorbs the
      // surface entirely: its factor, its class tile and its metal/roughness.
      json.materials[index] = JSON.parse(JSON.stringify(json.materials[donor]));
      replacements.push({ from: plan.materials[index].id, to: target });
      absorbedMaterials += 1;
    }
    const variant = writeGlb(json, rest);
    await writeFile(join(outputRoot, "assets", asset.name), variant);
    written.push({
      name: asset.name,
      buildingId: asset.buildingId,
      originalSha256: asset.checksumSha256,
      variantSha256: sha256HexBytes(variant),
      translation: asset.translation,
      replacements,
    });
  }

  const manifest = {
    label: "INSTRUMENTATION VARIANT — NOT A RELEASE ARTIFACT, NOT A PROPOSED RECIPE.",
    recordId: `${EVIDENCE_ID}:absorbed-source-variant`,
    derivation: "The verified shipped lod_0 bytes with ONE change: every glazing, trim and metal material record is replaced by the facade material record of the same vertical zone. Geometry, UVs, normals, transforms and the entire binary chunk are byte-identical to the source.",
    whatItIsolates: "The bake's documented absorption of glazing and trim into the facade material, applied to the SOURCE so that geometry is held constant.",
    frame: placements.frame,
    absorbedMaterialRecords: absorbedMaterials,
    untouchedMaterialRecords: untouchedMaterials,
    assets: written,
  };
  const text = serialize(manifest);
  await writeFile(join(outputRoot, "placements.json"), text);
  console.log(serialize({ ok: true, root: outputRoot, assets: written.length, absorbedMaterials, untouchedMaterials, manifestSha256: sha256HexSync(text) }));
}


// ---------------------------------------------------------------------------
// The ROOF term (T013 roof stage)
//
// THE AMBIGUITY THAT DECIDED THE METHOD. The prism's flat roof cap stands in for
// the source's roof caps, setback decks, roof-equipment boxes, water tanks and
// their legs. Three of those carry `material:roof`, which is ALREADY the colour
// the prism bakes, so substituting it changes nothing. The tanks and legs carry
// `material:metal` — and so do the FIRE ESCAPES, which hang on walls.
//
// The split was measured before any variant was built: of 3,095.439 square
// metres of metal in this cell, only 710.918 — 22.97 per cent — is above the
// crown. A material-record substitution cannot separate them, so a
// "roof-substituted source" variant WOULD SILENTLY REPAINT THE FIRE ESCAPES.
// That is the ambiguity this tool refuses on, and it is why the roof term is
// measured by the INVERSE variant instead: the tile's roof cap is repainted
// with the area-correct aggregate of the source's roof region, per building,
// computed from committed plan data. Unambiguous, and it is the quantity a fix
// would actually have to install.
// ---------------------------------------------------------------------------

const ROOF_ROLES = new Set(["roof", "metal"]);

function newellOf(corners) {
  let nx = 0; let ny = 0; let nz = 0; let cz = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index];
    const next = corners[(index + 1) % corners.length];
    nx += (current[1] - next[1]) * (current[2] + next[2]);
    ny += (current[2] - next[2]) * (current[0] + next[0]);
    nz += (current[0] - next[0]) * (current[1] + next[1]);
    cz += current[2];
  }
  const doubleArea = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return { areaSquareMeters: doubleArea / 2 / 1_000_000, centroidZ: cz / corners.length };
}

function materialAlbedo(plan, materialId) {
  const hex = V3T_CALIBRATED_PALETTE[plan.styleClass]?.[materialId];
  const textureClass = v3TextureClassFor(plan.styleClass, materialId);
  const tileLinearMean = textureClass === null ? 1 : tileIntegrator(textureClass).linearMean;
  if (hex === undefined) {
    const material = plan.materials.find((candidate) => candidate.id === materialId);
    return [material.baseColorSrgb[0] / 255 * tileLinearMean, material.baseColorSrgb[1] / 255 * tileLinearMean, material.baseColorSrgb[2] / 255 * tileLinearMean];
  }
  const mean = textureClass === null ? 1 : proceduralTextureTile(textureClass).meanModulation;
  const factor = v3tCalibratedFactor(hex, mean);
  return [factor[0] * tileLinearMean, factor[1] * tileLinearMean, factor[2] * tileLinearMean];
}

/** One building's ROOF-REGION aggregate: everything the flat cap stands in for. */
function roofRegionAggregate(plan) {
  const roleById = new Map(plan.materials.map((material) => [material.id, material.role]));
  const crownTopMm = Math.max(...plan.tiers.map((tier) => tier.topZMm));
  const tessellation = tessellateV3Plan(plan, { includeRecesses: true });
  const sums = [0, 0, 0];
  let area = 0;
  let rooftopMetalArea = 0;
  let wallMetalArea = 0;
  const cache = new Map();
  const consume = (materialId, corners) => {
    const role = roleById.get(materialId);
    if (role === undefined || !ROOF_ROLES.has(role)) return;
    const { areaSquareMeters, centroidZ } = newellOf(corners);
    if (!(areaSquareMeters > 0)) return;
    if (role === "metal") {
      // ABOVE THE CROWN is the whole test. A fire escape is not a roof object.
      if (centroidZ <= crownTopMm + 1e-6) { wallMetalArea += areaSquareMeters; return; }
      rooftopMetalArea += areaSquareMeters;
    }
    const albedo = cache.get(materialId) ?? materialAlbedo(plan, materialId);
    cache.set(materialId, albedo);
    area += areaSquareMeters;
    for (let channel = 0; channel < 3; channel += 1) sums[channel] += areaSquareMeters * albedo[channel];
  };
  for (const quad of tessellation.quads) consume(quad.materialId, quad.corners);
  for (const triangle of tessellation.triangles) consume(triangle.materialId, [triangle.a, triangle.b, triangle.c]);
  return {
    albedo: area > 0 ? sums.map((sum) => sum / area) : null,
    areaSquareMeters: area,
    rooftopMetalArea,
    wallMetalArea,
  };
}

const encodeByte = (linear) => Math.round(255 * linearToSrgb(Math.min(1, Math.max(0, linear))));

async function emitRoofAggregateTile(cellId) {
  const context = await materializeCell(cellId);
  const { cell, sources, planChecksumSha256, profile } = context;
  const origin = [cell.bounds.west, cell.bounds.south];
  const faces = [];
  const aggregates = new Map();
  const members = [];
  let rooftopMetal = 0;
  let wallMetal = 0;
  let roofRegionArea = 0;

  for (const buildingId of [...cell.buildingIds].sort()) {
    const source = sources.get(buildingId);
    if (!source) continue;
    let plan;
    try { plan = buildMidtownCoreV3Plan(source, planChecksumSha256, profile).plan; } catch { continue; }
    const offsetMeters = [
      (source.representative[0] - origin[0]) * FAR_TIER_BAKE_RECIPE.metersPerDegreeLongitude,
      (source.representative[1] - origin[1]) * FAR_TIER_BAKE_RECIPE.metersPerDegreeLatitude,
    ];
    faces.push(...farTierFacesForBuilding(plan, offsetMeters));
    const aggregate = roofRegionAggregate(plan);
    if (aggregate.albedo === null) {
      console.error(`far-tier-hue-variant: ${buildingId} has no roof-region surface; refusing to invent one.`);
      process.exit(1);
    }
    aggregates.set(buildingId, aggregate);
    rooftopMetal += aggregate.rooftopMetalArea;
    wallMetal += aggregate.wallMetalArea;
    roofRegionArea += aggregate.areaSquareMeters;
    members.push(buildingId);
  }

  const surfaceArea = faces.reduce((sum, face) => sum + face.areaSquareMeters, 0);
  const resolution = farTierResolution(surfaceArea);
  const packing = packFarTierAtlas(faces, resolution.atlasPixels, farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS));
  const rgb = bakeFarTierAtlas(packing);
  const baseAtlasSha = sha256HexBytes(encodeRgbPng(packing.atlasPixels, packing.atlasPixels, rgb));
  if (baseAtlasSha !== "c159e0508aeb7522620b799b83041461aecf34727f69209bd7efbf992f5c067a") {
    console.error(`far-tier-hue-variant: the v1 baseline this variant is built on does not reproduce (${baseAtlasSha}); refusing.`);
    process.exit(1);
  }

  // Repaint ONLY the roof faces, content and gutter alike. A roof face is flat,
  // so its gutter is edge-clamp replication of a single colour and repainting
  // both with that colour reproduces exactly what the rasterizer would emit.
  const size = packing.atlasPixels;
  let repaintedFaces = 0;
  let repaintedTexels = 0;
  const shifts = [];
  for (const face of packing.faces) {
    if (face.kind !== "roof") continue;
    const aggregate = aggregates.get(face.buildingId);
    if (!aggregate) continue;
    const rect = face.rect;
    const before = [rgb[(rect.y * size + rect.x) * 3], rgb[(rect.y * size + rect.x) * 3 + 1], rgb[(rect.y * size + rect.x) * 3 + 2]];
    const colour = [encodeByte(aggregate.albedo[0]), encodeByte(aggregate.albedo[1]), encodeByte(aggregate.albedo[2])];
    for (let row = -rect.gutter; row < rect.height + rect.gutter; row += 1) {
      for (let column = -rect.gutter; column < rect.width + rect.gutter; column += 1) {
        const x = rect.x + column;
        const y = rect.y + row;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const at = (y * size + x) * 3;
        rgb[at] = colour[0];
        rgb[at + 1] = colour[1];
        rgb[at + 2] = colour[2];
        repaintedTexels += 1;
      }
    }
    repaintedFaces += 1;
    shifts.push({ buildingId: face.buildingId, beforeBytes: before, afterBytes: colour });
  }

  const atlasPng = encodeRgbPng(size, size, rgb);
  const geometry = farTierGeometry(packing);
  const atlasRelativeRef = `${cell.cellId}.roof-aggregate.atlas.png`;
  const tile = writeCanonicalGlb({
    quads: geometry.quads,
    triangles: geometry.triangles,
    materials: [{ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }],
    metadata: {
      canonicalFeatureId: cell.cellId,
      lodId: "far_0",
      ownerCellId: cell.cellId,
      tierId: "far-tier-hlod-instrumentation-roof-aggregate",
      recipeSha256: farTierRecipeHash(),
      budgetContractSha256: farTierBudgetContractHash(),
      sourceReleaseId: context.c2ReleaseId,
      sourceInventoryChecksumSha256: context.inventoryChecksumSha256,
      parentLedgerChecksumSha256: context.ledgerChecksumSha256,
      membershipChecksumSha256: cell.membershipChecksumSha256,
      memberBuildingIds: members,
      atlasPixels: size,
      appliedResolutionScale: packing.appliedScale,
      sourceDates: { capturedAt: SOURCE_CAPTURE.capturedAt, updatedAt: SOURCE_CAPTURE.updatedAt },
      rights: { note: "INSTRUMENTATION ONLY. Retention and local display; no publication, no redistribution." },
      uncertainty: "INSTRUMENTATION VARIANT, NOT A RELEASE ARTIFACT AND NOT A PROPOSED RECIPE. The v1 far-tier tile with every ROOF FACE repainted to the area-correct linear-light aggregate of the source roof region that face stands in for — roof caps, setback decks, roof-equipment boxes, water tanks and their legs. Walls are v1's, untouched.",
    },
    uriTextures: {
      images: [{ mimeType: "image/png", uri: atlasRelativeRef }],
      materialImage: [0],
      filter: { magFilter: FAR_TIER_BAKE_RECIPE.samplerMagFilter, minFilter: FAR_TIER_BAKE_RECIPE.samplerMinFilter },
    },
  });

  const outputRoot = join(workRoot, "roof-aggregate");
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, atlasRelativeRef), atlasPng);
  await writeFile(join(outputRoot, `${cell.cellId}.roof-aggregate.far_0.glb`), tile.bytes);

  const manifest = {
    label: "INSTRUMENTATION VARIANT — NOT A RELEASE ARTIFACT, NOT A PROPOSED RECIPE.",
    recordId: `${EVIDENCE_ID}:roof-aggregate-tile-variant`,
    derivation: "The v1 tile, byte-verified against the committed atlas before any edit, with every ROOF face's content and gutter repainted to that building's own area-correct roof-region aggregate. Geometry, UVs, wall texels and the packing are v1's.",
    whyTheInverseVariant: "A roof-SUBSTITUTED source variant is impossible at material-record granularity: the roof region's only palette difference from the prism's cap is material:metal on tanks and legs, and 77.03 per cent of this cell's metal is wall fire escapes carrying the same record. Repainting the record would silently repaint the fire escapes. Measured before deciding: 710.918 square metres of rooftop metal against 2,384.521 of wall metal.",
    roofRegionAreaSquareMeters: Number(roofRegionArea.toFixed(3)),
    rooftopMetalAreaSquareMeters: Number(rooftopMetal.toFixed(3)),
    wallMetalAreaSquareMeters: Number(wallMetal.toFixed(3)),
    rooftopShareOfMetal: Number((rooftopMetal / (rooftopMetal + wallMetal)).toFixed(6)),
    repaintedFaces,
    repaintedTexels,
    baseAtlasSha256: baseAtlasSha,
    variantAtlasSha256: sha256HexBytes(atlasPng),
    variantGlbSha256: sha256HexBytes(tile.bytes),
    perBuilding: shifts,
  };
  const text = serialize(manifest);
  await writeFile(join(outputRoot, "manifest.json"), text);
  console.log(serialize({ ok: true, root: outputRoot, repaintedFaces, repaintedTexels, variantAtlasSha256: manifest.variantAtlasSha256, variantGlbSha256: manifest.variantGlbSha256, manifestSha256: sha256HexSync(text) }));
}

/**
 * The BOTH-EQUALISED source: walls to facade, roof region to the prism's roof
 * colour. One assignment per material record, none overlapping.
 *
 * The metal record goes to ROOF here, which is right for the 22.97 per cent of
 * it that sits above the crown and wrong for the 77.03 per cent on walls. That
 * is the opposite misassignment to the absorbed-wall variant, which sends all
 * metal to facade. The two BRACKET the truth, and the bracket matters only
 * where walls are visible: at azimuth 235 the walls contribute essentially
 * nothing, so this variant is the trustworthy end there.
 */
async function emitBothEqualisedSource(cellId) {
  const context = await materializeCell(cellId);
  const { sources, planChecksumSha256, profile } = context;
  const outputRoot = join(workRoot, "both-equalised-sources");
  await mkdir(join(outputRoot, "assets"), { recursive: true });
  const placements = JSON.parse(await readFile(join(sourceRoot, "placements.json"), "utf8"));
  const written = [];
  let toFacade = 0;
  let toRoof = 0;
  let untouched = 0;

  for (const asset of placements.assets) {
    const plan = buildMidtownCoreV3Plan(sources.get(asset.buildingId), planChecksumSha256, profile).plan;
    const bytes = new Uint8Array(await readFile(join(sourceRoot, "assets", asset.name)));
    const { json, rest } = readGlbJson(bytes);
    if (json.materials.length !== plan.materials.length) {
      console.error(`far-tier-hue-variant: ${asset.name} declares ${json.materials.length} materials against ${plan.materials.length} on its plan; refusing to guess the mapping.`);
      process.exit(1);
    }
    const indexById = new Map(plan.materials.map((material, index) => [material.id, index]));
    const replacements = [];
    for (let index = 0; index < plan.materials.length; index += 1) {
      const material = plan.materials[index];
      let target = null;
      if (material.role === "glazing" || material.role === "trim") target = material.id.endsWith(":base") ? "material:facade:base" : "material:facade:shaft";
      else if (material.role === "metal") target = "material:roof";
      if (target === null) { untouched += 1; continue; }
      const donor = indexById.get(target);
      if (donor === undefined) { untouched += 1; continue; }
      json.materials[index] = JSON.parse(JSON.stringify(json.materials[donor]));
      replacements.push({ from: material.id, to: target });
      if (target === "material:roof") toRoof += 1; else toFacade += 1;
    }
    const variant = writeGlb(json, rest);
    await writeFile(join(outputRoot, "assets", asset.name), variant);
    written.push({ name: asset.name, buildingId: asset.buildingId, originalSha256: asset.checksumSha256, variantSha256: sha256HexBytes(variant), translation: asset.translation, replacements });
  }

  const manifest = {
    label: "INSTRUMENTATION VARIANT — NOT A RELEASE ARTIFACT, NOT A PROPOSED RECIPE.",
    recordId: `${EVIDENCE_ID}:both-equalised-source-variant`,
    derivation: "The verified shipped lod_0 bytes with glazing and trim replaced by the facade record of the same zone, and metal replaced by the roof record. Geometry, UVs, normals, transforms and the binary chunk are byte-identical to the source.",
    whatItIsolates: "The residual after BOTH palette terms are equalised: walls to the facade colour the prism bakes, roof region to the roof colour the prism bakes. What is left is geometry.",
    metalAssignment: "TO ROOF. Correct for the 22.97 per cent of metal above the crown, wrong for the 77.03 per cent on walls. The absorbed-wall variant makes the opposite error; the two bracket the truth, and at azimuth 235 — where walls contribute essentially nothing — this end is the trustworthy one.",
    materialRecordsToFacade: toFacade,
    materialRecordsToRoof: toRoof,
    materialRecordsUntouched: untouched,
    assets: written,
  };
  const text = serialize(manifest);
  await writeFile(join(outputRoot, "placements.json"), text);
  console.log(serialize({ ok: true, root: outputRoot, assets: written.length, toFacade, toRoof, untouched, manifestSha256: sha256HexSync(text) }));
}

const argv = process.argv.slice(2);
const command = argv[0] ?? "emit-absorbed-source";
const cellFlag = argv.indexOf("--cell");
const cellId = cellFlag >= 0 ? argv[cellFlag + 1] : DEFAULT_CELL_ID;
if (command === "emit-absorbed-source") await emit(cellId);
else if (command === "emit-roof-aggregate-tile") await emitRoofAggregateTile(cellId);
else if (command === "emit-both-equalised-source") await emitBothEqualisedSource(cellId);
else {
  console.error(`far-tier-hue-variant: unknown command ${command}`);
  process.exit(1);
}
