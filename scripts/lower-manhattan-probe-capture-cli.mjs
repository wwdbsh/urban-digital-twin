/* global console, process, WebSocket, fetch */
/**
 * T015 kill-switch capture: the first textured wave measured in the SHIPPING
 * renderer against its own untextured baseline.
 *
 * T028 answered a yes/no question about sampler filtering and its Chrome session
 * was driven by hand, so `scripts/block835-v3t-sampler-evidence-cli.mjs` only
 * ever planned the variants and hashed the stills a human had already taken.
 * This wave's question is quantitative — what do detail tiles COST — and a
 * number a human read off a screen is not evidence anybody can replay. So the
 * session is driven here, over the Chrome DevTools Protocol, and the numbers are
 * read out of the page rather than out of a screenshot.
 *
 * What it does NOT do: decide. It records frame times, heap and stills for both
 * variants at all three stations and writes them beside the verdict fields left
 * blank. The kill decision is a human reading of the stills plus the measured
 * cost, and it is recorded by `verdict` in the committed evidence file.
 *
 * Preconditions, all refused loudly rather than worked around:
 *   1. `node scripts/lower-manhattan-cli.mjs probe` has written the harness input;
 *   2. a preview server built with VITE_T028_SAMPLER_PROBE=1 and
 *      VITE_SAMPLER_PROBE_DIRECTORY=lower-manhattan-20260812-probe is serving;
 *   3. Chrome is listening on the given remote-debugging port.
 *
 * Usage:
 *   node scripts/lower-manhattan-probe-capture-cli.mjs \
 *     --preview http://127.0.0.1:4173 --port 9222 [--out <path>]
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import { LOWER_MANHATTAN_RELEASE_ID } from "../src/release/lower-manhattan-package.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const probeRoot = join(repositoryRoot, "artifacts", "lower-manhattan-20260812-probe");
const harnessPath = join(probeRoot, "harness.json");
const capturesRoot = join(probeRoot, "captures");
const defaultOutPath = join(repositoryRoot, "data", "lower-manhattan-20260812", "kill-switch-evidence.json");

/** Fixed capture viewport, so a station's pixels mean the same thing in both variants. */
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 120_000;

function fail(message) { throw new Error(`lower-manhattan-probe-capture: ${message}`); }

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

// ---------------------------------------------------------------------------
// Minimal CDP client
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

async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", () => rejectPromise(new Error("CDP websocket failed to open.")), { once: true });
  });
  return new CdpSession(socket);
}

/**
 * Opens a FRESH page target for one capture, and closes it afterwards.
 *
 * Reusing one tab across six navigations was tried first and refused on its own
 * evidence: the post-collection heap still climbed about 10 MB per navigation
 * whatever the variant, so a variant-major capture order made three
 * navigations' worth of accumulation look like texture cost. A tab per capture
 * removes the confound at the source instead of correcting for it afterwards,
 * and it costs a page load nobody is timing.
 */
async function openFreshPage(port, previewBase) {
  let created;
  try {
    created = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${previewBase}/blank`)}`, { method: "PUT" })).json();
  } catch {
    return fail(`no Chrome DevTools endpoint answered on port ${port}. Launch Chrome with --remote-debugging-port=${port}.`);
  }
  if (!created.webSocketDebuggerUrl) fail("Chrome did not return an attachable page target.");
  const session = await connect(created.webSocketDebuggerUrl);
  session.targetId = created.id;
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("HeapProfiler.enable");
  await session.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });
  return session;
}

async function closePage(port, session) {
  session.close();
  try { await fetch(`http://127.0.0.1:${port}/json/close/${session.targetId}`); } catch { /* the tab is going away either way */ }
}

// ---------------------------------------------------------------------------

async function captureStation(port, previewBase, variantId, stationId) {
  const session = await openFreshPage(port, previewBase);
  try {
  const url = `${previewBase}/t028-sampler-harness.html?variant=${encodeURIComponent(variantId)}&station=${encodeURIComponent(stationId)}`;
  await session.send("Page.navigate", { url });
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let state = "unknown";
  for (;;) {
    if (Date.now() > deadline) fail(`${variantId}/${stationId} never became ready (last state: ${state}).`);
    await new Promise((resolvePromise) => { setTimeout(resolvePromise, 500); });
    const probe = await session.evaluate(`(() => {
      const node = document.querySelector('.t028-sampler-harness');
      if (!node) return null;
      const summary = document.querySelector('[data-t028-sampler-summary]');
      return {
        state: node.getAttribute('data-t028-sampler-state'),
        ready: node.getAttribute('data-t028-sampler-ready'),
        summary: summary ? summary.textContent : '',
      };
    })()`).catch(() => null);
    if (!probe) continue;
    state = probe.state ?? "unknown";
    if (state === "failed") fail(`${variantId}/${stationId} reported failure: ${probe.summary}`);
    if (state === "disabled") fail("the harness reports it is disabled; the preview build must set VITE_T028_SAMPLER_PROBE=1.");
    if (probe.ready !== "1") continue;
    const measurement = JSON.parse(probe.summary.slice(probe.summary.indexOf("\n") + 1));
    // The in-page heap reading is taken while the previous navigation's garbage
    // is still resident — across six navigations in one tab it climbs
    // monotonically whatever the variant, so on its own it would report
    // accumulation as if it were texture cost. A forced collection followed by a
    // fresh reading is the only heap number here that means what it says, and it
    // is the one the comparison uses.
    await session.send("HeapProfiler.collectGarbage");
    const heapAfterGcBytes = await session.evaluate("performance.memory ? performance.memory.usedJSHeapSize : null");
    const shot = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const bytes = Buffer.from(shot.data, "base64");
    const stillPath = join(capturesRoot, `${variantId}__${stationId}.png`);
    await mkdir(dirname(stillPath), { recursive: true });
    await writeFile(stillPath, bytes);
    return {
      variantId,
      stationId,
      measurement: { ...measurement, heapAfterGcBytes },
      still: {
        relativeRef: `captures/${variantId}__${stationId}.png`,
        byteSize: bytes.byteLength,
        checksumSha256: sha256HexBytes(new Uint8Array(bytes)),
      },
    };
  }
  } finally {
    await closePage(port, session);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const previewBase = argValue(argv, "--preview", "http://127.0.0.1:4173").replace(/\/$/u, "");
  const port = Number(argValue(argv, "--port", "9222"));
  const outPath = resolve(argValue(argv, "--out", defaultOutPath));

  if (!existsSync(harnessPath)) fail(`harness input is absent at ${harnessPath}. Run \`node scripts/lower-manhattan-cli.mjs probe\` first.`);
  const harnessText = await readFile(harnessPath, "utf8");
  const harness = JSON.parse(harnessText);

  // Station-major, so the two variants of one station are measured adjacently
  // rather than three navigations apart. With a fresh tab per capture this is
  // belt and braces, and it keeps the ordering honest if the tab isolation ever
  // regresses.
  const captures = [];
  for (const station of harness.stations) {
    for (const variant of harness.variants) {
      console.error(`capturing ${variant.variantId} / ${station.stationId} ...`);
      captures.push(await captureStation(port, previewBase, variant.variantId, station.stationId));
    }
  }

  const byKey = new Map(captures.map((entry) => [`${entry.variantId}::${entry.stationId}`, entry]));
  const comparison = harness.stations.map((station) => {
    const baseline = byKey.get(`untextured-baseline::${station.stationId}`);
    const candidate = byKey.get(`textured-candidate::${station.stationId}`);
    const heapDelta = baseline.measurement.heapAfterGcBytes === null || candidate.measurement.heapAfterGcBytes === null
      ? null
      : candidate.measurement.heapAfterGcBytes - baseline.measurement.heapAfterGcBytes;
    return {
      stationId: station.stationId,
      groundDistanceMeters: station.groundDistanceMeters,
      baselineFrameMs: baseline.measurement.frameMilliseconds,
      candidateFrameMs: candidate.measurement.frameMilliseconds,
      p50RatioCandidateOverBaseline: candidate.measurement.frameMilliseconds.p50 / baseline.measurement.frameMilliseconds.p50,
      p95RatioCandidateOverBaseline: candidate.measurement.frameMilliseconds.p95 / baseline.measurement.frameMilliseconds.p95,
      baselineHeapAfterGcBytes: baseline.measurement.heapAfterGcBytes,
      candidateHeapAfterGcBytes: candidate.measurement.heapAfterGcBytes,
      heapDeltaBytes: heapDelta,
      baselineLoadedBytes: baseline.measurement.loadedBytes,
      candidateLoadedBytes: candidate.measurement.loadedBytes,
    };
  });

  const evidence = {
    schemaVersion: "1.0",
    releaseId: LOWER_MANHATTAN_RELEASE_ID,
    note: "T015 stage-1 kill switch. The heaviest cell of the renderable subset, rendered by the shipping CesiumJS renderer at three fixed stations, in two variants that differ ONLY in whether LOD 0 carries procedural detail tiles. Frame times are measured over 240 post-settle frames, so no asset upload or first-frame texture decode is counted. Stills are the operator-inspectable half of the verdict; the timings are the measurable half. Payload PNGs and GLBs stay gitignored; this record keeps every one of them checkable by checksum.",
    harnessInputChecksumSha256: sha256HexSync(harnessText),
    cellId: harness.cellId,
    textureCatalog: harness.textureCatalog,
    capturedWith: { viewport: VIEWPORT, previewBase, remoteDebuggingPort: port },
    stations: harness.stations,
    variants: harness.variants.map((variant) => ({
      variantId: variant.variantId,
      samplerFilter: variant.samplerFilter,
      note: variant.note,
      assetCount: variant.assets.length,
      totalByteSize: variant.assets.reduce((total, asset) => total + asset.byteSize, 0),
    })),
    captures,
    comparison,
    verdict: null,
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serializeExteriorWaveArtifact(evidence), "utf8");
  console.log(JSON.stringify({ ok: true, outPath, comparison }, null, 2));
}

await main();
