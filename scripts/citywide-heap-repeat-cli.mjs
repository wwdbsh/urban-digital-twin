/* global console, process, WebSocket, fetch, URL, setTimeout */
/**
 * T008 repeated-camera-path heap instrument (Issue #80, goal criterion 7).
 *
 * The shape T007's stop report asked for, and nothing more: ONE deterministic
 * island-scale camera path, repeated, with an explicit forced collection before
 * every heap sample, judged by the SAME arithmetic the prior goal's T029 record
 * was judged by — `block835CanaryHeapVerdict`, imported from
 * `src/runtime/block835-canary-probe.ts` rather than re-implemented here, so
 * this record cannot drift from the formula it claims to use.
 *
 * What this instrument corrects relative to the T006 campaign harness it is
 * modelled on:
 *
 *   ONE DOCUMENT.  The T006 stations each opened their own tab and navigated.
 *                  A heap series across nine fresh documents measures nine cold
 *                  boots, not retention. Here the document is opened ONCE at the
 *                  overview pose and every subsequent pose is a
 *                  `history.pushState` plus a synthetic `popstate`, which
 *                  App.tsx:3209 routes through `applyUrl` -> `setCameraPose` ->
 *                  `setCameraRequest`, applied by CesiumViewport.tsx:2529 as a
 *                  `setView` teleport. `Page.navigate` is never called after
 *                  boot.
 *
 *   REAL FORCED GC. `HeapProfiler.collectGarbage` is a DevTools request whose
 *                  failure the T006 harness swallowed with `.catch(() => null)`,
 *                  so a reading taken after a silently failed collection was
 *                  indistinguishable from one taken after a real one. Here the
 *                  collection is `window.gc()` evaluated IN THE PAGE under
 *                  `--js-flags=--expose-gc`, and a throw aborts the run.
 *
 *   FAIL-CLOSED PRE-FLIGHT. Six conditions are checked before lap 0 and any one
 *                  of them failing writes NO record and exits non-zero. A heap
 *                  instrument that reports a caveat instead of refusing is how a
 *                  quantized, unfocused, wrong-bundle reading becomes evidence.
 *
 * The verdict is PRE-REGISTERED (see PRE_REGISTERED below) and is computed once,
 * at the end, over the sampled laps. This CLI decides nothing else: it writes
 * the series, the verdict the frozen formula returns, and the real monotonicity
 * columns that formula does NOT compute.
 *
 * NODE VERSION. This CLI needs a Node that (a) strips types from the `.ts`
 * modules it imports and (b) provides `module.registerHooks`, which is how the
 * verdict formula is imported rather than copied. That is **Node >= 22.15**;
 * the capture this file produced ran on **v24.12.0**. The repository's
 * `engines.node` floor of 22.12 is NOT sufficient for this script alone, which
 * is why the package script passes `--experimental-strip-types` explicitly and
 * why the version is stated here rather than assumed.
 *
 * Usage:
 *   pnpm heap:repeat -- --dev http://localhost:4213 --port 9223 --attempt 1
 *   node --experimental-strip-types scripts/citywide-heap-repeat-cli.mjs \
 *     --dev http://localhost:4213 --port 9223 --attempt 1
 *
 * T006 ADDITIONS, and why each one is here rather than in a fork of this file:
 *
 *   --out <evidence-id>  The historical output root
 *                  `data/citywide-heap-repeat-20260815/` is FROZEN evidence of
 *                  the T008 run, and re-running this instrument would silently
 *                  overwrite it. The flag moves the write target; the DEFAULT is
 *                  unchanged, so nothing that ran before this flag existed
 *                  behaves differently.
 *
 *   M2 VALIDITY.   Every heap sample is now taken with `activeRequests === 0`,
 *                  READ rather than implied. T008 relied on a 45 s settle to
 *                  imply quiescence; at six promoted waves that implication is
 *                  no longer self-evident. A violation is an INSTRUMENT-FAILURE
 *                  ABORT — no record is written — because a sample taken while
 *                  artifacts are in flight measures a transient, not what
 *                  survives a cycle, and calling that a heap FAILURE would be
 *                  reporting the wrong quantity.
 *
 *   LAP CAP.       The wall-clock cap on the sampling phase comes from the T006
 *                  pre-registration (`HEAP_GATES.lapPhaseCapMs`, 75 minutes,
 *                  raised from 50 with its reason recorded BEFORE any lap ran).
 *                  It is imported rather than retyped so the number cannot drift
 *                  from the pre-registration that justifies it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { HEAP_GATES } from "./exterior-acceptance-campaign-constants.mjs";

/**
 * Node's type stripping does not rewrite import specifiers, so the JSON
 * fixtures `block835-canary-probe.ts` imports need their attribute supplied
 * here. This is the whole reason the verdict formula can be IMPORTED rather
 * than copied: the alternative was a second implementation of the arithmetic
 * this record's verdict rests on, which is exactly the drift the colocated test
 * exists to refuse.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.endsWith(".json")) return { ...result, importAttributes: { ...(result.importAttributes ?? {}), type: "json" } };
    return result;
  },
});
const { block835CanaryHeapVerdict, BLOCK835_CANARY_HEAP_NOISE_BAND } = await import("../src/runtime/block835-canary-probe.ts");

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The T008 output root. FROZEN evidence; `--out` moves the write target. */
const DEFAULT_EVIDENCE_ID = "citywide-heap-repeat-20260815";
let evidenceId = DEFAULT_EVIDENCE_ID;
let evidenceRoot = join(repositoryRoot, "data", DEFAULT_EVIDENCE_ID);

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 300_000;
const EVALUATE_TIMEOUT_MS = 120_000;
/** Same settle the T006 stations used, per pose. */
const SETTLE_MS = 45_000;
/** Dwell between the forced collection and the reading. */
const GC_SETTLE_MS = 500;
/**
 * Pose landing.
 *
 * A `setView` teleport does NOT reliably refresh the app's viewport footprint,
 * and the settle below would otherwise be spent at a camera the scheduler does
 * not know about. See POSE_LANDING_DISCLOSURE for the mechanism and the
 * evidence. The instrument re-dispatches the SAME pose - the same pushState,
 * the same synthetic popstate, the same coordinates - until the scheduler's own
 * footprint signature changes, then starts the settle.
 */
const LANDING_DWELL_MS = 5_000;
const LANDING_MAX_DISPATCHES = 10;

const POSE_LANDING_DISCLOSURE = "A pose is dispatched, then RE-DISPATCHED at 5 s intervals until the scheduler's own footprintSignature changes, and only then does the 45 s settle begin. This is not padding and it is not a second mechanism: every dispatch is the identical pushState plus synthetic PopStateEvent with the identical coordinates, so a re-dispatch moves the camera nowhere. It is needed because of a real app behaviour this task measured and is recording rather than working around silently: CesiumViewport's emitSettledCamera derives the footprint from cameraFootprintForViewer and falls back to lastValidFootprintRef when that footprint is not valid (CesiumViewport.tsx:1923-1928), and it is called synchronously right after the setView teleport (CesiumViewport.tsx:2534) - before a frame has rendered at the new camera, when the footprint cannot yet be computed. Nothing re-emits afterwards, because a setView fires no camera.moveEnd. The observed consequence, measured before this instrument was frozen: a teleport from a 260 m street pose to the 52 km overview left the scheduler holding the STREET footprint indefinitely - residentCount 13, visibleCount 13, deferredCount 0, unchanged over a 45 s poll - and a teleport between two 260 m street poses 5 km apart produced no new scheduler decision at all. One re-dispatch, after a frame has rendered, lands both: the overview then records residentCount 128, visibleCount 883, deferredCount 755. Every pose in this record carries the dispatchCount it took, so a reader can see exactly where this applied. It is a genuine defect in the app's Back/Forward camera path, not an artefact of CDP: a user pressing Back would meet it too.";
/**
 * Hard wall-clock cap on the SAMPLING PHASE (lap 0 onwards). Boot is reported
 * separately and is not charged against it: a slow cold load is not a runaway
 * instrument, and charging it here would make the cap fire on the wrong thing.
 *
 * RAISED from 50 to 75 minutes, and imported from the T006 pre-registration
 * rather than retyped, so the number and the reason that justifies it cannot
 * drift apart. The reason, recorded before any lap ran: the arithmetic floor at
 * six promoted waves is ~37.5 minutes BEFORE any re-dispatch, and a cap that
 * fires on a healthy slow run is an instrument failure masquerading as a result.
 */
const LAP_PHASE_CAP_MS = HEAP_GATES.lapPhaseCapMs;

const WARMUP_LAPS = 1;
const SAMPLED_LAPS = 8;
const TOTAL_LAPS = WARMUP_LAPS + SAMPLED_LAPS;

const ISLAND = { lon: -73.9712, lat: 40.7831 };
const ANCHOR = { lon: -73.986360, lat: 40.748775 };
/**
 * Lower Manhattan, ~5 km from the midtown anchor. At 260 m the scheduler's
 * footprint is a few hundred metres across, so the exterior resident set here
 * shares nothing with pose 4's — which is what makes the lap a CYCLE over two
 * disjoint working sets rather than a dwell on one.
 */
const LOWER = { lon: -74.009000, lat: 40.706900 };

/**
 * The lap. Five poses, in this order, every lap.
 *
 * The 2,400 m and 1,200 m poses sit ON the scheduler's band edges
 * (`EXTERIOR_CELL_SCHEDULER_POLICY.distanceBandEdgesMeters` = [1200, 2400]),
 * deliberately: a band edge is where admission and deferral flip, so a pose
 * parked on one exercises the seam that a mid-band pose never touches.
 */
const POSES = [
  { poseId: "overview-52km-island", ...ISLAND, height: 52_000, heading: 0, pitch: -90, roll: 0, role: "disclosed secondary heap sample point; NEVER the verdict" },
  { poseId: "band-2400m-anchor", ...ANCHOR, height: 2_400, heading: 45, pitch: -50, roll: 0, role: "outer band edge" },
  { poseId: "transition-1200m-anchor", ...ANCHOR, height: 1_200, heading: 45, pitch: -45, roll: 0, role: "inner band edge" },
  { poseId: "street-260m-midtown", ...ANCHOR, height: 260, heading: 45, pitch: -25, roll: 0, role: "PRE-DECLARED VERDICT SAMPLE POINT (the trough)" },
  { poseId: "street-260m-lower", ...LOWER, height: 260, heading: 45, pitch: -25, roll: 0, role: "second street working set, disjoint from pose 4" },
];
/** Index into POSES. Frozen before the run; not chosen after seeing a series. */
const VERDICT_POSE_INDEX = 3;
const SECONDARY_POSE_INDEX = 0;

/** The launch line this instrument requires, reproduced verbatim in the record. */
const CHROME_LAUNCH_COMMAND = 'open -na "Google Chrome" --args --remote-debugging-port=9223 --user-data-dir=/tmp/t008-heap-chrome --no-first-run --js-flags=--expose-gc --enable-precise-memory-info --disable-background-timer-throttling';

const RESTATEMENT_SENTENCE = "KNOWN LIMITATION, stated plainly: `monotonicGrowthDetected` in `block835CanaryHeapVerdict` is literally `growthRatio > noiseBandRatio` (src/runtime/block835-canary-probe.ts:322). It is a RESTATEMENT of the first-half-versus-second-half median ratio test above it, not an independent monotonicity test - it never inspects the ordering, the run lengths or the slope of the series. The two conjuncts of this record's pass rule are therefore ONE measurement reported twice, and a reader must judge monotonicity from the `monotonicity` block below (strictlyIncreasingRunLength, positiveDeltaCount, ordinary-least-squares slopeBytesPerLap and rSquared), which is computed here and is reported whether or not it agrees with the boolean.";

const PRE_REGISTERED = {
  criterionIndex: 7,
  criterionHalf: "the retained-heap half only; the GPU half was already discharged by arithmetic in ADR 0043 and is not re-argued here",
  passRule: "PASS if and only if BOTH: (a) the first-half-versus-second-half median growthRatio of the sampled verdict series is <= 0.10, AND (b) heapVerdict.monotonicGrowthDetected is false, over at least 6 sampled repeats, with each heap reading taken from performance.memory AFTER an explicit in-page window.gc().",
  noiseBandRatio: BLOCK835_CANARY_HEAP_NOISE_BAND,
  minimumSampledRepeats: 6,
  verdictSeries: "the jsHeapBytes series at pose street-260m-midtown, one sample per SAMPLED lap, warmup lap excluded",
  repeatConvention: `${WARMUP_LAPS} UNSAMPLED warmup lap followed by ${SAMPLED_LAPS} sampled laps, split 4 versus 4 by block835CanaryHeapVerdict (sampleCount 8 -> half = 4, first half = repeats 1-4, second half = repeats 5-8, no sample dropped)`,
  unwarmedConvention: `the same series with the warmup lap INCLUDED, 9 samples. block835CanaryHeapVerdict on 9 values takes half = floor(9/2) = 4, so the first half is repeats 0-3, the second half is repeats 5-8, and the MIDDLE sample (repeat 4) is dropped by the formula. This 9-lap verdict is published as DISCLOSURE, not as the verdict.`,
  bothConventionsPublished: "The warmed 8-lap verdict is THE verdict. The un-warmed 9-lap verdict is published beside it so a reader can see what including the cold lap would have done, rather than having to trust that the warmup exclusion was decided before the numbers were seen.",
  secondarySeries: "the jsHeapBytes series at pose overview-52km-island is captured and published as a disclosed second series. It is NEVER the verdict: the overview is the peak-residency pose and its heap is dominated by the resident scene rather than by what survives a cycle.",
  attemptPolicy: "SINGLE run. The record carries attemptCount. A run is repeated only for an INSTRUMENT failure (a pre-flight or mid-run abort, which writes no record), never because the series looked wrong.",
  frozenBefore: "The pose table, the verdict sample point, the repeat convention and the pass rule above were fixed before any lap was run and are not re-chosen from the observed series.",
};

function fail(message) { throw new Error(`citywide-heap-repeat: ${message}`); }

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    wait(ms).then(() => fail(`timed out after ${ms} ms waiting for ${what}`)),
  ]);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? null;
}

/** Longest run of consecutive strictly increasing samples. */
function strictlyIncreasingRunLength(values) {
  let best = values.length ? 1 : 0;
  let run = values.length ? 1 : 0;
  for (let index = 1; index < values.length; index += 1) {
    run = values[index] > values[index - 1] ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** Ordinary least squares of bytes against lap index. */
function ordinaryLeastSquares(values) {
  const count = values.length;
  if (count < 2) return { slopeBytesPerLap: null, rSquared: null };
  const meanX = (count - 1) / 2;
  const meanY = values.reduce((total, value) => total + value, 0) / count;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let index = 0; index < count; index += 1) {
    const dx = index - meanX;
    const dy = values[index] - meanY;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return {
    slopeBytesPerLap: sxx === 0 ? null : Number((sxy / sxx).toFixed(3)),
    rSquared: sxx === 0 || syy === 0 ? null : Number(((sxy * sxy) / (sxx * syy)).toFixed(6)),
  };
}

function seriesShape(values) {
  const first = values[0];
  return {
    sampleCount: values.length,
    firstBytes: first,
    lastBytes: values[values.length - 1],
    minBytes: Math.min(...values),
    maxBytes: Math.max(...values),
    maxOverFirstRatio: Number((Math.max(...values) / first).toFixed(6)),
    lastOverFirstRatio: Number((values[values.length - 1] / first).toFixed(6)),
  };
}

// ---------------------------------------------------------------------------
// CDP
// ---------------------------------------------------------------------------

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      if (message.id === undefined) { this.events.push(message); return; }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`));
      else entry.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * A page exception is a FAILURE here, never a null. Every reading this
   * instrument takes is load-bearing, so there is no expression in this file
   * whose throw is swallowed.
   */
  async evaluate(expression, what = "page evaluation") {
    const result = await withTimeout(this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), EVALUATE_TIMEOUT_MS, what);
    if (result.exceptionDetails) fail(`${what} threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  }

  responses() {
    return this.events.filter((event) => event.method === "Network.responseReceived").map((event) => event.params.response);
  }

  close() { try { this.socket.close(); } catch { /* the socket is already gone */ } }
}

async function attach(port, initialUrl) {
  const listResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(initialUrl)}`, { method: "PUT" }).catch(() => null);
  if (!listResponse?.ok) fail(`could not open a tab on the debugging port ${port}; launch the DEDICATED Chrome with: ${CHROME_LAUNCH_COMMAND}`);
  const target = await listResponse.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", () => rejectPromise(new Error("CDP socket failed to open")), { once: true });
  });
  const session = new CdpSession(socket);
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Network.enable");
  await session.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });
  await session.send("Page.bringToFront").catch(() => null);
  return { session, targetId: target.id };
}

const READ_SCHEDULER_PROBE = `(() => {
  const node = document.querySelector("[data-exterior-scheduler-probe]");
  if (!node) return null;
  const probe = JSON.parse(node.textContent);
  return {
    exteriorStreamingActive: probe.exteriorStreamingActive,
    detailRadiusMeters: probe.detailRadiusMeters,
    decision: probe.decision,
    traceLength: probe.traceLength,
    waves: probe.waves,
  };
})()`;

const READ_CITYWIDE_PROBE = `(() => {
  const node = document.querySelector("[data-citywide-overview-probe]");
  if (!node) return null;
  const probe = JSON.parse(node.textContent);
  return {
    adapterMetrics: probe.adapterMetrics,
    denseMetrics: probe.denseMetrics,
    cache: { entries: probe.cache.entries, bytes: probe.cache.bytes, classEvictions: probe.cache.classEvictions },
    overviewResidencyActive: probe.overviewResidencyActive,
    denseSampleCount: (probe.denseSamples || []).length,
    moveCount: (probe.moves || []).length,
  };
})()`;

const READ_FOOTPRINT = `(() => {
  const node = document.querySelector("[data-exterior-scheduler-probe]");
  if (!node) return null;
  return JSON.parse(node.textContent).decision?.footprintSignature ?? null;
})()`;

const READ_FOCUS = '({ hasFocus: document.hasFocus(), visibilityState: document.visibilityState })';

/**
 * M2's reading: how many exterior artifact requests are IN FLIGHT right now.
 *
 * `activeRequests` is a SESSION-WIDE field written onto every live wave's
 * metrics, so it is taken from one wave and never summed. Returning `null` when
 * no wave has published metrics is deliberate: an absent reading is not a zero,
 * and M2 treats it as a violation rather than as quiescence.
 */
const READ_ACTIVE_REQUESTS = `(() => {
  const node = document.querySelector("[data-exterior-scheduler-probe]");
  if (!node) return null;
  const waves = JSON.parse(node.textContent).waves || [];
  const wave = waves.find((entry) => entry.metrics);
  if (!wave) return null;
  return { activeRequests: wave.metrics.activeRequests, peakConcurrentRequests: wave.metrics.peakConcurrentRequests, readFrom: wave.releaseId };
})()`;

const FORCE_GC = `(() => {
  if (typeof window.gc !== "function") throw new Error("window.gc is not a function; Chrome was not launched with --js-flags=--expose-gc");
  window.gc();
  return true;
})()`;

const READ_HEAP = `(() => {
  const memory = performance.memory;
  if (!memory) throw new Error("performance.memory is unavailable");
  const bytes = memory.usedJSHeapSize;
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("performance.memory.usedJSHeapSize is not a finite positive number: " + String(bytes));
  return bytes;
})()`;

/**
 * The quantization tell.
 *
 * Chrome quantizes `performance.memory` to 100 kB buckets unless
 * `--enable-precise-memory-info` is passed, and a quantized series can look
 * flat for reasons that have nothing to do with retention. Two reads separated
 * by a deliberate allocation MUST differ, or this instrument cannot see what it
 * claims to measure.
 */
const QUANTIZATION_TELL = `(() => {
  const before = performance.memory.usedJSHeapSize;
  const ballast = new Array(500000);
  for (let index = 0; index < ballast.length; index += 1) ballast[index] = { index, pad: "t008" };
  window.__t008Ballast = ballast;
  const after = performance.memory.usedJSHeapSize;
  return { beforeBytes: before, afterBytes: after, differ: after !== before, ballastEntryCount: ballast.length };
})()`;

const RELEASE_BALLAST = '(() => { window.__t008Ballast = null; return true; })()';

function poseUrl(dev, pose) {
  const url = new URL(dev);
  url.searchParams.set("data", "real-pilot");
  url.searchParams.set("release", "manhattan-citywide-20260804");
  url.searchParams.set("view", "free");
  for (const [key, value] of [["lon", pose.lon], ["lat", pose.lat], ["height", pose.height], ["heading", pose.heading], ["pitch", pose.pitch], ["roll", pose.roll]]) {
    url.searchParams.set(key, Number(value).toFixed(6));
  }
  return url.toString();
}

/**
 * Pose change WITHOUT a navigation.
 *
 * App.tsx:3209 listens for `popstate` and App.tsx:3051 routes `state.pose`
 * through `setCameraPose`/`setCameraRequest`; CesiumViewport.tsx:2529 applies
 * that request as a `setView` teleport. So the document, the adapter, the
 * caches and the heap all survive the pose change, which is the only way a
 * repeated-path heap series means anything.
 */
function applyPoseExpression(url) {
  return `(() => {
    window.history.pushState({}, "", ${JSON.stringify(url)});
    window.dispatchEvent(new PopStateEvent("popstate"));
    return window.location.href;
  })()`;
}

async function waitFor(session, read, predicate, what) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const probe = await session.evaluate(read, what);
    if (probe && predicate(probe)) return probe;
    if (Date.now() > deadline) fail(`timed out waiting for ${what}`);
    await wait(500);
  }
}

function externalHosts(session, dev) {
  const origin = new URL(dev).host;
  return [...new Set(session.responses().map((response) => {
    try { return new URL(response.url).host; } catch { return ""; }
  }).filter((host) => host && host !== origin))].sort();
}

// ---------------------------------------------------------------------------
// served-bundle identity
// ---------------------------------------------------------------------------

async function servedBundleGate(dev) {
  const index = await (await fetch(dev)).text();
  const localIndex = await readFile(join(repositoryRoot, "dist", "index.html"), "utf8");
  const scripts = [...index.matchAll(/src="([^"]+\.js)"/gu)].map((match) => match[1]);
  const assets = [];
  for (const relative of scripts) {
    const bytes = new Uint8Array(await (await fetch(new URL(relative, dev))).arrayBuffer());
    assets.push({ ref: relative, byteSize: bytes.byteLength, sha256: sha256HexBytes(bytes) });
  }
  const entry = assets[0] ?? null;
  const record = {
    previewBase: dev,
    indexHtmlChecksumSha256: sha256HexSync(index),
    localDistIndexHtmlChecksumSha256: sha256HexSync(localIndex),
    matchesLocalDist: sha256HexSync(index) === sha256HexSync(localIndex),
    entryScriptPath: entry?.ref ?? null,
    entryScriptByteSize: entry?.byteSize ?? null,
    entryScriptChecksumSha256: entry?.sha256 ?? null,
    assets,
    statement: "Checked BEFORE any capture. The served index.html is byte-identical to this worktree's dist/index.html, so every reading below is from THIS build. A mismatch aborts the run rather than being recorded as a caveat.",
  };
  if (!record.matchesLocalDist) fail("the served index.html does not match this worktree's dist/index.html");
  if (!entry) fail("the served index.html names no entry script");
  return record;
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

function poseObservation(pose, scheduler, citywide) {
  const waves = scheduler?.waves ?? [];
  const sessionWave = waves[0]?.metrics ?? null;
  return {
    poseId: pose.poseId,
    // Proof the teleport landed: the scheduler's own footprint signature and
    // height bucket are recomputed from the camera it actually holds.
    decision: scheduler?.decision
      ? {
        residentCount: scheduler.decision.residentCount,
        visibleCount: scheduler.decision.visibleCount,
        deferredCount: scheduler.decision.deferredCount,
        retainedCount: scheduler.decision.retainedCount,
        hold: scheduler.decision.hold,
        decisionIndex: scheduler.decision.decisionIndex,
        heightBucket: scheduler.decision.heightBucket,
        footprintSignature: scheduler.decision.footprintSignature,
      }
      : null,
    // Session-wide totals read off ONE wave: `waves[0]`, unconditionally — the
    // first entry of the probe's wave array, which is the first ACTIVE wave the
    // app emitted, not a wave selected by any liveness test performed here. The
    // app writes the same session totals onto every live runtime, so summing
    // them would multiply one pool by the number of promotions
    // (ExteriorRuntimeMetrics, exterior-cell-runtime.ts:318-334).
    exteriorPool: sessionWave
      ? {
        cacheEntries: sessionWave.cacheEntries,
        cachedBytes: sessionWave.cachedBytes,
        cacheEvictions: sessionWave.cacheEvictions,
        maxCacheEntries: sessionWave.maxCacheEntries,
        maxCachedBytes: sessionWave.maxCachedBytes,
        releasedArtifactCount: sessionWave.releasedArtifactCount,
        releasedArtifactBytes: sessionWave.releasedArtifactBytes,
        peakConcurrentRequests: Math.max(...waves.map((wave) => wave.metrics?.peakConcurrentRequests ?? 0)),
        requestedArtifactCount: waves.reduce((total, wave) => total + (wave.metrics?.requestedArtifactCount ?? 0), 0),
        loadedArtifactCount: waves.reduce((total, wave) => total + (wave.metrics?.loadedArtifactCount ?? 0), 0),
        note: "cacheEntries/cachedBytes/cacheEvictions/releasedArtifact* are SESSION-wide fields read from waves[0] unconditionally - the first entry of the probe's active-wave array, not a wave chosen by any liveness test - and must not be summed across waves. requestedArtifactCount/loadedArtifactCount ARE per wave and are summed.",
      }
      : null,
    // The SEPARATE citywide dense shard pool. Conflating it with the exterior
    // cell cache above is the confusion T007's D-12 risk names by hand.
    denseShardCache: citywide?.cache ?? null,
    adapter: citywide?.adapterMetrics
      ? {
        cacheEntries: citywide.adapterMetrics.cacheEntries,
        cacheEvictions: citywide.adapterMetrics.cacheEvictions,
        loadedBytes: citywide.adapterMetrics.loadedBytes,
        loadedFeatureCount: citywide.adapterMetrics.loadedFeatureCount,
        requestedShardCount: citywide.adapterMetrics.requestedShardCount,
        visibleShardCount: citywide.adapterMetrics.visibleShardCount,
        cancelledRequestCount: citywide.adapterMetrics.cancelledRequestCount,
        retainedSummaryCount: citywide.adapterMetrics.retainedSummaryCount,
        retainedFeatureCount: citywide.adapterMetrics.retainedFeatureCount,
        retainedDetailCount: citywide.adapterMetrics.retainedDetailCount,
      }
      : null,
    denseMetrics: citywide?.denseMetrics
      ? {
        planBuildCount: citywide.denseMetrics.planBuildCount,
        planSwapCount: citywide.denseMetrics.planSwapCount,
        planCancellationCount: citywide.denseMetrics.planCancellationCount,
        planSuppressionUpdateCount: citywide.denseMetrics.planSuppressionUpdateCount,
        buildingFeatureCount: citywide.denseMetrics.buildingFeatureCount,
        instanceCount: citywide.denseMetrics.instanceCount,
      }
      : null,
    // Both probe buffers are HARD CAPPED (EXTERIOR_SCHEDULER_TRACE_LIMIT 800,
    // CITYWIDE_OVERVIEW_PROBE_LIMIT 400 in App.tsx). They are reported per lap
    // so a reader can see whether probe accumulation was still growing while
    // the heap was being sampled; a series that grows while these are still
    // filling is contestable as probe overhead.
    probeBuffers: {
      traceLength: scheduler?.traceLength ?? null,
      traceLimit: 800,
      denseSampleCount: citywide?.denseSampleCount ?? null,
      denseSampleLimit: 400,
      moveCount: citywide?.moveCount ?? null,
      moveLimit: 400,
    },
  };
}

async function run(argv) {
  const dev = argValue(argv, "--dev", "http://localhost:4213");
  const port = Number(argValue(argv, "--port", "9223"));
  const attemptCount = Number(argValue(argv, "--attempt", "1"));
  if (!Number.isInteger(attemptCount) || attemptCount < 1) fail("--attempt must be a positive integer; the record states how many attempts this capture took");
  evidenceId = argValue(argv, "--out", DEFAULT_EVIDENCE_ID);
  evidenceRoot = join(repositoryRoot, "data", evidenceId);

  const servedBundle = await servedBundleGate(dev);
  const browserVersion = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();

  const { session, targetId } = await attach(port, "about:blank");
  const closeTarget = async () => {
    session.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => null);
  };
  // A signal or an unhandled rejection closes the tab this process opened and
  // exits non-zero with NO record written. A half-run that leaves a record is
  // how an aborted capture becomes evidence.
  const abort = (reason) => {
    console.error(`citywide-heap-repeat: ABORTED (${reason}). No record written.`);
    void closeTarget().finally(() => process.exit(1));
  };
  process.on("SIGINT", () => abort("SIGINT"));
  process.on("SIGTERM", () => abort("SIGTERM"));
  process.on("uncaughtException", (error) => abort(`uncaughtException: ${error?.message ?? error}`));
  process.on("unhandledRejection", (error) => abort(`unhandledRejection: ${error?.message ?? error}`));

  try {
    // ---- boot: ONE document, at the overview pose, on the default URL -----
    const bootUrl = poseUrl(dev, POSES[0]);
    const bootStartedAt = Date.now();
    await session.send("Page.navigate", { url: bootUrl });
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.traceLength > 0, "scheduler probe");
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "default exterior activation");
    await waitFor(session, READ_CITYWIDE_PROBE, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0, "dense build");
    const bootMs = Date.now() - bootStartedAt;

    // ---- pre-flight: every one fail-closed, all of them before lap 0 ------
    const gcAvailable = await session.evaluate('typeof window.gc === "function"', "window.gc availability");
    if (gcAvailable !== true) fail("pre-flight: window.gc is not a function; Chrome was not launched with --js-flags=--expose-gc");
    const heapProbe = await session.evaluate(READ_HEAP, "pre-flight heap read");
    const tell = await session.evaluate(QUANTIZATION_TELL, "pre-flight quantization tell");
    if (!tell.differ) fail(`pre-flight: two performance.memory reads separated by a ${tell.ballastEntryCount}-entry allocation were byte-identical (${tell.beforeBytes}); the reading is quantized or frozen and cannot support this record`);
    await session.evaluate(RELEASE_BALLAST, "pre-flight ballast release");
    await session.evaluate(FORCE_GC, "pre-flight ballast collection");
    await wait(GC_SETTLE_MS);
    const focusRaw = await session.evaluate(READ_FOCUS, "pre-flight focus");
    let focusEmulation = { enabled: false, method: null, disclosure: "Focus was REAL: document.hasFocus() was already true with no DevTools emulation, and the reading below is from a genuinely focused, visible window." };
    if (!focusRaw.hasFocus) {
      await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      focusEmulation = {
        enabled: true,
        method: "Emulation.setFocusEmulationEnabled",
        disclosure: "Focus is EMULATED by the DevTools protocol, not taken from the window manager: document.hasFocus() was false before emulation was enabled. This is the same disclosure the prior goal's heap record carries. The consequence is stated rather than hidden - the focus limb of the pre-flight, and the mid-run focus-change guard, are weaker than they read, because emulated focus cannot change. The visibility limb is NOT emulated and is checked every lap.",
      };
    }
    const focus = await session.evaluate(READ_FOCUS, "pre-flight focus after emulation");
    if (!focus.hasFocus) fail("pre-flight: document.hasFocus() is false");
    if (focus.visibilityState !== "visible") fail(`pre-flight: document.visibilityState is ${focus.visibilityState}`);
    const preflightHosts = externalHosts(session, dev);
    if (preflightHosts.length > 0) fail(`pre-flight: external hosts were contacted: ${preflightHosts.join(", ")}`);

    const preflight = {
      windowGcIsFunction: true,
      usedJSHeapSizeFiniteBytes: heapProbe,
      quantizationTell: { ...tell, statement: "Two performance.memory reads separated by a deliberate allocation MUST differ. They did, so this instrument can resolve changes smaller than Chrome's default 100 kB quantization; the ballast was then dropped and collected before lap 0." },
      documentHasFocusRaw: focusRaw.hasFocus,
      documentHasFocus: focus.hasFocus,
      visibilityState: focus.visibilityState,
      servedBundleMatchesLocalDist: servedBundle.matchesLocalDist,
      externalHostsAtBoot: preflightHosts,
      bootMs,
      statement: "All six limbs were checked before lap 0 and every one of them is fail-closed: any failure aborts the run, writes NO record and exits non-zero.",
    };

    // ---- the laps --------------------------------------------------------
    const lapPhaseStartedAt = Date.now();
    const repeats = [];
    const verdictSeriesAll = [];
    const secondarySeriesAll = [];
    let previousFootprint = null;
    let bootPoseConsumed = false;

    for (let lapIndex = 0; lapIndex < TOTAL_LAPS; lapIndex += 1) {
      const lapPoses = [];
      for (let poseIndex = 0; poseIndex < POSES.length; poseIndex += 1) {
        if (Date.now() - lapPhaseStartedAt > LAP_PHASE_CAP_MS) fail(`hard wall-clock cap: the sampling phase exceeded ${LAP_PHASE_CAP_MS} ms at lap ${lapIndex} pose ${poseIndex}`);
        const pose = POSES[poseIndex];
        let dispatchCount = 0;
        let landingMs = 0;
        if (lapIndex === 0 && poseIndex === 0 && !bootPoseConsumed) {
          // The document already booted AT this pose, with a fresh and valid
          // footprint; re-dispatching it would move nothing and prove nothing.
          bootPoseConsumed = true;
        } else {
          const url = poseUrl(dev, pose);
          const landingStartedAt = Date.now();
          for (;;) {
            const href = await session.evaluate(applyPoseExpression(url), `pose ${pose.poseId} pushState`);
            dispatchCount += 1;
            if (!href.includes(`height=${pose.height.toFixed(6)}`)) fail(`pose ${pose.poseId}: the pushed URL did not take (${href})`);
            await wait(LANDING_DWELL_MS);
            const landed = await session.evaluate(READ_FOOTPRINT, `${pose.poseId} footprint`);
            if (landed && landed !== previousFootprint) break;
            if (dispatchCount >= LANDING_MAX_DISPATCHES) fail(`pose ${pose.poseId}: the scheduler footprint never changed from ${previousFootprint} after ${dispatchCount} dispatches; the camera did not land`);
          }
          landingMs = Date.now() - landingStartedAt;
        }
        await wait(SETTLE_MS);

        const scheduler = await session.evaluate(READ_SCHEDULER_PROBE, `${pose.poseId} scheduler probe`);
        const citywide = await session.evaluate(READ_CITYWIDE_PROBE, `${pose.poseId} citywide probe`);
        const observation = poseObservation(pose, scheduler, citywide);
        observation.dispatchCount = dispatchCount;
        observation.landingMs = landingMs;

        // The teleport actually happened: the scheduler recomputed its
        // footprint for a DIFFERENT camera than the previous pose's.
        const footprint = observation.decision?.footprintSignature ?? null;
        if (!footprint) fail(`${pose.poseId}: the scheduler recorded no decision, so no pose can be proven applied`);
        if (previousFootprint !== null && footprint === previousFootprint) fail(`${pose.poseId}: the scheduler footprint did not change from the previous pose (${footprint}); the camera did not move`);
        previousFootprint = footprint;

        const lapHosts = externalHosts(session, dev);
        if (lapHosts.length > 0) fail(`${pose.poseId}: external hosts were contacted: ${lapHosts.join(", ")}`);
        const lapFocus = await session.evaluate(READ_FOCUS, `${pose.poseId} focus`);
        if (lapFocus.hasFocus !== focus.hasFocus || lapFocus.visibilityState !== focus.visibilityState) {
          fail(`${pose.poseId}: focus/visibility changed mid-run (hasFocus ${focus.hasFocus} -> ${lapFocus.hasFocus}, visibility ${focus.visibilityState} -> ${lapFocus.visibilityState})`);
        }

        if (poseIndex === VERDICT_POSE_INDEX || poseIndex === SECONDARY_POSE_INDEX) {
          // M2, the T006 validity condition: quiescence is READ, not implied by
          // the settle. A violation aborts the run and writes NO record, because
          // a sample taken mid-flight is a transient rather than a reading of
          // what survives a cycle, and recording it as a heap FAILURE would be
          // reporting the wrong quantity.
          const inFlight = await session.evaluate(READ_ACTIVE_REQUESTS, `${pose.poseId} activeRequests`);
          if (inFlight === null) fail(`M2 INSTRUMENT-FAILURE ABORT at lap ${lapIndex} ${pose.poseId}: no wave published metrics, so activeRequests could not be read. An absent reading is not a zero.`);
          if (inFlight.activeRequests !== 0) fail(`M2 INSTRUMENT-FAILURE ABORT at lap ${lapIndex} ${pose.poseId}: activeRequests was ${inFlight.activeRequests} at sample time, not 0. Re-run with --attempt incremented; this is NOT a heap failure.`);
          observation.activeRequestsAtSample = inFlight.activeRequests;
          observation.activeRequestsReadFrom = inFlight.readFrom;
          await session.evaluate(FORCE_GC, `${pose.poseId} forced collection`);
          await wait(GC_SETTLE_MS);
          const bytes = await session.evaluate(READ_HEAP, `${pose.poseId} heap read`);
          observation.jsHeapBytes = bytes;
          observation.heapSampleRole = poseIndex === VERDICT_POSE_INDEX ? "verdict" : "disclosed-secondary";
          const series = poseIndex === VERDICT_POSE_INDEX ? verdictSeriesAll : secondarySeriesAll;
          if (series.length > 0 && series[series.length - 1] === bytes) fail(`${pose.poseId}: two consecutive heap samples were byte-identical (${bytes}); the reading is frozen`);
          series.push(bytes);
        }
        lapPoses.push(observation);
        console.error(`lap ${lapIndex}${lapIndex < WARMUP_LAPS ? " (warmup)" : ""} ${pose.poseId}: dispatches=${dispatchCount} resident=${observation.decision?.residentCount} visible=${observation.decision?.visibleCount} deferred=${observation.decision?.deferredCount} released=${observation.exteriorPool?.releasedArtifactCount} denseEntries=${observation.denseShardCache?.entries} heap=${observation.jsHeapBytes ?? "-"}`);
      }
      repeats.push({ repeatIndex: lapIndex, sampled: lapIndex >= WARMUP_LAPS, role: lapIndex < WARMUP_LAPS ? "UNSAMPLED warmup" : "sampled", poses: lapPoses });
    }
    const lapPhaseMs = Date.now() - lapPhaseStartedAt;

    // ---- verdicts --------------------------------------------------------
    const verdictSeries = verdictSeriesAll.slice(WARMUP_LAPS);
    const secondarySeries = secondarySeriesAll.slice(WARMUP_LAPS);
    if (verdictSeries.length < PRE_REGISTERED.minimumSampledRepeats) fail(`only ${verdictSeries.length} sampled repeats; the pre-registered floor is ${PRE_REGISTERED.minimumSampledRepeats}`);

    const heapVerdict = block835CanaryHeapVerdict(verdictSeries, BLOCK835_CANARY_HEAP_NOISE_BAND, true);
    const unwarmedVerdict = block835CanaryHeapVerdict(verdictSeriesAll, BLOCK835_CANARY_HEAP_NOISE_BAND, true);
    const secondaryVerdict = block835CanaryHeapVerdict(secondarySeries, BLOCK835_CANARY_HEAP_NOISE_BAND, true);

    const sampledRepeats = repeats.filter((entry) => entry.sampled);
    const heapPerRepeat = sampledRepeats.map((entry, index) => {
      const pose = entry.poses[VERDICT_POSE_INDEX];
      const bytes = verdictSeries[index];
      const first = verdictSeries[0];
      return {
        repeatIndex: index,
        lapIndex: entry.repeatIndex,
        poseId: pose.poseId,
        jsHeapBytes: bytes,
        deltaFromPreviousBytes: index === 0 ? null : bytes - verdictSeries[index - 1],
        deltaFromFirstBytes: bytes - first,
        ratioToFirst: Number((bytes / first).toFixed(6)),
        // Mirrors the prior record's columns. These are the EXTERIOR cell pool,
        // which is the pool those column names carry there.
        cacheEntries: pose.exteriorPool?.cacheEntries ?? null,
        cachedBytes: pose.exteriorPool?.cachedBytes ?? null,
        cacheEvictions: pose.exteriorPool?.cacheEvictions ?? null,
        peakConcurrentRequests: pose.exteriorPool?.peakConcurrentRequests ?? null,
        releasedArtifactCount: pose.exteriorPool?.releasedArtifactCount ?? null,
        releasedArtifactBytes: pose.exteriorPool?.releasedArtifactBytes ?? null,
        denseShardCacheEntries: pose.denseShardCache?.entries ?? null,
        denseShardCacheBytes: pose.denseShardCache?.bytes ?? null,
        adapterCacheEvictions: pose.adapter?.cacheEvictions ?? null,
        residentCount: pose.decision?.residentCount ?? null,
        visibleCount: pose.decision?.visibleCount ?? null,
        deferredCount: pose.decision?.deferredCount ?? null,
        planBuildCount: pose.denseMetrics?.planBuildCount ?? null,
        planSwapCount: pose.denseMetrics?.planSwapCount ?? null,
        planCancellationCount: pose.denseMetrics?.planCancellationCount ?? null,
        buildingFeatureCount: pose.denseMetrics?.buildingFeatureCount ?? null,
        traceLength: pose.probeBuffers.traceLength,
        denseSampleCount: pose.probeBuffers.denseSampleCount,
        dispatchCount: pose.dispatchCount,
      };
    });

    const firstHalfMedian = median(verdictSeries.slice(0, Math.floor(verdictSeries.length / 2)));
    const monotonicity = {
      restatementSentence: RESTATEMENT_SENTENCE,
      strictlyIncreasingRunLength: strictlyIncreasingRunLength(verdictSeries),
      positiveDeltaCount: verdictSeries.filter((value, index) => index > 0 && value > verdictSeries[index - 1]).length,
      deltaCount: verdictSeries.length - 1,
      ...ordinaryLeastSquares(verdictSeries),
      detectableRetentionFloorBytesPerLap: Number((0.10 * firstHalfMedian / 4).toFixed(3)),
      detectableRetentionFloorDerivation: "0.10 x firstHalfMedianBytes / 4. The two medians this verdict compares are centred four laps apart, so a steady per-lap retention r moves the second-half median by 4r; the ratio test fires only when 4r exceeds 0.10 x firstHalfMedianBytes. Anything retained more slowly than this floor is BELOW what this instrument can detect, and a PASS therefore bounds retention rather than excluding it.",
    };

    const passed = heapVerdict.available && heapVerdict.growthRatio !== null && heapVerdict.growthRatio <= BLOCK835_CANARY_HEAP_NOISE_BAND && heapVerdict.monotonicGrowthDetected === false && heapVerdict.sampleCount >= PRE_REGISTERED.minimumSampledRepeats;

    const overviewPose = sampledRepeats.at(-1).poses[SECONDARY_POSE_INDEX];
    const streetPose = sampledRepeats.at(-1).poses[VERDICT_POSE_INDEX];

    const record = {
      schemaVersion: "1.0",
      recordId: `${evidenceId}:repeated-camera-path`,
      task: evidenceId === DEFAULT_EVIDENCE_ID ? "T008 (Issue #80)" : "T006 (re-run of the T008 instrument at six-wave scale)",
      criterion: 7,
      /**
       * The T006 additions, stated in the record rather than only in the file.
       */
      t006: evidenceId === DEFAULT_EVIDENCE_ID ? null : {
        gates: { M1: HEAP_GATES.M1.rule, M2: HEAP_GATES.M2.rule, M3: HEAP_GATES.M3.rule, M4: HEAP_GATES.M4.rule },
        m2OnViolation: HEAP_GATES.M2.onViolation,
        m2WhyItIsNew: HEAP_GATES.M2.whyItIsNew,
        lapPhaseCapMs: LAP_PHASE_CAP_MS,
        lapPhaseCapReason: HEAP_GATES.lapPhaseCapReason,
        frozenPathProhibition: HEAP_GATES.frozenPathProhibition,
        writtenTo: `data/${evidenceId}/`,
      },
      capturedAt: new Date().toISOString(),
      claim: "The retained-heap half of goal criterion 7, captured where T007 recorded it had never been captured: ONE deterministic island-scale camera path, repeated in a SINGLE document, over the default six-wave citywide composition, with an explicit in-page window.gc() before every heap sample. The verdict arithmetic is block835CanaryHeapVerdict, imported from src/runtime/block835-canary-probe.ts, not re-implemented here.",
      preRegistered: PRE_REGISTERED,
      method: {
        poseCount: POSES.length,
        warmupLaps: WARMUP_LAPS,
        sampledLaps: SAMPLED_LAPS,
        settleMsPerPose: SETTLE_MS,
        gcSettleMs: GC_SETTLE_MS,
        forcedCollection: "window.gc() evaluated IN THE PAGE, then a 500 ms dwell, then performance.memory.usedJSHeapSize. NOT HeapProfiler.collectGarbage, whose failure the T006 harness swallowed; a throw here aborts the run.",
        navigation: "Page.navigate is called ONCE, at boot, on the default URL (data=real-pilot, release=manhattan-citywide-20260804, view=free plus the pose parameters, with NO exteriorScheduler, exteriorStreaming or exteriorDetailRadius parameter). Every subsequent pose is history.pushState plus a synthetic PopStateEvent, which App.tsx routes to a setView teleport. The document, the adapter and every cache survive the whole run.",
        poseAppliedProof: "Each pose records the scheduler's own footprintSignature and heightBucket, and the run aborts if the signature fails to change from the previous pose.",
        poseLandingDisclosure: POSE_LANDING_DISCLOSURE,
        landingDwellMs: LANDING_DWELL_MS,
        settleStartsAfterLanding: "The 45 s settle is measured from the moment the pose LANDS, never from the first dispatch, so no settle is spent at a camera the scheduler has not yet seen.",
        bandEdges: "Poses 2 and 3 sit on the scheduler's distanceBandEdgesMeters [1200, 2400] (src/runtime/exterior-visibility-scheduler.ts:177) deliberately: a band edge is where admission flips.",
        lapPhaseMs,
        bootMs,
      },
      poses: POSES,
      servedBundle,
      preflight,
      focusEmulation,
      harnessDisclosure: "This measurement ran against a bundle built with VITE_EXTERIOR_SCHEDULER_PROBE=1 VITE_CITYWIDE_OVERVIEW_PROBE=1, because the residency, churn and cache columns below are read out of those two probes' DOM payloads. The probes read state the app already holds and decide nothing; they change no default, no budget and no scheduling decision. What the default URL above proves is the DEFAULT PARAMETERS, not the default BYTES: the bytes measured here carry two probes an ordinary production build compiles out, and both probe buffers are hard-capped (800 trace entries, 400 dense samples) with their per-lap fill reported in every row so a reader can see whether probe accumulation could account for any growth.",
      chrome: {
        launchCommand: CHROME_LAUNCH_COMMAND,
        userDataDir: "/tmp/t008-heap-chrome",
        remoteDebuggingPort: port,
        browser: browserVersion.Browser,
        userAgent: browserVersion["User-Agent"],
        v8Version: browserVersion["V8-Version"],
        statement: "A DEDICATED Chrome instance, launched by this task with its own user-data-dir, headful with a real GPU. It is not the user's browser profile and it is killed by user-data-dir match when the capture ends.",
      },
      viewport: VIEWPORT,
      attemptCount,
      attemptStatement: `This record is attempt ${attemptCount}. A pre-flight or mid-run abort writes no record at all, so an unwritten attempt cannot become evidence; attempts are counted here so a reader knows how many times the instrument was run.`,
      heapPerRepeat,
      heapVerdict,
      monotonicGrowthDetected: heapVerdict.monotonicGrowthDetected,
      monotonicity,
      verdictSeriesShape: seriesShape(verdictSeries),
      disclosedSeries: {
        unwarmedNineLap: {
          jsHeapBytes: verdictSeriesAll,
          heapVerdict: unwarmedVerdict,
          note: PRE_REGISTERED.unwarmedConvention,
        },
        overviewSecondary: {
          poseId: POSES[SECONDARY_POSE_INDEX].poseId,
          jsHeapBytes: secondarySeries,
          unwarmedJsHeapBytes: secondarySeriesAll,
          heapVerdict: secondaryVerdict,
          shape: seriesShape(secondarySeries),
          note: "DISCLOSURE ONLY, never the verdict. The overview is the peak-residency pose, so its heap is dominated by the resident scene rather than by what survives a cycle. It is published because a verdict series taken only at the trough would let a reader wonder what the peak was doing.",
        },
      },
      boundedClaim: {
        formulaClaim: heapVerdict.boundedClaim,
        whatWasPressed: `The 128-cell exterior resident pool WAS pressed: at the 52 km overview this session recorded residentCount ${overviewPose.decision?.residentCount} against visibleCount ${overviewPose.decision?.visibleCount} with deferredCount ${overviewPose.decision?.deferredCount}, and the lap drops from there to a 260 m street pose and back every repeat, so the pool is refilled and re-truncated eight times.`,
        whatWasNotPressed: `The citywide DENSE SHARD cache was NOT pressed and structurally CANNOT be by this path: CITYWIDE_OVERVIEW_BUDGETS caps it at maxLoadedShards 112 and maxLoadedBytes 80 x 1024 x 1024 = 83,886,080 B (src/release/citywide-release.ts:79-80), and the measured overview residency is ${overviewPose.denseShardCache?.entries} entries / ${overviewPose.denseShardCache?.bytes} B - under both caps, with cacheEvictions ${overviewPose.adapter?.cacheEvictions} by design rather than by luck. The whole island's dense shards fit inside the cap, so no camera path can force an eviction from this pool.`,
        stopReportCorrection: "T007's stop report for criterion 7 asked for a path that 'presses the 128-cell cap and forces eviction'. HALF of that is unreachable and this record says so rather than quietly satisfying the reachable half: the 128-cell exterior pool is pressed and its scheduler evictions are real, but the dense shard pool cannot be forced to evict by any camera, because its entire population fits under its own cap. A reader must not read this record as certifying dense-shard eviction behaviour.",
        stillNotObservable: "Native GPU memory and decoded-texture retention are not observable from performance.memory and are not claimed here in either direction.",
        detectionFloor: monotonicity.detectableRetentionFloorDerivation,
      },
      churnProof: {
        statement: "The lap is a real cycle, not a dwell: every repeat drops from a 52 km overview to two disjoint 260 m street working sets and climbs back, and the residency, release and plan counters below move with it. A flat heap over a path that never changed its resident set would prove nothing.",
        overviewLast: { residentCount: overviewPose.decision?.residentCount ?? null, visibleCount: overviewPose.decision?.visibleCount ?? null, deferredCount: overviewPose.decision?.deferredCount ?? null, denseShardCache: overviewPose.denseShardCache, exteriorPool: overviewPose.exteriorPool, denseMetrics: overviewPose.denseMetrics },
        streetLast: { residentCount: streetPose.decision?.residentCount ?? null, visibleCount: streetPose.decision?.visibleCount ?? null, deferredCount: streetPose.decision?.deferredCount ?? null, denseShardCache: streetPose.denseShardCache, exteriorPool: streetPose.exteriorPool, denseMetrics: streetPose.denseMetrics },
      },
      perRepeat: repeats,
      externalHosts: externalHosts(session, dev),
      networkResponseCount: session.responses().length,
      passed,
      verdictStatement: passed
        ? "PASS against the pre-registered rule. Read it as what it is: over eight repeats of one island-scale path, the JS heap surviving an explicit forced collection at the street pose did not grow beyond a 10% band between the first four repeats and the last four. It bounds retention at the detection floor stated above; it does not exclude retention below that floor, and it says nothing about native GPU memory."
        : "FAIL against the pre-registered rule. The series is published exactly as measured and no re-run was taken to improve it.",
    };

    await mkdir(evidenceRoot, { recursive: true });
    const text = `${JSON.stringify(record, null, 2)}\n`;
    await writeFile(join(evidenceRoot, "heap-repeat-evidence.json"), text);
    const checksum = sha256HexSync(text);
    await writeFile(join(evidenceRoot, "heap-repeat-evidence.sha256"), `${checksum}  heap-repeat-evidence.json\n`);
    console.log(JSON.stringify({ passed, checksum, verdictSeries, heapVerdict, monotonicity: { ...monotonicity, restatementSentence: "(see record)" } }, null, 2));
  } finally {
    await closeTarget();
  }
}

await run(process.argv.slice(2));
