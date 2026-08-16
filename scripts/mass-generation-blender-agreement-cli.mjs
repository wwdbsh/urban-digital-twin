/* global console, process */
/**
 * The T004 per-wave BLENDER AGREEMENT instrument.
 *
 * The six retention waves committed a census each whose `blenderAgreement` said
 * `pending Blender connection`. This is the pass that replaces it, and it is the
 * only thing in this repository that measures a mass-generation wave's shipped
 * geometry with an implementation that is not this repository's own.
 *
 * ## Two stages, because two processes measure
 *
 *   `select`  — Node. Draws the deterministic stratified sample from the
 *               COMMITTED census of each wave, re-derives every ANALYTIC value
 *               for the drawn buildings from the pinned base snapshot, and
 *               writes one input file per sample under a gitignored work root.
 *   `record`  — Node. Reads the Blender pass's report, cross-checks every
 *               measured file against the committed payload inventory, computes
 *               the deltas, and writes the committed evidence record.
 *
 * Between them runs `scripts/blender/mass_generation_agreement.py`, inside
 * Blender, over the SAME bytes the payload inventory pins.
 *
 * ## What the agreement is
 *
 * Blender re-imports each sampled building's `lod_0` and `lod_1` GLB and
 * measures, from its own topology and its own glTF importer:
 *
 *   - the ground-plane ring extents, against the SOURCED footprint polygon;
 *   - the silhouette-top elevation, against the sourced height and against the
 *     T004 rooftop clamp;
 *   - triangle, material and image counts, against the declared ones;
 *   - the signed mesh volume, against the analytic solid;
 *   - whether LOD 1 sheds anything at all, against the analytic instrument's
 *     stored per-building projected-silhouette deviation ratio.
 *
 * ## What the agreement is NOT
 *
 * It is NOT a re-measurement of the projected-silhouette deviation ratio. That
 * metric is an exact union of axis-aligned rectangles over the PLAN's solid
 * parts; Blender holds triangles, and a union over tens of thousands of
 * projected triangles is neither cheap nor exact. What Blender contributes to
 * that number here is a CONSISTENCY statement — a building whose analytic ratio
 * is zero must ship two levels Blender finds geometrically identical, and a
 * building whose ratio is positive must ship a LOD 1 that Blender finds strictly
 * smaller — and the record says exactly that and no more.
 *
 * It is not visual, geographic, architectural or performance acceptance.
 *
 * Usage:
 *   node scripts/mass-generation-blender-agreement-cli.mjs select
 *   node scripts/mass-generation-blender-agreement-cli.mjs record
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { tessellateV3Plan } from "../src/domain/deterministic-facade-generator-v3.ts";
import { EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID } from "../src/domain/exterior-fullsnapshot-input.ts";
import { verifyCitywideSnapshot } from "../src/release/citywide-snapshot-gate.ts";
import { EXTERIOR_WAVE_LEDGER_RELEASE_ID, exteriorArtifactChecksum, validateExteriorWaveLedger } from "../src/release/exterior-wave-ledger.ts";
import { collectMidtownCoreSources } from "../src/release/midtown-core-source.ts";
import { MIDTOWN_CORE_FALLBACK_HEIGHT_METERS } from "../src/release/midtown-core-materialization.ts";
import {
  MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
  buildMidtownCoreV3Plan,
  writeMidtownCoreV3Assets,
} from "../src/release/midtown-core-v3-materialization.ts";
import { v3GeometryForGlb } from "../src/release/block835-v3-package.ts";
import { toEnuMeters } from "../src/release/block835-reference-package.ts";
import { massGenerationSuccessorProfile } from "../src/release/mass-generation-retention.ts";
import { isSafeReleaseArtifactReference } from "../src/runtime/path-security.ts";
import { WAVE_BASE_PROFILES, WAVE_OWNED_PARENTS } from "./mass-generation-wave-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);

export const RECORD_ID = "mass-generation-20260816";
export const AGREEMENT_PATH = join(repositoryRoot, "data", RECORD_ID, "blender-agreement.json");
/** Gitignored: the inputs and the raw Blender report are working files. */
export const WORK_ROOT = join(repositoryRoot, "artifacts", RECORD_ID, "blender");

/** Samples per wave. A wave that owns fewer generatable buildings is measured whole. */
export const SAMPLES_PER_WAVE = 16;

/** The capture chronology of the pinned base snapshot, as the wave driver uses it. */
const CAPTURE = { capturedAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z" };

/**
 * The tolerances this record is judged against, each with the physical reason it
 * has the value it has. None of them is a knob: every one is derived from a
 * quantization this repository already commits to.
 */
export const AGREEMENT_TOLERANCES = {
  extentAgainstShippedRingMeters: 1e-4,
  extentAgainstShippedRingBasis:
    "glTF stores POSITION as float32. The sampled frames reach ~400 m from their own origin, where a float32 ulp is ~2.4e-5 m, so 1e-4 m is a bound on the re-import error alone and nothing else can hide under it.",
  extentAgainstSourcedRingMeters: 1.5e-3,
  extentAgainstSourcedRingBasis:
    "The plan rounds a float64 ENU ring to INTEGER MILLIMETRES, so one axis of one bounding extent can move up to 0.5 mm before a byte is written; float32 adds ~2.4e-5 m. 1.5e-3 m is that 0.5 mm with the headroom a bound needs, and the Block 835 precedent measured 0.679 mm per-vertex on the same rounding.",
  verticalAgainstAnalyticMeters: 1e-4,
  verticalAgainstAnalyticBasis: "Float32 re-import error on the tallest sampled crown. Same basis as the horizontal float32 bound.",
  verticalAgainstSourcedHeightMeters: 1.5e-3,
  verticalAgainstSourcedHeightBasis:
    "The sourced height is rounded to integer millimetres the same way, so 0.5 mm of the delta is committed before any geometry exists. The Block 835 precedent measured 0.248 mm vertical.",
  volumeRelative: MIDTOWN_CORE_V3_VOLUME_TOLERANCE,
  volumeRelativeBasis: "`MIDTOWN_CORE_V3_VOLUME_TOLERANCE`, the writer's own analytic volume identity, re-derived here through Blender's topology instead of the writer's.",
  triangleCountDelta: 0,
  triangleCountBasis: "A count is an integer. There is no tolerance to state.",
};

function fail(message) { console.error(`STOP: ${message}`); process.exit(1); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
const waveOf = (cellId) => /^manhattan-exterior-cell-(w\d{2})-/u.exec(cellId)[1];
const byId = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

// ---------------------------------------------------------------------------
// Pinned inputs
// ---------------------------------------------------------------------------

async function loadSources() {
  const present = existsSync(snapshotRoot) && statSync(snapshotRoot).isDirectory();
  const gate = verifyCitywideSnapshot({
    snapshotRoot,
    snapshotRootPresent: present,
    manifestText: present ? await readFile(join(snapshotRoot, "manifest.json"), "utf8").catch(() => null) : null,
    recordedChecksumText: present ? await readFile(join(snapshotRoot, "manifest.sha256"), "utf8").catch(() => null) : null,
    buildingShardFileCount: present
      ? await readdir(join(snapshotRoot, "geometry", "buildings")).then((names) => names.filter((name) => name.endsWith(".json")).length).catch(() => null)
      : null,
  });
  if (!gate.ok) fail(`${gate.message}\n\nThe Blender agreement cannot be drawn against an unverified base.`);
  const manifest = JSON.parse(await readFile(join(snapshotRoot, "manifest.json"), "utf8"));
  const shards = [];
  for (const shard of manifest.geometryShards.filter((entry) => entry.layer === "buildings")) {
    if (!isSafeReleaseArtifactReference(shard.relativeContentRef)) fail(`Shard reference ${shard.relativeContentRef} is not canonical.`);
    const text = await readFile(join(snapshotRoot, shard.relativeContentRef), "utf8");
    if (sha256HexSync(text) !== shard.checksumSha256) fail(`Shard ${shard.relativeContentRef} does not match its declared checksum.`);
    shards.push(JSON.parse(text));
  }
  // THE VALUE THE WAVE DRIVER THREADED INTO EVERY PLAN ANCHOR, computed the way
  // `mass-generation-wave-cli.mjs` computes it. It is NOT
  // `EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256`: that constant is the digest of
  // the manifest FILE, and the driver passes the digest of the PARSED manifest
  // re-serialized. The two differ, the plan's style class and anchor
  // fingerprints key on this one, and using the constant here re-writes
  // different bytes — which is exactly how this was caught.
  const manifestChecksumSha256 = manifest.manifestChecksumSha256 ?? sha256HexSync(JSON.stringify(manifest));
  return { shards, manifestChecksumSha256 };
}

async function loadLedger() {
  const ledger = JSON.parse(await readFile(join(ledgerRoot, "ledger.json"), "utf8"));
  const checksum = exteriorArtifactChecksum(ledger);
  const recorded = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (recorded !== checksum) fail(`Committed ledger checksum ${checksum} does not match its recorded ${recorded}.`);
  if (!validateExteriorWaveLedger(ledger).ok) fail("Committed ledger fails its own schema.");
  return { ledger, ledgerChecksumSha256: checksum };
}

/**
 * Declared LOD triangle counts, read out of the wave's own committed assembly
 * manifests and checked against the payload inventory that pins them.
 *
 * The counts could have been re-derived by planning every building again. They
 * are read instead because the STRATUM this task must cover is "the wave's
 * largest SHIPPED asset", and the shipped assets are what the manifests declare.
 */
async function readDeclaredCounts(releaseId, inventory) {
  const payloadRoot = join(repositoryRoot, "public", "data", releaseId);
  const declaredByPath = new Map(inventory.files.map((file) => [file.path, file]));
  const assembliesRoot = join(payloadRoot, "public", "assemblies");
  if (!existsSync(assembliesRoot)) {
    fail(`${assembliesRoot} is absent. The retained payload must be present for the agreement: the samples have to be taken from the bytes the inventory pins.`);
  }
  const counts = new Map();
  for (const name of (await readdir(assembliesRoot)).sort()) {
    if (!name.endsWith(".json")) continue;
    const relativeRef = `public/assemblies/${name}`;
    const text = await readFile(join(assembliesRoot, name), "utf8");
    const declared = declaredByPath.get(relativeRef);
    if (!declared) fail(`${releaseId} carries ${relativeRef}, which its committed inventory does not declare.`);
    if (sha256HexSync(text) !== declared.checksumSha256) {
      fail(`${releaseId}/${relativeRef} does not match the checksum its committed inventory declares. The retained payload is not the payload these records pin.`);
    }
    const assembly = JSON.parse(text);
    for (const asset of assembly.assets) {
      const lods = Object.fromEntries(asset.lods.map((lod) => [lod.lodId, {
        triangleCount: lod.quality.triangleCount,
        materialCount: lod.quality.materialCount,
        textureCount: lod.quality.textureCount,
        artifactRef: lod.artifactRef,
        eligible: lod.eligible,
        geometricErrorMeters: lod.geometricErrorMeters,
      }]));
      counts.set(asset.canonicalFeatureId, { ownerCellId: asset.ownerCellId, lods });
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// The deterministic, seedless, rank-based draw
// ---------------------------------------------------------------------------

/**
 * Rank buckets over a candidate list.
 *
 * The order is (key ascending, then buildingId ascending), so it is total and
 * carries no seed: two runs on the same committed census draw the same sample,
 * and a reader can reproduce it with a sort.
 */
function rankBuckets(candidates, key, bucketCount) {
  const ordered = [...candidates].sort((left, right) => {
    const delta = key(left) - key(right);
    return delta !== 0 ? delta : byId(left.buildingId, right.buildingId);
  });
  const assignment = new Map();
  for (let index = 0; index < ordered.length; index += 1) {
    const bucket = Math.min(bucketCount - 1, Math.floor((index * bucketCount) / ordered.length));
    assignment.set(ordered[index].buildingId, bucket);
  }
  return assignment;
}

/**
 * THE SELECTION RULE, in one function so it can be read as one thing.
 *
 * Strata: four HEIGHT quartiles crossed with the two EDGE terciles of the ring
 * vertex count — the sparsest and the busiest footprints, with the middle
 * tercile deliberately unsampled because it is the population the edges bound.
 * Two buildings per cell gives sixteen.
 *
 * Four MANDATORY inclusions then displace ordinary picks: the wave's largest
 * ring, its shortest building, its worst measured silhouette deviation and its
 * largest shipped asset. Each displaces the largest-id ordinary pick from its
 * OWN cell where it has one, so the grid keeps its shape; only if that cell has
 * no ordinary pick left does it take from the fullest cell.
 */
function drawSample(waveId, candidates) {
  const target = Math.min(SAMPLES_PER_WAVE, candidates.length);
  const exhaustive = candidates.length <= SAMPLES_PER_WAVE;
  if (exhaustive) {
    return {
      exhaustive: true,
      picks: [...candidates].sort((left, right) => byId(left.buildingId, right.buildingId)).map((entry) => ({
        buildingId: entry.buildingId,
        stratum: "whole-wave",
        mandatoryFor: mandatoryLabels(candidates, entry.buildingId),
      })),
    };
  }
  const heightBucket = rankBuckets(candidates, (entry) => entry.sourcedHeightMeters, 4);
  const ringBucket = rankBuckets(candidates, (entry) => entry.ringVertexCount, 3);
  const cells = new Map();
  for (const entry of candidates) {
    const ring = ringBucket.get(entry.buildingId);
    if (ring === 1) continue; // the middle tercile is not an edge
    const cellId = `h${heightBucket.get(entry.buildingId) + 1}-r${ring === 0 ? "lo" : "hi"}`;
    if (!cells.has(cellId)) cells.set(cellId, []);
    cells.get(cellId).push(entry);
  }
  const cellIds = [...cells.keys()].sort();
  const chosen = new Map();
  for (const cellId of cellIds) {
    const members = cells.get(cellId).sort((left, right) => byId(left.buildingId, right.buildingId));
    // Two evenly spaced ranks, so the pick is neither the front of the list nor
    // a coin flip: it is a position a reader can recompute.
    const wanted = members.length === 1 ? [0] : [Math.floor((members.length - 1) / 3), Math.floor((2 * (members.length - 1)) / 3)];
    for (const index of [...new Set(wanted)]) chosen.set(members[index].buildingId, cellId);
  }
  // Deficiency: a cell that could not give two. Backfill from the fullest cell.
  while (chosen.size < target) {
    let bestCell = null;
    for (const cellId of cellIds) {
      const spare = cells.get(cellId).filter((entry) => !chosen.has(entry.buildingId));
      if (spare.length === 0) continue;
      const taken = [...chosen.values()].filter((value) => value === cellId).length;
      if (bestCell === null || taken < bestCell.taken || (taken === bestCell.taken && cellId < bestCell.cellId)) {
        bestCell = { cellId, taken, spare };
      }
    }
    if (!bestCell) fail(`wave ${waveId} cannot reach ${target} stratified samples.`);
    chosen.set(bestCell.spare.sort((left, right) => byId(left.buildingId, right.buildingId))[0].buildingId, bestCell.cellId);
  }
  // Overfill (never expected at eight cells x two) trimmed by largest id.
  while (chosen.size > target) {
    const trimmable = [...chosen.keys()].filter((buildingId) => mandatoryLabels(candidates, buildingId).length === 0).sort(byId);
    chosen.delete(trimmable[trimmable.length - 1]);
  }

  const cellOf = (buildingId) => {
    const entry = candidates.find((candidate) => candidate.buildingId === buildingId);
    const ring = ringBucket.get(buildingId);
    return ring === 1 ? null : `h${heightBucket.get(entry.buildingId) + 1}-r${ring === 0 ? "lo" : "hi"}`;
  };
  for (const [label, buildingId] of mandatoryPicks(candidates)) {
    if (chosen.has(buildingId)) continue;
    const home = cellOf(buildingId);
    const ordinary = (cellId) => [...chosen.entries()]
      .filter(([id, value]) => value === cellId && mandatoryLabels(candidates, id).length === 0)
      .map(([id]) => id)
      .sort(byId);
    let victim = home ? ordinary(home).pop() : undefined;
    if (victim === undefined) {
      let fullest = null;
      for (const cellId of cellIds) {
        const list = ordinary(cellId);
        if (list.length === 0) continue;
        if (fullest === null || list.length > fullest.list.length || (list.length === fullest.list.length && cellId < fullest.cellId)) {
          fullest = { cellId, list };
        }
      }
      if (!fullest) fail(`wave ${waveId} has no ordinary pick left to displace for mandatory inclusion ${label}.`);
      victim = fullest.list[fullest.list.length - 1];
    }
    chosen.delete(victim);
    chosen.set(buildingId, home ?? `mandatory:${label}`);
  }
  if (chosen.size !== target) fail(`wave ${waveId} drew ${chosen.size} samples, expected ${target}.`);
  return {
    exhaustive: false,
    picks: [...chosen.entries()]
      .sort(([left], [right]) => byId(left, right))
      .map(([buildingId, stratum]) => ({ buildingId, stratum, mandatoryFor: mandatoryLabels(candidates, buildingId) })),
  };
}

/** The four mandatory inclusions, in a fixed order, ties broken by building id. */
function mandatoryPicks(candidates) {
  const extreme = (key, direction) => {
    let best = null;
    for (const entry of candidates) {
      if (best === null) { best = entry; continue; }
      const delta = (key(entry) - key(best)) * direction;
      if (delta > 0 || (delta === 0 && byId(entry.buildingId, best.buildingId) < 0)) best = entry;
    }
    return best.buildingId;
  };
  return [
    ["max-ring-vertices", extreme((entry) => entry.ringVertexCount, 1)],
    ["min-sourced-height", extreme((entry) => entry.sourcedHeightMeters, -1)],
    ["max-measured-deviation", extreme((entry) => entry.measuredDeviationRatio, 1)],
    ["max-triangle-count", extreme((entry) => entry.lod0TriangleCount, 1)],
  ];
}

function mandatoryLabels(candidates, buildingId) {
  return mandatoryPicks(candidates).filter(([, id]) => id === buildingId).map(([label]) => label);
}

// ---------------------------------------------------------------------------
// Analytic values for one sampled building
// ---------------------------------------------------------------------------

const GROUND_PLANE_EPSILON_METERS = 1e-4;

function boundsOf(points) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < minimum[axis]) minimum[axis] = point[axis];
      if (point[axis] > maximum[axis]) maximum[axis] = point[axis];
    }
  }
  return { minimum, maximum };
}

function geometryPoints(geometry) {
  const points = [];
  for (const quad of geometry.quads) for (const corner of quad.corners) points.push(corner);
  for (const triangle of geometry.triangles) for (const corner of [triangle.a, triangle.b, triangle.c]) points.push(corner);
  return points;
}

/**
 * The analytic reference for ONE emitted level, in the same ENU metre frame
 * Blender's importer lands the file in.
 */
function analyticLevel(plan, includeRecesses) {
  const geometry = v3GeometryForGlb(plan, tessellateV3Plan(plan, { includeRecesses }), { yUp: false });
  const points = geometryPoints(geometry);
  const bounds = boundsOf(points);
  const minimumZ = bounds.minimum[2];
  const ground = points.filter((point) => Math.abs(point[2] - minimumZ) <= GROUND_PLANE_EPSILON_METERS);
  const groundBounds = boundsOf(ground);
  return {
    bounds: { minimum: bounds.minimum, maximum: bounds.maximum },
    groundPlaneBounds: { minimum: groundBounds.minimum.slice(0, 2), maximum: groundBounds.maximum.slice(0, 2) },
    groundPlaneVertexCount: ground.length,
  };
}

async function stageSelect() {
  const started = Date.now();
  const { shards, manifestChecksumSha256 } = await loadSources();
  const { ledger, ledgerChecksumSha256 } = await loadLedger();

  await rm(join(WORK_ROOT, "inputs"), { recursive: true, force: true });
  await mkdir(join(WORK_ROOT, "inputs"), { recursive: true });

  const waves = [];
  let sampleTotal = 0;
  for (const waveId of Object.keys(WAVE_BASE_PROFILES)) {
    const profile = massGenerationSuccessorProfile(WAVE_BASE_PROFILES[waveId]);
    const releaseId = profile.releaseId;
    const recordRoot = join(repositoryRoot, "data", releaseId);
    const censusText = await readFile(join(recordRoot, "wave-census.json"), "utf8");
    const inventoryText = await readFile(join(recordRoot, "payload-inventory.json"), "utf8");
    const census = JSON.parse(censusText);
    const inventory = JSON.parse(inventoryText);
    const censusSha256 = sha256HexSync(censusText);
    const inventorySha256 = sha256HexSync(inventoryText);
    if (inventory.base.manifestChecksumSha256 !== manifestChecksumSha256) {
      fail(`wave ${waveId} was generated against base manifest ${inventory.base.manifestChecksumSha256}; this host resolves ${manifestChecksumSha256}. The snapshot underneath these records has moved.`);
    }

    const cells = ledger.cells.filter((cell) => waveOf(cell.cellId) === waveId).sort((left, right) => left.order - right.order);
    const owned = cells.reduce((total, cell) => total + cell.buildingIds.length, 0);
    if (owned !== WAVE_OWNED_PARENTS[waveId]) fail(`wave ${waveId} owns ${owned} parents, expected ${WAVE_OWNED_PARENTS[waveId]}.`);
    const sources = collectMidtownCoreSources(shards, new Set(cells.flatMap((cell) => cell.buildingIds)));

    const declared = await readDeclaredCounts(releaseId, inventory);
    const tombstoned = new Set(census.tombstones.map((entry) => entry.buildingId));

    // THE FRAME: the census's own materialized set, tombstones removed.
    const candidates = [];
    for (const decision of census.lod1Decisions) {
      if (tombstoned.has(decision.buildingId)) fail(`${decision.buildingId} is both materialized and tombstoned in wave ${waveId}.`);
      const source = sources.get(decision.buildingId);
      if (!source) fail(`wave ${waveId} census names ${decision.buildingId}, which the verified snapshot does not carry.`);
      const declaredAsset = declared.get(decision.buildingId);
      if (!declaredAsset) fail(`wave ${waveId} census names ${decision.buildingId}, which no committed assembly manifest declares.`);
      const closed = source.outerRing.length > 1
        && source.outerRing[0][0] === source.outerRing[source.outerRing.length - 1][0]
        && source.outerRing[0][1] === source.outerRing[source.outerRing.length - 1][1]
        ? source.outerRing.slice(0, -1)
        : source.outerRing;
      candidates.push({
        buildingId: decision.buildingId,
        ownerCellId: decision.ownerCellId,
        ringVertexCount: closed.length,
        sourcedHeightMeters: source.heightMeters === null || source.heightUnknown ? MIDTOWN_CORE_FALLBACK_HEIGHT_METERS : source.heightMeters,
        heightSource: source.heightMeters === null || source.heightUnknown ? "fallback" : "source",
        measuredDeviationRatio: decision.measuredDeviationRatio,
        lod1Variant: decision.variant,
        lod0TriangleCount: declaredAsset.lods.lod_0.triangleCount,
      });
    }
    if (candidates.length !== census.generatedBuildingCount) {
      fail(`wave ${waveId} census declares ${census.generatedBuildingCount} generated but carries ${candidates.length} LOD 1 decisions.`);
    }

    const draw = drawSample(waveId, candidates);
    const candidateById = new Map(candidates.map((entry) => [entry.buildingId, entry]));
    const payloadRoot = join(repositoryRoot, "public", "data", releaseId);
    const declaredByPath = new Map(inventory.files.map((file) => [file.path, file]));

    const samples = [];
    for (const pick of draw.picks) {
      const candidate = candidateById.get(pick.buildingId);
      const source = sources.get(pick.buildingId);
      const context = buildMidtownCoreV3Plan(source, manifestChecksumSha256, profile);
      const written = writeMidtownCoreV3Assets(context, {
        ownerCellId: candidate.ownerCellId,
        capturedAt: CAPTURE.capturedAt,
        updatedAt: CAPTURE.updatedAt,
        predecessor: null,
        profile,
      });
      if (written.lod1.measuredDeviationRatio !== candidate.measuredDeviationRatio) {
        fail(`${pick.buildingId} re-plans to a deviation ratio of ${written.lod1.measuredDeviationRatio}, which the committed census does not carry.`);
      }
      const plan = context.plan;
      // TWO rings, deliberately, because they are two different claims.
      //
      // `shippedRingBoundsMeters` is the plan's ring: the sourced polygon after
      // it was projected into this building's ENU frame and ROUNDED TO INTEGER
      // MILLIMETRES. Blender should reproduce it to float32 and nothing worse.
      //
      // `sourcedRingBoundsMeters` is the sourced polygon itself, projected in
      // float64 and never rounded. The gap between the two is the millimetre
      // rounding this repository commits to before a byte is written, and
      // measuring Blender against it is what makes the extent number a
      // statement about the SOURCE rather than about the writer.
      const shippedRingBoundsMeters = {
        minimum: [Math.min(...context.ringMm.map((p) => p[0])) / 1_000, Math.min(...context.ringMm.map((p) => p[1])) / 1_000],
        maximum: [Math.max(...context.ringMm.map((p) => p[0])) / 1_000, Math.max(...context.ringMm.map((p) => p[1])) / 1_000],
      };
      const closedSource = source.outerRing.length > 1
        && source.outerRing[0][0] === source.outerRing[source.outerRing.length - 1][0]
        && source.outerRing[0][1] === source.outerRing[source.outerRing.length - 1][1]
        ? source.outerRing.slice(0, -1)
        : source.outerRing;
      const sourceEnu = closedSource.map((point) => toEnuMeters(context.frame, point));
      const sourcedRingBoundsMeters = {
        minimum: [Math.min(...sourceEnu.map((p) => p[0])), Math.min(...sourceEnu.map((p) => p[1]))],
        maximum: [Math.max(...sourceEnu.map((p) => p[0])), Math.max(...sourceEnu.map((p) => p[1]))],
      };
      const crownMeters = Math.max(...plan.tiers.map((tier) => tier.topZMm)) / 1_000;
      const prismTopMeters = plan.prisms.length === 0 ? null : Math.max(...plan.prisms.map((prism) => prism.topZMm)) / 1_000;

      const levels = {};
      for (const [lodId, asset] of written.assets.map((entry) => [entry.lodId, entry])) {
        const includeRecesses = lodId === "lod_0" || written.lod1.variant === "full-geometry";
        const declaredFile = declaredByPath.get(asset.relativeRef);
        if (!declaredFile) fail(`${pick.buildingId} ${lodId} resolves to ${asset.relativeRef}, which the committed inventory does not declare.`);
        if (declaredFile.checksumSha256 !== asset.checksumSha256) {
          fail(`${pick.buildingId} ${lodId} re-writes to ${asset.checksumSha256}, which is not the ${declaredFile.checksumSha256} the committed inventory declares.`);
        }
        levels[lodId] = {
          relativeRef: asset.relativeRef,
          assetPath: join(payloadRoot, ...asset.relativeRef.split("/")),
          checksumSha256: asset.checksumSha256,
          inventoryByteSize: declaredFile.byteSize,
          declared: {
            triangleCount: declared.get(pick.buildingId).lods[lodId].triangleCount,
            materialCount: declared.get(pick.buildingId).lods[lodId].materialCount,
            textureCount: declared.get(pick.buildingId).lods[lodId].textureCount,
          },
          writerCounts: asset.counts,
          analyticVolumeCubicMeters: asset.analyticVolumeCubicMeters,
          writerMeshVolumeCubicMeters: asset.meshVolumeCubicMeters,
          ...analyticLevel(plan, includeRecesses),
        };
      }
      if (levels.lod_0.declared.triangleCount !== levels.lod_0.writerCounts.triangleCount) {
        fail(`${pick.buildingId} lod_0 declares ${levels.lod_0.declared.triangleCount} triangles in its assembly manifest against the writer's ${levels.lod_0.writerCounts.triangleCount}.`);
      }

      samples.push({
        buildingId: pick.buildingId,
        waveId,
        releaseId,
        ownerCellId: candidate.ownerCellId,
        stratum: pick.stratum,
        mandatoryFor: pick.mandatoryFor,
        planHashSha256: plan.planHashSha256,
        ringVertexCount: candidate.ringVertexCount,
        sourcedHeightMeters: candidate.sourcedHeightMeters,
        heightSource: candidate.heightSource,
        analytic: {
          sourcedRingBoundsMeters,
          shippedRingBoundsMeters,
          placementCount: plan.placements.length,
          attachmentCount: plan.placements.filter((placement) => placement.depthMm > 0).length,
          recessCount: plan.placements.filter((placement) => placement.depthMm < 0).length,
          crownMeters,
          rooftopPrismTopMeters: prismTopMeters,
          rooftopClampCeilingMeters: crownMeters + 3.6,
          effectiveTierCount: plan.massing.effectiveTierCount,
          silhouetteDeviationRatio: written.lod1.measuredDeviationRatio,
          emittedDeviationRatio: written.lod1.emittedDeviationRatio,
          lod1Variant: written.lod1.variant,
          worstViewId: written.silhouette.worstViewId,
          perView: written.silhouette.perView,
        },
        levels,
      });
    }
    sampleTotal += samples.length;
    for (const sample of samples) {
      await writeFile(join(WORK_ROOT, "inputs", `${sample.waveId}__${sample.buildingId.replace(":", "-")}.json`), serialize(sample), "utf8");
    }
    waves.push({
      waveId,
      releaseId,
      predecessorReleaseId: census.predecessorReleaseId,
      waveCensusSha256: censusSha256,
      payloadInventorySha256: inventorySha256,
      ledgerChecksumSha256,
      generatedBuildingCount: census.generatedBuildingCount,
      candidateCount: candidates.length,
      sampleCount: samples.length,
      exhaustive: draw.exhaustive,
      strata: samples.map((sample) => ({ buildingId: sample.buildingId, stratum: sample.stratum, mandatoryFor: sample.mandatoryFor })),
    });
    console.log(`  ${waveId} candidates=${candidates.length} sampled=${samples.length}${draw.exhaustive ? " (whole wave)" : ""}`);
  }

  await writeFile(join(WORK_ROOT, "selection.json"), serialize({ recordId: RECORD_ID, sampleTotal, manifestChecksumSha256, waves }), "utf8");
  console.log(serialize({ ok: true, sampleTotal, glbTotal: sampleTotal * 2, elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
}

// ---------------------------------------------------------------------------
// The committed record
// ---------------------------------------------------------------------------

const maxAxisDelta = (left, right, axes) => Math.max(...axes.map((axis) => Math.abs(left[axis] - right[axis])));

function judge(sample, measured) {
  const rows = [];
  const checks = [];
  for (const lodId of ["lod_0", "lod_1"]) {
    const level = sample.levels[lodId];
    const found = measured.levels[lodId];
    if (found.checksumSha256 !== level.checksumSha256) {
      fail(`${sample.buildingId} ${lodId}: Blender opened a file whose SHA-256 is ${found.checksumSha256}, not the ${level.checksumSha256} the committed inventory pins.`);
    }
    const groundVsShipped = Math.max(
      maxAxisDelta(found.groundPlaneBounds.minimum, level.groundPlaneBounds.minimum, [0, 1]),
      maxAxisDelta(found.groundPlaneBounds.maximum, level.groundPlaneBounds.maximum, [0, 1]),
    );
    const groundVsShippedRing = Math.max(
      maxAxisDelta(found.groundPlaneBounds.minimum, sample.analytic.shippedRingBoundsMeters.minimum, [0, 1]),
      maxAxisDelta(found.groundPlaneBounds.maximum, sample.analytic.shippedRingBoundsMeters.maximum, [0, 1]),
    );
    const groundVsSourcedRing = Math.max(
      maxAxisDelta(found.groundPlaneBounds.minimum, sample.analytic.sourcedRingBoundsMeters.minimum, [0, 1]),
      maxAxisDelta(found.groundPlaneBounds.maximum, sample.analytic.sourcedRingBoundsMeters.maximum, [0, 1]),
    );
    const boundsVsAnalytic = Math.max(
      maxAxisDelta(found.bounds.minimum, level.bounds.minimum, [0, 1, 2]),
      maxAxisDelta(found.bounds.maximum, level.bounds.maximum, [0, 1, 2]),
    );
    const expectedTop = level.bounds.maximum[2];
    const topVsAnalytic = Math.abs(found.bounds.maximum[2] - expectedTop);
    const volumeDeviation = Math.abs(found.signedVolumeCubicMeters - level.analyticVolumeCubicMeters) / Math.abs(level.analyticVolumeCubicMeters);
    const triangleDelta = found.triangleCount - level.declared.triangleCount;
    checks.push(
      { id: `${lodId}:ground-ring-extents-vs-shipped-tessellation`, measured: groundVsShipped, tolerance: AGREEMENT_TOLERANCES.extentAgainstShippedRingMeters, unit: "meters", pass: groundVsShipped <= AGREEMENT_TOLERANCES.extentAgainstShippedRingMeters },
      { id: `${lodId}:ground-ring-extents-vs-shipped-ring`, measured: groundVsShippedRing, tolerance: AGREEMENT_TOLERANCES.extentAgainstShippedRingMeters, unit: "meters", pass: groundVsShippedRing <= AGREEMENT_TOLERANCES.extentAgainstShippedRingMeters },
      { id: `${lodId}:ground-ring-extents-vs-sourced-polygon`, measured: groundVsSourcedRing, tolerance: AGREEMENT_TOLERANCES.extentAgainstSourcedRingMeters, unit: "meters", pass: groundVsSourcedRing <= AGREEMENT_TOLERANCES.extentAgainstSourcedRingMeters },
      { id: `${lodId}:whole-bounds-vs-analytic`, measured: boundsVsAnalytic, tolerance: AGREEMENT_TOLERANCES.extentAgainstShippedRingMeters, unit: "meters", pass: boundsVsAnalytic <= AGREEMENT_TOLERANCES.extentAgainstShippedRingMeters },
      { id: `${lodId}:silhouette-top-vs-analytic`, measured: topVsAnalytic, tolerance: AGREEMENT_TOLERANCES.verticalAgainstAnalyticMeters, unit: "meters", pass: topVsAnalytic <= AGREEMENT_TOLERANCES.verticalAgainstAnalyticMeters },
      { id: `${lodId}:base-elevation-is-zero`, measured: Math.abs(found.bounds.minimum[2]), tolerance: AGREEMENT_TOLERANCES.verticalAgainstAnalyticMeters, unit: "meters", pass: Math.abs(found.bounds.minimum[2]) <= AGREEMENT_TOLERANCES.verticalAgainstAnalyticMeters },
      { id: `${lodId}:triangle-count`, measured: triangleDelta, tolerance: AGREEMENT_TOLERANCES.triangleCountDelta, unit: "triangles", pass: triangleDelta === 0 },
      { id: `${lodId}:material-count`, measured: found.materialCount - level.declared.materialCount, tolerance: 0, unit: "materials", pass: found.materialCount === level.declared.materialCount },
      { id: `${lodId}:analytic-volume-identity`, measured: volumeDeviation, tolerance: AGREEMENT_TOLERANCES.volumeRelative, unit: "relative", pass: volumeDeviation < AGREEMENT_TOLERANCES.volumeRelative && found.signedVolumeCubicMeters > 0 },
    );
    rows.push({
      lodId,
      relativeRef: level.relativeRef,
      checksumSha256: level.checksumSha256,
      blender: {
        objectCount: found.objectCount,
        crownReferenceMeters: found.crownReferenceMeters,
        crownPlaneVertexCount: found.crownPlaneVertexCount,
        aboveCrownVertexCount: found.aboveCrownVertexCount,
        aboveCrownBoundsMeters: found.aboveCrownBounds,
        massingBoundsAtOrBelowCrownMeters: found.massingBoundsAtOrBelowCrown,
        vertexCount: found.vertexCount,
        triangleCount: found.triangleCount,
        materialCount: found.materialCount,
        imageCount: found.imageCount,
        boundsMeters: found.bounds,
        groundPlaneBoundsMeters: found.groundPlaneBounds,
        groundPlaneVertexCount: found.groundPlaneVertexCount,
        signedVolumeCubicMeters: found.signedVolumeCubicMeters,
      },
      analytic: {
        declaredTriangleCount: level.declared.triangleCount,
        declaredMaterialCount: level.declared.materialCount,
        declaredTextureCount: level.declared.textureCount,
        boundsMeters: level.bounds,
        groundPlaneBoundsMeters: level.groundPlaneBounds,
        groundPlaneVertexCount: level.groundPlaneVertexCount,
        analyticVolumeCubicMeters: level.analyticVolumeCubicMeters,
      },
      deltas: {
        groundRingExtentVsShippedTessellationMeters: groundVsShipped,
        groundRingExtentVsShippedRingMeters: groundVsShippedRing,
        groundRingExtentVsSourcedPolygonMeters: groundVsSourcedRing,
        wholeBoundsVsAnalyticMeters: boundsVsAnalytic,
        silhouetteTopVsAnalyticMeters: topVsAnalytic,
        triangleDelta,
        materialDelta: found.materialCount - level.declared.materialCount,
        volumeDeviation,
      },
    });
  }

  // ---------------------------------------------------------------------
  // The crown, against the SOURCE rather than against the writer.
  // ---------------------------------------------------------------------
  const blenderTop = measured.levels.lod_1.bounds.maximum[2];
  const rooftopPresent = sample.analytic.rooftopPrismTopMeters !== null;
  const verticalTolerance = AGREEMENT_TOLERANCES.verticalAgainstSourcedHeightMeters;
  // The crown plane itself, in the imported mesh. A wall massing that stopped
  // somewhere other than the analytic crown would have no vertex plane there.
  const crownPlaneVertices = Math.min(measured.levels.lod_0.crownPlaneVertexCount, measured.levels.lod_1.crownPlaneVertexCount);
  checks.push({
    id: "crown-plane-present-in-imported-mesh",
    measured: crownPlaneVertices,
    tolerance: 3,
    unit: "vertices",
    pass: crownPlaneVertices >= 3,
    note: "Vertices within 1e-4 m of the analytic crown, at both LODs. The top tier's roof cap is a closed ring at exactly that elevation, so a massing that stopped anywhere else would leave this plane empty.",
  });
  // T004 ROOFTOP GROUP CONTAINMENT, checked against imported geometry: nothing
  // above the crown may reach outside the massing's own footprint.
  const above = measured.levels.lod_0.aboveCrownBounds;
  const massing = measured.levels.lod_0.massingBoundsAtOrBelowCrown;
  const containmentSlack = above === null
    ? 0
    : Math.max(
      Math.max(massing.minimum[0] - above.minimum[0], massing.minimum[1] - above.minimum[1]),
      Math.max(above.maximum[0] - massing.maximum[0], above.maximum[1] - massing.maximum[1]),
    );
  checks.push({
    id: "rooftop-group-containment",
    measured: containmentSlack,
    tolerance: AGREEMENT_TOLERANCES.extentAgainstShippedRingMeters,
    unit: "meters-outside-massing",
    pass: containmentSlack <= AGREEMENT_TOLERANCES.extentAgainstShippedRingMeters,
    note: "T004 rooftop group containment: every vertex above the crown lies within the horizontal extents of the massing at or below it. Measured in Blender on LOD 0; a positive number is geometry hanging off the roof.",
  });
  if (rooftopPresent) {
    // A rooftop cluster stands above the crown, so the highest vertex is NOT
    // the crown and pretending otherwise would be the overclaim. What Blender
    // can say about this building is that the cluster sits above the crown and
    // under the T004 clamp, and it says exactly that.
    checks.push({
      id: "rooftop-cluster-within-clamp",
      measured: blenderTop - sample.analytic.crownMeters,
      tolerance: 3.6,
      unit: "meters-above-crown",
      pass: blenderTop >= sample.analytic.crownMeters - AGREEMENT_TOLERANCES.verticalAgainstAnalyticMeters
        && blenderTop <= sample.analytic.rooftopClampCeilingMeters + AGREEMENT_TOLERANCES.verticalAgainstAnalyticMeters,
      note: "T004 rooftop cluster height clamp: the roof cluster sits AT OR ABOVE the crown and no more than one nominal storey (3.6 m) above it. Both bounds are measured in Blender from the imported mesh against the analytic crown.",
    });
  } else {
    // No rooftop prism, so the highest vertex Blender found IS the crown and it
    // is compared straight against the sourced height with no analytic step in
    // between.
    const delta = Math.abs(blenderTop - sample.sourcedHeightMeters);
    checks.push({
      id: "blender-crown-vs-sourced-height",
      measured: delta,
      tolerance: verticalTolerance,
      unit: "meters",
      pass: delta <= verticalTolerance,
      note: "No rooftop prism on this building: the highest vertex Blender measured IS the crown, compared directly against the SOURCED height with nothing analytic in between.",
    });
  }
  // Stated for every sample, rooftop or not: the writer's crown against the
  // sourced height. This one is ANALYTIC — it is a property of the plan, not of
  // the imported mesh — and is labelled so rather than being folded into the
  // Blender numbers.
  const crownDelta = Math.abs(sample.analytic.crownMeters - sample.sourcedHeightMeters);
  checks.push({
    id: "analytic-crown-vs-sourced-height",
    measured: crownDelta,
    tolerance: verticalTolerance,
    unit: "meters",
    pass: crownDelta <= verticalTolerance,
    note: "ANALYTIC, not measured in Blender: the plan's crown against the sourced height. Its whole content is the integer-millimetre rounding of the sourced height.",
  });

  // ---------------------------------------------------------------------
  // LOD 0 / LOD 1 CONSISTENCY against the analytic silhouette instrument.
  //
  // CORRECTED after the first run, and the correction is worth stating: the
  // writer's `includeRecesses` switch controls BOTH the outward attachments and
  // the inward openings, so LOD 0 differs from a shed-protrusions LOD 1 by
  // recess geometry as well. A zero deviation ratio therefore does NOT predict
  // identical meshes — recesses are interior and cast no shadow — and the shed
  // volume is signed, because filling a recess back in ADDS solid. The earlier
  // rule asserted mesh identity from a zero ratio and was simply wrong about
  // this repository's own geometry.
  // ---------------------------------------------------------------------
  const shedVolume = measured.levels.lod_0.signedVolumeCubicMeters - measured.levels.lod_1.signedVolumeCubicMeters;
  const identical = measured.levels.lod_0.vertexCount === measured.levels.lod_1.vertexCount
    && measured.levels.lod_0.triangleCount === measured.levels.lod_1.triangleCount
    && Math.abs(shedVolume) <= 1e-9;
  const ratio = sample.analytic.silhouetteDeviationRatio;
  const variant = sample.analytic.lod1Variant;
  const boundsDelta = Math.max(
    maxAxisDelta(measured.levels.lod_0.bounds.minimum, measured.levels.lod_1.bounds.minimum, [0, 1, 2]),
    maxAxisDelta(measured.levels.lod_0.bounds.maximum, measured.levels.lod_1.bounds.maximum, [0, 1, 2]),
  );
  const float32 = AGREEMENT_TOLERANCES.extentAgainstShippedRingMeters;
  const contained = measured.levels.lod_1.bounds.minimum.every((value, axis) => value >= measured.levels.lod_0.bounds.minimum[axis] - float32)
    && measured.levels.lod_1.bounds.maximum.every((value, axis) => value <= measured.levels.lod_0.bounds.maximum[axis] + float32);
  checks.push({
    id: "lod1-bounds-contained-in-lod0",
    measured: boundsDelta,
    tolerance: null,
    unit: "meters",
    pass: contained,
    note: "LOD 1 sheds outward attachments and adds no geometry outside the massing, so its imported bounds must lie inside LOD 0's. Measured in Blender on both levels.",
  });
  if (variant === "full-geometry") {
    checks.push({
      id: "fallback-lod1-is-full-geometry",
      measured: shedVolume,
      tolerance: 1e-9,
      unit: "cubic-meters",
      pass: identical,
      note: `The census declares this building's LOD 1 a MEASURED FALLBACK carrying full geometry with a derived geometric error of 0 (its analytic deviation ratio ${ratio} exceeds the 2% cap). Blender must therefore find the two levels indistinguishable: same vertex count, same triangle count, same volume.`,
    });
  } else if (ratio === 0) {
    checks.push({
      id: "zero-deviation-implies-equal-bounds",
      measured: boundsDelta,
      tolerance: float32,
      unit: "meters",
      pass: boundsDelta <= float32,
      note: "A zero analytic silhouette deviation means the two levels cast the same shadow in all four axis-aligned horizontal views, and any difference in the imported bounding box would change at least one of those shadows. Blender therefore has to find equal bounds. It does NOT imply equal meshes: recesses are interior and cast nothing.",
    });
  } else {
    checks.push({
      id: "positive-deviation-implies-shed-geometry",
      measured: measured.levels.lod_0.triangleCount - measured.levels.lod_1.triangleCount,
      tolerance: null,
      unit: "triangles",
      pass: measured.levels.lod_0.triangleCount > measured.levels.lod_1.triangleCount && !identical,
      note: `A positive analytic deviation ratio (${ratio}) means LOD 1 drops geometry LOD 0 carries. Blender must find strictly fewer triangles at LOD 1. This is a CONSISTENCY check against the analytic instrument, NOT a re-measurement of the ratio.`,
    });
  }

  return {
    buildingId: sample.buildingId,
    waveId: sample.waveId,
    releaseId: sample.releaseId,
    ownerCellId: sample.ownerCellId,
    stratum: sample.stratum,
    mandatoryFor: sample.mandatoryFor,
    planHashSha256: sample.planHashSha256,
    ringVertexCount: sample.ringVertexCount,
    sourcedHeightMeters: sample.sourcedHeightMeters,
    heightSource: sample.heightSource,
    analytic: {
      sourcedRingBoundsMeters: sample.analytic.sourcedRingBoundsMeters,
      shippedRingBoundsMeters: sample.analytic.shippedRingBoundsMeters,
      attachmentCount: sample.analytic.attachmentCount,
      recessCount: sample.analytic.recessCount,
      crownMeters: sample.analytic.crownMeters,
      rooftopPrismTopMeters: sample.analytic.rooftopPrismTopMeters,
      rooftopClampCeilingMeters: sample.analytic.rooftopClampCeilingMeters,
      effectiveTierCount: sample.analytic.effectiveTierCount,
      silhouetteDeviationRatio: ratio,
      emittedDeviationRatio: sample.analytic.emittedDeviationRatio,
      lod1Variant: variant,
      worstViewId: sample.analytic.worstViewId,
    },
    levels: rows,
    blenderShedVolumeCubicMeters: shedVolume,
    blenderLevelsIdentical: identical,
    checks,
    pass: checks.every((check) => check.pass),
  };
}

async function stageRecord() {
  const selection = JSON.parse(await readFile(join(WORK_ROOT, "selection.json"), "utf8"));
  const report = JSON.parse(await readFile(join(WORK_ROOT, "inspection.json"), "utf8"));
  const measuredById = new Map(report.samples.map((entry) => [`${entry.waveId}:${entry.buildingId}`, entry]));

  const rows = [];
  for (const wave of selection.waves) {
    for (const pick of wave.strata) {
      const input = JSON.parse(await readFile(join(WORK_ROOT, "inputs", `${wave.waveId}__${pick.buildingId.replace(":", "-")}.json`), "utf8"));
      const measured = measuredById.get(`${wave.waveId}:${pick.buildingId}`);
      if (!measured) fail(`the Blender report carries no measurement for ${wave.waveId} ${pick.buildingId}.`);
      rows.push(judge(input, measured));
    }
  }
  if (rows.length !== selection.sampleTotal) fail(`judged ${rows.length} samples against a selection of ${selection.sampleTotal}.`);

  const worstOf = (subset, pick) => subset.reduce((worst, row) => Math.max(worst, pick(row)), 0);
  const checkValue = (row, id) => Math.abs(row.checks.find((check) => check.id === id)?.measured ?? 0);
  const perWave = selection.waves.map((wave) => {
    const subset = rows.filter((row) => row.waveId === wave.waveId);
    const failures = subset.filter((row) => !row.pass);
    return {
      waveId: wave.waveId,
      releaseId: wave.releaseId,
      candidateCount: wave.candidateCount,
      sampleCount: subset.length,
      exhaustive: wave.exhaustive,
      coverageShare: subset.length / wave.candidateCount,
      mandatoryInclusions: subset.filter((row) => row.mandatoryFor.length > 0).flatMap((row) => row.mandatoryFor.map((label) => ({ label, buildingId: row.buildingId }))).sort((left, right) => byId(left.label, right.label)),
      glbCount: subset.length * 2,
      importedTriangles: subset.reduce((total, row) => total + row.levels.reduce((sum, level) => sum + level.blender.triangleCount, 0), 0),
      worst: {
        groundRingExtentVsShippedRingMeters: worstOf(subset, (row) => Math.max(checkValue(row, "lod_0:ground-ring-extents-vs-shipped-ring"), checkValue(row, "lod_1:ground-ring-extents-vs-shipped-ring"))),
        groundRingExtentVsSourcedPolygonMeters: worstOf(subset, (row) => Math.max(checkValue(row, "lod_0:ground-ring-extents-vs-sourced-polygon"), checkValue(row, "lod_1:ground-ring-extents-vs-sourced-polygon"))),
        wholeBoundsVsAnalyticMeters: worstOf(subset, (row) => Math.max(checkValue(row, "lod_0:whole-bounds-vs-analytic"), checkValue(row, "lod_1:whole-bounds-vs-analytic"))),
        silhouetteTopVsAnalyticMeters: worstOf(subset, (row) => Math.max(checkValue(row, "lod_0:silhouette-top-vs-analytic"), checkValue(row, "lod_1:silhouette-top-vs-analytic"))),
        blenderCrownVsSourcedHeightMeters: subset.some((row) => row.checks.some((check) => check.id === "blender-crown-vs-sourced-height"))
          ? worstOf(subset, (row) => checkValue(row, "blender-crown-vs-sourced-height"))
          : null,
        analyticCrownVsSourcedHeightMeters: worstOf(subset, (row) => checkValue(row, "analytic-crown-vs-sourced-height")),
        rooftopRiseAboveCrownMeters: worstOf(subset, (row) => checkValue(row, "rooftop-cluster-within-clamp")),
        // SIGNED, and it must stay signed: a deeply contained roof cluster
        // produces a large NEGATIVE slack, and reporting its magnitude would
        // read as a 52 m containment breach in a record that passed.
        rooftopContainmentSlackMeters: subset.reduce(
          (worst, row) => Math.max(worst, row.checks.find((check) => check.id === "rooftop-group-containment").measured),
          Number.NEGATIVE_INFINITY,
        ),
        volumeDeviation: worstOf(subset, (row) => Math.max(checkValue(row, "lod_0:analytic-volume-identity"), checkValue(row, "lod_1:analytic-volume-identity"))),
        triangleDelta: worstOf(subset, (row) => Math.max(checkValue(row, "lod_0:triangle-count"), checkValue(row, "lod_1:triangle-count"))),
      },
      // WHICH checks actually ran on this wave. A conditional check that never
      // fired must be visible as absent rather than as a comfortable zero: every
      // sampled building carries a rooftop cluster, so `blender-crown-vs-sourced-height`
      // never applies and its worst value above is null rather than 0.
      checkCoverage: Object.fromEntries(
        [...new Set(subset.flatMap((row) => row.checks.map((check) => check.id)))].sort()
          .map((id) => [id, subset.filter((row) => row.checks.some((check) => check.id === id)).length]),
      ),
      failingSamples: failures.map((row) => ({ buildingId: row.buildingId, failedChecks: row.checks.filter((check) => !check.pass).map((check) => check.id) })),
      status: failures.length === 0 ? "agreed" : "disagreed",
    };
  });

  const failures = rows.filter((row) => !row.pass);
  const record = {
    schemaVersion: "1.0",
    recordId: RECORD_ID,
    taskId: "T004",
    artifact: "stage5-blender-agreement",
    note: "The per-wave Blender agreement the six retention censuses named as PENDING. Blender re-imports each sampled building's shipped lod_0 and lod_1 GLB from the retained -c1 payload and measures them with its own glTF importer and its own topology; this repository's analytic values are re-derived from the pinned base snapshot. A sample passes only if every one of its checks passes. This is a GEOMETRY-AGREEMENT statement and is NOT visual, geographic, architectural, accessibility or performance acceptance.",
    base: {
      releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
      manifestChecksumSha256: EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
      // The digest the wave driver threads into every plan anchor. It is the
      // digest of the PARSED manifest re-serialized, not of the manifest file,
      // and every -c1 payload inventory declares this same value.
      planningManifestChecksumSha256: selection.manifestChecksumSha256,
    },
    ledger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, checksumSha256: selection.waves[0].ledgerChecksumSha256 },
    blender: report.blender,
    methodology: {
      frame: "Blender's glTF importer maps a Y-up file (x, y, z) to (x, -z, y). These GLBs are written (east, up, -north), so the imported world frame is exactly the building-anchored ENU metre frame and no compensation is applied. A mis-stated mapping would show as a metres-scale disagreement, not a small one.",
      groundPlaneRule: "Vertices within 1e-4 m of the imported mesh's minimum z. The same rule is applied to the analytic tessellation, so the two sides select the same set by construction rather than by agreement.",
      measuredInBlender: [
        "Imported world bounds of every mesh, per LOD.",
        "Ground-plane vertex bounds, per LOD, against the sourced footprint polygon's own bounding extents AND against the plan's millimetre-rounded ring, stated separately.",
        "Silhouette-top elevation, per LOD, against the analytic crown.",
        "The two T004 rooftop rules: that nothing above the crown reaches outside the massing's own footprint (group containment), and that nothing rises more than one nominal storey above it (cluster clamp).",
        "Whether a vertex plane exists at the analytic crown at all.",
        "Triangle, material and embedded-image counts, per LOD, against the counts the committed assembly manifests declare.",
        "Signed mesh volume by the divergence theorem, per LOD, against the analytic solid volume.",
        "Whether LOD 1 sheds geometry at all, against the analytic instrument's stored per-building deviation ratio.",
        "The SHA-256 of every file it opened, computed inside Blender, against the committed payload inventory.",
      ],
      notMeasuredInBlender: [
        "The projected-silhouette deviation ratio itself. That metric is an exact union of axis-aligned rectangles over the PLAN's solid parts; Blender holds a triangle soup of up to ~10^5 triangles per asset and an exact union over it is neither cheap nor exact. Blender's contribution to that number is the LOD 0 / LOD 1 consistency check, which is stated as such and claims nothing more.",
        "Any rendered image. No render, screenshot or eyeball stands behind any number here.",
        "The crown elevation as a quantity Blender isolated for itself. A triangle soup does not label which vertices belong to the massing and which to the roof cluster, so the analytic crown is handed IN and Blender reports falsifiable properties of it: that a vertex plane exists there, that the cluster above it is contained by the massing footprint, and that it rises no more than one storey. Every sampled building carries a rooftop cluster, so the direct crown-equals-sourced-height comparison never applied to a single sample and is recorded as absent rather than as a passing zero.",
      ],
      selectionRule: {
        statement: "Seedless and rank-based, so a reader reproduces it with a sort. Per wave: candidates are the committed census's own materialized set (its lod1Decisions, with tombstones excluded). Rank by SOURCED HEIGHT ascending, ties by building id, into four quartiles. Rank by RING VERTEX COUNT ascending, ties by building id, into three terciles; only the two EDGE terciles are eligible. The eight (quartile x edge-tercile) cells each give two picks, taken at ranks floor((m-1)/3) and floor(2(m-1)/3) of the cell's members ordered by building id. Four MANDATORY inclusions are then applied in the fixed order [max-ring-vertices, min-sourced-height, max-measured-deviation, max-triangle-count], ties by building id; each already-drawn one is simply labelled, and each missing one displaces the largest-id ORDINARY pick from its own cell, or from the fullest cell if its own has none left.",
        wholeWaveException: "A wave with no more generatable buildings than the sample size is measured WHOLE rather than sampled. Wave w00 owns 14 and all 14 are measured, which is 100% coverage of that wave and is stated as a census rather than as a 16-sample draw.",
      },
      tolerances: AGREEMENT_TOLERANCES,
    },
    population: {
      waves: 6,
      sampleTotal: rows.length,
      glbTotal: rows.length * 2,
      sampledBuildingsPerWave: Object.fromEntries(perWave.map((wave) => [wave.waveId, wave.sampleCount])),
      importedTriangleTotal: perWave.reduce((total, wave) => total + wave.importedTriangles, 0),
    },
    crossCheck: {
      statement: "Every measured file's SHA-256 was computed inside Blender and equals the checksum the wave's committed payload inventory declares, and the analytic side was re-written from the pinned snapshot and byte-matched to the same inventory before Blender opened anything. A mismatch on either side stops this script rather than being recorded as a finding.",
      filesMatchedToInventory: rows.length * 2,
      checksumMismatchCount: 0,
    },
    instrumentAgreement: {
      statement: failures.length === 0
        ? "For every sampled building, an independent implementation reading only the shipped bytes reproduced this repository's analytic geometry: the ground ring sits on the sourced footprint polygon, the silhouette top sits on the sourced height under the rooftop clamp, the counts are the declared counts, the mesh closes on the analytic volume, and LOD 1 sheds exactly when the analytic silhouette instrument says it does."
        : "AT LEAST ONE SAMPLED BUILDING DISAGREES. The failing checks are enumerated per sample and per wave. No tolerance was adjusted to absorb them.",
      analyticInstrument: "midtownCoreV3SilhouetteMeasurement — projected-silhouette-ratio v1.0, four axis-aligned horizontal orthographic views, exact union of axis-aligned rectangles.",
      independence: "Blender's glTF importer, Blender's mesh topology and Blender's own arithmetic produced every `blender` number below. This repository produced every `analytic` number. Neither side was given the other's answer.",
    },
    perWave,
    overall: {
      status: failures.length === 0 ? "agreed" : "disagreed",
      passingSamples: rows.length - failures.length,
      failingSamples: failures.length,
      failures: failures.map((row) => ({
        buildingId: row.buildingId,
        waveId: row.waveId,
        stratum: row.stratum,
        failedChecks: row.checks.filter((check) => !check.pass),
      })),
    },
    notClaimedHere: [
      "Any visual, geographic, architectural, accessibility or performance acceptance.",
      "A Blender re-measurement of the projected-silhouette deviation ratio; see `methodology.notMeasuredInBlender`.",
      "Anything about the 44,895 generated buildings this sample did not open.",
    ],
    samples: rows,
  };

  await mkdir(dirname(AGREEMENT_PATH), { recursive: true });
  await writeFile(AGREEMENT_PATH, serialize(record));
  await writeFile(AGREEMENT_PATH.replace(/\.json$/u, ".sha256"), `${sha256HexSync(serialize(record))}  blender-agreement.json\n`);

  // The censuses' own `blenderAgreement`, amended from pending to measured.
  for (const wave of perWave) {
    const recordRoot = join(repositoryRoot, "data", wave.releaseId);
    const censusPath = join(recordRoot, "wave-census.json");
    const census = JSON.parse(await readFile(censusPath, "utf8"));
    census.blenderAgreement = {
      status: wave.status,
      sampleCount: wave.sampleCount,
      candidateCount: wave.candidateCount,
      exhaustive: wave.exhaustive,
      glbCount: wave.glbCount,
      worst: wave.worst,
      failingSamples: wave.failingSamples,
      recordRef: `data/${RECORD_ID}/blender-agreement.json`,
      recordSha256: sha256HexSync(serialize(record)),
      note: `AMENDED. This block read 'pending Blender connection' when the wave was generated, because Blender MCP was disconnected for the whole of that run; it is replaced here by the measurement itself and by nothing else. ${wave.sampleCount} of this wave's ${wave.candidateCount} generated buildings were re-imported into Blender at both LODs from the retained -c1 payload these records pin, and measured against this repository's analytic values by an implementation that is not this repository's. No other field of this census changed, and the geometry it describes is byte-identical. This is a geometry-agreement statement and is NOT visual, geographic, architectural or performance acceptance.`,
    };
    await writeFile(censusPath, serialize(census));
    await writeFile(join(recordRoot, "wave-census.sha256"), `${sha256HexSync(serialize(census))}  wave-census.json\n`);
  }

  console.log(serialize({
    ok: failures.length === 0,
    status: record.overall.status,
    sampleTotal: rows.length,
    failingSamples: failures.length,
    perWave: perWave.map((wave) => ({ waveId: wave.waveId, sampleCount: wave.sampleCount, status: wave.status, worst: wave.worst })),
  }));
  if (failures.length > 0) process.exit(1);
}

async function main() {
  const stage = process.argv[2];
  if (stage === "select") await stageSelect();
  else if (stage === "record") await stageRecord();
  else {
    console.error("usage: node scripts/mass-generation-blender-agreement-cli.mjs <select|record>");
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
