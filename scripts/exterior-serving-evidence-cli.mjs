/* global console, process, fetch, WebSocket, URL, setTimeout, clearTimeout, Buffer */
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

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { exteriorServingFrameVerdict, framePercentile } from "../src/runtime/exterior-serving-frame-bar.ts";
import { EXTERIOR_SERVING_EVIDENCE_ID, exteriorServingWave } from "../src/release/exterior-serving-waves.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";
import { predictedTextureByteLength, validateGpuTextureProbe } from "../src/features/explorer/gpu-texture-probe.ts";
import {
  BLOCK_835_CAMERA,
  BLOCK_835_V3_RELEASE_ID,
  CACHE_CEILINGS,
  CAMPAIGN_DISCIPLINE,
  CAMPAIGN_EVIDENCE_ID,
  EVICTION_GATES,
  EVICTION_LOOP,
  EXPECTED_TEXTURE_BYTE_LENGTH,
  EXPECTED_UNIQUE_TILE_COUNT,
  FRAME_F1,
  FRAME_F2,
  FRAME_F4,
  GPU_GATES,
  HEADROOM_H1,
  HEADROOM_H2,
  LOD_L1,
  REQUEST_CEILINGS,
  STATIONS,
  STORM_S1,
  STORM_TRANSLATIONS,
  STORM_ZOOM_EXCURSIONS,
  TEXTURE_TOLERANCE_TILES,
} from "./exterior-acceptance-campaign-constants.mjs";

const run = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The dated evidence root every command writes under.
 *
 * MUTABLE, and it has to be. This instrument's historical root
 * (`data/exterior-serving-20260817/`) holds the T005 records the T006 campaign
 * COMPARES ITSELF AGAINST — `eviction-at-scale.json` is the byte-identical
 * baseline gate E-1a is defined against, and overwriting it would delete the
 * thing the new reading is a reading against. `--out=` moves the write target
 * to the campaign's own dated root; the default is unchanged, so every command
 * that existed before this flag behaves exactly as it did.
 */
let evidenceRoot = join(repositoryRoot, "data", EXTERIOR_SERVING_EVIDENCE_ID);

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
const BASE_CHROME_FLAGS = [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${USER_DATA_DIR}`,
  "--no-first-run",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];
/**
 * H1's UNCAPPING FLAGS, and the reason they are a separate arm rather than a
 * default.
 *
 * `--disable-gpu-vsync --disable-frame-rate-limit` let the renderer present as
 * fast as it can, which is the only way to ask what the scene costs when the
 * display is not the answer. It is NOT what a user sees, so the arm they select
 * is registered non-gating (HEADROOM_H1) and no frame criterion may be
 * discharged from it. The flags are named in every record captured under them.
 */
const VSYNC_OFF_FLAGS = HEADROOM_H1.launchFlags;
/** `vsync-on` (the shipped default) or `vsync-off` (the H1 arm). */
let vsyncMode = "vsync-on";
function chromeFlags() {
  return vsyncMode === "vsync-off" ? [...BASE_CHROME_FLAGS, ...VSYNC_OFF_FLAGS] : [...BASE_CHROME_FLAGS];
}
function chromeLaunchCommand() {
  return `open -na "Google Chrome" --args ${chromeFlags().join(" ")}`;
}
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
  /** A rendered still, as PNG bytes. What-is-drawn evidence for AC #8. */
  async screenshot(what = "still") {
    const shot = await withTimeout(this.send("Page.captureScreenshot", { format: "png" }), EVALUATE_TIMEOUT_MS, what);
    return Buffer.from(shot.data, "base64");
  }

  /**
   * H2: `Performance.getMetrics`, as a flat name -> value map.
   *
   * These are RENDERER-PROCESS COUNTERS, not a GPU query, and the campaign
   * records DELTAS across a frame window rather than absolutes so a reader sees
   * the work attributable to the window instead of the session's whole history.
   * They are never reconciled into the rAF series; they are a second,
   * independent view of the same window.
   */
  async metrics() {
    const result = await withTimeout(this.send("Performance.getMetrics"), EVALUATE_TIMEOUT_MS, "Performance.getMetrics");
    return Object.fromEntries((result.metrics ?? []).map((metric) => [metric.name, metric.value]));
  }

  close() { try { this.socket.close(); } catch { /* already gone */ } }
}

/** `after - before`, over the union of both keys. Absolutes are never quoted. */
function metricsDelta(before, after) {
  const names = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  return Object.fromEntries(names.map((name) => [name, Number((((after?.[name] ?? 0) - (before?.[name] ?? 0))).toFixed(6))]));
}

async function attach(initialUrl) {
  const listResponse = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(initialUrl)}`, { method: "PUT" }).catch(() => null);
  if (!listResponse?.ok) fail(`could not open a tab on debugging port ${PORT}; the scratch Chrome did not come up. Launch line: ${chromeLaunchCommand()}`);
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
  // H2. Enabled unconditionally: the domain only starts an accounting feed, it
  // changes nothing about what is rendered, and a command that does not read it
  // simply never calls `metrics()`.
  await session.send("Performance.enable").catch(() => null);
  await session.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });
  await session.send("Page.bringToFront").catch(() => null);
  return { session, targetId: target.id };
}

async function launchChrome() {
  await run("/bin/sh", ["-c", chromeLaunchCommand()]);
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
    // F4's two numbers ride on the dense telemetry the app already publishes
    // here. Added as a passthrough field: nothing that read this probe before
    // reads it by shape, and no existing column moves.
    denseMetrics: probe.denseMetrics || null,
    waves: (probe.waves || []).map((wave) => ({ releaseId: wave.releaseId, declaredCellCount: wave.declaredCellCount, metrics: wave.metrics })),
  };
})()`;

/**
 * The T002 GPU texture probe, read as an ATTRIBUTE payload rather than scraped.
 *
 * `reading.texturesByteLength` is Cesium's own CPU-side accounting WITH the mip
 * chain, not a driver query — 87,381 bytes per 128x128 RGBA tile, which ADR 0047
 * established by measurement. G1 validates that arithmetic against a scene whose
 * unique tile count is known BEFORE G2-G4 quote it on the six-wave composition.
 */
const READ_TEXTURE_PROBE = `(() => {
  const node = document.querySelector("[data-exterior-texture-probe]");
  if (!node) return null;
  const probe = JSON.parse(node.textContent);
  return {
    cesiumVersion: probe.cesiumVersion,
    exteriorReleaseIds: probe.exteriorReleaseIds,
    exteriorStreamingActive: probe.exteriorStreamingActive,
    residentAssetCount: probe.residentAssetCount,
    reading: probe.reading,
  };
})()`;

/** Every dense build the citywide probe retained: F4's doubleDraw timeline. */
const READ_DENSE_SAMPLES = `(() => {
  const node = document.querySelector("[data-citywide-overview-probe]");
  if (!node) return [];
  return (JSON.parse(node.textContent).denseSamples || []).map((sample) => ({
    planFingerprint: sample.planFingerprint || null,
    totalBuildMs: sample.totalBuildMs === undefined ? null : sample.totalBuildMs,
    doubleDrawMs: sample.doubleDrawMs === undefined ? null : sample.doubleDrawMs,
    allocationMs: sample.allocationMs === undefined ? null : sample.allocationMs,
    planBuildCount: sample.planBuildCount === undefined ? null : sample.planBuildCount,
    buildingFeatureCount: sample.buildingFeatureCount === undefined ? null : sample.buildingFeatureCount,
  }));
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
      harnessDisclosure: `Both arms ran in ONE scratch Chrome (${chromeLaunchCommand()}), one document per arm, at the identical four poses in the identical order, with ${SETTLE_MS} ms of settle before each ${FRAME_SAMPLE_MS} ms frame sample. The bundle carries VITE_EXTERIOR_SCHEDULER_PROBE=1 because the residency and cache columns are read out of that probe's DOM payload; the probe reads state the app already holds and decides nothing. Frame durations are requestAnimationFrame deltas — the browser's own presentation cadence, the same instrument in both arms — and the first delta of each sample is dropped because it spans the gap since the previous paint rather than a rendered frame.`,
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
      harnessDisclosure: `ONE arm of the pre-registered A/B, captured against build "${buildLabel}" in its own scratch Chrome (${chromeLaunchCommand()}), at the four registered poses in the registered order, with ${SETTLE_MS} ms of settle before each ${FRAME_SAMPLE_MS} ms frame sample. The bundle carries VITE_EXTERIOR_SCHEDULER_PROBE=1 because the residency and cache columns are read out of that probe's DOM payload; the probe reads state the app already holds and decides nothing. Frame durations are requestAnimationFrame deltas — the browser's own presentation cadence — and the first delta of each sample is dropped because it spans the gap since the previous paint rather than a rendered frame. The caps above are the ones COMPILED INTO THIS BUILD, which is the whole reason the arms are captured separately.`,
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

/**
 * INSTRUMENT DEFECT, FIXED AND DISCLOSED rather than quietly corrected.
 *
 * The selector used to be `[role="complementary"]`, and it matched NOTHING. The
 * details panel is `<aside class="inspector" aria-label="Selected feature
 * details">`, and an `<aside>` carries the complementary role IMPLICITLY — it
 * has no `role` ATTRIBUTE, so a CSS attribute selector cannot see it. The
 * consequence is on the record: T005's eviction capture wrote
 * `selectionDigestFirstVisit: null`, `selectionDigestAfterReEntry: null` and
 * `selectionStableAcrossEviction: false`. That was the instrument reading
 * nothing, not the app losing a selection.
 *
 * It also shows why E-1e's bar is EQUAL **and BOTH NON-NULL**: two nulls are
 * equal, so an equality-only rule would have been silently satisfied by exactly
 * this defect. The pre-registration fixed the selector in words before this line
 * was changed; this is that change.
 */
const READ_SELECTION = `(() => {
  const panel = document.querySelector('aside.inspector[aria-label="Selected feature details"]');
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

// ===========================================================================
// THE T006 ACCEPTANCE CAMPAIGN
//
// Every bar, station, storm step and pose below is IMPORTED from
// `exterior-acceptance-campaign-constants.mjs`, which was committed in a
// pre-registration commit containing no capture at all. Nothing in this section
// chooses a constant; it takes readings and compares them to constants it
// cannot edit without breaking a committed pinning test.
// ===========================================================================

/** Percentiles through the SHIPPED formula, never a second implementation. */
function frameStats(frameMs) {
  if (!Array.isArray(frameMs) || frameMs.length === 0) return { sampleCount: 0, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null };
  return {
    sampleCount: frameMs.length,
    p50Ms: Number(framePercentile(frameMs, 50).toFixed(3)),
    p95Ms: Number(framePercentile(frameMs, 95).toFixed(3)),
    p99Ms: Number(framePercentile(frameMs, 99).toFixed(3)),
    maxMs: Number(Math.max(...frameMs).toFixed(3)),
  };
}

/**
 * THE SERVED-BUNDLE PRE-FLIGHT, and why it checks two different things.
 *
 * 1. The served `index.html` must be byte-identical to this worktree's
 *    `dist/index.html`, so every reading below is from THIS build rather than
 *    from whatever was last left in a preview server.
 * 2. The served entry scripts must CONTAIN all three probe markers. This is the
 *    limb that matters for T006 specifically: the campaign reads residency out
 *    of the scheduler probe, dense telemetry out of the citywide probe and GPU
 *    texture bytes out of the texture probe, and all three are tree-shaken out
 *    of an ordinary build. A capture run against a probe-less bundle does not
 *    fail loudly — it silently reads `null` everywhere and produces a record
 *    full of absences. Reading the marker out of the SERVED BYTES is the only
 *    check that cannot be satisfied by an environment variable that was set in
 *    the wrong shell.
 *
 * Both limbs FAIL CLOSED: a mismatch aborts before Chrome is launched.
 */
const PROBE_MARKERS = {
  scheduler: "data-exterior-scheduler-probe",
  citywideOverview: "data-citywide-overview-probe",
  texture: "data-exterior-texture-probe",
};

async function servedBundlePreflight(base) {
  const index = await (await fetch(base)).text();
  const localIndex = await readFile(join(repositoryRoot, "dist", "index.html"), "utf8");
  const scripts = [...index.matchAll(/src="([^"]+\.js)"/gu)].map((match) => match[1]);
  const assets = [];
  const markersSeen = { scheduler: false, citywideOverview: false, texture: false };
  for (const relative of scripts) {
    const bytes = new Uint8Array(await (await fetch(new URL(relative, base))).arrayBuffer());
    const text = Buffer.from(bytes).toString("utf8");
    for (const [key, marker] of Object.entries(PROBE_MARKERS)) if (text.includes(marker)) markersSeen[key] = true;
    assets.push({ ref: relative, byteSize: bytes.byteLength, sha256: sha256HexBytes(bytes) });
  }
  const record = {
    previewBase: base,
    indexHtmlChecksumSha256: sha256HexSync(index),
    localDistIndexHtmlChecksumSha256: sha256HexSync(localIndex),
    matchesLocalDist: sha256HexSync(index) === sha256HexSync(localIndex),
    entryScriptCount: assets.length,
    assets,
    probeMarkers: PROBE_MARKERS,
    probeMarkersPresent: markersSeen,
    probeBuildCommand: "VITE_EXTERIOR_SCHEDULER_PROBE=1 VITE_CITYWIDE_OVERVIEW_PROBE=1 VITE_EXTERIOR_TEXTURE_PROBE=1 pnpm build",
    statement: "Checked BEFORE Chrome is launched, and fail-closed on both limbs: the served index.html is byte-identical to this worktree's dist/index.html, and the served entry scripts literally contain all three probe attribute markers. The second limb exists because a probe-less bundle does not fail loudly; it reads null and produces a record full of absences.",
  };
  if (!record.matchesLocalDist) fail("pre-flight: the served index.html does not match this worktree's dist/index.html; the capture would not be about this build.");
  const missing = Object.entries(markersSeen).filter(([, present]) => !present).map(([key]) => PROBE_MARKERS[key]);
  if (missing.length > 0) fail(`pre-flight: the served bundle carries no ${missing.join(", ")} marker; rebuild with ${record.probeBuildCommand}`);
  return record;
}

/** The campaign's URL builder: pose, plus the opt-ins a gate needs. */
function campaignUrl(base, pose, options = {}) {
  const url = new URL(poseUrl(base, pose, options.releaseId ?? null));
  if (options.featureId) url.searchParams.set("feature", options.featureId);
  if (options.profile) url.searchParams.set("exteriorProfile", options.profile);
  if (options.streaming === false) url.searchParams.set("exteriorStreaming", "off");
  return url.toString();
}

/**
 * SESSION-WIDE cache and request figures, read from ONE wave and NEVER summed.
 *
 * `exterior-cell-runtime.ts` writes the same shared-pool totals onto every live
 * runtime's metrics. At six promoted waves, summing them would multiply one pool
 * by six and turn a 92%-full byte cap into a 550%-full one.
 */
function sharedCacheOf(probe) {
  const wave = (probe?.waves ?? []).find((entry) => entry.metrics);
  const metrics = wave?.metrics ?? null;
  if (!metrics) return null;
  return {
    cacheEntries: metrics.cacheEntries,
    cachedBytes: metrics.cachedBytes,
    cacheEvictions: metrics.cacheEvictions,
    maxCacheEntries: metrics.maxCacheEntries,
    maxCachedBytes: metrics.maxCachedBytes,
    activeRequests: metrics.activeRequests,
    peakConcurrentRequests: metrics.peakConcurrentRequests,
    maxConcurrentRequests: metrics.maxConcurrentRequests,
    requestedArtifactCount: metrics.requestedArtifactCount,
    loadedArtifactCount: metrics.loadedArtifactCount,
    releasedArtifactCount: metrics.releasedArtifactCount,
    releasedArtifactBytes: metrics.releasedArtifactBytes,
    readFrom: wave.releaseId,
    note: "SESSION-WIDE fields read from ONE wave and never summed across waves; see exterior-cell-runtime.ts.",
  };
}

/** Per-wave columns that really are per wave. */
function waveColumns(probe) {
  return (probe?.waves ?? []).map((wave) => ({
    releaseId: wave.releaseId,
    declaredCellCount: wave.declaredCellCount,
    scheduledCellCount: wave.metrics?.scheduledCellCount ?? null,
    deferredCellCount: wave.metrics?.deferredCellCount ?? null,
    notShippedCellCount: wave.metrics?.notShippedCellCount ?? null,
    fallbackCellCount: wave.metrics?.fallbackCellCount ?? null,
    failedCellCount: wave.metrics?.failedCellCount ?? null,
    failedArtifactCount: wave.metrics?.failedArtifactCount ?? null,
  }));
}

function residentWaveCount(probe) {
  return waveColumns(probe).filter((wave) => (wave.scheduledCellCount ?? 0) > 0).length;
}

/**
 * Distinct shared-class tile URLs the DOCUMENT actually fetched, taken from the
 * CDP network log rather than from `performance.getEntriesByType("resource")`.
 *
 * The page-side resource buffer is capped at 250 entries by default and a
 * six-wave session blows straight past it, so a page-side count would silently
 * truncate. The CDP log is complete.
 */
function classTileUrls(session) {
  return [...new Set(session.responses()
    .map((response) => response.url)
    .filter((url) => url.split("?")[0].endsWith(".png") && url.includes("/public/textures/")))].sort();
}

function externalHostsOf(session, base) {
  const origin = new URL(base).host;
  return [...new Set(session.responses().map((response) => {
    try { return new URL(response.url).host; } catch { return ""; }
  }).filter((host) => host && host !== origin))].sort();
}

/**
 * T008 CHROME DISCIPLINE, as a READING rather than a claim.
 *
 * `killChrome` already returns how many scratch processes survived the kill.
 * This appends that number, per session, to one committed file, so "cleaned up"
 * is something a reader can check instead of something the campaign asserts. A
 * non-zero count is recorded, not hidden.
 */
async function recordCleanup(sessionName, survivingChromeProcessCount) {
  await mkdir(evidenceRoot, { recursive: true });
  const path = join(evidenceRoot, "chrome-cleanup.json");
  const existing = await readFile(path, "utf8").then((text) => JSON.parse(text)).catch(() => ({
    schemaVersion: "1.0",
    recordId: `${CAMPAIGN_EVIDENCE_ID}:chrome-cleanup`,
    task: "T006",
    artifact: "chrome-cleanup",
    userDataDir: USER_DATA_DIR,
    rule: CAMPAIGN_DISCIPLINE.chromeDiscipline,
    statement: "One row per capture session, appended by the instrument at the moment it killed its own scratch Chrome. pgrep is run AFTER the kill and its line count is the number recorded; zero is the only clean value and a non-zero value is recorded rather than retried away.",
    sessions: [],
  }));
  existing.sessions.push({ session: sessionName, at: new Date().toISOString(), vsyncMode, survivingChromeProcessCount });
  await writeFile(path, serialize(existing));
  await writeFile(join(evidenceRoot, "chrome-cleanup.sha256"), `${sha256HexSync(serialize(existing))}  chrome-cleanup.json\n`);
  return survivingChromeProcessCount;
}

async function writeCapture(name, bytes) {
  await mkdir(join(evidenceRoot, "captures"), { recursive: true });
  await writeFile(join(evidenceRoot, "captures", `${name}.png`), bytes);
  return { file: `captures/${name}.png`, byteSize: bytes.byteLength, sha256: sha256HexBytes(new Uint8Array(bytes)) };
}

/**
 * The F2 CONTROL: `about:blank`, in the SAME browser as the stations.
 *
 * A p95 frame time is not a property of the scene unless the instrument's own
 * floor is known, and on a vsync-capped display the floor IS the display. An
 * empty document renders nothing, so whatever cadence it reports is the
 * instrument. A station p95 at or below this number is instrument-limited and is
 * reported as such, never as a scene result.
 */
async function captureControl(session, label) {
  await session.evaluate("void 0", `${label} control reachable`);
  const frameMs = await session.evaluate(sampleFramesExpression(FRAME_F1.windowMs), `${label} control frames`);
  return { url: FRAME_F2.controlUrl, vsyncMode, ...frameStats(frameMs) };
}

async function withControlTab(base, label) {
  const { session, targetId } = await attach(FRAME_F2.controlUrl);
  try {
    return await captureControl(session, label);
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
    void base;
  }
}

/**
 * ONE STATION: land, settle, then read everything the campaign needs from the
 * one window, so the frame series, the residency, the GPU bytes and the CDP
 * counters all describe the SAME 12 seconds rather than four adjacent moments.
 */
async function captureStation(session, base, station, options = {}) {
  const url = campaignUrl(base, station, options);
  const landing = await landPose(session, url, `station:${station.stationId}`);
  await wait(FRAME_F1.settleMs);
  const probeBefore = await session.evaluate(READ_SCHEDULER_PROBE, `${station.stationId} probe`);
  const metricsBefore = await session.metrics();
  const frameMs = await session.evaluate(sampleFramesExpression(FRAME_F1.windowMs), `${station.stationId} frames`);
  const metricsAfter = await session.metrics();
  const probeAfter = await session.evaluate(READ_SCHEDULER_PROBE, `${station.stationId} probe after window`);
  const texture = await session.evaluate(READ_TEXTURE_PROBE, `${station.stationId} texture probe`);
  const notices = await session.evaluate(READ_EXTERIOR_NOTICES, `${station.stationId} notices`);
  const denseSamples = await session.evaluate(READ_DENSE_SAMPLES, `${station.stationId} dense samples`);
  const still = await session.screenshot(`${station.stationId} still`);
  const capture = await writeCapture(`${options.captureName ?? station.stationId}`, still);
  return {
    stationId: station.stationId,
    role: station.role ?? null,
    pose: { lon: station.lon, lat: station.lat, height: station.height, heading: station.heading, pitch: station.pitch, roll: station.roll },
    url,
    landing,
    settleMs: FRAME_F1.settleMs,
    windowMs: FRAME_F1.windowMs,
    frame: frameStats(frameMs),
    frameMsHead: frameMs.slice(0, 8).map((value) => Number(value.toFixed(3))),
    decision: probeAfter?.decision ?? null,
    waves: waveColumns(probeAfter),
    residentWaveCount: residentWaveCount(probeAfter),
    sharedCache: sharedCacheOf(probeAfter),
    sharedCacheBeforeWindow: sharedCacheOf(probeBefore),
    texture,
    classTileUrlCount: classTileUrls(session).length,
    denseMetrics: probeAfter?.denseMetrics ?? null,
    denseSampleCount: denseSamples.length,
    denseSamplesWithDoubleDraw: denseSamples.filter((sample) => typeof sample.doubleDrawMs === "number"),
    performanceMetricsDelta: metricsDelta(metricsBefore, metricsAfter),
    notices,
    still: capture,
  };
}

/** The F1 verdict for one station, against constants this file cannot edit. */
function frameVerdictFor(station, control) {
  const p50 = station.frame.p50Ms;
  const p95 = station.frame.p95Ms;
  const enoughFrames = station.frame.sampleCount >= FRAME_F1.minimumFrames;
  return {
    stationId: station.stationId,
    p50Ms: p50,
    p95Ms: p95,
    sampleCount: station.frame.sampleCount,
    minimumFrames: FRAME_F1.minimumFrames,
    frameFloorMet: enoughFrames,
    p50WithinBar: p50 !== null && p50 <= FRAME_F1.p50Ms,
    p95WithinBar: p95 !== null && p95 <= FRAME_F1.p95Ms,
    pass: enoughFrames && p50 !== null && p95 !== null && p50 <= FRAME_F1.p50Ms && p95 <= FRAME_F1.p95Ms,
    controlP95Ms: control?.p95Ms ?? null,
    // F2 is a rule about what may be CONCLUDED, not a bar something passes.
    instrumentLimited: control?.p95Ms !== null && control?.p95Ms !== undefined && p95 !== null && p95 <= control.p95Ms,
    interpretation: FRAME_F2.rule,
  };
}

function ceilingVerdictFor(sharedCache) {
  return {
    peakConcurrentRequests: sharedCache?.peakConcurrentRequests ?? null,
    peakWithinFour: (sharedCache?.peakConcurrentRequests ?? Number.POSITIVE_INFINITY) <= REQUEST_CEILINGS.appWideSharedSemaphoreMaxConcurrent,
    cacheEntries: sharedCache?.cacheEntries ?? null,
    entriesWithinCap: (sharedCache?.cacheEntries ?? Number.POSITIVE_INFINITY) <= CACHE_CEILINGS.maxCacheEntries,
    cachedBytes: sharedCache?.cachedBytes ?? null,
    bytesWithinCap: (sharedCache?.cachedBytes ?? Number.POSITIVE_INFINITY) <= CACHE_CEILINGS.maxCachedBytes,
    neverSum: REQUEST_CEILINGS.neverSum,
  };
}

function cleanCellVerdictFor(waves) {
  const total = (key) => waves.reduce((sum, wave) => sum + (wave[key] ?? 0), 0);
  return {
    fallbackCellCount: total("fallbackCellCount"),
    failedCellCount: total("failedCellCount"),
    failedArtifactCount: total("failedArtifactCount"),
    clean: total("fallbackCellCount") === 0 && total("failedCellCount") === 0 && total("failedArtifactCount") === 0,
  };
}

/** Common record furniture, so every campaign record carries the same spine. */
function campaignEnvelope(name, options) {
  return {
    schemaVersion: "1.0",
    recordId: `${CAMPAIGN_EVIDENCE_ID}:${name}`,
    task: "T006",
    artifact: name,
    capturedAt: new Date().toISOString(),
    attemptCount: options.attemptCount,
    attemptPolicy: CAMPAIGN_DISCIPLINE.attemptPolicy,
    vsyncMode: options.vsyncMode ?? vsyncMode,
    chromeLaunchCommand: options.chromeLaunchCommand ?? chromeLaunchCommand(),
    chromeDiscipline: CAMPAIGN_DISCIPLINE.chromeDiscipline,
    browser: options.browser,
    viewport: VIEWPORT,
    base: options.base,
    servedBundle: options.servedBundle,
    preRegistration: `data/${CAMPAIGN_EVIDENCE_ID}/pre-registration.json`,
    harnessDisclosure: `The bundle carries VITE_EXTERIOR_SCHEDULER_PROBE=1 VITE_CITYWIDE_OVERVIEW_PROBE=1 VITE_EXTERIOR_TEXTURE_PROBE=1, verified by reading the three attribute markers out of the SERVED bytes before Chrome was launched. The probes read state the app already holds and decide nothing. Chrome runs with --disable-backgrounding-occluded-windows and --disable-renderer-backgrounding because requestAnimationFrame is suspended in an occluded window; they stop the browser deciding not to render at all. Frame durations are requestAnimationFrame deltas and the first delta of each window is dropped because it spans the gap since the previous paint rather than a rendered frame.`,
  };
}

// ---------------------------------------------------------------------------
// campaign-control — F2, both vsync modes
// ---------------------------------------------------------------------------

async function runCampaignControl(base, attemptCount) {
  const servedBundle = await servedBundlePreflight(base);
  const modes = [];
  for (const mode of FRAME_F2.modes) {
    vsyncMode = mode;
    const browser = await launchChrome();
    let control;
    let surviving;
    try {
      control = await withControlTab(base, `control:${mode}`);
      control.browser = browser;
      control.launchCommand = chromeLaunchCommand();
    } finally {
      surviving = await recordCleanup(`campaign-control:${mode}`, await killChrome());
    }
    modes.push({ ...control, survivingChromeProcessCount: surviving });
    console.log(`  control ${mode}: p50=${control.p50Ms} p95=${control.p95Ms} frames=${control.sampleCount}`);
  }
  vsyncMode = "vsync-on";
  const record = {
    ...campaignEnvelope("frame-control", { attemptCount, base, servedBundle, browser: modes[0]?.browser ?? null, vsyncMode: "both", chromeLaunchCommand: "one launch per mode; each mode's line is on its own row" }),
    gate: FRAME_F2,
    modes,
    claim: "The instrument's own noise floor, on an empty document, in both vsync modes, on this machine. It is not a scene reading and it cannot pass or fail; it is the number below which a station p95 says nothing about the scene.",
  };
  await writeEvidence("frame-control", record);
  console.log(serialize({ modes: modes.map((mode) => ({ vsyncMode: mode.vsyncMode, p50Ms: mode.p50Ms, p95Ms: mode.p95Ms, sampleCount: mode.sampleCount, survivingChromeProcessCount: mode.survivingChromeProcessCount })) }));
}

// ---------------------------------------------------------------------------
// campaign-frames — F1, F2, F4 and G1-G3, one session
// ---------------------------------------------------------------------------

/**
 * G1's KNOWN-COUNT SCENE.
 *
 * The smallest promoted serving release: 14 buildings, four shared class tiles
 * declared by its committed payload inventory. The unique tile count is read
 * TWO independent ways — the inventory on disk and the distinct texture URLs the
 * document actually fetched — and the validation runs against the observed one,
 * with the declared one recorded beside it so a disagreement is visible rather
 * than absorbed.
 */
const GPU_VALIDATION_RELEASE_ID = "manhattan-exterior-cells-20260811-v3-s1";

async function declaredClassTileCount(releaseId) {
  const inventory = JSON.parse(await readFile(join(repositoryRoot, "data", releaseId, "payload-inventory.json"), "utf8"));
  return inventory.files.filter((file) => file.path.startsWith("public/textures/") && file.path.endsWith(".png")).length;
}

async function captureGpuValidationArm(base, attemptCount) {
  const declaredTileCount = await declaredClassTileCount(GPU_VALIDATION_RELEASE_ID);
  const pose = { stationId: "gpu-validation-block835", ...BLOCK_835_CAMERA, role: "G1 instrument validation: a small scene whose unique class-tile count is known" };
  const { session, targetId } = await attach(campaignUrl(base, pose, { releaseId: GPU_VALIDATION_RELEASE_ID, profile: LOD_L1.profile }));
  try {
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "G1 exterior activation");
    await wait(FRAME_F1.settleMs);
    const probe = await session.evaluate(READ_SCHEDULER_PROBE, "G1 probe");
    const texture = await session.evaluate(READ_TEXTURE_PROBE, "G1 texture probe");
    const tileUrls = classTileUrls(session);
    const still = await session.screenshot("G1 still");
    const capture = await writeCapture("gpu-validation-block835", still);
    if (!texture?.reading) fail("G1: the texture probe published no reading; the bundle is not the probe build or Cesium never mounted.");
    const verdict = validateGpuTextureProbe(texture.reading, tileUrls.length);
    return {
      gateId: "G1",
      attemptCount,
      releaseId: GPU_VALIDATION_RELEASE_ID,
      pose,
      declaredClassTileCount: declaredTileCount,
      observedClassTileUrls: tileUrls,
      observedClassTileCount: tileUrls.length,
      declaredAndObservedAgree: declaredTileCount === tileUrls.length,
      residentAssetCount: texture.residentAssetCount,
      reading: texture.reading,
      verdict,
      barBytes: GPU_GATES.G1.barBytes,
      pass: verdict.deltaByteLength === GPU_GATES.G1.barBytes,
      waves: waveColumns(probe),
      still: capture,
      rule: GPU_GATES.G1.rule,
    };
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
  }
}

async function runCampaignFrames(base, attemptCount) {
  vsyncMode = "vsync-on";
  const servedBundle = await servedBundlePreflight(base);
  const browser = await launchChrome();
  /** The T008 cleanup reading: how many scratch processes SURVIVED the kill. */
  let surviving;
  try {
    // G1 FIRST. A probe that disagrees with arithmetic on a four-tile scene has
    // not earned the right to be quoted on a twenty-four-tile one, and the
    // pre-registration says G2-G4 are not reported as measurements if it fails.
    const g1 = await captureGpuValidationArm(base, attemptCount);
    console.log(`  G1 delta=${g1.verdict.deltaByteLength} tiles=${g1.observedClassTileCount} measured=${g1.verdict.measuredTextureByteLength}`);

    const control = await withControlTab(base, "frames");
    console.log(`  control vsync-on: p50=${control.p50Ms} p95=${control.p95Ms} frames=${control.sampleCount}`);

    const { session, targetId } = await attach(campaignUrl(base, STATIONS[0]));
    const stations = [];
    try {
      await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.traceLength >= 0, "scheduler probe");
      await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "default exterior activation");
      for (const station of STATIONS) {
        const capture = await captureStation(session, base, station);
        stations.push(capture);
        console.log(`  station ${station.stationId}: p50=${capture.frame.p50Ms} p95=${capture.frame.p95Ms} frames=${capture.frame.sampleCount} resident=${capture.texture?.residentAssetCount} waves=${capture.residentWaveCount} textures=${capture.texture?.reading?.texturesByteLength} entries=${capture.sharedCache?.cacheEntries} peak=${capture.sharedCache?.peakConcurrentRequests}`);
      }
      const externalHosts = externalHostsOf(session, base);
      const networkFailures = session.failedRequests();

      const f1 = stations.map((station) => frameVerdictFor(station, control));
      const doubleDraw = stations.flatMap((station) => station.denseSamplesWithDoubleDraw.map((sample) => sample.doubleDrawMs));
      const totalBuild = stations.map((station) => station.denseMetrics?.totalBuildMs ?? null).filter((value) => typeof value === "number");
      const maxResident = stations.reduce((best, station) => ((station.texture?.residentAssetCount ?? -1) > (best?.texture?.residentAssetCount ?? -1) ? station : best), null);
      const g2Station = stations.find((station) => station.stationId === "overview-52km-island") ?? maxResident;
      const g2Measured = g2Station?.texture?.reading?.texturesByteLength ?? null;
      const g2Bar = EXPECTED_TEXTURE_BYTE_LENGTH + TEXTURE_TOLERANCE_TILES * predictedTextureByteLength(1);

      const record = {
        ...campaignEnvelope("frames-and-gpu", { attemptCount, base, servedBundle, browser }),
        stations: stations.map((station) => ({ ...station, denseSamplesWithDoubleDraw: station.denseSamplesWithDoubleDraw.slice(0, 20) })),
        control,
        gates: {
          F1: { rule: FRAME_F1.rule, bar: { p50Ms: FRAME_F1.p50Ms, p95Ms: FRAME_F1.p95Ms, minimumFrames: FRAME_F1.minimumFrames, settleMs: FRAME_F1.settleMs, windowMs: FRAME_F1.windowMs }, perStation: f1, pass: f1.every((entry) => entry.pass) },
          F2: { rule: FRAME_F2.rule, control, whyNotABar: FRAME_F2.whyNotABar, stationsAtOrBelowControlP95: f1.filter((entry) => entry.instrumentLimited).map((entry) => entry.stationId) },
          F4: {
            rule: FRAME_F4.rule,
            legYDoubleDrawMs: FRAME_F4.legYDoubleDrawMs,
            legXRebuildMs: FRAME_F4.legXRebuildMs,
            measuredDoubleDrawMs: doubleDraw,
            maxDoubleDrawMs: doubleDraw.length ? Math.max(...doubleDraw) : null,
            measuredTotalBuildMs: totalBuild,
            maxTotalBuildMs: totalBuild.length ? Math.max(...totalBuild) : null,
            exceedsLegYBar: doubleDraw.length > 0 && Math.max(...doubleDraw) > FRAME_F4.legYDoubleDrawMs,
            outcome: doubleDraw.length === 0
              ? "NO DOUBLE-DRAW WINDOW WAS OBSERVED at any station. The stations are settled poses and the dense plan is not rebuilt at a camera that is not moving, so this is an absence of the event rather than a measurement of it. The storm capture is where a rebuild is forced."
              : Math.max(...doubleDraw) > FRAME_F4.legYDoubleDrawMs
                ? `NAMED CARRY of ADR 0045 deferral D-11 with the measured value ${Math.max(...doubleDraw)} ms against the 4,000 ms leg-Y bar. NOT a campaign failure: D-11 already records 5,746 ms measured and is carried forward unchanged by ADR 0052.`
                : `BELOW the 4,000 ms leg-Y bar at ${Math.max(...doubleDraw)} ms. This does NOT close D-11: one session is not the island-scale bounds rebuild D-11 names.`,
            inheritedFrom: FRAME_F4.inheritedFrom,
          },
          G1: g1,
          G2: {
            rule: GPU_GATES.G2.rule,
            stationId: g2Station?.stationId ?? null,
            expectedByteLength: EXPECTED_TEXTURE_BYTE_LENGTH,
            expectedUniqueTileCount: EXPECTED_UNIQUE_TILE_COUNT,
            perTileByteLength: predictedTextureByteLength(1),
            toleranceTiles: TEXTURE_TOLERANCE_TILES,
            barByteLength: g2Bar,
            measuredByteLength: g2Measured,
            measuredTileCount: g2Measured === null ? null : g2Measured / predictedTextureByteLength(1),
            residentAssetCount: g2Station?.texture?.residentAssetCount ?? null,
            residentWaveCount: g2Station?.residentWaveCount ?? null,
            pass: g2Measured !== null && g2Measured <= g2Bar,
            gatedOnG1: g1.pass,
          },
          G3: {
            rule: GPU_GATES.G3.rule,
            residentAssetHigh: GPU_GATES.G3.residentAssetHigh,
            residentAssetLow: GPU_GATES.G3.residentAssetLow,
            readings: [
              ...stations.map((station) => ({ scope: "six-wave default station", stationId: station.stationId, residentAssetCount: station.texture?.residentAssetCount ?? null, residentWaveCount: station.residentWaveCount, texturesByteLength: station.texture?.reading?.texturesByteLength ?? null, impliedTileCount: (station.texture?.reading?.texturesByteLength ?? 0) / predictedTextureByteLength(1) })),
              { scope: "single-wave G1 arm", stationId: g1.pose.stationId, residentAssetCount: g1.residentAssetCount, residentWaveCount: 1, texturesByteLength: g1.reading.texturesByteLength, impliedTileCount: g1.reading.texturesByteLength / predictedTextureByteLength(1) },
            ],
            whyItIsTheRealClaim: GPU_GATES.G3.whyItIsTheRealClaim,
          },
          G4: { ...GPU_GATES.G4, citation: "data/shared-class-textures-20260815/gpu-campaign.json", restatedNotRecaptured: true },
          requestCeilings: stations.map((station) => ({ stationId: station.stationId, ...ceilingVerdictFor(station.sharedCache) })),
          cleanCells: stations.map((station) => ({ stationId: station.stationId, ...cleanCellVerdictFor(station.waves) })),
        },
        headroomH2: { rule: HEADROOM_H2.rule, caveat: HEADROOM_H2.caveat, source: HEADROOM_H2.source, perStation: stations.map((station) => ({ stationId: station.stationId, delta: station.performanceMetricsDelta })) },
        externalHosts,
        networkFailures,
        networkFailureCount: networkFailures.length,
        claim: "Frame percentiles, GPU texture bytes and residency at the five frozen stations of a SIX-WAVE DEFAULT session, with the instrument's own control captured in the same browser. It is not visual, geographic or factual acceptance and it is one session on one machine rather than a distribution.",
        uncapturedGap: "No canvas pick, no journey and no LOD reading is taken here; those are separate captures. The stills are what-is-drawn evidence at these five poses only.",
      };
      await writeEvidence("frames-and-gpu", record);
      console.log(serialize({
        F1: record.gates.F1.pass,
        G1: g1.pass,
        G2: record.gates.G2.pass,
        stations: f1.map((entry) => ({ stationId: entry.stationId, p50Ms: entry.p50Ms, p95Ms: entry.p95Ms, frames: entry.sampleCount, pass: entry.pass, instrumentLimited: entry.instrumentLimited })),
        externalHosts,
      }));
    } finally {
      session.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
    }
  } finally {
    surviving = await recordCleanup("campaign-frames", await killChrome());
    console.log(`  cleanup: survivingChromeProcessCount=${surviving}`);
  }
}

// ---------------------------------------------------------------------------
// campaign-headroom — H1 and H2, vsync OFF, reported and never gating
// ---------------------------------------------------------------------------

async function runCampaignHeadroom(base, attemptCount) {
  vsyncMode = "vsync-off";
  const servedBundle = await servedBundlePreflight(base);
  const browser = await launchChrome();
  /** The T008 cleanup reading: how many scratch processes SURVIVED the kill. */
  let surviving;
  try {
    const control = await withControlTab(base, "headroom");
    console.log(`  control vsync-off: p50=${control.p50Ms} p95=${control.p95Ms} frames=${control.sampleCount}`);
    const { session, targetId } = await attach(campaignUrl(base, STATIONS[0]));
    const stations = [];
    try {
      await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "default exterior activation");
      for (const station of STATIONS) {
        const capture = await captureStation(session, base, station, { captureName: `headroom-${station.stationId}` });
        stations.push(capture);
        console.log(`  headroom ${station.stationId}: p50=${capture.frame.p50Ms} p95=${capture.frame.p95Ms} frames=${capture.frame.sampleCount}`);
      }
      const byId = (stationId) => stations.find((station) => station.stationId === stationId) ?? null;
      const [heavyId, lightId] = HEADROOM_H1.comparedStations;
      const heavy = byId(heavyId);
      const light = byId(lightId);
      const separation = heavy?.frame.p50Ms !== null && light?.frame.p50Ms !== null ? Number(Math.abs(heavy.frame.p50Ms - light.frame.p50Ms).toFixed(3)) : null;
      const detectable = separation !== null && control.p95Ms !== null && separation > control.p95Ms;
      const record = {
        ...campaignEnvelope("headroom", { attemptCount, base, servedBundle, browser }),
        gating: false,
        gates: {
          H1: {
            ...HEADROOM_H1,
            control,
            comparedStations: HEADROOM_H1.comparedStations,
            p50Ms: { [heavyId]: heavy?.frame.p50Ms ?? null, [lightId]: light?.frame.p50Ms ?? null },
            separationMs: separation,
            controlP95Ms: control.p95Ms,
            detectable,
            finding: detectable
              ? `DETECTABLE: the two stations' uncapped p50 differ by ${separation} ms, which exceeds the vsync-off control's own p95 of ${control.p95Ms} ms. The difference is reported as a headroom observation and still discharges no frame criterion.`
              : `INSTRUMENT-STILL-SATURATED, the pre-registered outcome when the separation does not clear the control: the two stations' uncapped p50 differ by ${separation} ms against a vsync-off control p95 of ${control.p95Ms} ms. The loop is bounded by something other than the scene and NO scene conclusion may be drawn from it.`,
          },
          H2: { rule: HEADROOM_H2.rule, caveat: HEADROOM_H2.caveat, source: HEADROOM_H2.source, perStation: stations.map((station) => ({ stationId: station.stationId, windowMs: station.windowMs, delta: station.performanceMetricsDelta })) },
        },
        stations: stations.map((station) => ({ ...station, denseSamplesWithDoubleDraw: station.denseSamplesWithDoubleDraw.slice(0, 20) })),
        externalHosts: externalHostsOf(session, base),
        claim: "An UNCAPPED reading, taken with the display's frame limiter removed. It is registered NON-GATING because an uncapped loop is not what a user sees; it can inform and it can never discharge a frame criterion.",
      };
      await writeEvidence("headroom", record);
      console.log(serialize({ detectable, separationMs: separation, controlP95Ms: control.p95Ms, stations: stations.map((station) => ({ stationId: station.stationId, p50Ms: station.frame.p50Ms, p95Ms: station.frame.p95Ms, frames: station.frame.sampleCount })) }));
    } finally {
      session.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
    }
  } finally {
    surviving = await recordCleanup("campaign-headroom", await killChrome());
    vsyncMode = "vsync-on";
    console.log(`  cleanup: survivingChromeProcessCount=${surviving}`);
  }
}

// ---------------------------------------------------------------------------
// campaign-storm — S-1
// ---------------------------------------------------------------------------

const CENTRE = { x: Math.round(VIEWPORT.width / 2), y: Math.round(VIEWPORT.height / 2) };

/**
 * The drag, BYTE-IDENTICAL to `citywide-default-flip-campaign-cli.mjs`.
 *
 * Same centre, same ten interpolated steps, same 30 ms spacing, same
 * `Input.dispatchMouseEvent` transport. Two storms are only comparable if the
 * gesture is the same gesture, so it is ported rather than re-invented.
 */
async function stormDrag(session, dx, dy) {
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: CENTRE.x, y: CENTRE.y, buttons: 0 });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: CENTRE.x, y: CENTRE.y, button: "left", clickCount: 1, buttons: 1 });
  for (let step = 1; step <= 10; step += 1) {
    await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(CENTRE.x + dx * step / 10), y: Math.round(CENTRE.y + dy * step / 10), button: "left", buttons: 1 });
    await wait(30);
  }
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: CENTRE.x + dx, y: CENTRE.y + dy, button: "left", clickCount: 1, buttons: 0 });
}

/** One probe read, taken repeatedly through the storm. S-1b, S-1c and S-1d. */
async function stormProbe(session, session_label, phase, stepId) {
  const probe = await session.evaluate(READ_SCHEDULER_PROBE, `${session_label} ${phase} ${stepId} probe`);
  const waves = waveColumns(probe);
  return {
    phase,
    stepId,
    at: new Date().toISOString(),
    decision: probe?.decision ? { residentCount: probe.decision.residentCount, visibleCount: probe.decision.visibleCount, deferredCount: probe.decision.deferredCount, retainedCount: probe.decision.retainedCount, heightBucket: probe.decision.heightBucket, footprintSignature: probe.decision.footprintSignature } : null,
    residentWaveCount: residentWaveCount(probe),
    sharedCache: sharedCacheOf(probe),
    cells: cleanCellVerdictFor(waves),
    ceilings: ceilingVerdictFor(sharedCacheOf(probe)),
  };
}

/** The storm's start pose: the midtown street station the excursions return to. */
const STORM_START = STATIONS.find((station) => station.stationId === "street-260m-midtown");

async function runCampaignStorm(base, attemptCount) {
  vsyncMode = "vsync-on";
  const servedBundle = await servedBundlePreflight(base);
  const browser = await launchChrome();
  /** The T008 cleanup reading: how many scratch processes SURVIVED the kill. */
  let surviving;
  try {
    const { session, targetId } = await attach(campaignUrl(base, STORM_START));
    try {
      await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "default exterior activation");
      await landPose(session, campaignUrl(base, STORM_START), "storm:start");
      await wait(FRAME_F1.settleMs);
      const beforeProbe = await stormProbe(session, "storm", "before", "settled-start");
      const metricsBefore = await session.metrics();

      // ONE continuous frame window spans the whole storm: the drags, the four
      // zoom excursions and the six cross-wave translations. S-1a applies the
      // FULL strict pair to it, which is stricter than ADR 0045's flip campaign,
      // which excluded its own during-storm window from the budgets.
      const reads = [beforeProbe];
      const startedAt = Date.now();
      const framePromise = session.evaluate(sampleFramesExpression(FRAME_F1.windowMs), "storm frames");

      for (let step = 0; step < STORM_S1.dragCount; step += 1) {
        await stormDrag(session, step % 2 === 0 ? -220 : 220, step % 3 === 0 ? 120 : -120);
        if (step % 3 === 2) reads.push(await stormProbe(session, "storm", "drag", `d${step + 1}`));
      }
      for (const excursion of STORM_ZOOM_EXCURSIONS) {
        await session.evaluate(applyPoseExpression(campaignUrl(base, { ...STORM_START, height: excursion.height })), `storm zoom ${excursion.stepId}`);
        await wait(2_000);
        reads.push(await stormProbe(session, "storm", "zoom", excursion.stepId));
      }
      for (const translation of STORM_TRANSLATIONS) {
        await session.evaluate(applyPoseExpression(campaignUrl(base, { ...STORM_START, lon: translation.lon, lat: translation.lat })), `storm translate ${translation.stepId}`);
        await wait(2_000);
        reads.push(await stormProbe(session, "storm", "translate", translation.stepId));
      }
      const stormMs = Date.now() - startedAt;
      const duringStormFrameMs = await framePromise;
      const metricsAfter = await session.metrics();

      await wait(FRAME_F1.settleMs);
      const settledFrameMs = await session.evaluate(sampleFramesExpression(FRAME_F1.windowMs), "post-storm frames");
      const afterProbe = await stormProbe(session, "storm", "after", "settled-end");
      reads.push(afterProbe);
      const texture = await session.evaluate(READ_TEXTURE_PROBE, "storm texture probe");
      const notices = await session.evaluate(READ_EXTERIOR_NOTICES, "storm notices");
      const denseSamples = await session.evaluate(READ_DENSE_SAMPLES, "storm dense samples");
      const still = await writeCapture("storm-end", await session.screenshot("storm still"));
      const externalHosts = externalHostsOf(session, base);
      const networkFailures = session.failedRequests();

      const duringStorm = frameStats(duringStormFrameMs);
      const doubleDraw = denseSamples.map((sample) => sample.doubleDrawMs).filter((value) => typeof value === "number");
      const totalBuild = denseSamples.map((sample) => sample.totalBuildMs).filter((value) => typeof value === "number");
      const s1a = duringStorm.p50Ms !== null && duringStorm.p95Ms !== null && duringStorm.p50Ms <= FRAME_F1.p50Ms && duringStorm.p95Ms <= FRAME_F1.p95Ms;
      const s1b = reads.every((read) => read.ceilings.peakWithinFour && read.ceilings.entriesWithinCap && read.ceilings.bytesWithinCap);
      const s1c = reads.every((read) => read.cells.clean);
      const s1e = externalHosts.length === 0;

      const record = {
        ...campaignEnvelope("storm", { attemptCount, base, servedBundle, browser }),
        method: {
          startPose: STORM_START,
          dragCount: STORM_S1.dragCount,
          dragDisclosure: STORM_S1.dragDisclosure,
          zoomExcursions: STORM_ZOOM_EXCURSIONS,
          translations: STORM_TRANSLATIONS,
          stormMs,
          frameWindowMs: FRAME_F1.windowMs,
          windowDisclosure: "ONE continuous 12 s rAF window opens at the first drag. If the storm outlasts it, the window covers the storm's opening phase and says so through its own sample count rather than being silently extended.",
          probeReadCadence: "A probe read after every third drag, after every zoom excursion and after every translation, plus a settled read before and after.",
        },
        gates: {
          "S-1a": { rule: STORM_S1.gates["S-1a"].rule, stricterThanT005: STORM_S1.gates["S-1a"].stricterThanT005, bar: { p50Ms: FRAME_F1.p50Ms, p95Ms: FRAME_F1.p95Ms }, duringStormFrame: duringStorm, pass: s1a },
          "S-1b": { rule: STORM_S1.gates["S-1b"].rule, ceilingSource: STORM_S1.gates["S-1b"].ceilingSource, ceilings: { maxConcurrent: REQUEST_CEILINGS.appWideSharedSemaphoreMaxConcurrent, ...CACHE_CEILINGS }, maxPeakConcurrentRequests: Math.max(...reads.map((read) => read.ceilings.peakConcurrentRequests ?? 0)), maxCacheEntriesObserved: Math.max(...reads.map((read) => read.ceilings.cacheEntries ?? 0)), maxCachedBytesObserved: Math.max(...reads.map((read) => read.ceilings.cachedBytes ?? 0)), pass: s1b },
          "S-1c": { rule: STORM_S1.gates["S-1c"].rule, whyItExists: STORM_S1.gates["S-1c"].whyItExists, worst: reads.map((read) => read.cells).reduce((worst, cells) => ({ fallbackCellCount: Math.max(worst.fallbackCellCount, cells.fallbackCellCount), failedCellCount: Math.max(worst.failedCellCount, cells.failedCellCount), failedArtifactCount: Math.max(worst.failedArtifactCount, cells.failedArtifactCount) }), { fallbackCellCount: 0, failedCellCount: 0, failedArtifactCount: 0 }), pass: s1c },
          "S-1d": {
            rule: STORM_S1.gates["S-1d"].rule,
            cacheEvictionsStart: beforeProbe.sharedCache?.cacheEvictions ?? null,
            cacheEvictionsEnd: afterProbe.sharedCache?.cacheEvictions ?? null,
            releasedArtifactCountEnd: afterProbe.sharedCache?.releasedArtifactCount ?? null,
            releasedArtifactBytesEnd: afterProbe.sharedCache?.releasedArtifactBytes ?? null,
            notices,
          },
          "S-1e": { rule: STORM_S1.gates["S-1e"].rule, externalHosts, pass: s1e },
          F4: {
            rule: FRAME_F4.rule,
            legYDoubleDrawMs: FRAME_F4.legYDoubleDrawMs,
            measuredDoubleDrawMs: doubleDraw,
            maxDoubleDrawMs: doubleDraw.length ? Math.max(...doubleDraw) : null,
            maxTotalBuildMs: totalBuild.length ? Math.max(...totalBuild) : null,
            exceedsLegYBar: doubleDraw.length > 0 && Math.max(...doubleDraw) > FRAME_F4.legYDoubleDrawMs,
            inheritedFrom: FRAME_F4.inheritedFrom,
          },
        },
        postStormFrame: { ...frameStats(settledFrameMs), note: "A SETTLED window after the storm, reported beside the during-storm one so a reader can see recovery. S-1a is judged on the during-storm window." },
        performanceMetricsDelta: metricsDelta(metricsBefore, metricsAfter),
        probeReads: reads,
        texture,
        denseSampleCount: denseSamples.length,
        still,
        networkFailures,
        networkFailureCount: networkFailures.length,
        claim: "A pan/zoom/translate storm on the six-wave default session, with the FULL strict frame pair applied to the during-storm window itself. It is one storm on one machine and it makes no visual claim beyond the still it carries.",
      };
      await writeEvidence("storm", record);
      console.log(serialize({ "S-1a": s1a, "S-1b": s1b, "S-1c": s1c, "S-1e": s1e, duringStorm, stormMs, evictions: record.gates["S-1d"].cacheEvictionsEnd }));
    } finally {
      session.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
    }
  } finally {
    surviving = await recordCleanup("campaign-storm", await killChrome());
    console.log(`  cleanup: survivingChromeProcessCount=${surviving}`);
  }
}

// ---------------------------------------------------------------------------
// campaign-eviction — E-1
// ---------------------------------------------------------------------------

/**
 * A served building of the MIDTOWN wave, taken from its committed inventory.
 *
 * The E-1 loop roams midtown, so the deep-linked selection has to be a midtown
 * building: a selection whose bytes are never resident says nothing about
 * identity surviving an eviction cycle. It is read from the inventory rather
 * than typed so a re-cut wave cannot leave this instrument selecting a building
 * that is no longer served.
 */
const EVICTION_SELECTION_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3-s1";

async function servedFeatureIdFrom(releaseId) {
  const inventory = JSON.parse(await readFile(join(repositoryRoot, "data", releaseId, "payload-inventory.json"), "utf8"));
  const glb = inventory.files.find((file) => file.path.startsWith("public/assets/") && file.path.endsWith("__lod_0.glb"));
  if (!glb) fail(`the committed inventory for ${releaseId} declares no shipped lod_0 asset.`);
  return glb.path.slice("public/assets/".length, -"__lod_0.glb".length).replace("-", ":");
}

async function runCampaignEviction(base, attemptCount) {
  vsyncMode = "vsync-on";
  const servedBundle = await servedBundlePreflight(base);
  const featureId = await servedFeatureIdFrom(EVICTION_SELECTION_RELEASE_ID);
  const browser = await launchChrome();
  /** The T008 cleanup reading: how many scratch processes SURVIVED the kill. */
  let surviving;
  try {
    // The deep link is applied AT BOOT, before the roam begins, so the selection
    // SURVIVES the loop rather than being re-made at the end. E-1e is a question
    // about persistence and a selection made after the cycle would not ask it.
    const { session, targetId } = await attach(campaignUrl(base, EVICTION_LOOP[0], { featureId }));
    try {
      await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "default exterior activation");
      const stops = [];
      for (const pose of EVICTION_LOOP) {
        const url = campaignUrl(base, pose, { featureId });
        const landing = await landPose(session, url, `eviction:${pose.poseId}`);
        await wait(SETTLE_MS);
        const probe = await session.evaluate(READ_SCHEDULER_PROBE, `eviction:${pose.poseId} probe`);
        const selection = await session.evaluate(READ_SELECTION, `eviction:${pose.poseId} selection`);
        const texture = await session.evaluate(READ_TEXTURE_PROBE, `eviction:${pose.poseId} texture probe`);
        const notices = await session.evaluate(READ_EXTERIOR_NOTICES, `eviction:${pose.poseId} notices`);
        const waves = waveColumns(probe);
        const shared = sharedCacheOf(probe);
        const still = await writeCapture(`eviction-${pose.poseId}`, await session.screenshot(`${pose.poseId} still`));
        stops.push({
          poseId: pose.poseId,
          pose,
          url,
          landing,
          settleMs: SETTLE_MS,
          decision: probe?.decision ?? null,
          waves,
          residentWaveCount: residentWaveCount(probe),
          scheduledCellTotal: waves.reduce((total, wave) => total + (wave.scheduledCellCount ?? 0), 0),
          sharedCache: shared,
          ceilings: ceilingVerdictFor(shared),
          cells: cleanCellVerdictFor(waves),
          selection,
          texture,
          notices,
          still,
        });
        console.log(`  eviction ${pose.poseId}: entries=${shared?.cacheEntries} bytes=${shared?.cachedBytes} evictions=${shared?.cacheEvictions} peak=${shared?.peakConcurrentRequests} scheduled=${stops.at(-1).scheduledCellTotal} digest=${selection?.digest ?? "null"}`);
      }
      const first = stops[0];
      const last = stops.at(-1);
      const maxEvictions = Math.max(...stops.map((stop) => stop.sharedCache?.cacheEvictions ?? 0));
      const e1a = maxEvictions > 0;
      const e1b = last.cells.clean;
      const e1c = stops.every((stop) => stop.ceilings.peakWithinFour);
      const e1d = stops.every((stop) => stop.ceilings.entriesWithinCap && stop.ceilings.bytesWithinCap);
      const e1e = first.selection?.digest != null && last.selection?.digest != null && first.selection.digest === last.selection.digest;
      // The pre-registered FALSIFIER of the forcing argument, checked rather
      // than assumed: a STATIONARY stop that evicted while holding no more than
      // the scheduler's hard cap would mean the argument is wrong.
      const falsifying = stops.filter((stop, index) => index > 0 && (stop.sharedCache?.cacheEvictions ?? 0) > (stops[index - 1].sharedCache?.cacheEvictions ?? 0) && stop.scheduledCellTotal <= 8);
      const record = {
        ...campaignEnvelope("eviction-loop", { attemptCount, base, servedBundle, browser }),
        releaseSelector: "default",
        selectionFeatureId: featureId,
        selectionReleaseId: EVICTION_SELECTION_RELEASE_ID,
        selectionOpenedVia: EVICTION_GATES["E-1e"].openedVia,
        selectionSelector: EVICTION_GATES["E-1e"].selector,
        settleMsPerPose: SETTLE_MS,
        settleDisclosure: `The per-pose settle is ${SETTLE_MS} ms. It is NOT pre-registered — the pre-registration fixes the poses and the gates, not the dwell — and it is stated here because eviction is forced in TRANSIT, so a longer dwell would not make the gate easier and a shorter one would not make it harder.`,
        stops,
        gates: {
          "E-1a": { rule: EVICTION_GATES["E-1a"].rule, maxCacheEvictions: maxEvictions, evictionsByStop: stops.map((stop) => ({ poseId: stop.poseId, cacheEvictions: stop.sharedCache?.cacheEvictions ?? null })), pass: e1a },
          "E-1b": { rule: EVICTION_GATES["E-1b"].rule, returnStop: last.poseId, ...last.cells, pass: e1b },
          "E-1c": { rule: EVICTION_GATES["E-1c"].rule, maxPeakConcurrentRequests: Math.max(...stops.map((stop) => stop.ceilings.peakConcurrentRequests ?? 0)), pass: e1c },
          "E-1d": { rule: EVICTION_GATES["E-1d"].rule, maxCacheEntries: Math.max(...stops.map((stop) => stop.ceilings.cacheEntries ?? 0)), maxCachedBytes: Math.max(...stops.map((stop) => stop.ceilings.cachedBytes ?? 0)), caps: CACHE_CEILINGS, pass: e1d },
          "E-1e": {
            rule: EVICTION_GATES["E-1e"].rule,
            selector: EVICTION_GATES["E-1e"].selector,
            whyNonNullIsRegistered: EVICTION_GATES["E-1e"].whyNonNullIsRegistered,
            selectionDigestFirstVisit: first.selection?.digest ?? null,
            selectionDigestAfterReEntry: last.selection?.digest ?? null,
            selectionLengthFirstVisit: first.selection?.length ?? null,
            selectionLengthAfterReEntry: last.selection?.length ?? null,
            bothNonNull: first.selection?.digest != null && last.selection?.digest != null,
            equal: (first.selection?.digest ?? null) === (last.selection?.digest ?? null),
            pass: e1e,
          },
          "E-1f": { ...EVICTION_GATES["E-1f"], carriedVerbatim: true },
        },
        forcingArgument: {
          claimUnderTest: "A stationary anchor cannot force an eviction; eviction is reachable only in transit.",
          falsifyingCondition: "A stationary stop with cacheEvictions > 0 and a scheduledCellCount at or below 8.",
          falsifyingStops: falsifying.map((stop) => ({ poseId: stop.poseId, scheduledCellTotal: stop.scheduledCellTotal, cacheEvictions: stop.sharedCache?.cacheEvictions ?? null })),
          falsified: falsifying.length > 0,
          statement: falsifying.length > 0
            ? "FALSIFIED BY THIS CAPTURE. One or more stops evicted while holding no more than the scheduler's hard cap of 8 resident units. The pre-registered forcing argument is WRONG and this record says so rather than reinterpreting the stop as transit."
            : "NOT FALSIFIED by this capture. Every eviction increment observed here is bracketed by a camera move, which is what the pre-registered argument predicts. That is a consistency reading, not a proof of the argument.",
        },
        externalHosts: externalHostsOf(session, base),
        claim: "A closed eight-pose loop through the midtown neighbourhood on the six-wave default session, with a deep-linked selection applied before the roam. It states whether eviction is reachable in transit, whether re-entry is clean, and whether the same building resolves to the same sourced information across the cycle.",
        uncapturedGap: EVICTION_GATES["E-1f"].rule,
      };
      await writeEvidence("eviction-loop", record);
      console.log(serialize({ "E-1a": e1a, "E-1b": e1b, "E-1c": e1c, "E-1d": e1d, "E-1e": e1e, maxEvictions, digests: [first.selection?.digest ?? null, last.selection?.digest ?? null], falsified: record.forcingArgument.falsified }));
    } finally {
      session.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
    }
  } finally {
    surviving = await recordCleanup("campaign-eviction", await killChrome());
    console.log(`  cleanup: survivingChromeProcessCount=${surviving}`);
  }
}

// ---------------------------------------------------------------------------
// campaign-lod — L1
// ---------------------------------------------------------------------------

/**
 * The lodId is DOM-SCRAPED, and that is a recorded negative result.
 *
 * No probe payload and no `data-*` attribute exposes the selected LOD. The
 * scheduler, citywide and texture probes carry none. The ONLY surface is the
 * details panel's "Active asset" row, rendered as
 * `${asset.lodId} · ${asset.checksumSha256}`, and it requires a selected
 * feature. The campaign records that rather than adding a probe to be measured.
 */
const READ_ACTIVE_ASSET = `(() => {
  const panel = document.querySelector('aside.inspector[aria-label="Selected feature details"]');
  if (!panel) return { panelPresent: false, lodId: null, checksumSha256: null, raw: null };
  const terms = [...panel.querySelectorAll("dt")];
  const term = terms.find((node) => (node.textContent || "").trim() === "Active asset");
  if (!term) return { panelPresent: true, lodId: null, checksumSha256: null, raw: null };
  const raw = (term.nextElementSibling ? term.nextElementSibling.textContent || "" : "").replace(/\\s+/gu, " ").trim();
  const parts = raw.split(" · ");
  return { panelPresent: true, lodId: parts[0] || null, checksumSha256: parts[1] || null, raw };
})()`;

/** The largest lod_0 GLB of the 14-building opt-in: deterministic, not typed. */
async function block835SelectionFeatureId() {
  const assemblies = JSON.parse(await readFile(join(repositoryRoot, "public", "data", BLOCK_835_V3_RELEASE_ID, "assemblies.json"), "utf8"));
  const artifacts = Object.values(assemblies).flatMap((entry) => entry.artifacts ?? []);
  const lod0 = artifacts.filter((artifact) => artifact.relativeRef.endsWith("__lod_0.glb")).sort((left, right) => right.byteSize - left.byteSize || (left.relativeRef < right.relativeRef ? -1 : 1));
  if (lod0.length === 0) fail(`${BLOCK_835_V3_RELEASE_ID} declares no lod_0 asset.`);
  const slug = lod0[0].relativeRef.slice("public/assets/".length, -"__lod_0.glb".length);
  return { featureId: slug.replace("-", ":"), relativeRef: lod0[0].relativeRef, byteSize: lod0[0].byteSize, lodPairCount: artifacts.filter((artifact) => artifact.relativeRef.endsWith("__lod_1.glb")).length };
}

async function runCampaignLod(base, attemptCount) {
  vsyncMode = "vsync-on";
  const servedBundle = await servedBundlePreflight(base);
  const selection = await block835SelectionFeatureId();
  const browser = await launchChrome();
  /** The T008 cleanup reading: how many scratch processes SURVIVED the kill. */
  let surviving;
  try {
    const firstHeight = LOD_L1.stillHeightsM[0];
    const startPose = { stationId: `lod-${firstHeight}m`, ...BLOCK_835_CAMERA, height: firstHeight };
    const { session, targetId } = await attach(campaignUrl(base, startPose, { releaseId: LOD_L1.releaseId, profile: LOD_L1.profile, featureId: selection.featureId }));
    try {
      await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "block835 opt-in activation");
      const readings = [];
      for (const height of LOD_L1.stillHeightsM) {
        const pose = { stationId: `lod-${height}m`, ...BLOCK_835_CAMERA, height };
        const url = campaignUrl(base, pose, { releaseId: LOD_L1.releaseId, profile: LOD_L1.profile, featureId: selection.featureId });
        const landing = await landPose(session, url, `lod:${height}m`);
        await wait(SETTLE_MS);
        const activeAsset = await session.evaluate(READ_ACTIVE_ASSET, `lod ${height} m active asset`);
        const probe = await session.evaluate(READ_SCHEDULER_PROBE, `lod ${height} m probe`);
        const texture = await session.evaluate(READ_TEXTURE_PROBE, `lod ${height} m texture probe`);
        const still = await writeCapture(`lod-${height}m`, await session.screenshot(`lod ${height} m still`));
        readings.push({
          heightMeters: height,
          bucketedHeightMeters: Math.max(50, Math.round(height / 100) * 100),
          expectedLodId: Math.max(50, Math.round(height / 100) * 100) <= LOD_L1.lodSeamMeters ? "lod_0" : "lod_1",
          url,
          landing,
          activeAsset,
          decision: probe?.decision ?? null,
          waves: waveColumns(probe),
          texture,
          still,
        });
        console.log(`  lod ${height} m: bucket=${readings.at(-1).bucketedHeightMeters} lodId=${activeAsset.lodId} still=${still.sha256.slice(0, 12)}`);
      }
      const at200 = readings.find((reading) => reading.heightMeters === 200);
      const at300 = readings.find((reading) => reading.heightMeters === 300);
      const stillsDiffer = at200?.still.sha256 !== at300?.still.sha256;
      const lodCorrect = at200?.activeAsset.lodId === "lod_0" && at300?.activeAsset.lodId === "lod_1";
      const record = {
        ...campaignEnvelope("lod-l1", { attemptCount, base, servedBundle, browser }),
        gate: {
          ...LOD_L1,
          selection,
          readings,
          lodIdAt200m: at200?.activeAsset.lodId ?? null,
          lodIdAt300m: at300?.activeAsset.lodId ?? null,
          stillSha256At200m: at200?.still.sha256 ?? null,
          stillSha256At300m: at300?.still.sha256 ?? null,
          stillsRendered: Boolean(at200?.still && at300?.still),
          stillsDifferByChecksum: stillsDiffer,
          lodSelectionCorrect: lodCorrect,
          pass: lodCorrect && stillsDiffer,
        },
        claim: LOD_L1.claim,
        explicitlyNotDischarging: LOD_L1.explicitlyNotDischarging,
        externalHosts: externalHostsOf(session, base),
      };
      await writeEvidence("lod-l1", record);
      console.log(serialize({ pass: record.gate.pass, lodIdAt200m: record.gate.lodIdAt200m, lodIdAt300m: record.gate.lodIdAt300m, stillsDifferByChecksum: stillsDiffer }));
    } finally {
      session.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
    }
  } finally {
    surviving = await recordCleanup("campaign-lod", await killChrome());
    console.log(`  cleanup: survivingChromeProcessCount=${surviving}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const base = argValue(argv, "--base", "http://127.0.0.1:4173/");
  const command = argv.find((token) => !token.startsWith("--"));
  const out = argValue(argv, "--out", "");
  if (out) evidenceRoot = join(repositoryRoot, "data", out);
  const attemptCount = Number(argValue(argv, "--attempt", "1"));
  if (!Number.isInteger(attemptCount) || attemptCount < 1) fail("--attempt must be a positive integer; every campaign record states how many attempts its capture took.");
  // A campaign command must never write into this instrument's historical root:
  // that directory holds the T005 readings the T006 gates are DEFINED AGAINST.
  if (command?.startsWith("campaign-") && evidenceRoot.endsWith(EXTERIOR_SERVING_EVIDENCE_ID)) {
    fail(`a campaign capture must name its own evidence root; pass --out=${CAMPAIGN_EVIDENCE_ID}. Writing into data/${EXTERIOR_SERVING_EVIDENCE_ID}/ would overwrite the T005 records the T006 gates compare against.`);
  }
  if (command === "frames") await runFrames(base);
  else if (command === "frames-arm") await runFrameArm(base, argValue(argv, "--arm", ""), argValue(argv, "--build", ""));
  else if (command === "frames-compose") await composeFrames();
  else if (command === "roam") await runRoam(base, argValue(argv, "--release", ""));
  else if (command === "campaign-control") await runCampaignControl(base, attemptCount);
  else if (command === "campaign-frames") await runCampaignFrames(base, attemptCount);
  else if (command === "campaign-headroom") await runCampaignHeadroom(base, attemptCount);
  else if (command === "campaign-storm") await runCampaignStorm(base, attemptCount);
  else if (command === "campaign-eviction") await runCampaignEviction(base, attemptCount);
  else if (command === "campaign-lod") await runCampaignLod(base, attemptCount);
  else {
    console.error("usage: exterior-serving-evidence-cli.mjs <frames|frames-arm|frames-compose|roam> [--base=http://127.0.0.1:4173/] [--arm=a|b] [--build=<label>] [--release=default]");
    console.error("       exterior-serving-evidence-cli.mjs <campaign-control|campaign-frames|campaign-headroom|campaign-storm|campaign-eviction|campaign-lod> --out=<evidence-id> [--attempt=N]");
    console.error("roam --release=default captures the SIX-WAVE PROMOTED DEFAULT session over the registered frame poses; without it, the w02 opt-in roam.");
    console.error("campaign-* captures the T006 acceptance campaign against the frozen bars in scripts/exterior-acceptance-campaign-constants.mjs. They REQUIRE --out.");
    console.error(`The scratch Chrome is launched and killed by this file: ${chromeLaunchCommand()}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (error) => { await killChrome(); console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
