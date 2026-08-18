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
import { materializeCell, DEFAULT_CELL_ID } from "./far-tier-bake-cli.mjs";
import { buildMidtownCoreV3Plan } from "../src/release/midtown-core-v3-materialization.ts";

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

const argv = process.argv.slice(2);
const command = argv[0] ?? "emit-absorbed-source";
const cellFlag = argv.indexOf("--cell");
const cellId = cellFlag >= 0 ? argv[cellFlag + 1] : DEFAULT_CELL_ID;
if (command !== "emit-absorbed-source") {
  console.error(`far-tier-hue-variant: unknown command ${command}`);
  process.exit(1);
}
await emit(cellId);
