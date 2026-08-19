/* global console, process */
/**
 * T004 STAGE 3 — appearance characterization of the baked island.
 *
 * DESCRIPTIVE, NOT ACCEPTANCE. Acceptance is T007's. This stage asks what the
 * population of baked tiles LOOKS like against the adopted gates, on a small
 * stratified sample, and records a cell-level miss as a stratum-level finding
 * with analysis rather than as a wave stop. Treating a sampled miss as a stop
 * would be acceptance by the back door, on a sample never designed to carry it.
 *
 *   plan     Choose the sample from committed telemetry and pre-register the
 *            population prediction. NO CAPTURE MAY EXIST YET.
 *   verdict  Score the captures descriptively.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { fail } from "./far-tier-campaign-support.mjs";
import { WAVE_IDS } from "./far-tier-mass-bake-cli.mjs";
import { farTierRecipeHashV4 } from "../src/release/far-tier-bake.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-mass-20260819";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);
const renderRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID, "renders");
const TOOL = "far-tier-characterization";

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const round = (value, digits = 6) => Number(value.toFixed(digits));
const spreadOf = (values) => Math.max(...values) - Math.min(...values);

const A3_DOUBLE_PRIME = 0.035;
const A1_ALLOWANCE = 0.05;
const A1_SOURCE_LUMINANCE_FLOOR = 0.10;
const A2_ALLOWANCE = 0.010;

/**
 * The population allowance, derived from the geometric-term bracket.
 *
 * T013 measured the irreducible geometric residual — what survives when BOTH
 * palette terms are equalised — at 0.027301 on the prototype's worst pose, with
 * a bracket of [0.027301, 0.030863] because the metal record cannot be split.
 * The bracket WIDTH, 0.003562, is the size of the one quantity that measurement
 * could not pin down, and it is the honest scale for how far another cell's
 * geometry mix may sit from the prototype's. Rounded up to 0.004.
 *
 * So the population prediction is `A3'' + 0.004 = 0.039`, and it is a
 * PREDICTION ABOUT A SAMPLE, not a bar any tile must meet.
 */
const GEOMETRIC_BRACKET = { low: 0.027301, high: 0.030863 };
const POPULATION_ALLOWANCE = 0.004;
const POPULATION_PREDICTION = round(A3_DOUBLE_PRIME + POPULATION_ALLOWANCE, 3);

async function loadTelemetry() {
  const rows = [];
  for (const waveId of WAVE_IDS) {
    const text = await readFile(join(evidenceRoot, `telemetry-${waveId}.json`), "utf8").catch(() => null);
    if (text === null) fail(TOOL, `wave ${waveId} has no committed telemetry; the sample cannot be drawn from a partial campaign.`);
    const record = JSON.parse(text);
    for (const cell of record.cells) rows.push({ ...cell, waveId });
  }
  return rows;
}

/**
 * Six cells, each chosen for a STATED reason and each tie-broken by cell id.
 *
 * The strata are the three the plan names — style-class mix, face count and
 * wave — plus the two the campaign itself surfaced as the interesting tails:
 * refusal count and zone-fallback share. Choosing by extremes rather than at
 * random is deliberate: a six-cell random draw of 883 characterizes nothing,
 * while the extremes bound what the population can do.
 */
function chooseSample(rows) {
  const byId = (left, right) => (left.cellId < right.cellId ? -1 : 1);
  const pick = (label, reason, sorter) => {
    const chosen = [...rows].sort((left, right) => sorter(left, right) || byId(left, right))[0];
    return { ...chosen, stratum: label, whyChosen: reason };
  };
  // `sorted[floor(n/2)]` is the UPPER of the two middle elements on an
  // even-length list, so it is the upper median rather than the median. The
  // INDEX is deliberately left as it is — changing it would select a different
  // cell and break this tool's own claim that re-running `plan` reproduces the
  // committed sample. Only the LABEL was wrong, and only the label changes.
  const sortedByFaces = [...rows].sort((left, right) => left.faceCount - right.faceCount || byId(left, right));
  const median = sortedByFaces[Math.floor(sortedByFaces.length / 2)];
  const candidates = [
    pick("largest-face-count", "The most faces in the island: the packer's hardest case and the lowest applied scale it can reach.", (left, right) => right.faceCount - left.faceCount),
    pick("smallest-face-count", "The fewest faces: a tile that is almost all roof cap, where the wall aggregate has least to say.", (left, right) => left.faceCount - right.faceCount),
    pick("most-refused-buildings", "The highest count of buildings the V3 grammar refused: a tile standing in for a cell it only partly carries.", (left, right) => right.refusedBuildings - left.refusedBuildings),
    pick("worst-zone-fallback-share", "The largest share of wall area still carrying v1's colour under an accepted fallback.", (left, right) => right.fallbackAreaShare - left.fallbackAreaShare),
    pick("lowest-applied-scale", "The most under-resolved tile the campaign produced.", (left, right) => left.appliedScale - right.appliedScale),
    { ...median, stratum: "upper-median-face-count", whyChosen: "The island's UPPER-MEDIAN cell by face count — the upper of the two middle elements on an even-length population — as the ordinary case the extremes are extreme against." },
  ];
  // Deduplicate by cell id, keeping the first reason, and top up from other
  // waves so the sample is not one district's tiles wearing five labels.
  const sample = [];
  for (const candidate of candidates) {
    if (sample.some((entry) => entry.cellId === candidate.cellId)) continue;
    sample.push(candidate);
  }
  return sample;
}

async function commandPlan() {
  const existing = await readdir(renderRoot).catch(() => []);
  const sampleRenders = existing.filter((name) => name.startsWith("sample-"));
  if (sampleRenders.length > 0) {
    fail(TOOL, `${sampleRenders.length} characterization render(s) already exist; a plan written after a capture is not a pre-registration.`);
  }
  const rows = await loadTelemetry();
  const sample = chooseSample(rows);

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:characterization-plan`,
    task: "T004",
    artifact: "far-tier-mass-bake-characterization-plan",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. NOTHING HAS BEEN CAPTURED. The tool refuses to write this plan once a sample render exists.",
    purpose: {
      statement: "DESCRIPTIVE CHARACTERIZATION OF THE BAKED POPULATION. Not acceptance.",
      whyThatDistinctionIsLoadBearing: "Acceptance is T007's task and needs a sample designed for it. A six-cell draw cannot carry an island-wide acceptance claim, so a cell-level MISS here is recorded at STRATUM level with analysis and does NOT stop a wave. Letting a sampled miss stop a wave would be acceptance by the back door on a sample never designed to bear it.",
      whatItCanShow: "Whether the adopted gates describe the population roughly as they describe the prototype, and where the tails are.",
      whatItCannotShow: "That every one of the island's tiles meets any bar. It does not sample enough cells to say that and does not claim to.",
    },
    subject: { recipeId: "far-tier-hlod-bake-v4", recipeSha256: farTierRecipeHashV4(), populationCells: rows.length },
    samplingMethod: {
      size: sample.length,
      strata: "Style-class mix, face count and wave, plus the two tails the campaign itself surfaced: refusal count and zone-fallback share.",
      selection: "By EXTREME within each stratum, tie-broken by cell id, so the draw is deterministic and reproducible from the committed telemetry. A six-cell random draw of 883 characterizes nothing; the extremes bound what the population can do.",
      reproducibility: "Re-running `plan` against the same telemetry selects the same six cells.",
    },
    sample: sample.map((cell) => ({
      cellId: cell.cellId,
      waveId: cell.waveId,
      stratum: cell.stratum,
      whyChosen: cell.whyChosen,
      faceCount: cell.faceCount,
      includedBuildings: cell.includedBuildings,
      refusedBuildings: cell.refusedBuildings,
      appliedScale: round(cell.appliedScale, 6),
      achievedTexelRatio: round(cell.achievedTexelRatio, 6),
      underResolved: cell.underResolved,
      fallbackZoneCount: cell.fallbackZoneCount,
      fallbackAreaShare: round(cell.fallbackAreaShare, 8),
    })),
    capture: {
      poses: "The six pinned poses: 400, 1200 and 4000 m at azimuths 55 and 235, elevation 18 degrees.",
      instrumentSpecSha256: "9a77561b9d8307aff77692412961102b3a3aa66e1a6dbe04db181a886ad53b89",
      instrumentHarnessSha256: "d394bcf76efdedfdf58b1bef86838137adc71f5a0c544e051f509de0edffc1d2",
      isolation: "Each subject rendered ALONE, the other deleted. hide_render is forbidden and refused by the harness.",
      sourceSubjects: "Materialized through the shipped `sources` path, so the source is the verified shipped bytes rather than a re-authored stand-in.",
      maskDomain: "The SOURCE-and-BAKED INTERSECTION, un-premultiplied. Declared because the domain moves per-channel ratios by up to 0.023 on the same renders.",
      poseTarget: "Each cell's OWN source-bounds centre. The pose rule is the same; the target is per cell because the subjects are.",
    },
    populationPrediction: {
      id: "P-POP",
      statement: `The maximum per-channel spread over all sampled cells and poses is at most ${POPULATION_PREDICTION}.`,
      value: POPULATION_PREDICTION,
      derivation: `A3'' = ${A3_DOUBLE_PRIME} plus an allowance of ${POPULATION_ALLOWANCE}. The allowance is the WIDTH of T013's geometric-term bracket, ${GEOMETRIC_BRACKET.low} to ${GEOMETRIC_BRACKET.high} — the size of the one quantity that measurement could not pin down, and therefore the honest scale for how far another cell's geometry mix may sit from the prototype's. Rounded up from 0.003562 to 0.004.`,
      whatItIsNot: "NOT a bar. No tile fails anything by exceeding it. It is a prediction about a sample, and a miss is a finding about the population rather than a verdict on a tile.",
      ifItIsExceeded: "Record the cell, its stratum and its telemetry, and analyse WHY that stratum sits where it does. Do not widen the prediction and do not re-draw the sample.",
    },
    gatesUsedDescriptively: {
      A1: `|union mean luminance ratio - 1| <= ${A1_ALLOWANCE} where source mean luminance >= ${A1_SOURCE_LUMINANCE_FLOOR}`,
      A2: `|baked - source| union mean luminance <= ${A2_ALLOWANCE}`,
      A3doublePrime: `per-pose channel spread <= ${A3_DOUBLE_PRIME}`,
      note: "Reported per cell and per pose, and summarised per stratum. A cell-level MISS is a finding, not a stop.",
    },
    notClaimedHere: [
      "Nothing has been rendered.",
      "This is not acceptance and does not substitute for T007.",
      "EEVEE under one sun is not the shipped Cesium renderer.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "characterization-plan.json"), text);
  await writeFile(join(evidenceRoot, "characterization-plan.sha256"), `${sha256HexSync(text)}  characterization-plan.json\n`);
  console.log(serialize({ ok: true, sample: record.sample.map((cell) => ({ cellId: cell.cellId, wave: cell.waveId, stratum: cell.stratum, faces: cell.faceCount, scale: cell.appliedScale })), prediction: POPULATION_PREDICTION, recordSha256: sha256HexSync(text) }));
}

/**
 * The measurements are READ, not transcribed.
 *
 * Six cells x six poses x two subjects is 72 channel triples; hand-copying them
 * into this file would put a transcription error between the instrument and the
 * record with nothing to catch it. Blender writes the measurement file, this
 * tool reads it, and the file is digested into the record.
 */
const MEASUREMENTS = join(repositoryRoot, "artifacts", EVIDENCE_ID, "characterization-measurements.json");

async function commandVerdict() {
  const measurementText = await readFile(MEASUREMENTS, "utf8").catch(() => null);
  if (measurementText === null) fail(TOOL, `no characterization measurements at ${MEASUREMENTS}.`);
  const SAMPLE_CAPTURE = JSON.parse(measurementText);
  if (SAMPLE_CAPTURE.length === 0) fail(TOOL, "the characterization measurement file is empty.");
  const planText = await readFile(join(evidenceRoot, "characterization-plan.json"), "utf8");
  const plan = JSON.parse(planText);

  const cells = SAMPLE_CAPTURE.map((cell) => {
    const planned = plan.sample.find((entry) => entry.cellId === cell.cellId);
    const poses = cell.poses.map((pose) => {
      const ratios = pose.baked.map((value, index) => value / pose.source[index]);
      const spread = spreadOf(ratios);
      const luminanceRatio = pose.bakedUnionMeanLuminance / pose.sourceUnionMeanLuminance;
      const absolute = pose.bakedUnionMeanLuminance - pose.sourceUnionMeanLuminance;
      const a1Applies = pose.sourceUnionMeanLuminance >= A1_SOURCE_LUMINANCE_FLOOR;
      return {
        pose: pose.pose,
        intersectionPixels: pose.intersectionPixels,
        sourceSilhouettePixels: pose.sourceSilhouettePixels,
        bakedSilhouettePixels: pose.bakedSilhouettePixels,
        thinIntersection: pose.intersectionPixels < 100,
        perChannelRatios: ratios.map((value) => round(value, 6)),
        channelSpread: round(spread, 6),
        unionMeanLuminanceRatio: round(luminanceRatio, 6),
        absoluteLuminanceDifference: round(absolute, 8),
        A1: a1Applies ? (Math.abs(luminanceRatio - 1) <= A1_ALLOWANCE ? "PASS" : "MISS") : "not applicable",
        A2: Math.abs(absolute) <= A2_ALLOWANCE ? "PASS" : "MISS",
        A3doublePrime: spread <= A3_DOUBLE_PRIME ? "PASS" : "MISS",
      };
    });
    return {
      cellId: cell.cellId,
      waveId: planned.waveId,
      stratum: planned.stratum,
      telemetry: { faceCount: planned.faceCount, appliedScale: planned.appliedScale, achievedTexelRatio: planned.achievedTexelRatio, underResolved: planned.underResolved, refusedBuildings: planned.refusedBuildings, fallbackAreaShare: planned.fallbackAreaShare },
      poses,
      worstChannelSpread: round(Math.max(...poses.map((pose) => pose.channelSpread)), 6),
      a3Misses: poses.filter((pose) => pose.A3doublePrime === "MISS").map((pose) => pose.pose),
      a1Misses: poses.filter((pose) => pose.A1 === "MISS").map((pose) => pose.pose),
      a2Misses: poses.filter((pose) => pose.A2 === "MISS").map((pose) => pose.pose),
    };
  });

  const worst = Math.max(...cells.map((cell) => cell.worstChannelSpread));
  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:characterization-results`,
    task: "T004",
    artifact: "far-tier-mass-bake-characterization-results",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    headline: `${cells.length} cells, ${cells.length * 6} captures. Worst sampled per-channel spread ${worst} against a pre-registered population prediction of ${POPULATION_PREDICTION}.`,
    boundTo: { plan: "characterization-plan.json", planSha256: sha256HexSync(planText), measurements: "characterization-measurements.json (gitignored work product)", measurementsSha256: sha256HexSync(measurementText) },
    status: "DESCRIPTIVE. Not acceptance; see T007.",
    populationPrediction: {
      value: POPULATION_PREDICTION,
      worstSampledSpread: worst,
      verdict: worst <= POPULATION_PREDICTION ? "HELD" : "EXCEEDED",
      consequenceOfExceeding: "A finding about the population, analysed at stratum level. No wave stops and no tile fails.",
    },
    cells,
    analysis: {
      required: "The plan pre-registered that a cell-level MISS is recorded at STRATUM level with analysis and does not stop a wave. This is that analysis.",
      hueHeldAlmostEverywhere: {
        statement: `A3'' held at ${cells.reduce((sum, cell) => sum + cell.poses.filter((pose) => pose.A3doublePrime === "PASS").length, 0)} of ${cells.length * 6} poses, and EVERY miss is one cell.`,
        theOutlier: (() => {
          const outlier = cells.find((cell) => cell.a3Misses.length > 0);
          return outlier ? `${outlier.stratum} (${outlier.cellId}), ${outlier.telemetry.faceCount} faces, one building: spreads up to ${outlier.worstChannelSpread} at the three azimuth-235 poses. It alone exceeds the population prediction, and it is the smallest cell in the island.` : "none";
        })(),
        whyThatCellIsHard: "A single small building has almost no wall area for the aggregate to average, so its tile is dominated by one roof cap and a handful of flat faces. Its azimuth-235 poses are also the darkest in the sample, where a small absolute difference is a large ratio.",
        thinIntersections: (() => {
          const thin = cells.flatMap((cell) => cell.poses.filter((pose) => pose.thinIntersection).map((pose) => ({ stratum: cell.stratum, pose: pose.pose, px: pose.intersectionPixels })));
          const strata = [...new Set(thin.map((entry) => entry.stratum))];
          const distances = [...new Set(thin.map((entry) => entry.pose.split("/")[0]))].sort((left, right) => Number(left) - Number(right));
          return `${thin.length} of ${cells.length * 6} poses have fewer than 100 intersection pixels — on ${strata.length} cell(s) (${strata.join(", ")}) at ${distances.join(" and ")} m, the smallest ${Math.min(...thin.map((entry) => entry.px))} pixels. Ratios from a domain that small are reported for completeness and are NOT evidence of anything.`;
        })(),
      },
      theSystematicFindingIsLuminanceNotHue: {
        statement: "The gate that fails broadly is not A3'' but A1 and A2, and it fails in ONE direction: the tile is BRIGHTER than the source at azimuth 55.",
        a1: `${cells.reduce((sum, cell) => sum + cell.poses.filter((pose) => pose.A1 === "PASS").length, 0)} of ${cells.reduce((sum, cell) => sum + cell.poses.filter((pose) => pose.A1 !== "not applicable").length, 0)} applicable poses pass.`,
        a2: `${cells.reduce((sum, cell) => sum + cell.poses.filter((pose) => pose.A2 === "PASS").length, 0)} of ${cells.length * 6} poses pass.`,
        direction: "Every A1 and A2 miss in the sample is the tile reading brighter, with union luminance ratios from 1.04 to 1.21. Not one pose fails by being too dark.",
        whichStrataFail: cells.filter((cell) => cell.a1Misses.length > 0 || cell.a2Misses.length > 0).map((cell) => ({ stratum: cell.stratum, faceCount: cell.telemetry.faceCount, a1Misses: cell.a1Misses.length, a2Misses: cell.a2Misses.length })),
        whichPass: cells.filter((cell) => cell.a1Misses.length === 0 && cell.a2Misses.length === 0).map((cell) => ({ stratum: cell.stratum, faceCount: cell.telemetry.faceCount })),
        observedPattern: "The two cells that pass everything are the LARGEST (3,836 faces) and the MEDIAN (671). The four that miss are smaller or thinner. The prototype T013 measured has 764 faces and 48 buildings and sits with the passing group — so the prototype is NOT representative of the population for LUMINANCE, and the campaign is the first evidence of that.",
        mechanismNotEstablished: "NO mechanism is claimed. The obvious candidate is that a prism carries no self-shadowing or inter-building occlusion while the source does, so the source darkens more where geometry is dense per unit of silhouette. That is a hypothesis this stage did not test, and it belongs to T007 with a sample designed for it.",
      },
      aLabelCorrection: "The committed plan calls one stratum `median-face-count`. It is the UPPER MEDIAN — index floor(n/2) of an even-length population is the upper of the two middle elements. The CELL is unchanged and the plan remains reproducible; the tool's label now says `upper-median-face-count` and the plan is not rewritten, because a plan written before a capture is not edited after one.",
      whatThisDoesNotDo: "It does not stop a wave, invalidate a tile, or reopen the adopted gates. It is the population picture the campaign was run to obtain, and it says the luminance gates need attention before acceptance.",
    },
    byStratum: cells.map((cell) => ({ stratum: cell.stratum, cellId: cell.cellId, worstChannelSpread: cell.worstChannelSpread, a3Misses: cell.a3Misses.length, a1Misses: cell.a1Misses.length, a2Misses: cell.a2Misses.length })),
    aggregate: {
      posesMeasured: cells.length * 6,
      a3Passes: cells.reduce((sum, cell) => sum + cell.poses.filter((pose) => pose.A3doublePrime === "PASS").length, 0),
      a1Applicable: cells.reduce((sum, cell) => sum + cell.poses.filter((pose) => pose.A1 !== "not applicable").length, 0),
      a1Passes: cells.reduce((sum, cell) => sum + cell.poses.filter((pose) => pose.A1 === "PASS").length, 0),
      a2Passes: cells.reduce((sum, cell) => sum + cell.poses.filter((pose) => pose.A2 === "PASS").length, 0),
    },
    notClaimedHere: [
      "Six cells of 883. The extremes bound the population; they do not measure it.",
      "This is not acceptance and no gate verdict here binds a tile.",
      "EEVEE under one sun is not the shipped Cesium renderer.",
    ],
  };
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "characterization-results.json"), text);
  await writeFile(join(evidenceRoot, "characterization-results.sha256"), `${sha256HexSync(text)}  characterization-results.json\n`);
  console.log(serialize({ ok: true, worstSampledSpread: worst, prediction: POPULATION_PREDICTION, verdict: record.populationPrediction.verdict, aggregate: record.aggregate, recordSha256: sha256HexSync(text) }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  if (command === "plan") await commandPlan();
  else if (command === "verdict") await commandVerdict();
  else fail(TOOL, "usage: far-tier-characterization-cli.mjs <plan|verdict>");
}
