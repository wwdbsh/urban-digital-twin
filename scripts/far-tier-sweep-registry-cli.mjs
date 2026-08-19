/* global console, process, URL */
/**
 * T005 — the two records that must exist BEFORE the promotion sweep runs.
 *
 * A "zero tan massing" claim is only meaningful against a set of things that are
 * ALLOWED to be tan. Writing that set after looking at the screens is how a
 * sweep passes: every uncovered building found becomes, retrospectively, an
 * expected one. So the exemption set and the pose registry are committed first,
 * digest-pinned, and the sweep is scored against them.
 *
 *   exemptions   The cells and buildings the far tier is NOT expected to cover.
 *   poses        The poses the sweep will visit, with their provenance.
 *
 * Usage: node --experimental-strip-types scripts/far-tier-sweep-registry-cli.mjs emit
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { cellTileKey } from "../src/release/exterior-wave-ledger.ts";
import { tileBounds } from "../src/runtime/spatial.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROMOTION_ID = "far-tier-hlod-promotion-20260819";
const promotionRoot = join(repositoryRoot, "data", PROMOTION_ID);
const TOOL = "far-tier-sweep-registry";
const BASE = "http://127.0.0.1:4173";

const fail = (message) => { console.error(`${TOOL}: ${message}`); process.exit(1); };
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The WGS84 centre of a ledger cell, from THE RUNTIME'S OWN ANCHOR.
 *
 * An earlier version of this tool re-derived the centre from the cell id with a
 * Web-Mercator tile formula. The ledger's y coordinate is not Web-Mercator, and
 * the result put two poses at latitude 62.9 — the North Atlantic — while still
 * looking like plausible numbers next to a Manhattan longitude. Nothing would
 * have failed; the sweep would simply have photographed empty ocean and
 * reported zero uncovered buildings.
 *
 * So the centre comes from `cellTileKey` and `tileBounds` — the SAME two
 * functions `farTierTileAnchor` composes to place a tile. (The anchor itself
 * cannot be imported here: it carries a TypeScript parameter property, which
 * node's strip-only mode rejects. Using its two inputs keeps the arithmetic
 * shared rather than reimplemented.)
 */
function cellCentre(cellId) {
  const tile = cellTileKey(cellId);
  // Block 835's alias id encodes no tile rectangle. It is an exemption, not a pose.
  if (tile === null) return null;
  const bounds = tileBounds(tile);
  return {
    lon: Number(((bounds.west + bounds.east) / 2).toFixed(6)),
    lat: Number(((bounds.south + bounds.north) / 2).toFixed(6)),
  };
}

/** The pose-captures URL grammar, as `exterior-two-lod-capture-cli.mjs` writes it. */
function poseUrl(pose) {
  const url = new URL(BASE);
  url.searchParams.set("data", "real-pilot");
  url.searchParams.set("release", "manhattan-citywide-20260804");
  url.searchParams.set("view", "free");
  for (const key of ["lon", "lat", "height", "heading", "pitch", "roll"]) {
    url.searchParams.set(key, Number(pose[key]).toFixed(6));
  }
  if (pose.farTier === "off") url.searchParams.set("farTier", "off");
  return url.toString();
}

async function readVerified(name) {
  const text = await readFile(join(promotionRoot, `${name}.json`), "utf8");
  const declared = (await readFile(join(promotionRoot, `${name}.sha256`), "utf8")).trim().split(/\s+/u)[0];
  const actual = sha256HexSync(text);
  if (declared !== actual) fail(`${name}.json does not match its sidecar.`);
  return { text, json: JSON.parse(text), sha256: actual };
}

async function emit() {
  const inventory = await readVerified("promoted-inventory");
  const stops = inventory.json.coverage.honestStopCellIds;
  const excludedMembers = [];
  for (const entry of inventory.json.entries) {
    for (const member of entry.members) {
      if (!member.included) excludedMembers.push({ buildingId: member.buildingId, cellId: entry.cellId });
    }
  }
  const blockAliasCell = inventory.json.entries.map((entry) => entry.cellId).find((cellId) => cellId.includes("block-00835"));
  if (!blockAliasCell) fail("the promoted inventory carries no Block 835 cell; the exemption set would be describing a different island.");

  const exemptions = {
    schemaVersion: "1.0",
    recordId: `${PROMOTION_ID}:sweep-exemptions`,
    task: "T005",
    artifact: "far-tier-promotion-sweep-exemption-set",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. A set, not a measurement — and committed BEFORE the sweep it will be scored against.",
    why: "A 'no tan massing' verdict is only meaningful against a set of buildings that are ALLOWED to stay tan. Writing that set after looking at the screens turns every uncovered building into a retrospectively expected one, which is how a sweep passes without measuring anything.",
    boundTo: { promotedInventory: "promoted-inventory.json", promotedInventorySha256: inventory.sha256 },
    honestStopCells: {
      count: stops.length,
      why: "These 43 cells produced NO tile. Every V3T-eligible building in them must keep drawing its massing, and that massing is correct rather than a defect.",
      cellIds: [...stops],
    },
    excludedMembers: {
      count: excludedMembers.length,
      why: "Buildings the V3 grammar refused inside cells that DID bake. The tile does not contain them, so their massing must keep drawing and their refusal must keep explaining itself — this is T007's refusal transparency, working.",
      buildingIds: excludedMembers.map((member) => member.buildingId),
      byCell: excludedMembers,
    },
    blockAliasCell: {
      cellId: blockAliasCell,
      why: "Block 835 is the w00 wave in its entirety and carries a block alias rather than a tile coordinate, so a pose cannot be derived from its id the way it can for every other cell. It is named here so that a sweep which cannot place it is not mistaken for a sweep that found it uncovered.",
    },
    totals: {
      exemptCells: stops.length,
      exemptBuildings: excludedMembers.length,
      statement: "Everything NOT in these lists is expected to be either drawn by the far tier, drawn by the near or mid tier, or suppressed under a drawn tile.",
    },
    notClaimedHere: [
      "An exemption is not an excuse. Each of these is a recorded outcome of the bake, traceable to a wave telemetry record.",
      "This set says nothing about appearance. It is about coverage.",
    ],
  };

  // ---- poses -------------------------------------------------------------
  const stopWithCoords = stops.map((cellId) => ({ cellId, centre: cellCentre(cellId) })).filter((row) => row.centre !== null);
  const deepestStop = [...stopWithCoords].sort((left, right) => (left.cellId < right.cellId ? -1 : 1))[0];
  const bakedWithCoords = inventory.json.entries
    .map((entry) => ({ cellId: entry.cellId, centre: cellCentre(entry.cellId), members: entry.members.length }))
    .filter((row) => row.centre !== null);
  const densest = [...bakedWithCoords].sort((left, right) => right.members - left.members || (left.cellId < right.cellId ? -1 : 1))[0];

  const poses = [
    {
      poseId: "P1",
      label: "T003 validation pose — straight down at 1,400 m over doitt:119910",
      provenance: "PRE-EXISTING, from T003. Recorded in data/far-tier-hlod-runtime-20260818/runtime-record.json as prose (endToEndValidation.distanceGating.farPose); this is its first registration as a structured pose.",
      recaptureRequired: true,
      whyRecaptureRequired: "The tile under this pose CHANGED. T003 validated it against the v1 bake; the promoted tile is v4. The old capture describes bytes that are no longer served, so the pose must be re-captured rather than cited.",
      byteChangeDisclosed: {
        cellId: "manhattan-exterior-cell-w05-000747-17-38610-35822",
        glb: { v1: "2f859925", v4: "fc534a41" },
        atlas: { v1: "c159e050", v4: "f93873cc" },
        statement: "The prototype cell's bytes moved from v1 to v4 between T003 and this promotion. Any reader comparing this sweep's stills with T003's is comparing two different tiles, and that is said here rather than left to be noticed.",
      },
      pose: { lon: -73.9519, lat: 40.8059, height: 1400, heading: 0, pitch: -90, roll: 0 },
    },
    {
      poseId: "P2",
      label: "Midtown overview",
      provenance: "NEWLY REGISTERED FOR T005. RECONSTRUCTED FROM THE USER'S SESSION SCREENSHOT — the coordinates are an approximation of a view the user was looking at, not a pose any prior record contains. It is NOT pre-existing and must not be cited as if it were.",
      recaptureRequired: true,
      pose: { lon: -73.9840, lat: 40.7549, height: 2400, heading: 20, pitch: -35, roll: 0 },
    },
    {
      poseId: "P3",
      label: "Over an honest-stop cell — the far tier must show massing here, not a tile",
      provenance: "NEWLY REGISTERED FOR T005. Derived through farTierTileAnchor from the first honest-stop cell id in the committed exemption set, so the pose cannot drift away from the cell it is about.",
      cellId: deepestStop.cellId,
      recaptureRequired: true,
      pose: { lon: deepestStop.centre.lon, lat: deepestStop.centre.lat, height: 1600, heading: 0, pitch: -90, roll: 0 },
    },
    {
      poseId: "P4",
      label: "Over the densest baked cell — the most members one tile has to cover",
      provenance: "NEWLY REGISTERED FOR T005. Derived from the promoted inventory: the entry with the most members.",
      cellId: densest.cellId,
      recaptureRequired: true,
      pose: { lon: densest.centre.lon, lat: densest.centre.lat, height: 1600, heading: 0, pitch: -90, roll: 0 },
    },
    {
      poseId: "P5",
      label: "Island overview at 12 km — every cell in range at once",
      provenance: "NEWLY REGISTERED FOR T005. The pose that makes the selected set the whole island, which is the condition the raised ceiling was derived for.",
      recaptureRequired: true,
      pose: { lon: -73.9712, lat: 40.7831, height: 12000, heading: 0, pitch: -90, roll: 0 },
    },
    {
      poseId: "P6-OFF",
      label: "Rollback arm — P2 with the far tier explicitly off",
      provenance: "NEWLY REGISTERED FOR T005. The same pose as P2 with ?farTier=off, to evidence that the opt-out restores the pre-HLOD composition.",
      recaptureRequired: true,
      pose: { lon: -73.9840, lat: 40.7549, height: 2400, heading: 20, pitch: -35, roll: 0, farTier: "off" },
    },
  ].map((entry) => ({ ...entry, url: poseUrl({ ...entry.pose, farTier: entry.pose.farTier }) }));

  const poseRecord = {
    schemaVersion: "1.0",
    recordId: `${PROMOTION_ID}:sweep-poses`,
    task: "T005",
    artifact: "far-tier-promotion-sweep-pose-registry",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. Registered BEFORE any capture.",
    attemptCount: 1,
    attemptPolicy: "SINGLE attempt per pose. A FAIL is RECORDED and NOT re-run. The poses and their verdict rule were registered before any screen was looked at.",
    verdictRule: {
      perPose: "over-budget = absent = checksum-mismatch = build-failure = 0, AND every V3T-eligible member is either drawn by the near or mid tier, suppressed under a drawn far-tier tile, or named in the committed exemption set.",
      readFrom: "The eight data-far-tier-* per-state counts, plus data-far-tier-massing-suppressible / -covered / -uncovered for the member-level half.",
      stillsAre: "CONTEXT, NOT EVIDENCE. A screenshot cannot show that a count is zero. The counts are the evidence and the stills are labelled non-evidentiary.",
    },
    base: BASE,
    urlGrammar: "The pose-captures grammar from scripts/exterior-two-lod-capture-cli.mjs: data, release, view, then lon/lat/height/heading/pitch/roll each toFixed(6).",
    boundTo: { exemptionSet: "sweep-exemptions.json", promotedInventorySha256: inventory.sha256 },
    poses,
    notClaimedHere: [
      "P2 is NOT a pre-existing pose. It is reconstructed from a session screenshot and is registered here for the first time.",
      "P1's prior capture is not reused: the tile beneath it changed from v1 to v4.",
    ],
  };

  await mkdir(promotionRoot, { recursive: true });
  for (const [name, record] of [["sweep-exemptions", exemptions], ["sweep-poses", poseRecord]]) {
    const text = serialize(record);
    await writeFile(join(promotionRoot, `${name}.json`), text);
    await writeFile(join(promotionRoot, `${name}.sha256`), `${sha256HexSync(text)}  ${name}.json\n`);
  }
  console.log(serialize({
    ok: true,
    exemptCells: stops.length,
    exemptBuildings: excludedMembers.length,
    blockAliasCell,
    poses: poses.map((pose) => ({ poseId: pose.poseId, cellId: pose.cellId ?? null, url: pose.url })),
    exemptionsSha256: sha256HexSync(serialize(exemptions)),
    posesSha256: sha256HexSync(serialize(poseRecord)),
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] ?? "emit";
  if (command !== "emit") fail("usage: far-tier-sweep-registry-cli.mjs emit");
  await emit();
}
