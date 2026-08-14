/* global console, process, WebSocket, fetch, Buffer, URL */
/**
 * T006 citywide default-flip campaign.
 *
 * The T005 harness shape (`scripts/transition-band-evidence-cli.mjs`) with the
 * disciplines that task established, plus the three it could not run:
 *
 *   vsync     — the CAPPED CONTROL. A bare `about:blank` rAF loop in the same
 *               browser, so every percentile below is stated against the
 *               display cap this machine actually has rather than against an
 *               assumed 60 Hz. ADR 0043 recorded that a headless rAF is not
 *               vsync-locked; this campaign is headful for that reason.
 *
 *   stations  — steady-state frame percentiles, forced-GC heap, request and
 *               residency counts at four named cameras. Boot builds and
 *               crossing transients are reported SEPARATELY, as durations, and
 *               are never folded into a steady-state percentile.
 *
 *   crossing  — D-9. The island-scale crossing, on the island plan, with the
 *               show-attribute suppression path in the served bundle. Leg X
 *               (rebuild wall clock) and leg Y (double-draw window) are
 *               evaluated against the ADR 0044 §1.3 bars, which stay exactly as
 *               pre-registered, and the two TRIGGER CLASSES are reported as
 *               separate series: V3-suppression deltas, which the show-attribute
 *               path resolves without a rebuild, and bounds-membership changes,
 *               which still rebuild.
 *
 *   control   — D-10. Scheduler ON, overlay ON, radius null, against the same
 *               poses at radius 1200. This is the arm ADR 0044 §3.1 never ran:
 *               the one that isolates the radius from the scheduler.
 *
 * Nothing here decides. The verdict is a human reading, recorded in ADR 0045.
 *
 * Usage:
 *   node scripts/citywide-default-flip-campaign-cli.mjs vsync    --port 9222
 *   node scripts/citywide-default-flip-campaign-cli.mjs stations --dev … --port 9222
 *   node scripts/citywide-default-flip-campaign-cli.mjs crossing --dev … --port 9222
 *   node scripts/citywide-default-flip-campaign-cli.mjs control  --dev … --port 9222
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(repositoryRoot, "data", "citywide-default-flip-20260814");

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 300_000;
const SETTLE_MS = 45_000;
/** Steady-state sampling window, taken only AFTER the settle has completed. */
const FRAME_WINDOW_MS = 10_000;

/**
 * The fixed acceptance bars, from the goal. They are frame INTERVAL budgets in
 * milliseconds and they apply to steady-state percentiles only.
 */
const FRAME_BUDGETS = { p50Ms: 16.7, p95Ms: 25, relaxedP50Ms: 33.3, relaxedP95Ms: 45 };

/** ADR 0044 §1.3, unchanged. Reproduced so the record carries its own bars. */
const REVIVAL_BARS = { legXRebuildMs: 8_000, legYDoubleDrawMs: 4_000 };

const ANCHOR = { lon: -73.986359867, lat: 40.7487748165 };
/** The island centroid, for the poses that must see the whole island. */
const ISLAND = { lon: -73.9712, lat: 40.7831 };

const STATIONS = [
  { stationId: "street-260m", ...ANCHOR, height: 260, heading: 45, pitch: -25, roll: 0 },
  { stationId: "transition-1200m", ...ANCHOR, height: 1_200, heading: 45, pitch: -45, roll: 0 },
  { stationId: "overview-52km", ...ISLAND, height: 52_000, heading: 0, pitch: -90, roll: 0 },
];

/** The D-10 control poses: identical cameras, radius null vs radius 1200. */
const CONTROL_POSES = [
  { poseId: "block835-500m", ...ANCHOR, height: 500, heading: 45, pitch: -35, roll: 0 },
  { poseId: "block835-1km", ...ANCHOR, height: 1_000, heading: 45, pitch: -45, roll: 0 },
  { poseId: "block835-2km", ...ANCHOR, height: 2_000, heading: 45, pitch: -55, roll: 0 },
  { poseId: "block835-3km", ...ANCHOR, height: 3_000, heading: 45, pitch: -60, roll: 0 },
];

/**
 * The crossing camera.
 *
 * Island scale, not Block-835-local: ADR 0044 D-9 is explicit that everything
 * T005 measured about a crossing was measured on a 4,803-feature plan and that
 * the island plan is 11.9× that. The session boots at the island overview so
 * the dense plan is the island plan, then drags across the island so the
 * membership moves at island scale.
 */
const CROSSING_START = { label: "island-crossing-start", ...ISLAND, height: 52_000, heading: 0, pitch: -90, roll: 0 };
/**
 * Four SHORT drags, not six long ones.
 *
 * A first attempt used the T005 drag (6 x 180 px) from a 6 km camera. At island
 * scale that carries the camera off Manhattan entirely: the plan ended at 25
 * buildings, which measures a departure and not a crossing. Four 40 px drags
 * from the 52 km overview move the footprint a few kilometres while the plan
 * stays the island plan, which is what D-9 asks for.
 */
const CROSSING_DRAGS = 4;
const CROSSING_DRAG_PX = -40;

function fail(message) { throw new Error(`citywide-default-flip-campaign: ${message}`); }

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function writeArtifact(name, value) {
  await mkdir(evidenceRoot, { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(join(evidenceRoot, name), text);
  await writeFile(join(evidenceRoot, `${name.replace(/\.json$/u, "")}.sha256`), `${sha256HexSync(text)}  ${name}\n`);
  return sha256HexSync(text);
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Number(sorted[index].toFixed(3));
}

function frameStatistics(intervals) {
  const sorted = [...intervals].sort((left, right) => left - right);
  return {
    sampleCount: sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted.length ? Number(sorted[sorted.length - 1].toFixed(3)) : null,
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

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) fail(`page evaluation threw: ${result.exceptionDetails.text}`);
    return result.result.value;
  }

  responses() {
    return this.events.filter((event) => event.method === "Network.responseReceived").map((event) => event.params.response);
  }

  async screenshot() {
    const shot = await this.send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(shot.data, "base64");
  }

  close() { this.socket.close(); }
}

async function attach(port, initialUrl = "about:blank") {
  const listResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(initialUrl)}`, { method: "PUT" }).catch(() => null);
  if (!listResponse?.ok) fail(`could not open a tab on the debugging port ${port}; start Chrome HEADFUL with --remote-debugging-port=${port}`);
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
  await session.send("HeapProfiler.enable").catch(() => null);
  await session.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });
  // Headful Chrome throttles BACKGROUND tabs: rAF is clamped and compositing
  // stops, so a capture taken in one measures the throttle and not the
  // renderer. Every capture runs in the foreground tab, by construction.
  await session.send("Page.bringToFront").catch(() => null);
  return { session, targetId: target.id };
}

const sleep = (session, ms) => session.evaluate(`new Promise((done) => setTimeout(done, ${ms}))`);

/**
 * Forced collection before every heap reading.
 *
 * ADR 0039 records why: a rising `usedJSHeapSize` without a forced collection is
 * equally consistent with garbage that had not yet been collected, and that
 * caveat is what made the T009 memory reading unusable.
 */
async function heapAfterGcBytes(session) {
  await session.send("HeapProfiler.collectGarbage").catch(() => null);
  await sleep(session, 500);
  return session.evaluate("(performance.memory && performance.memory.usedJSHeapSize) || null");
}

const FRAME_PROBE_START = `(() => {
  window.__t006Frames = [];
  window.__t006FrameStop = false;
  const tick = (previous) => window.requestAnimationFrame((now) => {
    if (window.__t006FrameStop) return;
    if (previous !== null) window.__t006Frames.push(now - previous);
    tick(now);
  });
  tick(null);
  return true;
})()`;

const FRAME_PROBE_READ = `(() => { const frames = window.__t006Frames || []; window.__t006Frames = []; return frames; })()`;

const READ_SCHEDULER_PROBE = `(() => {
  const node = document.querySelector("[data-exterior-scheduler-probe]");
  if (!node) return null;
  const probe = JSON.parse(node.textContent);
  return { ...probe, trace: probe.trace.slice(-1), traceLength: probe.traceLength };
})()`;

const READ_CITYWIDE_PROBE = `(() => {
  const node = document.querySelector("[data-citywide-overview-probe]");
  if (!node) return null;
  const probe = JSON.parse(node.textContent);
  return { adapterMetrics: probe.adapterMetrics, denseMetrics: probe.denseMetrics, cache: probe.cache, overviewResidencyActive: probe.overviewResidencyActive, budgets: probe.budgets, denseSampleCount: (probe.denseSamples || []).length };
})()`;

/** Every dense sample the probe retained, which is the crossing timeline. */
const READ_DENSE_SAMPLES = `(() => {
  const node = document.querySelector("[data-citywide-overview-probe]");
  if (!node) return [];
  return JSON.parse(node.textContent).denseSamples || [];
})()`;

const READ_NOTICE = `(() => {
  const node = document.querySelector("[data-exterior-notices]");
  if (!node) return null;
  const read = (selector) => { const line = node.querySelector(selector); return line ? { attribute: line.getAttribute(selector.slice(1, -1)), text: line.firstChild ? line.firstChild.textContent : line.textContent } : null; };
  return {
    entryCount: node.getAttribute("data-exterior-notices"),
    notShipped: read("[data-exterior-notice-not-shipped]"),
    deferred: read("[data-exterior-notice-deferred]"),
    evicted: read("[data-exterior-notice-evicted]"),
    residency: read("[data-exterior-notice-residency]"),
    verbatimCount: node.querySelectorAll("[data-exterior-notice-verbatim]").length,
  };
})()`;

/**
 * The arms, and what each one says in the URL.
 *
 *   default      — NOTHING. The whole point of the flip: a cold session that
 *                  names no exterior parameter must stream the island.
 *   explicit-on  — `exteriorScheduler=on`, the pre-flip spelling, kept so a
 *                  legacy link is measured rather than assumed equivalent.
 *   rolled-back  — `exteriorScheduler=off`, the per-session rollback.
 *   dense-only   — `exteriorStreaming=off`, the D-5 arm. It is only a CLEAN
 *                  control because B2 split the two hatches: before the split
 *                  this URL also withdrew the citywide residency raise, so the
 *                  arm differed from its counterpart in two ways at once.
 */
function sessionUrl(dev, pose, options = {}) {
  const url = new URL(dev);
  url.searchParams.set("data", "real-pilot");
  url.searchParams.set("release", "manhattan-citywide-20260804");
  url.searchParams.set("view", "free");
  if (options.arm === "explicit-on") url.searchParams.set("exteriorScheduler", "on");
  else if (options.arm === "rolled-back") url.searchParams.set("exteriorScheduler", "off");
  else if (options.scheduler === false) url.searchParams.set("exteriorScheduler", "off");
  if (options.arm === "dense-only" || options.denseOnly) url.searchParams.set("exteriorStreaming", "off");
  if (options.radiusMeters != null) url.searchParams.set("exteriorDetailRadius", String(options.radiusMeters));
  for (const key of ["lon", "lat", "height", "heading", "pitch", "roll"]) {
    if (pose[key] !== undefined) url.searchParams.set(key, Number(pose[key]).toFixed(6));
  }
  return url.toString();
}

async function waitFor(session, read, predicate, what) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const probe = await session.evaluate(read);
    if (probe && predicate(probe)) return probe;
    if (Date.now() > deadline) fail(`timed out waiting for ${what}`);
    await sleep(session, 500);
  }
}

const CENTRE = { x: Math.round(VIEWPORT.width / 2), y: Math.round(VIEWPORT.height / 2) };

async function drag(session, dx, dy) {
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: CENTRE.x, y: CENTRE.y, buttons: 0 });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: CENTRE.x, y: CENTRE.y, button: "left", clickCount: 1, buttons: 1 });
  for (let step = 1; step <= 10; step += 1) {
    await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(CENTRE.x + dx * step / 10), y: Math.round(CENTRE.y + dy * step / 10), button: "left", buttons: 1 });
    await sleep(session, 30);
  }
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: CENTRE.x + dx, y: CENTRE.y + dy, button: "left", clickCount: 1, buttons: 0 });
}

function externalHosts(session, dev) {
  const origin = new URL(dev).host;
  return [...new Set(session.responses().map((response) => {
    try { return new URL(response.url).host; } catch { return ""; }
  }).filter((host) => host && host !== origin))].sort();
}

// ---------------------------------------------------------------------------
// bundle identity
// ---------------------------------------------------------------------------

async function runBundle(argv) {
  const dev = argValue(argv, "--dev", "http://localhost:4212");
  const index = await (await fetch(dev)).text();
  const scripts = [...index.matchAll(/src="([^"]+\.js)"/gu)].map((match) => match[1]);
  const assets = [];
  for (const relative of scripts) {
    const bytes = new Uint8Array(await (await fetch(new URL(relative, dev))).arrayBuffer());
    assets.push({ ref: relative, byteSize: bytes.byteLength, sha256: sha256HexBytes(bytes) });
  }
  const record = {
    schemaVersion: "1.0",
    taskId: "T006",
    artifact: "citywide-default-flip-served-bundle",
    note: "The bytes the preview server SERVES. The double-draw timestamps this campaign reads are UNCONDITIONAL telemetry fields, not probe-gated, precisely so the measured bundle is the served bundle.",
    origin: dev,
    indexSha256: sha256HexSync(index),
    indexByteSize: Buffer.byteLength(index),
    assets,
  };
  const checksum = await writeArtifact("served-bundle.json", record);
  console.log(JSON.stringify({ indexSha256: record.indexSha256, assetCount: assets.length, checksum }, null, 2));
  return record;
}

// ---------------------------------------------------------------------------
// vsync — the capped control
// ---------------------------------------------------------------------------

async function runVsync(argv) {
  const port = Number(argValue(argv, "--port", "9222"));
  const { session, targetId } = await attach(port, "about:blank");
  try {
    await session.evaluate(FRAME_PROBE_START);
    await sleep(session, FRAME_WINDOW_MS);
    const intervals = await session.evaluate(FRAME_PROBE_READ);
    const statistics = frameStatistics(intervals);
    const record = {
      schemaVersion: "1.0",
      taskId: "T006",
      artifact: "citywide-default-flip-vsync-control",
      note: "A bare rAF loop on about:blank in the SAME browser as every station below. This is the display cap, not a rendering measurement, and every station percentile must be read against it: a p50 at the cap means the renderer was never the limit.",
      capturedAtIso: new Date().toISOString(),
      viewport: VIEWPORT,
      windowMs: FRAME_WINDOW_MS,
      frame: statistics,
      impliedRefreshHz: statistics.p50Ms ? Number((1_000 / statistics.p50Ms).toFixed(2)) : null,
      budgets: FRAME_BUDGETS,
    };
    const checksum = await writeArtifact("vsync-control.json", record);
    console.log(JSON.stringify({ ...statistics, impliedRefreshHz: record.impliedRefreshHz, checksum }, null, 2));
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => null);
  }
}

// ---------------------------------------------------------------------------
// stations
// ---------------------------------------------------------------------------

async function captureStation(dev, port, station, options) {
  const { session, targetId } = await attach(port);
  try {
    const url = sessionUrl(dev, station, options);
    const bootStartedAt = Date.now();
    await session.send("Page.navigate", { url });
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.traceLength > 0, `${station.stationId} scheduler probe`);
    if (options.arm !== "dense-only") await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, `${station.stationId} exterior activation`);
    const firstDense = await waitFor(session, READ_CITYWIDE_PROBE, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0, `${station.stationId} dense build`);
    const bootToFirstDenseMs = Date.now() - bootStartedAt;
    await sleep(session, SETTLE_MS);

    // Steady state ONLY. The window opens after the settle, so no boot build
    // and no crossing transient can enter a percentile.
    await session.evaluate(FRAME_PROBE_START);
    await sleep(session, FRAME_WINDOW_MS);
    const intervals = await session.evaluate(FRAME_PROBE_READ);

    const settledScheduler = await session.evaluate(READ_SCHEDULER_PROBE);
    const settledCitywide = await session.evaluate(READ_CITYWIDE_PROBE);
    const notice = await session.evaluate(READ_NOTICE);
    const heapBytes = await heapAfterGcBytes(session);
    const still = await session.screenshot();
    return {
      stationId: station.stationId,
      arm: options.arm,
      url,
      settleMs: SETTLE_MS,
      bootToFirstDenseMs,
      bootBuild: { totalBuildMs: firstDense.denseMetrics?.totalBuildMs ?? null, allocationMs: firstDense.denseMetrics?.allocationMs ?? null, note: "A BOOT build, reported as a duration against the leg-X bar. It is never folded into the steady-state percentiles above." },
      frame: frameStatistics(intervals),
      dense: settledCitywide?.denseMetrics ?? null,
      adapter: settledCitywide?.adapterMetrics ?? null,
      cache: settledCitywide?.cache ?? null,
      budgets: settledCitywide?.budgets ?? null,
      overviewResidencyActive: settledCitywide?.overviewResidencyActive ?? null,
      decision: settledScheduler?.decision ?? null,
      waves: settledScheduler?.waves ?? null,
      notice,
      heapAfterGcBytes: heapBytes,
      network: { externalHosts: externalHosts(session, dev), responseCount: session.responses().length },
      stillSha256: sha256HexBytes(new Uint8Array(still)),
      still,
    };
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => null);
  }
}

/** The pan storm: a settled station, then sustained drags, sampled throughout. */
async function capturePanStorm(dev, port, options) {
  const { session, targetId } = await attach(port);
  try {
    const url = sessionUrl(dev, STATIONS[1], options);
    await session.send("Page.navigate", { url });
    await waitFor(session, READ_CITYWIDE_PROBE, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0, "pan-storm dense build");
    await sleep(session, SETTLE_MS);
    const before = await session.evaluate(READ_CITYWIDE_PROBE);
    await session.evaluate(FRAME_PROBE_START);
    const startedAt = Date.now();
    for (let step = 0; step < 12; step += 1) await drag(session, step % 2 === 0 ? -220 : 220, step % 3 === 0 ? 120 : -120);
    const stormMs = Date.now() - startedAt;
    const stormIntervals = await session.evaluate(FRAME_PROBE_READ);
    await sleep(session, SETTLE_MS);
    // A second window AFTER the storm settles: this one is a steady state and
    // is the only one the fixed budgets apply to.
    await session.evaluate(FRAME_PROBE_START);
    await sleep(session, FRAME_WINDOW_MS);
    const settledIntervals = await session.evaluate(FRAME_PROBE_READ);
    const after = await session.evaluate(READ_CITYWIDE_PROBE);
    const heapBytes = await heapAfterGcBytes(session);
    const still = await session.screenshot();
    return {
      stationId: "pan-storm",
      arm: options.arm,
      url,
      dragCount: 12,
      stormMs,
      duringStormFrame: { ...frameStatistics(stormIntervals), note: "DURING a 12-drag storm. This is a transient and the fixed budgets do NOT apply to it; it is reported as its own series." },
      frame: frameStatistics(settledIntervals),
      denseBefore: before?.denseMetrics ?? null,
      dense: after?.denseMetrics ?? null,
      cache: after?.cache ?? null,
      heapAfterGcBytes: heapBytes,
      network: { externalHosts: externalHosts(session, dev), responseCount: session.responses().length },
      stillSha256: sha256HexBytes(new Uint8Array(still)),
      still,
    };
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => null);
  }
}

async function runStations(argv) {
  const dev = argValue(argv, "--dev", "http://localhost:4212");
  const port = Number(argValue(argv, "--port", "9222"));
  const arm = argValue(argv, "--arm", "scheduler-on");
  const options = { arm, radiusMeters: null, denseOnly: arm === "dense-only" };
  // The URL each arm serves, recorded so the record states its own contract.
  const armUrl = sessionUrl(dev, STATIONS[0], options);
  const bundle = await runBundle(argv);
  const captures = [];
  for (const station of STATIONS) {
    const capture = await captureStation(dev, port, station, options);
    await mkdir(join(evidenceRoot, "captures"), { recursive: true });
    await writeFile(join(evidenceRoot, "captures", `${capture.stationId}-${arm}.png`), capture.still);
    const rest = { ...capture }; delete rest.still;
    captures.push(rest);
    console.error(`station ${capture.stationId}/${arm}: p50=${rest.frame.p50Ms} p95=${rest.frame.p95Ms} buildings=${rest.dense?.buildingFeatureCount} suppressed=${rest.dense?.exteriorSuppressedFeatureCount} flips=${rest.dense?.planSuppressionFlipCount} builds=${rest.dense?.planBuildCount}`);
  }
  const storm = await capturePanStorm(dev, port, options);
  await writeFile(join(evidenceRoot, "captures", `pan-storm-${arm}.png`), storm.still);
  const stormRest = { ...storm }; delete stormRest.still;
  captures.push(stormRest);
  console.error(`station pan-storm/${arm}: storm p95=${stormRest.duringStormFrame.p95Ms} settled p95=${stormRest.frame.p95Ms}`);

  const record = {
    schemaVersion: "1.0",
    taskId: "T006",
    artifact: "citywide-default-flip-stations",
    note: "Steady-state percentiles only. Boot builds and storm transients are reported in their own fields and are never folded into a percentile the fixed budgets are applied to.",
    servedBundle: { indexSha256: bundle.indexSha256, assets: bundle.assets.map((asset) => asset.sha256) },
    viewport: VIEWPORT,
    arm,
    armUrl,
    budgets: FRAME_BUDGETS,
    settleMs: SETTLE_MS,
    frameWindowMs: FRAME_WINDOW_MS,
    capturedAtIso: new Date().toISOString(),
    captures,
  };
  const checksum = await writeArtifact(`stations-${arm}.json`, record);
  console.log(JSON.stringify({ captureCount: captures.length, checksum }, null, 2));
}

// ---------------------------------------------------------------------------
// crossing — D-9
// ---------------------------------------------------------------------------

/**
 * Classify each dense sample transition into the trigger taxonomy.
 *
 * PRE-REGISTERED (C2): leg X and leg Y are evaluated against the V3-SUPPRESSION
 * crossing, because that is the crossing the show-attribute path exists to
 * serve and the one ADR 0044 §4.1 named as the default flip's prerequisite.
 * Bounds-membership rebuilds are a real and separate cost; they are reported as
 * their own series and are NOT silently folded into the same bar.
 */
function classifyDenseSamples(samples) {
  const rebuilds = [];
  const suppressionUpdates = [];
  let previous = null;
  for (const sample of samples) {
    if (previous) {
      if ((sample.planBuildCount ?? 0) > (previous.planBuildCount ?? 0)) {
        // `totalBuildMs` and `doubleDrawMs` are written together at one commit
        // and are therefore coherent with each other. The raw timestamps are
        // NOT: a sample sees one telemetry object, and a later build can have
        // overwritten `pendingLayerAddedAt` before the sample was taken. They
        // are carried for provenance and the two derived durations are what
        // the legs are read from.
        rebuilds.push({
          planBuildCount: sample.planBuildCount,
          planSwapCount: sample.planSwapCount,
          planCancellationCount: sample.planCancellationCount,
          totalBuildMs: sample.totalBuildMs ?? null,
          doubleDrawMs: sample.doubleDrawMs ?? null,
          rawTimestamps: {
            note: "Snapshot fields; a later build may have advanced pendingLayerAddedAt before this sample was read. The derived durations above are the coherent pair.",
            pendingLayerAddedAt: sample.pendingLayerAddedAt ?? null,
            doubleDrawOpenedAt: sample.doubleDrawOpenedAt ?? null,
            previousLayerRemovedAt: sample.previousLayerRemovedAt ?? null,
          },
          buildingFeatureCount: sample.buildingFeatureCount,
          instanceCount: sample.instanceCount,
        });
      }
      if ((sample.planSuppressionUpdateCount ?? 0) > (previous.planSuppressionUpdateCount ?? 0)) {
        suppressionUpdates.push({
          planSuppressionUpdateCount: sample.planSuppressionUpdateCount,
          flipsInThisUpdate: (sample.planSuppressionFlipCount ?? 0) - (previous.planSuppressionFlipCount ?? 0),
          planBuildCountUnchanged: (sample.planBuildCount ?? 0) === (previous.planBuildCount ?? 0),
          exteriorSuppressedFeatureCount: sample.exteriorSuppressedFeatureCount,
          denseSuppressedInstanceCount: sample.denseSuppressedInstanceCount,
          buildingFeatureCount: sample.buildingFeatureCount,
        });
      }
    }
    previous = sample;
  }
  return { rebuilds, suppressionUpdates };
}

async function runCrossing(argv) {
  const dev = argValue(argv, "--dev", "http://localhost:4212");
  const port = Number(argValue(argv, "--port", "9222"));
  const bundle = await runBundle(argv);
  const { session, targetId } = await attach(port);
  try {
    await session.send("Page.navigate", { url: sessionUrl(dev, CROSSING_START, { arm: "scheduler-on" }) });
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "crossing bootstrap");
    await waitFor(session, READ_CITYWIDE_PROBE, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0, "crossing dense build");
    await sleep(session, SETTLE_MS);

    const before = await session.evaluate(READ_CITYWIDE_PROBE);
    const beforeStill = await session.screenshot();
    const bootSamples = await session.evaluate(READ_DENSE_SAMPLES);

    const startedAt = Date.now();
    for (let step = 0; step < CROSSING_DRAGS; step += 1) await drag(session, CROSSING_DRAG_PX, 0);

    const consecutive = [];
    for (let index = 0; index < 4; index += 1) {
      const probe = await session.evaluate(READ_CITYWIDE_PROBE);
      consecutive.push({ index, elapsedMs: Date.now() - startedAt, dense: probe?.denseMetrics ?? null });
    }
    const settleSeries = [];
    for (const seconds of [0, 1, 2, 4, 8, 16]) {
      const target = startedAt + seconds * 1_000;
      const wait = target - Date.now();
      if (wait > 0) await sleep(session, wait);
      const probe = await session.evaluate(READ_CITYWIDE_PROBE);
      settleSeries.push({ seconds, elapsedMs: Date.now() - startedAt, dense: probe?.denseMetrics ?? null });
    }
    await sleep(session, SETTLE_MS);
    const after = await session.evaluate(READ_CITYWIDE_PROBE);
    const afterStill = await session.screenshot();
    const allSamples = await session.evaluate(READ_DENSE_SAMPLES);
    const classified = classifyDenseSamples(allSamples);

    await mkdir(join(evidenceRoot, "captures"), { recursive: true });
    await writeFile(join(evidenceRoot, "captures", "island-crossing-before.png"), beforeStill);
    await writeFile(join(evidenceRoot, "captures", "island-crossing-after.png"), afterStill);

    const rebuildMs = classified.rebuilds.map((entry) => entry.totalBuildMs).filter((value) => typeof value === "number");
    const doubleDrawMs = classified.rebuilds.map((entry) => entry.doubleDrawMs).filter((value) => typeof value === "number");
    const record = {
      schemaVersion: "1.0",
      taskId: "T006",
      artifact: "citywide-default-flip-island-crossing",
      note: "D-9. An island-scale crossing on the island dense plan, with the show-attribute suppression path in the served bundle. Leg Y is measured against its OWN definition — a timestamp at the pending-layer add, retained across cancelled builds — and not by a totalBuildMs proxy that is known to undercount it.",
      preRegistered: {
        legsEvaluatedAgainst: "the V3-suppression crossing",
        boundsRebuildSeries: "reported separately as `boundsRebuilds`; not folded into the leg bars",
        bars: REVIVAL_BARS,
      },
      servedBundle: { indexSha256: bundle.indexSha256 },
      viewport: VIEWPORT,
      crossing: { start: CROSSING_START, dragCount: CROSSING_DRAGS, dragPx: CROSSING_DRAG_PX, transport: "Chrome DevTools Protocol, real Input.dispatchMouseEvent drags in one document" },
      before: { dense: before?.denseMetrics ?? null, denseSampleCount: bootSamples.length, sha256: sha256HexBytes(new Uint8Array(beforeStill)) },
      consecutiveFrames: consecutive,
      settleSeries,
      after: { dense: after?.denseMetrics ?? null, sha256: sha256HexBytes(new Uint8Array(afterStill)) },
      v3SuppressionCrossings: classified.suppressionUpdates,
      isolatedV3SuppressionCrossings: classified.suppressionUpdates.filter((entry) => entry.planBuildCountUnchanged),
      boundsRebuilds: classified.rebuilds,
      legs: {
        X: { barMs: REVIVAL_BARS.legXRebuildMs, maxRebuildMs: rebuildMs.length ? Math.max(...rebuildMs) : null, rebuildCount: rebuildMs.length },
        Y: { barMs: REVIVAL_BARS.legYDoubleDrawMs, maxDoubleDrawMs: doubleDrawMs.length ? Math.max(...doubleDrawMs) : null, measuredWindowCount: doubleDrawMs.length, measuredAgainstOwnDefinition: true },
      },
      network: { externalHosts: externalHosts(session, dev) },
    };
    const checksum = await writeArtifact("island-crossing.json", record);
    console.log(JSON.stringify({ checksum, legs: record.legs, v3Crossings: record.v3SuppressionCrossings.length, rebuilds: record.boundsRebuilds.length }, null, 2));
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => null);
  }
}

// ---------------------------------------------------------------------------
// control — D-10
// ---------------------------------------------------------------------------

async function capturePose(dev, port, pose, radiusMeters) {
  const { session, targetId } = await attach(port);
  try {
    const url = sessionUrl(dev, pose, { radiusMeters });
    await session.send("Page.navigate", { url });
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.traceLength > 0, `${pose.poseId} scheduler probe`);
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, `${pose.poseId} exterior activation`);
    await waitFor(session, READ_CITYWIDE_PROBE, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0, `${pose.poseId} dense build`);
    await sleep(session, SETTLE_MS);
    const scheduler = await session.evaluate(READ_SCHEDULER_PROBE);
    const citywide = await session.evaluate(READ_CITYWIDE_PROBE);
    return {
      poseId: pose.poseId,
      arm: radiusMeters === null ? "radius-null" : `radius-${radiusMeters}`,
      url,
      detailRadiusMeters: scheduler.detailRadiusMeters,
      decision: scheduler.decision,
      waves: scheduler.waves,
      dense: citywide?.denseMetrics ?? null,
      adapter: citywide?.adapterMetrics ?? null,
      cache: citywide?.cache ?? null,
      overviewResidencyActive: citywide?.overviewResidencyActive ?? null,
      network: { externalHosts: externalHosts(session, dev) },
    };
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => null);
  }
}

async function runControl(argv) {
  const dev = argValue(argv, "--dev", "http://localhost:4212");
  const port = Number(argValue(argv, "--port", "9222"));
  const radiusMeters = Number(argValue(argv, "--radius", "1200"));
  const bundle = await runBundle(argv);
  const captures = [];
  for (const pose of CONTROL_POSES) {
    for (const radius of [null, radiusMeters]) {
      const capture = await capturePose(dev, port, pose, radius);
      captures.push(capture);
      console.error(`control ${pose.poseId}/${capture.arm}: visible=${capture.decision?.visibleCount} deferred=${capture.decision?.deferredCount} retained=${capture.decision?.retainedCount ?? "-"} suppressed=${capture.dense?.exteriorSuppressedFeatureCount} buildings=${capture.dense?.buildingFeatureCount}`);
    }
  }
  const record = {
    schemaVersion: "1.0",
    taskId: "T006",
    artifact: "citywide-default-flip-radius-control",
    note: "D-10. The arm ADR 0044 §3.1 never ran: same flag, same budgets, same overlay, radius null against radius 1200. Both arms have the raised citywide budgets, so a difference in these rows is the RADIUS and not the residency raise.",
    servedBundle: { indexSha256: bundle.indexSha256 },
    viewport: VIEWPORT,
    candidateRadiusMeters: radiusMeters,
    settleMs: SETTLE_MS,
    capturedAtIso: new Date().toISOString(),
    poses: CONTROL_POSES,
    captures,
  };
  const checksum = await writeArtifact("radius-control.json", record);
  console.log(JSON.stringify({ captureCount: captures.length, checksum }, null, 2));
}

const [stage, ...argv] = process.argv.slice(2);
const stages = { bundle: runBundle, vsync: runVsync, stations: runStations, crossing: runCrossing, control: runControl };
if (!stages[stage]) {
  console.error("usage: citywide-default-flip-campaign-cli.mjs <bundle|vsync|stations|crossing|control> [--dev url] [--port 9222] [--arm scheduler-on] [--radius 1200]");
  process.exitCode = 1;
} else {
  await stages[stage](argv);
}
