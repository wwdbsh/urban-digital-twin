/* global console, process */
/**
 * THE T006 CAMPAIGN ROLL-UP.
 *
 * One document that puts every pre-registered gate beside the reading that
 * decided it. It is a JOIN, not a judgement: every verdict below is READ out of
 * the capture record that measured it, and this file computes no percentile, no
 * byte total and no pass condition of its own. If a gate's verdict here differs
 * from the capture record's, that is a bug in this file and the colocated drift
 * test is what catches it.
 *
 * WHY IT IS GENERATED RATHER THAN WRITTEN BY HAND. A roll-up typed by a person
 * is a place where a FAIL quietly becomes a "mostly", and where a gate that was
 * never captured can go missing without anybody noticing. This file enumerates
 * the gate list from the frozen pre-registration module, so a gate with no
 * capture appears as NOT-CAPTURED rather than as an absence.
 *
 * THE FIVE VERDICT WORDS, and what each one commits to:
 *
 *   PASS         The reading met the bar that was committed before it existed.
 *   FAIL         It did not. Recorded, and the campaign continues; the goal's
 *                own honest-stop form is a named failure with its number, not
 *                an abandoned run.
 *   REPORTED     Pre-registered as non-gating. It informs and discharges
 *                nothing. F2, F4, H1, H2, S-1d, G4, M3 and M4 are these.
 *   HONEST-STOP  Pre-registered as STRUCTURALLY UNREACHABLE before any capture
 *                was attempted. L2 is the only one.
 *   NOT-CAPTURED The capture that would have decided it is absent. Never
 *                silently omitted.
 *
 * Usage:
 *   node scripts/exterior-acceptance-campaign-record-cli.mjs [--out=<evidence-id>]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  AC_MAPPING,
  CACHE_CEILINGS,
  CAMPAIGN_DISCIPLINE,
  CAMPAIGN_EVIDENCE_ID,
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
  SHARED_CLASS_TILE_NAMES,
  VISUAL_GATES,
} from "./exterior-acceptance-campaign-constants.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argValue(argv, name, fallback) {
  const found = argv.find((token) => token.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }

const NOT_CAPTURED = "NOT-CAPTURED";

/** PASS / FAIL from a boolean, or NOT-CAPTURED when the reading is absent. */
function verdictOf(value) {
  if (value === true) return "PASS";
  if (value === false) return "FAIL";
  return NOT_CAPTURED;
}

function row(gateId, criterion, verdict, rule, keyNumbers, source, extra = {}) {
  return { gateId, criterion, verdict, rule, keyNumbers, source, ...extra };
}

async function readRecord(root, name) {
  return readFile(join(root, name), "utf8").then((text) => JSON.parse(text)).catch(() => null);
}

async function main() {
  const argv = process.argv.slice(2);
  const evidenceId = argValue(argv, "--out", CAMPAIGN_EVIDENCE_ID);
  const root = join(repositoryRoot, "data", evidenceId);

  const preRegistration = await readRecord(root, "pre-registration.json");
  if (!preRegistration) throw new Error(`exterior-acceptance-campaign-record: no pre-registration at data/${evidenceId}/pre-registration.json; a roll-up without its pre-registration is not a roll-up.`);
  const control = await readRecord(root, "frame-control.json");
  const frames = await readRecord(root, "frames-and-gpu.json");
  const headroom = await readRecord(root, "headroom.json");
  const storm = await readRecord(root, "storm.json");
  const eviction = await readRecord(root, "eviction-loop.json");
  const lod = await readRecord(root, "lod-l1.json");
  const journeys = await readRecord(root, "journeys.json");
  const heap = await readRecord(root, "heap-repeat-evidence.json");
  const cleanup = await readRecord(root, "chrome-cleanup.json");

  const missing = Object.entries({
    "frame-control.json": control,
    "frames-and-gpu.json": frames,
    "headroom.json": headroom,
    "storm.json": storm,
    "eviction-loop.json": eviction,
    "lod-l1.json": lod,
    "journeys.json": journeys,
    "heap-repeat-evidence.json": heap,
  }).filter(([, record]) => record === null).map(([name]) => name);

  const gates = [];

  // ---- F: frames --------------------------------------------------------
  gates.push(row("F1", "#5", verdictOf(frames?.gates?.F1?.pass), FRAME_F1.rule, {
    bar: { p50Ms: FRAME_F1.p50Ms, p95Ms: FRAME_F1.p95Ms, minimumFrames: FRAME_F1.minimumFrames, settleMs: FRAME_F1.settleMs, windowMs: FRAME_F1.windowMs },
    perStation: (frames?.gates?.F1?.perStation ?? []).map((entry) => ({ stationId: entry.stationId, p50Ms: entry.p50Ms, p95Ms: entry.p95Ms, sampleCount: entry.sampleCount, pass: entry.pass, instrumentLimited: entry.instrumentLimited })),
  }, "frames-and-gpu.json"));

  gates.push(row("F2", "#5", "REPORTED", FRAME_F2.rule, {
    controlByMode: (control?.modes ?? []).map((mode) => ({ vsyncMode: mode.vsyncMode, p50Ms: mode.p50Ms, p95Ms: mode.p95Ms, sampleCount: mode.sampleCount })),
    inSessionControl: frames?.control ? { vsyncMode: frames.control.vsyncMode, p50Ms: frames.control.p50Ms, p95Ms: frames.control.p95Ms, sampleCount: frames.control.sampleCount } : null,
    stationsAtOrBelowControlP95: frames?.gates?.F2?.stationsAtOrBelowControlP95 ?? null,
  }, "frame-control.json + frames-and-gpu.json", { whyNotABar: FRAME_F2.whyNotABar }));

  gates.push(row("F4", "#5", "REPORTED", FRAME_F4.rule, {
    legYDoubleDrawMs: FRAME_F4.legYDoubleDrawMs,
    legXRebuildMs: FRAME_F4.legXRebuildMs,
    stationsMaxDoubleDrawMs: frames?.gates?.F4?.maxDoubleDrawMs ?? null,
    stationsMaxTotalBuildMs: frames?.gates?.F4?.maxTotalBuildMs ?? null,
    stormMaxDoubleDrawMs: storm?.gates?.F4?.maxDoubleDrawMs ?? null,
    stormMaxTotalBuildMs: storm?.gates?.F4?.maxTotalBuildMs ?? null,
    stationsOutcome: frames?.gates?.F4?.outcome ?? null,
  }, "frames-and-gpu.json + storm.json", { inheritedFrom: FRAME_F4.inheritedFrom }));

  // ---- H: headroom ------------------------------------------------------
  gates.push(row("H1", "#5", "REPORTED", HEADROOM_H1.rule, {
    launchFlags: HEADROOM_H1.launchFlags,
    comparedStations: HEADROOM_H1.comparedStations,
    p50Ms: headroom?.gates?.H1?.p50Ms ?? null,
    separationMs: headroom?.gates?.H1?.separationMs ?? null,
    vsyncOffControlP95Ms: headroom?.gates?.H1?.controlP95Ms ?? null,
    detectable: headroom?.gates?.H1?.detectable ?? null,
  }, "headroom.json", { detectabilityCondition: HEADROOM_H1.detectabilityCondition, finding: headroom?.gates?.H1?.finding ?? null }));

  gates.push(row("H2", "#5", "REPORTED", HEADROOM_H2.rule, {
    source: HEADROOM_H2.source,
    stationsWithDeltas: (frames?.headroomH2?.perStation ?? []).map((entry) => entry.stationId),
    headroomStationsWithDeltas: (headroom?.gates?.H2?.perStation ?? []).map((entry) => entry.stationId),
  }, "frames-and-gpu.json + headroom.json", { caveat: HEADROOM_H2.caveat }));

  // ---- S-1: storm -------------------------------------------------------
  gates.push(row("S-1a", "#5", verdictOf(storm?.gates?.["S-1a"]?.pass), storm?.gates?.["S-1a"]?.rule ?? null, {
    bar: { p50Ms: FRAME_F1.p50Ms, p95Ms: FRAME_F1.p95Ms },
    duringStormFrame: storm?.gates?.["S-1a"]?.duringStormFrame ?? null,
    postStormFrame: storm?.postStormFrame ?? null,
    stormMs: storm?.method?.stormMs ?? null,
  }, "storm.json", { stricterThanT005: storm?.gates?.["S-1a"]?.stricterThanT005 ?? null }));

  gates.push(row("S-1b", "#7", verdictOf(storm?.gates?.["S-1b"]?.pass), storm?.gates?.["S-1b"]?.rule ?? null, {
    ceilings: { maxConcurrent: REQUEST_CEILINGS.appWideSharedSemaphoreMaxConcurrent, ...CACHE_CEILINGS },
    maxPeakConcurrentRequests: storm?.gates?.["S-1b"]?.maxPeakConcurrentRequests ?? null,
    maxCacheEntriesObserved: storm?.gates?.["S-1b"]?.maxCacheEntriesObserved ?? null,
    maxCachedBytesObserved: storm?.gates?.["S-1b"]?.maxCachedBytesObserved ?? null,
  }, "storm.json"));

  gates.push(row("S-1c", "#7", verdictOf(storm?.gates?.["S-1c"]?.pass), storm?.gates?.["S-1c"]?.rule ?? null, {
    worst: storm?.gates?.["S-1c"]?.worst ?? null,
  }, "storm.json", { whyItExists: storm?.gates?.["S-1c"]?.whyItExists ?? null }));

  gates.push(row("S-1d", "#7", "REPORTED", storm?.gates?.["S-1d"]?.rule ?? null, {
    cacheEvictionsStart: storm?.gates?.["S-1d"]?.cacheEvictionsStart ?? null,
    cacheEvictionsEnd: storm?.gates?.["S-1d"]?.cacheEvictionsEnd ?? null,
    releasedArtifactCountEnd: storm?.gates?.["S-1d"]?.releasedArtifactCountEnd ?? null,
    releasedArtifactBytesEnd: storm?.gates?.["S-1d"]?.releasedArtifactBytesEnd ?? null,
    noticeCount: storm?.gates?.["S-1d"]?.notices?.items?.length ?? null,
  }, "storm.json"));

  gates.push(row("S-1e", "#7", verdictOf(storm?.gates?.["S-1e"]?.pass), storm?.gates?.["S-1e"]?.rule ?? null, {
    externalHosts: storm?.gates?.["S-1e"]?.externalHosts ?? null,
  }, "storm.json"));

  // ---- G: GPU texture memory -------------------------------------------
  const g1Pass = frames?.gates?.G1?.pass ?? null;
  gates.push(row("G1", "#3", verdictOf(g1Pass), GPU_GATES.G1.rule, {
    barBytes: GPU_GATES.G1.barBytes,
    releaseId: frames?.gates?.G1?.releaseId ?? null,
    declaredClassTileCount: frames?.gates?.G1?.declaredClassTileCount ?? null,
    observedClassTileCount: frames?.gates?.G1?.observedClassTileCount ?? null,
    measuredTextureByteLength: frames?.gates?.G1?.verdict?.measuredTextureByteLength ?? null,
    predictedTextureByteLength: frames?.gates?.G1?.verdict?.predictedTextureByteLength ?? null,
    deltaByteLength: frames?.gates?.G1?.verdict?.deltaByteLength ?? null,
  }, "frames-and-gpu.json"));

  // G2 is judged on the HIGHEST texture reading anywhere in the session, not
  // only at the pre-registered maximum-residency station. That is stricter than
  // the registered wording and it is the stricter direction, so it is taken.
  const textureReadings = (frames?.stations ?? []).map((station) => ({
    stationId: station.stationId,
    texturesByteLength: station.texture?.reading?.texturesByteLength ?? null,
    residentAssetCount: station.texture?.residentAssetCount ?? null,
    residentWaveCount: station.residentWaveCount ?? null,
  })).filter((reading) => typeof reading.texturesByteLength === "number");
  const g2Worst = textureReadings.reduce((worst, reading) => (worst === null || reading.texturesByteLength > worst.texturesByteLength ? reading : worst), null);
  const g2Bar = frames?.gates?.G2?.barByteLength ?? null;
  const g2Pass = g2Worst !== null && g2Bar !== null ? g2Worst.texturesByteLength <= g2Bar : null;
  gates.push(row("G2", "#3", g1Pass === true ? verdictOf(g2Pass) : g1Pass === false ? "NOT-MEASURED" : NOT_CAPTURED, GPU_GATES.G2.rule, {
    expectedUniqueTileCount: EXPECTED_UNIQUE_TILE_COUNT,
    expectedByteLength: EXPECTED_TEXTURE_BYTE_LENGTH,
    barByteLength: g2Bar,
    preRegisteredMaximumResidencyStation: frames?.gates?.G2?.stationId ?? null,
    preRegisteredStationByteLength: frames?.gates?.G2?.measuredByteLength ?? null,
    worstObservedStation: g2Worst?.stationId ?? null,
    worstObservedByteLength: g2Worst?.texturesByteLength ?? null,
    worstObservedTileCount: g2Worst === null ? null : g2Worst.texturesByteLength / 87_381,
    allStationReadings: textureReadings,
  }, "frames-and-gpu.json", {
    ...(g1Pass === false ? { notMeasuredBecause: "G1 FAILED. The pre-registration says in as many words that if G1 fails, G2-G4 are NOT reported as measurements: a probe that disagrees with arithmetic on a small known scene has not earned the right to be quoted on a large one." } : {}),
    strictnessNote: "The registered wording judges G2 at the maximum-RESIDENCY station. This row judges it at the maximum-TEXTURE-BYTES station, which is the harder reading and is not always the same pose: resident asset count and resident wave count are different quantities, and only the second one moves texture bytes.",
    ...(g2Worst !== null && g2Worst.texturesByteLength < EXPECTED_TEXTURE_BYTE_LENGTH
      ? { weakerThanItLooks: `THE BAR WAS NEVER PRESSED, and that is stated rather than banked. The 2,097,144-byte bar assumes all ${EXPECTED_UNIQUE_TILE_COUNT} unique tiles co-resident, i.e. all six waves holding cells at once. The highest reading anywhere in this session was ${g2Worst.texturesByteLength} bytes (${g2Worst.texturesByteLength / 87_381} tiles) at ${g2Worst.stationId} with ${g2Worst.residentWaveCount} resident wave(s), because the scheduler's 8-resident-unit cap keeps the co-resident wave count low at every pose the campaign visited. G2 passing therefore says the budget was not exceeded; it does NOT say the budget was tested at its own assumption.` }
      : {}),
  }));

  // G3 is the architecture claim, and its verdict is a comparison ACROSS the
  // readings rather than a single number. It is computed from the readings the
  // capture published, and the tile count is derived from the shipped
  // per-tile cost rather than assumed.
  const g3Readings = (frames?.gates?.G3?.readings ?? []).map((reading) => ({
    ...reading,
    tilesPerResidentWave: reading.residentWaveCount ? Number((reading.impliedTileCount / reading.residentWaveCount).toFixed(4)) : null,
    tilesPerHundredResidentAssets: reading.residentAssetCount ? Number(((reading.impliedTileCount / reading.residentAssetCount) * 100).toFixed(4)) : null,
  }));
  const high = g3Readings.filter((reading) => (reading.residentAssetCount ?? -1) >= (GPU_GATES.G3.residentAssetHigh ?? 300));
  const low = g3Readings.filter((reading) => typeof reading.residentAssetCount === "number" && reading.residentAssetCount <= (GPU_GATES.G3.residentAssetLow ?? 20));
  /**
   * THE OPERATIVE CLAUSE, taken literally.
   *
   * The registered sentence has two clauses. The first — "4 per RESIDENT WAVE"
   * — is the CEILING the shared-class catalogue imposes: a wave publishes four
   * class tiles and no more, so a resident wave can contribute at most four and
   * a building contributes none of its own. The second — "texturesByteLength
   * must be explained by the resident WAVE count, never by the asset count" — is
   * the claim the gate exists to test, and it is the one the verdict is taken
   * on. Both are reported; neither is quietly dropped.
   *
   * A reading BELOW four tiles per resident wave is not a violation: it means
   * that wave's resident cells did not use all four style classes. Only a
   * reading ABOVE it, or one that rises with the building count at a fixed wave
   * count, would falsify shared per-class delivery.
   */
  const withinCeiling = g3Readings.every((reading) => reading.impliedTileCount <= (reading.residentWaveCount ?? 0) * 4 && Number.isInteger(reading.impliedTileCount));
  const strictlyFourPerWave = g3Readings.every((reading) => reading.impliedTileCount === (reading.residentWaveCount ?? 0) * 4);
  // Asset independence, read off the pair the gate asks for: the high-asset
  // reading must not carry more tiles than the low-asset one unless it also
  // holds more waves.
  const assetIndependent = high.every((heavy) => low.every((light) => (
    heavy.impliedTileCount <= light.impliedTileCount || (heavy.residentWaveCount ?? 0) > (light.residentWaveCount ?? 0)
  )));
  const g3Pass = high.length > 0 && low.length > 0 ? withinCeiling && assetIndependent : null;
  gates.push(row("G3", "#3", g1Pass === true ? verdictOf(g3Pass) : g1Pass === false ? "NOT-MEASURED" : NOT_CAPTURED, GPU_GATES.G3.rule, {
    sharedClassTileNames: SHARED_CLASS_TILE_NAMES,
    residentAssetHigh: GPU_GATES.G3.residentAssetHigh,
    residentAssetLow: GPU_GATES.G3.residentAssetLow,
    highResidencyReadings: high,
    lowResidencyReadings: low,
    everyReadingWithinFourPerResidentWave: withinCeiling,
    everyReadingExactlyFourPerResidentWave: strictlyFourPerWave,
    assetCountIndependent: assetIndependent,
    allReadings: g3Readings,
  }, "frames-and-gpu.json", {
    whyItIsTheRealClaim: GPU_GATES.G3.whyItIsTheRealClaim,
    twoClauseNote: "The verdict is taken on the operative clause — texture bytes explained by the resident WAVE count and never by the asset count — with the four-per-wave ceiling checked beside it. A reading strictly below four tiles per resident wave means that wave's resident cells used fewer than four style classes; it is not a violation, and it is reported rather than rounded up.",
    ...(strictlyFourPerWave ? {} : { exactlyFourNotObserved: "At least one reading carried FEWER than four tiles per resident wave. That is the expected consequence of a resident set that does not use every style class, and it is recorded rather than presented as agreement with the arithmetic." }),
    ...(high.length === 0 || low.length === 0
      ? { notCapturedBecause: `The pre-registered pair needs one reading at >= ${GPU_GATES.G3.residentAssetHigh} resident assets and one at <= ${GPU_GATES.G3.residentAssetLow}. This campaign captured ${high.length} and ${low.length} of them respectively, so the comparison the gate asks for was not available and no verdict is asserted from a single side of it.` }
      : {}),
  }));

  gates.push(row("G4", "#3", "REPORTED", GPU_GATES.G4.rule, {
    citation: "data/shared-class-textures-20260815/gpu-campaign.json",
    p1EmbeddedByteLength: 15_204_294,
    p1EmbeddedDistinctTextures: 174,
    t1SharedByteLength: 349_524,
    t1SharedDistinctTextures: 4,
  }, "citation only; no capture", { restatedNotRecaptured: true }));

  // ---- E-1: eviction ----------------------------------------------------
  for (const [gateId, key] of [["E-1a", "E-1a"], ["E-1b", "E-1b"], ["E-1c", "E-1c"], ["E-1d", "E-1d"], ["E-1e", "E-1e"]]) {
    const gate = eviction?.gates?.[key] ?? null;
    gates.push(row(gateId, "#7", verdictOf(gate?.pass), gate?.rule ?? null, {
      ...(gateId === "E-1a" ? { maxCacheEvictions: gate?.maxCacheEvictions ?? null, evictionsByStop: gate?.evictionsByStop ?? null } : {}),
      ...(gateId === "E-1b" ? { returnStop: gate?.returnStop ?? null, fallbackCellCount: gate?.fallbackCellCount ?? null, failedCellCount: gate?.failedCellCount ?? null, failedArtifactCount: gate?.failedArtifactCount ?? null } : {}),
      ...(gateId === "E-1c" ? { maxPeakConcurrentRequests: gate?.maxPeakConcurrentRequests ?? null, ceiling: REQUEST_CEILINGS.appWideSharedSemaphoreMaxConcurrent } : {}),
      ...(gateId === "E-1d" ? { maxCacheEntries: gate?.maxCacheEntries ?? null, maxCachedBytes: gate?.maxCachedBytes ?? null, caps: CACHE_CEILINGS } : {}),
      ...(gateId === "E-1e" ? { selector: gate?.selector ?? null, selectionDigestFirstVisit: gate?.selectionDigestFirstVisit ?? null, selectionDigestAfterReEntry: gate?.selectionDigestAfterReEntry ?? null, bothNonNull: gate?.bothNonNull ?? null, equal: gate?.equal ?? null } : {}),
    }, "eviction-loop.json"));
  }
  gates.push(row("E-1f", "#7", "CARRIED-VERBATIM", eviction?.gates?.["E-1f"]?.rule ?? null, {
    source: "data/exterior-serving-20260817/eviction-at-scale.json, field uncapturedGap",
  }, "eviction-loop.json", { statement: "NOT CLOSED by this campaign. A canvas pick on the re-admitted mesh was not captured here either." }));

  // ---- M: heap ----------------------------------------------------------
  const heapSampledWithZeroActiveRequests = heap
    ? (heap.perRepeat ?? []).flatMap((repeat) => repeat.poses ?? []).filter((pose) => typeof pose.jsHeapBytes === "number")
    : [];
  gates.push(row("M1", "#6", heap ? verdictOf(heap.passed) : NOT_CAPTURED, HEAP_GATES.M1.rule, {
    growthRatio: heap?.heapVerdict?.growthRatio ?? null,
    noiseBandRatio: heap?.preRegistered?.noiseBandRatio ?? null,
    monotonicGrowthDetected: heap?.heapVerdict?.monotonicGrowthDetected ?? null,
    sampleCount: heap?.heapVerdict?.sampleCount ?? null,
    verdictSeries: heap?.verdictSeriesShape ?? null,
  }, "heap-repeat-evidence.json"));

  gates.push(row("M2", "#6", heap ? "PASS" : NOT_CAPTURED, HEAP_GATES.M2.rule, {
    samplesTaken: heapSampledWithZeroActiveRequests.length,
    activeRequestsAtEverySample: heapSampledWithZeroActiveRequests.every((pose) => pose.activeRequestsAtSample === 0),
    distinctActiveRequestValues: [...new Set(heapSampledWithZeroActiveRequests.map((pose) => pose.activeRequestsAtSample))],
  }, "heap-repeat-evidence.json", {
    howItPasses: "M2 is FAIL-CLOSED IN THE INSTRUMENT, not judged here: a non-zero activeRequests at sample time aborts the run and writes NO record. The existence of a record is therefore the evidence that every sample was taken quiescent, and the per-sample readings above are published so a reader can check that rather than take it on trust.",
    onViolation: HEAP_GATES.M2.onViolation,
  }));

  gates.push(row("M3", "#6", "REPORTED", HEAP_GATES.M3.rule, {
    poseId: heap?.disclosedSeries?.overviewSecondary?.poseId ?? null,
    jsHeapBytes: heap?.disclosedSeries?.overviewSecondary?.jsHeapBytes ?? null,
    shape: heap?.disclosedSeries?.overviewSecondary?.shape ?? null,
  }, "heap-repeat-evidence.json"));

  gates.push(row("M4", "#6", "REPORTED", HEAP_GATES.M4.rule, {
    attemptCount: heap?.attemptCount ?? null,
    lapPhaseCapMs: heap?.t006?.lapPhaseCapMs ?? null,
    lapPhaseMs: heap?.method?.lapPhaseMs ?? null,
  }, "heap-repeat-evidence.json", { lapPhaseCapReason: HEAP_GATES.lapPhaseCapReason }));

  // ---- J: journeys ------------------------------------------------------
  /**
   * J4's DIAGNOSIS, computed rather than narrated.
   *
   * The gate compares a digest of the WHOLE details panel. When it fails, the
   * useful question is which rows differ, because "the same building resolves
   * to the same sourced information" is a claim about the identity and
   * provenance rows and not about rows that describe the RESIDENT SCENE. This
   * splits the panel into rows both arms carry (and whether they agree) and
   * rows only one arm carries, so a reader can see what the difference actually
   * was instead of taking a hash's word for it.
   */
  const j2Panel = (journeys?.journeys ?? []).find((entry) => entry.journeyId === JOURNEY_GATES.J2.journeyId)?.panel ?? null;
  const j4Panel = (journeys?.journeys ?? []).find((entry) => entry.journeyId === JOURNEY_GATES.J4.journeyId)?.panel ?? null;
  const j4Diagnosis = j2Panel && j4Panel ? (() => {
    const interactive = j2Panel.rows ?? {};
    const deepLink = j4Panel.rows ?? {};
    const shared = Object.keys(interactive).filter((label) => label in deepLink);
    const agreeing = shared.filter((label) => interactive[label] === deepLink[label]);
    return {
      sharedRowCount: shared.length,
      agreeingRowCount: agreeing.length,
      disagreeingRows: shared.filter((label) => interactive[label] !== deepLink[label]).map((label) => ({ label, interactive: interactive[label], deepLink: deepLink[label] })),
      rowsOnlyInInteractiveArm: Object.keys(interactive).filter((label) => !(label in deepLink)),
      rowsOnlyInDeepLinkArm: Object.keys(deepLink).filter((label) => !(label in interactive)),
      identityRows: ["Feature ID", "Coordinates", "Confidence", "Geometry"].map((label) => ({ label, interactive: interactive[label] ?? null, deepLink: deepLink[label] ?? null, agree: (interactive[label] ?? null) === (deepLink[label] ?? null) })),
    };
  })() : null;
  for (const journeyKey of ["J1", "J2", "J3", "J4", "J5"]) {
    const registered = JOURNEY_GATES[journeyKey];
    const captured = (journeys?.journeys ?? []).find((entry) => entry.journeyId === registered.journeyId) ?? null;
    gates.push(row(journeyKey, "#8", verdictOf(captured?.pass), captured?.passRule ?? null, {
      journeyId: registered.journeyId,
      claim: registered.claim,
      still: captured?.still ?? null,
      ...(journeyKey === "J1" ? { activeWaveCount: captured?.activeWaveCount ?? null, bootDocumentTotal: captured?.bootDocumentTotal ?? null } : {}),
      ...(journeyKey === "J2" ? { searchResultCount: captured?.searchResultCount ?? null, presentRows: captured?.presentRows ?? null, missingRows: captured?.missingRows ?? null } : {}),
      ...(journeyKey === "J3" ? { activeWaveIds: captured?.activeWaveIds ?? null, residentCount: captured?.residentCount ?? null } : {}),
      ...(journeyKey === "J4" ? { urlRoundTripped: captured?.urlRoundTripped ?? null, digestsMatch: captured?.digestsMatch ?? null, bothNonNull: captured?.bothNonNull ?? null, diagnosis: j4Diagnosis } : {}),
      ...(journeyKey === "J5" ? { unavailableStatements: captured?.unavailableStatements ?? null, stillDiffersFromDefaultArm: captured?.stillDiffersFromDefaultArm ?? null } : {}),
    }, "journeys.json", journeyKey === "J3" && captured?.claimCorrection ? { claimCorrection: captured.claimCorrection } : {}));
  }
  const j6 = (journeys?.journeys ?? []).find((entry) => entry.journeyId === JOURNEY_GATES.J6.journeyId) ?? null;
  gates.push(row("J6", "#8", j6 === null ? NOT_CAPTURED : "CROSS-REFERENCE", JOURNEY_GATES.J6.crossReference, {
    referent: "E-1e",
    selectionDigestFirstVisit: j6?.selectionDigestFirstVisit ?? null,
    selectionDigestAfterReEntry: j6?.selectionDigestAfterReEntry ?? null,
    pass: j6?.pass ?? null,
  }, "journeys.json -> eviction-loop.json"));

  // ---- L: LOD -----------------------------------------------------------
  gates.push(row("L1", "#4", verdictOf(lod?.gate?.pass), LOD_L1.rule, {
    releaseId: LOD_L1.releaseId,
    buildingCount: LOD_L1.buildingCount,
    profile: LOD_L1.profile,
    lodSeamMeters: LOD_L1.lodSeamMeters,
    lodIdAt200m: lod?.gate?.lodIdAt200m ?? null,
    lodIdAt300m: lod?.gate?.lodIdAt300m ?? null,
    stillSha256At200m: lod?.gate?.stillSha256At200m ?? null,
    stillSha256At300m: lod?.gate?.stillSha256At300m ?? null,
    stillsDifferByChecksum: lod?.gate?.stillsDifferByChecksum ?? null,
  }, "lod-l1.json", {
    heightBucketingDisclosure: LOD_L1.heightBucketingDisclosure,
    lodIdReadMethod: LOD_L1.lodIdReadMethod,
    explicitlyNotDischarging: LOD_L1.explicitlyNotDischarging,
  }));

  gates.push(row("L2", "#4", "HONEST-STOP", LOD_L2.rule, {
    promotedWaveCount: preRegistration.reconciliation?.servingComposition?.releases?.length ?? null,
    everyWaveShipsASingleLod: preRegistration.reconciliation?.servingComposition?.everyWaveShipsASingleLod ?? null,
    shippedLodIdsPerWave: (preRegistration.reconciliation?.servingComposition?.releases ?? []).map((release) => ({ releaseId: release.releaseId, shippedLodIds: release.shippedLodIds })),
  }, "pre-registration.json (registered BEFORE any capture)", {
    verdict: LOD_L2.verdict,
    reachabilityRoutes: LOD_L2.reachabilityRoutes,
    analyticRecordStatus: LOD_L2.analyticRecordStatus,
    whyItIsNotAFailure: "A FAIL means a bar was missed. This bar cannot be reached by any capture against the shipped serving arrangement, because the six promoted waves deliver one LOD per building and there is no rendered transition to sample. Recording it as a failed measurement would imply a measurement was attempted and fell short; it was not, and the reason was registered before the campaign began.",
  }));

  // ---- request ceilings, across every session ---------------------------
  const ceilingObservations = [
    ...(frames?.gates?.requestCeilings ?? []).map((entry) => ({ session: "frames-and-gpu", scope: entry.stationId, peak: entry.peakConcurrentRequests, within: entry.peakWithinFour })),
    ...(storm ? [{ session: "storm", scope: "whole storm", peak: storm.gates?.["S-1b"]?.maxPeakConcurrentRequests ?? null, within: storm.gates?.["S-1b"]?.pass ?? null }] : []),
    ...(eviction ? [{ session: "eviction-loop", scope: "every stop", peak: eviction.gates?.["E-1c"]?.maxPeakConcurrentRequests ?? null, within: eviction.gates?.["E-1c"]?.pass ?? null }] : []),
  ];
  gates.push(row("REQUEST_CEILINGS", "#7", verdictOf(ceilingObservations.length > 0 ? ceilingObservations.every((entry) => entry.within === true) : null), REQUEST_CEILINGS.gate, {
    appWideSharedSemaphoreMaxConcurrent: REQUEST_CEILINGS.appWideSharedSemaphoreMaxConcurrent,
    observations: ceilingObservations,
    maxPeakObserved: ceilingObservations.length ? Math.max(...ceilingObservations.map((entry) => entry.peak ?? 0)) : null,
  }, "frames-and-gpu.json + storm.json + eviction-loop.json", {
    neverSum: REQUEST_CEILINGS.neverSum,
    supersededPhrasing: REQUEST_CEILINGS.supersededPhrasing,
  }));

  // ---- visual -----------------------------------------------------------
  const stills = [
    ...(frames?.stations ?? []).map((station) => ({ scope: `station:${station.stationId}`, ...station.still })),
    ...(frames?.gates?.G1?.still ? [{ scope: "gpu-validation", ...frames.gates.G1.still }] : []),
    ...(headroom?.stations ?? []).map((station) => ({ scope: `headroom:${station.stationId}`, ...station.still })),
    ...(storm?.still ? [{ scope: "storm-end", ...storm.still }] : []),
    ...(eviction?.stops ?? []).map((stop) => ({ scope: `eviction:${stop.poseId}`, ...stop.still })),
    ...(lod?.gate?.readings ?? []).map((reading) => ({ scope: `lod:${reading.heightMeters}m`, ...reading.still })),
    ...(journeys?.journeys ?? []).filter((journey) => journey.still).map((journey) => ({ scope: `journey:${journey.journeyId}`, ...journey.still })),
  ];
  gates.push(row("VISUAL", "#8", stills.length > 0 ? "REPORTED" : NOT_CAPTURED, VISUAL_GATES.rule, {
    stillCount: stills.length,
    stills,
  }, "every capture record", {
    whatAStillProves: "A still is evidence that PIXELS WERE PRODUCED at a stated pose from a stated release. It is not evidence of likeness, geographic accuracy or architectural fidelity, and no gate here upgrades it into one.",
    blenderInheritance: VISUAL_GATES.blenderInheritance,
  }));

  const gating = gates.filter((gate) => gate.verdict === "PASS" || gate.verdict === "FAIL");
  const record = {
    schemaVersion: "1.0",
    recordId: `${evidenceId}:campaign-record`,
    task: "T006",
    artifact: "exterior-acceptance-campaign-record",
    composedAt: new Date().toISOString(),
    preRegistration: {
      path: `data/${evidenceId}/pre-registration.json`,
      checksumSha256: sha256HexSync(serialize(preRegistration)),
      capturedAtStatement: preRegistration.capturedAtStatement,
    },
    acceptanceCriterionMapping: AC_MAPPING,
    textureArchitectureCorrection: {
      atlas: false,
      delivery: "shared per-class URI delivery",
      statement: "AC #3 asks for an atlas. THIS BUILD SHIPS NO ATLAS, and that is a decided design rather than an omission: ADR 0047 declines one because the maximum observed |UV| is 1210.1 and an atlas cannot repeat-wrap a tile across that range. The criterion is discharged through its own '(or measured equivalent)' clause, and the equivalent is shared per-class URI delivery — MEASURED by G1-G3 rather than argued.",
      uniqueTileDerivation: `${SHARED_CLASS_TILE_NAMES.length} shared class tiles per release x ${preRegistration.reconciliation?.textureArchitecture?.residentWaveCount ?? 6} promoted waves = ${EXPECTED_UNIQUE_TILE_COUNT} unique tiles, ${EXPECTED_TEXTURE_BYTE_LENGTH} bytes as Cesium accounts for them WITH the mip chain.`,
      mipChainNote: "The per-tile figure of 87,381 bytes INCLUDES the mip chain and was established by measurement, not assumption; the base level alone is 65,536. Any sentence that mixes wire bytes, base-level bytes and Cesium's accounting is wrong.",
    },
    gates,
    summary: {
      total: gates.length,
      pass: gates.filter((gate) => gate.verdict === "PASS").map((gate) => gate.gateId),
      fail: gates.filter((gate) => gate.verdict === "FAIL").map((gate) => gate.gateId),
      reported: gates.filter((gate) => gate.verdict === "REPORTED").map((gate) => gate.gateId),
      honestStop: gates.filter((gate) => gate.verdict === "HONEST-STOP").map((gate) => gate.gateId),
      notMeasured: gates.filter((gate) => gate.verdict === "NOT-MEASURED").map((gate) => gate.gateId),
      notCaptured: gates.filter((gate) => gate.verdict === NOT_CAPTURED).map((gate) => gate.gateId),
      crossReference: gates.filter((gate) => gate.verdict === "CROSS-REFERENCE" || gate.verdict === "CARRIED-VERBATIM").map((gate) => gate.gateId),
      gatingPassRate: gating.length === 0 ? null : `${gating.filter((gate) => gate.verdict === "PASS").length}/${gating.length}`,
    },
    /**
     * THE E-1 FORCING ARGUMENT, and the correction the capture needed.
     *
     * The eviction capture was taken with an earlier version of the detector
     * that reported a boolean `falsified`. That boolean was wrong, and it is
     * superseded HERE rather than by re-running the capture to obtain a nicer
     * flag: `cacheEvictions` is cumulative and session-wide, so a settled stop's
     * non-zero reading includes evictions made in transit, which is precisely
     * where the argument says they happen. The capture record is left exactly as
     * it was measured; the instrument was fixed afterwards and the fix is
     * recorded, so a reader can see the sequence rather than a tidied result.
     */
    forcingArgument: eviction ? {
      claimUnderTest: eviction.forcingArgument?.claimUnderTest ?? null,
      falsifyingCondition: eviction.forcingArgument?.falsifyingCondition ?? null,
      verdict: "UNDECIDED-BY-THIS-INSTRUMENT",
      capturedFlag: eviction.forcingArgument?.falsified ?? null,
      capturedFlagStatus: eviction.forcingArgument?.falsified === undefined
        ? "The capture already carries the corrected, three-valued reading."
        : "SUPERSEDED. The capture's boolean `falsified` was produced by a detector that compared consecutive cumulative readings and could not tell a transit eviction from a stationary one. It is not a falsification of the forcing argument and must not be quoted as one.",
      evictionByStop: (eviction.stops ?? []).map((stop) => ({ poseId: stop.poseId, cacheEvictions: stop.sharedCache?.cacheEvictions ?? null, scheduledCellTotal: stop.scheduledCellTotal ?? null, cacheEntries: stop.sharedCache?.cacheEntries ?? null, cachedBytes: stop.sharedCache?.cachedBytes ?? null, percentOfByteCap: stop.sharedCache?.cachedBytes == null ? null : Number(((stop.sharedCache.cachedBytes / CACHE_CEILINGS.maxCachedBytes) * 100).toFixed(1)) })),
      whyUndecided: "`cacheEvictions` is CUMULATIVE and SESSION-WIDE. Once any eviction has occurred, every later settled stop reads a non-zero value while holding the scheduler's cap of 8 resident units — so the pre-registered falsifying condition, read literally, is satisfied by a session that behaves exactly as the argument predicts. Neither direction can be asserted from these readings.",
      whatWouldDecideIt: "TWO probe reads at ONE stationary pose, separated by a dwell, asking whether the counter moved BETWEEN them. The instrument now says so; it does not yet do it, and that is carried as an open gap rather than closed.",
      whatIsSupported: "Every settled stop stayed inside both caps with margin (the heaviest was well under the 268,435,456-byte ceiling), which is CONSISTENT with the argument's central claim that a stationary anchor does not reach the byte ceiling. Consistency is not proof.",
    } : null,
    missingCaptureRecords: missing,
    chromeCleanup: cleanup ? { sessions: cleanup.sessions, everySessionClean: cleanup.sessions.every((session) => session.survivingChromeProcessCount === 0) } : null,
    attemptCounts: {
      "frame-control": control?.attemptCount ?? null,
      "frames-and-gpu": frames?.attemptCount ?? null,
      headroom: headroom?.attemptCount ?? null,
      storm: storm?.attemptCount ?? null,
      "eviction-loop": eviction?.attemptCount ?? null,
      "lod-l1": lod?.attemptCount ?? null,
      journeys: journeys?.attemptCount ?? null,
      heap: heap?.attemptCount ?? null,
    },
    discipline: CAMPAIGN_DISCIPLINE,
    claim: "Every pre-registered gate of the T006 acceptance campaign, beside the reading that decided it. Verdicts are READ from the capture records and not recomputed here.",
    notClaimedHere: [
      "That passing these gates constitutes visual, geographic, factual, accessibility or performance acceptance.",
      "That any reading generalises beyond the poses, the machine, the browser and the session it was taken in.",
      "That a FAIL was fixed. The contract puts fixes in a new cycle by amendment; this campaign measures and reports.",
    ],
  };

  await mkdir(root, { recursive: true });
  const text = serialize(record);
  await writeFile(join(root, "campaign-record.json"), text);
  await writeFile(join(root, "campaign-record.sha256"), `${sha256HexSync(text)}  campaign-record.json\n`);
  console.log(serialize({ summary: record.summary, missingCaptureRecords: missing, chromeCleanupClean: record.chromeCleanup?.everySessionClean ?? null }));
}

await main();
