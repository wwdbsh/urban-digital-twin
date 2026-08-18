/* global console, process */
/**
 * T002 Stage 1: bake ONE ownership cell into a merged far-tier HLOD tile.
 *
 * The tile is the cell's buildings as sourced-footprint prisms, merged into one
 * mesh, carrying one baked facade atlas in place of the flat designed colour
 * the coarse overview tier would use.
 *
 * FAIL-CLOSED SOURCING. The `-c2` payload bytes are gitignored and absent from
 * this machine, so the source assets are REGENERATED from the pinned base
 * snapshot through the shipped emitter and every regenerated GLB's sha256 is
 * verified against the committed `-c2` payload-inventory.json. A mismatch stops
 * the run. That check is what lets the provenance record name the source GLB
 * checksums honestly: the bake is derived from the plans that produce exactly
 * the shipped bytes, and it proves it rather than asserting it.
 *
 * Usage:
 *   node --experimental-strip-types scripts/far-tier-bake-cli.mjs bake [--cell <cellId>]
 *   node --experimental-strip-types scripts/far-tier-bake-cli.mjs replay [--cell <cellId>]
 *   node --experimental-strip-types scripts/far-tier-bake-cli.mjs sources [--cell <cellId>]
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync, stableSerialize } from "../src/domain/deterministic-hash.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { materializeMidtownCoreV3Cells } from "../src/release/midtown-core-v3-source.ts";
import { V3_FROZEN_WAVE_ADMISSION_ENVELOPE, buildMidtownCoreV3Plan } from "../src/release/midtown-core-v3-materialization.ts";
import { massGenerationSuccessorProfile } from "../src/release/mass-generation-retention.ts";
import { BLOCK835_V3_GENERATED_AT, BLOCK835_V3_SEED, BLOCK835_V3_TOOL, V3T_QUALITY_BUDGETS } from "../src/release/block835-v3-package.ts";
import { DETERMINISTIC_FACADE_V3T_UNCERTAINTY } from "../src/domain/deterministic-facade-generator-v3.ts";
import { NORTHERN_MANHATTAN_WAVE_PROFILE } from "../src/release/northern-manhattan-release.ts";
import { PROCEDURAL_TEXTURE_PROFILE, PROCEDURAL_TEXTURE_SAMPLER_FILTER, encodeRgbPng, proceduralTextureTile } from "../src/release/procedural-texture.ts";
import { writeCanonicalGlb } from "../src/release/canonical-glb.ts";
import {
  FAR_TIER_BAKE_RECIPE,
  bakeFarTierAtlas,
  farTierFacesForBuilding,
  farTierGeometry,
  farTierRecipeHash,
  packFarTierAtlas,
} from "../src/release/far-tier-bake.ts";
import {
  FAR_TIER_NEAR_EDGE_METERS,
  farTierAtlasGpuBytes,
  farTierBudgetContractHash,
  farTierDeliveredQuality,
  farTierGeometryGpuBytes,
  farTierResolution,
  farTierTexelWorldSizeMeters,
} from "../src/release/far-tier-budget.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-20260818";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);
const snapshotRoot = join(repositoryRoot, "public/data/manhattan-citywide-20260804");
const ledgerRoot = join(repositoryRoot, "data/normalized/manhattan-exterior-wave-ledger-20260804");
const workRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID);

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message) => { console.error(`far-tier-bake: ${message}`); process.exit(1); };

/**
 * The prototype cell.
 *
 * NOT cherry-picked: `data/citywide-overview-census-20260814/coarse-tier.json`
 * already designated this cell the island's MEDIAN cell by building count, in a
 * record committed long before this task existed, and the frozen plan asked for
 * a cell of roughly fifty buildings. Taking a cell someone else selected for an
 * unrelated purpose is the cheapest available defence against choosing a cell
 * that happens to bake well.
 */
export const DEFAULT_CELL_ID = "manhattan-exterior-cell-w05-000747-17-38610-35822";

/** Real capture chronology of the pinned base snapshot; the wave CLI's own constant. */
export const CAPTURE = { capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" };

/**
 * Wave identity. Every field here moves GLB bytes, so these are the shipped
 * constants rather than reconstructions of them.
 *
 * `textureLevels: "both"` is the `-c2` re-emission profile: `-c2` copies lod_0
 * from `-c1` byte for byte and re-emits lod_1 with the class tile bound. The
 * releaseId deliberately keeps the `-c1` suffix, because the GLBs inside `-c2`
 * embed the `-c1` identity in `inventoryId` and `evidenceShardId`.
 */
const WAVE_BASE_PROFILES = {
  w00: {
    releaseId: "manhattan-exterior-cells-20260811-v3",
    generatedAt: BLOCK835_V3_GENERATED_AT,
    seed: BLOCK835_V3_SEED,
    tool: { ...BLOCK835_V3_TOOL },
    uncertainty: DETERMINISTIC_FACADE_V3T_UNCERTAINTY,
    budgets: { ...V3T_QUALITY_BUDGETS },
    texture: PROCEDURAL_TEXTURE_PROFILE,
    textureFilter: { ...PROCEDURAL_TEXTURE_SAMPLER_FILTER },
    admissionEnvelope: V3_FROZEN_WAVE_ADMISSION_ENVELOPE,
  },
  w05: NORTHERN_MANHATTAN_WAVE_PROFILE,
};

const C2_RELEASE_ID = {
  w00: "manhattan-exterior-cells-20260811-v3-c2",
  w05: "manhattan-northern-manhattan-cells-20260812-c2",
};

const waveOf = (cellId) => /-(w\d{2})-/u.exec(cellId)?.[1] ?? null;

async function loadSnapshot() {
  const manifestText = await readFile(join(snapshotRoot, "manifest.json"), "utf8").catch(() => null);
  if (manifestText === null) fail(`base snapshot is absent at ${snapshotRoot}; the bake reads real rings and cannot invent them.`);
  const manifest = JSON.parse(manifestText);
  const manifestFileChecksumSha256 = sha256HexSync(manifestText);
  const sidecar = (await readFile(join(snapshotRoot, "manifest.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (sidecar !== manifestFileChecksumSha256) fail("base snapshot manifest does not match its own sha256 sidecar.");

  // The retention pipeline hashes a COMPACT re-serialization, not the file
  // bytes. Passing the file checksum here would silently move every plan hash.
  const planChecksumSha256 = manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest));

  const shards = [];
  for (const shard of manifest.geometryShards.filter((entry) => entry.layer === "buildings")) {
    const text = await readFile(join(snapshotRoot, shard.relativeContentRef), "utf8");
    if (sha256HexSync(text) !== shard.checksumSha256) fail(`geometry shard ${shard.shardId} does not match its declared checksum.`);
    shards.push(JSON.parse(text));
  }
  return { manifest, manifestFileChecksumSha256, planChecksumSha256, shards };
}

async function loadLedger(cellId) {
  const text = await readFile(join(ledgerRoot, "ledger.json"), "utf8");
  const checksumSha256 = sha256HexSync(text);
  const sidecar = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (sidecar !== checksumSha256) fail("wave ledger does not match its own sha256 sidecar.");
  const ledger = JSON.parse(text);
  const cell = ledger.cells.find((entry) => entry.cellId === cellId);
  if (!cell) fail(`ledger declares no cell ${cellId}.`);
  return { ledger, checksumSha256, cell };
}

/**
 * Regenerate the cell's shipped assets and verify every one against the
 * committed `-c2` inventory. Returns the plans, which are the bake's real input.
 */
export async function materializeCell(cellId) {
  const waveId = waveOf(cellId);
  const base = WAVE_BASE_PROFILES[waveId];
  if (!base) fail(`no wave profile registered for ${waveId}; this prototype supports ${Object.keys(WAVE_BASE_PROFILES).join(", ")}.`);

  const { manifest, manifestFileChecksumSha256, planChecksumSha256, shards } = await loadSnapshot();
  const { ledger, checksumSha256: ledgerChecksumSha256, cell } = await loadLedger(cellId);
  const sources = collectMidtownCoreSources(shards, new Set(cell.buildingIds));

  const profile = { ...massGenerationSuccessorProfile(base), textureLevels: "both" };
  const materialization = materializeMidtownCoreV3Cells({
    cells: [cell],
    sources,
    baseManifestChecksumSha256: planChecksumSha256,
    capture: { capturedAt: CAPTURE.capturedAt, updatedAt: CAPTURE.updatedAt },
    retainAllLods: true,
    retain: "shipped-bytes",
    profile,
    assemblyLods: { lod0MaxDistanceMeters: null },
  });

  const c2ReleaseId = C2_RELEASE_ID[waveId];
  const inventoryText = await readFile(join(repositoryRoot, "data", c2ReleaseId, "payload-inventory.json"), "utf8");
  const inventory = JSON.parse(inventoryText);
  const declared = new Map(inventory.files.map((file) => [file.path, file]));

  const sourceAssets = [];
  const mismatches = [];
  for (const [relativeRef, bytes] of materialization.assetBytes) {
    const entry = declared.get(relativeRef);
    if (!entry) { mismatches.push({ relativeRef, kind: "undeclared" }); continue; }
    const checksumSha256 = sha256HexBytes(bytes);
    if (checksumSha256 !== entry.checksumSha256 || bytes.byteLength !== entry.byteSize) {
      mismatches.push({ relativeRef, kind: "checksum", declared: entry.checksumSha256, regenerated: checksumSha256 });
      continue;
    }
    sourceAssets.push({ relativeRef, byteSize: entry.byteSize, checksumSha256 });
  }
  if (mismatches.length > 0) {
    fail(`${mismatches.length} regenerated source asset(s) do not reproduce their committed -c2 checksums; the bake will not proceed on unverified sources.\n${serialize(mismatches.slice(0, 5))}`);
  }
  sourceAssets.sort((left, right) => (left.relativeRef < right.relativeRef ? -1 : 1));

  const classTiles = inventory.files
    .filter((file) => file.path.startsWith("public/textures/"))
    .map((file) => ({ path: file.path, byteSize: file.byteSize, checksumSha256: file.checksumSha256 }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));

  return {
    waveId, cell, ledger, ledgerChecksumSha256, manifest, manifestFileChecksumSha256, planChecksumSha256,
    materialization, sourceAssets, classTiles, c2ReleaseId, inventory, sources, profile,
    inventoryChecksumSha256: sha256HexSync(inventoryText),
    profileReleaseId: profile.releaseId,
  };
}

/**
 * The deterministic body of the bake.
 *
 * Plans are rebuilt here through the exported `buildMidtownCoreV3Plan` with the
 * same arguments `materializeMidtownCoreV3Cells` passes internally, because the
 * materialization exposes shipped bytes rather than plan objects. The two are
 * the same computation on the same inputs, and `materializeCell` has already
 * proved that computation reproduces the committed `-c2` checksums.
 */
export function bakeCell(context) {
  const { cell, sources, planChecksumSha256, profile } = context;

  // Cell-local frame anchored at the cell's south-west corner.
  const origin = [cell.bounds.west, cell.bounds.south];

  // Building order is the ledger's, sorted; never a map's iteration order.
  const faces = [];
  const members = [];
  for (const buildingId of [...cell.buildingIds].sort()) {
    const source = sources.get(buildingId);
    if (!source) { members.push({ buildingId, included: false, reason: "no source record in the pinned base snapshot" }); continue; }
    let plan;
    try {
      plan = buildMidtownCoreV3Plan(source, planChecksumSha256, profile).plan;
    } catch (error) {
      // A grammar refusal is a stated outcome, not a bake failure: the wave
      // census already tombstoned these buildings and they ship no asset at any
      // level. Recording the stop code keeps the far tier's member list
      // reconcilable against that census.
      members.push({ buildingId, included: false, reason: `refused by the V3 grammar: ${error?.code ?? error?.message ?? "unknown stop"}` });
      continue;
    }
    const offsetMeters = [
      (source.representative[0] - origin[0]) * FAR_TIER_BAKE_RECIPE.metersPerDegreeLongitude,
      (source.representative[1] - origin[1]) * FAR_TIER_BAKE_RECIPE.metersPerDegreeLatitude,
    ];
    const built = farTierFacesForBuilding(plan, offsetMeters);
    faces.push(...built);
    members.push({ buildingId, included: true, styleClass: plan.styleClass, faceCount: built.length, planHashSha256: plan.planHashSha256 });
  }
  if (faces.length === 0) fail("the cell produced no bakeable face.");

  const surfaceArea = faces.reduce((sum, face) => sum + face.areaSquareMeters, 0);
  const resolution = farTierResolution(surfaceArea);
  const packing = packFarTierAtlas(faces, resolution.atlasPixels, farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS));
  const rgb = bakeFarTierAtlas(packing);
  const atlasPng = encodeRgbPng(packing.atlasPixels, packing.atlasPixels, rgb);
  const geometry = farTierGeometry(packing);
  const delivered = farTierDeliveredQuality(packing.texelWorldSizeMeters);

  return { faces, members, surfaceArea, resolution, delivered, packing, atlasPng, geometry };
}

function writeTile(context, baked, atlasRelativeRef) {
  const { cell } = context;
  return writeCanonicalGlb({
    quads: baked.geometry.quads,
    triangles: baked.geometry.triangles,
    materials: [{ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }],
    metadata: {
      canonicalFeatureId: cell.cellId,
      lodId: "far_0",
      ownerCellId: cell.cellId,
      tierId: FAR_TIER_BAKE_RECIPE.recipeId,
      recipeSha256: farTierRecipeHash(),
      budgetContractSha256: farTierBudgetContractHash(),
      sourceReleaseId: context.c2ReleaseId,
      sourceInventoryChecksumSha256: context.inventoryChecksumSha256,
      parentLedgerChecksumSha256: context.ledgerChecksumSha256,
      membershipChecksumSha256: cell.membershipChecksumSha256,
      memberBuildingIds: baked.members.filter((member) => member.included).map((member) => member.buildingId),
      atlasPixels: baked.packing.atlasPixels,
      appliedResolutionScale: baked.packing.appliedScale,
      sourceDates: { capturedAt: CAPTURE.capturedAt, updatedAt: CAPTURE.updatedAt },
      rights: FAR_TIER_RIGHTS,
      uncertainty: FAR_TIER_UNCERTAINTY,
    },
    uriTextures: {
      images: [{ mimeType: "image/png", uri: atlasRelativeRef }],
      materialImage: [0],
      filter: { magFilter: FAR_TIER_BAKE_RECIPE.samplerMagFilter, minFilter: FAR_TIER_BAKE_RECIPE.samplerMinFilter },
    },
  });
}

const FAR_TIER_UNCERTAINTY =
  "Far-tier HLOD massing. The sourced footprint extruded to the sourced height, carrying a facade appearance baked from the generated procedural tiles. Setback steps, tier insets, rooftop groups, window openings, glazing and trim are ABSENT BY CONSTRUCTION and are filled in solid or absorbed into the facade material. No lighting, ambient occlusion or shadowing is baked in. This asserts nothing about the material, colour, age, condition or cladding of any real building, and its silhouette is a coarser claim than ADR 0050's 2% standard covers.";

const FAR_TIER_RIGHTS = {
  derivation: "Derivative of the generated procedural facade tiles and the sourced OTI building footprints and heights.",
  envelope: "The NARROWER of the inherited envelopes travels with this artifact. Retention and local display only. No publication, no redistribution, no public conveyance.",
  attribution: "Source: NYC Office of Technology and Innovation GIS, Building Footprints; accessed through NYC Open Data.",
  note: "Baking does not widen an approval envelope. A derivative of a retention-only artifact is retention-only.",
};

async function commandBake(cellId, { quiet = false } = {}) {
  const context = await materializeCell(cellId);
  const baked = bakeCell(context);
  const atlasRelativeRef = `${cellId}.atlas.png`;
  const tile = writeTile(context, baked, atlasRelativeRef);

  const glbSha256 = sha256HexBytes(tile.bytes);
  const atlasSha256 = sha256HexBytes(baked.atlasPng);

  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, `${cellId}.far_0.glb`), tile.bytes);
  await writeFile(join(workRoot, atlasRelativeRef), baked.atlasPng);

  if (!quiet) {
    console.log(serialize({
      ok: true, cellId,
      glbSha256, glbByteSize: tile.bytes.byteLength,
      atlasSha256, atlasByteSize: baked.atlasPng.byteLength,
      atlasPixels: baked.packing.atlasPixels, appliedScale: baked.packing.appliedScale,
      triangles: tile.counts.triangleCount,
    }));
  }
  return { context, baked, tile, glbSha256, atlasSha256, atlasRelativeRef };
}

async function commandReplay(cellId) {
  // Two independent full runs compared by digest. The SECOND runs in a FRESH
  // CHILD PROCESS, which is the whole point: this module memoizes the tile
  // integrator and the texture catalogue, so a same-process repeat would
  // exercise those caches rather than the computation and could not catch a
  // cache that leaked state between runs.
  const first = await commandBake(cellId, { quiet: true });
  const child = spawnSync(execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), "bake", "--cell", cellId], {
    cwd: repositoryRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  if (child.status !== 0) fail(`the child-process replay run failed: ${child.stderr?.slice(0, 2_000) ?? "no stderr"}`);
  const second = JSON.parse(child.stdout);
  const identical = first.glbSha256 === second.glbSha256 && first.atlasSha256 === second.atlasSha256;

  const { context, baked, tile } = first;
  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:prototype-provenance`,
    task: "T002",
    artifact: "far-tier-hlod-prototype-tile-provenance",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. The bake is a total function of committed inputs; a timestamp would be the only non-reproducible field in a record whose entire claim is reproducibility.",
    claim: "One ownership cell baked into one merged far-tier HLOD tile, with every source it derives from named by checksum and its byte-replay proved by two independent runs.",

    tile: {
      cellId: context.cell.cellId,
      lodId: "far_0",
      glbSha256: first.glbSha256,
      glbByteSize: tile.bytes.byteLength,
      atlasRelativeRef: first.atlasRelativeRef,
      atlasSha256: first.atlasSha256,
      atlasByteSize: baked.atlasPng.byteLength,
      atlasPixels: baked.packing.atlasPixels,
      triangleCount: tile.counts.triangleCount,
      materialCount: tile.counts.materialCount,
      textureCount: tile.counts.textureCount,
      retention: "LOCAL WORK PRODUCT. The bytes live under artifacts/ and are gitignored; this record and its checksums are the committed artifact.",
    },

    byteReplay: {
      runs: 2,
      method: "Two independent full bakes from the committed inputs, each re-reading the base snapshot and the ledger, compared by sha256. The SECOND runs in a FRESH CHILD PROCESS, so the module-level tile-integrator and texture-catalogue caches are cold for it and cannot mask a leak.",
      run1: { glbSha256: first.glbSha256, atlasSha256: first.atlasSha256, process: "parent" },
      run2: { glbSha256: second.glbSha256, atlasSha256: second.atlasSha256, process: "child" },
      byteIdentical: identical,
      verdict: identical ? "PASS" : "FAIL",
    },

    provenance: {
      sourceRelease: {
        releaseId: context.c2ReleaseId,
        payloadInventoryChecksumSha256: context.inventoryChecksumSha256,
        note: "The -c2 payload bytes are gitignored and absent from this machine. Every source asset below was REGENERATED through the shipped emitter and verified against this inventory before the bake ran; a mismatch stops the run.",
      },
      baseRelease: {
        releaseId: context.manifest.releaseId,
        manifestFileChecksumSha256: context.manifestFileChecksumSha256,
        planChecksumSha256: context.planChecksumSha256,
        planChecksumNote: "The retention pipeline hashes a compact re-serialization of the manifest, not the file bytes, and that value enters every plan hash. Both are recorded so neither can be mistaken for the other.",
      },
      parentLedger: { ledgerId: context.ledger.ledgerId, checksumSha256: context.ledgerChecksumSha256 },
      cell: {
        cellId: context.cell.cellId,
        order: context.cell.order,
        membershipChecksumSha256: context.cell.membershipChecksumSha256,
        declaredBuildingCount: context.cell.buildingIds.length,
        bakedBuildingCount: baked.members.filter((member) => member.included).length,
      },
      sourceAssets: context.sourceAssets,
      sourceAssetVerification: {
        method: "Regenerate through writeMidtownCoreV3Assets under the shipped wave profile, then compare sha256 and byte length against the committed -c2 payload-inventory.json.",
        compared: context.sourceAssets.length,
        byteIdentical: context.sourceAssets.length,
        verdict: "PASS",
        why: "This is what lets the record name source checksums it never read from disk. The bake derives from the same plans that produce exactly these bytes, and proves it rather than asserting it.",
      },
      classTiles: context.classTiles,
      recipeSha256: farTierRecipeHash(),
      budgetContractSha256: farTierBudgetContractHash(),
      emissionProfileReleaseId: context.profileReleaseId,
      emissionProfileNote: "The -c1 suffix is correct and deliberate: the GLBs inside -c2 embed the -c1 identity in inventoryId and evidenceShardId, because -c2 copies lod_0 byte for byte.",
    },

    bakeOutcome: {
      surfaceAreaSquareMeters: Number.parseFloat(baked.surfaceArea.toFixed(1)),
      faceCount: baked.faces.length,
      flatFaceCount: baked.packing.flatFaceCount,
      flatFaceShare: Number.parseFloat((baked.packing.flatFaceCount / baked.faces.length).toFixed(6)),
      atlasOccupancy: Number.parseFloat(baked.packing.occupancy.toFixed(6)),
      appliedResolutionScale: baked.packing.appliedScale,
      appliedTexelWorldSizeMeters: Number.parseFloat(baked.packing.texelWorldSizeMeters.toFixed(6)),
      targetTexelWorldSizeMeters: Number.parseFloat(farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS).toFixed(6)),
      // DELIVERED, not ideal. `farTierResolution` assumes a 100%-full atlas;
      // the packer had to shrink the global texel size to fit, and reporting
      // the ideal ratio beside an appliedScale of 0.5 stated a sharpness this
      // tile does not have. B6 requires under-resolved leaves to be REPORTED,
      // so these come from `packing.texelWorldSizeMeters`.
      idealTexelRatio: Number.parseFloat(baked.resolution.achievedRatio.toFixed(6)),
      idealTexelRatioNote: "What a 100%-full atlas would have achieved. Not delivered; kept only so the packing penalty is visible as the difference.",
      achievedTexelRatio: Number.parseFloat(baked.delivered.achievedRatio.toFixed(6)),
      underResolved: baked.delivered.underResolved,
      criticalDistanceMeters: Math.round(baked.delivered.criticalDistanceMeters),
      atlasGpuBytes: farTierAtlasGpuBytes(baked.packing.atlasPixels),
      geometryGpuBytes: farTierGeometryGpuBytes(baked.geometry.quads.length, baked.geometry.triangles.length),
      members: baked.members,
    },

    rights: FAR_TIER_RIGHTS,
    uncertainty: FAR_TIER_UNCERTAINTY,

    notClaimedHere: [
      "Byte replay is not appearance agreement. It says the bake is a function; it says nothing about whether the tile looks right.",
      "This is one cell. Nothing here generalizes to the island without the mass bake measuring it.",
      "The prism's silhouette error is not measured by this record and is not covered by ADR 0050's 2% cap.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "prototype-provenance.json"), text);
  await writeFile(join(evidenceRoot, "prototype-provenance.sha256"), `${sha256HexSync(text)}  prototype-provenance.json\n`);
  console.log(serialize({ ok: identical, verdict: record.byteReplay.verdict, glbSha256: first.glbSha256, atlasSha256: first.atlasSha256, recordChecksum: sha256HexSync(text) }));
  if (!identical) process.exit(1);
}

/**
 * Write the verified source assets and their class tiles to the work root, so
 * the Blender instrument renders CHECKSUM-VERIFIED bytes rather than a
 * convenient re-emission.
 */
async function commandSources(cellId) {
  const context = await materializeCell(cellId);
  const outputRoot = join(workRoot, "sources");
  await mkdir(join(outputRoot, "assets"), { recursive: true });
  await mkdir(join(outputRoot, "textures"), { recursive: true });
  // Placement into the SAME cell-local frame the baked tile uses. The shipped
  // assets are anchored at their own representative point, so the instrument
  // applies a rigid translation and nothing else — exactly what the runtime
  // does. No geometry and no material is re-authored, so what Blender renders
  // is the verified shipped bytes.
  const origin = [context.cell.bounds.west, context.cell.bounds.south];
  const written = [];
  for (const [relativeRef, bytes] of context.materialization.assetBytes) {
    if (!relativeRef.endsWith("__lod_0.glb")) continue;
    const name = relativeRef.slice("public/assets/".length);
    const buildingId = name.replace(/__lod_0\.glb$/u, "").replace("-", ":");
    const source = context.sources.get(buildingId);
    if (!source) fail(`no source record for ${buildingId} while placing the instrument's subjects.`);
    const east = (source.representative[0] - origin[0]) * FAR_TIER_BAKE_RECIPE.metersPerDegreeLongitude;
    const north = (source.representative[1] - origin[1]) * FAR_TIER_BAKE_RECIPE.metersPerDegreeLatitude;
    await writeFile(join(outputRoot, "assets", name), bytes);
    // Y-up file frame: (east, up, -north).
    written.push({ name, buildingId, checksumSha256: sha256HexBytes(bytes), translation: [east, 0, -north] });
  }
  for (const tile of context.classTiles) {
    const textureClass = tile.path.slice("public/textures/".length).replace(/\.png$/u, "");
    const bytes = proceduralTextureTile(textureClass).pngBytes;
    const checksumSha256 = sha256HexBytes(bytes);
    if (checksumSha256 !== tile.checksumSha256) fail(`class tile ${textureClass} does not reproduce its declared checksum.`);
    await writeFile(join(outputRoot, "textures", `${textureClass}.png`), bytes);
  }
  written.sort((left, right) => (left.name < right.name ? -1 : 1));
  await writeFile(join(outputRoot, "placements.json"), serialize({
    cellId: context.cell.cellId,
    frame: FAR_TIER_BAKE_RECIPE.frame,
    originLonLat: origin,
    note: "Rigid translation only. Geometry and materials are the verified shipped bytes; nothing is re-authored.",
    assets: written,
  }));
  console.log(serialize({ ok: true, root: outputRoot, assets: written.length, stableDigest: sha256HexSync(stableSerialize(written)) }));
}

// Dispatch only when this file is the entry point. Another module importing
// `materializeCell` or `bakeCell` must not trigger a command as a side effect
// of the import — which it did, until a decomposition tool tried it.
//
// The comparison resolves BOTH sides through `realpathSync`. Comparing URLs
// directly is fail-open: this worktree reaches its inputs through symlinks, and
// any symlink or normalization difference between `import.meta.url` and argv[1]
// makes the guard false, at which point `replay` exits 0 having verified
// nothing. A byte-replay that silently does not run is worse than one that
// crashes.
function isDirectEntryPoint() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

/** This CLI's own verbs. Another tool's verb is not this CLI's business. */
const COMMANDS = new Set(["bake", "replay", "sources"]);

if (isDirectEntryPoint()) {
  const command = process.argv[2];
  const cellIndex = process.argv.indexOf("--cell");
  const cellId = cellIndex > 0 ? process.argv[cellIndex + 1] : DEFAULT_CELL_ID;

  if (command === "bake") await commandBake(cellId);
  else if (command === "replay") await commandReplay(cellId);
  else if (command === "sources") await commandSources(cellId);
  else fail("usage: far-tier-bake-cli.mjs <bake|replay|sources> [--cell <cellId>]");
} else if (COMMANDS.has(process.argv[2] ?? "")) {
  // ONE OF THIS CLI'S OWN VERBS was supplied, yet the guard says this file is
  // not the entry point. That is the fail-open case the realpath comparison
  // exists to catch, and exiting quietly here would reproduce it — a `replay`
  // that verifies nothing and reports success. Another tool's verb (`emit`,
  // `predict`, `census`) is not this CLI's business and passes through.
  fail(`the command "${process.argv[2]}" is one of this CLI's own verbs, but this module was not resolved as the entry point (argv[1]=${process.argv[1]}); refusing to exit silently without running it.`);
}
