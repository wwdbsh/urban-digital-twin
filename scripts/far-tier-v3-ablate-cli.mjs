/* global console, process */
/**
 * T011 Stage 0a: emit the SOURCE-SIDE ABLATION subjects.
 *
 * THE ATTRIBUTION GATE, AND WHY IT COMES FIRST. The far tier is too bright at
 * the shadow pose and the proposed remedy is to give it the rooftop mass it
 * omits. Before designing that emission it is worth knowing the CEILING of what
 * rooftop mass can explain at all — because if deleting every rooftop object
 * from the SOURCE does not move the source most of the way toward the prism,
 * then rooftop mass is not the cause and the whole route is foreclosed.
 *
 * The ablated subject is the shipped emission path with `plan.prisms` emptied
 * and nothing else changed. Emptying the plan rather than filtering the
 * tessellation matters: the volume-identity gate reads the SAME plan on both
 * sides, so an emptied plan stays exact, while stripping prism faces out of the
 * tessellation would fail that gate hard.
 *
 * DISCLOSED INSTRUMENTATION, NOT A SHIPPABLE ARTIFACT. An ablated asset carries
 * the UN-ablated plan's `planHashSha256` in its metadata, because the hash is
 * computed over the canonical plan and this plan has been mutated. That
 * mismatch is real and is the reason these bytes must never be served. It is
 * the same standing as T010's black-conductor decomposition variants.
 *
 * Usage: node --experimental-strip-types scripts/far-tier-v3-ablate-cli.mjs emit [--cell <id>]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes } from "../src/domain/deterministic-hash.ts";
import { buildMidtownCoreV3Plan, writeMidtownCoreV3Assets } from "../src/release/midtown-core-v3-materialization.ts";
import { CAPTURE, DEFAULT_CELL_ID, materializeCell } from "./far-tier-bake-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-v3-20260818";
const workRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID);

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message) => { console.error(`far-tier-v3-ablate: ${message}`); process.exit(1); };

async function commandEmit(cellId) {
  const context = await materializeCell(cellId);
  const origin = [context.cell.bounds.west, context.cell.bounds.south];
  const outputRoot = join(workRoot, "ablation");
  await mkdir(join(outputRoot, "assets"), { recursive: true });
  await mkdir(join(outputRoot, "textures"), { recursive: true });

  // The shared class tiles the shipped assets reference by relative URI.
  const { proceduralTextureTile } = await import("../src/release/procedural-texture.ts");
  for (const tile of context.classTiles) {
    const textureClass = tile.path.slice("public/textures/".length).replace(/\.png$/u, "");
    const bytes = proceduralTextureTile(textureClass).pngBytes;
    if (sha256HexBytes(bytes) !== tile.checksumSha256) fail(`class tile ${textureClass} does not reproduce its declared checksum.`);
    await writeFile(join(outputRoot, "textures", `${textureClass}.png`), bytes);
  }

  const placements = [];
  let prismsRemoved = 0;
  let buildings = 0;
  for (const buildingId of [...context.cell.buildingIds].sort()) {
    const source = context.sources.get(buildingId);
    if (!source) continue;
    let planContext;
    try {
      planContext = buildMidtownCoreV3Plan(source, context.planChecksumSha256, context.profile);
    } catch { continue; }
    buildings += 1;
    prismsRemoved += planContext.plan.prisms.length;

    // THE ABLATION. Emptying `plan.prisms` removes every rooftop object from the
    // tessellation, from the analytic volume and from the silhouette rects at
    // once, which is what keeps the volume identity exact.
    planContext.plan.prisms = [];

    const written = writeMidtownCoreV3Assets(planContext, {
      ownerCellId: context.cell.cellId,
      capturedAt: CAPTURE.capturedAt,
      updatedAt: CAPTURE.updatedAt,
      predecessor: null,
      profile: context.profile,
    });
    const lod0 = written.assets.find((asset) => asset.lodId === "lod_0");
    if (!lod0) fail(`ablated ${buildingId} emitted no lod_0.`);
    const name = `${buildingId.replace(":", "-")}__lod_0.glb`;
    await writeFile(join(outputRoot, "assets", name), lod0.bytes);

    const east = (source.representative[0] - origin[0]) * 84_412.702;
    const north = (source.representative[1] - origin[1]) * 111_049.654;
    placements.push({ name, buildingId, checksumSha256: sha256HexBytes(lod0.bytes), translation: [east, 0, -north] });
  }
  placements.sort((left, right) => (left.name < right.name ? -1 : 1));

  await writeFile(join(outputRoot, "placements.json"), serialize({
    cellId: context.cell.cellId,
    variant: "source-ablated",
    instrumentation: "ABLATION SUBJECT, NOT A SHIPPABLE ARTIFACT. Every rooftop V3Prism has been removed from the plan before emission. The metadata still carries the UN-ablated plan's planHashSha256, because that hash is computed over the canonical plan and this one was mutated — so these bytes describe an envelope they did not come from and must never be served.",
    originLonLat: origin,
    note: "Rigid translation into the cell-local frame, stated in the GLB's own Y-up frame.",
    assets: placements,
  }));

  console.log(serialize({ ok: true, cellId, root: outputRoot, buildings, assets: placements.length, prismsRemoved }));
}

const command = process.argv[2];
const cellIndex = process.argv.indexOf("--cell");
const cellId = cellIndex > 0 ? process.argv[cellIndex + 1] : DEFAULT_CELL_ID;
if (command === "emit") await commandEmit(cellId);
else fail("usage: far-tier-v3-ablate-cli.mjs emit [--cell <cellId>]");
