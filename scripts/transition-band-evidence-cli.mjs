/* global console, process, WebSocket, fetch, Buffer, URL */
/**
 * T005 near-field transition-band evidence.
 *
 * Three stages, kept apart because they answer different questions:
 *
 *   bundle    — hashes the bytes the preview server actually SERVES, so every
 *               later claim names the build it was measured on.
 *
 *   poses     — the A/B. Four poses, two arms, byte-identical camera per pose.
 *               Arm (i) is the scheduler at the candidate detail radius; arm
 *               (ii) is the scheduler with the exterior overlay disabled, i.e.
 *               DENSE-ONLY. Arm (ii) is deliberately not "flag off": flag off
 *               is the 484-artifact all-resident composition, which has MORE
 *               V3 than arm (i), and a control with more of the thing under
 *               test measures nothing.
 *
 *   crossing  — the transition artifact. Parks at a band crossing, captures
 *               consecutive frames and a settle series at t=0/1/2/4/8 s, and
 *               reports the dense plan counters that produced each still.
 *
 * Nothing here decides. The verdict is a human reading, recorded in ADR 0044.
 *
 * Usage:
 *   node scripts/transition-band-evidence-cli.mjs bundle   --dev http://localhost:4211
 *   node scripts/transition-band-evidence-cli.mjs poses    --dev … --port 9222 --radius 1200
 *   node scripts/transition-band-evidence-cli.mjs crossing --dev … --port 9222 --radius 1200
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = join(repositoryRoot, "data", "transition-band-20260814");

/**
 * The four A/B poses.
 *
 * Anchored on Block 835 — the ONLY cell in the promoted composition that ships
 * more than one declared LOD, and therefore the only place an eligible LOD
 * transition exists to be measured. Heights are the distance proxy the exterior
 * LOD thresholds are already evaluated against (`loadCell`'s
 * `lodDistanceMeters` is a bucketed camera ellipsoid height), so naming the
 * poses by height keeps the measurement and the mechanism on the same axis.
 */
const ANCHOR = { lon: -73.986359867, lat: 40.7487748165 };
const POSES = [
  { poseId: "block835-500m", ...ANCHOR, height: 500, heading: 45, pitch: -35, roll: 0 },
  { poseId: "block835-1km", ...ANCHOR, height: 1_000, heading: 45, pitch: -45, roll: 0 },
  { poseId: "block835-2km", ...ANCHOR, height: 2_000, heading: 45, pitch: -55, roll: 0 },
  { poseId: "block835-3km", ...ANCHOR, height: 3_000, heading: 45, pitch: -60, roll: 0 },
];

/**
 * The crossing start pose.
 *
 * The crossing itself is driven by REAL MOUSE DRAGS, not by a URL change. A URL
 * change is a full page reload — the execution context is destroyed, Cesium is
 * reconstructed, and what would be measured is a boot, not a transition. A
 * press-move-release drag over the globe canvas is the same thing a user does,
 * and it is the only way to observe a dense-plan swap inside one document.
 */
const CROSSING_START = { label: "crossing-start", lon: -73.986359867, lat: 40.7487748165, height: 1_200, heading: 0, pitch: -45, roll: 0 };
/** Enough leftward drags to carry the camera clear of Block 835's radius. */
const CROSSING_DRAGS = 6;
const CROSSING_DRAG_PX = -180;

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 300_000;
/**
 * The settle window. ADR 0043 measured a first island refresh at 1,358.7 ms and
 * the T004 record's slowest settled build at 131.4 ms allocation; 45 s is more
 * than an order of magnitude above the former and is the same order the T002
 * capture used (75 s) for a session that also had to fetch 484 artifacts. Arm
 * (ii) fetches none, so a shorter window is honest for both.
 */
const SETTLE_MS = 45_000;

function fail(message) { throw new Error(`transition-band-evidence: ${message}`); }

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

// ---------------------------------------------------------------------------
// PNG comparison
//
// Decoded here rather than hashed only, because "the two stills differ" is a
// far weaker statement than "0.8 % of pixels differ". A hash cannot tell a
// one-pixel antialiasing wobble from a whole layer drawn twice.
// ---------------------------------------------------------------------------

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) fail("not a PNG");
  let offset = 8;
  let width = 0; let height = 0; let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      const bitDepth = data[8]; colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) fail(`unsupported PNG (depth ${bitDepth}, colour type ${colorType})`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let source = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[source]; source += 1;
    const target = row * stride;
    for (let index = 0; index < stride; index += 1) {
      const value = raw[source + index];
      const left = index >= channels ? pixels[target + index - channels] : 0;
      const up = row > 0 ? pixels[target - stride + index] : 0;
      const upLeft = row > 0 && index >= channels ? pixels[target - stride + index - channels] : 0;
      let restored;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft);
        restored = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else fail(`unsupported PNG filter ${filter}`);
      pixels[target + index] = restored & 0xff;
    }
    source += stride;
  }
  return { width, height, channels, pixels };
}

/** Fraction of pixels whose any channel differs by more than `tolerance`. */
function pixelDifference(leftPng, rightPng, tolerance = 8) {
  const left = decodePng(leftPng); const right = decodePng(rightPng);
  if (left.width !== right.width || left.height !== right.height || left.channels !== right.channels) fail("stills differ in geometry, so a pixel diff would be meaningless");
  let differing = 0;
  for (let index = 0; index < left.pixels.length; index += left.channels) {
    for (let channel = 0; channel < 3; channel += 1) {
      if (Math.abs(left.pixels[index + channel] - right.pixels[index + channel]) > tolerance) { differing += 1; break; }
    }
  }
  const total = left.width * left.height;
  return { differingPixels: differing, totalPixels: total, differingFraction: Number((differing / total).toFixed(6)) };
}

// ---------------------------------------------------------------------------
// Minimal CDP client (the T004 shape, plus event capture for the network log)
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

  clearEvents() { this.events = []; }

  async screenshot() {
    const shot = await this.send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(shot.data, "base64");
  }

  close() { this.socket.close(); }
}

async function attach(port) {
  const listResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).catch(() => null);
  if (!listResponse?.ok) fail(`could not open a tab on the debugging port ${port}; start Chrome with --remote-debugging-port=${port}`);
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
  return { session, targetId: target.id };
}

const READ_SCHEDULER_PROBE = `(() => {
  const node = document.querySelector("[data-exterior-scheduler-probe]");
  if (!node) return null;
  const probe = JSON.parse(node.textContent);
  // The trace is unbounded and is not what this task measures; the last entry
  // is enough to show WHICH footprint the reported decision belongs to.
  return { ...probe, trace: probe.trace.slice(-1), traceLength: probe.traceLength };
})()`;

const READ_CITYWIDE_PROBE = `(() => {
  const node = document.querySelector("[data-citywide-overview-probe]");
  if (!node) return null;
  const probe = JSON.parse(node.textContent);
  return { adapterMetrics: probe.adapterMetrics, denseMetrics: probe.denseMetrics, cache: probe.cache, overviewResidencyActive: probe.overviewResidencyActive };
})()`;

function sessionUrl(dev, pose, arm, radiusMeters) {
  const url = new URL(dev);
  url.searchParams.set("data", "real-pilot");
  url.searchParams.set("release", "manhattan-citywide-20260804");
  url.searchParams.set("view", "free");
  url.searchParams.set("exteriorScheduler", "on");
  if (arm === "dense-only") url.searchParams.set("exteriorStreaming", "off");
  else if (radiusMeters !== null) url.searchParams.set("exteriorDetailRadius", String(radiusMeters));
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
    await session.evaluate("new Promise((done) => setTimeout(done, 500))");
  }
}

const sleep = (session, ms) => session.evaluate(`new Promise((done) => setTimeout(done, ${ms}))`);

const CENTRE = { x: Math.round(VIEWPORT.width / 2), y: Math.round(VIEWPORT.height / 2) };

/**
 * One press-move-release drag over the globe canvas, the T002 shape.
 *
 * The trailing settle is 2.6 s because Cesium's camera keeps spinning on
 * inertia after release and `moveEnd` — the event the footprint is sampled on,
 * and therefore the event that triggers a scheduler decision — fires only once
 * that decays.
 */
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
// bundle
// ---------------------------------------------------------------------------

async function runBundle(argv) {
  const dev = argValue(argv, "--dev", "http://localhost:4211");
  const index = await (await fetch(dev)).text();
  const scripts = [...index.matchAll(/src="([^"]+\.js)"/gu)].map((match) => match[1]);
  const assets = [];
  for (const relative of scripts) {
    const bytes = new Uint8Array(await (await fetch(new URL(relative, dev))).arrayBuffer());
    assets.push({ ref: relative, byteSize: bytes.byteLength, sha256: sha256HexBytes(bytes) });
  }
  const record = {
    schemaVersion: "1.0",
    taskId: "T005",
    artifact: "transition-band-served-bundle",
    note: "The bytes the preview server SERVES, not the bytes on disk. Every pose and crossing record below names this bundle hash, so a claim can never drift onto a build it was not measured on.",
    origin: dev,
    indexSha256: sha256HexSync(index),
    indexByteSize: Buffer.byteLength(index),
    probes: { exteriorScheduler: index.length > 0, note: "Probe presence is asserted from the live DOM in the pose stage, not from the HTML." },
    assets,
  };
  const checksum = await writeArtifact("served-bundle.json", record);
  console.log(JSON.stringify({ indexSha256: record.indexSha256, assetCount: assets.length, checksum }, null, 2));
  return record;
}

// ---------------------------------------------------------------------------
// poses
// ---------------------------------------------------------------------------

async function capturePose(dev, port, pose, arm, radiusMeters) {
  const { session, targetId } = await attach(port);
  try {
    const url = sessionUrl(dev, pose, arm, radiusMeters);
    await session.send("Page.navigate", { url });
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.traceLength > 0, `${pose.poseId}/${arm} scheduler probe`);
    if (arm !== "dense-only") await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, `${pose.poseId}/${arm} exterior activation`);
    await waitFor(session, READ_CITYWIDE_PROBE, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0, `${pose.poseId}/${arm} dense build`);
    await sleep(session, SETTLE_MS);
    const settledScheduler = await session.evaluate(READ_SCHEDULER_PROBE);
    const settledCitywide = await session.evaluate(READ_CITYWIDE_PROBE);
    const still = await session.screenshot();
    const hrefAfterSettle = await session.evaluate("window.location.href");
    return {
      poseId: pose.poseId,
      arm,
      url,
      hrefAfterSettle,
      settleMs: SETTLE_MS,
      schedulerRequested: settledScheduler.schedulerRequested,
      detailRadiusMeters: settledScheduler.detailRadiusMeters,
      exteriorStreamingActive: settledScheduler.exteriorStreamingActive,
      decision: settledScheduler.decision,
      waves: settledScheduler.waves,
      lastTraceSample: settledScheduler.trace?.[0] ?? null,
      dense: settledCitywide?.denseMetrics ?? null,
      adapter: settledCitywide?.adapterMetrics ?? null,
      cache: settledCitywide?.cache ?? null,
      network: { externalHosts: externalHosts(session, dev), responseCount: session.responses().length },
      stillSha256: sha256HexBytes(new Uint8Array(still)),
      still,
    };
  } finally {
    session.close();
    // Each pose is its own tab. Left open, eight live Cesium scenes would share
    // one GPU process and the later poses would be measured against the earlier
    // ones' residency, which is not what a per-pose capture means.
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => null);
  }
}

async function runPoses(argv) {
  const dev = argValue(argv, "--dev", "http://localhost:4211");
  const port = Number(argValue(argv, "--port", "9222"));
  const radiusMeters = Number(argValue(argv, "--radius", "1200"));
  const bundle = await runBundle(argv);
  const captures = [];
  for (const pose of POSES) {
    for (const arm of ["radius", "dense-only"]) {
      const capture = await capturePose(dev, port, pose, arm, radiusMeters);
      await mkdir(join(evidenceRoot, "captures"), { recursive: true });
      await writeFile(join(evidenceRoot, "captures", `${pose.poseId}-${arm}.png`), capture.still);
      const rest = { ...capture };
      delete rest.still;
      captures.push(rest);
      console.error(`captured ${pose.poseId}/${arm}: visible=${rest.decision?.visibleCount ?? "-"} deferred=${rest.decision?.deferredCount ?? "-"} suppressed=${rest.dense?.exteriorSuppressedFeatureCount ?? "-"} buildings=${rest.dense?.buildingFeatureCount ?? "-"}`);
    }
  }
  const record = {
    schemaVersion: "1.0",
    taskId: "T005",
    artifact: "transition-band-ab",
    note: "Arm `radius` is the scheduler at the candidate detail radius; arm `dense-only` is the scheduler with the exterior overlay disabled. Arm `dense-only` is NOT flag-off. These are residency, request and rendered-count numbers plus stills; nothing here is a frame-time or GPU-memory claim (ADR 0040 D7).",
    servedBundle: { indexSha256: bundle.indexSha256, assets: bundle.assets.map((asset) => asset.sha256) },
    viewport: VIEWPORT,
    candidateRadiusMeters: radiusMeters,
    settleMs: SETTLE_MS,
    capturedAtIso: new Date().toISOString(),
    poses: POSES,
    captures,
  };
  const checksum = await writeArtifact("ab-evidence.json", record);
  console.log(JSON.stringify({ captureCount: captures.length, checksum }, null, 2));
}

// ---------------------------------------------------------------------------
// crossing
// ---------------------------------------------------------------------------

async function runCrossing(argv) {
  const dev = argValue(argv, "--dev", "http://localhost:4211");
  const port = Number(argValue(argv, "--port", "9222"));
  const radiusMeters = Number(argValue(argv, "--radius", "1200"));
  const bundle = await runBundle(argv);
  const { session } = await attach(port);
  try {
    await session.send("Page.navigate", { url: sessionUrl(dev, CROSSING_START, "radius", radiusMeters) });
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "crossing bootstrap");
    await waitFor(session, READ_CITYWIDE_PROBE, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0, "crossing dense build");
    await sleep(session, SETTLE_MS);

    const before = await session.evaluate(READ_CITYWIDE_PROBE);
    const beforeScheduler = await session.evaluate(READ_SCHEDULER_PROBE);
    const beforeStill = await session.screenshot();

    // The crossing itself: real drags in ONE document, so the dense plan is
    // asked to change without the page reloading.
    const startedAt = Date.now();
    for (let step = 0; step < CROSSING_DRAGS; step += 1) await drag(session, CROSSING_DRAG_PX, 0);

    // Consecutive frames, taken as fast as the protocol allows: two stills that
    // differ here are two stills the user would have seen in successive frames.
    const consecutive = [];
    for (let index = 0; index < 4; index += 1) {
      const still = await session.screenshot();
      const probe = await session.evaluate(READ_CITYWIDE_PROBE);
      consecutive.push({ index, elapsedMs: Date.now() - startedAt, sha256: sha256HexBytes(new Uint8Array(still)), dense: probe?.denseMetrics ?? null, still });
    }

    // The settle series.
    const settleSeries = [];
    let previous = null;
    for (const seconds of [0, 1, 2, 4, 8]) {
      const target = startedAt + seconds * 1_000;
      const wait = target - Date.now();
      if (wait > 0) await sleep(session, wait);
      const still = await session.screenshot();
      const probe = await session.evaluate(READ_CITYWIDE_PROBE);
      const scheduler = await session.evaluate(READ_SCHEDULER_PROBE);
      settleSeries.push({
        seconds,
        elapsedMs: Date.now() - startedAt,
        sha256: sha256HexBytes(new Uint8Array(still)),
        differenceFromPrevious: previous ? pixelDifference(previous, still) : null,
        differenceFromBefore: pixelDifference(beforeStill, still),
        dense: probe?.denseMetrics ?? null,
        decision: scheduler?.decision ?? null,
        still,
      });
      previous = still;
    }
    await sleep(session, SETTLE_MS);
    const after = await session.evaluate(READ_CITYWIDE_PROBE);
    const afterScheduler = await session.evaluate(READ_SCHEDULER_PROBE);
    const afterStill = await session.screenshot();

    await mkdir(join(evidenceRoot, "captures"), { recursive: true });
    await writeFile(join(evidenceRoot, "captures", "crossing-before.png"), beforeStill);
    await writeFile(join(evidenceRoot, "captures", "crossing-after.png"), afterStill);
    for (const entry of consecutive) await writeFile(join(evidenceRoot, "captures", `crossing-frame-${entry.index}.png`), entry.still);
    for (const entry of settleSeries) await writeFile(join(evidenceRoot, "captures", `crossing-settle-${entry.seconds}s.png`), entry.still);

    const record = {
      schemaVersion: "1.0",
      taskId: "T005",
      artifact: "transition-band-crossing",
      note: "One band crossing, driven by a same-document camera change so the dense plan is asked to change without a reload. The plan counters beside each still are what the renderer did; the stills are what a viewer would have seen.",
      servedBundle: { indexSha256: bundle.indexSha256 },
      viewport: VIEWPORT,
      candidateRadiusMeters: radiusMeters,
      crossing: { start: CROSSING_START, dragCount: CROSSING_DRAGS, dragPx: CROSSING_DRAG_PX, transport: "Chrome DevTools Protocol, real Input.dispatchMouseEvent drags in one document" },
      before: { dense: before?.denseMetrics ?? null, decision: beforeScheduler?.decision ?? null, waves: beforeScheduler?.waves ?? null, sha256: sha256HexBytes(new Uint8Array(beforeStill)) },
      consecutiveFrames: consecutive.map((entry) => { const rest = { ...entry, differenceFromBefore: pixelDifference(beforeStill, entry.still) }; delete rest.still; return rest; }),
      settleSeries: settleSeries.map((entry) => { const rest = { ...entry }; delete rest.still; return rest; }),
      after: { dense: after?.denseMetrics ?? null, decision: afterScheduler?.decision ?? null, waves: afterScheduler?.waves ?? null, sha256: sha256HexBytes(new Uint8Array(afterStill)), differenceFromBefore: pixelDifference(beforeStill, afterStill) },
      network: { externalHosts: externalHosts(session, dev) },
    };
    const checksum = await writeArtifact("crossing-evidence.json", record);
    console.log(JSON.stringify({ checksum, settle: record.settleSeries.map((entry) => ({ s: entry.seconds, diff: entry.differenceFromBefore.differingFraction, builds: entry.dense?.planBuildCount, swaps: entry.dense?.planSwapCount })) }, null, 2));
  } finally { session.close(); }
}

const [stage, ...argv] = process.argv.slice(2);
const stages = { bundle: runBundle, poses: runPoses, crossing: runCrossing };
if (!stages[stage]) {
  console.error("usage: transition-band-evidence-cli.mjs <bundle|poses|crossing> [--dev url] [--port 9222] [--radius 1200]");
  process.exitCode = 1;
} else {
  await stages[stage](argv);
}
