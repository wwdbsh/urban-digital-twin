/* global console, process, WebSocket, fetch, setTimeout, URL, TextEncoder */
/**
 * T002 capture: a REAL Cesium camera trace, and the opt-in's two measured numbers.
 *
 * The thrash gate is a deterministic offline replay through the pure scheduler.
 * That only means anything if what it replays is a real camera path, so the
 * poses and — crucially — the ground-ray FOOTPRINTS are recorded out of the
 * shipping renderer over the Chrome DevTools Protocol, exactly as
 * `lower-manhattan-probe-capture-cli.mjs` and `northern-manhattan-journeys-p1-cli.mjs`
 * record theirs. A synthetic camera path would only prove the scheduler agrees
 * with the model that generated it.
 *
 * Two named paths, both driven by real mouse input rather than by setting the
 * camera, so Cesium's own inertia, terrain sampling and horizon behaviour are in
 * the recording:
 *
 *   `midtown-street-pan-v1`   street-level eastward pan across the boundary
 *                             between ledger cells order 31 and order 32.
 *   `midtown-zoom-out-v1`     zoom out from street level through the 1.2-2.4 km
 *                             band ADR 0040 named, to citywide altitude.
 *
 * The trace is captured with `exteriorStreaming=off`. What is being recorded is
 * camera geometry — pose and the footprint Cesium sampled — and no exterior wave
 * participates in producing either. Capturing with six waves streaming would add
 * tens of minutes of asset loading to a recording of where the camera went. That
 * choice is recorded in the provenance rather than left for a reader to infer.
 *
 * The `evidence` run is the opposite: it is entirely about exterior loading, so
 * it runs the real promoted default twice at ONE pose, once without the flag and
 * once with it, and reports the two numbers the ADR quotes.
 *
 * Preconditions, refused loudly:
 *   1. a preview server built with VITE_EXTERIOR_SCHEDULER_PROBE=1 is serving;
 *   2. Chrome is listening on the given remote-debugging port.
 *
 * Usage:
 *   node scripts/exterior-scheduler-trace-capture-cli.mjs trace   --preview http://127.0.0.1:4173 --port 9222
 *   node scripts/exterior-scheduler-trace-capture-cli.mjs evidence --preview http://127.0.0.1:4173 --port 9222
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes } from "../src/domain/deterministic-hash.ts";
import { CITYWIDE_OVERVIEW_CELL_EXTENTS } from "../src/runtime/citywide-overview-cell-extents.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const traceRoot = join(repositoryRoot, "data", "exterior-scheduler-traces-20260814");

const BASE_RELEASE_ID = "manhattan-citywide-20260804";
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 240_000;

/** The two cells the pan is required to cross between. Bounds come from the census, not from here. */
const PAN_FROM_ORDER = 31;
const PAN_TO_ORDER = 32;

function fail(message) { throw new Error(`exterior-scheduler-trace-capture: ${message}`); }
function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

// ---------------------------------------------------------------------------
// Minimal CDP client (same shape as the two capture CLIs already in this repo)
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

  close() { this.socket.close(); }
}

async function openFreshPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
    .catch(() => fail(`Chrome is not listening on 127.0.0.1:${port}.`));
  if (!response.ok) fail(`Chrome refused a new page target (${response.status}).`);
  const created = await response.json();
  const socket = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", () => rejectPromise(new Error("the CDP websocket failed to open")), { once: true });
  });
  const session = new CdpSession(socket);
  session.targetId = created.id;
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Network.enable");
  await session.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });
  return session;
}

async function closePage(port, session) {
  session.close();
  try { await fetch(`http://127.0.0.1:${port}/json/close/${session.targetId}`); } catch { /* going away either way */ }
}

function appUrl(previewBase, { pose, params = {} }) {
  const url = new URL(previewBase);
  url.pathname = "/";
  url.searchParams.set("data", BASE_RELEASE_ID);
  url.searchParams.set("release", BASE_RELEASE_ID);
  url.searchParams.set("view", "explore");
  for (const [key, value] of Object.entries(pose)) url.searchParams.set(key, value.toFixed(6));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

const READ_PROBE = `(() => {
  const node = document.querySelector('[data-exterior-scheduler-probe]');
  return node ? node.textContent : null;
})()`;

async function waitForProbe(session, predicate, label) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = null;
  let sawProbe = false;
  for (;;) {
    if (Date.now() > deadline) {
      // The two failures are different and must not be reported as one: a
      // bundle without the probe never had one, and a session that has one but
      // never reached the predicate is a real settle failure.
      if (!sawProbe) fail(`${label}: the served bundle carries no scheduler probe element. Build the preview with VITE_EXTERIOR_SCHEDULER_PROBE=1.`);
      fail(`${label} never settled (last: ${JSON.stringify(last)?.slice(0, 300)}).`);
    }
    await sleep(750);
    const text = await session.evaluate(READ_PROBE).catch(() => null);
    if (typeof text !== "string") continue;
    sawProbe = true;
    last = JSON.parse(text);
    if (predicate(last)) return last;
  }
}

// ---------------------------------------------------------------------------
// Real mouse input
// ---------------------------------------------------------------------------

const CENTRE = { x: Math.round(VIEWPORT.width / 2), y: Math.round(VIEWPORT.height / 2) };

/**
 * One press-move-release drag over the globe canvas.
 *
 * The settle window is 2.6 s and not a guess: Cesium's camera keeps spinning on
 * inertia after the pointer is released, and `moveEnd` — the event the footprint
 * is sampled on — fires only once that decays. A 1.2 s window was tried first
 * and recorded three samples for fourteen drags, because most drags ended after
 * the read. The leading `mouseMoved` is likewise deliberate: the camera event
 * aggregator needs a current pointer position before the press.
 */
async function drag(session, dx, dy, button = "left") {
  const buttons = button === "right" ? 2 : 1;
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: CENTRE.x, y: CENTRE.y, buttons: 0 });
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: CENTRE.x, y: CENTRE.y, button, clickCount: 1, buttons });
  const steps = 10;
  for (let step = 1; step <= steps; step += 1) {
    await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(CENTRE.x + dx * step / steps), y: Math.round(CENTRE.y + dy * step / steps), button, buttons });
    await sleep(30);
  }
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: CENTRE.x + dx, y: CENTRE.y + dy, button, clickCount: 1, buttons: 0 });
  await sleep(button === "right" ? 1_800 : 2_600);
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function extentOfOrder(order) {
  const entry = CITYWIDE_OVERVIEW_CELL_EXTENTS.find((candidate) => candidate.order === order);
  if (!entry) fail(`the committed census carries no cell of order ${order}.`);
  return entry;
}

/**
 * A street-level camera inside cell `PAN_FROM_ORDER`, derived from that cell's
 * committed render extent rather than typed by hand, so "the pan starts inside
 * this cell" is a fact about the census and not a claim.
 */
function panStartPose() {
  const from = extentOfOrder(PAN_FROM_ORDER);
  return {
    lon: from.renderBounds.west + 0.2 * (from.renderBounds.east - from.renderBounds.west),
    lat: (from.renderBounds.south + from.renderBounds.north) / 2,
    height: 220,
    // Heading north so a horizontal screen drag is an east-west camera move,
    // which is the axis the order-31/order-32 boundary runs across.
    heading: 0,
    pitch: -30,
    roll: 0,
  };
}

function contains(bounds, longitude, latitude) {
  return longitude >= bounds.west && longitude <= bounds.east && latitude >= bounds.south && latitude <= bounds.north;
}

/** Refuse a trace that does not do what its name says. */
function assertPanCrossedBoundary(path) {
  const from = extentOfOrder(PAN_FROM_ORDER);
  const to = extentOfOrder(PAN_TO_ORDER);
  const inFrom = path.samples.filter((sample) => contains(from.renderBounds, sample.camera.longitude, sample.camera.latitude));
  const inTo = path.samples.filter((sample) => contains(to.renderBounds, sample.camera.longitude, sample.camera.latitude));
  if (inFrom.length === 0 || inTo.length === 0) {
    fail(`${path.pathId} did not cross the ${from.cellId} -> ${to.cellId} boundary (${inFrom.length} samples in the first cell, ${inTo.length} in the second). The trace is not what its name claims and was not written.`);
  }
  return { fromSampleCount: inFrom.length, toSampleCount: inTo.length };
}

function assertZoomCrossedBand(path) {
  const inBand = path.samples.filter((sample) => sample.camera.height >= 1_200 && sample.camera.height <= 2_400);
  if (inBand.length < 3) fail(`${path.pathId} recorded only ${inBand.length} samples inside the 1.2-2.4 km band; at least 3 are required for the band to be traversed rather than jumped.`);
  const heights = path.samples.map((sample) => sample.camera.height);
  return { inBandSampleCount: inBand.length, minHeightMeters: Math.min(...heights), maxHeightMeters: Math.max(...heights) };
}

async function capturePath(port, previewBase, pathId, pose, drive) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose, params: { exteriorStreaming: "off" } });
    await session.send("Page.navigate", { url });
    await waitForProbe(session, (probe) => probe.traceLength >= 1, `${pathId} first camera sample`);
    await drive(session);
    const probe = await waitForProbe(session, (probe) => probe.traceLength >= 2, `${pathId} trace`);
    const href = await session.evaluate("window.location.href");
    return {
      pathId,
      capturedAtIso: new Date().toISOString(),
      startPose: pose,
      finalHref: href,
      sampleCount: probe.trace.length,
      samples: probe.trace,
    };
  } finally {
    await closePage(port, session);
  }
}

async function captureTraces(port, previewBase) {
  const pan = await capturePath(port, previewBase, "midtown-street-pan-v1", panStartPose(), async (session) => {
    // Dragging the globe WEST under the cursor moves the camera EAST, which is
    // the direction that crosses from cell order 31 into order 32.
    for (let step = 0; step < 12; step += 1) await drag(session, -150, 0);
  });
  pan.crossing = assertPanCrossedBoundary(pan);
  const zoom = await capturePath(port, previewBase, "midtown-zoom-out-v1", { ...panStartPose(), pitch: -45, height: 400 }, async (session) => {
    // Right-drag is Cesium's continuous zoom. The wheel was tried first and
    // rejected on its own evidence: one notch took the camera from 220 m to
    // 27,843 m, which jumps the 1.2-2.4 km band rather than traversing it.
    for (let step = 0; step < 20; step += 1) await drag(session, 0, -12, "right");
  });
  zoom.band = assertZoomCrossedBand(zoom);
  return { pan, zoom };
}

// ---------------------------------------------------------------------------
// Evidence: the opt-in's two measured numbers at one recorded pose
// ---------------------------------------------------------------------------

/**
 * Two cameras, because "visibility-driven" is a claim about how residency
 * CHANGES with the camera, and one pose can only show that it is smaller.
 *
 * Both are derived from Block 835's committed render extent rather than typed:
 * the same ground point, at street level and at overview altitude.
 */
function evidencePoses() {
  const block835 = extentOfOrder(0);
  const ground = {
    lon: (block835.renderBounds.west + block835.renderBounds.east) / 2,
    lat: (block835.renderBounds.south + block835.renderBounds.north) / 2,
  };
  return [
    { poseId: "block835-street-260m", ...ground, height: 260, heading: 45, pitch: -20, roll: 0 },
    { poseId: "midtown-overview-2400m", ...ground, height: 2_400, heading: 0, pitch: -60, roll: 0 },
  ];
}

function networkTotals(session) {
  const responses = new Map(session.events
    .filter((event) => event.method === "Network.responseReceived")
    .map((event) => [event.params.requestId, event.params.response.url]));
  const finished = session.events
    .filter((event) => event.method === "Network.loadingFinished")
    .map((event) => ({ url: responses.get(event.params.requestId) ?? "", bytes: event.params.encodedDataLength ?? 0 }));
  const glbs = finished.filter((entry) => entry.url.endsWith(".glb"));
  const externalHosts = [...new Set(finished
    .map((entry) => { try { return new URL(entry.url).host; } catch { return ""; } })
    .filter((host) => host !== "" && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")))];
  return {
    glbResponseCount: glbs.length,
    distinctGlbCount: new Set(glbs.map((entry) => entry.url)).size,
    glbEncodedBytes: glbs.reduce((total, entry) => total + entry.bytes, 0),
    externalHosts,
  };
}

function summarizeWaves(probe) {
  const waves = probe.waves.filter((wave) => wave.metrics !== null);
  const total = (key) => waves.reduce((sum, wave) => sum + (wave.metrics[key] ?? 0), 0);
  return {
    waveCount: waves.length,
    declaredCellCount: waves.reduce((sum, wave) => sum + wave.declaredCellCount, 0),
    scheduledCellCount: total("scheduledCellCount"),
    deferredCellCount: total("deferredCellCount"),
    requestedArtifactCount: total("requestedArtifactCount"),
    loadedArtifactCount: total("loadedArtifactCount"),
    // The exterior waves share ONE cache instance, so these are read from the
    // first wave rather than summed: summing would multiply one pool by six.
    cacheEntries: waves[0]?.metrics.cacheEntries ?? 0,
    cachedBytes: waves[0]?.metrics.cachedBytes ?? 0,
    perWave: waves.map((wave) => ({ releaseId: wave.releaseId, declaredCellCount: wave.declaredCellCount, scheduledCellCount: wave.metrics.scheduledCellCount, deferredCellCount: wave.metrics.deferredCellCount, requestedArtifactCount: wave.metrics.requestedArtifactCount })),
  };
}

async function captureVariant(port, previewBase, variantId, params, settleMs, pose) {
  const session = await openFreshPage(port);
  try {
    session.events.length = 0;
    const { poseId, ...cameraPose } = pose;
    const url = appUrl(previewBase, { pose: cameraPose, params });
    await session.send("Page.navigate", { url });
    await waitForProbe(session, (probe) => probe.waves.length >= 6 && probe.waves.every((wave) => wave.metrics !== null), `${variantId} waves`);
    // A fixed settle window rather than a "loading finished" signal: the default
    // variant never finishes, which is the point being measured.
    await sleep(settleMs);
    const probe = await waitForProbe(session, () => true, `${variantId} settle`);
    // The URL round-trip check, done in the real browser after a real drag: a
    // parameter that survives boot and dies on the first pan is not a flag.
    await drag(session, -60, 0);
    const hrefAfterDrag = await session.evaluate("window.location.href");
    return {
      variantId,
      poseId,
      url,
      settleMs,
      hrefAfterDrag,
      schedulerRequested: probe.schedulerRequested,
      waves: summarizeWaves(probe),
      network: networkTotals(session),
    };
  } finally {
    await closePage(port, session);
  }
}

// ---------------------------------------------------------------------------

async function writeRecord(relativeName, body) {
  const path = join(traceRoot, relativeName);
  await mkdir(dirname(path), { recursive: true });
  const serialized = `${JSON.stringify(body, null, 2)}\n`;
  await writeFile(path, serialized);
  const digest = sha256HexBytes(new TextEncoder().encode(serialized));
  await writeFile(`${path.replace(/\.json$/u, "")}.sha256`, `${digest}  ${relativeName}\n`);
  console.log(`exterior-scheduler-trace-capture: wrote ${relativeName} (${serialized.length} bytes, sha256 ${digest}).`);
  return digest;
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const previewBase = argValue(argv, "--preview", "http://127.0.0.1:4173").replace(/\/$/u, "");
  const port = Number(argValue(argv, "--port", "9222"));

  if (command === "trace") {
    const { pan, zoom } = await captureTraces(port, previewBase);
    await writeRecord("camera-traces.json", {
      schemaVersion: "1.0",
      recordId: "exterior-scheduler-traces-20260814",
      taskId: "T002",
      capture: {
        tool: "scripts/exterior-scheduler-trace-capture-cli.mjs trace",
        renderer: "shipping CesiumJS viewport, preview build with VITE_EXTERIOR_SCHEDULER_PROBE=1",
        transport: "Chrome DevTools Protocol, real Input.dispatchMouseEvent drags and wheels",
        viewport: VIEWPORT,
        baseReleaseId: BASE_RELEASE_ID,
        exteriorStreaming: "off",
        exteriorStreamingNote: "These traces record CAMERA GEOMETRY — pose and the ground-ray footprint Cesium sampled. No exterior wave participates in producing either, so the exterior overlay is switched off to keep a camera recording from also being a multi-wave asset load. Nothing here is evidence about exterior loading; the `evidence` record is.",
        capturedAtIso: new Date().toISOString(),
      },
      panBoundary: { fromOrder: PAN_FROM_ORDER, toOrder: PAN_TO_ORDER, fromCellId: extentOfOrder(PAN_FROM_ORDER).cellId, toCellId: extentOfOrder(PAN_TO_ORDER).cellId },
      paths: [pan, zoom],
    });
    return;
  }

  if (command === "evidence") {
    const settleMs = Number(argValue(argv, "--settle", "60000"));
    const variants = [];
    for (const pose of evidencePoses()) {
      variants.push(await captureVariant(port, previewBase, "default", {}, settleMs, pose));
      variants.push(await captureVariant(port, previewBase, "scheduler-on", { exteriorScheduler: "on" }, settleMs, pose));
    }
    await writeRecord("optin-evidence.json", {
      schemaVersion: "1.0",
      recordId: "exterior-scheduler-optin-evidence-20260814",
      taskId: "T002",
      capture: {
        tool: "scripts/exterior-scheduler-trace-capture-cli.mjs evidence",
        renderer: "shipping CesiumJS viewport, preview build with VITE_EXTERIOR_SCHEDULER_PROBE=1",
        viewport: VIEWPORT,
        baseReleaseId: BASE_RELEASE_ID,
        poses: evidencePoses(),
        settleMs,
        capturedAtIso: new Date().toISOString(),
        note: "Both variants ran the real promoted default at each pose with a fixed settle window. These are artifact-request and cache-residency numbers only. Nothing here is a frame-time, GPU-memory or rendered-fidelity claim (ADR 0040 D7).",
        httpCacheCaveat: "`Network.setCacheDisabled` is not called and the sessions share one Chrome profile; a fresh page target is not a fresh cache. The `.glb` columns are usable regardless because the exterior fetcher passes `cache: \"no-store\"`, so an exterior artifact cannot be served from the HTTP cache, and the columns filter to `.glb` only. Non-exterior resources in the same session may well be cache hits and are counted by no figure here. `requestedArtifactCount`, `cacheEntries` and `cachedBytes` come from the runtime\u2019s own counters and are unaffected.",
      },
      variants,
    });
    return;
  }

  fail(`unknown command ${String(command)}. Use \`trace\` or \`evidence\`.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
