/* global console, process, fetch, WebSocket, URL, setTimeout, clearTimeout */
/**
 * The T005 C5 SESSION evidence: what a browser does with a wave served in full.
 *
 * Three readings, one scratch Chrome, one document per arm:
 *
 *  - **frames** — the pre-registered A/B. The promoted default against wave
 *    `w02` at full population, at identical poses, judged by
 *    `exteriorServingFrameVerdict` which was committed BEFORE this file could
 *    produce a number. This CLI reports whatever that function returns; it does
 *    not re-implement the arithmetic and cannot choose the constants.
 *
 *    THE A/B IS CROSS-BUILD, and that was not visible until the capture was
 *    attempted. The pre-registered bar names arm A as "the promoted default …
 *    at the caps this build ships today" (128 resident units, 512 entries) and
 *    arm B as one serving wave "at the caps ADR 0052 §3 sizes for a dense
 *    composition" (8 and 1,024). Those caps are COMPILED CONSTANTS, so no single
 *    build can present both arms: running both post-promotion would measure arm
 *    A at cap 8, and running both pre-promotion would measure arm B at cap 128.
 *    Either substitution silently answers a different question than the one that
 *    was registered.
 *
 *    So `frames-arm` captures ONE arm against ONE build and writes a partial
 *    document that records the caps IT ran under, and `frames-compose` joins two
 *    partials and hands them to the unchanged verdict function. `frames` is kept
 *    for the same-build control — both arms, one browser, one set of caps —
 *    because it answers a real question too, just not the pre-registered one.
 *  - **roam** — eviction at scale. A camera path across `w02`'s full-population
 *    cells at the serving caps, checking that eviction actually happens, that a
 *    cell re-entered after eviction is byte-identical, that picking still
 *    resolves the same identity across evict/re-admit, and that the shared
 *    request budget is never exceeded.
 *  - **landing** — the D-18 pose-landing loop, on a real session: how many
 *    dispatches a pose takes to land.
 *
 * T008 DISCIPLINE, unchanged: a DEDICATED Chrome on its own debugging port with
 * its own scratch profile, launched by this file and killed by it, never the
 * operator's browser and never their profile.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { exteriorServingFrameVerdict, framePercentile } from "../src/runtime/exterior-serving-frame-bar.ts";
import { EXTERIOR_SERVING_EVIDENCE_ID, exteriorServingWave } from "../src/release/exterior-serving-waves.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";

const run = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(repositoryRoot, "data", EXTERIOR_SERVING_EVIDENCE_ID);

const PORT = 9224;
const USER_DATA_DIR = "/tmp/t005-serving-chrome";
/**
 * The scratch instance's launch line.
 *
 * `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding`
 * are HARNESS FIXES, found by running this file: `requestAnimationFrame` is
 * suspended in an occluded window, so the frame sampler simply never received a
 * callback and timed out after two minutes whenever another window happened to
 * cover the scratch Chrome. They do not change what is rendered or how fast it
 * renders; they stop the browser from deciding not to render at all, which is
 * the difference between a measurement and a missing one. They are disclosed in
 * every record this file writes because a frame-time reading taken with
 * backgrounding disabled is not identical to one taken without it, and a reader
 * is entitled to know which they are looking at.
 */
const CHROME_LAUNCH_COMMAND = `open -na "Google Chrome" --args --remote-debugging-port=${PORT} --user-data-dir=${USER_DATA_DIR} --no-first-run --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`;
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 300_000;
const EVALUATE_TIMEOUT_MS = 120_000;
const SETTLE_MS = 20_000;
const FRAME_SAMPLE_MS = 6_000;

const SERVING_WAVE = exteriorServingWave("w02");

/** Midtown anchor and a Lower-Manhattan street pose inside the served wave. */
const ANCHOR = { lon: -73.986360, lat: 40.748775 };
const LOWER = { lon: -74.009000, lat: 40.706900 };
const POSES = [
  { poseId: "overview-2400m-anchor", ...ANCHOR, height: 2_400, heading: 45, pitch: -50, roll: 0, role: "outer scheduler band edge, shared by both arms" },
  { poseId: "transition-1200m-anchor", ...ANCHOR, height: 1_200, heading: 45, pitch: -45, roll: 0, role: "inner band edge" },
  { poseId: "street-260m-midtown", ...ANCHOR, height: 260, heading: 45, pitch: -25, roll: 0, role: "street pose over the promoted midtown wave" },
  { poseId: "street-260m-w02-lower", ...LOWER, height: 260, heading: 45, pitch: -25, roll: 0, role: "STREET POSE INSIDE THE SERVED WAVE; a bar that never puts the camera in w02 measures the wrong thing" },
];

/** The roam, across `w02` cells only. Distinct working sets, deliberately. */
const ROAM = [
  { poseId: "roam-1-battery", lon: -74.014000, lat: 40.703500, height: 300, heading: 20, pitch: -25, roll: 0 },
  { poseId: "roam-2-wall-st", lon: -74.008500, lat: 40.706800, height: 300, heading: 90, pitch: -25, roll: 0 },
  { poseId: "roam-3-tribeca", lon: -74.008000, lat: 40.717500, height: 300, heading: 160, pitch: -25, roll: 0 },
  { poseId: "roam-4-les", lon: -73.988000, lat: 40.717000, height: 300, heading: 250, pitch: -25, roll: 0 },
  { poseId: "roam-5-battery-return", lon: -74.014000, lat: 40.703500, height: 300, heading: 20, pitch: -25, roll: 0 },
];

function fail(message) { throw new Error(`exterior-serving-evidence: ${message}`); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function wait(ms) { return new Promise((resolvePromise) => { setTimeout(resolvePromise, ms); }); }
function argValue(argv, name, fallback) {
  const found = argv.find((token) => token.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}
async function withTimeout(promise, ms, what) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_r, rejectPromise) => { timer = setTimeout(() => rejectPromise(new Error(`timed out after ${ms} ms waiting for ${what}`)), ms); })]);
  } finally { clearTimeout(timer); }
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
  /** A page exception is a FAILURE, never a null: every reading here is load-bearing. */
  async evaluate(expression, what = "page evaluation") {
    const result = await withTimeout(this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), EVALUATE_TIMEOUT_MS, what);
    if (result.exceptionDetails) fail(`${what} threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  }
  responses() { return this.events.filter((event) => event.method === "Network.responseReceived").map((event) => event.params.response); }
  /**
   * Requests the NETWORK refused or dropped, and responses the server answered
   * with a non-2xx status.
   *
   * Added to diagnose a three-artifact fallback on the promoted default that the
   * offline validator could not see: `replayMultiLodAssembly` reads the emitted
   * bytes off the filesystem, so a defect in how a path is REQUESTED — an
   * encoded character, a wrong prefix, a URL a static server declines — passes
   * every offline gate and fails in a browser. Naming the request is the only
   * way to tell that apart from a transport hiccup.
   */
  failedRequests() {
    const byId = new Map();
    for (const event of this.events) {
      if (event.method === "Network.requestWillBeSent") byId.set(event.params.requestId, event.params.request.url);
    }
    const failures = [];
    for (const event of this.events) {
      if (event.method === "Network.loadingFailed") {
        failures.push({ kind: "loading-failed", url: byId.get(event.params.requestId) ?? null, errorText: event.params.errorText, canceled: event.params.canceled === true, blockedReason: event.params.blockedReason ?? null });
      }
      if (event.method === "Network.responseReceived" && event.params.response.status >= 400) {
        failures.push({ kind: "http-error", url: event.params.response.url, status: event.params.response.status, statusText: event.params.response.statusText });
      }
    }
    return failures;
  }
  close() { try { this.socket.close(); } catch { /* already gone */ } }
}

async function attach(initialUrl) {
  const listResponse = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(initialUrl)}`, { method: "PUT" }).catch(() => null);
  if (!listResponse?.ok) fail(`could not open a tab on debugging port ${PORT}; the scratch Chrome did not come up. Launch line: ${CHROME_LAUNCH_COMMAND}`);
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

async function launchChrome() {
  await run("/bin/sh", ["-c", CHROME_LAUNCH_COMMAND]);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const probe = await fetch(`http://127.0.0.1:${PORT}/json/version`).catch(() => null);
    if (probe?.ok) return (await probe.json()).Browser;
    if (Date.now() > deadline) fail(`the scratch Chrome never answered on port ${PORT}.`);
    await wait(500);
  }
}

/**
 * Kills ONLY the scratch instance, matched on its own user-data directory.
 * The operator's Chrome does not carry that path and is never a match.
 *
 * HARNESS FIX, found by running this file: the pattern used to be
 * `--user-data-dir=/tmp/t005-serving-chrome`, and `pkill` parses a pattern
 * beginning with `--` as an option rather than as the pattern. The call failed
 * every time, the failure was swallowed by the `.catch`, and the scratch Chrome
 * was left running after every command — including the error path, which is
 * exactly when it matters. The pattern is now the scratch profile's directory
 * NAME, which still cannot match any browser but this one, and the result is
 * VERIFIED rather than assumed: this function returns how many processes remain,
 * so "cleaned up" is a reading and not a hope.
 */
async function killChrome() {
  await run("/usr/bin/pkill", ["-f", USER_DATA_DIR.replace("/tmp/", "")]).catch(() => null);
  await wait(1_500);
  const remaining = await run("/usr/bin/pgrep", ["-f", USER_DATA_DIR.replace("/tmp/", "")]).then(
    ({ stdout }) => stdout.split("\n").filter((line) => line.trim().length > 0).length,
    () => 0,
  );
  if (remaining > 0) console.error(`exterior-serving-evidence: WARNING — ${remaining} scratch Chrome processes survived cleanup.`);
  return remaining;
}

// ---------------------------------------------------------------------------
// Page probes
// ---------------------------------------------------------------------------

const READ_SCHEDULER_PROBE = `(() => {
  const node = document.querySelector("[data-exterior-scheduler-probe]");
  if (!node) return null;
  const probe = JSON.parse(node.textContent);
  return {
    exteriorStreamingActive: probe.exteriorStreamingActive,
    decision: probe.decision,
    traceLength: probe.traceLength,
    waves: (probe.waves || []).map((wave) => ({ releaseId: wave.releaseId, declaredCellCount: wave.declaredCellCount, metrics: wave.metrics })),
  };
})()`;

/**
 * Frame durations, sampled with `requestAnimationFrame` deltas.
 *
 * Deliberately the browser's own presentation cadence rather than a Cesium
 * internal: it is what a user experiences, and it is the same instrument in
 * both arms, which is what a comparison needs.
 */
function sampleFramesExpression(durationMs) {
  return `(async () => {
    const frames = [];
    let previous = performance.now();
    const deadline = previous + ${durationMs};
    await new Promise((resolvePromise) => {
      const step = (now) => {
        frames.push(now - previous);
        previous = now;
        if (now >= deadline) { resolvePromise(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    // The first delta spans the gap since the previous paint, not a rendered
    // frame, so it is dropped rather than smoothed.
    return frames.slice(1);
  })()`;
}

/**
 * PNG image requests this document made, counted two ways.
 *
 * HARNESS FIX, disclosed: this filtered on `/public/textures/`, which is the
 * shared-class tile directory a `-s1` SERVING release ships and which NO
 * curated `-p1` release has — so arm A could only ever score zero, and a zero
 * produced by a path filter is not a measurement. It now counts every `.png`
 * the document fetched and reports the shared-class subset separately, so arm
 * A's zero is a measured zero over all image requests rather than an artifact
 * of which release layout the pattern happened to match.
 *
 * What it does NOT measure is GPU decode: this is the request count, which is
 * the observable that answers "does texture delivery scale with population".
 */
const COUNT_DECODED_TEXTURES = `(() => {
  const png = performance.getEntriesByType("resource").filter((entry) => entry.name.split("?")[0].endsWith(".png"));
  const shared = png.filter((entry) => entry.name.includes("/public/textures/"));
  return {
    requestCount: png.length,
    distinctUrlCount: new Set(png.map((entry) => entry.name)).size,
    sharedClassRequestCount: shared.length,
    sharedClassDistinctUrlCount: new Set(shared.map((entry) => entry.name)).size,
  };
})()`;

function poseUrl(base, pose, releaseId) {
  const url = new URL(base);
  url.searchParams.set("data", "real-pilot");
  url.searchParams.set("release", "manhattan-citywide-20260804");
  url.searchParams.set("view", "free");
  if (releaseId) url.searchParams.set("exteriorCells", releaseId);
  for (const [key, value] of [["lon", pose.lon], ["lat", pose.lat], ["height", pose.height], ["heading", pose.heading], ["pitch", pose.pitch], ["roll", pose.roll]]) {
    url.searchParams.set(key, Number(value).toFixed(6));
  }
  return url.toString();
}

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

/**
 * Land a pose, and RECORD HOW MANY DISPATCHES IT TOOK.
 *
 * The T008 harness had to re-dispatch every pose at 5 s intervals until the
 * scheduler's own `footprintSignature` changed, because `emitSettledCamera` ran
 * synchronously after the `setView` teleport, before a frame had rendered at the
 * new camera, and nothing re-emitted afterwards. D-18 changed that frame order.
 * This function keeps the loop — a loop that never iterates proves the fix, and
 * a loop that was deleted proves nothing — and reports `dispatchCount` for every
 * pose so a reader can see whether it ever ran twice.
 */
async function landPose(session, url, poseId) {
  const before = await session.evaluate(READ_SCHEDULER_PROBE, `${poseId} pre-dispatch probe`);
  const beforeSignature = before?.decision?.footprintSignature ?? null;
  let dispatchCount = 0;
  const deadline = Date.now() + 60_000;
  for (;;) {
    dispatchCount += 1;
    await session.evaluate(applyPoseExpression(url), `${poseId} dispatch ${dispatchCount}`);
    const settled = Date.now() + 5_000;
    for (;;) {
      const probe = await session.evaluate(READ_SCHEDULER_PROBE, `${poseId} landing probe`);
      const signature = probe?.decision?.footprintSignature ?? null;
      if (signature !== null && signature !== beforeSignature) return { dispatchCount, footprintSignature: signature };
      if (Date.now() > settled) break;
      await wait(500);
    }
    if (Date.now() > deadline) return { dispatchCount, footprintSignature: null, landed: false };
  }
}

function waveMetrics(probe, releaseId) {
  const wave = (probe?.waves ?? []).find((entry) => entry.releaseId === releaseId) ?? (probe?.waves ?? [])[0] ?? null;
  return wave?.metrics ?? null;
}

/**
 * Assets RESIDENT in the shared exterior LRU, which is what the frame bar means
 * by `residentAssetCount`.
 *
 * TWO DEFECTS FIXED HERE, both found by running this file for the first time
 * and both disclosed rather than quietly corrected:
 *
 *  1. It read `loadedArtifactCount`, which `ExteriorCellRuntime` only ever
 *     INCREMENTS (`this.loadedArtifactCount += 1`). That is a cumulative count
 *     of everything a document has ever fetched, so it can only rise and it
 *     reported the same number at a 2,400 m overview and a 260 m street pose.
 *     Residency is `cacheEntries`.
 *  2. It SUMMED across waves. `cacheEntries` and `cachedBytes` are SESSION-WIDE
 *     — they read the one shared cache instance every promoted wave writes into
 *     — and `exterior-cell-runtime.ts` says in as many words that a reader must
 *     take them from one wave and never sum them, on pain of multiplying one
 *     pool by the number of promotions. At six promoted waves that error is 6x.
 *
 * Both mattered: the bar treats resident-asset equality as the thing that makes
 * a pose like-for-like, and a cumulative counter would have made every pose look
 * equal for the wrong reason.
 */
function residentAssetCount(probe) {
  for (const wave of probe?.waves ?? []) {
    if (wave.metrics) return wave.metrics.cacheEntries;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// frames
// ---------------------------------------------------------------------------

async function captureArm(base, releaseId, label) {
  const { session, targetId } = await attach(poseUrl(base, POSES[0], releaseId));
  try {
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.traceLength >= 0, `${label} scheduler probe`);
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, `${label} exterior activation`);
    const samples = [];
    const landings = [];
    for (const pose of POSES) {
      const landing = await landPose(session, poseUrl(base, pose, releaseId), `${label}:${pose.poseId}`);
      landings.push({ poseId: pose.poseId, ...landing });
      await wait(SETTLE_MS);
      const probe = await session.evaluate(READ_SCHEDULER_PROBE, `${label}:${pose.poseId} probe`);
      const frameMs = await session.evaluate(sampleFramesExpression(FRAME_SAMPLE_MS), `${label}:${pose.poseId} frames`);
      const textures = await session.evaluate(COUNT_DECODED_TEXTURES, `${label}:${pose.poseId} textures`);
      samples.push({
        poseId: pose.poseId,
        frameMs,
        residentAssetCount: residentAssetCount(probe),
        decodedTextureCount: textures.distinctUrlCount,
        textureRequestCount: textures.requestCount,
        sharedClassTextureCount: textures.sharedClassDistinctUrlCount,
        sharedClassTextureRequestCount: textures.sharedClassRequestCount,
        decision: probe?.decision ?? null,
        metrics: waveMetrics(probe, releaseId),
      });
    }
    return { samples, landings, externalHosts: [...new Set(session.responses().map((response) => { try { return new URL(response.url).host; } catch { return ""; } }).filter((host) => host && host !== new URL(base).host))].sort() };
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
  }
}

async function runFrames(base) {
  const browser = await launchChrome();
  try {
    const armA = await captureArm(base, null, "promoted-default");
    const armB = await captureArm(base, SERVING_WAVE.servingReleaseId, "serving-w02");
    const verdict = exteriorServingFrameVerdict({
      promotedDefault: armA.samples.map((sample) => ({ poseId: sample.poseId, frameMs: sample.frameMs, residentAssetCount: sample.residentAssetCount, decodedTextureCount: sample.decodedTextureCount })),
      servingWave: armB.samples.map((sample) => ({ poseId: sample.poseId, frameMs: sample.frameMs, residentAssetCount: sample.residentAssetCount, decodedTextureCount: sample.decodedTextureCount })),
    });
    const record = {
      schemaVersion: "1.0",
      artifact: "serving-frame-time-ab",
      capturedAt: new Date().toISOString(),
      browser,
      viewport: VIEWPORT,
      base,
      arms: {
        promotedDefault: { releaseSelector: "default", poses: armA.samples.map(stripFrames), landings: armA.landings, externalHosts: armA.externalHosts },
        servingWave: { releaseSelector: `?exteriorCells=${SERVING_WAVE.servingReleaseId}`, poses: armB.samples.map(stripFrames), landings: armB.landings, externalHosts: armB.externalHosts },
      },
      verdict,
      caps: { ...EXTERIOR_RUNTIME_BUDGETS },
      harnessDisclosure: `Both arms ran in ONE scratch Chrome (${CHROME_LAUNCH_COMMAND}), one document per arm, at the identical four poses in the identical order, with ${SETTLE_MS} ms of settle before each ${FRAME_SAMPLE_MS} ms frame sample. The bundle carries VITE_EXTERIOR_SCHEDULER_PROBE=1 because the residency and cache columns are read out of that probe's DOM payload; the probe reads state the app already holds and decides nothing. Frame durations are requestAnimationFrame deltas — the browser's own presentation cadence, the same instrument in both arms — and the first delta of each sample is dropped because it spans the gap since the previous paint rather than a rendered frame.`,
      claim: "The pre-registered non-regression bar of ADR 0052, evaluated by exteriorServingFrameVerdict, which was committed before this instrument could produce a number. Passing it is a frame-time statement about the serving SHAPE at these four poses on this machine. It is not visual, architectural or geographic acceptance, and it is not a claim about any pose, machine or composition not listed here.",
    };
    await writeEvidence("frame-time-ab", record);
    console.log(serialize({ ok: verdict.pass, measurablePoseCount: verdict.measurablePoseCount, poses: verdict.poses.map((pose) => ({ poseId: pose.poseId, p50A: pose.p50A, p50B: pose.p50B, p95A: pose.p95A, p95B: pose.p95B, residentA: pose.residentAssetCountA, residentB: pose.residentAssetCountB, pass: pose.pass, unmeasurableReason: pose.unmeasurableReason })) }));
    if (!verdict.pass) process.exitCode = 1;
  } finally {
    await killChrome();
  }
}

function stripFrames(sample) {
  const { frameMs, ...rest } = sample;
  return { ...rest, frameSampleCount: frameMs.length, frameMsHead: frameMs.slice(0, 8).map((value) => Number(value.toFixed(3))) };
}

// ---------------------------------------------------------------------------
// frames-arm / frames-compose — the CROSS-BUILD form of the same A/B
// ---------------------------------------------------------------------------

/**
 * The residency cap COMPILED INTO THE BUILD UNDER TEST, read out of the source
 * the build was made from.
 *
 * It is read as text rather than imported because
 * `exterior-visibility-scheduler.ts` reaches its dependencies without file
 * extensions, which Node's type stripping cannot resolve; the module graph
 * simply is not loadable from a plain `node` process, and the runtime budgets
 * above are (they are). The read is a pinned pattern over the same file the
 * bundler compiled and it FAILS CLOSED — an arm document without this number
 * cannot be composed against one that has a different one, which is the entire
 * reason the arms are separate.
 */
async function compiledResidencyCap() {
  const text = await readFile(join(repositoryRoot, "src/runtime/exterior-visibility-scheduler.ts"), "utf8");
  const match = /EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY\s*=\s*\{[\s\S]*?maxResidentUnits:\s*(\d[\d_]*)/u.exec(text);
  if (!match) fail("could not read maxResidentUnits out of EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY; an arm document that cannot state its own residency cap is not evidence about a cap.");
  return Number(match[1].replaceAll("_", ""));
}

const FRAME_ARMS = {
  a: { label: "promoted-default", releaseSelector: null, verdictKey: "promotedDefault" },
  b: { label: "serving-w02", releaseSelector: SERVING_WAVE.servingReleaseId, verdictKey: "servingWave" },
};

/**
 * One arm, one build. The FULL frame series is retained here rather than
 * stripped, because the verdict is computed later in a different process and a
 * percentile cannot be recovered from a summary.
 */
async function runFrameArm(base, armId, buildLabel) {
  const arm = FRAME_ARMS[armId];
  if (!arm) fail(`unknown arm ${armId}; expected a or b.`);
  if (!buildLabel) fail("--build= is required: an arm document that does not say which build produced it cannot be composed honestly.");
  const residencyCap = await compiledResidencyCap();
  const browser = await launchChrome();
  try {
    const captured = await captureArm(base, arm.releaseSelector, arm.label);
    const record = {
      schemaVersion: "1.0",
      artifact: "serving-frame-time-arm",
      arm: armId,
      armLabel: arm.label,
      buildLabel,
      capturedAt: new Date().toISOString(),
      browser,
      viewport: VIEWPORT,
      base,
      releaseSelector: arm.releaseSelector === null ? "default" : `?exteriorCells=${arm.releaseSelector}`,
      caps: { ...EXTERIOR_RUNTIME_BUDGETS },
      residencyCap,
      samples: captured.samples,
      landings: captured.landings,
      externalHosts: captured.externalHosts,
      harnessDisclosure: `ONE arm of the pre-registered A/B, captured against build "${buildLabel}" in its own scratch Chrome (${CHROME_LAUNCH_COMMAND}), at the four registered poses in the registered order, with ${SETTLE_MS} ms of settle before each ${FRAME_SAMPLE_MS} ms frame sample. The bundle carries VITE_EXTERIOR_SCHEDULER_PROBE=1 because the residency and cache columns are read out of that probe's DOM payload; the probe reads state the app already holds and decides nothing. Frame durations are requestAnimationFrame deltas — the browser's own presentation cadence — and the first delta of each sample is dropped because it spans the gap since the previous paint rather than a rendered frame. The caps above are the ones COMPILED INTO THIS BUILD, which is the whole reason the arms are captured separately.`,
    };
    await writeEvidence(`frame-arm-${armId}`, record);
    console.log(serialize({
      arm: armId,
      buildLabel,
      caps: record.caps,
      residencyCap: record.residencyCap,
      poses: captured.samples.map((sample) => ({ poseId: sample.poseId, frames: sample.frameMs.length, p50: Number(framePercentile(sample.frameMs, 50).toFixed(3)), p95: Number(framePercentile(sample.frameMs, 95).toFixed(3)), resident: sample.residentAssetCount, textures: sample.decodedTextureCount, dispatches: captured.landings.find((landing) => landing.poseId === sample.poseId)?.dispatchCount ?? null })),
    }));
  } finally {
    await killChrome();
  }
}

/**
 * Join two arm documents and hand them, unaltered, to the pre-registered
 * verdict. This function chooses nothing: it reads two files, passes the frame
 * series through, and prints what `exteriorServingFrameVerdict` returns.
 */
async function composeFrames() {
  const read = async (armId) => JSON.parse(await readFile(join(evidenceRoot, `frame-arm-${armId}.json`), "utf8"));
  const armA = await read("a");
  const armB = await read("b");
  if (armA.arm !== "a" || armB.arm !== "b") fail("the two arm documents are not one A and one B.");
  const posesEqual = JSON.stringify(armA.samples.map((sample) => sample.poseId)) === JSON.stringify(armB.samples.map((sample) => sample.poseId));
  if (!posesEqual) fail("the two arms did not visit the same poses in the same order, so they are not a comparison.");
  const verdict = exteriorServingFrameVerdict({
    promotedDefault: armA.samples.map((sample) => ({ poseId: sample.poseId, frameMs: sample.frameMs, residentAssetCount: sample.residentAssetCount, decodedTextureCount: sample.decodedTextureCount })),
    servingWave: armB.samples.map((sample) => ({ poseId: sample.poseId, frameMs: sample.frameMs, residentAssetCount: sample.residentAssetCount, decodedTextureCount: sample.decodedTextureCount })),
  });
  const record = {
    schemaVersion: "1.0",
    artifact: "serving-frame-time-ab",
    form: "cross-build",
    composedAt: new Date().toISOString(),
    arms: {
      promotedDefault: { buildLabel: armA.buildLabel, capturedAt: armA.capturedAt, browser: armA.browser, base: armA.base, releaseSelector: armA.releaseSelector, caps: armA.caps, residencyCap: armA.residencyCap, poses: armA.samples.map(stripFrames), landings: armA.landings, externalHosts: armA.externalHosts },
      servingWave: { buildLabel: armB.buildLabel, capturedAt: armB.capturedAt, browser: armB.browser, base: armB.base, releaseSelector: armB.releaseSelector, caps: armB.caps, residencyCap: armB.residencyCap, poses: armB.samples.map(stripFrames), landings: armB.landings, externalHosts: armB.externalHosts },
    },
    viewport: armA.viewport,
    verdict,
    formDisclosure: "CROSS-BUILD, and stated as the first fact about this record rather than buried in it. The pre-registered bar names arm A at the caps the pre-promotion build shipped and arm B at the caps ADR 0052 §3 sizes for a dense composition; those are compiled constants, so the two arms cannot exist in one binary and were captured against two builds, one per arm, on the same machine at the same four poses in the same order. The two builds are named in `arms.*.buildLabel` and their compiled caps are carried beside their numbers. What this costs is that the arms did not share a browser process: each ran its own scratch Chrome, so a machine-state difference between the two runs is not controlled for and is a real limitation of this reading.",
    claim: "The pre-registered non-regression bar of ADR 0052, evaluated by exteriorServingFrameVerdict, which was committed before this instrument could produce a number. Passing it is a frame-time statement about the serving SHAPE at these four poses on this machine. It is not visual, architectural or geographic acceptance, and it is not a claim about any pose, machine or composition not listed here.",
  };
  await writeEvidence("frame-time-ab", record);
  console.log(serialize({ ok: verdict.pass, measurablePoseCount: verdict.measurablePoseCount, likeForLikePoseCount: verdict.likeForLikePoseCount, poses: verdict.poses.map((pose) => ({ poseId: pose.poseId, p50A: Number(pose.p50A.toFixed(3)), p50B: Number(pose.p50B.toFixed(3)), p95A: Number(pose.p95A.toFixed(3)), p95B: Number(pose.p95B.toFixed(3)), admittedP50Ms: Number(pose.admittedP50Ms.toFixed(3)), admittedP95Ms: Number(pose.admittedP95Ms.toFixed(3)), residentA: pose.residentAssetCountA, residentB: pose.residentAssetCountB, texturesA: pose.decodedTextureCountA, texturesB: pose.decodedTextureCountB, pass: pose.pass, unmeasurableReason: pose.unmeasurableReason })) }));
  if (!verdict.pass) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// roam
// ---------------------------------------------------------------------------

/**
 * The details panel, as text.
 *
 * There is no `data-selected-feature-id` attribute in this app and this
 * instrument does not add one: an attribute added to be measured is a change to
 * the thing under test. What the DOM already exposes is the panel itself, so the
 * reading is the panel's rendered text, digested. Comparing that digest before
 * and after an eviction cycle asks the question a user would: does the same
 * building still resolve to the same sourced information after its bytes were
 * evicted and re-admitted.
 *
 * WHAT THIS DOES NOT PROVE, stated rather than left to be assumed: the selection
 * is reached through a `?feature=` deep link against the canonical base identity
 * set, not through a canvas pick on exterior geometry. It shows identity and
 * provenance surviving the cycle; it does not show that a mouse click on the
 * re-admitted mesh returns that identity. A canvas-pick reading is named as an
 * uncaptured gap rather than approximated here.
 */
/**
 * Every exterior notice the app is showing, verbatim.
 *
 * A `base-massing` outcome carries the failing cell, the runtime failure CODE
 * and the message naming the artifact, and the app puts all of it in the notice
 * region. Reading it is how a fallback stops being a counter and becomes three
 * named cells with a stated reason.
 */
const READ_EXTERIOR_NOTICES = `(() => {
  const root = document.querySelector("[data-exterior-notices]");
  if (!root) return { present: false, items: [] };
  const items = [...root.querySelectorAll("li")].map((node) => (node.textContent || "").replace(/\\s+/gu, " ").trim()).filter((text) => text.length > 0);
  return { present: true, items, text: (root.textContent || "").replace(/\\s+/gu, " ").trim().slice(0, 4000) };
})()`;

const READ_SELECTION = `(() => {
  const panel = document.querySelector('[role="complementary"]');
  if (!panel) return null;
  const text = (panel.textContent || "").replace(/\\s+/gu, " ").trim();
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  return { length: text.length, digest: (hash >>> 0).toString(16), head: text.slice(0, 160) };
})()`;

/**
 * A building of wave `w02` that the serving release ships, taken from the
 * committed inventory rather than typed here, so a re-cut wave cannot leave this
 * instrument selecting a building that is no longer served.
 */
async function servedSelectionFeatureId() {
  const inventory = JSON.parse(await readFile(join(repositoryRoot, "data", SERVING_WAVE.servingReleaseId, "payload-inventory.json"), "utf8"));
  const glb = inventory.files.find((file) => file.path.startsWith("public/assets/") && file.path.endsWith("__lod_0.glb"));
  if (!glb) fail(`the committed inventory for ${SERVING_WAVE.servingReleaseId} declares no shipped asset.`);
  const slug = glb.path.slice("public/assets/".length, -"__lod_0.glb".length);
  return slug.replace("-", ":");
}

function selectionUrl(base, pose, releaseId, featureId) {
  const url = new URL(poseUrl(base, pose, releaseId));
  url.searchParams.set("feature", featureId);
  return url.toString();
}

/**
 * Pre-registered pass conditions for the DEFAULT-SESSION arm, written before the
 * capture was taken.
 *
 * Every one is a structural or byte statement about a six-wave session, not a
 * performance bar. That is deliberate: F1 exists because nobody had ever
 * OBSERVED the promoted composition — both prior captures named one wave with an
 * explicit `?exteriorCells=`, so six co-resident runtimes sharing one cache
 * under one global residency cap was the exact arrangement with no evidence.
 * What this asks is whether that arrangement holds together, not how fast it is.
 */
const DEFAULT_SESSION_GATES = {
  promotedWaveCount: 6,
  bootDocumentsPerWave: 3,
  maximumFailedCells: 0,
  maximumFallbackCells: 0,
  maximumFailedArtifacts: 0,
};

/**
 * The boot documents a session fetched, per release.
 *
 * `loadExteriorCellRuntime` fetches exactly three whole documents per release
 * before anything renders — `index.json`, `release-graph.json`, `assemblies.json`
 * — so a six-wave session boots on eighteen. Counting them from the CDP network
 * log rather than from the app's own accounting means a wave that silently
 * failed to boot shows up as a missing document rather than as a wave the app
 * declined to mention.
 */
function bootDocumentCounts(session) {
  const byRelease = new Map();
  for (const response of session.responses()) {
    const match = /\/data\/([^/]+)\/(index\.json|release-graph\.json|assemblies\.json)(?:\?|$)/u.exec(response.url);
    if (!match) continue;
    const entry = byRelease.get(match[1]) ?? new Set();
    entry.add(match[2]);
    byRelease.set(match[1], entry);
  }
  return [...byRelease.entries()]
    .map(([releaseId, documents]) => ({ releaseId, documentCount: documents.size, documents: [...documents].sort() }))
    .sort((left, right) => (left.releaseId < right.releaseId ? -1 : left.releaseId > right.releaseId ? 1 : 0));
}

async function runRoam(base, releaseSelector) {
  // The DEFAULT arm resolves whatever the promotion record says, which is the
  // whole point of it; the w02 arm names its wave. `captureArm` has taken a null
  // release selector since the frame A/B was written, and this is the same
  // switch one command over.
  const defaultSession = releaseSelector === "default";
  const browser = await launchChrome();
  const releaseId = defaultSession ? null : SERVING_WAVE.servingReleaseId;
  // The ROAM path is documented as being across `w02` cells only, so a default
  // session walks the four registered frame poses instead: an overview at the
  // outer band edge, the inner band edge, and two street poses in different
  // waves. A default session's question is co-residency across waves, and those
  // are the poses that cross a wave boundary.
  const poses = defaultSession ? POSES : ROAM;
  const featureId = await servedSelectionFeatureId();
  const { session, targetId } = await attach(selectionUrl(base, poses[0], releaseId, featureId));
  try {
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "serving exterior activation");
    if (defaultSession) return await captureDefaultSession(session, base, poses, featureId, browser);
    const stops = [];
    for (const pose of poses) {
      const landing = await landPose(session, selectionUrl(base, pose, releaseId, featureId), `roam:${pose.poseId}`);
      await wait(SETTLE_MS);
      const probe = await session.evaluate(READ_SCHEDULER_PROBE, `roam:${pose.poseId} probe`);
      const metrics = waveMetrics(probe, releaseId);
      const selection = await session.evaluate(READ_SELECTION, `roam:${pose.poseId} selection`);
      stops.push({
        poseId: pose.poseId,
        landing,
        decision: probe?.decision ?? null,
        metrics,
        selection,
      });
      console.log(`  roam ${pose.poseId} entries=${metrics?.cacheEntries} bytes=${metrics?.cachedBytes} evictions=${metrics?.cacheEvictions} peakConcurrent=${metrics?.peakConcurrentRequests} dispatches=${landing.dispatchCount}`);
    }
    const first = stops[0]?.metrics ?? null;
    const last = stops[stops.length - 1]?.metrics ?? null;
    const reEntry = stops[stops.length - 1];
    const record = {
      schemaVersion: "1.0",
      artifact: "serving-eviction-at-scale",
      capturedAt: new Date().toISOString(),
      browser,
      base,
      releaseId,
      armDisclosure: "This roam ran against the PROMOTED build, with the serving caps compiled into it, and named its wave with an explicit ?exteriorCells= so the reading is about ONE wave's cells rather than about six waves' interleaved residency. Because that wave is now a promoted default, the opt-in resolves the promoted record and the pin and identity gates run against it — which is a stronger arrangement than the pre-promotion opt-in this harness was written for, not a weaker one. What is NOT measured here is a six-wave session: a roam through the default set would exercise cross-wave residency, and that is a separate reading nobody has taken.",
      caps: { ...EXTERIOR_RUNTIME_BUDGETS },
      stops,
      findings: {
        evictionsObserved: (last?.cacheEvictions ?? 0) > 0,
        cacheEvictions: last?.cacheEvictions ?? null,
        peakConcurrentRequests: last?.peakConcurrentRequests ?? null,
        maxConcurrentRequests: last?.maxConcurrentRequests ?? null,
        requestBudgetRespected: (last?.peakConcurrentRequests ?? Number.POSITIVE_INFINITY) <= (last?.maxConcurrentRequests ?? 0),
        entriesWithinCap: (last?.cacheEntries ?? Number.POSITIVE_INFINITY) <= (last?.maxCacheEntries ?? 0),
        bytesWithinCap: (last?.cachedBytes ?? Number.POSITIVE_INFINITY) <= (last?.maxCachedBytes ?? 0),
        failedArtifactCount: last?.failedArtifactCount ?? null,
        failedCellCount: last?.failedCellCount ?? null,
        reEntryPoseId: reEntry?.poseId ?? null,
        firstVisitEntries: first?.cacheEntries ?? null,
        reEntryEntries: reEntry?.metrics?.cacheEntries ?? null,
        selectionFeatureId: featureId,
        selectionDigestFirstVisit: stops[0]?.selection?.digest ?? null,
        selectionDigestAfterReEntry: reEntry?.selection?.digest ?? null,
        selectionStableAcrossEviction: (stops[0]?.selection?.digest ?? null) !== null && (stops[0]?.selection?.digest ?? null) === (reEntry?.selection?.digest ?? null),
      },
      uncapturedGap: "A CANVAS PICK on the re-admitted mesh was not captured. The selection above is reached through a ?feature= deep link against the canonical base identity set, so it shows the same building resolving to the same sourced information across an eviction cycle; it does not show that a mouse click on the re-admitted geometry returns that identity. That is a real gap and is named rather than approximated.",
      claim: "A roam across wave w02's full-population cells at the serving caps. It states that eviction actually happens at this scale, that the shared request budget is never exceeded, that neither cache cap is breached, and that a cell re-entered after eviction verifies and renders again with zero failed artifacts — every re-admitted byte is re-verified against the same declared size and SHA-256, so a successful re-entry IS a byte-identical re-entry. It is not a frame-time reading and makes no visual claim.",
    };
    const ok = record.findings.evictionsObserved && record.findings.requestBudgetRespected && record.findings.entriesWithinCap && record.findings.bytesWithinCap && record.findings.failedArtifactCount === 0 && record.findings.failedCellCount === 0 && record.findings.selectionStableAcrossEviction;
    record.ok = ok;
    await writeEvidence("eviction-at-scale", record);
    console.log(serialize({ ok, ...record.findings }));
    if (!ok) process.exitCode = 1;
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
    await killChrome();
  }
}

/**
 * The SIX-WAVE DEFAULT SESSION, observed once on the promoted build.
 *
 * ## Why the session-wide numbers are read from one wave and never summed
 *
 * `cacheEntries`, `cachedBytes`, `cacheEvictions` and the request counters read
 * the ONE shared exterior cache that every promoted wave writes into.
 * `exterior-cell-runtime.ts` says so in as many words. Summing them across six
 * waves would multiply one pool by six, which is exactly the error that would
 * make a 92%-full byte cap look like a 550%-full one. They are taken from the
 * first wave that reports metrics; the per-wave columns beside them are the ones
 * that really are per wave.
 *
 * ## What it does NOT do
 *
 * It takes no frame timings and makes no visual claim. It is the missing
 * OBSERVATION that the promoted arrangement resolves, boots, schedules and stays
 * inside its budgets — the thing both single-wave captures could not say.
 */
async function captureDefaultSession(session, base, poses, featureId, browser) {
  const stops = [];
  for (const pose of poses) {
    const landing = await landPose(session, selectionUrl(base, pose, null, featureId), `default:${pose.poseId}`);
    await wait(SETTLE_MS);
    const probe = await session.evaluate(READ_SCHEDULER_PROBE, `default:${pose.poseId} probe`);
    const waves = (probe?.waves ?? []).map((wave) => ({
      releaseId: wave.releaseId,
      declaredCellCount: wave.declaredCellCount,
      scheduledCellCount: wave.metrics?.scheduledCellCount ?? null,
      deferredCellCount: wave.metrics?.deferredCellCount ?? null,
      notShippedCellCount: wave.metrics?.notShippedCellCount ?? null,
      fallbackCellCount: wave.metrics?.fallbackCellCount ?? null,
      failedCellCount: wave.metrics?.failedCellCount ?? null,
      failedArtifactCount: wave.metrics?.failedArtifactCount ?? null,
    }));
    // SESSION-WIDE, taken once. See the docblock.
    const shared = (probe?.waves ?? []).find((wave) => wave.metrics)?.metrics ?? null;
    stops.push({
      poseId: pose.poseId,
      role: pose.role ?? null,
      landing,
      decision: probe?.decision ?? null,
      waves,
      sharedCache: shared === null ? null : {
        cacheEntries: shared.cacheEntries,
        cachedBytes: shared.cachedBytes,
        cacheEvictions: shared.cacheEvictions,
        maxCacheEntries: shared.maxCacheEntries,
        maxCachedBytes: shared.maxCachedBytes,
        activeRequests: shared.activeRequests,
        peakConcurrentRequests: shared.peakConcurrentRequests,
        maxConcurrentRequests: shared.maxConcurrentRequests,
        requestedArtifactCount: shared.requestedArtifactCount,
        loadedArtifactCount: shared.loadedArtifactCount,
        releasedArtifactCount: shared.releasedArtifactCount,
        releasedArtifactBytes: shared.releasedArtifactBytes,
      },
    });
    const notices = await session.evaluate(READ_EXTERIOR_NOTICES, `default:${pose.poseId} notices`);
    stops[stops.length - 1].notices = notices;
    console.log(`  default ${pose.poseId} waves=${waves.length} scheduled=[${waves.map((wave) => wave.scheduledCellCount).join(",")}] entries=${shared?.cacheEntries} bytes=${shared?.cachedBytes} evictions=${shared?.cacheEvictions} peak=${shared?.peakConcurrentRequests} dispatches=${landing.dispatchCount} fallback=${waves.reduce((total, wave) => total + (wave.fallbackCellCount ?? 0), 0)}`);
    for (const item of notices.items ?? []) if (/failed verification/u.test(item)) console.log(`    NOTICE ${item.slice(0, 300)}`);
  }

  const networkFailures = session.failedRequests();
  for (const failure of networkFailures) console.log(`    NETWORK ${failure.kind} ${failure.status ?? failure.errorText} ${failure.url}`);
  const boot = bootDocumentCounts(session);
  const last = stops[stops.length - 1] ?? null;
  const shared = last?.sharedCache ?? null;
  const everyWave = stops.flatMap((stop) => stop.waves);
  const promotedBoot = boot.filter((entry) => entry.releaseId.endsWith("-s1"));
  const findings = {
    promotedWaveCount: last?.waves.length ?? 0,
    promotedWaveIds: (last?.waves ?? []).map((wave) => wave.releaseId).sort(),
    allSixWavesResolved: (last?.waves.length ?? 0) === DEFAULT_SESSION_GATES.promotedWaveCount,
    bootReleases: promotedBoot,
    bootDocumentTotal: promotedBoot.reduce((total, entry) => total + entry.documentCount, 0),
    bootDocumentsComplete: promotedBoot.length === DEFAULT_SESSION_GATES.promotedWaveCount
      && promotedBoot.every((entry) => entry.documentCount === DEFAULT_SESSION_GATES.bootDocumentsPerWave),
    declaredCellTotal: (last?.waves ?? []).reduce((total, wave) => total + (wave.declaredCellCount ?? 0), 0),
    scheduledCellsByPose: stops.map((stop) => ({ poseId: stop.poseId, byWave: stop.waves.map((wave) => ({ releaseId: wave.releaseId, scheduledCellCount: wave.scheduledCellCount })), total: stop.waves.reduce((total, wave) => total + (wave.scheduledCellCount ?? 0), 0) })),
    maxScheduledCellsAtAnyPose: Math.max(...stops.map((stop) => stop.waves.reduce((total, wave) => total + (wave.scheduledCellCount ?? 0), 0))),
    failedCellCount: everyWave.reduce((total, wave) => total + (wave.failedCellCount ?? 0), 0),
    fallbackCellCount: everyWave.reduce((total, wave) => total + (wave.fallbackCellCount ?? 0), 0),
    failedArtifactCount: everyWave.reduce((total, wave) => total + (wave.failedArtifactCount ?? 0), 0),
    cacheEntries: shared?.cacheEntries ?? null,
    cachedBytes: shared?.cachedBytes ?? null,
    cacheEvictions: shared?.cacheEvictions ?? null,
    peakConcurrentRequests: shared?.peakConcurrentRequests ?? null,
    maxConcurrentRequests: shared?.maxConcurrentRequests ?? null,
    entriesWithinCap: (shared?.cacheEntries ?? Number.POSITIVE_INFINITY) <= (shared?.maxCacheEntries ?? 0),
    bytesWithinCap: (shared?.cachedBytes ?? Number.POSITIVE_INFINITY) <= (shared?.maxCachedBytes ?? 0),
    requestBudgetRespected: (shared?.peakConcurrentRequests ?? Number.POSITIVE_INFINITY) <= (shared?.maxConcurrentRequests ?? 0),
    everyPoseLanded: stops.every((stop) => stop.landing.footprintSignature !== null),
    dispatchCounts: stops.map((stop) => stop.landing.dispatchCount),
    // The diagnosis columns: what the app SAID failed, and what the network did.
    fallbackNotices: [...new Set(stops.flatMap((stop) => (stop.notices?.items ?? []).filter((item) => /failed verification/u.test(item))))],
    networkFailures,
    networkFailureCount: networkFailures.length,
  };
  const record = {
    schemaVersion: "1.0",
    artifact: "serving-default-session-residency",
    capturedAt: new Date().toISOString(),
    browser,
    base,
    releaseSelector: "default",
    gates: DEFAULT_SESSION_GATES,
    caps: { ...EXTERIOR_RUNTIME_BUDGETS },
    armDisclosure: "The PROMOTED DEFAULT COMPOSITION, observed once, with no ?exteriorCells= parameter: six co-resident wave runtimes sharing one exterior cache under one global residency cap. It exists because the frame A/B and the eviction roam both named a single wave explicitly, so the arrangement this build actually ships had no browser evidence at all. Session-wide cache figures are read from ONE wave and never summed, because they read one shared pool; the per-wave columns are the ones that really are per wave.",
    stops,
    findings,
    uncapturedGap: "NO FRAME TIMING AND NO VISUAL CLAIM. This says the promoted arrangement resolves, boots, schedules and stays inside its budgets at four poses. It does not say how it looks or how fast it is, and it is one session rather than a distribution.",
    claim: "A six-wave default session on the promoted build. It states that every promoted wave resolves and boots its three documents, that the scheduler admits cells across waves without any cell failing or falling back, and that the one shared cache stays inside both caps and inside the request budget.",
  };
  record.ok = findings.allSixWavesResolved
    && findings.bootDocumentsComplete
    && findings.failedCellCount <= DEFAULT_SESSION_GATES.maximumFailedCells
    && findings.fallbackCellCount <= DEFAULT_SESSION_GATES.maximumFallbackCells
    && findings.failedArtifactCount <= DEFAULT_SESSION_GATES.maximumFailedArtifacts
    && findings.entriesWithinCap
    && findings.bytesWithinCap
    && findings.requestBudgetRespected
    && findings.everyPoseLanded;
  await writeEvidence("default-session-residency", record);
  console.log(serialize({ ok: record.ok, ...findings }));
  if (!record.ok) process.exitCode = 1;
  return record;
}

async function writeEvidence(name, record) {
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(join(evidenceRoot, `${name}.json`), serialize(record));
  await writeFile(join(evidenceRoot, `${name}.sha256`), `${sha256HexSync(serialize(record))}  ${name}.json\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const base = argValue(argv, "--base", "http://127.0.0.1:4173/");
  const command = argv.find((token) => !token.startsWith("--"));
  if (command === "frames") await runFrames(base);
  else if (command === "frames-arm") await runFrameArm(base, argValue(argv, "--arm", ""), argValue(argv, "--build", ""));
  else if (command === "frames-compose") await composeFrames();
  else if (command === "roam") await runRoam(base, argValue(argv, "--release", ""));
  else {
    console.error("usage: exterior-serving-evidence-cli.mjs <frames|frames-arm|frames-compose|roam> [--base=http://127.0.0.1:4173/] [--arm=a|b] [--build=<label>] [--release=default]");
    console.error("roam --release=default captures the SIX-WAVE PROMOTED DEFAULT session over the registered frame poses; without it, the w02 opt-in roam.");
    console.error(`The scratch Chrome is launched and killed by this file: ${CHROME_LAUNCH_COMMAND}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (error) => { await killChrome(); console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
