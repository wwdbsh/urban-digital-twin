/* global console, process, WebSocket, fetch, Buffer, URL */
/**
 * T004 citywide overview-streaming evidence.
 *
 * Two stages, kept apart on purpose:
 *
 *   containment — offline, deterministic, no browser. Answers the coverage
 *     question with a SET CONTAINMENT rather than a per-cell assertion: the
 *     union of every committed ledger cell's buildingIds must be a subset of
 *     the parent IDs the citywide dense building shards actually carry. One
 *     containment over 45,194 IDs is the whole claim; 883 separate assertions
 *     would only be the same claim written 883 times.
 *
 *   probe — drives a live Chrome over CDP against a dev server built with
 *     VITE_CITYWIDE_OVERVIEW_PROBE=1, parks the camera at the approved
 *     island-overview viewpoint, reads DenseRenderMetrics and the shared-cache
 *     residency out of the page, captures the still, then walks a recorded pan
 *     path recording per-move refresh cost, sequence retention, plan build vs
 *     reuse, allocation slices, swaps, cancellations and per-class evictions.
 *
 * Neither stage decides anything. `containment` reports the set relation and
 * `probe` reports what the renderer did; the acceptance reading is a human one
 * and is recorded in ADR 0043.
 *
 * Usage:
 *   node scripts/citywide-overview-streaming-evidence-cli.mjs containment
 *   node scripts/citywide-overview-streaming-evidence-cli.mjs probe \
 *     --dev http://127.0.0.1:5173 --port 9222 [--out <path>]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(repositoryRoot, "public", "data", "manhattan-citywide-20260804");
const ledgerPath = join(repositoryRoot, "data", "normalized", "manhattan-exterior-wave-ledger-20260804", "ledger.json");
const evidenceRoot = join(repositoryRoot, "data", "citywide-overview-streaming-20260814");

/**
 * The approved island-overview viewpoint. Centred on the island's mid-latitude
 * at a height whose ground footprint spans Battery to Inwood, so the shard
 * selection is asked for the whole committed dense set rather than a
 * convenient part of it.
 */
const OVERVIEW_VIEWPOINT = { lon: -73.9773, lat: 40.7825, height: 52000, heading: 90, pitch: -90, roll: 0 };

/** A recorded pan path: the first two moves keep the whole island in view. */
const PAN_PATH = [
  // The first three are deliberately small: they change the settled footprint
  // signature without changing the resident shard set, which is the case the
  // T004 memoization exists for.
  { label: "overview-nudge-north", lon: -73.9773, lat: 40.7828, height: 52000, heading: 90, pitch: -90 },
  { label: "overview-nudge-east", lon: -73.9770, lat: 40.7828, height: 52000, heading: 90, pitch: -90 },
  { label: "overview-nudge-back", lon: -73.9773, lat: 40.7825, height: 52000, heading: 90, pitch: -90 },
  { label: "descend-midtown", lon: -73.984, lat: 40.755, height: 6000, heading: 0, pitch: -60 },
  { label: "return-overview", lon: -73.9773, lat: 40.7825, height: 52000, heading: 90, pitch: -90 },
];

/** Search terms whose shards must not be able to displace resident geometry. */
const SEARCH_STORM = ["pizza", "deli", "cafe", "market", "grill", "sushi", "bakery", "empire", "broadway", "park"];

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 300_000;

function fail(message) { throw new Error(`citywide-overview-streaming-evidence: ${message}`); }

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
// containment
// ---------------------------------------------------------------------------

async function runContainment() {
  const manifest = JSON.parse(await readFile(join(releaseRoot, "manifest.json"), "utf8"));
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const denseBuildingIds = new Set();
  const denseRestaurantIds = new Set();
  let buildingParts = 0;
  for (const shard of manifest.geometryShards) {
    const payload = JSON.parse(await readFile(join(releaseRoot, shard.relativeContentRef), "utf8"));
    if (payload.layer !== shard.layer || payload.tileKey !== shard.tileKey) fail(`shard ${shard.relativeContentRef} disagrees with its manifest tile/layer`);
    for (const record of payload.features) {
      if (typeof record.parentId !== "string") fail(`shard ${shard.relativeContentRef} carries a record without a parent ID`);
      if (shard.layer === "buildings") { denseBuildingIds.add(record.parentId); buildingParts += 1; }
      else denseRestaurantIds.add(record.parentId);
    }
  }
  const committed = new Set();
  for (const cell of ledger.cells) for (const id of cell.buildingIds) committed.add(id);
  const missing = [...committed].filter((id) => !denseBuildingIds.has(id)).sort();
  const result = {
    schemaVersion: "1.0",
    taskId: "T004",
    artifact: "citywide-overview-dense-coverage-containment",
    note: "One set containment over the whole committed cell membership, not 883 separate assertions. The dense path is a SUPERSET of what the exterior facade path can render: the grammar refusals apply to facade generation and never remove a building from the dense extrusion set.",
    base: { releaseId: manifest.releaseId, generatedAt: manifest.generatedAt },
    ledger: { ledgerId: ledger.ledgerId, cellCount: ledger.cells.length },
    dense: {
      buildingParentCount: denseBuildingIds.size,
      buildingPartCount: buildingParts,
      restaurantParentCount: denseRestaurantIds.size,
      declaredRestaurantParentCount: manifest.layers.find((layer) => layer.id === "restaurants")?.parentCount ?? null,
      renderableDenseFeatureCount: denseBuildingIds.size + denseRestaurantIds.size,
    },
    committed: { uniqueBuildingIdCount: committed.size },
    containment: {
      holds: missing.length === 0,
      missingCount: missing.length,
      missingSample: missing.slice(0, 10),
      denseOnlyCount: denseBuildingIds.size - committed.size + missing.length,
    },
  };
  const checksum = await writeArtifact("dense-coverage-containment.json", result);
  console.log(JSON.stringify({ ...result.containment, ...result.dense, checksum }, null, 2));
  if (!result.containment.holds) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Minimal CDP client (same shape as the T015 kill-switch capture)
// ---------------------------------------------------------------------------

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      if (message.id === undefined) return;
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
  await session.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });
  return { session, targetId: target.id };
}

function sessionUrl(dev, pose, query) {
  const url = new URL(dev);
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("data", "real-pilot");
  url.searchParams.set("release", "manhattan-citywide-20260804");
  url.searchParams.set("view", "free");
  url.searchParams.set("exteriorScheduler", "on");
  for (const [key, value] of Object.entries(pose)) url.searchParams.set(key, Number(value).toFixed(6));
  return url.toString();
}

const READ_PROBE = `(() => {
  const node = document.querySelector("[data-citywide-overview-probe]");
  return node ? JSON.parse(node.textContent) : null;
})()`;

async function waitFor(session, predicate, what) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const probe = await session.evaluate(READ_PROBE);
    if (probe && predicate(probe)) return probe;
    if (Date.now() > deadline) fail(`timed out waiting for ${what}`);
    await session.evaluate("new Promise((done) => setTimeout(done, 500))");
  }
}

async function runProbe(argv) {
  const dev = argValue(argv, "--dev", "http://127.0.0.1:5173");
  const port = Number(argValue(argv, "--port", "9222"));
  const { session } = await attach(port);
  const stations = [];
  await session.send("Page.navigate", { url: sessionUrl(dev, OVERVIEW_VIEWPOINT) });
  const settled = await waitFor(session, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0 && (probe.denseMetrics?.planSwapCount ?? 0) > 0, "the island-overview dense layer to swap in");
  const still = await session.send("Page.captureScreenshot", { format: "png" });
  await mkdir(join(evidenceRoot, "captures"), { recursive: true });
  const stillBytes = Buffer.from(still.data, "base64");
  await writeFile(join(evidenceRoot, "captures", "island-overview.png"), stillBytes);
  stations.push({ label: "island-overview", probe: settled, stillSha256: sha256HexBytes(new Uint8Array(stillBytes)) });

  for (const step of PAN_PATH) {
    await session.send("Page.navigate", { url: sessionUrl(dev, { lon: step.lon, lat: step.lat, height: step.height, heading: step.heading, pitch: step.pitch, roll: 0 }) });
    const after = await waitFor(session, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0, `pan step ${step.label}`);
    stations.push({ label: step.label, probe: after });
  }

  // Reservation evidence: a search and detail load storm against a session
  // already holding the whole dense island. The floors are only meaningful if
  // this leaves the building shards resident.
  const beforeStorm = await session.evaluate(READ_PROBE);
  for (const query of SEARCH_STORM) {
    await session.send("Page.navigate", { url: sessionUrl(dev, OVERVIEW_VIEWPOINT, query) });
    await waitFor(session, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0, `search storm ${query}`);
  }
  const afterStorm = await waitFor(session, (probe) => (probe.denseMetrics?.buildingFeatureCount ?? 0) > 0, "search storm settle");
  stations.push({ label: "search-detail-storm", queries: SEARCH_STORM, cacheBefore: beforeStorm?.cache ?? null, probe: afterStorm });
  const final = await session.evaluate(READ_PROBE);
  session.close();
  const out = {
    schemaVersion: "1.0",
    taskId: "T004",
    artifact: "citywide-overview-streaming-probe",
    note: "Live Chrome over CDP against a dev server built with VITE_CITYWIDE_OVERVIEW_PROBE=1. Numbers are read out of the page, not off a screenshot. This file records; it does not decide.",
    viewport: VIEWPORT,
    viewpoint: OVERVIEW_VIEWPOINT,
    panPath: PAN_PATH,
    stations,
    final,
  };
  const checksum = await writeArtifact("overview-probe.json", out);
  console.log(JSON.stringify({ stations: stations.map((station) => ({ label: station.label, buildings: station.probe?.denseMetrics?.buildingFeatureCount, primitives: station.probe?.denseMetrics?.primitiveCount })), checksum }, null, 2));
}

const [command, ...argv] = process.argv.slice(2);
if (command === "containment") await runContainment();
else if (command === "probe") await runProbe(argv);
else fail(`unknown command ${command ?? "(none)"}; expected containment or probe`);
