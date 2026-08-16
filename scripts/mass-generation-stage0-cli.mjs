#!/usr/bin/env node
/* global console, performance, process, TextEncoder */
/**
 * MASS-GENERATION STAGE 0 — the pre-generation gate (Task T004). LOCAL ONLY.
 *
 * Stage 0 is the gate the six mass-generation waves are NOT allowed to start
 * before. It generates no wave payload, retains no GLB, writes nothing under
 * `public/`, touches no committed release, census or reconciliation record, and
 * acquires nothing: an absent or drifted snapshot is a fail-closed stop with an
 * operator message, never a download. Every asset it writes is counted, timed
 * and dropped.
 *
 * WHAT IT MEASURES, and why each one is a gate rather than a report:
 *
 *   (1) FROZEN STAGE FINGERPRINTS. Every committed wave profile's resumable
 *       stage fingerprint, so the T004 grammar-envelope and texture-delivery
 *       keys are proved not to have moved a single frozen wave's receipts.
 *
 *   (2) THE PRE-FLIGHT SILHOUETTE STRIDE. A 1-in-20 walk of the ledger order —
 *       every twentieth owned parent — planned and WRITTEN AT BOTH LEVELS OF
 *       DETAIL under the extended admission envelope plus the two ADR 0049
 *       rooftop rules, with the LOD 0 / LOD 1 projected-silhouette deviation
 *       measured for each. The decisive number is the COUNT AT OR OVER 0.02:
 *       the multi-LOD assembly schema refuses any coarse level above it, so a
 *       single building over the cap means the two-LOD contract needs
 *       re-deciding before any wave runs. It is a stride rather than the whole
 *       island because the whole island at both LODs is the wave itself, and
 *       Stage 0 exists to decide whether that may start.
 *
 *   (3) THE POST-FIX ROOFTOP RE-MEASUREMENT, over the SAME stride and in the
 *       same process, so pre-fix and post-fix are the same buildings measured
 *       twice rather than two populations compared. Orphan legs must be zero;
 *       the cluster-top ratio distribution is reported at both states.
 *
 *   (4) THE SUB-METRE PARENTS, enumerated over all 45,194 rather than sampled:
 *       their ids, their sourced heights, and their post-clamp ratios.
 *
 *   (5) THE TEXTURED SHARED-URI WRITE COST, per asset, from the real writer on
 *       a real profile, projected to the six-wave writer time as a RANGE.
 *
 * WHAT IT DOES NOT DO. It changes no default, approves no activation, and
 * proves nothing visual, geographic or architectural. Passing every number here
 * is a statement about deterministic properties of this repository's own code
 * against a pinned snapshot, and nothing more.
 *
 * RUNTIME. Imports `.ts` directly and relies on Node's native type stripping, so
 * it requires Node >= 24 and takes no flag.
 *
 * Usage:
 *   node scripts/mass-generation-stage0-cli.mjs run [--stride <n>] [--texture-sample <n>]
 *   node scripts/mass-generation-stage0-cli.mjs check
 */
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  DETERMINISTIC_FACADE_V3_GENERATOR_ID,
  DETERMINISTIC_FACADE_V3_GENERATOR_VERSION,
  DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
  V3_EXTENDED_GRAMMAR_OPTIONS,
  V3_NOMINAL_FLOOR_HEIGHT_MM,
  V3_ROOFTOP_HONESTY_OPTIONS,
  V3_SHIPPED_GRAMMAR_OPTIONS,
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
  MIDTOWN_CORE_V3_WAVE_PROFILE,
  MidtownCoreV3Stop,
  buildMidtownCoreV3Plan,
  writeMidtownCoreV3Assets,
} from "../src/release/midtown-core-v3-materialization.ts";
import { midtownCoreV3StageFingerprint } from "../src/release/midtown-core-v3-source.ts";
import {
  MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO,
  midtownCoreV3SilhouetteMeasurement,
  midtownCoreV3SilhouetteRectangles,
  rectangleUnionAreaMm2,
} from "../src/release/midtown-core-v3-silhouette.ts";
import { LOWER_MANHATTAN_CENSUS_PROFILE, LOWER_MANHATTAN_WAVE_PROFILE } from "../src/release/lower-manhattan-release.ts";
import { LOWER_MANHATTAN_P1_WAVE_PROFILE } from "../src/release/lower-manhattan-p1-release.ts";
import { CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE, CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE } from "../src/release/central-upper-manhattan-release.ts";
import { CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE } from "../src/release/central-upper-manhattan-p1-release.ts";
import { NORTHERN_MANHATTAN_CENSUS_PROFILE, NORTHERN_MANHATTAN_WAVE_PROFILE } from "../src/release/northern-manhattan-release.ts";
import { NORTHERN_MANHATTAN_P1_WAVE_PROFILE } from "../src/release/northern-manhattan-p1-release.ts";
import { SOUTHERN_REMAINDER_CENSUS_PROFILE, SOUTHERN_REMAINDER_WAVE_PROFILE } from "../src/release/southern-remainder-release.ts";
import { SOUTHERN_REMAINDER_P1_WAVE_PROFILE } from "../src/release/southern-remainder-p1-release.ts";
import { EXTERIOR_T1_VARIANTS } from "../src/release/exterior-t1-variants.ts";
import { isSafeReleaseArtifactReference } from "../src/runtime/path-security.ts";

export const RECORD_ID = "mass-generation-20260816";
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RECORD_DIR = join(repositoryRoot, "data", RECORD_ID);
export const STRIDE_PATH = join(RECORD_DIR, "stage0-preflight-stride.json");
export const FINGERPRINT_PATH = join(RECORD_DIR, "stage0-frozen-fingerprints.json");
export const TEXTURE_COST_PATH = join(RECORD_DIR, "stage0-textured-write-cost.json");
export const GATE_PATH = join(RECORD_DIR, "stage0-gate.json");

const snapshotRoot = join(repositoryRoot, "public", "data", EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);

/** Every twentieth owned parent, in ledger order. */
export const DEFAULT_STRIDE = 20;
/** Buildings put through the shared-URI textured writer for the cost projection. */
export const DEFAULT_TEXTURE_SAMPLE = 100;
/** The six waves' owned-parent counts, from the committed wave censuses. */
export const WAVE_OWNED_PARENTS = { w00: 14, w01: 7_201, w02: 6_425, w03: 9_603, w04: 11_721, w05: 10_230 };
/** The T003 committed differential digest this task must reproduce unmoved. */
export const T003_DIFFERENTIAL_DIGEST = "fd22c08a19fe0a225cd81301fb0e485f6a1851b0b8054a58eab393aa32077667";

/**
 * The grammar the waves would run under: the T003 admission envelope PLUS the
 * two ADR 0049 rooftop rules. Named once, here, and never made a default.
 */
export const MASS_GENERATION_GRAMMAR = { ...V3_EXTENDED_GRAMMAR_OPTIONS, ...V3_ROOFTOP_HONESTY_OPTIONS };
/** The same admission envelope WITHOUT the rooftop fixes: the pre-fix state. */
export const PRE_FIX_GRAMMAR = { ...V3_EXTENDED_GRAMMAR_OPTIONS };

function fail(message) {
  console.error(`STOP: ${message}`);
  process.exit(1);
}
function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
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
  return { min: sorted[0], median: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] };
};
const round = (value, places) => (Number.isFinite(value) ? Number(value.toFixed(places)) : value);

// ---------------------------------------------------------------------------
// Fail-closed inputs. A faithful copy of the T003 census gate: the committed
// census CLI is pinned by its own drift test and is not edited to be shared.
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
  if (!gate.ok) fail(`${gate.message}\n\nStage 0 cannot run against an unverified base. Nothing was written.`);

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
// (1) Frozen stage fingerprints
// ---------------------------------------------------------------------------

const FROZEN_PROFILES = [
  ["w01 midtown-core", MIDTOWN_CORE_V3_WAVE_PROFILE],
  ["lower-manhattan wave", LOWER_MANHATTAN_WAVE_PROFILE],
  ["lower-manhattan census", LOWER_MANHATTAN_CENSUS_PROFILE],
  ["lower-manhattan p1", LOWER_MANHATTAN_P1_WAVE_PROFILE],
  ["central-upper wave", CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE],
  ["central-upper census", CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE],
  ["central-upper p1", CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE],
  ["northern wave", NORTHERN_MANHATTAN_WAVE_PROFILE],
  ["northern census", NORTHERN_MANHATTAN_CENSUS_PROFILE],
  ["northern p1", NORTHERN_MANHATTAN_P1_WAVE_PROFILE],
  ["southern wave", SOUTHERN_REMAINDER_WAVE_PROFILE],
  ["southern census", SOUTHERN_REMAINDER_CENSUS_PROFILE],
  ["southern p1", SOUTHERN_REMAINDER_P1_WAVE_PROFILE],
];

/**
 * The values these fingerprints had at 9e120e1, the commit before the grammar
 * envelope and texture-delivery keys existed. Pinned to literals rather than
 * compared to each other, because a self-comparison passes just as happily when
 * every value has moved together.
 */
export const FROZEN_FINGERPRINTS_AT_9E120E1 = {
  "w01 midtown-core": "5bfdf427a770d3e17b987e489d983445cbab94851d8c7bc682ad198f4c0b3bfa",
  "lower-manhattan wave": "b8172986a852cc65b2bc11e70440943ed5b3a8f2dbede7d86d659c911ca5ebe0",
  "lower-manhattan census": "cb08522d06477d7b0ede310d8272efec16f1f6a8d62ae22f6c1c55a11bc4d7f7",
  "lower-manhattan p1": "2eacab3b98817a04c28216abbcc92aeff05e09b66f0f798930e2f1000acf5354",
  "central-upper wave": "67cbdbf3f1ead08acc6b6566d2d9a27a8d5262f7e91ada96d2c2d8ba6b7a459b",
  "central-upper census": "07759bea30b9f467d894651c1dd02193ad0b431ac74e3e611709f6e5ff5fac28",
  "central-upper p1": "54e62bbf5cd900a6323153e7c4f415976594a6f25668a4996d4762ecc9d28b40",
  "northern wave": "66e2edc7f0e9acd72733babf462380e0361149a918d07881b8db52bed520666c",
  "northern census": "c2aa7dc5ff29790cbdc24d46e9a9d174e30e8b7e27a4e37388202fb752bb1803",
  "northern p1": "157c2f80cb56406325a1bbec6c67770648ce25c1caf76a26192282a1c7b10a12",
  "southern wave": "be86acf3c09063b43f5d10df7b3e1d1394da12bac42ea0f8ce30617c1f71239a",
  "southern census": "771fba82803df43820ebe7a5a6bd2ce203f9a787c11d9b060e39d29a7b88c1b3",
  "southern p1": "ec278816c6f2ebc8a32222d7f5e947860614013fd9bd57d2e94fa7fae6ad1477",
};

const FINGERPRINT_INPUT = {
  stage: "plans",
  baseManifestChecksumSha256: "a".repeat(64),
  parentLedgerChecksumSha256: "b".repeat(64),
  subsetLedgerChecksumSha256: "c".repeat(64),
  predecessorInventoryChecksumSha256: "d".repeat(64),
  renderableCellCount: 7,
  shippedLodId: "lod_0",
};

export function computeFingerprintRecord() {
  const rows = FROZEN_PROFILES.map(([name, profile]) => {
    const observed = midtownCoreV3StageFingerprint({ ...FINGERPRINT_INPUT, profile });
    const committed = FROZEN_FINGERPRINTS_AT_9E120E1[name];
    return {
      profile: name,
      releaseId: profile.releaseId,
      declaredAdmissionEnvelope: profile.admissionEnvelope ?? null,
      textureDelivery: profile.textureDelivery ?? "embedded",
      fingerprintAt9e120e1: committed,
      fingerprintNow: observed,
      unmoved: observed === committed,
    };
  });
  const t1Rows = EXTERIOR_T1_VARIANTS.map((variant) => ({
    releaseId: variant.releaseId,
    textureDelivery: variant.waveProfile.textureDelivery,
    fingerprintNow: midtownCoreV3StageFingerprint({ ...FINGERPRINT_INPUT, profile: variant.waveProfile }),
    fingerprintUnderEmbedded: midtownCoreV3StageFingerprint({
      ...FINGERPRINT_INPUT,
      profile: { ...variant.waveProfile, textureDelivery: "embedded" },
    }),
  }));
  return {
    schemaVersion: "1.0",
    recordId: RECORD_ID,
    taskId: "T004",
    artifact: "stage0-frozen-stage-fingerprints",
    note: "The T004 grammar-envelope and texture-delivery keys enter midtownCoreV3StageFingerprint CONDITIONALLY. This is the measurement that every frozen wave profile's resumable-stage receipts are therefore unaffected. The pinned column was computed at commit 9e120e1, before either key existed.",
    frozenProfiles: rows,
    allUnmoved: rows.every((row) => row.unmoved),
    sharedUriVariants: {
      note: "The four -t1 variants DO move, deliberately: shared-uri delivery is the one substantive change that family exists for, and a receipt blind to it was the defect. Their stage receipts live in gitignored work roots and no committed record pins one.",
      variants: t1Rows,
      allMoved: t1Rows.every((row) => row.fingerprintNow !== row.fingerprintUnderEmbedded),
    },
  };
}

// ---------------------------------------------------------------------------
// (2)(3)(4) The pre-flight stride
// ---------------------------------------------------------------------------

const crownTopMm = (plan) => plan.tiers[plan.tiers.length - 1].topZMm;
const clusterTopMm = (plan) => plan.prisms.reduce((top, prism) => Math.max(top, prism.topZMm), crownTopMm(plan));
const orphanLegCount = (plan) => (plan.prisms.some((prism) => prism.kind === "water-tank")
  ? 0
  : plan.prisms.filter((prism) => prism.kind === "water-tank-leg").length);

/** Plans one building under one grammar, returning the plan or the stop code. */
function planUnder(source, grammar) {
  try {
    return { ok: true, context: buildMidtownCoreV3Plan(source, EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256, undefined, grammar) };
  } catch (error) {
    if (!(error instanceof MidtownCoreV3Stop)) throw error;
    return { ok: false, code: error.code };
  }
}

export async function computeStrideRecord(options) {
  const { gate, sources } = await loadSources();
  const { ledger, ledgerChecksumSha256 } = await loadLedger();
  const cells = [...ledger.cells].sort((left, right) => left.order - right.order);
  const ownerCellOf = new Map();
  const order = [];
  for (const cell of cells) for (const buildingId of cell.buildingIds) { ownerCellOf.set(buildingId, cell.cellId); order.push(buildingId); }

  const stride = options.stride;
  const strided = order.filter((_, index) => index % stride === 0);

  const startedAt = Date.now();
  const rows = [];
  const preFixRefusals = {};
  const postFixRefusals = {};
  for (const buildingId of strided) {
    const source = sources.get(buildingId);
    if (!source) { postFixRefusals["absent-from-base-shards"] = (postFixRefusals["absent-from-base-shards"] ?? 0) + 1; continue; }

    const pre = planUnder(source, PRE_FIX_GRAMMAR);
    const post = planUnder(source, MASS_GENERATION_GRAMMAR);
    if (!pre.ok) preFixRefusals[pre.code] = (preFixRefusals[pre.code] ?? 0) + 1;
    if (!post.ok) { postFixRefusals[post.code] = (postFixRefusals[post.code] ?? 0) + 1; continue; }

    // BOTH LEVELS OF DETAIL, through the real canonical writer, then dropped.
    let written;
    const assetStartedAt = performance.now();
    try {
      written = writeMidtownCoreV3Assets(post.context, {
        ownerCellId: ownerCellOf.get(buildingId),
        capturedAt: null,
        updatedAt: null,
        predecessor: null,
      });
    } catch (error) {
      if (!(error instanceof MidtownCoreV3Stop)) throw error;
      postFixRefusals[error.code] = (postFixRefusals[error.code] ?? 0) + 1;
      continue;
    }
    const assetMs = performance.now() - assetStartedAt;

    const postPlan = post.context.plan;
    rows.push({
      buildingId,
      ownerCellId: ownerCellOf.get(buildingId) ?? null,
      heightMm: postPlan.input.geometry.heightMm,
      heightIsFallback: post.context.heightSource === "fallback",
      ringVertexCount: post.context.ringMm.length,
      preFix: pre.ok
        ? {
          orphanLegCount: orphanLegCount(pre.context.plan),
          prismCount: pre.context.plan.prisms.length,
          clusterAboveCrownMm: clusterTopMm(pre.context.plan) - crownTopMm(pre.context.plan),
          clusterTopRatio: clusterTopMm(pre.context.plan) / crownTopMm(pre.context.plan),
        }
        : null,
      postFix: {
        orphanLegCount: orphanLegCount(postPlan),
        prismCount: postPlan.prisms.length,
        clusterAboveCrownMm: clusterTopMm(postPlan) - crownTopMm(postPlan),
        clusterTopRatio: clusterTopMm(postPlan) / crownTopMm(postPlan),
      },
      silhouette: {
        deviationRatio: written.silhouette.deviationRatio,
        worstViewId: written.silhouette.worstViewId,
        withinBound: written.silhouette.withinBound,
      },
      lod0TriangleCount: written.assets[0].counts.triangleCount,
      lod1TriangleCount: written.assets[1].counts.triangleCount,
      bothLodByteSize: written.assets[0].bytes.byteLength + written.assets[1].bytes.byteLength,
      bothLodWriteMs: assetMs,
    });
  }

  // (4) The sub-metre parents, over ALL owned parents rather than the stride.
  const subMetre = [];
  for (const buildingId of order) {
    const source = sources.get(buildingId);
    if (!source) continue;
    const heightMeters = source.heightMeters === null || source.heightUnknown ? null : source.heightMeters;
    if (heightMeters === null || heightMeters >= 1) continue;
    const post = planUnder(source, MASS_GENERATION_GRAMMAR);
    const preRow = planUnder(source, PRE_FIX_GRAMMAR);
    subMetre.push({
      buildingId,
      ownerCellId: ownerCellOf.get(buildingId) ?? null,
      sourcedHeightMeters: heightMeters,
      sourcedHeightMm: Math.round(heightMeters * 1_000),
      sourceRefId: source.sourceRefId,
      preFixOutcome: preRow.ok ? "generated" : preRow.code,
      preFixClusterTopRatio: preRow.ok ? round(clusterTopMm(preRow.context.plan) / crownTopMm(preRow.context.plan), 4) : null,
      postFixOutcome: post.ok ? "generated" : post.code,
      postFixClusterTopRatio: post.ok ? round(clusterTopMm(post.context.plan) / crownTopMm(post.context.plan), 4) : null,
      postFixClusterAboveCrownMm: post.ok ? clusterTopMm(post.context.plan) - crownTopMm(post.context.plan) : null,
      postFixSilhouetteDeviationRatio: null,
    });
  }
  for (const entry of subMetre) {
    const source = sources.get(entry.buildingId);
    const post = planUnder(source, MASS_GENERATION_GRAMMAR);
    if (!post.ok) continue;
    try {
      const written = writeMidtownCoreV3Assets(post.context, {
        ownerCellId: entry.ownerCellId, capturedAt: null, updatedAt: null, predecessor: null,
      });
      entry.postFixSilhouetteDeviationRatio = written.silhouette.deviationRatio;
    } catch (error) {
      if (!(error instanceof MidtownCoreV3Stop)) throw error;
      entry.postFixOutcome = error.code;
    }
  }

  const withPreFix = rows.filter((row) => row.preFix !== null);
  const overCap = rows.filter((row) => row.silhouette.deviationRatio >= MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO);

  // WHOSE DEFECT IS IT. A gate that reports "19 buildings are over the cap" and
  // stops there leaves the reader to assume T004 caused it. Each over-cap
  // building is therefore ALSO measured under the SHIPPED grammar, and the
  // deviation is attributed to the placement kinds that produce it by removing
  // one kind at a time from the fine level and re-measuring the worst view.
  const overCapAttribution = overCap.map((row) => {
    const source = sources.get(row.buildingId);
    const shipped = planUnder(source, V3_SHIPPED_GRAMMAR_OPTIONS);
    const shippedMeasurement = shipped.ok ? midtownCoreV3SilhouetteMeasurement(shipped.context.plan) : null;
    const plan = planUnder(source, MASS_GENERATION_GRAMMAR).context.plan;
    const worstViewId = row.silhouette.worstViewId;
    const fullArea = rectangleUnionAreaMm2(midtownCoreV3SilhouetteRectangles(plan, worstViewId, { includeAttachments: true }));
    const kinds = [...new Set(plan.placements.filter((placement) => placement.depthMm > 0).map((placement) => placement.kind))].sort();
    const attribution = {};
    for (const kind of kinds) {
      const withoutKind = { ...plan, placements: plan.placements.filter((placement) => placement.depthMm <= 0 || placement.kind !== kind) };
      const area = rectangleUnionAreaMm2(midtownCoreV3SilhouetteRectangles(withoutKind, worstViewId, { includeAttachments: true }));
      attribution[kind] = round((fullArea - area) / fullArea, 5);
    }
    const ring = plan.tiers[0].ring;
    const xs = ring.map((point) => point[0]);
    const ys = ring.map((point) => point[1]);
    return {
      buildingId: row.buildingId,
      heightMm: row.heightMm,
      floorCount: plan.massing.floorCount,
      effectiveTierCount: plan.massing.effectiveTierCount,
      footprintExtentMm: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)],
      ringVertexCount: row.ringVertexCount,
      worstViewId,
      deviationUnderShippedGrammar: shippedMeasurement === null ? null : shippedMeasurement.deviationRatio,
      shippedGrammarOutcome: shipped.ok ? "generated" : shipped.code,
      deviationUnderT004Grammar: row.silhouette.deviationRatio,
      t004Delta: shippedMeasurement === null ? null : row.silhouette.deviationRatio - shippedMeasurement.deviationRatio,
      deviationShareByPlacementKind: attribution,
    };
  });
  const preOrphanRows = withPreFix.filter((row) => row.preFix.orphanLegCount > 0);
  const postOrphanRows = rows.filter((row) => row.postFix.orphanLegCount > 0);

  return {
    schemaVersion: "1.0",
    recordId: RECORD_ID,
    taskId: "T004",
    artifact: "stage0-preflight-silhouette-and-rooftop-stride",
    note: "STAGE 0 GATE, NOT A WAVE. Every building below was planned and written at BOTH levels of detail through the real canonical GLB writer under the extended admission envelope plus the two ADR 0049 rooftop rules, and every byte was dropped. No GLB was retained, no release was assembled, no default was changed, and nothing was published. Pre-fix and post-fix are the SAME buildings measured twice in one process, not two populations compared.",
    base: { releaseId: EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID, manifestChecksumSha256: gate.observedManifestChecksumSha256 },
    ledger: { releaseId: EXTERIOR_WAVE_LEDGER_RELEASE_ID, ledgerId: ledger.ledgerId, checksumSha256: ledgerChecksumSha256 },
    generatorIdentity: {
      id: DETERMINISTIC_FACADE_V3_GENERATOR_ID,
      version: DETERMINISTIC_FACADE_V3_GENERATOR_VERSION,
      schemaVersion: DETERMINISTIC_FACADE_V3_SCHEMA_VERSION,
      note: "NOT bumped by T004. It is embedded in every plan through inventory.components[].generator.version, so bumping it would move every committed plan hash.",
    },
    grammars: {
      shipped: { ...V3_SHIPPED_GRAMMAR_OPTIONS },
      preFix: { ...PRE_FIX_GRAMMAR },
      postFix: { ...MASS_GENERATION_GRAMMAR },
      nominalFloorHeightMm: V3_NOMINAL_FLOOR_HEIGHT_MM,
    },
    stride: {
      note: "Every Nth owned parent in ledger order. A stride rather than the island because the island at both LODs IS the wave, and this gate exists to decide whether that may start.",
      step: stride,
      enumeratedOwnedParents: order.length,
      selected: strided.length,
      materialized: rows.length,
      // NOT SYMMETRIC, deliberately, and said so rather than left to be
      // noticed: the pre-fix pass only PLANS each building, so it can only see
      // plan-stage refusals. The post-fix pass also writes both assets, so it
      // additionally sees the writer's own stop codes (volume identity,
      // registration, budgets). The extra post-fix codes are therefore a
      // difference in what was RUN, not a regression caused by the fix.
      preFixRefusalsByCode: preFixRefusals,
      preFixRefusalStage: "plan only",
      postFixRefusalsByCode: postFixRefusals,
      postFixRefusalStage: "plan and asset",
    },
    silhouette: {
      note: "LOD 0 vs LOD 1 projected-silhouette deviation, metric `projected-silhouette-ratio` v1.0, four axis-aligned horizontal orthographic views, worst view reported. Computed EXACTLY by this repository's rectangle-union instrument over the plan's own solid parts, NOT rendered in Blender as the fourteen committed Block 835 measurements were. Schema compliance is not visual acceptance: a coarse level can sit inside a 2% area ratio and still read wrongly on screen.",
      maximumRatio: MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO,
      measured: rows.length,
      deviationRatio: quantiles(rows.map((row) => row.silhouette.deviationRatio)),
      countAtOrOverCap: overCap.length,
      shareAtOrOverCap: rows.length === 0 ? null : overCap.length / rows.length,
      worstBuildings: [...rows]
        .sort((left, right) => right.silhouette.deviationRatio - left.silhouette.deviationRatio)
        .slice(0, 10)
        .map((row) => ({
          buildingId: row.buildingId,
          deviationRatio: row.silhouette.deviationRatio,
          worstViewId: row.silhouette.worstViewId,
          heightMm: row.heightMm,
          ringVertexCount: row.ringVertexCount,
        })),
      worstViewDistribution: tally(rows, (row) => row.silhouette.worstViewId),
      verdict: overCap.length === 0 ? "WITHIN THE 2% CAP" : "OVER THE 2% CAP",
      overCapAttribution: {
        note: "WHOSE DEFECT IT IS. Each over-cap building is measured under the SHIPPED grammar as well, and its deviation is attributed to the placement kinds that produce it by removing one kind at a time from the fine level and re-measuring the worst view. `deviationShareByPlacementKind` values do not sum to the total: removing one kind can uncover another that was overlapping it, which is a property of a UNION area and not an error.",
        buildings: overCapAttribution,
        alreadyOverCapUnderShippedGrammar: overCapAttribution.filter((row) => row.deviationUnderShippedGrammar !== null && row.deviationUnderShippedGrammar >= MIDTOWN_CORE_V3_SILHOUETTE_MAXIMUM_RATIO).length,
        worstT004Delta: overCapAttribution.reduce((worst, row) => Math.max(worst, Math.abs(row.t004Delta ?? 0)), 0),
      },
    },
    rooftop: {
      note: "The ADR 0049 re-measurement. `orphanLegCount` counts water-tank legs shipped with no tank; the post-fix number is a gate and must be zero. `clusterTopRatio` is the cluster's top over the crown's own height, the same statement the reviewer's shipped 1.11 / 1.36 / 2.46 makes.",
      preFixMeasured: withPreFix.length,
      preFix: {
        orphanLegBuildings: preOrphanRows.length,
        orphanLegShare: withPreFix.length === 0 ? null : preOrphanRows.length / withPreFix.length,
        orphanLegTotal: withPreFix.reduce((total, row) => total + row.preFix.orphanLegCount, 0),
        clusterTopRatio: quantiles(withPreFix.map((row) => row.preFix.clusterTopRatio)),
        clusterAboveCrownMm: quantiles(withPreFix.map((row) => row.preFix.clusterAboveCrownMm)),
      },
      postFix: {
        orphanLegBuildings: postOrphanRows.length,
        orphanLegTotal: rows.reduce((total, row) => total + row.postFix.orphanLegCount, 0),
        clusterTopRatio: quantiles(rows.map((row) => row.postFix.clusterTopRatio)),
        clusterAboveCrownMm: quantiles(rows.map((row) => row.postFix.clusterAboveCrownMm)),
        maximumClusterAboveCrownMm: rows.reduce((worst, row) => Math.max(worst, row.postFix.clusterAboveCrownMm), 0),
        boundHolds: rows.every((row) => row.postFix.clusterAboveCrownMm <= V3_NOMINAL_FLOOR_HEIGHT_MM),
      },
      tankRecoveredByClampCount: withPreFix.filter((row) => row.preFix.orphanLegCount > 0 && row.postFix.prismCount > row.preFix.prismCount).length,
    },
    subMetreParents: {
      note: "Enumerated over ALL owned parents, not sampled: a set this small must be named rather than estimated. `sourcedHeightMeters` is the pinned snapshot's own value; parents with an unknown height take the 10 m fallback and are not in this set.",
      count: subMetre.length,
      buildings: subMetre.sort((left, right) => left.sourcedHeightMm - right.sourcedHeightMm || (left.buildingId < right.buildingId ? -1 : 1)),
    },
    cost: {
      bothLodWriteMs: quantiles(rows.map((row) => round(row.bothLodWriteMs, 3))),
      bothLodByteSize: quantiles(rows.map((row) => row.bothLodByteSize)),
      lod0TriangleCount: quantiles(rows.map((row) => row.lod0TriangleCount)),
      lod1TriangleCount: quantiles(rows.map((row) => row.lod1TriangleCount)),
    },
    rows,
    retention: "gate-only: every GLB written by this stage was counted, timed and dropped",
    timings: {
      wallSeconds: Number(((Date.now() - startedAt) / 1_000).toFixed(1)),
      note: "Host wall clock, kept out of every other field so a re-run rewrites byte-identical content.",
    },
  };
}

// ---------------------------------------------------------------------------
// (5) Textured shared-URI write cost
// ---------------------------------------------------------------------------

export async function computeTextureCostRecord(options) {
  const { sources } = await loadSources();
  const { ledger } = await loadLedger();
  const cells = [...ledger.cells].sort((left, right) => left.order - right.order);
  const ownerCellOf = new Map();
  const order = [];
  for (const cell of cells) for (const buildingId of cell.buildingIds) { ownerCellOf.set(buildingId, cell.cellId); order.push(buildingId); }

  // A real committed textured shared-URI profile, not a synthetic one.
  const variant = EXTERIOR_T1_VARIANTS.find((entry) => entry.waveProfile.textureDelivery === "shared-uri");
  const texturedProfile = { ...variant.waveProfile, admissionEnvelope: MASS_GENERATION_GRAMMAR };
  const untexturedProfile = { ...MIDTOWN_CORE_V3_WAVE_PROFILE, admissionEnvelope: MASS_GENERATION_GRAMMAR };

  const rows = [];
  for (const buildingId of order) {
    if (rows.length >= options.sample) break;
    const source = sources.get(buildingId);
    if (!source) continue;
    const planned = planUnder(source, MASS_GENERATION_GRAMMAR);
    if (!planned.ok) continue;
    const write = (profile) => {
      const startedAt = performance.now();
      const written = writeMidtownCoreV3Assets(planned.context, {
        ownerCellId: ownerCellOf.get(buildingId), capturedAt: null, updatedAt: null, predecessor: null, profile,
      });
      return { ms: performance.now() - startedAt, written };
    };
    let textured;
    let untextured;
    try {
      untextured = write(untexturedProfile);
      textured = write(texturedProfile);
    } catch (error) {
      if (!(error instanceof MidtownCoreV3Stop)) throw error;
      continue;
    }
    rows.push({
      buildingId,
      texturedBothLodMs: textured.ms,
      untexturedBothLodMs: untextured.ms,
      texturedBothLodByteSize: textured.written.assets[0].bytes.byteLength + textured.written.assets[1].bytes.byteLength,
      untexturedBothLodByteSize: untextured.written.assets[0].bytes.byteLength + untextured.written.assets[1].bytes.byteLength,
      sharedTextureClasses: [...textured.written.assets[0].sharedTextureClasses],
    });
  }

  const texturedMs = rows.map((row) => row.texturedBothLodMs);
  const perAsset = quantiles(texturedMs.map((value) => round(value / 2, 3)));
  const totalOwned = Object.values(WAVE_OWNED_PARENTS).reduce((total, value) => total + value, 0);
  const sorted = [...texturedMs].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];

  return {
    schemaVersion: "1.0",
    recordId: RECORD_ID,
    taskId: "T004",
    artifact: "stage0-textured-shared-uri-write-cost",
    note: "MEASURED on a real committed shared-URI wave profile through the real canonical writer, both levels of detail, bytes dropped. The projection is a RANGE derived from the measured median and p95 of this sample; it is a projection and is labelled as one, not a measurement of the six waves.",
    profile: { releaseId: texturedProfile.releaseId, textureDelivery: texturedProfile.textureDelivery },
    sample: { requested: options.sample, measured: rows.length, selection: "the first N plannable owned parents in ledger order" },
    texturedBothLodMs: quantiles(texturedMs.map((value) => round(value, 3))),
    texturedPerAssetMs: perAsset,
    untexturedBothLodMs: quantiles(rows.map((row) => round(row.untexturedBothLodMs, 3))),
    byteSize: {
      texturedBothLod: quantiles(rows.map((row) => row.texturedBothLodByteSize)),
      untexturedBothLod: quantiles(rows.map((row) => row.untexturedBothLodByteSize)),
    },
    sharedTextureClassCounts: tally(rows, (row) => row.sharedTextureClasses.length),
    sixWaveProjection: {
      ownedParents: { ...WAVE_OWNED_PARENTS, total: totalOwned },
      note: "Single-threaded writer time for BOTH levels of detail over every owned parent, from the measured per-building median and p95. It excludes plan derivation, snapshot verification, release assembly, checksums and disk I/O, so it is a floor on the writer stage alone, not an estimate of a wave's wall clock.",
      medianBasedSeconds: round((median * totalOwned) / 1_000, 1),
      p95BasedSeconds: round((p95 * totalOwned) / 1_000, 1),
      rangeStatement: `${round((median * totalOwned) / 1_000 / 60, 1)} to ${round((p95 * totalOwned) / 1_000 / 60, 1)} minutes of single-threaded writer time for all six waves at both LODs`,
    },
    rows,
    retention: "gate-only: every GLB written by this stage was counted, timed and dropped",
  };
}

// ---------------------------------------------------------------------------
// The gate record
//
// Items 1 and 2 are produced by instruments that already exist and are already
// gated by their own drift tests — T003's differential census and T001's
// full-city generation replay. Stage 0 RUNS them and QUOTES them; it does not
// reimplement either, because a second implementation of a proof is a second
// thing that can be wrong.
// ---------------------------------------------------------------------------

export const DIFFERENTIAL_PATH = join(RECORD_DIR, "stage0-differential-digest.json");
export const T001_REPLAY_PATH = join(repositoryRoot, "data", "citywide-overview-census-20260814", "generation-replay.json");

export async function composeGateRecord() {
  const differential = JSON.parse(await readFile(DIFFERENTIAL_PATH, "utf8"));
  const replay = JSON.parse(await readFile(T001_REPLAY_PATH, "utf8"));
  const fingerprints = JSON.parse(await readFile(FINGERPRINT_PATH, "utf8"));
  const stride = JSON.parse(await readFile(STRIDE_PATH, "utf8"));
  const texture = JSON.parse(await readFile(TEXTURE_COST_PATH, "utf8"));

  return {
    schemaVersion: "1.0",
    recordId: RECORD_ID,
    taskId: "T004",
    artifact: "mass-generation-stage0-gate",
    note: "THE PRE-GENERATION GATE. No wave payload was generated by any instrument behind this record: every GLB written was counted, timed and dropped, nothing was published, no approval envelope was widened, and serving and promotion were not touched. Passing every number here is a statement about deterministic properties of this repository's code against a pinned snapshot, and nothing more — it is not visual, geographic, architectural or performance acceptance.",
    differential: {
      note: "T003's own instrument, re-run over all 45,194 accepted parents AFTER the rooftop threading, writing off the committed T003 record. It proves the rooftop rules moved NOTHING on the default path: same accepted set, same per-building plan hash.",
      instrument: "scripts/grammar-extension-census-cli.mjs",
      recordPath: `data/${RECORD_ID}/stage0-differential-digest.json`,
      committedT003DigestSha256: T003_DIFFERENTIAL_DIGEST,
      observedDigestSha256: differential.differential.shippedDigestSha256,
      extendedDigestSha256: differential.differential.extendedDigestSha256,
      acceptedSetSize: differential.differential.acceptedSetSize,
      byteEqual: differential.differential.byteEqual,
      movedPlanHashCount: differential.differential.movedPlanHashCount,
      counts: differential.counts,
      unmoved: differential.differential.shippedDigestSha256 === T003_DIFFERENTIAL_DIGEST,
    },
    shippedByteReplay: {
      note: "T001's full-city generation replay (Proof 3), re-run after both T004 commits. Every shipped GLB of every wave is regenerated with that wave's own shipped profile and compared against its committed SHA-256. writeCanonicalGlb writes planHashSha256 into asset metadata, so byte identity is also a per-building plan-hash identity proof.",
      instrument: "pnpm citywide-overview:census replay",
      recordPath: "data/citywide-overview-census-20260814/generation-replay.json",
      totalAssetsCompared: replay.shippedAssetByteReplay.totalAssetsCompared,
      totalAssetsMatched: replay.shippedAssetByteReplay.totalAssetsMatched,
      block835PlanReplayVerdict: replay.block835PlanReplay.verdict,
      allAgree: replay.verdict.allAgree,
      disagreementCount: replay.verdict.disagreementCount,
    },
    fingerprints: {
      allUnmoved: fingerprints.allUnmoved,
      frozenProfileCount: fingerprints.frozenProfiles.length,
      sharedUriVariants: { allMoved: fingerprints.sharedUriVariants.allMoved, count: fingerprints.sharedUriVariants.variants.length },
      recordPath: `data/${RECORD_ID}/stage0-frozen-fingerprints.json`,
    },
    silhouette: {
      ...stride.silhouette,
      recordPath: `data/${RECORD_ID}/stage0-preflight-stride.json`,
    },
    rooftop: { ...stride.rooftop, recordPath: `data/${RECORD_ID}/stage0-preflight-stride.json` },
    subMetreParents: stride.subMetreParents,
    texturedWriteCost: {
      recordPath: `data/${RECORD_ID}/stage0-textured-write-cost.json`,
      texturedPerAssetMs: texture.texturedPerAssetMs,
      sixWaveProjection: texture.sixWaveProjection,
    },
    rights: {
      statement: "T004 Stage 0 retains bytes LOCALLY ONLY. The payloads it produced were in-memory GLBs that were counted, timed and dropped; the only retained artifacts are the committed JSON inventories and summaries under data/mass-generation-20260816/. Nothing is conveyed, redistributed or published. No external data was acquired and no retained snapshot was replaced. No approval envelope is widened: every committed release, its approval scope, its licensing and its retention terms are exactly as they were. Serving and promotion are untouched, so the runtime rollback surface of this stage is zero.",
      conveyance: "none",
      approvalEnvelopeChange: "none",
      runtimeRollbackSurface: "zero",
      retention: "gitignored payloads (none retained), committed inventories and summaries only",
    },
    notDecidedHere: [
      "Whether the waves run under the extended admission envelope. ADR 0048 withheld that and this gate does not grant it.",
      "Whether a two-LOD wave ships. This gate measures the LOD-transition contract; approving it is a separate decision.",
      "Any visual, geographic, architectural, accessibility or performance acceptance.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Gate invariants
// ---------------------------------------------------------------------------

export function stage0Invariants(gate) {
  const issues = [];
  if (!gate.fingerprints.allUnmoved) issues.push("at least one frozen wave profile's stage fingerprint moved");
  if (!gate.fingerprints.sharedUriVariants.allMoved) issues.push("a shared-uri variant's fingerprint did not move, so the delivery key is still invisible");
  if (gate.differential.observedDigestSha256 !== T003_DIFFERENTIAL_DIGEST) issues.push("the differential plan-hash set digest moved off the T003 value");
  if (gate.differential.movedPlanHashCount !== 0) issues.push("at least one accepted plan hash moved on the default path");
  if (gate.shippedByteReplay.totalAssetsMatched !== gate.shippedByteReplay.totalAssetsCompared) issues.push("the shipped GLB byte replay did not match on every asset");
  if (gate.shippedByteReplay.totalAssetsCompared === 0) issues.push("the shipped GLB byte replay compared nothing, which would be a vacuous pass");
  if (gate.rooftop.postFix.orphanLegBuildings !== 0) issues.push("orphan water-tank legs survive the fix");
  if (!gate.rooftop.postFix.boundHolds) issues.push("a post-clamp rooftop cluster exceeds one nominal storey above its crown");
  if (gate.silhouette.countAtOrOverCap !== 0) issues.push(`${gate.silhouette.countAtOrOverCap} strided building(s) are at or over the 2% LOD-transition cap`);
  return issues;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function writeRecord(path, record) {
  await mkdir(dirname(path), { recursive: true });
  const text = serialize(record);
  await writeFile(path, text, "utf8");
  const checksum = sha256HexSync(text);
  await writeFile(path.replace(/\.json$/u, ".sha256"), `${checksum}  ${path.split("/").pop()}\n`, "utf8");
  return checksum;
}

async function runCli(argv) {
  const mode = argv[0];
  if (mode === "check") {
    const gate = JSON.parse(await readFile(GATE_PATH, "utf8"));
    const issues = stage0Invariants(gate);
    console.log(serialize({ ok: issues.length === 0, checkedPath: GATE_PATH, issues }));
    return issues.length === 0 ? 0 : 1;
  }
  if (mode === "gate") {
    const gate = await composeGateRecord();
    const issues = stage0Invariants(gate);
    await writeRecord(GATE_PATH, gate);
    console.log(serialize({
      ok: issues.length === 0,
      issues,
      gatePath: GATE_PATH,
      differentialUnmoved: gate.differential.unmoved,
      shippedByteReplay: `${gate.shippedByteReplay.totalAssetsMatched}/${gate.shippedByteReplay.totalAssetsCompared}`,
      silhouetteCountAtOrOverCap: gate.silhouette.countAtOrOverCap,
      postFixOrphanLegBuildings: gate.rooftop.postFix.orphanLegBuildings,
      verdict: issues.length === 0 ? "STAGE 0 PASSES" : "STAGE 0 FAILS",
    }));
    return issues.length === 0 ? 0 : 1;
  }
  if (mode !== "run") {
    console.error("Usage: node scripts/mass-generation-stage0-cli.mjs <run|gate|check> [--stride <n>] [--texture-sample <n>]");
    return 2;
  }
  const strideIndex = argv.indexOf("--stride");
  const sampleIndex = argv.indexOf("--texture-sample");
  const stride = strideIndex >= 0 ? Number(argv[strideIndex + 1]) : DEFAULT_STRIDE;
  const sample = sampleIndex >= 0 ? Number(argv[sampleIndex + 1]) : DEFAULT_TEXTURE_SAMPLE;
  if (!Number.isInteger(stride) || stride < 1) fail("--stride must be a positive integer.");
  if (!Number.isInteger(sample) || sample < 1) fail("--texture-sample must be a positive integer.");

  const fingerprints = computeFingerprintRecord();
  await writeRecord(FINGERPRINT_PATH, fingerprints);
  console.error(`[fingerprints] frozen profiles unmoved: ${fingerprints.allUnmoved}`);

  const strideRecord = await computeStrideRecord({ stride });
  await writeRecord(STRIDE_PATH, strideRecord);
  console.error(`[stride] materialized=${strideRecord.stride.materialized} overCap=${strideRecord.silhouette.countAtOrOverCap} orphansPost=${strideRecord.rooftop.postFix.orphanLegBuildings}`);

  const textureRecord = await computeTextureCostRecord({ sample });
  await writeRecord(TEXTURE_COST_PATH, textureRecord);
  console.error(`[texture] ${textureRecord.sixWaveProjection.rangeStatement}`);

  console.log(serialize({
    ok: true,
    wrote: [FINGERPRINT_PATH, STRIDE_PATH, TEXTURE_COST_PATH],
    silhouette: { countAtOrOverCap: strideRecord.silhouette.countAtOrOverCap, deviationRatio: strideRecord.silhouette.deviationRatio },
    rooftop: { preFixOrphanBuildings: strideRecord.rooftop.preFix.orphanLegBuildings, postFixOrphanBuildings: strideRecord.rooftop.postFix.orphanLegBuildings },
  }));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runCli(process.argv.slice(2));
}
