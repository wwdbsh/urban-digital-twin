#!/usr/bin/env node
/* global console, process, TextDecoder */
/**
 * The phantom-shaft-zone fix, and the record that judges it.
 *
 * THE DEFECT. `farTierFacesForPlan` resolved a face's SHAFT zone before it knew
 * whether the face emits one. When `split === 1` the base reaches the top of the
 * face, the face carries no shaft zone, and the v3 aggregation produced no
 * `<index>:shaft` key for it BY CONSTRUCTION — so that unconditional call
 * recorded a facade-only fallback against a zone that does not exist. Because
 * `bakeFarTierCell` keys its fallback AREA by FACE and not by zone
 * (far-tier-campaign.ts:205), one phantom entry condemned the face's entire wall
 * area. Forty-three cells were pushed over the 5 per cent bar by area they never
 * actually lost, and seven of those were reported at a share of exactly 1.000.
 *
 * Verbs:
 *   pre-register  Write the zero-bake prediction record. Refuses to overwrite.
 *   measure       Bake the 43 formerly-stopped cells and write the measured
 *                 table. Reads the pre-registration and refuses without it.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { spawnSync } from "node:child_process";
import { execPath } from "node:process";

import { CAPTURE as SOURCE_CAPTURE, loadSnapshot, loadWaveLedger } from "./far-tier-bake-cli.mjs";
import { emitTileBytes, inventoryEntry, tileAtlasName, tileGlbName } from "./far-tier-campaign-support.mjs";
import { FALLBACK_AREA_SHARE_BAR, WAVE_IDS, bakeOneCell, loadWaveInventory, materializeOneCell, waveWiring } from "./far-tier-mass-bake-cli.mjs";
import { FAR_TIER_BAKE_RECIPE_V4, farTierRecipeHashV4 } from "../src/release/far-tier-bake.ts";
import { FarTierCellStop } from "../src/release/far-tier-campaign.ts";

const TOOL = "far-tier-phantom-shaft-cli";
const EVIDENCE_ID = "far-tier-hlod-phantom-shaft-20260823";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);

const fail = (message) => {
  console.error(`${TOOL}: ${message}`);
  process.exit(1);
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** The source records this fix is judged against, pinned by digest. */
export const BOUND_TO = {
  campaignSummary: {
    path: "data/far-tier-hlod-mass-20260819/campaign-summary.json",
    sha256: "a2caba098461f5d2cb7bf5bbf57f87e398ec6842c4828620369f7158126e841c",
  },
  promotedInventory: {
    path: "data/far-tier-hlod-promotion-20260819/promoted-inventory.json",
    sha256: "cf8e26480eecc91f2e7b473d217a0d3551d0be59b4d8da39ee1217a6e0538f0a",
    alsoKnownAs: "FAR_TIER_PAYLOAD_INVENTORY_SHA256, src/runtime/far-tier-serving.ts:170",
  },
  sweepExemptions: {
    path: "data/far-tier-hlod-promotion-20260819/sweep-exemptions.json",
    sha256: "6354676da304ab03783132730f75dafdfce60c82f509dd740b9fc18c92e8d430",
  },
  goalAcceptanceRecord: {
    path: "data/manhattan-hlod-far-tier-acceptance-20260822/reconciliation.json",
    sha256: "4f4f733a863d9731b156f46d46fd06413b8b06773333b3f2a2ffa995596a79ec",
  },
  waveInventories: {
    w00: "d1913d5ee056a5979a4bb3cc883da48b5266531ca50c9d7bcc45ef0bff2871d5",
    w01: "74c43db6886ab4a1be3c919407504d3d65c3c8c55cb8c3b95974b4ebc8dba343",
    w02: "820758f54c03da5371badae7af300573dbc1a2b9d57a2cd0229ab87c0d54585b",
    w03: "f9def8238da94feebfe2d52fb4257bad9f39ecdb5206b083e8923cbcfda39ee1",
    w04: "5807052121739bcbb38a7943464e13b7f29f684bba10299f45c9094daf09754a",
    w05: "e46e5bf57cda33ef7e5041674a7be90e3bf99645920e06ec11c31994127bad15",
  },
};

/** Read the 43 stopped cells from the frozen campaign summary, never by hand. */
export async function loadStoppedCells() {
  const path = join(repositoryRoot, BOUND_TO.campaignSummary.path);
  const text = await readFile(path, "utf8");
  const digest = sha256(text);
  if (digest !== BOUND_TO.campaignSummary.sha256) {
    fail(`${BOUND_TO.campaignSummary.path} is ${digest}, not the pinned ${BOUND_TO.campaignSummary.sha256}; this fix is bound to the frozen campaign and will not read a moved one.`);
  }
  const summary = JSON.parse(text);
  const stops = summary.honestStops;
  if (stops.length !== 43) fail(`the pinned campaign declares ${stops.length} honest stops, not 43.`);
  const codes = [...new Set(stops.map((stop) => stop.code))];
  if (codes.length !== 1 || codes[0] !== "fallback-share-over-bar") {
    fail(`the 43 stops carry codes ${codes.join(", ")}; this fix addresses fallback-share-over-bar only and will not silently absorb another class.`);
  }
  return stops.map((stop) => ({
    cellId: stop.cellId,
    shortId: /-(w\d{2}-\d+)-/u.exec(stop.cellId)?.[1] ?? stop.cellId,
    waveId: stop.waveId,
    priorShare: stop.detail.fallbackAreaShare,
    priorZoneCount: stop.detail.zones.length,
  }));
}

// ---------------------------------------------------------------------------
// pre-register
// ---------------------------------------------------------------------------

async function commandPreRegister() {
  const path = join(evidenceRoot, "pre-registration.json");
  if (existsSync(path)) {
    fail(`${path} already exists. A pre-registration that can be rewritten after a measurement is not a pre-registration. Delete it deliberately, in a commit, if it must change.`);
  }
  const stopped = await loadStoppedCells();

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:pre-registration`,
    task: "post-goal ad hoc: phantom shaft-zone fallback",
    artifact: "far-tier-phantom-shaft-pre-registration",
    capturedAt: null,
    capturedAtStatement:
      "NULL BY CONSTRUCTION. NO CELL HAS BEEN BAKED UNDER THE FIX AT THE TIME THIS RECORD IS WRITTEN. The tool refuses to overwrite this file, so a later measurement cannot move a prediction.",

    defect: {
      site: "src/release/far-tier-bake.ts, `farTierFacesForPlan`, the unconditional `resolveZone(shaftId, \"shaft\")` that preceded the zone list.",
      mechanism: [
        "`split = baseVMaxMm / heightMm`. When `split === 1` the base zone reaches the top of the face and the face emits NO shaft zone.",
        "The v3 aggregation keys zones `<edgeIndex>:base` / `<edgeIndex>:shaft` by comparing each tessellated surface centroid against that edge's base/shaft boundary (far-tier-bake.ts:775-776). When the boundary is the top of the face, every in-scope surface lands in `base` and NO `<index>:shaft` key is ever created.",
        "Resolving the shaft anyway therefore missed, pushed a `facadeOnlyFallbackReport` entry, and (because the campaign opts in with `allowFacadeOnlyFallback: true`) returned the v1 palette factor for a zone that is then DISCARDED.",
        "`bakeFarTierCell` keys fallback AREA by FACE, not by zone (src/release/far-tier-campaign.ts:205-208): `fallbackFaceKey` takes only the edge index from the zone key. So one phantom shaft entry attributed the WHOLE face's wall area to the fallback total.",
        "`fallbackAreaShare` therefore over-reported, and the 43 cells whose over-report crossed 0.05 were honest-stopped for area they never lost.",
      ],
      corroboration: {
        claim: "EVERY facade-only fallback zone in the entire frozen campaign is a `shaft` zone. Not one is a `base` zone.",
        stoppedCells: { zones: 4_161, base: 0, shaft: 4_161 },
        bakedCells: { cellsWithFallbackZones: 730, zones: 21_063, base: 0, shaft: 21_063 },
        why: "`resolveZone(baseId, \"base\")` was ALREADY guarded by `split > 0`, so it was only ever called when base geometry exists — and then its aggregate is always present. The shaft call had no such guard. The complete absence of base fallbacks is the asymmetry the guard predicts.",
        sevenAtUnity: "Seven of the 43 were reported at a share of EXACTLY 1.000000, which is what a cell whose every face has `split === 1` must report under this defect.",
      },
    },

    fix: {
      change: "`const shaft = split < 1 ? resolveZone(shaftId, \"shaft\") : null;` — the shaft zone is resolved only when the face emits one.",
      whyTernaryAndNotAMove: "Moving the call inside the `split < 1` block would also move it AFTER the base resolution, reordering the `facadeOnlyFallbackReport` and `unitySnapReport` arrays for every face that resolves both zones. The ternary keeps the original shaft-before-base order, so the only behavioural difference anywhere in the campaign is the absence of the phantom calls.",
      whatIsNotChanged: [
        "The zone list the face emits. `if (split > 0)` and the shaft push are untouched, so `faces`, `packing`, `rgb` and `geometry` are unchanged for every face.",
        "The recipe. `FAR_TIER_BAKE_RECIPE_V4.recipeId` stays `far-tier-hlod-bake-v4` and `farTierRecipeHashV4()` stays fd950a77f1c57cb2b7238b588aa11cd020ace1f15c1448438dfd0f235e10412c — the hash covers recipe CONSTANTS, which this change does not touch.",
        "`allowFacadeOnlyFallback`, which is NOT widened, and `FALLBACK_AREA_SHARE_BAR`, which stays 0.05. Absorbing a stop by widening either is a pre-registered NO-GO.",
        "Attribution: every rights, uncertainty, capture-date and provenance string is untouched.",
      ],
    },

    /**
     * PREDICTIONS. Provenance is stated per item, because two different kinds
     * of claim are mixed here and only one of them is a real prediction.
     */
    predictions: {
      P1: {
        provenance: "SUPPLIED BY THE ARCHITECT in the task brief, before this session ran any bake. NOT verified against any measurement at the time of writing.",
        strength: "A GENUINE PRE-REGISTERED PREDICTION. These three numbers were fixed by a party that is not the measuring party, and they are falsifiable to the digit.",
        claims: [
          "All 43 formerly-stopped cells come in UNDER the unchanged 0.05 bar.",
          "The worst residual share among the 43 is cell w04-000572 at 0.03138.",
          "EXACTLY 17 of the 43 land at a residual share of exactly 0.0.",
        ],
      },
      P2: {
        provenance: "DERIVED ANALYTICALLY in this session from the frozen campaign and the shape of the change. No bake.",
        claims: [
          "`packing-infeasible` stays 0. Packing consumes `faces`, which the fix does not alter; and the frozen campaign already recorded 0 across all 883 cells.",
          "`zone-aggregate-out-of-range` stays 0. The fix only REMOVES `resolveZone` calls and never adds one, so it cannot introduce a throw the frozen campaign did not already have — and the frozen campaign recorded 0.",
          "`no-bakeable-face` stays 0, for the same reason: member admission runs before any zone resolution.",
          "`zone-aggregate-missing` stays 0, because the campaign supplies both the opt-in and the bar.",
        ],
      },
      P3: {
        provenance: "DERIVED ANALYTICALLY. Falsifiable by the byte replay and treated as a STOP if it fails.",
        claim: "All 840 already-baked tiles reproduce BYTE-IDENTICALLY under the fix — same glb sha256, same atlas sha256, same byte sizes.",
        why: "The emitted zone list is unchanged, so `packing`, `rgb` and `geometry` are unchanged; and `emitTileBytes` writes no fallback or unity-snap telemetry into the GLB metadata (scripts/far-tier-campaign-support.mjs:68-106). Nothing the fix touches reaches a shipped byte.",
      },
      P4: {
        provenance: "DERIVED ANALYTICALLY. DISCLOSED IN ADVANCE AS AN EXPECTED CHANGE, NOT AS A FAILURE.",
        claim: "The TELEMETRY of the 730 already-baked cells that carried fallback zones WILL change: `fallbackZoneCount`, `fallbackAreaSquareMeters`, `fallbackAreaShare`, the `fallbackZones` list and the `cellsWithFallbackZones` summary all drop the phantom entries. `totalUnitySnaps` may also fall, if any discarded shaft resolution had found an aggregate and overshot unity.",
        consequence: "The frozen telemetry-w0N.json records are NOT edited. They are amended BY STATEMENT, because they truthfully record what the defective code did.",
        honesty: "This means the frozen campaign's `worstFallbackAreaShare` and its 730-cell fallback census were measuring the defect as much as the data. That is a correction to a published figure and is named here rather than discovered later.",
      },
      P5: {
        provenance: "DERIVED ANALYTICALLY as a bound to be TESTED, not as an expected value.",
        claim: "The re-derived resident GPU total for 883 tiles must stay BELOW the frozen `maxResidentTotalGpuBytes` of 390,295,058 (src/release/far-tier-budget.ts:301).",
        stopRule: "At or above 390,295,058: NO PROMOTION. Stop and report. The bar is NOT moved.",
      },
      P6: {
        provenance: "DERIVED ANALYTICALLY in this session. Named because the task brief did not name it and it binds just as hard.",
        claim: "The DECLARED FILE BYTES of all 883 tiles must stay at or below `FAR_TIER_RUNTIME_BUDGETS_V2.maxCachedBytes` = 301,989,888 (288 MiB).",
        currentFor840: 258_644_848,
        headroomBytes: 301_989_888 - 258_644_848,
        note: "DECLARED FILE BYTES. This unit is NOT decoded GPU bytes and is never comparable with B3-B5 or with P5's ceiling.",
        stopRule: "Over 301,989,888: NO PROMOTION. Stop and report.",
      },
    },

    /**
     * The deviation, stated plainly rather than papered over.
     */
    deviationFromTheBrief: {
      instruction: "The task brief asked for the architect's full 43-row table to be recomputed with the fix applied in-memory, confirmed, and then pinned as the prediction.",
      whatWasDoneInstead: "Only the architect's THREE anchors (P1) are pinned as predictions. The full 43-row table is NOT pre-registered; it is written by the `measure` verb afterwards and labelled MEASURED.",
      why: "Rows recomputed by the measuring party, with the measuring party's own code, cannot then be used as a prediction that same code is tested against. Pinning all 43 that way would have produced a table that agrees with the bake by construction and proves nothing. The three anchors came from a party that is not the measuring party and are falsifiable to the digit, so they carry the whole evidentiary weight the 43 rows were meant to carry.",
      cost: "If the architect's three anchors are themselves wrong, this record catches it — but it does not independently pre-register the other 40 rows, and it does not claim to.",
    },

    stopRules: {
      noGos: [
        "Any of the 43 at a residual share ABOVE 0.05 after the fix.",
        "Any of the 43 missing its predicted share beyond replay noise, where P1 names a prediction.",
        "Any mismatch in the 840-tile byte replay.",
        "Re-derived resident GPU total for 883 at or above 390,295,058 at promotion time.",
        "Declared file bytes for 883 above 301,989,888.",
        "Any remaining stop absorbed by widening `allowFacadeOnlyFallback` or by moving the 0.05 bar.",
        "Any change to attribution, rights, uncertainty, capture dates, or the recipe id or hash.",
        "`mergeFarTierWaveInventories` refusing, or the merged inventory not closing at 883.",
        "Editing any frozen record in place instead of amending it by statement.",
      ],
      onAnyNoGo: "STOP. Report. Do not promote, do not stage, do not widen a bar.",
    },

    boundTo: BOUND_TO,

    stoppedCells: {
      count: stopped.length,
      source: `${BOUND_TO.campaignSummary.path} honestStops, read by digest and never transcribed by hand`,
      priorSharesAreDefective: "The `priorShare` below is what the DEFECTIVE code reported. It is recorded so the correction is auditable, not because it measured anything real.",
      cells: stopped,
    },

    notClaimedHere: [
      "This record does not claim the fix is correct. It states what would falsify it.",
      "A residual share of 0.0 is not a claim that the cell's colour is right; it is a claim that no zone the tile carries fell back to v1's palette.",
      "Nothing here is a visual or acceptance verdict. The goal's acceptance record stands as written, at 4f4f733a863d9731b156f46d46fd06413b8b06773333b3f2a2ffa995596a79ec, and this fix does not reopen it.",
      "Baking 43 more cells does not change the exterior tier, the tombstoned buildings, or any NOT-MET criterion in that record.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(path, text);
  await writeFile(join(evidenceRoot, "pre-registration.sha256"), `${sha256(text)}  pre-registration.json\n`);
  console.log(serialize({ ok: true, wrote: `data/${EVIDENCE_ID}/pre-registration.json`, cells: stopped.length, sha256: sha256(text) }));
}


// ---------------------------------------------------------------------------
// measure — bake every cell of a wave under the fix, into THIS record's root
// ---------------------------------------------------------------------------

/**
 * WHY THIS DOES NOT CALL `far-tier-mass-bake-cli.mjs run-wave`.
 *
 * That verb writes `telemetry-w0N.json` into the FROZEN T004 evidence root. The
 * frozen campaign records what the DEFECTIVE code did and is true as written;
 * overwriting it would destroy the evidence this fix is judged against. So the
 * production bake path is IMPORTED — `materializeOneCell`, `bakeOneCell` and
 * `emitTileBytes`, the same three functions the campaign used, with the same
 * `FALLBACK_AREA_SHARE_BAR` — and only the OUTPUT ROOT differs.
 */
async function commandMeasure(waveId) {
  if (!WAVE_IDS.includes(waveId)) fail(`unknown wave ${waveId}; the ledger carries ${WAVE_IDS.join(", ")}.`);
  if (!existsSync(join(evidenceRoot, "pre-registration.json"))) {
    fail("no pre-registration.json in this evidence root. The prediction is written before the measurement, never after it.");
  }
  const wiring = waveWiring(waveId);
  const snapshot = await loadSnapshot();
  const { ledger, checksumSha256: ledgerChecksumSha256 } = await loadWaveLedger();
  snapshot.ledgerChecksumSha256 = ledgerChecksumSha256;
  const waveInventory = await loadWaveInventory(wiring);

  // The FROZEN per-wave inventory of the 840 already-baked tiles, pinned.
  const frozenPath = join(repositoryRoot, "data", "far-tier-hlod-mass-20260819", `inventory-${waveId}.json`);
  const frozenText = await readFile(frozenPath, "utf8");
  const frozenDigest = sha256(frozenText);
  if (frozenDigest !== BOUND_TO.waveInventories[waveId]) {
    fail(`inventory-${waveId}.json is ${frozenDigest}, not the pinned ${BOUND_TO.waveInventories[waveId]}.`);
  }
  const frozen = new Map(JSON.parse(frozenText).entries.map((entry) => [entry.cellId, entry]));

  const cells = ledger.cells.filter((cell) => /-(w\d{2})-/u.exec(cell.cellId)?.[1] === waveId);
  if (cells.length !== wiring.declaredCellCount) {
    fail(`wave ${waveId} has ${cells.length} ledger cells but the shipped registry declares ${wiring.declaredCellCount}.`);
  }

  const payloadWaveRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID, "payloads", waveId);
  await mkdir(payloadWaveRoot, { recursive: true });

  const rows = [];
  const stops = [];
  const started = Date.now();
  for (const cell of cells) {
    const context = materializeOneCell(snapshot, cell, wiring, waveInventory);
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
    await writeFile(join(payloadWaveRoot, tileGlbName(cell.cellId)), emitted.glbBytes);
    await writeFile(join(payloadWaveRoot, tileAtlasName(cell.cellId)), emitted.atlasBytes);

    const prior = frozen.get(cell.cellId) ?? null;
    rows.push({
      cellId: cell.cellId,
      wasFrozen: prior !== null,
      byteIdentity: prior === null
        ? "NEW-TILE"
        : (prior.glbSha256 === emitted.glbSha256
          && prior.atlasSha256 === emitted.atlasSha256
          && prior.glbByteSize === emitted.glbByteSize
          && prior.atlasByteSize === emitted.atlasByteSize ? "IDENTICAL" : "MISMATCH"),
      glbSha256: emitted.glbSha256,
      glbByteSize: emitted.glbByteSize,
      atlasSha256: emitted.atlasSha256,
      atlasByteSize: emitted.atlasByteSize,
      fallbackZoneCount: result.bake.telemetry.fallbackZoneCount,
      fallbackAreaShare: result.bake.telemetry.fallbackAreaShare,
      unitySnapCount: result.bake.telemetry.unitySnapCount,
      atlasPixels: result.bake.telemetry.atlasPixels,
      wallAreaSquareMeters: result.bake.telemetry.wallAreaSquareMeters,
      entry: inventoryEntry(cell, result.bake, emitted),
    });
  }

  const mismatches = rows.filter((row) => row.byteIdentity === "MISMATCH");
  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:measure-${waveId}`,
    artifact: "far-tier-phantom-shaft-wave-measurement",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    waveId,
    recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId,
    recipeSha256: farTierRecipeHashV4(),
    barUnchanged: FALLBACK_AREA_SHARE_BAR,
    parentLedgerChecksumSha256: ledgerChecksumSha256,
    frozenInventorySha256: frozenDigest,
    ledgerCellCount: cells.length,
    bakedCellCount: rows.length,
    honestStopCount: stops.length,
    honestStops: stops,
    byteIdentity: {
      previouslyBaked: rows.filter((row) => row.wasFrozen).length,
      identical: rows.filter((row) => row.byteIdentity === "IDENTICAL").length,
      mismatched: mismatches.length,
      newTiles: rows.filter((row) => row.byteIdentity === "NEW-TILE").length,
      mismatchedCells: mismatches.map((row) => row.cellId),
    },
    elapsedSeconds: round((Date.now() - started) / 1_000, 1),
    cells: rows,
  };
  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, `measure-${waveId}.json`), text);
  await writeFile(join(evidenceRoot, `measure-${waveId}.sha256`), `${sha256(text)}  measure-${waveId}.json\n`);
  console.log(serialize({
    ok: mismatches.length === 0,
    waveId,
    cells: cells.length,
    baked: rows.length,
    stops: stops.length,
    byteIdentity: record.byteIdentity,
    elapsedSeconds: record.elapsedSeconds,
    sha256: sha256(text),
  }));
  if (mismatches.length > 0) fail(`${mismatches.length} previously-baked tile(s) in ${waveId} did NOT reproduce byte-identically. STOP.`);
}

const round = (value, digits) => Number(value.toFixed(digits));

// ---------------------------------------------------------------------------
// verify — roll the six wave measurements up and judge them against P1-P6
// ---------------------------------------------------------------------------

/** Decoded GPU bytes of one tile's geometry, read from the GLB the bake wrote. */
function geometryGpuBytesOfGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  let vertexCount = 0;
  let indexCount = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      vertexCount += json.accessors[primitive.attributes.POSITION].count;
      indexCount += json.accessors[primitive.indices].count;
    }
  }
  // Exactly `farTierGeometryGpuBytes`: POSITION+TEXCOORD_0 float32 on unshared
  // vertices (12+8) plus uint32 indices. No NORMAL is emitted, so none counted.
  return { vertexCount, indexCount, bytes: vertexCount * 20 + indexCount * 4 };
}

const GPU_TEXEL_BYTES = 4;
const MIP_CHAIN_MULTIPLIER = 4 / 3;
const atlasGpuBytesOf = (atlasPixels) => Math.round(atlasPixels * atlasPixels * GPU_TEXEL_BYTES * MIP_CHAIN_MULTIPLIER);

/** The two frozen ceilings, quoted with their units so they cannot be mixed. */
const CEILINGS = {
  gpu: { name: "FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes", value: 390_295_058, unit: "DECODED GPU BYTES", atlasPart: 291_984_434, geometryPart: 98_310_624 },
  file: { name: "FAR_TIER_RUNTIME_BUDGETS_V2.maxCachedBytes", value: 288 * 1024 * 1024, unit: "DECLARED FILE BYTES", currentFor840: 258_644_848 },
};

async function commandVerify() {
  const preText = await readFile(join(evidenceRoot, "pre-registration.json"), "utf8");
  const pre = JSON.parse(preText);
  const waves = [];
  for (const waveId of WAVE_IDS) {
    const text = await readFile(join(evidenceRoot, `measure-${waveId}.json`), "utf8").catch(() => null);
    if (text === null) fail(`measure-${waveId}.json is absent; every wave must be measured before the roll-up.`);
    waves.push(JSON.parse(text));
  }

  const allCells = waves.flatMap((wave) => wave.cells);
  const stops = waves.flatMap((wave) => wave.honestStops);
  const stoppedBefore = new Map(pre.stoppedCells.cells.map((cell) => [cell.cellId, cell]));

  // ---- P3: the 840 must be byte-identical -------------------------------
  const previouslyBaked = allCells.filter((cell) => cell.wasFrozen);
  const mismatched = previouslyBaked.filter((cell) => cell.byteIdentity !== "IDENTICAL");
  const p3 = {
    claim: "All 840 already-baked tiles reproduce BYTE-IDENTICALLY under the fix.",
    previouslyBakedCount: previouslyBaked.length,
    identical: previouslyBaked.length - mismatched.length,
    mismatched: mismatched.length,
    mismatchedCells: mismatched.map((cell) => cell.cellId),
    verdict: previouslyBaked.length === 840 && mismatched.length === 0 ? "PASS" : "FAIL",
  };

  // ---- P1: the architect's three anchors ---------------------------------
  const formerlyStopped = allCells
    .filter((cell) => stoppedBefore.has(cell.cellId))
    .map((cell) => ({
      cellId: cell.cellId,
      shortId: stoppedBefore.get(cell.cellId).shortId,
      priorShare: stoppedBefore.get(cell.cellId).priorShare,
      residualShare: cell.fallbackAreaShare,
      residualZoneCount: cell.fallbackZoneCount,
      underBar: cell.fallbackAreaShare <= FALLBACK_AREA_SHARE_BAR,
    }))
    .sort((left, right) => right.residualShare - left.residualShare || left.shortId.localeCompare(right.shortId));

  const stillStopped = stops.filter((stop) => stoppedBefore.has(stop.cellId));
  const worst = formerlyStopped[0] ?? null;
  const atExactlyZero = formerlyStopped.filter((row) => row.residualShare === 0);
  const p1 = {
    provenance: pre.predictions.P1.provenance,
    anchors: [
      {
        claim: "All 43 come in UNDER the unchanged 0.05 bar.",
        measured: `${formerlyStopped.filter((row) => row.underBar).length} of ${formerlyStopped.length} under bar, ${stillStopped.length} still stopped`,
        verdict: formerlyStopped.length === 43 && formerlyStopped.every((row) => row.underBar) ? "PASS" : "FAIL",
      },
      {
        claim: "The worst residual share is w04-000572 at 0.03138.",
        measured: worst ? `${worst.shortId} at ${round(worst.residualShare, 8)}` : "no cell baked",
        verdict: worst && worst.shortId === "w04-000572" && round(worst.residualShare, 5) === 0.03138 ? "PASS" : "FAIL",
      },
      {
        claim: "EXACTLY 17 of the 43 land at a residual share of exactly 0.0.",
        measured: `${atExactlyZero.length} at exactly 0.0`,
        verdict: atExactlyZero.length === 17 ? "PASS" : "FAIL",
      },
    ],
    barUnchanged: FALLBACK_AREA_SHARE_BAR,
    table: formerlyStopped.map((row) => ({ ...row, priorShare: round(row.priorShare, 8), residualShare: round(row.residualShare, 8) })),
  };

  // ---- P2: the stop classes ----------------------------------------------
  const byClass = {};
  for (const stop of stops) byClass[stop.code] = (byClass[stop.code] ?? 0) + 1;
  const p2 = {
    claim: "packing-infeasible, zone-aggregate-out-of-range, no-bakeable-face and zone-aggregate-missing all stay 0.",
    honestStopsByClass: byClass,
    totalStops: stops.length,
    verdict: stops.length === 0 ? "PASS" : "FAIL",
  };

  // ---- P4: the disclosed telemetry correction ----------------------------
  const frozenFallback = [];
  for (const waveId of WAVE_IDS) {
    const frozen = JSON.parse(await readFile(join(repositoryRoot, "data", "far-tier-hlod-mass-20260819", `telemetry-${waveId}.json`), "utf8"));
    for (const cell of frozen.cells) frozenFallback.push({ cellId: cell.cellId, fallbackZoneCount: cell.fallbackZoneCount, fallbackAreaShare: cell.fallbackAreaShare, unitySnapCount: cell.unitySnapCount });
  }
  const frozenById = new Map(frozenFallback.map((row) => [row.cellId, row]));
  const changed = previouslyBaked.filter((cell) => {
    const before = frozenById.get(cell.cellId);
    return before && (before.fallbackZoneCount !== cell.fallbackZoneCount || before.unitySnapCount !== cell.unitySnapCount);
  });
  const p4 = {
    claim: "The TELEMETRY of already-baked cells changes; their BYTES do not. Disclosed in advance.",
    frozenCellsWithAnyFallbackZone: frozenFallback.filter((row) => row.fallbackZoneCount > 0).length,
    nowWithAnyFallbackZone: previouslyBaked.filter((cell) => cell.fallbackZoneCount > 0).length,
    cellsWhoseTelemetryMoved: changed.length,
    frozenTotalUnitySnaps: frozenFallback.reduce((sum, row) => sum + row.unitySnapCount, 0),
    nowTotalUnitySnaps: previouslyBaked.reduce((sum, cell) => sum + cell.unitySnapCount, 0),
    frozenRecordsEdited: false,
    note: "The frozen telemetry-w0N.json records are NOT edited. They truthfully record what the defective code did and are amended by statement.",
  };

  // ---- P5: decoded GPU bytes, all 883 leaves resident ---------------------
  let atlasGpu = 0;
  let geometryGpu = 0;
  let vertexCount = 0;
  const atlasHistogram = {};
  for (const wave of waves) {
    for (const cell of wave.cells) {
      atlasGpu += atlasGpuBytesOf(cell.atlasPixels);
      atlasHistogram[cell.atlasPixels] = (atlasHistogram[cell.atlasPixels] ?? 0) + 1;
      const glb = await readFile(join(repositoryRoot, "artifacts", EVIDENCE_ID, "payloads", wave.waveId, tileGlbName(cell.cellId)));
      const geometry = geometryGpuBytesOfGlb(new Uint8Array(glb));
      geometryGpu += geometry.bytes;
      vertexCount += geometry.vertexCount;
    }
  }
  const totalGpu = atlasGpu + geometryGpu;
  const p5 = {
    claim: "Every camera pose selects a SUBSET of the shipped leaves, so 'all 883 resident at once' bounds every pose. That total must stay below the frozen ceiling.",
    unit: CEILINGS.gpu.unit,
    tiles: allCells.length,
    atlasGpuBytes: atlasGpu,
    geometryGpuBytes: geometryGpu,
    totalGpuBytes: totalGpu,
    vertexCount,
    actualAtlasPixelHistogram: atlasHistogram,
    ceiling: CEILINGS.gpu,
    headroomBytes: CEILINGS.gpu.value - totalGpu,
    verdict: totalGpu < CEILINGS.gpu.value ? "PASS" : "FAIL",
    stopRule: "At or above the ceiling: NO PROMOTION. The bar is not moved.",
    /**
     * HOW MUCH THIS TEST ACTUALLY PROVES. Read before quoting the verdict.
     */
    whatAPassMeansHere: {
      warning: "A PASS here is a WEAK result, and calling it comfortable would be wrong.",
      why: "The frozen ceiling was not an independent budget. It was DERIVED in T003 from a model of these same 883 ledger cells -- `maxCut` over the modelled tree -- and for this tree `maxCut` exceeds the plain all-883-leaves sum by only 3 bytes. So comparing the actual all-leaves total against it is very nearly a test of whether the bake matched its own resolution model, not a test of whether the tier fits a device.",
      modelledLeafAtlasSum: 291_984_431,
      modelledLeafAtlasHistogram: { 64: 22, 128: 36, 256: 825 },
      modelledMinusMaxCutAtlas: 291_984_434 - 291_984_431,
      whatWouldBeStronger: "A measured GPU residency reading from a real session, in the B3-B5 discipline, at the poses the sweep visits. That is NOT done here and is not claimed.",
      alsoNotClaimed: "No far-tier tile is an internal-node tile today; the shipped set is leaves only. The maxCut bound's internal nodes describe a hierarchy this bake did not produce.",
    },
  };

  // ---- P6: declared file bytes -------------------------------------------
  const fileBytes = allCells.reduce((sum, cell) => sum + cell.glbByteSize + cell.atlasByteSize, 0);
  const p6 = {
    claim: "The declared FILE bytes of all 883 tiles must fit the runtime cache ceiling.",
    unit: CEILINGS.file.unit,
    declaredFileBytes: fileBytes,
    ceiling: CEILINGS.file,
    headroomBytes: CEILINGS.file.value - fileBytes,
    verdict: fileBytes <= CEILINGS.file.value ? "PASS" : "FAIL",
    unitWarning: "DECLARED FILE BYTES. Never comparable with P5, which is decoded GPU bytes.",
  };

  const verdicts = { P1: p1.anchors.every((anchor) => anchor.verdict === "PASS") ? "PASS" : "FAIL", P2: p2.verdict, P3: p3.verdict, P4: "DISCLOSED", P5: p5.verdict, P6: p6.verdict };
  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:verification`,
    artifact: "far-tier-phantom-shaft-verification",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    preRegistrationSha256: sha256(preText),
    barUnchanged: FALLBACK_AREA_SHARE_BAR,
    recipeSha256: farTierRecipeHashV4(),
    totals: { ledgerCells: waves.reduce((sum, wave) => sum + wave.ledgerCellCount, 0), baked: allCells.length, stops: stops.length },
    verdicts,
    P1: p1,
    P2: p2,
    P3: p3,
    P4: p4,
    P5: p5,
    P6: p6,
    notClaimedHere: [
      "No visual or acceptance claim is made here. Nothing in this record reopens the goal acceptance record.",
      "P1's second and third anchors are the only genuinely pre-registered numeric predictions; the other forty rows are measured, not predicted.",
    ],
  };
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "verification.json"), text);
  await writeFile(join(evidenceRoot, "verification.sha256"), `${sha256(text)}  verification.json\n`);
  console.log(serialize({ ok: Object.values(verdicts).every((verdict) => verdict === "PASS" || verdict === "DISCLOSED"), verdicts, totals: record.totals, P1: p1.anchors, P5: { totalGpuBytes: p5.totalGpuBytes, ceiling: CEILINGS.gpu.value, headroomBytes: p5.headroomBytes, verdict: p5.verdict }, P6: { declaredFileBytes: p6.declaredFileBytes, ceiling: CEILINGS.file.value, headroomBytes: p6.headroomBytes, verdict: p6.verdict }, sha256: sha256(text) }));
}

// ---------------------------------------------------------------------------
// replay — re-bake named cells in FRESH child processes and compare digests
// ---------------------------------------------------------------------------

/**
 * Determinism is a claim about PROCESSES, not about a loop.
 *
 * `measure` bakes a whole wave inside one process, where a stale cache or a
 * map's insertion order can make two cells agree for the wrong reason. This
 * verb re-bakes named cells in fresh `node` children and compares their digests
 * against the ones `measure` recorded, so a digest that only reproduces within
 * a warm process is caught.
 */
async function commandReplayBatch(waveId, cellList) {
  const wanted = new Set(cellList.split(",").filter(Boolean));
  const wiring = waveWiring(waveId);
  const snapshot = await loadSnapshot();
  const { ledger, checksumSha256: ledgerChecksumSha256 } = await loadWaveLedger();
  snapshot.ledgerChecksumSha256 = ledgerChecksumSha256;
  const waveInventory = await loadWaveInventory(wiring);
  const out = [];
  for (const cell of ledger.cells) {
    if (!wanted.has(cell.cellId)) continue;
    const context = materializeOneCell(snapshot, cell, wiring, waveInventory);
    const result = bakeOneCell(context, cell);
    const emitted = emitTileBytes(context, cell, result.bake, {
      recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId,
      recipeSha256: farTierRecipeHashV4(),
      capture: SOURCE_CAPTURE,
    });
    out.push({
      cellId: cell.cellId,
      glbSha256: emitted.glbSha256,
      atlasSha256: emitted.atlasSha256,
      fallbackAreaShare: result.bake.telemetry.fallbackAreaShare,
      fallbackZoneCount: result.bake.telemetry.fallbackZoneCount,
      unitySnapCount: result.bake.telemetry.unitySnapCount,
    });
  }
  console.log(JSON.stringify(out));
}

/** Replay every tile that did not exist before this fix, twice, in children. */
async function commandReplayNew(passes) {
  const byWave = new Map();
  for (const waveId of WAVE_IDS) {
    const text = await readFile(join(evidenceRoot, `measure-${waveId}.json`), "utf8").catch(() => null);
    if (text === null) continue;
    const measured = JSON.parse(text);
    const fresh = measured.cells.filter((cell) => cell.byteIdentity === "NEW-TILE");
    if (fresh.length > 0) byWave.set(waveId, fresh);
  }
  const total = [...byWave.values()].reduce((sum, rows) => sum + rows.length, 0);
  if (total === 0) fail("no NEW-TILE rows found; run `measure` for every wave first.");

  const results = [];
  for (let pass = 1; pass <= passes; pass += 1) {
    for (const [waveId, rows] of byWave) {
      const child = spawnSync(execPath, [
        "--experimental-strip-types",
        fileURLToPath(import.meta.url),
        "replay-batch",
        "--wave", waveId,
        "--cells", rows.map((row) => row.cellId).join(","),
      ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: repositoryRoot });
      if (child.status !== 0) fail(`replay child for ${waveId} pass ${pass} exited ${child.status}: ${child.stderr}`);
      const replayed = new Map(JSON.parse(child.stdout.trim().split("\n").at(-1)).map((row) => [row.cellId, row]));
      for (const row of rows) {
        const back = replayed.get(row.cellId);
        results.push({
          pass,
          cellId: row.cellId,
          match: back !== undefined
            && back.glbSha256 === row.glbSha256
            && back.atlasSha256 === row.atlasSha256
            && back.fallbackAreaShare === row.fallbackAreaShare
            && back.unitySnapCount === row.unitySnapCount,
        });
      }
    }
  }
  const failures = results.filter((row) => !row.match);
  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:replay-new-tiles`,
    artifact: "far-tier-phantom-shaft-determinism-replay",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    claim: "Every tile that did not exist before this fix re-bakes to the same glb and atlas digest, and the same fallback and unity-snap telemetry, in a FRESH child process.",
    passes,
    tilesPerPass: total,
    comparisons: results.length,
    mismatches: failures.length,
    mismatchedCells: [...new Set(failures.map((row) => row.cellId))],
    verdict: failures.length === 0 ? "PASS" : "FAIL",
    notClaimedHere: [
      "The 840 pre-existing tiles are not replayed here. Their byte identity is established against the SEALED per-wave inventories, which their own T004 child-process replay produced.",
    ],
  };
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "replay-new-tiles.json"), text);
  await writeFile(join(evidenceRoot, "replay-new-tiles.sha256"), `${sha256(text)}  replay-new-tiles.json\n`);
  console.log(serialize({ ok: failures.length === 0, passes, tilesPerPass: total, comparisons: results.length, mismatches: failures.length, sha256: sha256(text) }));
  if (failures.length > 0) fail(`${failures.length} determinism mismatch(es). STOP.`);
}

// ---------------------------------------------------------------------------

function isDirectEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectEntryPoint()) {
  const command = process.argv[2];
  const flag = (name) => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : null; };
  if (command === "pre-register") await commandPreRegister();
  else if (command === "measure") await commandMeasure(flag("wave"));
  else if (command === "verify") await commandVerify();
  else if (command === "replay-batch") await commandReplayBatch(flag("wave"), flag("cells"));
  else if (command === "replay-new") await commandReplayNew(Number(flag("passes") ?? 2));
  else fail("usage: far-tier-phantom-shaft-cli.mjs <pre-register|measure|verify|replay-new> [--wave wXX] [--passes N]");
}
