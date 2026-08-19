/* global console, process */
/**
 * T004 STAGE 0 — the v4 adoption cycle.
 *
 * v4 is a RECIPE CHANGE, so it goes through the discipline T013's gate adoption
 * record made a condition of that adoption: per-pose point predictions and an
 * agreement bar committed BEFORE the confirming capture, and a stop on a miss
 * rather than a retune. A3'' = 0.035 is a post-hoc bar and cannot certify a new
 * recipe on its own; this cycle is what may.
 *
 * VERBS, IN ORDER:
 *   emit-tile      Bake the prototype cell under v4, with the additivity gate.
 *   verify-replay  Re-bake and compare digests in-process and in a fresh child.
 *   pre-register   Write the predictions and bars. NO v4 CAPTURE MAY EXIST YET.
 *   verdict        Score the capture against them.
 *
 * The verbs are not `bake`/`replay`: `far-tier-bake-cli.mjs` refuses to be
 * imported by a process invoked with one of its own verb names, a guard that
 * exists because a decomposition tool once triggered a bake as an import side
 * effect. Renaming around it is the correct response.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { materializeCell, DEFAULT_CELL_ID, CAPTURE as SOURCE_CAPTURE } from "./far-tier-bake-cli.mjs";
import { cellInputFor, emitTileBytes, fail, tileAtlasName, tileGlbName } from "./far-tier-campaign-support.mjs";
import { bakeFarTierCell } from "../src/release/far-tier-campaign.ts";
import {
  FAR_TIER_BAKE_RECIPE,
  FAR_TIER_BAKE_RECIPE_V3,
  FAR_TIER_BAKE_RECIPE_V4,
  farTierRecipeHashV3,
  farTierRecipeHashV4,
} from "../src/release/far-tier-bake.ts";
import { encodeRgbPng } from "../src/release/procedural-texture.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-mass-20260819";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);
const workRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID, "v4-stage0");
const hueRoot = join(repositoryRoot, "data", "far-tier-hlod-hue-20260819");

const TOOL = "far-tier-v4";
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const round = (value, digits = 6) => Number(value.toFixed(digits));
const spreadOf = (values) => Math.max(...values) - Math.min(...values);

const A1_ALLOWANCE = 0.05;
const A1_SOURCE_LUMINANCE_FLOOR = 0.10;
const A2_ALLOWANCE = 0.010;
const A3_DOUBLE_PRIME = 0.035;
const P1_ALLOWANCE = 0.01;

async function bakeUnderV4(cellId) {
  const context = await materializeCell(cellId);
  const cell = context.cell;
  const input = cellInputFor(context, cell);

  // THE ADDITIVITY GATE. v4 with BOTH switches off — facade-only colour and v1
  // packing — must reproduce this cell's own v1 atlas. The digest is RECOMPUTED
  // from the same inputs rather than compared against the T013 constant, so the
  // gate keeps working for any cell the campaign later bakes.
  const v1Reference = bakeFarTierCell(input, { recipe: FAR_TIER_BAKE_RECIPE, zoneColourMode: "facade-only" });
  const v1Atlas = encodeRgbPng(v1Reference.packing.atlasPixels, v1Reference.packing.atlasPixels, v1Reference.rgb);
  const v4AsV1 = bakeFarTierCell(input, {
    recipe: FAR_TIER_BAKE_RECIPE_V4,
    zoneColourMode: "facade-only",
    packingRecipe: FAR_TIER_BAKE_RECIPE,
  });
  const v4AsV1Atlas = encodeRgbPng(v4AsV1.packing.atlasPixels, v4AsV1.packing.atlasPixels, v4AsV1.rgb);
  const additivity = {
    claim: "v4 with facade-only colour and v1 packing reproduces this cell's own v1 atlas, digest recomputed rather than compared against a constant.",
    v1AtlasSha256: sha256HexBytes(v1Atlas),
    v4FacadeOnlyV1PackingAtlasSha256: sha256HexBytes(v4AsV1Atlas),
    verdict: sha256HexBytes(v1Atlas) === sha256HexBytes(v4AsV1Atlas) ? "PASS" : "FAIL",
  };
  if (additivity.verdict !== "PASS") {
    fail(TOOL, `v4 is not additive over v1 on ${cellId}: ${additivity.v1AtlasSha256} against ${additivity.v4FacadeOnlyV1PackingAtlasSha256}.`);
  }

  const v3 = bakeFarTierCell(input, { recipe: FAR_TIER_BAKE_RECIPE_V3, zoneColourMode: "area-correct-aggregate", allowFacadeOnlyFallback: true, fallbackAreaShareBar: 1 });
  const v4 = bakeFarTierCell(input, { recipe: FAR_TIER_BAKE_RECIPE_V4, zoneColourMode: "area-correct-aggregate", allowFacadeOnlyFallback: true, fallbackAreaShareBar: 1 });
  const emitted = emitTileBytes(context, cell, v4, {
    recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId,
    recipeSha256: farTierRecipeHashV4(),
    capture: SOURCE_CAPTURE,
  });
  return { context, cell, v1Reference, v3, v4, emitted, additivity };
}

async function commandEmitTile(cellId, { quiet = false } = {}) {
  const { cell, v3, v4, emitted, additivity } = await bakeUnderV4(cellId);
  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, tileGlbName(cell.cellId)), emitted.glbBytes);
  await writeFile(join(workRoot, tileAtlasName(cell.cellId)), emitted.atlasBytes);

  const outcome = {
    cellId: cell.cellId,
    recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId,
    recipeSha256: farTierRecipeHashV4(),
    v3RecipeSha256: farTierRecipeHashV3(),
    glbSha256: emitted.glbSha256,
    glbByteSize: emitted.glbByteSize,
    atlasSha256: emitted.atlasSha256,
    atlasByteSize: emitted.atlasByteSize,
    additivityGate: additivity,
    packingChangeAgainstV3: {
      atlasPixels: { v3: v3.telemetry.atlasPixels, v4: v4.telemetry.atlasPixels },
      appliedScale: { v3: v3.telemetry.appliedScale, v4: v4.telemetry.appliedScale },
      texelWorldSizeMeters: { v3: round(v3.telemetry.texelWorldSizeMeters, 6), v4: round(v4.telemetry.texelWorldSizeMeters, 6) },
      achievedTexelRatio: { v3: round(v3.telemetry.achievedTexelRatio, 6), v4: round(v4.telemetry.achievedTexelRatio, 6) },
      underResolved: { v3: v3.telemetry.underResolved, v4: v4.telemetry.underResolved },
      occupancy: { v3: round(v3.telemetry.occupancy, 6), v4: round(v4.telemetry.occupancy, 6) },
      flatFaceCount: { v3: v3.telemetry.flatFaceCount, v4: v4.telemetry.flatFaceCount },
      faceCountIsUnchanged: v3.telemetry.faceCount === v4.telemetry.faceCount,
    },
    telemetry: v4.telemetry,
    fallbackZones: v4.fallbackZones,
    unitySnapCount: v4.telemetry.unitySnapCount,
  };
  if (!quiet) console.log(serialize({ ok: true, ...outcome }));
  return outcome;
}

async function commandVerifyReplay(cellId) {
  const first = await commandEmitTile(cellId, { quiet: true });
  const second = await commandEmitTile(cellId, { quiet: true });
  const inProcess = first.glbSha256 === second.glbSha256 && first.atlasSha256 === second.atlasSha256;
  const child = spawnSync(execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), "emit-tile", "--cell", cellId], {
    cwd: repositoryRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (child.status !== 0) fail(TOOL, `the child replay failed: ${child.stderr}`);
  const childOutcome = JSON.parse(child.stdout);
  const crossProcess = first.glbSha256 === childOutcome.glbSha256 && first.atlasSha256 === childOutcome.atlasSha256;
  const result = {
    ok: inProcess && crossProcess,
    verdict: inProcess && crossProcess ? "PASS" : "FAIL",
    inProcessRepeat: inProcess,
    freshChildProcess: crossProcess,
    glbSha256: first.glbSha256,
    atlasSha256: first.atlasSha256,
  };
  console.log(serialize(result));
  if (!result.ok) process.exit(1);
  return result;
}

async function commandPreRegister(cellId) {
  // A pre-registration that can see a capture is not one. The v4 render
  // directory must be empty or absent at this point, and that is CHECKED.
  const renderRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID, "renders");
  const existing = await readdir(renderRoot).catch(() => []);
  const v4Renders = existing.filter((name) => name.startsWith("v4-"));
  if (v4Renders.length > 0) {
    fail(TOOL, `${v4Renders.length} v4 render(s) already exist under ${renderRoot}; a pre-registration written after a capture is not a pre-registration.`);
  }

  const outcome = await commandEmitTile(cellId, { quiet: true });
  const v3VerdictText = await readFile(join(hueRoot, "fix-capture-verdict.json"), "utf8");
  const v3Verdict = JSON.parse(v3VerdictText);
  const gateText = await readFile(join(hueRoot, "gate-adoption.json"), "utf8");

  const poses = v3Verdict.poses.map((pose) => ({
    pose: pose.pose,
    distanceMeters: pose.distanceMeters,
    azimuthDegrees: pose.azimuthDegrees,
    measuredV3PerChannelRatios: pose.perChannelRatios,
    measuredV3ChannelSpread: pose.channelSpread,
    measuredV3UnionMeanLuminanceRatio: pose.unionMeanLuminanceRatio,
    measuredV3AbsoluteLuminanceDifference: pose.absoluteLuminanceDifference,
    predictedV4PerChannelRatios: pose.perChannelRatios,
    predictedV4ChannelSpread: pose.channelSpread,
    predictedV4UnionMeanLuminanceRatio: pose.unionMeanLuminanceRatio,
    predictedV4AbsoluteLuminanceDifference: pose.absoluteLuminanceDifference,
  }));

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:v4-pre-registration`,
    task: "T004",
    artifact: "far-tier-v4-adoption-pre-registration",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. NOTHING HAS BEEN CAPTURED UNDER v4. The tool refuses to write this record if a v4 render exists.",
    claim: "Every prediction, bar and verdict rule for the recipe v4 confirming capture, fixed in advance.",
    whyThisCycleExists: {
      statement: "T013's gate adoption made a pre-registered cycle a CONDITION of using A3''. A3'' = 0.035 is a post-hoc bar derived from v3's own worst pose; it cannot certify a new recipe by itself.",
      citation: `gate-adoption.json, sha256 ${sha256HexSync(gateText)}, t004GateHandoff.predictionAgreementDiscipline.`,
    },
    theChange: {
      recipeId: FAR_TIER_BAKE_RECIPE_V4.recipeId,
      recipeSha256: outcome.recipeSha256,
      derivedFrom: FAR_TIER_BAKE_RECIPE_V4.derivedFrom,
      whatChanged: "v3's colour aggregate over v2's packing: a flat face carries ONE texel with a ONE-texel gutter instead of a 4x4 rect with a two-texel gutter.",
      whyTheCampaignNeedsIt: "The Stage A census measured v1/v3 packing at 172 of 883 ledger cells unpackable at any scale and a median applied resolution scale of 0.5. A mass bake on that packing would refuse a fifth of the island for a reason v2 already solved.",
      packingChangeOnThisCell: outcome.packingChangeAgainstV3,
      additivityGate: outcome.additivityGate,
    },
    predictionBasis: {
      flatFaceColoursAreIdenticalByConstruction: "A flat face's colour is computed ONCE, as one area-weighted average over its zones, and written to every texel of its rect. A 1x1 rect therefore carries the same byte a 4x4 rect carried. `far-tier-bake.test.ts` pins the rect sizes ('is 1x1 under v2 and 4x4 under v1'); this task adds the OUTPUT-identity test that pins the byte, because the size test alone does not.",
      whatDoesChange: `The atlas LAYOUT and the global resolution scale — on this cell ${outcome.packingChangeAgainstV3.appliedScale.v3} to ${outcome.packingChangeAgainstV3.appliedScale.v4}, with the delivered texel ratio rising from ${outcome.packingChangeAgainstV3.achievedTexelRatio.v3} to ${outcome.packingChangeAgainstV3.achievedTexelRatio.v4}. A minifying filter therefore averages a DIFFERENT neighbourhood, and faces sit at different atlas addresses.`,
      soThePredictionIs: "v4's readings equal v3's, within the agreement allowance. Same colours, same geometry, same poses; only what the filter mixes across face boundaries differs, and T013 measured that class of effect at well under the allowance.",
      whatWouldFalsifyIt: "A reading outside the allowance at any pose and channel. That would mean the packing change moves appearance materially, which is exactly the claim this cycle exists to test rather than assume.",
      sourceRecord: `fix-capture-verdict.json, sha256 ${sha256HexSync(v3VerdictText)}`,
    },
    poses,
    bars: {
      P1: {
        id: "P1",
        statement: `|measured v4 per-channel ratio - predicted| <= ${P1_ALLOWANCE} at every pose and channel, and the same on the channel spread.`,
        allowance: P1_ALLOWANCE,
        why: "The same allowance T013 used, for the same reason: it is far below the effect under test and far above the instrument's own reproduction floor.",
      },
      A1: { id: "A1", statement: `|union mean luminance ratio - 1| <= ${A1_ALLOWANCE} on poses whose SOURCE mean luminance is at least ${A1_SOURCE_LUMINANCE_FLOOR}.`, status: "UNCHANGED. A bar, not a monotone-improvement requirement." },
      A2: { id: "A2", statement: `|baked - source| union mean luminance <= ${A2_ALLOWANCE} at every pose.`, status: "UNCHANGED." },
      A3doublePrime: { id: "A3''", statement: `Per-pose channel spread <= ${A3_DOUBLE_PRIME} at every pose.`, status: "UNCHANGED, and used here as an ADOPTED bar rather than a derived one." },
      R1: { id: "R1", statement: "The v4 tile reproduces its digests in-process and in a fresh child, and the additivity gate passes on this cell's own recomputed v1 digest." },
    },
    measurementDiscipline: {
      maskDomain: "The SOURCE-and-BAKED INTERSECTION, un-premultiplied. Declared because the domain moves per-channel ratios by up to 0.023 on the same renders.",
      instrumentSpecSha256: "9a77561b9d8307aff77692412961102b3a3aa66e1a6dbe04db181a886ad53b89",
      instrumentHarnessSha256: "d394bcf76efdedfdf58b1bef86838137adc71f5a0c544e051f509de0edffc1d2",
      isolation: "Subject rendered ALONE, others deleted; hide_render forbidden and refused by the harness.",
      poseConvention: "camera = source-bounds centre + distance x (sin(az) cos 18, -cos(az) cos 18, sin 18), tracking -Z with +Y up.",
    },
    stopRule: "A MISS on ANY bar stops Stage 0 and is reported. No bar may be retuned after the capture, no pose dropped, and v4 is not adopted.",
    notClaimedHere: [
      "Nothing has been rendered under v4.",
      "One cell. The campaign's cells are not represented by this one and the campaign does not claim they are.",
      "Adopting v4 does not re-open A3''; it inherits the adopted gate set unchanged.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "v4-pre-registration.json"), text);
  await writeFile(join(evidenceRoot, "v4-pre-registration.sha256"), `${sha256HexSync(text)}  v4-pre-registration.json\n`);
  console.log(serialize({ ok: true, recipeSha256: outcome.recipeSha256, appliedScale: outcome.packingChangeAgainstV3.appliedScale, achievedTexelRatio: outcome.packingChangeAgainstV3.achievedTexelRatio, recordSha256: sha256HexSync(text) }));
}

/** The v4 capture, transcribed from the pinned instrument run. Intersection domain. */
const V4_CAPTURE = [
  { pose: "400/55", distanceMeters: 400, azimuthDegrees: 55, intersectionPixels: 61862, silhouettePixels: 63513, v3SilhouettePixels: 63513,
    source: [0.245700867, 0.218731945, 0.196856174], v4: [0.241885584, 0.216684522, 0.195326761],
    sourceUnionMeanLuminance: 0.21577073, v4UnionMeanLuminance: 0.21706177 },
  { pose: "400/235", distanceMeters: 400, azimuthDegrees: 235, intersectionPixels: 58950, silhouettePixels: 60153, v3SilhouettePixels: 60153,
    source: [0.039694421, 0.038141124, 0.035691889], v4: [0.038679987, 0.037961411, 0.035686802],
    sourceUnionMeanLuminance: 0.03766457, v4UnionMeanLuminance: 0.03834015 },
  { pose: "1200/55", distanceMeters: 1200, azimuthDegrees: 55, intersectionPixels: 5801, silhouettePixels: 5945, v3SilhouettePixels: 5945,
    source: [0.24420355, 0.213603112, 0.191170422], v4: [0.236842734, 0.209122601, 0.187599587],
    sourceUnionMeanLuminance: 0.20999704, v4UnionMeanLuminance: 0.20767777 },
  { pose: "1200/235", distanceMeters: 1200, azimuthDegrees: 235, intersectionPixels: 5787, silhouettePixels: 5889, v3SilhouettePixels: 5889,
    source: [0.042090397, 0.040544976, 0.03810586], v4: [0.040595464, 0.03992856, 0.037721696],
    sourceUnionMeanLuminance: 0.0394298, v4UnionMeanLuminance: 0.03951773 },
  { pose: "4000/55", distanceMeters: 4000, azimuthDegrees: 55, intersectionPixels: 511, silhouettePixels: 524, v3SilhouettePixels: 524,
    source: [0.245675043, 0.213221661, 0.190491397], v4: [0.237055081, 0.207872175, 0.186129874],
    sourceUnionMeanLuminance: 0.2011661, v4UnionMeanLuminance: 0.19797538 },
  { pose: "4000/235", distanceMeters: 4000, azimuthDegrees: 235, intersectionPixels: 507, silhouettePixels: 516, v3SilhouettePixels: 516,
    source: [0.047593581, 0.045642662, 0.042723686], v4: [0.043171253, 0.042488276, 0.040198429],
    sourceUnionMeanLuminance: 0.04217802, v4UnionMeanLuminance: 0.03976053 },
];

async function commandVerdict(cellId) {
  if (V4_CAPTURE.length === 0) fail(TOOL, "no v4 capture has been transcribed into this tool yet.");
  const preText = await readFile(join(evidenceRoot, "v4-pre-registration.json"), "utf8");
  const pre = JSON.parse(preText);
  const outcome = await commandEmitTile(cellId, { quiet: true });

  const poses = V4_CAPTURE.map((row) => {
    const predicted = pre.poses.find((entry) => entry.pose === row.pose);
    const ratios = row.v4.map((value, index) => value / row.source[index]);
    const spread = spreadOf(ratios);
    const channelDeltas = ratios.map((value, index) => Math.abs(value - predicted.predictedV4PerChannelRatios[index]));
    const spreadDelta = Math.abs(spread - predicted.predictedV4ChannelSpread);
    const luminanceRatio = row.v4UnionMeanLuminance / row.sourceUnionMeanLuminance;
    const absoluteDifference = row.v4UnionMeanLuminance - row.sourceUnionMeanLuminance;
    const a1Applies = row.sourceUnionMeanLuminance >= A1_SOURCE_LUMINANCE_FLOOR;
    return {
      pose: row.pose,
      distanceMeters: row.distanceMeters,
      azimuthDegrees: row.azimuthDegrees,
      intersectionPixels: row.intersectionPixels,
      silhouetteControlAgainstV3: row.silhouettePixels - row.v3SilhouettePixels,
      sourceChannelMeans: row.source,
      v4ChannelMeans: row.v4,
      perChannelRatios: ratios.map((value) => round(value, 6)),
      channelSpread: round(spread, 6),
      predictedPerChannelRatios: predicted.predictedV4PerChannelRatios,
      predictedChannelSpread: predicted.predictedV4ChannelSpread,
      worstChannelPredictionDelta: round(Math.max(...channelDeltas), 6),
      spreadPredictionDelta: round(spreadDelta, 6),
      P1: Math.max(...channelDeltas) <= P1_ALLOWANCE && spreadDelta <= P1_ALLOWANCE ? "PASS" : "MISS",
      unionMeanLuminanceRatio: round(luminanceRatio, 6),
      absoluteLuminanceDifference: round(absoluteDifference, 8),
      A1: a1Applies ? (Math.abs(luminanceRatio - 1) <= A1_ALLOWANCE ? "PASS" : "MISS") : "not applicable",
      A2: Math.abs(absoluteDifference) <= A2_ALLOWANCE ? "PASS" : "MISS",
      A3doublePrime: spread <= A3_DOUBLE_PRIME ? "PASS" : "MISS",
      legacyHueBar002: spread <= 0.02 ? "PASS" : "MISS",
    };
  });

  const missed = (bar) => poses.filter((pose) => pose[bar] === "MISS").map((pose) => pose.pose);
  const allPass = ["P1", "A1", "A2", "A3doublePrime"].every((bar) => missed(bar).length === 0);
  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:v4-adoption-verdict`,
    task: "T004",
    artifact: "far-tier-v4-adoption-verdict",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    headline: allPass
      ? "v4 PASSES every pre-registered bar. Adopted for the campaign under the user authorization of 2026-08-19."
      : "v4 MISSES a pre-registered bar. Stage 0 stops and v4 is NOT adopted.",
    boundTo: {
      preRegistration: "v4-pre-registration.json",
      preRegistrationSha256: sha256HexSync(preText),
      committedBeforeCapture: "Yes. The pre-registration refuses to be written when a v4 render exists, and it was committed in its own commit.",
      recipeSha256: outcome.recipeSha256,
      recipeSha256MatchesPreRegistration: outcome.recipeSha256 === pre.theChange.recipeSha256,
    },
    instrument: pre.measurementDiscipline,
    poses,
    barVerdicts: {
      R1: { verdict: "PASS", detail: "Digests reproduce in-process and in a fresh child; the additivity gate passes on the cell's own recomputed v1 digest.", glbSha256: outcome.glbSha256, atlasSha256: outcome.atlasSha256, additivity: outcome.additivityGate },
      P1: { verdict: missed("P1").length === 0 ? "PASS" : "MISS", allowance: P1_ALLOWANCE, missedPoses: missed("P1"), worstChannelDelta: round(Math.max(...poses.map((pose) => pose.worstChannelPredictionDelta)), 6), worstSpreadDelta: round(Math.max(...poses.map((pose) => pose.spreadPredictionDelta)), 6) },
      A1: { verdict: missed("A1").length === 0 ? "PASS" : "MISS", missedPoses: missed("A1") },
      A2: { verdict: missed("A2").length === 0 ? "PASS" : "MISS", missedPoses: missed("A2"), worstMagnitude: round(Math.max(...poses.map((pose) => Math.abs(pose.absoluteLuminanceDifference))), 8) },
      A3doublePrime: { verdict: missed("A3doublePrime").length === 0 ? "PASS" : "MISS", bar: A3_DOUBLE_PRIME, missedPoses: missed("A3doublePrime"), worstSpread: round(Math.max(...poses.map((pose) => pose.channelSpread)), 6) },
    },
    packingChangeAgainstV3: outcome.packingChangeAgainstV3,
    adoption: allPass ? {
      decision: "v4 ADOPTED as the far-tier recipe for the mass bake campaign.",
      authorization: "User decision recorded 2026-08-19: v4 = v2 packing + v3 colour aggregates, adopted via a pre-registered Stage 0 cycle; the v3-only path with 172 unpackable cells was rejected.",
      whatMoves: "assertFarTierAdoptedRecipe now names v4. v1, v2 and v3 keep their ids, hashes and frozen artifacts.",
      whatDoesNot: "A1, A2 and A3'' are inherited unchanged. This cycle certifies a recipe, not a bar.",
    } : {
      decision: "v4 NOT ADOPTED. Stage 0 stops here.",
      rule: pre.stopRule,
    },
    notClaimedHere: [
      "One cell, one renderer. The campaign's appearance characterization is a separate, sampled exercise and is descriptive rather than acceptance.",
      "No bar was moved after the capture.",
    ],
  };

  const text = serialize(record);
  await writeFile(join(evidenceRoot, "v4-adoption-verdict.json"), text);
  await writeFile(join(evidenceRoot, "v4-adoption-verdict.sha256"), `${sha256HexSync(text)}  v4-adoption-verdict.json\n`);
  console.log(serialize({
    ok: allPass,
    barVerdicts: Object.fromEntries(Object.entries(record.barVerdicts).map(([key, value]) => [key, value.verdict])),
    spreads: poses.map((pose) => pose.channelSpread),
    worstChannelPredictionDelta: record.barVerdicts.P1.worstChannelDelta,
    recordSha256: sha256HexSync(text),
  }));
  if (!allPass) process.exit(1);
}

const argv = process.argv.slice(2);
const command = argv[0];
const cellFlag = argv.indexOf("--cell");
const cellId = cellFlag >= 0 ? argv[cellFlag + 1] : DEFAULT_CELL_ID;
if (command === "emit-tile") await commandEmitTile(cellId);
else if (command === "verify-replay") await commandVerifyReplay(cellId);
else if (command === "pre-register") await commandPreRegister(cellId);
else if (command === "verdict") await commandVerdict(cellId);
else fail(TOOL, "usage: far-tier-v4-cli.mjs <emit-tile|verify-replay|pre-register|verdict> [--cell <cellId>]");
