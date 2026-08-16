#!/usr/bin/env node
/* global console, process, TextDecoder, TextEncoder */
/**
 * GRAMMAR-EXTENSION CENSUS (Task T003). LOCAL ONLY.
 *
 * Measures the two T003 grammar extensions against the shipped grammar over the
 * whole island. It acquires nothing, publishes nothing, renders nothing, writes
 * no GLB to disk and touches no committed release, census or reconciliation
 * record: every asset it writes is counted and dropped.
 *
 * WHAT IT PRODUCES, in one run:
 *
 *   (1) THE DIFFERENTIAL PLAN-HASH SET DIGEST. Every one of the 45,194 accepted
 *       parents is planned TWICE in the same process — once under the shipped
 *       admission envelope and once under the extended one — and a
 *       domain-separated SHA-256 is taken over the sorted `id\tplanHash` list of
 *       every parent the shipped envelope accepts. The two digests must be
 *       byte-equal. Cardinality equality is NOT identity and is not what is
 *       checked: the digest covers each building's own hash, so a plan that
 *       moved would change it even if the accepted COUNT did not.
 *
 *       The two states are reached through the `V3GrammarOptions` seam, not by
 *       mutating module state, because a differential that mutated the module
 *       would prove nothing about the module anybody ships.
 *
 *   (2) THE 899 REFUSAL LEDGER, per building. Each refused parent carries a
 *       GATE-FAILURE VECTOR — every admission gate evaluated independently,
 *       not just the priority winner — the priority stop code the shipped
 *       classifier assigns, and the post-extension outcome. The classifier is
 *       priority-ordered, so a raised vertex cap RECLASSIFIES a building that
 *       also fails a later gate rather than recovering it; separating the two is
 *       the whole point of carrying the vector.
 *
 *   (3) MEASURED COST of every recovered building: ring vertices, placements,
 *       triangles at both levels of detail, and emitted GLB bytes, from the real
 *       canonical writer.
 *
 * WHAT IT DOES NOT DO. It changes no default. Both extensions are inert in the
 * shipped grammar (see `V3GrammarOptions`), and this census is the measurement
 * that a decision to activate either one would rest on — not that activation.
 * It proves no visual, geographic or architectural claim.
 *
 * RUNTIME. Imports `.ts` directly and relies on Node's native type stripping, so
 * it requires Node >= 24 and takes no flag. The full run plans 45,194 buildings
 * twice and writes both LODs for every parent the shipped envelope accepts; it
 * is measured in minutes, which is why it is a deliberate operator command and
 * not part of any test.
 *
 * Usage:
 *   node scripts/grammar-extension-census-cli.mjs run [--out <path>]
 *   node scripts/grammar-extension-census-cli.mjs check
 */
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { domainSeparatedSha256, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  V3_EXTENDED_GRAMMAR_OPTIONS,
  DETERMINISTIC_FACADE_V3_LIMITS,
  DETERMINISTIC_FACADE_V3_GENERATOR_ID,
  DETERMINISTIC_FACADE_V3_GENERATOR_VERSION,
  DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
  V3_LOW_RISE_HEIGHT_THRESHOLD_MM,
  ringIsSimple,
  ringLocalThicknessMm,
  ringSignedAreaMm2,
} from "../src/domain/deterministic-facade-generator-v3.ts";
import {
  EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
} from "../src/domain/exterior-fullsnapshot-input.ts";
import { verifyCitywideSnapshot } from "../src/release/citywide-snapshot-gate.ts";
import {
  EXTERIOR_WAVE_BASE_BUILDING_COUNT,
  EXTERIOR_WAVE_LEDGER_RELEASE_ID,
  exteriorArtifactChecksum,
  validateExteriorWaveLedger,
} from "../src/release/exterior-wave-ledger.ts";
import {
  MIDTOWN_CORE_V3_STOP_CODES,
  MIDTOWN_CORE_V3_WAVE_PROFILE,
  MidtownCoreV3Stop,
  buildMidtownCoreV3Plan,
  writeMidtownCoreV3Assets,
} from "../src/release/midtown-core-v3-materialization.ts";
import { MIDTOWN_CORE_FALLBACK_HEIGHT_METERS } from "../src/release/midtown-core-materialization.ts";
import { enuFrame, toEnuMeters } from "../src/release/block835-reference-package.ts";
import { isSafeReleaseArtifactReference } from "../src/runtime/path-security.ts";

export const CENSUS_ID = "grammar-extension-20260815";
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RECORD_PATH = join(repositoryRoot, "data", CENSUS_ID, "extension-census.json");
const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);

/**
 * The shipped envelope, named rather than left implicit. It is what every
 * committed V3 wave release was materialized under, and half of every
 * comparison below.
 */
export const SHIPPED_GRAMMAR_OPTIONS = {
  maxRingVertices: DETERMINISTIC_FACADE_V3_LIMITS.maxRingVertices,
  lowRiseFloorHeight: false,
};

/** The committed goal-level refusal ledger this census must reconcile against. */
export const GOAL_LEDGER = { ownedParents: 45_194, materialized: 44_295, refused: 899 };
/** T001's projected full-city asset count, which implies 45,116 - 44,295 = 821 recoverable. */
export const T001_PROJECTED_FULL_CITY_ASSET_COUNT = 45_116;

function fail(message) {
  console.error(`STOP: ${message}`);
  process.exit(1);
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Fail-closed inputs
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
  if (!gate.ok) fail(`${gate.message}\n\nThe census cannot run against an unverified base. Nothing was written.`);

  const manifest = JSON.parse(await readFile(join(snapshotRoot, "manifest.json"), "utf8"));
  const encoder = new TextEncoder();
  const sources = new Map();
  let byteMismatch = 0;
  let checksumMismatch = 0;
  for (const shard of manifest.geometryShards.filter((entry) => entry.layer === "buildings")) {
    if (!isSafeReleaseArtifactReference(shard.relativeContentRef)) fail(`Shard reference ${shard.relativeContentRef} is not a canonical safe relative path.`);
    const text = await readFile(join(snapshotRoot, shard.relativeContentRef), "utf8");
    if (encoder.encode(text).byteLength !== shard.byteSize) byteMismatch += 1;
    if (sha256HexSync(text) !== shard.checksumSha256) checksumMismatch += 1;
    for (const feature of JSON.parse(text).features) {
      if (feature.geometry?.type !== "Polygon") continue;
      sources.set(feature.parentId, {
        buildingId: feature.parentId,
        representative: feature.coordinates,
        outerRing: feature.geometry.coordinates[0],
        holeRings: feature.geometry.coordinates.slice(1),
        heightMeters: feature.heightMeters,
        heightUnknown: feature.heightUnknown === true,
        sourceRefId: feature.sourceRefIds[0],
      });
    }
  }
  if (byteMismatch > 0) fail(`${byteMismatch} building shards do not match their declared byte size.`);
  if (checksumMismatch > 0) fail(`${checksumMismatch} building shards do not match their declared SHA-256 checksum.`);
  if (sources.size !== EXTERIOR_WAVE_BASE_BUILDING_COUNT) fail(`Verified shards yielded ${sources.size} parents, expected ${EXTERIOR_WAVE_BASE_BUILDING_COUNT}.`);
  return { gate, sources };
}

async function loadLedger() {
  const ledger = JSON.parse(await readFile(join(ledgerRoot, "ledger.json"), "utf8"));
  const checksum = exteriorArtifactChecksum(ledger);
  const recorded = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (recorded !== checksum) fail(`Committed ledger checksum ${checksum} does not match its recorded ${recorded}.`);
  const validation = validateExteriorWaveLedger(ledger);
  if (!validation.ok) fail(`Committed ledger fails its own schema: ${JSON.stringify(validation.issues.slice(0, 3))}`);
  return { ledger, ledgerChecksumSha256: checksum };
}

// ---------------------------------------------------------------------------
// Gate-failure vectors
// ---------------------------------------------------------------------------

/**
 * Every admission gate of the grammar, evaluated INDEPENDENTLY.
 *
 * `classifyMidtownCoreV3Ring` is priority-ordered and returns the first gate a
 * ring fails, which is the right thing for a stop code and the wrong thing for
 * this census: it cannot distinguish a building the vertex cap alone refused
 * from one that also has a 12 m² footprint. Both are needed to say whether a
 * raised cap RECOVERS a building or merely RECLASSIFIES it, so every gate is
 * evaluated here rather than inferred from the winner.
 *
 * This re-derivation is used only to DESCRIBE refusals the grammar already made.
 * Nothing here can refuse a building or admit one.
 */
export function gateFailureVector(source) {
  let ring = source.outerRing;
  if (ring.length > 1
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
  const frame = enuFrame({ longitude: source.representative[0], latitude: source.representative[1] });
  const raw = ring.map((point) => {
    const [east, north] = toEnuMeters(frame, point);
    return [Math.round(east * 1_000), Math.round(north * 1_000)];
  });
  const collapsed = [];
  for (const point of raw) {
    const last = collapsed[collapsed.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    collapsed.push(point);
  }
  while (collapsed.length > 1) {
    const first = collapsed[0];
    const last = collapsed[collapsed.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) collapsed.pop(); else break;
  }
  const vertexCount = collapsed.length;
  const oriented = vertexCount >= 3 && ringSignedAreaMm2(collapsed) < 0 ? [...collapsed].reverse() : collapsed;
  const heightMm = Math.round((source.heightMeters === null || source.heightUnknown ? MIDTOWN_CORE_FALLBACK_HEIGHT_METERS : source.heightMeters) * 1_000);

  const vector = {
    vertexCount,
    heightMm,
    heightIsFallback: source.heightMeters === null || source.heightUnknown === true,
    degenerateFootprint: vertexCount < DETERMINISTIC_FACADE_V3_LIMITS.minRingVertices,
    vertexCountAboveShippedCap: vertexCount > SHIPPED_GRAMMAR_OPTIONS.maxRingVertices,
    vertexCountAboveExtendedCap: vertexCount > V3_EXTENDED_GRAMMAR_OPTIONS.maxRingVertices,
    ringNotSimple: null,
    areaMm2: null,
    areaBelowFloor: null,
    localThicknessMm: null,
    neckBelowGrammarMinimum: null,
    heightBelowNominalFloor: heightMm < V3_LOW_RISE_HEIGHT_THRESHOLD_MM,
    heightBelowThreeMeters: heightMm < 3_000,
  };
  if (vertexCount >= DETERMINISTIC_FACADE_V3_LIMITS.minRingVertices) {
    vector.ringNotSimple = !ringIsSimple(oriented);
    const area = Math.abs(ringSignedAreaMm2(oriented));
    vector.areaMm2 = area;
    vector.areaBelowFloor = area < DETERMINISTIC_FACADE_V3_LIMITS.minRingAreaMm2;
    if (!vector.ringNotSimple) {
      // The grammar's own minimum: two opposed recesses plus a wall.
      const thickness = ringLocalThicknessMm(oriented);
      vector.localThicknessMm = Number.isFinite(thickness) ? Math.round(thickness) : -1;
      vector.neckBelowGrammarMinimum = thickness < 600;
    }
  }
  return vector;
}

// ---------------------------------------------------------------------------
// The two passes
// ---------------------------------------------------------------------------

/**
 * LOD-0 GLB vertex count, read back out of the bytes the writer just emitted.
 *
 * T001's committed UV/JSON byte regression is stated PER GLB VERTEX, not per
 * ring vertex, and the two differ by orders of magnitude — a 19-vertex ring
 * emits thousands of GLB vertices once every bay, recess and cap is tessellated.
 * Projecting the regression from the ring count would understate the texture
 * consequence by roughly that factor, so the real number is parsed rather than
 * approximated.
 */
function glbVertexCount(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
  return json.meshes[0].primitives.reduce((total, primitive) => total + json.accessors[primitive.attributes.POSITION].count, 0);
}


/**
 * Plans every parent under one envelope, and writes both canonical GLBs for the
 * parents `assetFor` selects.
 *
 * The asset stage matters because the plan stage is not the last gate: the
 * writer's analytic-volume identity, its registration tolerance and its budgets
 * all refuse buildings whose plan was already accepted. A census that stopped at
 * the plan stage would report a recovery the release would not honour.
 */
function runPass(label, sources, order, ownerCellOf, grammar, assetFor) {
  const startedAt = Date.now();
  // Wave `w01`'s profile with its DECLARED envelope replaced by THIS pass's
  // (T004 F1). This census is the one caller that deliberately puts one profile
  // through two envelopes in a single process, so it is also the one caller
  // that has to say which envelope each pass is writing under. Only
  // `admissionEnvelope` differs from the bare profile and no emitted byte
  // depends on it, so every number in the committed record is unchanged.
  const writeProfile = { ...MIDTOWN_CORE_V3_WAVE_PROFILE, admissionEnvelope: grammar };
  const planned = new Map();
  const refused = new Map();
  const cost = new Map();
  let planMs = 0;
  let assetMs = 0;
  for (const buildingId of order) {
    const source = sources.get(buildingId);
    if (!source) { refused.set(buildingId, { code: "absent-from-base-shards", stage: "source" }); continue; }
    const planStarted = Date.now();
    let context;
    try {
      context = buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, undefined, grammar);
    } catch (error) {
      if (!(error instanceof MidtownCoreV3Stop)) throw error;
      planMs += Date.now() - planStarted;
      refused.set(buildingId, { code: error.code, stage: "plan" });
      continue;
    }
    planMs += Date.now() - planStarted;
    planned.set(buildingId, context.plan.planHashSha256);
    if (!assetFor(buildingId)) continue;
    const assetStarted = Date.now();
    try {
      const written = writeMidtownCoreV3Assets(context, {
        ownerCellId: ownerCellOf.get(buildingId),
        capturedAt: null,
        updatedAt: null,
        predecessor: null,
        profile: writeProfile,
      });
      assetMs += Date.now() - assetStarted;
      cost.set(buildingId, {
        ringVertexCount: context.ringMm.length,
        placementCount: context.plan.placements.length,
        floorCount: context.plan.massing.floorCount,
        effectiveTierCount: context.plan.massing.effectiveTierCount,
        lod0VertexCount: glbVertexCount(written.assets[0].bytes),
        lod0TriangleCount: written.assets[0].counts.triangleCount,
        lod1TriangleCount: written.assets[1].counts.triangleCount,
        lod0ByteSize: written.assets[0].bytes.byteLength,
        lod1ByteSize: written.assets[1].bytes.byteLength,
        planWallClockMs: Date.now() - planStarted,
      });
    } catch (error) {
      if (!(error instanceof MidtownCoreV3Stop)) throw error;
      assetMs += Date.now() - assetStarted;
      // A plan the writer refuses is NOT a materialized building.
      planned.delete(buildingId);
      refused.set(buildingId, { code: error.code, stage: "asset" });
    }
  }
  console.error(`[${label}] planned=${planned.size} refused=${refused.size} plan=${(planMs / 1_000).toFixed(1)}s asset=${(assetMs / 1_000).toFixed(1)}s`);
  return { planned, refused, cost, planSeconds: Number((planMs / 1_000).toFixed(1)), assetSeconds: Number((assetMs / 1_000).toFixed(1)), wallSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)) };
}

const tally = (rows, key) => rows.reduce((counts, row) => {
  const value = typeof key === "function" ? key(row) : row[key];
  counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}, {});
const quantiles = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
  return { min: sorted[0], median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
};

export async function computeExtensionCensus() {
  const { gate, sources } = await loadSources();
  const { ledger, ledgerChecksumSha256 } = await loadLedger();
  const cells = [...ledger.cells].sort((left, right) => left.order - right.order);
  const ownerCellOf = new Map();
  const order = [];
  for (const cell of cells) for (const buildingId of cell.buildingIds) { ownerCellOf.set(buildingId, cell.cellId); order.push(buildingId); }

  // Pass 1 writes assets for EVERY accepted parent, because the 899 ledger
  // includes asset-stage refusals that no plan-stage pass can see.
  const shipped = runPass("shipped", sources, order, ownerCellOf, SHIPPED_GRAMMAR_OPTIONS, () => true);
  // Pass 2 writes assets only where pass 1 did not. Everywhere else the plan
  // hash is proved identical below, and an identical plan writes identical bytes.
  const extended = runPass("extended", sources, order, ownerCellOf, V3_EXTENDED_GRAMMAR_OPTIONS, (id) => !shipped.planned.has(id));

  const acceptedIds = [...shipped.planned.keys()].sort();
  const digestOf = (planned) => domainSeparatedSha256(
    "udt.t003.grammar-extension.accepted-plan-hash-set",
    acceptedIds.map((id) => `${id}\t${planned.get(id) ?? "MISSING"}`),
  );
  const shippedDigest = digestOf(shipped.planned);
  const extendedDigest = digestOf(extended.planned);
  const movedPlanHashes = acceptedIds.filter((id) => extended.planned.get(id) !== shipped.planned.get(id));

  const refusedIds = [...shipped.refused.keys()].sort();
  const rows = refusedIds.map((buildingId) => {
    const before = shipped.refused.get(buildingId);
    const recovered = extended.planned.has(buildingId);
    const after = extended.refused.get(buildingId) ?? null;
    return {
      buildingId,
      ownerCellId: ownerCellOf.get(buildingId) ?? null,
      shippedStopCode: before.code,
      shippedStopStage: before.stage,
      extendedOutcome: recovered ? "generated" : "refused",
      extendedStopCode: recovered ? null : after.code,
      extendedStopStage: recovered ? null : after.stage,
      reclassified: !recovered && after.code !== before.code,
      gates: gateFailureVector(sources.get(buildingId)),
      cost: extended.cost.get(buildingId) ?? null,
    };
  });
  const recoveredRows = rows.filter((row) => row.extendedOutcome === "generated");
  const residualRows = rows.filter((row) => row.extendedOutcome === "refused");

  const areaRows = rows.filter((row) => row.gates.areaBelowFloor === true);
  const areaSquareMeters = areaRows.map((row) => Number((row.gates.areaMm2 / 1e6).toFixed(3)));
  const areaBands = {};
  for (const value of areaSquareMeters) {
    const band = Math.floor(value / 2) * 2;
    areaBands[`${band}-${band + 2}`] = (areaBands[`${band}-${band + 2}`] ?? 0) + 1;
  }

  const heightRows = rows.filter((row) => row.shippedStopCode === "source-height-below-grammar-minimum");
  const vertexRows = rows.filter((row) => row.shippedStopCode === "ring-vertex-count-unsupported");
  const costRows = recoveredRows.filter((row) => row.cost);

  return {
    schemaVersion: "1.0",
    censusId: CENSUS_ID,
    taskId: "T003",
    artifact: "grammar-extension-differential-and-refusal-census",
    note: "CENSUS ONLY. Every accepted parent of the pinned base was planned TWICE in one process — under the shipped admission envelope and under the extended one — through the V3GrammarOptions seam rather than by mutating module state. No GLB was retained, no release was touched, and no default was changed: both extensions are inert in the shipped grammar and this record is the measurement a decision to activate them would rest on.",
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256: gate.observedManifestChecksumSha256 },
    ledger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, ledgerId: ledger.ledgerId, checksumSha256: ledgerChecksumSha256 },
    generatorIdentity: {
      id: DETERMINISTIC_FACADE_V3_GENERATOR_ID,
      version: DETERMINISTIC_FACADE_V3_GENERATOR_VERSION,
      schemaVersion: DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
      note: "The generator version is NOT bumped by this task. It is embedded in every plan through `inventory.components[].generator.version`, so bumping it would move every committed plan hash.",
    },
    envelopes: { shipped: SHIPPED_GRAMMAR_OPTIONS, extended: { ...V3_EXTENDED_GRAMMAR_OPTIONS } },
    counts: {
      enumerated: order.length,
      shippedPlanned: shipped.planned.size,
      shippedRefused: shipped.refused.size,
      extendedPlanned: extended.planned.size,
      recovered: recoveredRows.length,
      residualRefused: residualRows.length,
    },
    goalLedgerReconciliation: {
      committed: { ...GOAL_LEDGER },
      observedMaterialized: shipped.planned.size,
      observedRefused: shipped.refused.size,
      materializedAgrees: shipped.planned.size === GOAL_LEDGER.materialized,
      refusedAgrees: shipped.refused.size === GOAL_LEDGER.refused,
      note: "The committed 899 is the sum of the six wave censuses' asset-stage refusals. This pass re-derives it end to end from the pinned snapshot with one profile for all six waves, so agreement is also evidence that refusal is a function of the sourced polygon rather than of a wave's seed.",
    },
    differential: {
      method: "Domain-separated SHA-256 over the sorted `buildingId\\tplanHashSha256` list of every parent the SHIPPED envelope accepts, computed once per envelope in one process. Cardinality equality is not identity and is not what is asserted.",
      domain: "udt.t003.grammar-extension.accepted-plan-hash-set",
      acceptedSetSize: acceptedIds.length,
      shippedDigestSha256: shippedDigest,
      extendedDigestSha256: extendedDigest,
      byteEqual: shippedDigest === extendedDigest,
      movedPlanHashCount: movedPlanHashes.length,
      movedPlanHashExamples: movedPlanHashes.slice(0, 5),
    },
    reclassificationVersusRecovery: {
      note: "RECOVERY is a building the extended envelope materializes. RECLASSIFICATION is a building it still refuses under a DIFFERENT code, because the shipped classifier is priority-ordered and a raised gate exposes the next one. They are counted separately on purpose: a reclassified building is not progress.",
      shippedStopCodeDistribution: tally(rows, "shippedStopCode"),
      recoveredByShippedStopCode: tally(recoveredRows, "shippedStopCode"),
      residualByShippedStopCode: tally(residualRows, "shippedStopCode"),
      residualByExtendedStopCode: tally(residualRows, "extendedStopCode"),
      reclassifiedCount: residualRows.filter((row) => row.reclassified).length,
      reclassificationTransitions: tally(residualRows.filter((row) => row.reclassified), (row) => `${row.shippedStopCode} -> ${row.extendedStopCode}`),
    },
    extensionA: {
      change: `ring-vertex admission cap ${SHIPPED_GRAMMAR_OPTIONS.maxRingVertices} -> ${V3_EXTENDED_GRAMMAR_OPTIONS.maxRingVertices}`,
      shippedRefusedCount: vertexRows.length,
      recovered: vertexRows.filter((row) => row.extendedOutcome === "generated").length,
      residualByExtendedStopCode: tally(vertexRows.filter((row) => row.extendedOutcome === "refused"), "extendedStopCode"),
      ringVertexCountOfRefusedSet: quantiles(vertexRows.map((row) => row.gates.vertexCount)),
      shipsNoDesignedMassing: "The sourced ring is carried vertex for vertex at the sourced height. This extension widens an admission gate and is read nowhere else, so it introduces no designed geometry and DETERMINISTIC_FACADE_V3_UNCERTAINTY stays literally true.",
    },
    extensionB: {
      change: `targetFloorHeightMm derived from the sourced height below ${V3_LOW_RISE_HEIGHT_THRESHOLD_MM} mm, so floorCount is 1`,
      shippedRefusedCount: heightRows.length,
      recovered: heightRows.filter((row) => row.extendedOutcome === "generated").length,
      residualByExtendedStopCode: tally(heightRows.filter((row) => row.extendedOutcome === "refused"), "extendedStopCode"),
      // Split at 3.0 m, because a 3.2 m storey and a 2.1 m bulkhead are
      // different claims about what the source is describing.
      bandThreeToThreeSix: {
        total: heightRows.filter((row) => !row.gates.heightBelowThreeMeters).length,
        recovered: heightRows.filter((row) => !row.gates.heightBelowThreeMeters && row.extendedOutcome === "generated").length,
      },
      bandBelowThree: {
        total: heightRows.filter((row) => row.gates.heightBelowThreeMeters).length,
        recovered: heightRows.filter((row) => row.gates.heightBelowThreeMeters && row.extendedOutcome === "generated").length,
      },
      fallbackHeightAmongThem: heightRows.filter((row) => row.gates.heightIsFallback).length,
      heightMmQuantiles: quantiles(heightRows.map((row) => row.gates.heightMm)),
      tombstoneExclusion: "The full-city dry run (data/normalized/manhattan-exterior-fullsnapshot-dryrun-20260810/evidence.json) records stopsByCode.invalid-height = 0 over all 45,194 parents, so none of this set is a tombstone: every one carries a real sourced height. The 76 heightUnknown parents take the 10 m fallback and are not in it, which `fallbackHeightAmongThem` re-measures rather than assumes.",
    },
    extensionC: {
      change: "NONE. The sub-20 m² footprints are measured and left refused.",
      belowAreaFloorCount: areaRows.length,
      shippedStopCodeOfThoseRows: tally(areaRows, "shippedStopCode"),
      areaSquareMeters: quantiles(areaSquareMeters),
      areaBandCounts: areaBands,
      localThicknessMm: quantiles(areaRows.map((row) => row.gates.localThicknessMm).filter((value) => typeof value === "number" && value >= 0)),
      belowGrammarNeckMinimum: areaRows.filter((row) => row.gates.neckBelowGrammarMinimum === true).length,
      alsoFailingOtherGates: {
        vertexCountAboveShippedCap: areaRows.filter((row) => row.gates.vertexCountAboveShippedCap).length,
        ringNotSimple: areaRows.filter((row) => row.gates.ringNotSimple === true).length,
        heightBelowNominalFloor: areaRows.filter((row) => row.gates.heightBelowNominalFloor).length,
      },
    },
    recoveredCost: {
      buildings: costRows.length,
      ringVertexCount: quantiles(costRows.map((row) => row.cost.ringVertexCount)),
      placementCount: quantiles(costRows.map((row) => row.cost.placementCount)),
      lod0TriangleCount: quantiles(costRows.map((row) => row.cost.lod0TriangleCount)),
      lod1TriangleCount: quantiles(costRows.map((row) => row.cost.lod1TriangleCount)),
      bothLodByteSize: quantiles(costRows.map((row) => row.cost.lod0ByteSize + row.cost.lod1ByteSize)),
      bothLodByteTotal: costRows.reduce((total, row) => total + row.cost.lod0ByteSize + row.cost.lod1ByteSize, 0),
      planWallClockMs: quantiles(costRows.map((row) => row.cost.planWallClockMs)),
      lod0VertexCount: quantiles(costRows.map((row) => row.cost.lod0VertexCount)),
      projectedUvAndJsonByteDelta: {
        note: "T001's committed per-vertex regression (uv-delta.json): 7.9648 B per LOD-0 GLB VERTEX + 592.7 B, applied to the RECOVERED set as a projection, not a measurement. The vertex count is read back out of each emitted GLB rather than approximated from the ring, because the two differ by orders of magnitude. Compared against that record's worst stratum (ring-41-64: median 42,236 B, p95 238,900 B).",
        ...quantiles(costRows.map((row) => Math.round(7.9648 * row.cost.lod0VertexCount + 592.7))),
        worstCommittedStratumMedianBytes: 42_236,
        worstCommittedStratumP95Bytes: 238_900,
      },
    },
    projectionReconciliation: {
      t001ProjectedFullCityAssetCount: T001_PROJECTED_FULL_CITY_ASSET_COUNT,
      impliedRecoverable: T001_PROJECTED_FULL_CITY_ASSET_COUNT - GOAL_LEDGER.materialized,
      observedRecoverable: recoveredRows.length,
      note: "T001 projected a full-city asset count that implies 821 of the 899 are recoverable. This census measures the number rather than inheriting it.",
    },
    closedStopCodeVocabulary: [...MIDTOWN_CORE_V3_STOP_CODES],
    stopCodesAdded: [],
    timings: {
      shippedPassSeconds: shipped.wallSeconds,
      extendedPassSeconds: extended.wallSeconds,
      shippedPlanSeconds: shipped.planSeconds,
      shippedAssetSeconds: shipped.assetSeconds,
      extendedPlanSeconds: extended.planSeconds,
      extendedAssetSeconds: extended.assetSeconds,
      note: "Host wall clock, recorded here rather than in the deterministic body's counts. Every other field is a function of the pinned snapshot, the committed ledger and this repository's code.",
    },
    refusals: rows,
    retention: "census-only",
  };
}

export function censusInvariants(record) {
  const issues = [];
  const counts = record.counts;
  if (counts.shippedPlanned + counts.shippedRefused !== counts.enumerated) issues.push("shipped planned + refused does not equal the enumerated parents");
  if (counts.recovered + counts.residualRefused !== counts.shippedRefused) issues.push("recovered + residual does not equal the shipped refusal count");
  if (counts.extendedPlanned !== counts.shippedPlanned + counts.recovered) issues.push("extended planned is not the shipped accepted set plus the recovered set");
  if (record.refusals.length !== counts.shippedRefused) issues.push("the per-building refusal ledger does not enumerate every refusal");
  if (!record.differential.byteEqual) issues.push("the differential plan-hash set digest is not byte-equal between envelopes");
  if (record.differential.movedPlanHashCount !== 0) issues.push("at least one accepted plan hash moved under the extended envelope");
  if (!record.goalLedgerReconciliation.refusedAgrees || !record.goalLedgerReconciliation.materializedAgrees) issues.push("the re-derived ledger disagrees with the committed 899 / 44,295");
  const vocabulary = new Set(record.closedStopCodeVocabulary);
  for (const row of record.refusals) {
    if (!vocabulary.has(row.shippedStopCode)) issues.push(`shipped stop code ${row.shippedStopCode} is outside the closed vocabulary`);
    if (row.extendedStopCode !== null && !vocabulary.has(row.extendedStopCode)) issues.push(`extended stop code ${row.extendedStopCode} is outside the closed vocabulary`);
  }
  return issues;
}

async function runCli(argv) {
  const mode = argv[0];
  if (mode === "check") {
    const record = JSON.parse(await readFile(RECORD_PATH, "utf8"));
    const issues = censusInvariants(record);
    console.log(serialize({ ok: issues.length === 0, checkedPath: RECORD_PATH, issues }));
    return issues.length === 0 ? 0 : 1;
  }
  if (mode !== "run") {
    console.error("Usage: node scripts/grammar-extension-census-cli.mjs <run|check> [--out <path>]");
    return 2;
  }
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? resolve(argv[outIndex + 1]) : RECORD_PATH;
  const record = await computeExtensionCensus();
  const issues = censusInvariants(record);
  await mkdir(dirname(outPath), { recursive: true });
  const text = serialize(record);
  await writeFile(outPath, text, "utf8");
  const checksum = sha256HexSync(text);
  await writeFile(outPath.replace(/\.json$/u, ".sha256"), `${checksum}  ${outPath.split("/").pop()}\n`, "utf8");
  console.log(serialize({
    ok: issues.length === 0,
    outPath,
    checksumSha256: checksum,
    issues,
    counts: record.counts,
    differential: { shipped: record.differential.shippedDigestSha256, extended: record.differential.extendedDigestSha256, byteEqual: record.differential.byteEqual },
  }));
  return issues.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli(process.argv.slice(2));
}
