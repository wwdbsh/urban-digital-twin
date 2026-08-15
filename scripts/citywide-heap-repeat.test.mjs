import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { block835CanaryHeapVerdict, BLOCK835_CANARY_HEAP_NOISE_BAND } from "../src/runtime/block835-canary-probe.ts";

/**
 * The drift instrument for `data/citywide-heap-repeat-20260815/heap-repeat-evidence.json`.
 *
 * The record's whole authority rests on one claim: that its verdict is what
 * `block835CanaryHeapVerdict` returns for the series it published, and not a
 * number typed beside a series. So this test recomputes the verdict from the
 * committed series with the SAME function the CLI imported, and demands
 * byte-equality — a record whose verdict no longer follows from its own numbers
 * fails here rather than being read as evidence.
 *
 * Everything else it holds is arithmetic the record states about itself: the
 * per-lap deltas and ratios, the two conjuncts of the pre-registered pass rule,
 * the detection-floor derivation, and the checksum sidecar. Nothing here judges
 * whether the measurement was WELL MADE; that is what the record's own
 * pre-flight, disclosures and stated limitations are for, and no test can
 * substitute for reading them.
 */
const RECORD_PATH = "data/citywide-heap-repeat-20260815/heap-repeat-evidence.json";
const SIDECAR_PATH = "data/citywide-heap-repeat-20260815/heap-repeat-evidence.sha256";
const text = readFileSync(RECORD_PATH, "utf8");
const record = JSON.parse(text);

const verdictSeries = record.heapPerRepeat.map((entry) => entry.jsHeapBytes);

describe("the heap verdict is what the frozen formula returns for the committed series", () => {
  it("recomputes heapVerdict byte-for-byte from heapPerRepeat", () => {
    const recomputed = block835CanaryHeapVerdict(verdictSeries, BLOCK835_CANARY_HEAP_NOISE_BAND, true);
    expect(JSON.stringify(recomputed)).toBe(JSON.stringify(record.heapVerdict));
  });

  it("recomputes the disclosed un-warmed 9-lap verdict from its own series", () => {
    const disclosed = record.disclosedSeries.unwarmedNineLap;
    const recomputed = block835CanaryHeapVerdict(disclosed.jsHeapBytes, BLOCK835_CANARY_HEAP_NOISE_BAND, true);
    expect(JSON.stringify(recomputed)).toBe(JSON.stringify(disclosed.heapVerdict));
    // The un-warmed series is the warmed one with the warmup lap in front of it.
    expect(disclosed.jsHeapBytes.slice(1)).toEqual(verdictSeries);
    expect(disclosed.jsHeapBytes).toHaveLength(verdictSeries.length + 1);
  });

  it("recomputes the disclosed overview series, which is never the verdict", () => {
    const secondary = record.disclosedSeries.overviewSecondary;
    const recomputed = block835CanaryHeapVerdict(secondary.jsHeapBytes, BLOCK835_CANARY_HEAP_NOISE_BAND, true);
    expect(JSON.stringify(recomputed)).toBe(JSON.stringify(secondary.heapVerdict));
    expect(secondary.poseId).not.toBe(record.heapPerRepeat[0].poseId);
    // Nothing in the record may promote it: the top-level verdict is the
    // street series' and no other.
    expect(secondary.jsHeapBytes).not.toEqual(verdictSeries);
  });

  it("holds the two conjuncts of the pre-registered pass rule against `passed`", () => {
    const withinBand = record.heapVerdict.growthRatio <= record.heapVerdict.noiseBandRatio;
    const notMonotonic = record.heapVerdict.monotonicGrowthDetected === false;
    const enoughRepeats = record.heapVerdict.sampleCount >= record.preRegistered.minimumSampledRepeats;
    expect(record.passed).toBe(withinBand && notMonotonic && enoughRepeats);
    expect(record.monotonicGrowthDetected).toBe(record.heapVerdict.monotonicGrowthDetected);
    expect(record.heapVerdict.noiseBandRatio).toBe(BLOCK835_CANARY_HEAP_NOISE_BAND);
    expect(record.heapVerdict.forcedCollection).toBe(true);
    expect(record.preRegistered.minimumSampledRepeats).toBe(6);
  });
});

describe("the record's arithmetic about itself recomputes", () => {
  it("recomputes every per-lap delta and ratio", () => {
    const first = verdictSeries[0];
    record.heapPerRepeat.forEach((entry, index) => {
      expect(entry.repeatIndex, "repeats are indexed in order").toBe(index);
      expect(entry.deltaFromPreviousBytes, `repeat ${index}`).toBe(index === 0 ? null : verdictSeries[index] - verdictSeries[index - 1]);
      expect(entry.deltaFromFirstBytes, `repeat ${index}`).toBe(verdictSeries[index] - first);
      expect(entry.ratioToFirst, `repeat ${index}`).toBe(Number((verdictSeries[index] / first).toFixed(6)));
    });
  });

  it("recomputes the series shape", () => {
    const shape = record.verdictSeriesShape;
    expect(shape.sampleCount).toBe(verdictSeries.length);
    expect(shape.firstBytes).toBe(verdictSeries[0]);
    expect(shape.lastBytes).toBe(verdictSeries.at(-1));
    expect(shape.minBytes).toBe(Math.min(...verdictSeries));
    expect(shape.maxBytes).toBe(Math.max(...verdictSeries));
    expect(shape.maxOverFirstRatio).toBe(Number((Math.max(...verdictSeries) / verdictSeries[0]).toFixed(6)));
    expect(shape.lastOverFirstRatio).toBe(Number((verdictSeries.at(-1) / verdictSeries[0]).toFixed(6)));
  });

  it("recomputes the REAL monotonicity columns, which the boolean above does not compute", () => {
    const monotonicity = record.monotonicity;
    let best = 1; let run = 1;
    let positive = 0;
    for (let index = 1; index < verdictSeries.length; index += 1) {
      run = verdictSeries[index] > verdictSeries[index - 1] ? run + 1 : 1;
      if (run > best) best = run;
      if (verdictSeries[index] > verdictSeries[index - 1]) positive += 1;
    }
    expect(monotonicity.strictlyIncreasingRunLength).toBe(best);
    expect(monotonicity.positiveDeltaCount).toBe(positive);
    expect(monotonicity.deltaCount).toBe(verdictSeries.length - 1);

    const count = verdictSeries.length;
    const meanX = (count - 1) / 2;
    const meanY = verdictSeries.reduce((total, value) => total + value, 0) / count;
    let sxy = 0; let sxx = 0; let syy = 0;
    for (let index = 0; index < count; index += 1) {
      const dx = index - meanX; const dy = verdictSeries[index] - meanY;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    expect(monotonicity.slopeBytesPerLap).toBe(Number((sxy / sxx).toFixed(3)));
    expect(monotonicity.rSquared).toBe(Number(((sxy * sxy) / (sxx * syy)).toFixed(6)));
  });

  it("recomputes the detection floor from the verdict's own first-half median", () => {
    expect(record.monotonicity.detectableRetentionFloorBytesPerLap)
      .toBe(Number((0.10 * record.heapVerdict.firstHalfMedianBytes / 4).toFixed(3)));
  });

  it("keeps the restatement of the known limitation in the record, not only in prose elsewhere", () => {
    // The one sentence the whole record's honesty turns on. If it is ever
    // removed, the two conjuncts read as two independent tests.
    const sentence = record.monotonicity.restatementSentence;
    expect(sentence).toContain("block835-canary-probe.ts:322");
    expect(sentence).toContain("growthRatio > noiseBandRatio");
    expect(sentence).toContain("RESTATEMENT");
    expect(sentence.length).toBeGreaterThan(200);
  });
});

describe("the record states the conditions its readings were taken under", () => {
  it("keeps every pre-flight limb recorded and passing", () => {
    expect(record.preflight.windowGcIsFunction).toBe(true);
    expect(Number.isFinite(record.preflight.usedJSHeapSizeFiniteBytes)).toBe(true);
    expect(record.preflight.quantizationTell.differ).toBe(true);
    expect(record.preflight.quantizationTell.beforeBytes).not.toBe(record.preflight.quantizationTell.afterBytes);
    expect(record.preflight.documentHasFocus).toBe(true);
    expect(record.preflight.visibilityState).toBe("visible");
    expect(record.preflight.servedBundleMatchesLocalDist).toBe(true);
    expect(record.preflight.externalHostsAtBoot).toEqual([]);
  });

  it("asserts no external host was contacted for the whole session", () => {
    expect(record.externalHosts).toEqual([]);
    expect(record.networkResponseCount).toBeGreaterThan(0);
  });

  it("pins the served bundle to the local build it claims to have measured", () => {
    expect(record.servedBundle.matchesLocalDist).toBe(true);
    expect(record.servedBundle.indexHtmlChecksumSha256).toBe(record.servedBundle.localDistIndexHtmlChecksumSha256);
    expect(record.servedBundle.entryScriptChecksumSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("discloses the probe build and the single-run attempt count", () => {
    expect(record.harnessDisclosure).toContain("VITE_EXTERIOR_SCHEDULER_PROBE=1");
    expect(record.harnessDisclosure).toContain("VITE_CITYWIDE_OVERVIEW_PROBE=1");
    expect(Number.isInteger(record.attemptCount)).toBe(true);
    expect(record.attemptCount).toBeGreaterThanOrEqual(1);
    expect(record.chrome.launchCommand).toContain("--js-flags=--expose-gc");
    expect(record.chrome.launchCommand).toContain("--user-data-dir=/tmp/t008-heap-chrome");
    expect(record.chrome.userAgent.length).toBeGreaterThan(20);
  });

  it("keeps the bounded claim's half-unreachable correction, rather than only its reachable half", () => {
    expect(record.boundedClaim.stopReportCorrection).toContain("unreachable");
    expect(record.boundedClaim.whatWasNotPressed).toContain("83,886,080");
    expect(record.boundedClaim.whatWasNotPressed).toContain("citywide-release.ts:79-80");
    expect(record.boundedClaim.whatWasPressed).toContain("128");
  });

  it("carries every lap of the churn proof, warmup included and labelled", () => {
    // 1 warmup + 8 sampled, the pre-registered convention, written as literals
    // so changing the convention has to be a deliberate edit to this line.
    expect(record.perRepeat).toHaveLength(9);
    expect(record.perRepeat.filter((entry) => !entry.sampled)).toHaveLength(1);
    expect(record.perRepeat.filter((entry) => entry.sampled)).toHaveLength(8);
    expect(verdictSeries).toHaveLength(8);
    for (const lap of record.perRepeat) {
      expect(lap.poses, `lap ${lap.repeatIndex}`).toHaveLength(record.poses.length);
      for (const pose of lap.poses) {
        expect(pose.decision?.footprintSignature, `${lap.repeatIndex}/${pose.poseId}`).toMatch(/^-?\d/u);
        expect(pose.probeBuffers.traceLength).toBeLessThanOrEqual(pose.probeBuffers.traceLimit);
        expect(pose.probeBuffers.denseSampleCount).toBeLessThanOrEqual(pose.probeBuffers.denseSampleLimit);
      }
    }
  });
});

describe("the committed bytes are the bytes that were hashed", () => {
  it("matches the checksum sidecar", () => {
    const digest = createHash("sha256").update(readFileSync(RECORD_PATH)).digest("hex");
    expect(readFileSync(SIDECAR_PATH, "utf8")).toBe(`${digest}  heap-repeat-evidence.json\n`);
  });
});
