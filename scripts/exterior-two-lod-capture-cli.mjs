/* global console, process, fetch, WebSocket, URL, setTimeout, clearTimeout, Buffer */
/**
 * T001 — the six ADR 0057 §4.2 poses, captured against the PROMOTED `-s2`
 * two-LOD composition.
 *
 * ## What this measures, and how it knows which LOD drew
 *
 * The strongest available signal is the WIRE: a two-LOD release ships
 * `…__lod_0.glb` and `…__lod_1.glb` as separate artifacts, so the set of GLB
 * URLs a document actually fetched says which level the runtime resolved. That
 * is a request-level reading, not a pixel-level one, and it is labelled as such
 * everywhere it appears — nothing here claims a building LOOKS coarse, only
 * that the coarse artifact was or was not fetched.
 *
 * P2 is the pose only a browser can prove. The ring-side crossing is a RELOAD
 * seam: crossing 400 m changes which level covers a cell, and the runtime must
 * re-resolve rather than keep serving the level it already had. A unit test can
 * pin the selector; only a live session can show the fetch actually happening
 * on the far side and not on the near one.
 *
 * ## Discipline
 *
 * Single attempt per pose. A FAIL is RECORDED and not re-run — the poses and
 * their gates were registered in ADR 0057 §4.2 before any capture existed, and
 * re-running a pose until it passes is the failure that pre-registration
 * exists to prevent. P4 records and does not gate, by registration.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS } from "../src/release/exterior-serving-release.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";

const run = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "exterior-two-lod-serving-20260818";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);

const PORT = 9227;
const USER_DATA_DIR = "/tmp/t001-two-lod-chrome";
const CHROME_LAUNCH_COMMAND = `open -na "Google Chrome" --args --remote-debugging-port=${PORT} --user-data-dir=${USER_DATA_DIR} --no-first-run --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`;
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 300_000;
const EVALUATE_TIMEOUT_MS = 120_000;
const SETTLE_MS = 20_000;

const ANCHOR = { lon: -73.986360, lat: 40.748775 };
/** w03 southern-remainder, which carries 289 of the 424 measured-fallback parents. */
const W03_FALLBACK = { lon: -73.997760, lat: 40.735275 };
/** The sparse island edge named by ADR 0057 §1.5. */
const SPARSE_EDGE = { lon: -73.929000, lat: 40.870000 };

/**
 * The six poses, exactly as ADR 0057 §4.2 registered them. Heights are chosen
 * so the camera's DISTANCE to its resident cells straddles the 400 m ring in
 * the direction each pose names; the ring is a distance, not a height, and the
 * capture records the measured per-cell distances rather than assuming them.
 */
const POSES = [
  { poseId: "P1", label: "street level, dense midtown, camera inside a cell", ...ANCHOR, height: 180, heading: 45, pitch: -20, roll: 0, gates: true },
  { poseId: "P2", label: "400 m boundary straddle, dense midtown", ...ANCHOR, height: 400, heading: 45, pitch: -35, roll: 0, gates: true },
  { poseId: "P3", label: "mid ring, dense midtown, above 400 m from every resident cell", ...ANCHOR, height: 1_100, heading: 45, pitch: -45, roll: 0, gates: true },
  { poseId: "P4", label: "sparse island edge (ADR 0057 section 1.5 limitation)", ...SPARSE_EDGE, height: 300, heading: 0, pitch: -30, roll: 0, gates: false },
  { poseId: "P5", label: "w03 cell carrying measured-fallback parents", ...W03_FALLBACK, height: 700, heading: 45, pitch: -40, roll: 0, gates: true },
  { poseId: "P6", label: "Block 835 by explicit deep link", ...ANCHOR, height: 200, heading: 0, pitch: -30, roll: 0, gates: true, releaseId: "manhattan-exterior-cells-20260811-v3-s2" },
];

function fail(message) { throw new Error(`two-lod-capture: ${message}`); }
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const wait = (ms) => new Promise((done) => { setTimeout(done, ms); });
function argValue(argv, name, fallback) {
  const found = argv.find((token) => token.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}
async function withTimeout(promise, ms, what) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_r, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${what}`)), ms); })]);
  } finally { clearTimeout(timer); }
}

class CdpSession {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map(); this.events = [];
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
  async evaluate(expression, what = "page evaluation") {
    const result = await withTimeout(this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), EVALUATE_TIMEOUT_MS, what);
    if (result.exceptionDetails) fail(`${what} threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  }
  async screenshot(what = "still") {
    const result = await withTimeout(this.send("Page.captureScreenshot", { format: "png" }), EVALUATE_TIMEOUT_MS, what);
    return Buffer.from(result.data, "base64");
  }
  responses() { return this.events.filter((event) => event.method === "Network.responseReceived").map((event) => event.params.response); }
  close() { try { this.socket.close(); } catch { /* already gone */ } }
}

async function attach(initialUrl) {
  const listResponse = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(initialUrl)}`, { method: "PUT" }).catch(() => null);
  if (!listResponse?.ok) fail(`could not open a tab on debugging port ${PORT}. Launch line: ${CHROME_LAUNCH_COMMAND}`);
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

async function killChrome() {
  await run("/usr/bin/pkill", ["-f", USER_DATA_DIR.replace("/tmp/", "")]).catch(() => null);
  await wait(1_500);
  const remaining = await run("/usr/bin/pgrep", ["-f", USER_DATA_DIR.replace("/tmp/", "")]).then(
    ({ stdout }) => stdout.split("\n").filter((line) => line.trim().length > 0).length,
    () => 0,
  );
  if (remaining > 0) console.error(`two-lod-capture: WARNING — ${remaining} scratch Chrome processes survived cleanup.`);
  return remaining;
}

const READ_PROBE = `(() => {
  const node = document.querySelector("[data-exterior-scheduler-probe]");
  if (!node) return null;
  const probe = JSON.parse(node.textContent);
  const decision = probe.decision || {};
  const distances = decision.distanceMetersByUnitId
    ? (Array.isArray(decision.distanceMetersByUnitId) ? decision.distanceMetersByUnitId : Object.entries(decision.distanceMetersByUnitId))
    : [];
  return {
    exteriorStreamingActive: probe.exteriorStreamingActive,
    residentUnitIds: decision.residentUnitIds || [],
    distances,
    waves: (probe.waves || []).map((wave) => ({ releaseId: wave.releaseId, metrics: wave.metrics })),
  };
})()`;

/**
 * WHICH LEVELS THE DOCUMENT ACTUALLY FETCHED.
 *
 * A request-level reading. It says the coarse artifact was or was not pulled
 * over the wire; it says nothing about what a pixel looks like.
 */
const READ_LOD_REQUESTS = `(() => {
  const glb = performance.getEntriesByType("resource").filter((entry) => entry.name.split("?")[0].endsWith(".glb"));
  const lod0 = glb.filter((entry) => entry.name.includes("__lod_0.glb"));
  const lod1 = glb.filter((entry) => entry.name.includes("__lod_1.glb"));
  const name = (entry) => entry.name.split("/").pop().split("?")[0];
  return {
    glbRequestCount: glb.length,
    lod0RequestCount: lod0.length,
    lod1RequestCount: lod1.length,
    lod0DistinctCount: new Set(lod0.map(name)).size,
    lod1DistinctCount: new Set(lod1.map(name)).size,
    lod0Sample: [...new Set(lod0.map(name))].sort().slice(0, 5),
    lod1Sample: [...new Set(lod1.map(name))].sort().slice(0, 5),
    // The BUILDING identity behind each request, so the two levels can be
    // intersected. A building appearing in both lists had both of its levels
    // pulled over the wire in one session, which is what the D-11 doubling
    // allowance bounds.
    lod0BuildingIds: [...new Set(lod0.map((entry) => name(entry).replace("__lod_0.glb", "")))].sort(),
    lod1BuildingIds: [...new Set(lod1.map((entry) => name(entry).replace("__lod_1.glb", "")))].sort(),
  };
})()`;

function poseUrl(base, pose) {
  const url = new URL(base);
  url.searchParams.set("data", "real-pilot");
  url.searchParams.set("release", "manhattan-citywide-20260804");
  url.searchParams.set("view", "free");
  if (pose.releaseId) url.searchParams.set("exteriorCells", pose.releaseId);
  for (const [key, value] of [["lon", pose.lon], ["lat", pose.lat], ["height", pose.height], ["heading", pose.heading], ["pitch", pose.pitch], ["roll", pose.roll]]) {
    url.searchParams.set(key, Number(value).toFixed(6));
  }
  return url.toString();
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

function externalHosts(session, base) {
  const origin = new URL(base).host;
  return [...new Set(session.responses().map((response) => {
    try { return new URL(response.url).host; } catch { return ""; }
  }).filter((host) => host && host !== origin))].sort();
}

/** Session-wide cache figures, read from ONE wave: they read one shared pool. */
function sharedCache(probe) {
  for (const wave of probe?.waves ?? []) if (wave.metrics) return wave.metrics;
  return null;
}

async function capturePose(base, pose) {
  const url = poseUrl(base, pose);
  const { session, targetId } = await attach(url);
  try {
    await waitFor(session, READ_PROBE, (probe) => probe.exteriorStreamingActive, `${pose.poseId} activation`);
    await wait(SETTLE_MS);
    const probe = await session.evaluate(READ_PROBE, `${pose.poseId} probe`);
    const lods = await session.evaluate(READ_LOD_REQUESTS, `${pose.poseId} lod requests`);
    const metrics = sharedCache(probe);
    const bytes = await session.screenshot(`${pose.poseId} still`);
    await mkdir(join(evidenceRoot, "captures"), { recursive: true });
    const stillName = `pose-${pose.poseId.toLowerCase()}.png`;
    await writeFile(join(evidenceRoot, "captures", stillName), bytes);
    const still = { file: `captures/${stillName}`, byteSize: bytes.byteLength, sha256: sha256HexBytes(new Uint8Array(bytes)) };

    const distances = (probe.distances ?? []).map(([unitId, meters]) => ({ unitId, meters }));
    const near = distances.filter((entry) => entry.meters <= EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS);
    const far = distances.filter((entry) => entry.meters > EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS);

    // The universal gates, registered for every pose.
    const universal = {
      failedCellCount: metrics?.failedCellCount ?? null,
      fallbackCellCount: metrics?.fallbackCellCount ?? null,
      failedArtifactCount: metrics?.failedArtifactCount ?? null,
      peakConcurrentRequests: metrics?.peakConcurrentRequests ?? null,
      maxConcurrentRequests: metrics?.maxConcurrentRequests ?? null,
      externalHosts: externalHosts(session, base),
    };
    const universalPass = universal.failedCellCount === 0
      && universal.fallbackCellCount === 0
      && universal.failedArtifactCount === 0
      && (universal.peakConcurrentRequests ?? 99) <= EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests
      && universal.externalHosts.length === 0;

    return {
      poseId: pose.poseId,
      label: pose.label,
      gated: pose.gates,
      url,
      pose: { lon: pose.lon, lat: pose.lat, height: pose.height, heading: pose.heading, pitch: pose.pitch, roll: pose.roll },
      residentUnitCount: probe.residentUnitIds.length,
      distances: {
        count: distances.length,
        nearRingCount: near.length,
        farRingCount: far.length,
        minMeters: distances.length ? Math.min(...distances.map((d) => d.meters)) : null,
        maxMeters: distances.length ? Math.max(...distances.map((d) => d.meters)) : null,
        ringMeters: EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS,
        // NAMED cells per side. A straddle pose has to say WHICH cells sat which
        // side of the ring, or "both sides were populated" is a count nobody can
        // check. Sorted by distance and capped so the record stays readable.
        nearRingCells: [...near].sort((a, b) => a.meters - b.meters).slice(0, 12).map((d) => ({ unitId: d.unitId, meters: Number(d.meters.toFixed(2)) })),
        farRingCells: [...far].sort((a, b) => a.meters - b.meters).slice(0, 12).map((d) => ({ unitId: d.unitId, meters: Number(d.meters.toFixed(2)) })),
        // The cells nearest the ring on each side: the ones a small camera move
        // would push across, which is what makes the straddle a straddle.
        closestBelowRing: near.length ? (() => { const d = near.reduce((a, b) => (a.meters > b.meters ? a : b)); return { unitId: d.unitId, meters: Number(d.meters.toFixed(2)) }; })() : null,
        closestAboveRing: far.length ? (() => { const d = far.reduce((a, b) => (a.meters < b.meters ? a : b)); return { unitId: d.unitId, meters: Number(d.meters.toFixed(2)) }; })() : null,
      },
      // D-11: cells whose BOTH levels are simultaneously resident in the shared
      // cache, against the registered 4-of-8 doubling allowance. Read from the
      // request log rather than from the scheduler, because what the allowance
      // bounds is bytes held, and a request is what puts bytes there.
      simultaneousBothLevels: (() => {
        const both = (lods.lod0BuildingIds ?? []).filter((id) => (lods.lod1BuildingIds ?? []).includes(id));
        return { count: both.length, buildingIds: both.slice(0, 24) };
      })(),
      lodRequests: lods,
      sharedCache: metrics,
      universalGates: { ...universal, pass: universalPass },
      still,
    };
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const base = argValue(argv, "--base", "http://127.0.0.1:4173/");
  const attemptCount = Number(argValue(argv, "--attempt", "1"));
  const browser = await launchChrome();
  let surviving;
  const stops = [];
  try {
    // The INSTRUMENT-DEFECT RE-RUN convention needs a way to re-take named poses
    // without disturbing the ones whose readings were never in doubt.
    const only = argValue(argv, "--poses", "");
    const wanted = only ? new Set(only.split(",").map((token) => token.trim().toUpperCase())) : null;
    for (const pose of POSES.filter((entry) => !wanted || wanted.has(entry.poseId))) {
      const stop = await capturePose(base, pose);
      stops.push(stop);
      console.log(`  ${stop.poseId} resident=${stop.residentUnitCount} near=${stop.distances.nearRingCount} far=${stop.distances.farRingCount} lod0=${stop.lodRequests.lod0DistinctCount} lod1=${stop.lodRequests.lod1DistinctCount} universal=${stop.universalGates.pass ? "PASS" : "FAIL"}`);
    }
  } finally {
    surviving = await killChrome();
    console.log(`  cleanup: survivingChromeProcessCount=${surviving}`);
  }

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:poses`,
    task: "T001 (Issue #101)",
    artifact: "two-lod-serving-pose-captures",
    capturedAt: new Date().toISOString(),
    attemptCount,
    attemptPolicy: "SINGLE attempt per pose. A FAIL is RECORDED and NOT re-run: the poses and their gates were registered in ADR 0057 section 4.2 before any capture existed.",
    browser,
    viewport: VIEWPORT,
    base,
    nearRingMeters: EXTERIOR_TWO_LOD_SERVING_NEAR_RING_METERS,
    requestCeiling: EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests,
    chromeLaunchCommand: CHROME_LAUNCH_COMMAND,
    survivingChromeProcessCount: surviving,
    lodReadingMethod: "REQUEST-LEVEL. A two-LOD release ships __lod_0.glb and __lod_1.glb as separate artifacts, so the set of GLB URLs a document fetched says which level the runtime resolved. It is not a pixel reading and no pose here claims a building LOOKS coarse.",
    poses: stops,
    notClaimedHere: [
      "Any visual, geographic, architectural or performance acceptance. A still is evidence that pixels were produced, not evidence of likeness.",
      "Any frame-time claim, on desktop or mobile.",
      "Any claim about decoded GPU memory, which is not observable from the loader.",
      "T009's 5 shed-tone residual pairs are RECORDED and NOT judged wherever they appear; they gate nothing here.",
    ],
  };
  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "pose-captures.json"), text);
  await writeFile(join(evidenceRoot, "pose-captures.sha256"), `${sha256HexSync(text)}  pose-captures.json\n`);
  console.log(serialize({ ok: true, poses: stops.length, survivingChromeProcessCount: surviving }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (error) => { await killChrome(); console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
