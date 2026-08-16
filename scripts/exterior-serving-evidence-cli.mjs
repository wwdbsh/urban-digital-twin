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
import { exteriorServingFrameVerdict } from "../src/runtime/exterior-serving-frame-bar.ts";
import { EXTERIOR_SERVING_EVIDENCE_ID, exteriorServingWave } from "../src/release/exterior-serving-waves.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";

const run = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(repositoryRoot, "data", EXTERIOR_SERVING_EVIDENCE_ID);

const PORT = 9224;
const USER_DATA_DIR = "/tmp/t005-serving-chrome";
const CHROME_LAUNCH_COMMAND = `open -na "Google Chrome" --args --remote-debugging-port=${PORT} --user-data-dir=${USER_DATA_DIR} --no-first-run --disable-background-timer-throttling`;
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
 * The operator's Chrome does not carry that flag and is never a match.
 */
async function killChrome() {
  await run("/usr/bin/pkill", ["-f", `--user-data-dir=${USER_DATA_DIR}`]).catch(() => null);
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

const COUNT_DECODED_TEXTURES = `(() => {
  const entries = performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/public/textures/") && entry.name.endsWith(".png"));
  return { requestCount: entries.length, distinctUrlCount: new Set(entries.map((entry) => entry.name)).size };
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

function residentAssetCount(probe) {
  return (probe?.waves ?? []).reduce((total, wave) => total + (wave.metrics?.loadedArtifactCount ?? 0), 0);
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

async function runRoam(base) {
  const browser = await launchChrome();
  const releaseId = SERVING_WAVE.servingReleaseId;
  const featureId = await servedSelectionFeatureId();
  const { session, targetId } = await attach(selectionUrl(base, ROAM[0], releaseId, featureId));
  try {
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "serving exterior activation");
    const stops = [];
    for (const pose of ROAM) {
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
      armDisclosure: "This roam ran as an OPT-IN arm, before any promotion, with the serving caps compiled into the build under test. That is deliberate and is stated rather than implied: the caps are a property of the serving composition, and measuring them against the 13-cell promoted composition would measure the case ADR 0052 §3 already rejected.",
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
  else if (command === "roam") await runRoam(base);
  else {
    console.error("usage: exterior-serving-evidence-cli.mjs <frames|roam> [--base=http://127.0.0.1:4173/]");
    console.error(`The scratch Chrome is launched and killed by this file: ${CHROME_LAUNCH_COMMAND}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (error) => { await killChrome(); console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
