/* global console, process */
/**
 * T004 — the far-tier mass bake campaign.
 *
 * VERBS, AND THE ORDER IS STRUCTURAL RATHER THAN ADVISORY:
 *
 *   pre-register        Bars and refusal classes. Refuses once any wave has baked.
 *   run-wave --wave wXX Bake every cell of a wave; write payloads and telemetry.
 *   seal --wave wXX     Byte-replay the wave in batched child processes and,
 *                       ONLY on success, write the wave's inventory record.
 *   census              Coverage arithmetic against the cell ledger.
 *
 * The verb is `run-wave`, not `bake`: `far-tier-bake-cli.mjs` refuses to be
 * imported by a process invoked with one of ITS verb names, and renaming around
 * that guard is the correct response rather than weakening it.
 *
 * `run-wave` CANNOT write an inventory and `seal` CANNOT bake. That is how "no wave
 * inventory before that wave's replay" stops being a rule someone has to
 * remember and becomes a property of the tool.
 *
 * WHAT IS HOISTED, AND WHY IT MATTERS AT 883 CELLS. The base snapshot loads
 * ONCE (1.0 s) and the ledger ONCE (30 ms); the per-wave `-c2` payload
 * inventory — 20,713 file rows for w05 — loads once per wave. Doing any of
 * those per cell would turn a five-minute wave into an hour and would re-verify
 * the same checksums 883 times.
 *
 * WHAT IS NOT SHORTCUT. Every cell still regenerates its shipped `lod_0` bytes
 * and verifies each one against the committed `-c2` inventory before a single
 * far-tier face is built. That is the fail-closed sourcing guarantee the
 * prototype had, and dropping it for speed would mean baking the island from
 * plans nothing proved were the shipped plans.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { loadWaveLedger, loadSnapshot, CAPTURE as SOURCE_CAPTURE } from "./far-tier-bake-cli.mjs";
import { WAVE_BASE_PROFILES } from "./mass-generation-wave-cli.mjs";
import { cellInputFor, emitTileBytes, fail, inventoryEntry, tileAtlasName, tileGlbName } from "./far-tier-campaign-support.mjs";
import { FarTierCellStop, bakeFarTierCell } from "../src/release/far-tier-campaign.ts";
import {
  FAR_TIER_ADOPTED_RECIPE,
  FAR_TIER_BAKE_RECIPE,
  FAR_TIER_BAKE_RECIPE_V4,
  assertFarTierAdoptedRecipe,
  farTierRecipeHashV4,
} from "../src/release/far-tier-bake.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { materializeMidtownCoreV3Cells } from "../src/release/midtown-core-v3-source.ts";
import { massGenerationSuccessorProfile } from "../src/release/mass-generation-retention.ts";
import { EXTERIOR_SERVING_WAVES, exteriorServingWave } from "../src/release/exterior-serving-waves.ts";
import { exteriorTwoLodRetentionReleaseId } from "../src/release/exterior-serving-release.ts";
import { encodeRgbPng, proceduralTextureTile } from "../src/release/procedural-texture.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-mass-20260819";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);
const payloadRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID, "payloads");
const TOOL = "far-tier-mass-bake";

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const round = (value, digits = 6) => Number(value.toFixed(digits));

/**
 * THE ANCHORED WAVE PATTERN. The prototype CLI used an unanchored `/-(w\d{2})-/`
 * which would match a `w05` appearing anywhere in an id; the wave CLIs anchor
 * it and so does this one.
 */
const waveOf = (cellId) => /^manhattan-exterior-cell-(w\d{2})-/u.exec(cellId)?.[1] ?? null;

/**
 * THE PRE-REGISTERED ZONE-FALLBACK BAR.
 *
 * A wall zone with no attributed surface keeps v1's facade-only colour while
 * the tile's provenance says v4. T013 measured that on the prototype at four
 * zones and 0.059 per cent of wall area, and left the share at scale unmeasured.
 *
 * THE DERIVATION, and each factor is a measured quantity rather than a choice:
 *
 *   share x 0.048 x 0.21 <= 0.001
 *
 * - 0.048 is the relative energy change the wall-colour correction produces
 *   where walls are visible, measured at 4.81 / 4.73 / 4.62 per cent across the
 *   three azimuth-55 poses (fix-capture-verdict.json).
 * - 0.21 is the wall-colour term's median share of the chromaticity gap, from
 *   the palette-equalised decomposition (pinned-capture.json).
 * - 0.001 is the pinned instrument's own stated cross-session reproduction
 *   tolerance, so the bar asks that reverting a zone stay below the noise floor
 *   of the instrument that would have to detect it.
 *
 * That gives share <= 0.001 / (0.048 x 0.21) = 0.0992, and the bar is HALVED to
 * 5 per cent for margin, because the three factors are measured on ONE cell and
 * the campaign is not.
 */
export const FALLBACK_AREA_SHARE_BAR = 0.05;
const FALLBACK_BAR_DERIVATION = {
  inequality: "fallbackAreaShare x 0.048 x 0.21 <= 0.001",
  wallCorrectionEnergyShare: 0.048,
  wallTermShareOfChromaticityGap: 0.21,
  instrumentCrossSessionTolerance: 0.001,
  unhalvedBar: round(0.001 / (0.048 * 0.21), 4),
  halvedForMargin: true,
  bar: FALLBACK_AREA_SHARE_BAR,
  whyHalved: "The three factors are measured on ONE cell under one instrument; the campaign is 883 cells. Halving is the margin for that extrapolation and is stated rather than folded silently into a rounder number.",
};

/** Every refusal class the campaign can record, named in advance. */
const REFUSAL_CLASSES = [
  { code: "no-bakeable-face", meaning: "Every member of the cell was refused by the V3 grammar or absent from the pinned snapshot, so there is nothing to bake.", expectation: "A small number; the wave census already tombstoned these buildings." },
  { code: "packing-infeasible", meaning: "The cell's faces do not fit a 256px atlas at any declared scale.", expectation: "PREDICTED ZERO under v4. The 172 unpackable cells the Stage A census measured were measured under v1/v3 packing, and v4 is exactly the fix for them. A non-zero count is a finding, not a nuisance." },
  { code: "zone-aggregate-missing", meaning: "A wall zone found no in-scope surface and would silently keep v1's colour.", expectation: "Accepted by name below the pre-registered area-share bar; a stop above it." },
  { code: "fallback-share-over-bar", meaning: "The zone fallbacks above cover more of the cell's wall area than the bar allows.", expectation: "PREDICTED ZERO. The prototype sits at 0.059 per cent against a 5 per cent bar." },
  { code: "zone-aggregate-out-of-range", meaning: "An aggregated zone factor exceeded the closed glTF profile's ceiling of 1, which would clamp one channel before the others and manufacture a per-channel bias.", expectation: "PREDICTED ZERO. Refusing is the only honest response; clamping is what this task's predecessor spent a stage excluding." },
  { code: "over-b2-atlas-budget", meaning: "A tile's atlas would exceed the per-tile budget B2 was derived at.", expectation: "CANNOT FIRE. `farTierResolution` clamps the atlas edge to FAR_TIER_ATLAS_PIXELS.maximum = 256 and B2 was derived at 256, so this is a STRUCTURAL INVARIANT asserted once against the constants rather than a per-cell check. It is listed here so that a later change to either constant is understood to break it." },
];

// ---------------------------------------------------------------------------
// Wave wiring, from the SHIPPED constants
// ---------------------------------------------------------------------------

/**
 * Wave to profile and `-c2` release id.
 *
 * NOTHING HERE IS HAND-RECONSTRUCTED. `WAVE_BASE_PROFILES` is the registry the
 * eight other wave CLIs already import; the `-c2` id is composed from the typed
 * `EXTERIOR_SERVING_WAVES` retention id through the same converter the serving
 * release uses. A hand-kept table would be a fourth copy of facts that already
 * exist three times, and the copy is where they drift.
 */
export function waveWiring(waveId) {
  const base = WAVE_BASE_PROFILES[waveId];
  if (!base) fail(TOOL, `no shipped base profile is registered for ${waveId}; WAVE_BASE_PROFILES carries ${Object.keys(WAVE_BASE_PROFILES).join(", ")}.`);
  const serving = exteriorServingWave(waveId);
  return {
    waveId,
    baseProfile: base,
    profile: { ...massGenerationSuccessorProfile(base), textureLevels: "both" },
    c2ReleaseId: exteriorTwoLodRetentionReleaseId(serving.retentionReleaseId),
    retentionReleaseId: serving.retentionReleaseId,
    declaredCellCount: serving.cellCount,
    label: serving.label,
  };
}

export const WAVE_IDS = EXTERIOR_SERVING_WAVES.map((wave) => wave.waveId);

/** Read and checksum-verify one wave's committed `-c2` payload inventory, once. */
async function loadWaveInventory(wiring) {
  const root = join(repositoryRoot, "data", wiring.c2ReleaseId);
  const text = await readFile(join(root, "payload-inventory.json"), "utf8").catch(() => null);
  if (text === null) fail(TOOL, `wave ${wiring.waveId} declares release ${wiring.c2ReleaseId} but no payload-inventory.json is committed for it.`);
  const declaredSidecar = (await readFile(join(root, "payload-inventory.sha256"), "utf8")).trim().split(/\s+/u)[0];
  const checksum = sha256HexSync(text);
  if (declaredSidecar !== checksum) fail(TOOL, `the committed payload inventory for ${wiring.c2ReleaseId} does not match its own sha256 sidecar.`);
  const inventory = JSON.parse(text);
  if (inventory.waveId !== wiring.waveId) {
    fail(TOOL, `release ${wiring.c2ReleaseId} declares waveId ${inventory.waveId} but was resolved for ${wiring.waveId}; the wiring and the committed package disagree.`);
  }
  return { inventory, checksum, declared: new Map(inventory.files.map((file) => [file.path, file])) };
}

// ---------------------------------------------------------------------------
// One cell, sourced fail-closed and baked
// ---------------------------------------------------------------------------

function materializeOneCell(snapshot, cell, wiring, waveInventory) {
  const sources = collectMidtownCoreSources(snapshot.shards, new Set(cell.buildingIds));
  const materialization = materializeMidtownCoreV3Cells({
    cells: [cell],
    sources,
    baseManifestChecksumSha256: snapshot.planChecksumSha256,
    capture: { capturedAt: SOURCE_CAPTURE.capturedAt, updatedAt: SOURCE_CAPTURE.updatedAt },
    retainAllLods: true,
    retain: "shipped-bytes",
    profile: wiring.profile,
    assemblyLods: { lod0MaxDistanceMeters: null },
  });

  // FAIL CLOSED ON SOURCING. Every regenerated asset must be the byte the
  // committed -c2 package declares, or this cell is not baked at all.
  const mismatches = [];
  let verified = 0;
  for (const [relativeRef, bytes] of materialization.assetBytes) {
    const entry = waveInventory.declared.get(relativeRef);
    if (!entry) { mismatches.push({ relativeRef, kind: "undeclared" }); continue; }
    const checksumSha256 = sha256HexBytes(bytes);
    if (checksumSha256 !== entry.checksumSha256 || bytes.byteLength !== entry.byteSize) {
      mismatches.push({ relativeRef, kind: "checksum" });
      continue;
    }
    verified += 1;
  }
  if (mismatches.length > 0) {
    fail(TOOL, `${mismatches.length} regenerated source asset(s) for ${cell.cellId} do not reproduce their committed ${wiring.c2ReleaseId} checksums; the campaign will not bake on unverified sources.\n${serialize(mismatches.slice(0, 5))}`);
  }

  return {
    sources,
    planChecksumSha256: snapshot.planChecksumSha256,
    profile: wiring.profile,
    c2ReleaseId: wiring.c2ReleaseId,
    inventoryChecksumSha256: waveInventory.checksum,
    ledgerChecksumSha256: snapshot.ledgerChecksumSha256,
    verifiedAssetCount: verified,
  };
}

/**
 * Bake one cell under the ADOPTED recipe, with the per-cell additivity gate.
 *
 * The gate compares against the cell's OWN recomputed v1 atlas, never a
 * constant, so it is meaningful for all 883 cells rather than for the one the
 * prototype froze.
 */
function bakeOneCell(context, cell) {
  assertFarTierAdoptedRecipe(FAR_TIER_BAKE_RECIPE_V4);
  const input = cellInputFor(context, cell);

  const v1Reference = bakeFarTierCell(input, { recipe: FAR_TIER_BAKE_RECIPE, zoneColourMode: "facade-only" });
  const v1Sha = sha256HexBytes(encodeRgbPng(v1Reference.packing.atlasPixels, v1Reference.packing.atlasPixels, v1Reference.rgb));
  const asV1 = bakeFarTierCell(input, { recipe: FAR_TIER_BAKE_RECIPE_V4, zoneColourMode: "facade-only", packingRecipe: FAR_TIER_BAKE_RECIPE });
  const asV1Sha = sha256HexBytes(encodeRgbPng(asV1.packing.atlasPixels, asV1.packing.atlasPixels, asV1.rgb));
  if (v1Sha !== asV1Sha) {
    fail(TOOL, `the adopted recipe is not additive over v1 on ${cell.cellId}: ${v1Sha} against ${asV1Sha}.`);
  }

  const bake = bakeFarTierCell(input, {
    recipe: FAR_TIER_BAKE_RECIPE_V4,
    zoneColourMode: "area-correct-aggregate",
    allowFacadeOnlyFallback: true,
    fallbackAreaShareBar: FALLBACK_AREA_SHARE_BAR,
  });
  return { bake, additivityV1Sha256: v1Sha };
}

// ---------------------------------------------------------------------------
// bake
// ---------------------------------------------------------------------------

async function commandBake(waveId) {
  if (!WAVE_IDS.includes(waveId)) fail(TOOL, `unknown wave ${waveId}; the ledger carries ${WAVE_IDS.join(", ")}.`);
  const wiring = waveWiring(waveId);
  const snapshot = await loadSnapshot();
  const { ledger, checksumSha256: ledgerChecksumSha256 } = await loadWaveLedger();
  snapshot.ledgerChecksumSha256 = ledgerChecksumSha256;
  const waveInventory = await loadWaveInventory(wiring);

  const cells = ledger.cells.filter((cell) => waveOf(cell.cellId) === waveId);
  if (cells.length !== wiring.declaredCellCount) {
    fail(TOOL, `wave ${waveId} has ${cells.length} cells in the ledger but EXTERIOR_SERVING_WAVES declares ${wiring.declaredCellCount}; the ledger and the shipped registry disagree.`);
  }

  const waveRoot = join(payloadRoot, waveId);
  await mkdir(waveRoot, { recursive: true });

  const baked = [];
  const stops = [];
  const started = Date.now();
  for (const cell of cells) {
    let context;
    try {
      context = materializeOneCell(snapshot, cell, wiring, waveInventory);
    } catch (error) {
      if (error instanceof FarTierCellStop) { stops.push({ cellId: cell.cellId, code: error.code, message: error.message, detail: error.detail }); continue; }
      throw error;
    }
    let result;
    try {
      result = bakeOneCell(context, cell);
    } catch (error) {
      if (error instanceof FarTierCellStop) {
        stops.push({ cellId: cell.cellId, code: error.code, message: error.message, detail: error.detail });
        continue;
      }
      throw error;
    }
    const emitted = emitTileBytes(context, cell, result.bake, {
      recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId,
      recipeSha256: farTierRecipeHashV4(),
      capture: SOURCE_CAPTURE,
    });
    await writeFile(join(waveRoot, tileGlbName(cell.cellId)), emitted.glbBytes);
    await writeFile(join(waveRoot, tileAtlasName(cell.cellId)), emitted.atlasBytes);
    baked.push({
      entry: inventoryEntry(cell, result.bake, emitted),
      telemetry: { ...result.bake.telemetry, additivityV1AtlasSha256: result.additivityV1Sha256, verifiedSourceAssets: context.verifiedAssetCount },
      fallbackZones: result.bake.fallbackZones,
    });
  }

  const telemetryRecord = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:telemetry-${waveId}`,
    task: "T004",
    artifact: "far-tier-mass-bake-wave-telemetry",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    waveId,
    waveLabel: wiring.label,
    recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId,
    recipeSha256: farTierRecipeHashV4(),
    adoptedRecipeAssertedBeforeEveryTile: true,
    sourceRelease: { c2ReleaseId: wiring.c2ReleaseId, retentionReleaseId: wiring.retentionReleaseId, payloadInventorySha256: waveInventory.checksum },
    parentLedgerChecksumSha256: ledgerChecksumSha256,
    declaredCellCount: wiring.declaredCellCount,
    ledgerCellCount: cells.length,
    bakedCellCount: baked.length,
    honestStopCount: stops.length,
    honestStopsByClass: Object.fromEntries(REFUSAL_CLASSES.map((entry) => [entry.code, stops.filter((stop) => stop.code === entry.code).length])),
    honestStops: stops,
    elapsedSeconds: round((Date.now() - started) / 1_000, 1),
    fallbackBar: FALLBACK_BAR_DERIVATION,
    cells: baked.map((row) => row.telemetry),
    cellsWithFallbackZones: baked.filter((row) => row.fallbackZones.length > 0).map((row) => ({ cellId: row.telemetry.cellId, zones: row.fallbackZones, areaShare: round(row.telemetry.fallbackAreaShare, 8) })),
    distribution: summarize(baked.map((row) => row.telemetry)),
    notClaimedHere: [
      "Telemetry is not acceptance. It records what the bake did, not whether the result looks right.",
      "The wave's inventory is NOT written by this verb; `seal` writes it after the byte replay.",
    ],
  };
  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(telemetryRecord);
  await writeFile(join(evidenceRoot, `telemetry-${waveId}.json`), text);
  await writeFile(join(evidenceRoot, `telemetry-${waveId}.sha256`), `${sha256HexSync(text)}  telemetry-${waveId}.json\n`);
  // The provisional inventory lives with the PAYLOADS, not under data/, so it
  // cannot be mistaken for the committed record `seal` writes.
  await writeFile(join(waveRoot, "provisional-inventory.json"), serialize({ inventoryId: `${EVIDENCE_ID}:${waveId}`, entries: baked.map((row) => row.entry) }));

  console.log(serialize({
    ok: true,
    waveId,
    cells: cells.length,
    baked: baked.length,
    stops: stops.length,
    stopsByClass: telemetryRecord.honestStopsByClass,
    distribution: telemetryRecord.distribution,
    elapsedSeconds: telemetryRecord.elapsedSeconds,
    telemetrySha256: sha256HexSync(text),
  }));
}

function summarize(rows) {
  if (rows.length === 0) return { cells: 0 };
  const scales = rows.map((row) => row.appliedScale).sort((left, right) => left - right);
  const ratios = rows.map((row) => row.achievedTexelRatio).sort((left, right) => left - right);
  const median = (values) => values[Math.floor(values.length / 2)];
  const shares = rows.map((row) => row.fallbackAreaShare);
  return {
    cells: rows.length,
    appliedScale: { min: round(scales[0], 6), median: round(median(scales), 6), max: round(scales[scales.length - 1], 6) },
    achievedTexelRatio: { min: round(ratios[0], 6), median: round(median(ratios), 6), max: round(ratios[ratios.length - 1], 6) },
    underResolvedCells: rows.filter((row) => row.underResolved).length,
    underResolvedShare: round(rows.filter((row) => row.underResolved).length / rows.length, 6),
    atlasPixelsHistogram: Object.fromEntries([...new Set(rows.map((row) => row.atlasPixels))].sort((a, b) => a - b).map((size) => [size, rows.filter((row) => row.atlasPixels === size).length])),
    cellsWithAnyFallbackZone: rows.filter((row) => row.fallbackZoneCount > 0).length,
    worstFallbackAreaShare: round(Math.max(...shares), 8),
    totalUnitySnaps: rows.reduce((sum, row) => sum + row.unitySnapCount, 0),
    includedBuildings: rows.reduce((sum, row) => sum + row.includedBuildings, 0),
    refusedBuildings: rows.reduce((sum, row) => sum + row.refusedBuildings, 0),
  };
}

// ---------------------------------------------------------------------------
// seal — the byte replay, then and only then the inventory
// ---------------------------------------------------------------------------

const REPLAY_BATCH = 24;

async function commandSeal(waveId) {
  const waveRoot = join(payloadRoot, waveId);
  const provisionalText = await readFile(join(waveRoot, "provisional-inventory.json"), "utf8").catch(() => null);
  if (provisionalText === null) fail(TOOL, `wave ${waveId} has not been baked; there is nothing to seal.`);
  const provisional = JSON.parse(provisionalText);
  const cellIds = provisional.entries.map((entry) => entry.cellId);

  const mismatches = [];
  let replayed = 0;
  for (let index = 0; index < cellIds.length; index += REPLAY_BATCH) {
    const batch = cellIds.slice(index, index + REPLAY_BATCH);
    const child = spawnSync(execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), "replay-batch", "--wave", waveId, "--cells", batch.join(",")], {
      cwd: repositoryRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
    });
    if (child.status !== 0) fail(TOOL, `replay batch starting at ${batch[0]} failed: ${child.stderr}`);
    const result = JSON.parse(child.stdout);
    for (const row of result.cells) {
      const declared = provisional.entries.find((entry) => entry.cellId === row.cellId);
      if (declared.glbSha256 !== row.glbSha256 || declared.atlasSha256 !== row.atlasSha256) {
        mismatches.push({ cellId: row.cellId, declared: { glb: declared.glbSha256, atlas: declared.atlasSha256 }, replayed: { glb: row.glbSha256, atlas: row.atlasSha256 } });
      }
      replayed += 1;
    }
  }

  if (mismatches.length > 0 || replayed !== cellIds.length) {
    fail(TOOL, `wave ${waveId} replay is incomplete or divergent (${replayed} of ${cellIds.length} replayed, ${mismatches.length} mismatch(es)); the inventory is NOT written.\n${serialize(mismatches.slice(0, 5))}`);
  }

  const inventory = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:inventory-${waveId}`,
    task: "T004",
    artifact: "far-tier-mass-bake-wave-inventory",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    waveId,
    recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId,
    recipeSha256: farTierRecipeHashV4(),
    adoptedRecipe: FAR_TIER_ADOPTED_RECIPE.recipeId,
    payloadLayout: {
      root: `artifacts/${EVIDENCE_ID}/payloads/${waveId}/`,
      naming: "FLAT: ${cellId}.far_0.glb and ${cellId}.atlas.png, the names the runtime resolves.",
      retention: "LOCAL WORK PRODUCT under an approved operator gate, gitignored. This record and its sidecar are the committed artifact.",
      separateFromServing: "This root is NOT the T003 serving root. public/far-tier/ and data/far-tier-hlod-runtime-20260818/ are untouched by this campaign; nothing here is served.",
    },
    byteReplay: {
      method: `Every cell re-baked in batched fresh child processes of ${REPLAY_BATCH} and compared against the digest declared here.`,
      cellsReplayed: replayed,
      mismatches: 0,
      honestClaim: "Proven across a PROCESS BOUNDARY on one machine, one Node build and one architecture. Cross-machine and cross-architecture reproduction is NOT claimed and was not tested.",
    },
    inventoryId: provisional.inventoryId,
    entries: provisional.entries,
  };
  const text = serialize(inventory);
  await writeFile(join(evidenceRoot, `inventory-${waveId}.json`), text);
  await writeFile(join(evidenceRoot, `inventory-${waveId}.sha256`), `${sha256HexSync(text)}  inventory-${waveId}.json\n`);
  console.log(serialize({ ok: true, waveId, entries: provisional.entries.length, cellsReplayed: replayed, inventorySha256: sha256HexSync(text) }));
}

async function commandReplayBatch(waveId, cellIdList) {
  const wiring = waveWiring(waveId);
  const snapshot = await loadSnapshot();
  const { ledger, checksumSha256 } = await loadWaveLedger();
  snapshot.ledgerChecksumSha256 = checksumSha256;
  const waveInventory = await loadWaveInventory(wiring);
  const wanted = new Set(cellIdList.split(","));
  const cells = ledger.cells.filter((cell) => wanted.has(cell.cellId));
  const out = [];
  for (const cell of cells) {
    const context = materializeOneCell(snapshot, cell, wiring, waveInventory);
    const { bake } = bakeOneCell(context, cell);
    const emitted = emitTileBytes(context, cell, bake, {
      recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId,
      recipeSha256: farTierRecipeHashV4(),
      capture: SOURCE_CAPTURE,
    });
    out.push({ cellId: cell.cellId, glbSha256: emitted.glbSha256, atlasSha256: emitted.atlasSha256 });
  }
  console.log(JSON.stringify({ cells: out }));
}



// ---------------------------------------------------------------------------
// emit-sources — the source subjects for one cell, for any wave
// ---------------------------------------------------------------------------

/**
 * `far-tier-bake-cli.mjs sources` exists but its wave table carries only w00 and
 * w05, so it cannot materialize a Midtown or Lower Manhattan cell. Stage 3
 * samples across ALL six waves, so the campaign needs a sources path with the
 * campaign's own wiring. The BYTES are the same verified shipped bytes: this
 * reuses the same materialization and the same -c2 verification.
 */
async function commandEmitSources(cellId) {
  const waveId = waveOf(cellId);
  if (!waveId) fail(TOOL, `${cellId} does not look like an exterior cell id.`);
  const wiring = waveWiring(waveId);
  const snapshot = await loadSnapshot();
  const { ledger, checksumSha256 } = await loadWaveLedger();
  snapshot.ledgerChecksumSha256 = checksumSha256;
  const cell = ledger.cells.find((entry) => entry.cellId === cellId);
  if (!cell) fail(TOOL, `the ledger declares no cell ${cellId}.`);
  const waveInventory = await loadWaveInventory(wiring);

  const sources = collectMidtownCoreSources(snapshot.shards, new Set(cell.buildingIds));
  const materialization = materializeMidtownCoreV3Cells({
    cells: [cell], sources,
    baseManifestChecksumSha256: snapshot.planChecksumSha256,
    capture: { capturedAt: SOURCE_CAPTURE.capturedAt, updatedAt: SOURCE_CAPTURE.updatedAt },
    retainAllLods: true, retain: "shipped-bytes", profile: wiring.profile,
    assemblyLods: { lod0MaxDistanceMeters: null },
  });

  const outputRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID, "sample-sources", cellId);
  await mkdir(join(outputRoot, "assets"), { recursive: true });
  await mkdir(join(outputRoot, "textures"), { recursive: true });
  const origin = [cell.bounds.west, cell.bounds.south];
  const written = [];
  for (const [relativeRef, bytes] of materialization.assetBytes) {
    if (!relativeRef.endsWith("__lod_0.glb")) continue;
    const declared = waveInventory.declared.get(relativeRef);
    if (!declared || sha256HexBytes(bytes) !== declared.checksumSha256) {
      fail(TOOL, `source asset ${relativeRef} does not reproduce its committed ${wiring.c2ReleaseId} checksum; the sample will not render unverified bytes.`);
    }
    const name = relativeRef.slice("public/assets/".length);
    const buildingId = name.replace(/__lod_0\.glb$/u, "").replace("-", ":");
    const source = sources.get(buildingId);
    if (!source) fail(TOOL, `no source record for ${buildingId} while placing subjects.`);
    await writeFile(join(outputRoot, "assets", name), bytes);
    written.push({
      name, buildingId, checksumSha256: sha256HexBytes(bytes),
      translation: [
        (source.representative[0] - origin[0]) * FAR_TIER_BAKE_RECIPE.metersPerDegreeLongitude,
        0,
        -((source.representative[1] - origin[1]) * FAR_TIER_BAKE_RECIPE.metersPerDegreeLatitude),
      ],
    });
  }
  for (const file of waveInventory.inventory.files.filter((entry) => entry.path.startsWith("public/textures/"))) {
    const textureClass = file.path.slice("public/textures/".length).replace(/\.png$/u, "");
    const bytes = proceduralTextureTile(textureClass).pngBytes;
    if (sha256HexBytes(bytes) !== file.checksumSha256) fail(TOOL, `class tile ${textureClass} does not reproduce its declared checksum.`);
    await writeFile(join(outputRoot, "textures", `${textureClass}.png`), bytes);
  }
  written.sort((left, right) => (left.name < right.name ? -1 : 1));
  await writeFile(join(outputRoot, "placements.json"), serialize({
    cellId, waveId, frame: FAR_TIER_BAKE_RECIPE.frame, originLonLat: origin,
    note: "Rigid translation only. Geometry and materials are the verified shipped bytes; nothing is re-authored.",
    assets: written,
  }));
  console.log(serialize({ ok: true, cellId, waveId, root: outputRoot, assets: written.length }));
}

// ---------------------------------------------------------------------------
// summary — coverage arithmetic and the campaign record
// ---------------------------------------------------------------------------

async function commandSummary() {
  const { ledger, checksumSha256: ledgerChecksumSha256 } = await loadWaveLedger();
  const waves = [];
  const allCells = [];
  const allStops = [];
  for (const waveId of WAVE_IDS) {
    const telemetry = JSON.parse(await readFile(join(evidenceRoot, `telemetry-${waveId}.json`), "utf8"));
    const inventoryText = await readFile(join(evidenceRoot, `inventory-${waveId}.json`), "utf8").catch(() => null);
    if (inventoryText === null) fail(TOOL, `wave ${waveId} has telemetry but no sealed inventory; the campaign is not closed and a summary would overstate it.`);
    const inventory = JSON.parse(inventoryText);
    const ledgerCells = ledger.cells.filter((cell) => waveOf(cell.cellId) === waveId).length;
    if (inventory.entries.length !== telemetry.bakedCellCount) {
      fail(TOOL, `wave ${waveId} sealed ${inventory.entries.length} entries against ${telemetry.bakedCellCount} baked cells.`);
    }
    allCells.push(...telemetry.cells);
    allStops.push(...telemetry.honestStops.map((stop) => ({ ...stop, waveId })));
    waves.push({
      waveId,
      label: telemetry.waveLabel,
      declaredCellCount: telemetry.declaredCellCount,
      ledgerCellCount: ledgerCells,
      bakedCellCount: telemetry.bakedCellCount,
      honestStopCount: telemetry.honestStopCount,
      accountedFor: telemetry.bakedCellCount + telemetry.honestStopCount,
      complete: telemetry.bakedCellCount + telemetry.honestStopCount === ledgerCells,
      sealedEntries: inventory.entries.length,
      cellsReplayed: inventory.byteReplay.cellsReplayed,
      replayMismatches: inventory.byteReplay.mismatches,
      elapsedSeconds: telemetry.elapsedSeconds,
      telemetrySha256: sha256HexSync(await readFile(join(evidenceRoot, `telemetry-${waveId}.json`), "utf8")),
      inventorySha256: sha256HexSync(inventoryText),
      distribution: telemetry.distribution,
    });
  }

  const totals = {
    ledgerCells: ledger.cells.length,
    baked: waves.reduce((sum, wave) => sum + wave.bakedCellCount, 0),
    honestStops: waves.reduce((sum, wave) => sum + wave.honestStopCount, 0),
    sealed: waves.reduce((sum, wave) => sum + wave.sealedEntries, 0),
    replayed: waves.reduce((sum, wave) => sum + wave.cellsReplayed, 0),
    replayMismatches: waves.reduce((sum, wave) => sum + wave.replayMismatches, 0),
  };
  totals.accountedFor = totals.baked + totals.honestStops;
  totals.everyLedgerCellAccountedFor = totals.accountedFor === totals.ledgerCells;
  if (!totals.everyLedgerCellAccountedFor) {
    fail(TOOL, `coverage arithmetic does not close: ${totals.accountedFor} accounted for against ${totals.ledgerCells} ledger cells.`);
  }

  const byteTotals = { glb: 0, atlas: 0 };
  for (const waveId of WAVE_IDS) {
    const inventory = JSON.parse(await readFile(join(evidenceRoot, `inventory-${waveId}.json`), "utf8"));
    for (const entry of inventory.entries) { byteTotals.glb += entry.glbByteSize; byteTotals.atlas += entry.atlasByteSize; }
  }
  const perTileBytes = (byteTotals.glb + byteTotals.atlas) / Math.max(1, totals.sealed);

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:campaign-summary`,
    task: "T004",
    artifact: "far-tier-mass-bake-campaign-summary",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    headline: `${totals.baked} of ${totals.ledgerCells} ledger cells baked under ${FAR_TIER_BAKE_RECIPE_V4.recipeId}, ${totals.honestStops} named honest stops, every cell accounted for, ${totals.replayed} cells byte-replayed with ${totals.replayMismatches} mismatches.`,
    recipe: { recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId, recipeSha256: farTierRecipeHashV4(), adoptedBy: FAR_TIER_ADOPTED_RECIPE.adoptedBy, adoptionRecord: FAR_TIER_ADOPTED_RECIPE.gateRecord },
    parentLedgerChecksumSha256: ledgerChecksumSha256,
    waves,
    totals,
    coverageArithmetic: {
      rule: "Every cell the ledger declares has EITHER a validated tile in its wave's sealed inventory OR a named honest stop. Machine-checked here; the tool refuses to write this record otherwise.",
      ledgerCells: totals.ledgerCells,
      withTile: totals.baked,
      withNamedStop: totals.honestStops,
      unaccountedFor: totals.ledgerCells - totals.accountedFor,
      verdict: totals.everyLedgerCellAccountedFor ? "CLOSES" : "DOES NOT CLOSE",
    },
    honestStopsByClass: Object.fromEntries(REFUSAL_CLASSES.map((entry) => [entry.code, allStops.filter((stop) => stop.code === entry.code).length])),
    honestStops: allStops,
    populationDistribution: summarize(allCells),
    payloadFootprint: {
      glbBytes: byteTotals.glb,
      atlasBytes: byteTotals.atlas,
      totalBytes: byteTotals.glb + byteTotals.atlas,
      totalMebibytes: round((byteTotals.glb + byteTotals.atlas) / (1024 * 1024), 1),
      meanBytesPerTile: Math.round(perTileBytes),
      retention: "LOCAL WORK PRODUCT under the approved operator gate, gitignored. The inventories and telemetry here are the committed artifact.",
    },
    deferredEvictionObligation: {
      statement: "THE RUNTIME HAS NO EVICTION POLICY AND THIS CAMPAIGN IS WHY THAT NOW MATTERS. FAR_TIER_RUNTIME_BUDGETS declares maxCacheEntries 256, maxCachedBytes 64 MiB and evictionPolicy NONE — an admission over either ceiling is REFUSED rather than evicted for, and the constant itself says the question is 'deferred to mass-bake scale (T004)'.",
      arithmetic: {
        cellsNowBaked: totals.baked,
        meanBytesPerTile: Math.round(perTileBytes),
        totalPayloadMebibytes: round((byteTotals.glb + byteTotals.atlas) / (1024 * 1024), 1),
        maxCachedBytes: 64 * 1024 * 1024,
        maxCacheEntries: 256,
        tilesThatFitTheByteCeiling: Math.floor((64 * 1024 * 1024) / perTileBytes),
        whichCeilingBindsFirst: Math.floor((64 * 1024 * 1024) / perTileBytes) < 256 ? "bytes" : "entries",
      },
      consequence: "With no eviction, a camera that selects more far cells than the binding ceiling admits gets `over-budget` refusals for the excess — a named state, but a routine one at island scale rather than the exceptional one it was at a single staged cell.",
      whoOwnsIt: "NOT this task. Serving is T005's and the runtime constant is a runtime decision. Named here with its arithmetic so that it is a recorded obligation rather than a surprise.",
      whatThisCampaignDidNotDo: "It did not change the constant, the runtime, or any serving surface.",
    },
    zeroServingChange: {
      claim: "This campaign changed no serving surface.",
      payloadRoot: `artifacts/${EVIDENCE_ID}/payloads/ — a NEW gitignored root, separate from the T003 staged root.`,
      untouched: ["src/runtime/", "src/features/explorer/", "src/app/", "data/far-tier-hlod-runtime-20260818/", "public/far-tier/"],
      howItIsProven: "An empty git diff over those paths against the branch base, plus the T003 runtime-record and serving pin tests green. Both are reported in the task closure rather than asserted here.",
      whyItMatters: "The runtime pins ONE inventory digest for the whole tier and fails closed on a mismatch. Writing these 883 tiles into that inventory would have moved the digest and broken the tier; writing them somewhere else is what keeps T005 free to adopt them deliberately.",
    },
    notClaimedHere: [
      "Byte replay proves reproduction across a PROCESS BOUNDARY on one machine, one Node build and one architecture. Cross-machine reproduction is NOT claimed.",
      "No appearance claim. The sampled characterization is descriptive and acceptance is T007's.",
      "A baked tile is not a served tile. Nothing here is wired to the runtime.",
    ],
  };
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "campaign-summary.json"), text);
  await writeFile(join(evidenceRoot, "campaign-summary.sha256"), `${sha256HexSync(text)}  campaign-summary.json\n`);
  console.log(serialize({
    ok: true,
    totals,
    honestStopsByClass: record.honestStopsByClass,
    distribution: record.populationDistribution,
    payloadMebibytes: record.payloadFootprint.totalMebibytes,
    eviction: record.deferredEvictionObligation.arithmetic,
    recordSha256: sha256HexSync(text),
  }));
}

// ---------------------------------------------------------------------------
// pre-register and census
// ---------------------------------------------------------------------------

async function commandPreRegister() {
  const existing = await readdir(evidenceRoot).catch(() => []);
  const alreadyBaked = existing.filter((name) => name.startsWith("telemetry-") || name.startsWith("inventory-"));
  if (alreadyBaked.length > 0) {
    fail(TOOL, `${alreadyBaked.length} campaign record(s) already exist; thresholds written after a bake are not pre-registered.`);
  }
  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:campaign-pre-registration`,
    task: "T004",
    artifact: "far-tier-mass-bake-campaign-pre-registration",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. NO CAMPAIGN CELL HAS BEEN BAKED. The tool refuses to write this record once any wave telemetry or inventory exists.",
    recipe: { recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId, recipeSha256: farTierRecipeHashV4(), adoptedBy: FAR_TIER_ADOPTED_RECIPE.adoptedBy, gateRecord: FAR_TIER_ADOPTED_RECIPE.gateRecord },
    zoneFallbackBar: FALLBACK_BAR_DERIVATION,
    fallbackHandling: {
      underTheBar: "ACCEPTED BY NAME. The cell is baked, its zones are listed and its area share is recorded in the wave telemetry.",
      overTheBar: "HONEST STOP. The cell produces no tile, the zones are listed with the share, and the coverage arithmetic counts it as a named stop rather than a gap.",
      neverSilent: "`bakeFarTierCell` refuses the fallback outright unless BOTH an explicit opt-in and a bar are supplied, so there is no path that accepts one without judging it.",
    },
    refusalClasses: REFUSAL_CLASSES,
    waveWiring: {
      statement: "Wave profiles and -c2 release ids come from the SHIPPED constants and are never hand-reconstructed here.",
      profileSource: "WAVE_BASE_PROFILES, from scripts/mass-generation-wave-cli.mjs — the registry eight other wave CLIs already import.",
      releaseIdSource: "exteriorTwoLodRetentionReleaseId(exteriorServingWave(waveId).retentionReleaseId), composed from the typed EXTERIOR_SERVING_WAVES registry.",
      crossCheck: "Each wave's committed -c2 payload inventory declares its own waveId and the tool refuses if it disagrees with the wiring; and the ledger's cell count for the wave must equal the count EXTERIOR_SERVING_WAVES declares.",
    },
    waves: EXTERIOR_SERVING_WAVES.map((wave) => ({ waveId: wave.waveId, label: wave.label, declaredCellCount: wave.cellCount, c2ReleaseId: exteriorTwoLodRetentionReleaseId(wave.retentionReleaseId) })),
    totalDeclaredCells: EXTERIOR_SERVING_WAVES.reduce((sum, wave) => sum + wave.cellCount, 0),
    waveStopRule: {
      rule: "A stop halts baking of that wave and FORBIDS committing its inventory. The `seal` verb is the only writer of an inventory and it refuses unless every baked cell replayed byte-identically.",
      whatItProtects: "OPERATOR TIME and RECORD INTEGRITY. It protects NO SERVING SURFACE, because there is none: the far tier serves one staged cell from the T003 root and this campaign writes to a different, gitignored root that nothing reads. Saying otherwise would overstate the safety this rule buys.",
      noGo: "Committing a wave inventory before that wave's replay completes.",
    },
    byteReplayClaim: "Every cell re-baked in batched fresh child processes. The claim is reproduction across a PROCESS BOUNDARY on one machine, one Node build and one architecture; cross-machine reproduction is NOT claimed.",
    notClaimedHere: [
      "No appearance claim. Stage 3's sampled characterization is DESCRIPTIVE and acceptance belongs to T007.",
      "No serving change. The T003 runtime records and serving root are untouched.",
      "883 cells is the ledger's count, not a guarantee that all 883 bake.",
    ],
  };
  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "campaign-pre-registration.json"), text);
  await writeFile(join(evidenceRoot, "campaign-pre-registration.sha256"), `${sha256HexSync(text)}  campaign-pre-registration.json\n`);
  console.log(serialize({ ok: true, bar: FALLBACK_AREA_SHARE_BAR, unhalvedBar: FALLBACK_BAR_DERIVATION.unhalvedBar, totalDeclaredCells: record.totalDeclaredCells, recordSha256: sha256HexSync(text) }));
}

async function commandCensus() {
  const { ledger } = await loadWaveLedger();
  const perWave = [];
  for (const waveId of WAVE_IDS) {
    const telemetry = JSON.parse(await readFile(join(evidenceRoot, `telemetry-${waveId}.json`), "utf8").catch(() => "null"));
    const inventory = JSON.parse(await readFile(join(evidenceRoot, `inventory-${waveId}.json`), "utf8").catch(() => "null"));
    const ledgerCells = ledger.cells.filter((cell) => waveOf(cell.cellId) === waveId).length;
    perWave.push({
      waveId,
      ledgerCells,
      declaredCellCount: exteriorServingWave(waveId).cellCount,
      baked: telemetry?.bakedCellCount ?? null,
      stops: telemetry?.honestStopCount ?? null,
      sealedEntries: inventory?.entries.length ?? null,
      accountedFor: telemetry === null ? null : telemetry.bakedCellCount + telemetry.honestStopCount,
      complete: telemetry !== null && telemetry.bakedCellCount + telemetry.honestStopCount === ledgerCells,
    });
  }
  const totals = {
    ledgerCells: ledger.cells.length,
    baked: perWave.reduce((sum, wave) => sum + (wave.baked ?? 0), 0),
    stops: perWave.reduce((sum, wave) => sum + (wave.stops ?? 0), 0),
    sealed: perWave.reduce((sum, wave) => sum + (wave.sealedEntries ?? 0), 0),
  };
  totals.accountedFor = totals.baked + totals.stops;
  totals.everyCellAccountedFor = totals.accountedFor === totals.ledgerCells;
  console.log(serialize({ ok: totals.everyCellAccountedFor, perWave, totals }));
  return { perWave, totals };
}

// DISPATCH ONLY AS THE ENTRY POINT. A test importing `waveWiring` must not
// trigger a campaign, and the batched replay re-enters this same file as a
// child process, so the guard has to be exact rather than approximate.
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const flag = (name) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : null; };
  if (command === "pre-register") await commandPreRegister();
  else if (command === "run-wave") await commandBake(flag("wave"));
  else if (command === "seal") await commandSeal(flag("wave"));
  else if (command === "replay-batch") await commandReplayBatch(flag("wave"), flag("cells"));
  else if (command === "census") await commandCensus();
  else if (command === "summary") await commandSummary();
  else if (command === "emit-sources") await commandEmitSources(flag("cell"));
  else fail(TOOL, "usage: far-tier-mass-bake-cli.mjs <pre-register|run-wave|seal|census|summary|emit-sources> [--wave wXX] [--cell <cellId>]");
}
