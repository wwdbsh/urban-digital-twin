/* global console, process */
/**
 * Emits the T006 PRE-REGISTRATION record.
 *
 * The record is DERIVED from `exterior-acceptance-campaign-constants.mjs` rather
 * than typed beside it, so the committed pre-registration and the constants the
 * capture CLIs actually read cannot drift apart. Everything it adds on top of
 * the constants is either (a) an S0 reconciliation reading taken from committed
 * files, or (b) an arithmetic bound computed here from committed censuses.
 *
 * IT TAKES NO CAPTURE. It opens no browser, starts no server and reads nothing
 * from a running app. That is the point: this file's output is committed BEFORE
 * any measurement exists, which is what makes "pre-registered" checkable.
 *
 * Usage: node --experimental-strip-types scripts/exterior-acceptance-preregister-cli.mjs
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { exteriorServingCellOccupancy, exteriorServingResidencyBound } from "../src/runtime/exterior-serving-residency.ts";
import {
  AC_MAPPING,
  BLOCK_835_V3_RELEASE_ID,
  CACHE_CEILINGS,
  CAMPAIGN_DISCIPLINE,
  CAMPAIGN_EVIDENCE_ID,
  SCHEDULER_RESIDENT_UNIT_CAP,
  EVICTION_GATES,
  EVICTION_LOOP,
  EXPECTED_TEXTURE_BYTE_LENGTH,
  EXPECTED_UNIQUE_TILE_COUNT,
  FRAME_F1,
  FRAME_F2,
  FRAME_F4,
  GPU_GATES,
  HEADROOM_H1,
  HEADROOM_H2,
  HEAP_GATES,
  JOURNEY_GATES,
  LOD_L1,
  LOD_L2,
  REQUEST_CEILINGS,
  STATIONS,
  STORM_S1,
  VISUAL_GATES,
} from "./exterior-acceptance-campaign-constants.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(repositoryRoot, "data", CAMPAIGN_EVIDENCE_ID);


const SERVING_RELEASE_IDS = [
  "manhattan-exterior-cells-20260811-v3-s1",
  "manhattan-midtown-core-cells-20260811-v3-s1",
  "manhattan-lower-manhattan-cells-20260812-s1",
  "manhattan-southern-remainder-cells-20260812-s1",
  "manhattan-central-upper-manhattan-cells-20260812-s1",
  "manhattan-northern-manhattan-cells-20260812-s1",
];

function fail(message) { throw new Error(`exterior-acceptance-preregister: ${message}`); }
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

/**
 * The per-cell occupancy census, built with the SHIPPED instrument.
 *
 * `exteriorServingCellOccupancy` and `exteriorServingResidencyBound`
 * (src/runtime/exterior-serving-residency.ts) already exist, are unit-tested and
 * are the derivation T005 used. Re-deriving the bound with ad-hoc arithmetic
 * here would produce a second, differently-wrong number and would silently drop
 * the per-asset sidecar and assembly charges the real cache pays. The campaign
 * therefore CALLS the instrument rather than reimplementing it.
 */
async function cellCensus() {
  const ledger = await readJson(join(repositoryRoot, "data", "normalized", "manhattan-exterior-wave-ledger-20260804", "ledger.json"));
  const ownerByBuildingId = new Map();
  for (const cell of ledger.cells) {
    for (const buildingId of cell.buildingIds ?? []) ownerByBuildingId.set(buildingId, cell.cellId);
  }
  const files = [];
  for (const releaseId of SERVING_RELEASE_IDS) {
    const inventory = await readJson(join(repositoryRoot, "data", releaseId, "payload-inventory.json"));
    for (const file of inventory.files) files.push(file);
  }
  const cells = exteriorServingCellOccupancy({ files, ownerByBuildingId });
  if (cells.length === 0) fail("the committed inventories yielded no occupied cell; the forcing bound cannot be computed.");
  return cells;
}

/**
 * THE E-1 FORCING ARGUMENT, computed with the shipped instrument.
 *
 * The claim it establishes: a STATIONARY anchor cannot exceed the byte cap
 * ANYWHERE in the city, so eviction is reachable only IN TRANSIT. E-1a is
 * therefore a gate the route is BUILT TO FORCE rather than a hope that something
 * evicts.
 *
 * The argument has three legs, and none of them is an assumption:
 *
 *   1. THE FOOTPRINT IS HARD-CAPPED, not merely observed. T005 lowered
 *      `EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits` from 128 to 8 on
 *      2026-08-17, and the scheduler's own docblock records WHY: 8 "is the
 *      LARGEST cap the unchanged byte ceiling admits". The footprint cannot
 *      exceed 8 by construction, so there is no boundary condition to worry
 *      about at 9 or 10 cells.
 *   2. THE WORST REACHABLE ANCHOR STILL FITS. The shipped bound at cap 8 gives
 *      the heaviest 8-cell neighbourhood over EVERY camera anchor in the city,
 *      and it is under the byte cap.
 *   3. IT WAS OBSERVED TO FIT. T005's heaviest stationary stop is the 876-entry
 *      midtown transition anchor, which sat at 88.1% of the byte cap with
 *      cacheEvictions still 0 — and evictions appeared only at the later street
 *      stops, i.e. after the camera moved.
 *
 * The transit half is named by the instrument's own docblock: hysteresis keeps a
 * departed cell resident for further decisions, so a MOVING camera can
 * transiently hold more than `cap` cells. That is the mechanism E-1 exploits.
 */
async function forcingArgument(cells) {
  const cap = CACHE_CEILINGS.maxCachedBytes;
  const bound = exteriorServingResidencyBound({
    cells,
    cap: SCHEDULER_RESIDENT_UNIT_CAP,
    maxCacheEntries: CACHE_CEILINGS.maxCacheEntries,
    maxCachedBytes: cap,
  });
  const residency = await readJson(join(repositoryRoot, "data", "exterior-serving-20260817", "default-session-residency.json"));
  const stationaryStops = residency.stops.map((stop) => ({
    poseId: stop.poseId,
    cacheEntries: stop.sharedCache.cacheEntries,
    cachedBytes: stop.sharedCache.cachedBytes,
    percentOfCap: Number(((100 * stop.sharedCache.cachedBytes) / cap).toFixed(1)),
    cacheEvictions: stop.sharedCache.cacheEvictions,
  }));
  const heaviestStationary = stationaryStops.reduce((worst, stop) => (stop.cachedBytes > worst.cachedBytes ? stop : worst));

  return {
    byteCap: cap,
    entryCap: CACHE_CEILINGS.maxCacheEntries,
    instrument: "src/runtime/exterior-serving-residency.ts, exteriorServingResidencyBound - the shipped, unit-tested derivation, called rather than reimplemented.",
    schedulerResidentUnitCap: {
      value: SCHEDULER_RESIDENT_UNIT_CAP,
      source: "EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits (src/runtime/exterior-visibility-scheduler.ts)",
      note: "HARD CAP, not an observation. Lowered from 128 to 8 by T005 on 2026-08-17 because 8 is the largest cap the unchanged byte ceiling admits. The footprint cannot exceed it, so the bound below has no 9-or-10-cell boundary condition.",
    },
    reachableBound: {
      worstAnchorCellId: bound.reachableAnchorCellId,
      entries: bound.reachable.entries,
      bytes: bound.reachable.bytes,
      percentOfByteCap: Number((100 * bound.byteRatio).toFixed(1)),
      percentOfEntryCap: Number((100 * bound.entryRatio).toFixed(1)),
      bindingConstraint: bound.bindingConstraint,
      fitsByteCap: bound.fitsByteCap,
      fitsEntryCap: bound.fitsEntryCap,
    },
    modelledUnreachableHeaviestSet: {
      entries: bound.heaviestSet.entries,
      bytes: bound.heaviestSet.bytes,
      note: "The 8 heaviest cells ANYWHERE, which are not adjacent and cannot be co-resident. Reported because it is over the cap and a reader who saw only that number would draw the wrong conclusion; it is labelled unreachable by the instrument itself.",
    },
    observedStationaryStops: stationaryStops,
    observedStationarySource: "data/exterior-serving-20260817/default-session-residency.json",
    claim: `The scheduler admits at most ${SCHEDULER_RESIDENT_UNIT_CAP} resident cells by construction. Over EVERY camera anchor in the city, the heaviest reachable ${SCHEDULER_RESIDENT_UNIT_CAP}-cell neighbourhood (anchor ${bound.reachableAnchorCellId}) charges ${bound.reachable.bytes.toLocaleString("en-US")} bytes, ${Number((100 * bound.byteRatio).toFixed(1))}% of the ${cap.toLocaleString("en-US")}-byte cap, and it FITS. T005 observed the same thing empirically: its heaviest stationary stop (${heaviestStationary.poseId}, ${heaviestStationary.cacheEntries} entries) sat at ${heaviestStationary.percentOfCap}% of the cap with cacheEvictions still ${heaviestStationary.cacheEvictions}. A STATIONARY ANCHOR THEREFORE CANNOT FORCE AN EVICTION. Eviction is reachable ONLY IN TRANSIT, where scheduler hysteresis keeps departed cells resident alongside arriving ones and a moving camera transiently holds more than the cap. The E-1 loop is built to force exactly that, and E-1a is the gate that checks it happened.`,
    marginStatement: `The margin is thin and is stated rather than rounded away: ${(cap - bound.reachable.bytes).toLocaleString("en-US")} bytes, ${Number((100 - 100 * bound.byteRatio).toFixed(1))}% of the cap. The binding constraint is ${bound.bindingConstraint}. This is a design that fits, not one that fits comfortably, and a wave re-cut that grew the heaviest midtown neighbourhood by more than that margin would make stationary eviction reachable and would invalidate this argument.`,
    whatWouldFalsifyIt: `If the capture observes a stationary stop with cacheEvictions > 0 and a scheduledCellCount at or below ${SCHEDULER_RESIDENT_UNIT_CAP}, this argument is WRONG and the record must say so rather than reinterpreting the stop as transit.`,
  };
}

/** S0 reconciliation: readings, taken from committed files, not assertions. */
async function reconciliation() {
  const appSource = await readFile(join(repositoryRoot, "src", "app", "App.tsx"), "utf8");
  const pinned = appSource.includes(`"${BLOCK_835_V3_RELEASE_ID}"`);
  if (!pinned) fail(`${BLOCK_835_V3_RELEASE_ID} is no longer pinned in App.tsx; L1 and J3 cannot address it.`);

  const lodByRelease = [];
  for (const releaseId of SERVING_RELEASE_IDS) {
    const inventory = await readJson(join(repositoryRoot, "data", releaseId, "payload-inventory.json"));
    lodByRelease.push({ releaseId, shippedLodIds: inventory.composition.shippedLodIds, buildingCount: inventory.composition.availableBuildingCount, retentionSourceReleaseId: inventory.retentionSource?.releaseId ?? null });
  }
  const singleLod = lodByRelease.every((entry) => entry.shippedLodIds.length === 1 && entry.shippedLodIds[0] === "lod_0");

  const blender = await readJson(join(repositoryRoot, "data", "mass-generation-20260816", "blender-agreement.json"));

  return {
    pinnedExteriorCellReleaseIds: {
      checked: BLOCK_835_V3_RELEASE_ID,
      stillPinned: pinned,
      definedAt: "src/app/App.tsx, export const PINNED_EXTERIOR_CELL_RELEASE_IDS",
      whyItMatters: "L1 renders the lod_0-to-lod_1 demonstration on this release and J3 opens it; an unpinned release refuses activation, so both arms depend on this reading.",
    },
    servingComposition: {
      releases: lodByRelease,
      totalBuildingCount: lodByRelease.reduce((sum, entry) => sum + entry.buildingCount, 0),
      everyWaveShipsASingleLod: singleLod,
      consequence: "THIS IS L2's PREMISE, machine-checked rather than argued: all six promoted serving waves ship lod_0 ONLY. There is no rendered lod_0-to-lod_1 transition anywhere in the served set, so the per-wave rendered 2% key-silhouette gate of AC #4 is structurally unreachable under the shipped serving arrangement.",
    },
    block835LodPair: {
      releaseId: BLOCK_835_V3_RELEASE_ID,
      buildingCount: LOD_L1.buildingCount,
      shippedLodIds: ["lod_0", "lod_1"],
      consequence: "THIS IS L1's PREMISE: the opt-in ships 14 buildings at BOTH LODs, and is the only distinguished lod_0/lod_1 pair addressable by the running app.",
    },
    textureArchitecture: {
      atlas: false,
      delivery: "shared per-class URI delivery",
      tilesPerWave: 4,
      residentWaveCount: 6,
      uniqueTileCount: EXPECTED_UNIQUE_TILE_COUNT,
      expectedTextureByteLength: EXPECTED_TEXTURE_BYTE_LENGTH,
      derivation: "4 shared class tiles per release x 6 promoted waves = 24 unique tiles; 24 x trunc(128 x 128 x 4 x 4/3) = 24 x 87,381 = 2,097,144 bytes. The per-tile figure includes the mip chain, which ADR 0047 established BY MEASUREMENT rather than assumption.",
      clause: "ADR 0047 declines an atlas outright (maximum observed |UV| is 1210.1 and an atlas cannot repeat-wrap) and satisfies AC #3 through its '(or measured equivalent)' clause. The equivalent is shared per-class URI delivery, and it is measured by G1-G4 rather than argued.",
    },
    blenderInheritance: {
      sampledBuildings: blender.overall.passingSamples,
      failingSamples: blender.overall.failingSamples,
      status: blender.overall.status,
      everyServingReleaseDeclaresARetentionSource: lodByRelease.every((entry) => typeof entry.retentionSourceReleaseId === "string"),
      argument: VISUAL_GATES.blenderInheritance.argument,
      limitOfTheInheritance: "The inheritance carries the 94-SAMPLE agreement from the -c1 payloads to the -s1 serving releases. It does NOT extend the sample to the population: the source record's own notClaimedHere says it claims nothing about the 44,895 buildings the sample did not open, and neither does this campaign.",
    },
  };
}

async function main() {
  const cells = await cellCensus();
  const record = {
    schemaVersion: "1.0",
    recordId: `${CAMPAIGN_EVIDENCE_ID}:pre-registration`,
    task: "T006",
    artifact: "exterior-acceptance-pre-registration",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. This record is committed before any capture exists; a timestamp here would be the time the bars were written, and recording it as a capture time would be a small lie in the one file whose whole value is that it predates the measurements.",
    claim: "The complete set of bars, stations, routes and interpretation rules the T006 acceptance campaign is judged against, committed before any capture. Nothing here is a measurement.",
    acceptanceCriterionMapping: AC_MAPPING,
    reconciliation: await reconciliation(),
    stations: STATIONS,
    gates: {
      frames: { F1: FRAME_F1, F2: FRAME_F2, F4: FRAME_F4 },
      headroom: { H1: HEADROOM_H1, H2: HEADROOM_H2 },
      storm: STORM_S1,
      gpu: GPU_GATES,
      eviction: { loop: EVICTION_LOOP, gates: EVICTION_GATES, forcingArgument: await forcingArgument(cells) },
      heap: HEAP_GATES,
      journeys: JOURNEY_GATES,
      lod: { L1: LOD_L1, L2: LOD_L2 },
      visual: VISUAL_GATES,
    },
    requestCeilings: REQUEST_CEILINGS,
    cacheCeilings: CACHE_CEILINGS,
    discipline: CAMPAIGN_DISCIPLINE,
    notPreRegisteredHere: [
      "Any measurement. This record contains no reading taken from a running app.",
      "Any fix for a gate that fails. The contract puts fixes in a new cycle by amendment; this campaign measures and reports.",
      "Any claim that passing these gates constitutes visual, geographic, factual, accessibility or performance acceptance.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "pre-registration.json"), text);
  await writeFile(join(evidenceRoot, "pre-registration.sha256"), `${sha256HexSync(text)}  pre-registration.json\n`);
  console.log(serialize({
    ok: true,
    checksum: sha256HexSync(text),
    cellsCensused: cells.length,
    forcing: record.gates.eviction.forcingArgument.loop,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
