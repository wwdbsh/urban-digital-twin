/* global console, process, TextEncoder */
/**
 * Northern-Manhattan exterior wave pipeline (Task T021).
 *
 * A sibling of `scripts/central-upper-manhattan-cli.mjs`, which stays exactly as
 * it is and keeps emitting the byte-frozen Central-and-upper-Manhattan canary and
 * its promoted P1 successor. Five resumable, idempotent stages over the pinned,
 * gitignored `manhattan-citywide-20260804` snapshot, the committed
 * `manhattan-exterior-wave-ledger-20260804` ledger, and the FIVE promoted waves'
 * committed records:
 *
 *   plans  census every one of the 10,230 wave-w05 buildings through the V3
 *          footprint-faithful grammar over its REAL sourced ring; record which
 *          property of a polygon the grammar could not carry, never invent one.
 *   glbs   generate both canonical LODs for every planned building, run the
 *          per-asset census gates on the emitted bytes, and write the shipped
 *          LOD of the renderable cells — TEXTURED — into the payload.
 *   gates  ownership, digest reconciliation, the renderable-subset entry
 *          derivation, and the wave-scale budget statement.
 *   graph  assemble and emit the release graph, runtime index, assembly package
 *          and artifact blobs, replay the emitted bytes, and write the committed
 *          checksum inventory.
 *   sample select the deterministic Blender inspection sample and emit one
 *          authoring input per sampled building.
 *
 * THERE IS NO `probe` STAGE, and that is a decision rather than an omission. The
 * kill switch asked one question — are procedural detail tiles affordable in the
 * shipping renderer at all — and T015 answered it PASS on this exact tile system,
 * this exact sampler filter and this exact LOD placement; T016 re-measured the
 * promoted composition OFF the vsync floor, T018 re-measured a four-wave
 * composition at the RAISED cache cap, and T020 re-measured a five-wave one. Wave
 * w05 changes which buildings carry the tiles, not the tiles. ADR 0037 records
 * that inheritance explicitly, including the fact that it is an inheritance.
 *
 * Each stage writes a receipt carrying the fingerprint of its inputs, so an
 * interrupted run resumes rather than restarting. The payload directory is
 * intentionally untracked (the citywide precedent);
 * `data/northern-manhattan-20260812/` carries the committed checksum inventory
 * that keeps it checkable after the tree is removed.
 *
 * This script acquires nothing, replaces no retained snapshot, never writes into
 * another wave's directories, and writes only under the ones it owns.
 *
 * TWO RELEASES TRAVEL THIS PIPELINE.
 *
 *   canary  (default) `manhattan-northern-manhattan-cells-20260812` — the
 *           order-derived renderable subset under a deliberately modest entry
 *           ceiling. Opt-in only; nothing about it promotes it.
 *   p1      `manhattan-northern-manhattan-cells-20260812-p1` — the PROMOTED
 *           successor, whose renderable subset is the explicit curated list in
 *           `northern-manhattan-curation.ts` under the 36-entry RESERVATION T020's
 *           split committed to this wave.
 *
 * `RELEASE_VARIANTS`, the optional `renderableCellDigestSha256` fingerprint
 * component and the fail-closed gates-receipt rule were carried forward from the
 * Central-and-upper-Manhattan pipeline UNUSED by the canary. They are the seam the
 * promoted successor slots into, and both exist because their absence was a real
 * defect the T016 review found: a curated subset that is a constant in this
 * repository moves nothing hashed when it is edited, and a curated variant that
 * reaches its committed inventory without a gates receipt emits its refusal census
 * as `null`. The p1 variant below is what makes the seam load-bearing rather than
 * decorative.
 *
 * Usage:
 *   node scripts/northern-manhattan-cli.mjs <plans|glbs|gates|graph|sample|all> [--release canary|p1] [--force]
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseWaveCliArguments, requireWaveCliArguments } from "./wave-cli-arguments.mjs";
import { NORTHERN_MANHATTAN_T1, exteriorT1InventoryNote } from "../src/release/exterior-t1-variants.ts";
import { sha256HexBytes, sha256HexSync, stableSerialize } from "../src/domain/deterministic-hash.ts";
import {
  EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
} from "../src/domain/exterior-fullsnapshot-input.ts";
import { EXTERIOR_WAVE_LEDGER_RELEASE_ID, EXTERIOR_WAVE_PLAN } from "../src/release/exterior-wave-ledger.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";
import { replayMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";
import { replayExteriorArtifactIntegrity } from "../src/release/exterior-release.ts";
import { V3T_QUALITY_BUDGETS } from "../src/release/block835-v3-package.ts";
import { proceduralTextureProvenance } from "../src/release/procedural-texture.ts";
import {
  exteriorWaveArtifactChecksum,
  serializeExteriorWaveArtifact,
} from "../src/release/exterior-wave-subset.ts";
import {
  NORTHERN_MANHATTAN_BUILDING_COUNT,
  NORTHERN_MANHATTAN_CELL_COUNT,
  NORTHERN_MANHATTAN_RELEASE_ID,
  NORTHERN_MANHATTAN_WAVE_INDEX,
  buildNorthernManhattanSubsetLedger,
  reconcileNorthernManhattanAgainstDigest,
  validateNorthernManhattanSubsetLedger,
} from "../src/release/northern-manhattan-package.ts";
import {
  NORTHERN_MANHATTAN_CENSUS_PROFILE,
  NORTHERN_MANHATTAN_MODEST_SUBSET_CEILING,
  NORTHERN_MANHATTAN_OUTPUT_DIRECTORY,
  NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID,
  NORTHERN_MANHATTAN_WAVE_PROFILE,
  northernManhattanPredecessor,
  northernManhattanProfile,
  northernManhattanRenderableCells,
  northernManhattanRenderableEntryBudget,
  northernManhattanReservation,
} from "../src/release/northern-manhattan-release.ts";
import {
  NORTHERN_MANHATTAN_CANDIDATE_ENVELOPE,
  NORTHERN_MANHATTAN_CURATED_CELLS,
  NORTHERN_MANHATTAN_CURATION_BASIS,
  NORTHERN_MANHATTAN_CURATION_STATEMENT,
  NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS,
  NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS,
  northernManhattanCuratedCells,
  northernManhattanCuratedEntryBudget,
  northernManhattanCuratedRefusalCensus,
  northernManhattanCuratedVolumeMargin,
} from "../src/release/northern-manhattan-curation.ts";
import {
  NORTHERN_MANHATTAN_P1_OUTPUT_DIRECTORY,
  NORTHERN_MANHATTAN_P1_PREDECESSOR_RELEASE_ID,
  NORTHERN_MANHATTAN_P1_RELEASE_ID,
  NORTHERN_MANHATTAN_P1_WAVE_PROFILE,
  northernManhattanP1Predecessor,
  northernManhattanP1Profile,
} from "../src/release/northern-manhattan-p1-release.ts";
import { collectMidtownCoreSources, midtownCoreGlbBounds } from "../src/release/midtown-core-source.ts";
import { MIDTOWN_CORE_SHIPPED_LOD_ID, buildMidtownCoreRelease } from "../src/release/midtown-core-release.ts";
import {
  MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
  MidtownCoreV3Stop,
  buildMidtownCoreV3Plan,
  writeMidtownCoreV3Assets,
} from "../src/release/midtown-core-v3-materialization.ts";
import { materializeMidtownCoreV3Cells, midtownCoreV3StageFingerprint } from "../src/release/midtown-core-v3-source.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);

/**
 * The FIVE PROMOTED waves, for cache occupancy alone — and the wave index each
 * one materializes.
 *
 * Each is read from what it actually SHIPPED rather than from a remembered number,
 * and each is named here so a further promotion cannot be forgotten: the occupancy
 * statement this pipeline emits is only as true as this list. The wave index is
 * carried beside the release id because the same list also answers the
 * complementary question — which waves are still UNPROMOTED — by subtraction from
 * the declared wave plan, rather than by a second list that could disagree with
 * this one. For this wave that subtraction has to yield exactly one entry, this
 * one, and the entry-budget derivation refuses any other answer.
 *
 * `source` says where the count comes from, because they are not all the same.
 * Block 835 declares its GLBs in its assembly package rather than on its root, so
 * a root-manifest filter over it silently returns zero; it is counted from its
 * committed payload directory instead.
 */
const PROMOTED_WAVES = [
  {
    waveIndex: 0,
    releaseId: "manhattan-exterior-cells-20260811-v3",
    source: { kind: "payload-directory", path: join(repositoryRoot, "public", "data", "manhattan-exterior-cells-20260811-v3", "public", "assets") },
  },
  {
    waveIndex: 1,
    releaseId: "manhattan-midtown-core-cells-20260811-v3",
    source: { kind: "inventory", path: join(repositoryRoot, "data", "midtown-core-20260811-v3", "payload-inventory.json") },
  },
  {
    waveIndex: 2,
    releaseId: "manhattan-lower-manhattan-cells-20260812-p1",
    source: { kind: "inventory", path: join(repositoryRoot, "data", "lower-manhattan-20260812-p1", "payload-inventory.json") },
  },
  {
    waveIndex: 3,
    releaseId: "manhattan-southern-remainder-cells-20260812-p1",
    source: { kind: "inventory", path: join(repositoryRoot, "data", "southern-remainder-20260812-p1", "payload-inventory.json") },
  },
  {
    waveIndex: 4,
    releaseId: "manhattan-central-upper-manhattan-cells-20260812-p1",
    source: { kind: "inventory", path: join(repositoryRoot, "data", "central-upper-manhattan-20260812-p1", "payload-inventory.json") },
  },
];

/**
 * The committed record the 36-entry RESERVATION is read from, for every variant.
 *
 * It is the promoted wave-w04 successor's own `payload-inventory.json` — the
 * release that took ADR 0036 Decision 3's response 2 and wrote both halves of the
 * split into its bytes. It is a constant rather than a per-variant path because a
 * reservation belongs to the release that MADE it, not to whatever release a
 * variant happens to pin as its graph predecessor.
 */
const RESERVATION_INVENTORY_PATH = join(repositoryRoot, "data", "central-upper-manhattan-20260812-p1", "payload-inventory.json");

/** Directories this pipeline owns and may replace. */
export const NORTHERN_MANHATTAN_WORK_ROOT = "artifacts/northern-manhattan-20260812";
export const NORTHERN_MANHATTAN_RECORD_ROOT = "data/northern-manhattan-20260812";
export const NORTHERN_MANHATTAN_P1_WORK_ROOT = "artifacts/northern-manhattan-20260812-p1";
export const NORTHERN_MANHATTAN_P1_RECORD_ROOT = "data/northern-manhattan-20260812-p1";

/**
 * The releases this pipeline emits, and everything that differs between them.
 * Anything not in this table is shared by construction rather than by agreement
 * between two copies.
 */
const SCRIPT_NAME = "scripts/northern-manhattan-cli.mjs";

const RELEASE_VARIANTS = {
  canary: {
    variantId: "canary",
    releaseId: NORTHERN_MANHATTAN_RELEASE_ID,
    outputDirectory: NORTHERN_MANHATTAN_OUTPUT_DIRECTORY,
    workRoot: NORTHERN_MANHATTAN_WORK_ROOT,
    recordRoot: NORTHERN_MANHATTAN_RECORD_ROOT,
    waveProfile: NORTHERN_MANHATTAN_WAVE_PROFILE,
    predecessorReleaseId: NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID,
    predecessorInventoryPath: join(repositoryRoot, "data", "central-upper-manhattan-20260812-p1", "payload-inventory.json"),
    predecessorOf: northernManhattanPredecessor,
    releaseProfile: northernManhattanProfile,
    renderable: (cells, entryBudget) => northernManhattanRenderableCells(cells, entryBudget),
    /**
     * The CANARY occupancy derivation: what an opt-in-only session may hold, under
     * a deliberately modest self-imposed ceiling. It also states, in the release's
     * own bytes, the RESERVATION T020 committed to leaving this wave — read back
     * out of that release's record rather than retyped — and the several things
     * that reservation does not buy.
     */
    occupancyOf: (input) => northernManhattanRenderableEntryBudget({
      maxCacheEntries: input.maxCacheEntries,
      promotedWaves: input.promotedWaves,
      modestSubsetCeiling: NORTHERN_MANHATTAN_MODEST_SUBSET_CEILING,
      cellBuildingCounts: input.cellBuildingCounts,
      remainingUnpromotedWaveIds: input.remainingUnpromotedWaveIds,
      reservation: input.reservation,
    }),
    curation: null,
    skylineEnvelope: null,
    stages: ["plans", "glbs", "gates", "graph", "sample"],
    inventoryNote: "The payload directory is intentionally untracked, following the citywide precedent. This inventory is the committed record that keeps every emitted byte checkable after the local tree is removed; `node scripts/northern-manhattan-cli.mjs graph --force` rebuilds it byte-identically. This release is a CANARY: it is pinned for `?exteriorCells=` opt-in and is absent from the promotion record, so an ordinary session never loads it. CACHE: the occupancy below is derived against the 512-entry cap raised at T018 and unchanged since. FIVE waves are promoted now and this is the LAST unpromoted wave the committed ledger declares, so there is no headroom left to contest — there is a RESERVATION. T020's promotion of wave w04 took ADR 0036 Decision 3's response 2 and reserved 36 entries for this wave in its own committed bytes, which is where `occupancy.reservation` is read from. TWO NUMBERS ARE RECORDED BECAUSE THEY DIFFER: 38 entries are actually free (512 minus the 474 the five promoted waves ship), while 36 were reserved. The 2-entry surplus is what wave w04's promotion did not spend of its 42-entry share, and T022 is bound by the 36 it was promised rather than by the 38 that happen to be free. THE RESERVATION DOES NOT ADMIT AN ORDINARY CELL OF THIS WAVE: the median cell owns 55 buildings, so `admitsMedianCellWithinReservation` is false and only 50 of the 182 cells fit the reservation whole. THIS CANARY'S OWN BUDGET IS LARGER THAN THE RESERVATION AND IS NOT A PROMOTION REHEARSAL: `entryBudgetFitsReservation` is false by construction, because an opt-in session loads this release alone and is budgeted against the cache rather than against a promoted composition.",
  },
  p1: {
    variantId: "p1",
    releaseId: NORTHERN_MANHATTAN_P1_RELEASE_ID,
    outputDirectory: NORTHERN_MANHATTAN_P1_OUTPUT_DIRECTORY,
    workRoot: NORTHERN_MANHATTAN_P1_WORK_ROOT,
    recordRoot: NORTHERN_MANHATTAN_P1_RECORD_ROOT,
    waveProfile: NORTHERN_MANHATTAN_P1_WAVE_PROFILE,
    predecessorReleaseId: NORTHERN_MANHATTAN_P1_PREDECESSOR_RELEASE_ID,
    predecessorInventoryPath: join(repositoryRoot, "data", "northern-manhattan-20260812", "payload-inventory.json"),
    predecessorOf: northernManhattanP1Predecessor,
    releaseProfile: northernManhattanP1Profile,
    renderable: (cells, entryBudget) => {
      const curated = northernManhattanCuratedCells(cells, entryBudget);
      return { cells: curated.cells, ownedBuildingCount: curated.ownedBuildingCount, spareEntries: curated.spareEntries };
    },
    /**
     * The PROMOTED occupancy derivation, at the UNCHANGED 512-entry cap.
     *
     * The headroom beside the five already-promoted waves is read from THEIR
     * committed records on every run, never remembered. What this variant adds
     * over the canary's derivation is that the reservation is CONSUMED rather
     * than merely reported: the budget applied here is the 36 entries T020's
     * split promised this wave, and the derivation refuses a reservation that
     * disagrees with the one this curation was enumerated against, that no longer
     * fits what is free, or that arrives in a build where this is not the last
     * unpromoted wave.
     */
    occupancyOf: (input) => northernManhattanCuratedEntryBudget({
      maxCacheEntries: input.maxCacheEntries,
      promotedWaves: input.promotedWaves,
      remainingUnpromotedWaveIds: input.remainingUnpromotedWaveIds,
      reservation: input.reservation,
      declaredWaveCount: input.declaredWaveCount,
    }),
    curation: {
      basis: NORTHERN_MANHATTAN_CURATION_BASIS,
      statement: NORTHERN_MANHATTAN_CURATION_STATEMENT,
      cells: NORTHERN_MANHATTAN_CURATED_CELLS,
      refusalCensus: northernManhattanCuratedRefusalCensus,
      volumeMargin: northernManhattanCuratedVolumeMargin,
    },
    /**
     * The candidate envelope the curation chose from: the WHOLE WAVE, so the
     * committed skyline census profiles all 182 owned cells and the optimality
     * claim can be re-enumerated over every one of them rather than over a band
     * drawn after the answer was known.
     */
    skylineEnvelope: NORTHERN_MANHATTAN_CANDIDATE_ENVELOPE,
    // No `probe`: the kill switch is a question about whether tiles are
    // affordable at all, it was answered on the T015 canary and re-measured off
    // the vsync floor at T016, at the raised cap at T018, and on a five-wave
    // composition at T020. Promotion's measurement here is the whole SIX-WAVE
    // composition in the production preview, which is a different instrument
    // entirely and lives in `northern-manhattan-acceptance-cli.mjs`.
    stages: ["plans", "glbs", "gates", "graph", "sample"],
    inventoryNote: "The payload directory is intentionally untracked, following the citywide precedent. This inventory is the committed record that keeps every emitted byte checkable after the local tree is removed; `node scripts/northern-manhattan-cli.mjs graph --release p1 --force` rebuilds it byte-identically. RIGHTS: this successor ships under the CANARY's approval instrument, carried unedited — same approval id, scope text, exclusions and note, and therefore the same fingerprint — because amending it would move the fingerprint the canary's own committed release graph pins and would falsify what was approved. That instrument's opening sentence names the release it was authored for, `manhattan-northern-manhattan-cells-20260812`, and is the only part of it that is about that release rather than about wave w05; every operative clause was checked against this release and holds, including the bounded-subset clause that is exactly what differs here. This release adds no source, no verb and no envelope to it, AND IT RESTS ON NO FRESH SIGNATURE: promotion did not obtain one, nobody was asked to approve wave w05 for default activation, and the authority is the two recorded items the canary's note names and no others. THE INSTRUMENT'S LAST-WAVE CLAUSE APPLIES AT FULL FORCE AND STILL BROADENS NOTHING: with this release completed coverage becomes a fact about the promoted DEFAULT rather than only about approved releases, and that is still an arithmetic property of the partition rather than a verb, a source or an audience — the verbs are the 2026-08-11 verbs, the source is the same pinned jh45-qr5r snapshot, public internet deployment stays excluded, and nothing here authorizes assembling the six waves into a redistributable whole that no single wave's instrument would permit. CACHE: the occupancy below is derived against the UNCHANGED 512-entry cap. The 36-entry reservation T020 recorded is CONSUMED by this promotion and recorded as consumed — see `occupancy.reservationStatement` for the decision it inherits, the arithmetic that produced 42 and 36, what the 2-entry surplus is and why it is not taken, and the ledger-wide occupancy end-state this promotion produces.",
  },
};

/**
 * The SHARED-TEXTURE variant of the promoted successor (T002, ADR 0047).
 *
 * It is SPREAD from `p1` and overrides six fields and no others. That is
 * deliberate and load-bearing: the renderable subset, the curation, the
 * occupancy derivation and the skyline envelope are the promoted release's
 * own objects, so "the same cells" is a property of this table rather than a
 * claim two entries have to keep agreeing on. What differs is the release id,
 * where its bytes go, and the wave profile's `textureDelivery`.
 *
 * It runs no `sample` stage: the Blender inspection sample is chosen on
 * geometry, and this variant's geometry is the promoted release's geometry.
 */
RELEASE_VARIANTS.t1 = {
  ...RELEASE_VARIANTS.p1,
  variantId: "t1",
  releaseId: NORTHERN_MANHATTAN_T1.releaseId,
  outputDirectory: NORTHERN_MANHATTAN_T1.outputDirectory,
  workRoot: "artifacts/northern-manhattan-20260812-t1",
  recordRoot: "data/northern-manhattan-20260812-t1",
  waveProfile: NORTHERN_MANHATTAN_T1.waveProfile,
  predecessorReleaseId: NORTHERN_MANHATTAN_T1.predecessorReleaseId,
  predecessorInventoryPath: join(repositoryRoot, "data/northern-manhattan-20260812-p1", "payload-inventory.json"),
  predecessorOf: NORTHERN_MANHATTAN_T1.predecessorOf,
  releaseProfile: NORTHERN_MANHATTAN_T1.releaseProfile,
  stages: ["plans", "glbs", "gates", "graph"],
  inventoryNote: exteriorT1InventoryNote(NORTHERN_MANHATTAN_T1, SCRIPT_NAME),
};

const STAGES = ["plans", "glbs", "gates", "graph", "sample"];

function fail(message) { throw new Error(`northern-manhattan: ${message}`); }

function readJsonText(text, label) {
  try { return JSON.parse(text); } catch { return fail(`${label} is not valid JSON.`); }
}

async function readVerifiedText(path, label) {
  if (!existsSync(path)) fail(`${label} is absent at ${path}. This pipeline never acquires data.`);
  return readFile(path, "utf8");
}

function countInventoryGlbs(inventory) {
  return inventory.files.filter((file) => /^public\/assets\/.*\.glb$/u.test(file.path)).length;
}

/**
 * Counts what each promoted wave shipped, from that wave's own committed record.
 *
 * Every GLB artifact counts, both LODs included: the runtime cache is keyed per
 * artifact, so a resident coarse level occupies an entry exactly as a fine one
 * does. A wave whose record declares zero assets fails the run rather than silently
 * shrinking the promoted set.
 */
async function readPromotedWaveEntries() {
  const entries = [];
  for (const wave of PROMOTED_WAVES) {
    let assetEntries;
    if (wave.source.kind === "inventory") {
      const label = `committed ${wave.releaseId} inventory`;
      assetEntries = countInventoryGlbs(readJsonText(await readVerifiedText(wave.source.path, label), label));
    } else {
      if (!existsSync(wave.source.path)) fail(`the promoted ${wave.releaseId} assets are absent at ${wave.source.path}.`);
      assetEntries = (await readdir(wave.source.path)).filter((name) => name.endsWith(".glb")).length;
    }
    if (assetEntries === 0) fail(`the promoted ${wave.releaseId} record declares no GLB assets; the occupancy derivation would understate the promoted set.`);
    entries.push({ releaseId: wave.releaseId, assetEntries });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Shared inputs
// ---------------------------------------------------------------------------

async function loadContext(variant) {
  const workRoot = join(repositoryRoot, variant.workRoot);
  const recordRoot = join(repositoryRoot, variant.recordRoot);
  const payloadRoot = join(repositoryRoot, variant.outputDirectory);
  const manifestText = await readVerifiedText(join(snapshotRoot, "manifest.json"), "pinned citywide manifest");
  const manifestChecksum = sha256HexSync(manifestText);
  if (manifestChecksum !== EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256) {
    fail(`citywide manifest checksum ${manifestChecksum} is not the pinned ${EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256}.`);
  }
  const manifest = readJsonText(manifestText, "citywide manifest");
  const snapshot = (manifest.sourceSnapshots ?? []).find((entry) => entry.registryEntryId === "nyc.building-footprints");
  if (!snapshot) fail("the citywide manifest declares no nyc.building-footprints source snapshot.");
  const capture = { capturedAt: snapshot.captureTimestamp, updatedAt: snapshot.sourceUpdatedAt };

  const parentLedgerText = await readVerifiedText(join(ledgerRoot, "ledger.json"), "committed wave ledger");
  const parentLedger = readJsonText(parentLedgerText, "committed wave ledger");
  const parentLedgerChecksumSha256 = exteriorWaveArtifactChecksum(parentLedger);
  const recordedLedgerChecksum = (await readVerifiedText(join(ledgerRoot, "ledger.sha256"), "committed wave ledger checksum")).trim().split(/\s+/u)[0];
  if (recordedLedgerChecksum !== parentLedgerChecksumSha256) fail("committed wave ledger does not match its recorded checksum.");

  const subset = buildNorthernManhattanSubsetLedger({
    parentLedger,
    parentLedgerChecksumSha256,
    baseReleaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  });
  if (subset.ledger.cells.length !== NORTHERN_MANHATTAN_CELL_COUNT) fail(`subset owns ${subset.ledger.cells.length} cells, not ${NORTHERN_MANHATTAN_CELL_COUNT}.`);

  const predecessorLabel = `committed ${variant.predecessorReleaseId} inventory`;
  const predecessorInventoryText = await readVerifiedText(variant.predecessorInventoryPath, predecessorLabel);
  const predecessorInventory = readJsonText(predecessorInventoryText, predecessorLabel);
  const predecessorInventoryChecksumSha256 = sha256HexSync(predecessorInventoryText);
  const predecessor = variant.predecessorOf(predecessorInventory);
  // THE RESERVATION IS ALWAYS READ FROM THE RELEASE THAT MADE IT, WHICHEVER
  // VARIANT IS RUNNING.
  //
  // For the canary those bytes are also its lineage predecessor, so the two reads
  // coincided and one path served both. They do NOT coincide for the promoted
  // successor: its graph predecessor is the canary, while the reservation still
  // belongs to the promoted wave-w04 release that recorded it. Reading the
  // reservation from whatever a variant happens to pin would have made the
  // successor inherit its budget from a release that never reserved anything,
  // which `northernManhattanReservation` refuses by release id rather than
  // accepting silently.
  const reservationLabel = `committed ${NORTHERN_MANHATTAN_PREDECESSOR_RELEASE_ID} inventory (reservation)`;
  const reservationInventory = readJsonText(await readVerifiedText(RESERVATION_INVENTORY_PATH, reservationLabel), reservationLabel);
  const reservation = northernManhattanReservation(reservationInventory);

  const promotedWaves = await readPromotedWaveEntries();

  // Which waves are still UNPROMOTED, derived by subtracting the promoted list
  // from the declared wave plan rather than written down a second time. For this
  // wave the answer must be exactly one entry — itself — and the entry-budget
  // derivation refuses any other, because "the last wave" is the premise every
  // reservation sentence in the record rests on.
  const promotedWaveIndexes = new Set(PROMOTED_WAVES.map((wave) => wave.waveIndex));
  const remainingUnpromotedWaveIds = EXTERIOR_WAVE_PLAN
    .filter((wave) => !promotedWaveIndexes.has(wave.waveIndex))
    .map((wave) => wave.waveId);
  if (!remainingUnpromotedWaveIds.includes(EXTERIOR_WAVE_PLAN[NORTHERN_MANHATTAN_WAVE_INDEX].waveId)) {
    fail("this wave is missing from the unpromoted list; it is a canary and cannot be counted as promoted.");
  }

  const occupancy = variant.occupancyOf({
    maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
    promotedWaves,
    cellBuildingCounts: subset.ledger.cells.map((cell) => cell.buildingIds.length),
    remainingUnpromotedWaveIds,
    reservation,
    // How many waves the committed plan declares, so "this promotion completes the
    // ledger's coverage" is an arithmetic result rather than a sentence. It is the
    // plan's own length, never a literal six.
    declaredWaveCount: EXTERIOR_WAVE_PLAN.length,
  });
  const renderable = variant.renderable(subset.ledger.cells, occupancy.entryBudget);

  return {
    variant, workRoot, recordRoot, payloadRoot,
    renderableCellDigestSha256: sha256HexSync(stableSerialize(renderable.cells.map((cell) => cell.cellId))),
    manifest, manifestChecksum, capture, parentLedger, parentLedgerChecksumSha256, subset,
    predecessorInventory, predecessorInventoryChecksumSha256, predecessor, reservation,
    occupancy,
    renderable,
  };
}

async function readVerifiedShards(manifest) {
  const declared = manifest.geometryShards.filter((shard) => shard.layer === "buildings");
  const encoder = new TextEncoder();
  const shards = [];
  for (const shard of declared) {
    const text = await readVerifiedText(join(snapshotRoot, shard.relativeContentRef), `citywide shard ${shard.shardId}`);
    if (encoder.encode(text).byteLength !== shard.byteSize) fail(`shard ${shard.shardId} byte size drifted.`);
    if (sha256HexSync(text) !== shard.checksumSha256) fail(`shard ${shard.shardId} checksum drifted.`);
    shards.push(readJsonText(text, `citywide shard ${shard.shardId}`));
  }
  return { shards, declaredShardCount: declared.length };
}

function inputFingerprint(context, stage) {
  return midtownCoreV3StageFingerprint({
    stage,
    baseManifestChecksumSha256: context.manifestChecksum,
    parentLedgerChecksumSha256: context.parentLedgerChecksumSha256,
    subsetLedgerChecksumSha256: exteriorWaveArtifactChecksum(context.subset.ledger),
    predecessorInventoryChecksumSha256: context.predecessorInventoryChecksumSha256,
    renderableCellCount: context.renderable.cells.length,
    // WHICH cells, not merely how many, for a CURATED subset. An order-derived
    // subset is a walk of the ledger order under an entry budget, so it moves
    // whenever `subsetLedgerChecksumSha256` does; a curated list would be a
    // constant in this repository, and editing it to a different set of the same
    // length would otherwise leave every stage `skipped: true` on the previous
    // curation's bytes. The digest is over the RESOLVED cell ids, so it also
    // covers an occupancy change that re-cut the subset.
    ...(context.variant.curation ? { renderableCellDigestSha256: context.renderableCellDigestSha256 } : {}),
    shippedLodId: MIDTOWN_CORE_SHIPPED_LOD_ID,
    profile: context.variant.waveProfile,
  });
}

async function readReceipt(context, stage) {
  const path = join(context.workRoot, "stages", `${stage}.json`);
  if (!existsSync(path)) return null;
  return readJsonText(await readFile(path, "utf8"), `${stage} receipt`);
}

async function writeReceipt(context, stage, fingerprint, summary) {
  const path = join(context.workRoot, "stages", `${stage}.json`);
  await mkdir(dirname(path), { recursive: true });
  const receipt = { schemaVersion: "1.0", stage, releaseId: context.variant.releaseId, inputFingerprint: fingerprint, summary };
  await writeFile(path, serializeExteriorWaveArtifact(receipt), "utf8");
  return receipt;
}

/**
 * Reads a stage receipt and refuses a missing or STALE one.
 *
 * Stale matters as much as missing. A receipt written against different inputs
 * describes different bytes, and copying its numbers into a committed record would
 * publish a census of a build that no longer exists. Both cases name the command
 * that fixes them rather than leaving a reader to work it out.
 */
async function requireFreshReceipt(context, stage, purpose) {
  const receipt = await readReceipt(context, stage);
  const suffix = context.variant.variantId === "canary" ? "" : ` --release ${context.variant.variantId}`;
  if (!receipt) {
    fail(`the ${stage} stage has not run for the ${context.variant.variantId} variant, so ${purpose} would be emitted as null — which reads as "not applicable" rather than "never run". Run \`${stage}${suffix}\` first.`);
  }
  if (receipt.inputFingerprint !== inputFingerprint(context, stage)) {
    fail(`the ${stage} receipt for the ${context.variant.variantId} variant was written against different inputs than this run, so ${purpose} does not describe these bytes. Re-run \`${stage}${suffix} --force\`.`);
  }
  return receipt;
}

async function writeRecord(context, name, value) {
  await mkdir(context.recordRoot, { recursive: true });
  const text = serializeExteriorWaveArtifact(value);
  await writeFile(join(context.recordRoot, name), text, "utf8");
  return sha256HexSync(text);
}

// ---------------------------------------------------------------------------
// Stage: plans
// ---------------------------------------------------------------------------

async function stagePlans(context, options) {
  const fingerprint = inputFingerprint(context, "plans");
  const existing = await readReceipt(context, "plans");
  if (existing && existing.inputFingerprint === fingerprint && !options.force) return { skipped: true, ...existing.summary };

  const { shards, declaredShardCount } = await readVerifiedShards(context.manifest);
  const sources = collectMidtownCoreSources(shards, new Set(context.subset.buildingIds));

  const planHashes = new Set();
  const refusals = [];
  const perCell = [];
  const styleClassCounts = {};
  const refusalsByCode = {};
  let planned = 0;
  let fallbackHeights = 0;
  let tierCollapse = 0;
  let reversedRings = 0;
  let maximumRingVertexCount = 0;
  let maximumFloorCount = 0;
  for (const cell of context.subset.ledger.cells) {
    let cellPlanned = 0;
    let cellRefused = 0;
    for (const buildingId of cell.buildingIds) {
      const source = sources.get(buildingId);
      if (!source) {
        refusals.push({ buildingId, cellId: cell.cellId, code: "absent-from-base-shards", detail: "No accepted footprint resolves for this owned building." });
        refusalsByCode["absent-from-base-shards"] = (refusalsByCode["absent-from-base-shards"] ?? 0) + 1;
        cellRefused += 1;
        continue;
      }
      try {
        const built = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, NORTHERN_MANHATTAN_CENSUS_PROFILE);
        planHashes.add(built.plan.planHashSha256);
        if (built.heightSource === "fallback") fallbackHeights += 1;
        if (built.reversed) reversedRings += 1;
        if (built.plan.massing.effectiveTierCount <= 1) tierCollapse += 1;
        maximumRingVertexCount = Math.max(maximumRingVertexCount, built.ringMm.length);
        maximumFloorCount = Math.max(maximumFloorCount, built.plan.massing.floorCount);
        styleClassCounts[built.plan.styleClass] = (styleClassCounts[built.plan.styleClass] ?? 0) + 1;
        planned += 1; cellPlanned += 1;
      } catch (error) {
        if (!(error instanceof MidtownCoreV3Stop)) throw error;
        refusals.push({ buildingId, cellId: cell.cellId, code: error.code, detail: error.message });
        refusalsByCode[error.code] = (refusalsByCode[error.code] ?? 0) + 1;
        cellRefused += 1;
      }
    }
    perCell.push({ cellId: cell.cellId, order: cell.order, owned: cell.buildingIds.length, planned: cellPlanned, refused: cellRefused });
  }

  // The SKYLINE CENSUS, for a variant whose subset was curated on visible height.
  //
  // It profiles every candidate cell in the stated envelope, not only the one that
  // was chosen — and for this wave the stated envelope is the WHOLE WAVE, so the
  // candidate set is all 182 owned cells. Heights are the SOURCED `heightMeters` of
  // the pinned citywide base; a building whose source carries no height contributes
  // to `owned` and to nothing else, which is why the two counts are reported
  // separately rather than being reconciled into a single number that hides the
  // unknowns.
  //
  // SEVEN THRESHOLDS ARE RECORDED, not the five wave `w04` recorded, and the two
  // extra ones are the low end. This wave's ranking DOES depend on the threshold,
  // so the census has to carry enough of the curve for the optimum suite to say
  // which cell every threshold would have selected rather than only that the
  // chosen one wins at the chosen bar.
  const skyline = [];
  if (context.variant.skylineEnvelope) {
    const envelope = context.variant.skylineEnvelope;
    for (const cell of context.subset.ledger.cells) {
      const inside = cell.bounds.west >= envelope.west && cell.bounds.east <= envelope.east
        && cell.bounds.south >= envelope.south && cell.bounds.north <= envelope.north;
      if (!inside) continue;
      const heights = cell.buildingIds
        .map((buildingId) => sources.get(buildingId)?.heightMeters)
        .filter((height) => typeof height === "number")
        .sort((left, right) => right - left);
      skyline.push({
        cellId: cell.cellId,
        parentOrder: Number(/-w05-(\d{6})-/u.exec(cell.cellId)[1]),
        bounds: { ...cell.bounds },
        ownedBuildingCount: cell.buildingIds.length,
        sourcedHeightCount: heights.length,
        skylineBuildingCount: heights.filter((height) => height >= NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS).length,
        skylineBuildingCountByThresholdMeters: Object.fromEntries(
          NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS.map((threshold) => [threshold, heights.filter((height) => height >= threshold).length]),
        ),
        tallestSourcedHeightMeters: heights[0] ?? null,
        topSourcedHeightMeters: heights.slice(0, 5),
      });
    }
    if (skyline.length === 0) fail("the stated skyline envelope contains no owned cell; the curation was written against a different ledger.");
    skyline.sort((left, right) => left.parentOrder - right.parentOrder);
  }

  const summary = {
    declaredShardCount,
    ownedBuildingCount: context.subset.buildingIds.length,
    resolvedBuildingCount: sources.size,
    plannedBuildingCount: planned,
    refusedBuildingCount: refusals.length,
    refusalRatio: refusals.length / context.subset.buildingIds.length,
    refusalsByCode,
    tierCollapseAbsentSetbackCount: tierCollapse,
    uniquePlanHashCount: planHashes.size,
    fallbackHeightCount: fallbackHeights,
    reversedRingCount: reversedRings,
    maximumRingVertexCount,
    maximumFloorCount,
    styleClassCounts,
    ...(context.variant.skylineEnvelope
      ? {
        skylineEnvelope: { ...context.variant.skylineEnvelope },
        skylineThresholdMeters: NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS,
        skylineThresholdsMeters: [...NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS],
        skyline,
      }
      : {}),
  };
  if (summary.ownedBuildingCount !== NORTHERN_MANHATTAN_BUILDING_COUNT) fail(`the subset owns ${summary.ownedBuildingCount} buildings, not ${NORTHERN_MANHATTAN_BUILDING_COUNT}.`);
  if (summary.uniquePlanHashCount !== planned) fail(`plan hashes are not unique: ${summary.uniquePlanHashCount} of ${planned}.`);

  await mkdir(context.workRoot, { recursive: true });
  await writeFile(join(context.workRoot, "plan-census.json"), serializeExteriorWaveArtifact({ ...summary, perCell, refusals }), "utf8");
  await writeReceipt(context, "plans", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: glbs
// ---------------------------------------------------------------------------

/**
 * Only the running variant's OWN payload directory is writable.
 *
 * The check compares against `context.variant.releaseId` rather than against a set
 * of known names, so no run of this pipeline can write into another wave's frozen
 * payload.
 */
function assertOwnedPayloadDirectory(context) {
  const directory = context.payloadRoot;
  if (basename(directory) !== context.variant.releaseId) {
    fail(`refusing to write ${directory}: only a directory named ${context.variant.releaseId} is writable by the ${context.variant.variantId} variant.`);
  }
}

async function existingFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(directory, join(entry.parentPath ?? entry.path, entry.name)).split("\\").join("/"));
}

async function stageGlbs(context, options) {
  const fingerprint = inputFingerprint(context, "glbs");
  const existing = await readReceipt(context, "glbs");
  if (existing && existing.inputFingerprint === fingerprint && !options.force && existsSync(join(context.payloadRoot, "public", "assets"))) {
    return { skipped: true, ...existing.summary };
  }
  assertOwnedPayloadDirectory(context);

  const { shards } = await readVerifiedShards(context.manifest);
  const sources = collectMidtownCoreSources(shards, new Set(context.subset.buildingIds));

  // Full-wave asset census, UNTEXTURED. The census answers a question about
  // GEOMETRY — which sourced polygons this grammar can carry — and tiles touch no
  // plan field, so the census profile shares this wave's seed, tool and generated
  // instant and therefore every plan hash with the shipped profile.
  const startedAt = Date.now();
  const full = materializeMidtownCoreV3Cells({
    cells: context.subset.ledger.cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    retain: "census-only",
    profile: NORTHERN_MANHATTAN_CENSUS_PROFILE,
  });
  const censusMilliseconds = Date.now() - startedAt;

  const cells = context.renderable.cells;
  const shipped = materializeMidtownCoreV3Cells({
    cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    profile: context.variant.waveProfile,
  });
  for (const [relativeRef, bytes] of [...shipped.assetBytes].sort(([left], [right]) => (left < right ? -1 : 1))) {
    if (!relativeRef.startsWith("public/")) fail(`refusing to emit a non-public asset path: ${relativeRef}`);
    const target = join(context.payloadRoot, relativeRef);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const summary = {
    censusMilliseconds,
    wave: full.census,
    renderableCellIds: cells.map((cell) => cell.cellId),
    shipped: shipped.census,
    shippedAssetCount: shipped.assetBytes.size,
    shippedAbsentSetbackBuildingIds: [...shipped.absentSetbacks.keys()].sort(),
    shippedRefusedBuildingIds: [...shipped.refusals.keys()].sort(),
  };
  if (full.census.maximumTriangleCount > V3T_QUALITY_BUDGETS.maxTriangles) fail(`a generated LOD declares ${full.census.maximumTriangleCount} triangles, above the ${V3T_QUALITY_BUDGETS.maxTriangles} budget.`);
  if (full.census.generatedAssetCount !== full.census.materializedBuildingCount * 2) fail("the asset census does not carry two LODs per materialized building.");
  // Tiles ride on LOD 0 alone, so a textured pass must never exceed one tile set
  // per asset nor put a tile on the coarse level.
  if (shipped.census.maximumTextureCount > V3T_QUALITY_BUDGETS.maxTextures) fail(`a shipped LOD declares ${shipped.census.maximumTextureCount} textures, above the ${V3T_QUALITY_BUDGETS.maxTextures} budget.`);
  if (full.census.maximumTextureCount !== 0) fail("the untextured wave census emitted a texture.");

  await mkdir(context.workRoot, { recursive: true });
  await writeFile(join(context.workRoot, "asset-census.json"), serializeExteriorWaveArtifact({
    ...summary,
    waveRefusalsByCode: full.census.refusalsByCode,
    waveRefusals: [...full.refusalCodes]
      .map(([buildingId, code]) => ({ buildingId, code, reason: full.refusals.get(buildingId) }))
      .sort((left, right) => (left.buildingId < right.buildingId ? -1 : 1)),
    waveAbsentSetbackCount: full.absentSetbacks.size,
    registrationWorst: {
      perVertexShapeMeters: full.census.worstPerVertexShapeDeviationMeters,
      horizontalMeters: full.census.worstHorizontalDeviationMeters,
      verticalMeters: full.census.worstVerticalDeviationMeters,
      volumeDeviation: full.census.worstVolumeDeviation,
    },
  }), "utf8");
  await writeReceipt(context, "glbs", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: gates
// ---------------------------------------------------------------------------

async function stageGates(context, options) {
  const fingerprint = inputFingerprint(context, "gates");
  const existing = await readReceipt(context, "gates");
  if (existing && existing.inputFingerprint === fingerprint && !options.force) return { skipped: true, ...existing.summary };

  const ownership = validateNorthernManhattanSubsetLedger(context.subset.ledger);
  if (!ownership.ok) fail(`subset ledger fails the accepted ownership checks: ${stableSerialize(ownership.issues.slice(0, 5))}`);

  const digest = readJsonText(await readVerifiedText(join(ledgerRoot, "membership-digest.json"), "committed membership digest"), "membership digest");
  const reconciliation = reconcileNorthernManhattanAgainstDigest(context.subset, digest);
  if (!reconciliation.ok) fail(`digest reconciliation failed: ${stableSerialize(reconciliation.findings.slice(0, 5))}`);

  // Same rule as the graph stage's: missing OR stale both fail closed. A gates
  // summary computed from a receipt written against different inputs would state a
  // refusal ratio and an asset count for bytes this run did not produce.
  const glbs = await requireFreshReceipt(context, "glbs", "the wave statement");

  const summary = {
    ownershipOk: ownership.ok,
    reconciliation: reconciliation.counts,
    reconciliationOk: reconciliation.ok,
    maximumCellBuildings: context.subset.derivation.subset.maxObservedCellBuildings,
    exclusionCellCount: context.subset.derivation.exclusions.length,
    exclusionOverlapTotal: context.subset.derivation.exclusions.reduce((total, entry) => total + entry.overlapWithSubset, 0),
    predecessorReleaseId: context.predecessor.releaseId,
    predecessorPublicRootChecksumSha256: context.predecessor.publicRoot.rootChecksumSha256,
    predecessorSnapshotChecksumSha256: context.predecessor.snapshot.checksumSha256,
    predecessorCellReleaseCount: context.predecessor.cellReleases.size,
    occupancy: context.occupancy,
    renderable: {
      cellIds: context.renderable.cells.map((cell) => cell.cellId),
      ownedBuildingCount: context.renderable.ownedBuildingCount,
      spareEntries: context.renderable.spareEntries,
      stoppedAt: context.renderable.stoppedAt ?? null,
      shippedAssetCount: glbs.summary.shippedAssetCount ?? null,
    },
    tombstonedCellCount: context.subset.ledger.cells.length - context.renderable.cells.length,
    budgets: { ...V3T_QUALITY_BUDGETS },
    textureCatalog: proceduralTextureProvenance(),
    waveMaximumTriangleCount: glbs.summary.wave?.maximumTriangleCount ?? null,
    waveMaximumMaterialCount: glbs.summary.wave?.maximumMaterialCount ?? null,
    waveRefusalRatio: (glbs.summary.wave?.refusedBuildingCount ?? 0) / NORTHERN_MANHATTAN_BUILDING_COUNT,
  };
  // A first-generation wave owns no predecessor asset, so there is no availability
  // delta to derive; what must hold is that the renderable subset fits the entry
  // budget it was derived from.
  if ((glbs.summary.shippedAssetCount ?? 0) > context.occupancy.entryBudget) {
    fail(`the renderable subset ships ${glbs.summary.shippedAssetCount} assets, above the ${context.occupancy.entryBudget}-entry budget.`);
  }
  // The wave-scale refusal ceiling this task was given. It is a STOP, not a
  // tolerance to be moved: a wave that refuses more than one building in seven is
  // not a wave whose geometry this grammar can carry.
  if (summary.waveRefusalRatio > 0.15) {
    fail(`the wave refuses ${(summary.waveRefusalRatio * 100).toFixed(2)}% of its buildings, above the 15% ceiling. No tolerance may be moved to pass this.`);
  }
  // Carried forward UNUSED by the canary; T022's curated successor recomputes its
  // local refusal census and its own volume-identity margin here.
  if (context.variant.curation) {
    const shipped = glbs.summary.shipped ?? {};
    summary.curation = {
      basis: context.variant.curation.basis,
      statement: context.variant.curation.statement,
      cells: context.variant.curation.cells.map((record) => ({ ...record })),
      refusal: context.variant.curation.refusalCensus({
        ownedBuildingCount: context.renderable.ownedBuildingCount,
        materializedBuildingCount: shipped.materializedBuildingCount ?? 0,
        refusedBuildingCount: shipped.refusedBuildingCount ?? 0,
      }),
      // SAME DENOMINATOR FIX AS THE WAVE CENSUS, applied here so T022's curated
      // successor cannot inherit the wrong one. `materializedBuildingCount` counts
      // the buildings that PASSED this check; the buildings it rejected are not
      // among them, so `buildingsChecked` is accepted + rejected.
      volumeMargin: context.variant.curation.volumeMargin({
        buildingsChecked: (shipped.materializedBuildingCount ?? 0) + (shipped.refusalsByCode?.["volume-identity-failed"] ?? 0),
        buildingsRejected: shipped.refusalsByCode?.["volume-identity-failed"] ?? 0,
        worstVolumeDeviation: shipped.worstVolumeDeviation ?? Number.POSITIVE_INFINITY,
        tolerance: MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
      }),
    };
    if (summary.curation.refusal.ok !== true) {
      fail(`the curated subset's local refusal rate is above the ceiling its curation sets. No tolerance was moved to improve it.`);
    }
    if (summary.curation.volumeMargin.ok !== true) {
      fail(`the curated subset's mesh-versus-analytic volume identity did not hold: ${summary.curation.volumeMargin.buildingsRejected} rejected at a worst margin of ${summary.curation.volumeMargin.worstDeviationAsFractionOfTolerance} of tolerance. No tolerance was moved.`);
    }
  }
  await writeReceipt(context, "gates", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Committed census note, DERIVED from what was measured
// ---------------------------------------------------------------------------

/**
 * Builds the wave census note from the numbers this run actually produced.
 *
 * The three earlier waves' notes were prose written after the run and then pinned
 * by test, which is how ADR 0035 ended up asserting something about equal totals
 * that ADR 0036 had to retract. This one is a FUNCTION of the measurements, so the
 * sentence about the two refusal distributions says "equal" only when they are
 * equal, and the sentence about the volume margin reports the margin that was
 * observed rather than the one the previous wave observed.
 */
/**
 * The volume-identity statement, also derived from what was measured.
 *
 * The predecessor wave's statement was prose that assumed zero rejections, which
 * was true of that wave and is not true of this one. A statement that describes a
 * different run than the numbers beside it is exactly the kind of stale claim this
 * record exists to prevent, so it is generated.
 */
function volumeIdentityStatement(input) {
  const accepted = input.buildingsRejected === 0
    ? `It rejected NONE of them, so every building whose plan the grammar accepted also carried a mesh volume that agreed with its analytic volume inside the tolerance.`
    : `It ACCEPTED ${input.buildingsAccepted.toLocaleString("en-US")} and REJECTED ${input.buildingsRejected.toLocaleString("en-US")}, which is why those ${input.buildingsRejected.toLocaleString("en-US")} ship as unavailable with a stated reason instead of as geometry; the deviation recorded below is the worst among the buildings it ACCEPTED, not among the ones it refused.`;
  const margin = input.fraction > 0.9
    ? `THE MARGIN IS NARROW AND IS REPORTED RATHER THAN ROUNDED AWAY: the worst accepted case sits at ${input.fraction.toFixed(4)} of the tolerance, more than nine tenths of it. "Inside tolerance" is therefore true and is not the same as "comfortably inside", and a reader deciding whether this wave's geometry is sound should read \`worstDeviationAsFractionOfTolerance\` and not only \`buildingsRejected\`.`
    : `The worst accepted case sits at ${input.fraction.toFixed(4)} of the tolerance.`;
  return `Every building whose plan the grammar accepted had its generated mesh volume compared against the analytic volume that plan declares. READ THE DENOMINATOR: the check ran on ${input.buildingsChecked.toLocaleString("en-US")} buildings, which is the ${input.buildingsAccepted.toLocaleString("en-US")} that went on to materialize PLUS the ${input.buildingsRejected.toLocaleString("en-US")} this check itself refused. A building it rejects never becomes a materialized building, so \`materializedBuildingCount\` is the count of buildings that PASSED and is the wrong denominator for a rate — an earlier draft of this record used it and produced the contradiction "ran on N, rejected 16 of them" where the 16 were not in N. ${accepted} ${margin} The worst deviation is recorded beside the tolerance it was compared against, so a run in which the check silently did not execute is distinguishable from a run in which it executed. No tolerance was moved; the recorded value is the accepted MIDTOWN_CORE_V3_VOLUME_TOLERANCE unchanged.`;
}

function waveCensusNote(input) {
  const planTotal = Object.values(input.planRefusalsByCode).reduce((total, count) => total + count, 0);
  const assetTotal = input.assetRefusedBuildingCount;
  const writerRejected = input.volumeIdentityRejected;
  const distributions = assetTotal === planTotal
    ? `TWO REFUSAL DISTRIBUTIONS ARE RECORDED AND FOR THIS WAVE THEY ARE EQUAL, at ${planTotal.toLocaleString("en-US")} refusals each.`
    : `TWO REFUSAL DISTRIBUTIONS ARE RECORDED AND FOR THIS WAVE THEY DIFFER: ${planTotal.toLocaleString("en-US")} at the plan stage and ${assetTotal.toLocaleString("en-US")} at the asset stage, a difference of ${(assetTotal - planTotal).toLocaleString("en-US")}, all of it \`volume-identity-failed\`.`;
  const marginFraction = input.worstVolumeDeviation / input.tolerance;
  const margin = marginFraction > 0.9
    ? `THE VOLUME MARGIN IS NARROW AND IS REPORTED RATHER THAN ROUNDED AWAY: the worst deviation across this wave sits at ${marginFraction.toFixed(4)} of the tolerance, more than nine tenths of it.`
    : `THE VOLUME MARGIN IS REPORTED AS MEASURED: the worst deviation across this wave sits at ${marginFraction.toFixed(4)} of the tolerance.`;
  return `Wave-scale V3 stop-code census over all ${input.ownedBuildingCount.toLocaleString("en-US")} owned buildings of wave w05 — the LAST wave the committed ledger declares — plus the shipped-subset census over the renderable cells. Committed so the refusal distribution stays checkable without the untracked work root. The wave census is untextured by design; the shipped subset carries procedural-texture-v1 tiles on LOD 0. READ \`wave.retention\` BEFORE \`wave.shippedAssetCount\`: the wave pass runs \`census-only\`, so it generated, gated and measured every asset and then dropped the bytes rather than keeping them. Its \`shippedAssetBytes\` is therefore a real measurement while its \`shippedAssetCount\` is zero, which is a retention mode and not a contradiction. The \`shipped\` object below is the pass that retained bytes. ${distributions} \`waveRefusals\` is the PLAN stage: the grammar reading a sourced polygon and reporting which property of it it cannot carry. \`wave.refusalsByCode\` is the ASSET stage: the same plans plus the writer's own mesh-versus-analytic volume identity check, which can only fail after a plan has been accepted and geometry has been generated. The asset distribution is therefore always a superset of the plan distribution and the only key that can appear in it alone is \`volume-identity-failed\`. NEITHER EQUALITY NOR INEQUALITY OF THE TWO TOTALS IS EVIDENCE THAT THE WRITER'S CHECK RAN, and this note does not treat it as such: ADR 0035 inferred one thing from equal totals and ADR 0036 had to retract it. The check is recorded as a MEASUREMENT instead — \`volumeIdentity\` below carries the count checked (${input.volumeIdentityChecked.toLocaleString("en-US")}), the count accepted (${input.volumeIdentityAccepted.toLocaleString("en-US")}), the count rejected (${writerRejected.toLocaleString("en-US")}), the worst deviation observed across the whole wave and the tolerance it was compared against. THE COUNT CHECKED IS ACCEPTED PLUS REJECTED, NOT \`wave.materializedBuildingCount\`: a building this check rejects never materializes, so the materialized count is the count that PASSED and using it as the denominator would say the check ran on a set that excludes the buildings it refused — so a run in which the check silently did not execute is distinguishable from a run in which it executed and passed. ${margin} This note is GENERATED from those measurements rather than written beside them, so it cannot keep asserting a previous wave's finding.`;
}

// ---------------------------------------------------------------------------
// Stage: graph
// ---------------------------------------------------------------------------

async function stageGraph(context, options) {
  const fingerprint = inputFingerprint(context, "graph");
  const existing = await readReceipt(context, "graph");
  if (existing && existing.inputFingerprint === fingerprint && !options.force && existsSync(join(context.payloadRoot, "release-graph.json"))) {
    return { skipped: true, ...existing.summary };
  }
  assertOwnedPayloadDirectory(context);

  const { shards } = await readVerifiedShards(context.manifest);
  const cells = context.renderable.cells;
  const sources = collectMidtownCoreSources(shards, new Set(cells.flatMap((cell) => cell.buildingIds)));
  const shipped = materializeMidtownCoreV3Cells({
    cells,
    sources,
    baseManifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
    capture: context.capture,
    profile: context.variant.waveProfile,
  });
  const release = buildMidtownCoreRelease({
    subset: context.subset,
    renderableCellIds: cells.map((cell) => cell.cellId),
    materialized: shipped.buildings,
    refusals: shipped.refusals,
    capture: context.capture,
    profile: context.variant.releaseProfile(context.predecessor),
    // Exactly the tiles the emitted GLBs reference by URI, collected from the
    // bytes this pass just wrote. Empty for every embedded wave, so those
    // packages declare and emit nothing new.
    sharedTextureClasses: shipped.sharedTextureClasses,
  });

  const payload = new Map([...release.files, ...shipped.assetBytes]);
  const stale = (await existingFiles(context.payloadRoot)).filter((path) => !payload.has(path));
  for (const path of stale) await rm(join(context.payloadRoot, path));
  for (const [path, bytes] of [...payload].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const target = join(context.payloadRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const emitted = new Map();
  for (const path of await existingFiles(context.payloadRoot)) emitted.set(path, new Uint8Array(await readFile(join(context.payloadRoot, path))));
  const declaredBlobs = new Map();
  for (const root of release.graph.roots) for (const artifact of root.artifacts) {
    const bytes = root.audience === "private" ? release.rootArtifactBytes.get(artifact.relativeRef) : emitted.get(artifact.relativeRef);
    if (!bytes) fail(`declared artifact ${artifact.relativeRef} has no bytes to replay.`);
    declaredBlobs.set(artifact.relativeRef, bytes);
  }
  const integrity = await replayExteriorArtifactIntegrity(release.graph, declaredBlobs);
  if (!integrity.ok) fail(`artifact integrity replay failed: ${stableSerialize(integrity.issues.slice(0, 5))}`);

  const assemblyContents = new Map();
  for (const artifact of release.assemblies[0].artifacts) {
    const bytes = emitted.get(artifact.relativeRef);
    if (!bytes) fail(`assembly artifact ${artifact.relativeRef} is absent from the emitted payload.`);
    assemblyContents.set(artifact.relativeRef, bytes);
  }
  // The assembly replay is given this release's OWN admission, taken from the
  // emitted public root rather than from a constant, so the replay is gated by
  // exactly what the release declares.
  const publicRoot = release.graph.roots.find((root) => root.audience === "public");
  const admission = publicRoot.textureAdmission;
  if (admission?.policy !== "procedural-replay") fail("the emitted public root does not declare the procedural-replay admission this wave's textured assets require.");
  const assemblyReplay = await replayMultiLodAssembly(release.assemblies[0], assemblyContents, {
    textureAdmission: admission.policy,
    declaredSamplerFilter: { ...admission.generatedTextureFact.samplerFilter },
  });
  if (!assemblyReplay.ok) fail(`assembly replay failed: ${stableSerialize(assemblyReplay.issues.slice(0, 5))}`);

  const privateLeaks = [...emitted.keys()].filter((path) => path.startsWith("private/") || path.toLowerCase().includes("/private"));
  if (privateLeaks.length > 0) fail(`private-audience bytes reached the browser-reachable root: ${privateLeaks.join(", ")}`);

  // A curated variant may not reach the committed record without its gates
  // receipt, or its refusal census would be emitted as `null` — which reads as
  // "not applicable" rather than as "never checked". `stageGates` hard-fails on a
  // missing `glbs` receipt but nothing makes `graph` require `gates`, so this is
  // the fail-closed edge. Inert for the canary, which carries no curation at all.
  let curationRefusal = null;
  let curationVolumeMargin = null;
  if (context.variant.curation) {
    const gates = await requireFreshReceipt(context, "gates", "the curated subset's refusal census and volume-identity margin");
    curationRefusal = gates.summary?.curation?.refusal ?? null;
    curationVolumeMargin = gates.summary?.curation?.volumeMargin ?? null;
    if (curationRefusal === null || curationRefusal.ok !== true) {
      fail(`the gates receipt for the ${context.variant.variantId} variant carries no passing refusal census; the curated subset's precondition result cannot be emitted as null.`);
    }
    if (curationVolumeMargin === null || curationVolumeMargin.ok !== true) {
      fail(`the gates receipt for the ${context.variant.variantId} variant carries no passing volume-identity margin; it cannot be emitted as null.`);
    }
  }

  const files = [...emitted]
    .map(([path, bytes]) => ({ path, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(bytes) }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));
  const inventory = {
    schemaVersion: "1.0",
    releaseId: context.variant.releaseId,
    payloadDirectory: context.variant.outputDirectory,
    note: context.variant.inventoryNote,
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256: context.manifestChecksum },
    parentLedger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: context.parentLedgerChecksumSha256 },
    predecessor: {
      releaseId: context.predecessor.releaseId,
      inventoryChecksumSha256: context.predecessorInventoryChecksumSha256,
      publicRootChecksumSha256: context.predecessor.publicRoot.rootChecksumSha256,
      snapshotChecksumSha256: context.predecessor.snapshot.checksumSha256,
    },
    ownershipLedgerId: context.subset.ledger.ledgerId,
    textureAdmission: { policy: "procedural-replay", ...proceduralTextureProvenance(), samplerFilter: { ...context.variant.waveProfile.textureFilter } },
    occupancy: context.occupancy,
    renderableCellIds: cells.map((cell) => cell.cellId),
    /**
     * WHY THE WALK STOPPED, carried in the release's own committed record.
     *
     * An order-derived subset is a walk under a budget, and the chosen list alone
     * cannot say whether the budget ran out or the wave did. For this wave that
     * distinction is the whole story of its size, so the first cell the budget
     * could not admit is recorded beside the cells that were.
     *
     * A CURATED variant carries no walk at all, and the key is SPREAD IN rather
     * than emitted with a null `stoppedAt`: a curated list is not a walk, so a
     * record that described one would be answering a question nobody asked of it.
     * The curated subset's own spare-entry story lives in `curation.statement`,
     * which says why the remainder is unspent instead of where a walk halted.
     */
    ...(context.variant.curation
      ? {}
      : {
        renderableWalk: {
          entryBudget: context.occupancy.entryBudget,
          ownedBuildingCount: context.renderable.ownedBuildingCount,
          spareEntries: context.renderable.spareEntries,
          stoppedAt: context.renderable.stoppedAt,
        },
      }),
    // How the renderable subset was chosen, carried in the release's own committed
    // record rather than only in an ADR. The key is SPREAD IN, not set to `null`,
    // for a variant without a curation: a release that derived its subset from the
    // ledger order says so by carrying no curation record at all, and an extra
    // `"curation": null` would move a checksum a successor's predecessor pin is
    // taken over.
    ...(context.variant.curation
      ? {
        curation: {
          basis: context.variant.curation.basis,
          statement: context.variant.curation.statement,
          cells: context.variant.curation.cells.map((record) => ({ ...record })),
          refusal: curationRefusal,
          volumeMargin: curationVolumeMargin,
        },
      }
      : {}),
    roots: Object.fromEntries(release.graph.roots.map((root) => [root.audience, { rootId: root.rootId, rootChecksumSha256: root.rootChecksumSha256, artifactCount: root.artifacts.length }])),
    assemblyFingerprintSha256: assemblyReplay.value.fingerprintSha256,
    stats: release.stats,
    census: shipped.census,
    absentSetbackBuildingIds: [...shipped.absentSetbacks.keys()].sort(),
    refusedBuildingIds: [...shipped.refusals.keys()].sort(),
    totals: { fileCount: files.length, byteSize: files.reduce((total, file) => total + file.byteSize, 0) },
    files,
  };
  const inventoryChecksum = await writeRecord(context, "payload-inventory.json", inventory);
  const derivationChecksum = await writeRecord(context, "derivation.json", {
    schemaVersion: "1.0",
    derivation: context.subset.derivation,
    reconciliation: reconcileNorthernManhattanAgainstDigest(context.subset, readJsonText(await readVerifiedText(join(ledgerRoot, "membership-digest.json"), "committed membership digest"), "membership digest")),
  });
  // The wave census is the whole point of the committed record. Missing OR stale
  // both fail closed: `?? null` would emit `"wave": null` — a census that reads as
  // "not applicable" rather than "never run" — which is the H2 defect the T017
  // review found on this exact line and fixed with this exact helper.
  const waveCensus = await requireFreshReceipt(context, "glbs", "the wave-scale census");
  const planCensus = await requireFreshReceipt(context, "plans", "the plan-stage refusal distribution");
  // THE DENOMINATOR OF THE VOLUME CHECK IS NOT `materializedBuildingCount`.
  //
  // A building this check REJECTS never becomes a materialized building, so the
  // materialized count is the count of buildings that PASSED. Using it as
  // `buildingsChecked` made the committed statement contradict itself — "the check
  // ran on 9,849 buildings and rejected 16 of them", where the 16 were not among
  // the 9,849. The true denominator is accepted + rejected, and both halves are
  // emitted so the arithmetic is visible rather than implied.
  const volumeIdentityRejected = waveCensus.summary.wave.refusalsByCode["volume-identity-failed"] ?? 0;
  const volumeIdentityAccepted = waveCensus.summary.wave.materializedBuildingCount;
  const volumeIdentity = {
    stage: "asset-writer",
    stopCode: "volume-identity-failed",
    buildingsChecked: volumeIdentityAccepted + volumeIdentityRejected,
    buildingsAccepted: volumeIdentityAccepted,
    buildingsRejected: volumeIdentityRejected,
    worstVolumeDeviation: waveCensus.summary.wave.worstVolumeDeviation,
    tolerance: MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
    worstDeviationAsFractionOfTolerance: waveCensus.summary.wave.worstVolumeDeviation / MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
    statement: volumeIdentityStatement({
      buildingsChecked: volumeIdentityAccepted + volumeIdentityRejected,
      buildingsAccepted: volumeIdentityAccepted,
      buildingsRejected: volumeIdentityRejected,
      fraction: waveCensus.summary.wave.worstVolumeDeviation / MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
    }),
  };
  const censusChecksum = await writeRecord(context, "wave-census.json", {
    schemaVersion: "1.0",
    releaseId: context.variant.releaseId,
    note: waveCensusNote({
      ownedBuildingCount: NORTHERN_MANHATTAN_BUILDING_COUNT,
      planRefusalsByCode: planCensus.summary.refusalsByCode,
      assetRefusedBuildingCount: waveCensus.summary.wave.refusedBuildingCount,
      volumeIdentityChecked: volumeIdentity.buildingsChecked,
      volumeIdentityAccepted: volumeIdentity.buildingsAccepted,
      volumeIdentityRejected: volumeIdentity.buildingsRejected,
      worstVolumeDeviation: volumeIdentity.worstVolumeDeviation,
      tolerance: MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
    }),
    // The writer-stage check stated as a MEASUREMENT rather than left to be
    // inferred from two totals that happen to match, or to differ.
    volumeIdentity,
    textureCatalog: proceduralTextureProvenance(),
    samplerFilter: { ...context.variant.waveProfile.textureFilter },
    occupancy: context.occupancy,
    wave: waveCensus.summary.wave,
    waveRefusals: planCensus.summary.refusalsByCode,
    shipped: shipped.census,
    shippedRefusedBuildingIds: [...shipped.refusalCodes].map(([buildingId, code]) => ({ buildingId, code })).sort((left, right) => (left.buildingId < right.buildingId ? -1 : 1)),
    shippedAbsentSetbackBuildingIds: [...shipped.absentSetbacks.keys()].sort(),
    registration: shipped.registration.map((entry) => ({
      buildingId: entry.buildingId,
      sourceVertexCount: entry.sourceVertexCount,
      perVertexShapeDeviationMeters: entry.perVertexShapeDeviationMeters,
      horizontalDeviationMeters: entry.horizontalDeviationMeters,
      verticalDeviationMeters: entry.verticalDeviationMeters,
      ringOrientationReversed: entry.ringOrientationReversed,
    })).sort((left, right) => (left.buildingId < right.buildingId ? -1 : 1)),
  });

  // The skyline census, committed for a curated variant so the optimality claim is
  // re-enumerable from committed bytes. Same fail-closed rule as everything else
  // this stage writes: a missing or stale `plans` receipt refuses rather than
  // emitting `null`, which would read as "not applicable" instead of "never run".
  let skylineChecksum = null;
  if (context.variant.skylineEnvelope) {
    const plans = await requireFreshReceipt(context, "plans", "the skyline census the curation was chosen on");
    if (!Array.isArray(plans.summary?.skyline) || plans.summary.skyline.length === 0) {
      fail("the plans receipt carries no skyline census; the curated subset's optimality claim cannot be emitted as null.");
    }
    skylineChecksum = await writeRecord(context, "skyline-census.json", {
      schemaVersion: "1.0",
      releaseId: context.variant.releaseId,
      note: "Per-cell SOURCED height profile of EVERY wave-w05 ownership cell — the candidate set the promoted renderable subset was curated from, not only the cell that was chosen, and not a band drawn around it. The envelope recorded here is simply this wave's own bounding box. `skylineBuildingCount` counts owned buildings whose sourced heightMeters reaches the stated threshold; it is the primary key the curation's optimality claim is ranked on, and `northern-manhattan-curation-optimum.test.ts` re-runs that enumeration over these bytes on every run. `skylineBuildingCountByThresholdMeters` carries the same count at 30, 45, 60, 75, 90, 100 and 120 m — SEVEN thresholds rather than the five wave w04 recorded, and the two extra ones are the low end. THAT IS BECAUSE THIS WAVE'S ANSWER TO THE THRESHOLD QUESTION IS WEAKER THAN WAVE w04'S AND IS NOT BORROWED FROM IT. That wave could report that the same cell won at every threshold it tried; this one cannot, because northern Manhattan is genuinely lower-rise — 19 of 10,206 sourced heights reach 90 m against 141 of 11,703 there — and under the identical rule this wave would promote a DIFFERENT cell at 45, 60 and 75 m. The census carries enough of the curve for that sensitivity to be re-enumerated and pinned rather than described. The 90 m threshold itself was NOT moved after the answer was known: choosing a threshold for the cell it selects is the same defect as moving a tolerance to pass a gate. Heights are the pinned manhattan-citywide-20260804 base's own sourced values and assert nothing about any named building: the NYC OTI footprint dataset carries no building names. `sourcedHeightCount` is reported beside `ownedBuildingCount` rather than reconciled with it, because a building whose source states no height is a building this census cannot rank and must not silently drop.",
      base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256: context.manifestChecksum },
      parentLedger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: context.parentLedgerChecksumSha256 },
      envelope: { ...context.variant.skylineEnvelope },
      skylineThresholdMeters: NORTHERN_MANHATTAN_SKYLINE_HEIGHT_METERS,
      skylineThresholdsMeters: [...NORTHERN_MANHATTAN_SKYLINE_THRESHOLDS_METERS],
      entryBudget: context.occupancy.entryBudget,
      curatedCellIds: cells.map((cell) => cell.cellId),
      candidates: plans.summary.skyline,
    });
  }

  const summary = {
    ...release.stats,
    emittedFileCount: files.length,
    removedStaleCount: stale.length,
    payloadByteSize: inventory.totals.byteSize,
    publicRootChecksumSha256: release.graph.roots.find((root) => root.audience === "public").rootChecksumSha256,
    privateRootChecksumSha256: release.graph.roots.find((root) => root.audience === "private").rootChecksumSha256,
    declaredPrivateArtifacts: release.graph.roots.find((root) => root.audience === "private").artifacts.length,
    emittedPrivateFiles: privateLeaks.length,
    assemblyFingerprintSha256: assemblyReplay.value.fingerprintSha256,
    payloadInventoryChecksumSha256: inventoryChecksum,
    derivationRecordChecksumSha256: derivationChecksum,
    censusRecordChecksumSha256: censusChecksum,
    ...(skylineChecksum ? { skylineCensusChecksumSha256: skylineChecksum } : {}),
  };
  await writeReceipt(context, "graph", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------
// Stage: sample
// ---------------------------------------------------------------------------

const V3_SAMPLE_STRATA = [
  { id: "most-ring-vertices", order: (entry) => [-entry.ringVertexCount] },
  { id: "fewest-ring-vertices", order: (entry) => [entry.ringVertexCount] },
  { id: "tallest", order: (entry) => [-entry.heightMm] },
  { id: "shortest", order: (entry) => [entry.heightMm] },
  { id: "largest-footprint-area", order: (entry) => [-entry.footprintAreaMm2] },
  { id: "smallest-footprint-area", order: (entry) => [entry.footprintAreaMm2] },
  { id: "most-triangles", order: (entry) => [-entry.triangleCount] },
  { id: "fewest-triangles", order: (entry) => [entry.triangleCount] },
  { id: "fallback-height", order: (entry) => [entry.heightSource === "fallback" ? 0 : 1, entry.heightMm] },
  { id: "most-tiers", order: (entry) => [-entry.effectiveTierCount] },
  // The assets that carry the most distinct motifs are where a UV projection or a
  // tile binding would show a fault.
  { id: "most-textures", order: (entry) => [-entry.textureCount, -entry.triangleCount] },
];
const V3_SAMPLES_PER_STRATUM = 4;

function compareBy(order) {
  return (left, right) => {
    const a = order(left);
    const b = order(right);
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
    return left.buildingId < right.buildingId ? -1 : left.buildingId > right.buildingId ? 1 : 0;
  };
}

function ringAreaMm2(ring) {
  let twice = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    twice += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twice) / 2;
}

async function stageSample(context, options) {
  const fingerprint = inputFingerprint(context, "sample");
  const existing = await readReceipt(context, "sample");
  if (existing && existing.inputFingerprint === fingerprint && !options.force) return { skipped: true, ...existing.summary };

  const { shards } = await readVerifiedShards(context.manifest);
  const cells = context.renderable.cells;
  const sources = collectMidtownCoreSources(shards, new Set(cells.flatMap((cell) => cell.buildingIds)));

  const candidates = [];
  /**
   * Buildings the WRITER refused, counted rather than swallowed.
   *
   * THE PLAN STAGE IS NOT THE ONLY STAGE THAT REFUSES, AND THIS LOOP USED TO
   * ASSUME IT WAS. The three earlier waves' sample stages caught
   * `MidtownCoreV3Stop` around `buildMidtownCoreV3Plan` alone and called
   * `writeMidtownCoreV3Assets` unguarded, which was survivable only because no
   * building inside those waves' renderable cells ever failed the writer's
   * mesh-versus-analytic volume identity. Two do here, and the stage crashed with
   * an uncaught stop rather than sampling the wave.
   *
   * The fix is to refuse in the same way the materializer already refuses: a
   * writer-stage stop excludes the building from the candidate pool, because a
   * building with no shipped asset has no asset to inspect in Blender. It is
   * COUNTED and carried into the receipt so the exclusion is visible — a silent
   * `continue` here would make the sample quietly smaller than the shipped set for
   * a reason no record stated.
   */
  const writerRefusedBuildingIds = [];
  for (const cell of cells) {
    for (const buildingId of cell.buildingIds) {
      const source = sources.get(buildingId);
      if (!source) continue;
      let planContext;
      try { planContext = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, context.variant.waveProfile); }
      catch (error) { if (!(error instanceof MidtownCoreV3Stop)) throw error; continue; }
      let written;
      try {
        written = writeMidtownCoreV3Assets(planContext, {
          ownerCellId: cell.cellId,
          capturedAt: context.capture.capturedAt,
          updatedAt: context.capture.updatedAt,
          predecessor: null,
          profile: context.variant.waveProfile,
        });
      } catch (error) {
        if (!(error instanceof MidtownCoreV3Stop)) throw error;
        writerRefusedBuildingIds.push(buildingId);
        continue;
      }
      const shippedAsset = written.assets.find((asset) => asset.lodId === MIDTOWN_CORE_SHIPPED_LOD_ID);
      candidates.push({
        buildingId,
        cellId: cell.cellId,
        plan: planContext.plan,
        ringVertexCount: planContext.ringMm.length,
        heightMm: planContext.plan.input.geometry.heightMm,
        heightSource: planContext.heightSource,
        footprintAreaMm2: ringAreaMm2(planContext.plan.tiers[0].ring),
        effectiveTierCount: planContext.plan.massing.effectiveTierCount,
        setbacksAbsent: written.setbacksAbsent,
        triangleCount: shippedAsset.counts.triangleCount,
        materialCount: shippedAsset.counts.materialCount,
        textureCount: shippedAsset.counts.textureCount,
        analyticVolumeCubicMeters: shippedAsset.analyticVolumeCubicMeters,
        meshVolumeCubicMeters: shippedAsset.meshVolumeCubicMeters,
        boundsYUp: midtownCoreGlbBounds(shippedAsset.bytes),
        checksumSha256: shippedAsset.checksumSha256,
        relativeRef: shippedAsset.relativeRef,
      });
    }
  }

  const byId = new Map(candidates.map((entry) => [entry.buildingId, entry]));
  const chosen = new Map();
  const strata = [];
  for (const stratum of V3_SAMPLE_STRATA) {
    const ordered = [...candidates].sort(compareBy(stratum.order));
    const taken = [];
    for (const entry of ordered) {
      if (taken.length >= V3_SAMPLES_PER_STRATUM) break;
      if (chosen.has(entry.buildingId)) continue;
      chosen.set(entry.buildingId, stratum.id);
      taken.push(entry.buildingId);
    }
    strata.push({ stratum: stratum.id, buildingIds: taken });
  }
  // EVERY disclosed tier collapse in the renderable cells, not a sample of them.
  const collapse = candidates.filter((entry) => entry.setbacksAbsent).map((entry) => entry.buildingId).sort();
  for (const buildingId of collapse) if (!chosen.has(buildingId)) chosen.set(buildingId, "tier-collapse-absent-setbacks");
  strata.push({ stratum: "tier-collapse-absent-setbacks", buildingIds: collapse });

  const sampleIds = [...chosen.keys()].sort();
  const texturedSampleIds = sampleIds.filter((buildingId) => byId.get(buildingId).textureCount > 0);
  if (texturedSampleIds.length < 10) fail(`only ${texturedSampleIds.length} sampled assets carry tiles; a textured wave must re-import at least 10.`);

  const inputsRoot = join(context.workRoot, "blender", "inputs");
  await rm(inputsRoot, { recursive: true, force: true });
  await mkdir(inputsRoot, { recursive: true });
  for (const buildingId of sampleIds) {
    const entry = byId.get(buildingId);
    const slug = buildingId.replace(":", "-");
    await writeFile(join(inputsRoot, `${slug}.json`), serializeExteriorWaveArtifact({
      buildingId,
      cellId: entry.cellId,
      stratum: chosen.get(buildingId),
      assetPath: join(context.payloadRoot, entry.relativeRef),
      checksumSha256: entry.checksumSha256,
      planHashSha256: entry.plan.planHashSha256,
      declared: { triangleCount: entry.triangleCount, materialCount: entry.materialCount, textureCount: entry.textureCount },
      declaredBoundsYUp: entry.boundsYUp,
      analyticVolumeCubicMeters: entry.analyticVolumeCubicMeters,
      writerMeshVolumeCubicMeters: entry.meshVolumeCubicMeters,
      volumeTolerance: MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
      setbacksAbsent: entry.setbacksAbsent,
      effectiveTierCount: entry.effectiveTierCount,
      ringVertexCount: entry.ringVertexCount,
      heightMm: entry.heightMm,
      heightSource: entry.heightSource,
    }), "utf8");
  }

  const summary = {
    candidateCount: candidates.length,
    sampleCount: sampleIds.length,
    texturedSampleCount: texturedSampleIds.length,
    tierCollapseCount: collapse.length,
    // The two refusal stages, kept apart. `planRefusedBuildingCount` is derived by
    // subtraction so the three numbers always add up to what the cells own.
    ownedBuildingCount: cells.reduce((total, cell) => total + cell.buildingIds.length, 0),
    writerRefusedBuildingIds: [...writerRefusedBuildingIds].sort(),
    writerRefusedBuildingCount: writerRefusedBuildingIds.length,
    strata,
    sampleIds,
    inputsDirectory: join(context.variant.workRoot, "blender", "inputs"),
  };
  // The candidate pool must be exactly the shipped set: every building that is
  // neither plan-refused nor writer-refused has an asset on disk to inspect.
  if (summary.candidateCount + summary.writerRefusedBuildingCount > summary.ownedBuildingCount) {
    fail(`the sample counted ${summary.candidateCount} candidates and ${summary.writerRefusedBuildingCount} writer refusals against ${summary.ownedBuildingCount} owned buildings.`);
  }
  await writeFile(join(context.workRoot, "blender-sample.json"), serializeExteriorWaveArtifact(summary), "utf8");
  await writeReceipt(context, "sample", fingerprint, summary);
  return { skipped: false, ...summary };
}

// ---------------------------------------------------------------------------

const RUNNERS = { plans: stagePlans, glbs: stageGlbs, gates: stageGates, graph: stageGraph, sample: stageSample };

async function main() {
  // The stage is REQUIRED and every token is checked before anything runs. The
  // old parser defaulted a bare or flags-only invocation to `all`, so
  // `--help` STARTED the five-stage pipeline; see `wave-cli-arguments.mjs`.
  const parsed = requireWaveCliArguments(parseWaveCliArguments({
    script: SCRIPT_NAME,
    argv: process.argv.slice(2),
    stages: STAGES,
    variants: Object.keys(RELEASE_VARIANTS),
    defaultVariant: "canary",
    variantStages: Object.fromEntries(Object.entries(RELEASE_VARIANTS).map(([id, entry]) => [id, entry.stages])),
  }), { error: (message) => console.error(message), exit: (code) => process.exit(code) });
  const { stage, variantId, force } = parsed;
  const variant = RELEASE_VARIANTS[variantId];

  const context = await loadContext(variant);
  const report = {};
  for (const name of stage === "all" ? variant.stages : [stage]) {
    const startedAt = Date.now();
    report[name] = { ...(await RUNNERS[name](context, { force })), elapsedMilliseconds: Date.now() - startedAt };
  }
  console.log(JSON.stringify({
    ok: true,
    variant: variant.variantId,
    releaseId: variant.releaseId,
    predecessorReleaseId: variant.predecessorReleaseId,
    stages: report,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
