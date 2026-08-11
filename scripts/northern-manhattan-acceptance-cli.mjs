/* global console, process, WebSocket, URL, fetch, setTimeout, Buffer, TextDecoder */
/**
 * T022 promotion acceptance capture: the SIX-WAVE PROMOTED COMPOSITION — every
 * wave the committed ledger declares — measured in the production preview, OFF
 * THE VSYNC FLOOR, AT THE UNCHANGED CACHE CAP.
 *
 * A sibling of `scripts/central-upper-manhattan-acceptance-cli.mjs`, which stays
 * exactly as it is and keeps describing the five-wave composition it measured.
 * What differs, and each is a requirement rather than a preference:
 *
 *   1. THE CAP DID NOT MOVE, again, and that is itself the thing to record. This
 *      promotion consumes a RESERVATION rather than cutting a share, so 512 was in
 *      force throughout and `capAtMeasurement` says so from
 *      `EXTERIOR_RUNTIME_BUDGETS` in the tree the served bundle was built from
 *      rather than from a number typed here.
 *   2. SIX RELEASES ARE ATTRIBUTED, not five. A SIX-wave composition had never
 *      been measured: T020 measured five at 460 worst-observed residency against a
 *      budgeted 474, and a sixth wave moves both.
 *   3. THE LAST-WAVE STATIONS. One station stands in the newly promoted Harlem
 *      cell, one reads it as a skyline, one holds ALL SIX waves' ground in a single
 *      frame, and one is the T020 station kept pose-for-pose so "did adding a sixth
 *      wave cost the fifth anything" is a comparison rather than an assertion.
 *
 * Everything else below — the served-bundle identity check, the uncapped flags,
 * the capped control in a second browser, the per-release network attribution, the
 * forced-GC heap reading, the derived residency and the computed-not-measured GPU
 * arithmetic — is the T016 instrument, deliberately unchanged.
 *
 * What it deliberately does NOT do: measure GPU memory. `usedJSHeapSize` is a JS
 * heap reading and nothing else, and no instrument reachable from this session
 * reports texture VRAM. The GPU texture arithmetic is COMPUTED from the shipped
 * bytes by `--gpu-arithmetic` and is recorded as computed, never as measured.
 *
 * Preconditions, all refused loudly rather than worked around:
 *   1. `pnpm build` has produced a `dist/` carrying the promoted payloads;
 *   2. `pnpm preview` is serving it;
 *   3. Chrome is listening on the given remote-debugging port, launched with
 *      the two uncapping flags.
 *
 * Usage:
 *   node scripts/northern-manhattan-acceptance-cli.mjs \
 *     --preview http://localhost:4176 --port 9224 [--repeats 3] [--capped-port 9335] [--out <path>]
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import { LOWER_MANHATTAN_P1_RELEASE_ID } from "../src/release/lower-manhattan-p1-release.ts";
import { PROCEDURAL_TEXTURE_TILE_PIXELS } from "../src/release/procedural-texture.ts";
import { SOUTHERN_REMAINDER_P1_RELEASE_ID } from "../src/release/southern-remainder-p1-release.ts";
import { CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID } from "../src/release/central-upper-manhattan-p1-release.ts";
import { NORTHERN_MANHATTAN_RELEASE_ID } from "../src/release/northern-manhattan-package.ts";
import { NORTHERN_MANHATTAN_P1_RELEASE_ID } from "../src/release/northern-manhattan-p1-release.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const capturesRoot = join(repositoryRoot, "artifacts", "northern-manhattan-20260812-p1-acceptance", "captures");
const defaultOutPath = join(repositoryRoot, "data", "northern-manhattan-20260812-p1", "acceptance-evidence.json");
const distRoot = join(repositoryRoot, "dist");
const p1AssetsRoot = join(repositoryRoot, "public", "data", NORTHERN_MANHATTAN_P1_RELEASE_ID, "public", "assets");

const BASE_RELEASE_ID = "manhattan-citywide-20260804";
const BLOCK835_RELEASE_ID = "manhattan-exterior-cells-20260811-v3";
const MIDTOWN_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3";
const PROMOTED_RELEASE_IDS = [BLOCK835_RELEASE_ID, MIDTOWN_RELEASE_ID, LOWER_MANHATTAN_P1_RELEASE_ID, SOUTHERN_REMAINDER_P1_RELEASE_ID, CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID, NORTHERN_MANHATTAN_P1_RELEASE_ID];

/** Fixed capture viewport, so a station's pixels mean the same thing every run. */
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 180_000;
/** Frames timed per capture, after the settle window. */
const MEASURED_FRAMES = 240;
/** Frames discarded before timing starts: asset upload and first texture decode. */
const SETTLE_FRAMES = 180;

/**
 * The two render-profile budgets this measurement is judged against.
 *
 * They are the budgets the exterior render profiles were approved with:
 * exploration is the ordinary navigating profile, inspection is the close-in
 * one. `p50` is the frame the user spends most of their time in; `p95` is the
 * one they notice.
 */
const FRAME_BUDGETS = {
  exploration: { p50Milliseconds: 16.7, p95Milliseconds: 25 },
  inspection: { p50Milliseconds: 33.3, p95Milliseconds: 45 },
};

function fail(message) { throw new Error(`northern-manhattan-acceptance: ${message}`); }

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

// ---------------------------------------------------------------------------
// Stations
//
// Two of them look at the curated cells from the ranges a user actually
// occupies, one is the wide skyline view the curation was chosen for, and one
// looks at ANOTHER promoted wave — because a composition measured only where the
// new wave is would not have measured the composition.
//
// `height` is clamped by the navigation parser to a minimum of 80 m, so the
// closest station is stated at 90 m rather than at eye level; a URL cannot
// express a street-level camera and this record does not pretend it did.
// ---------------------------------------------------------------------------

const STATIONS = [
  {
    stationId: "harlem-125th-facade",
    profile: "inspection",
    note: "Standing EAST of curated cell 727 and looking WEST along the West 125th Street corridor, on the inspection profile at a shallow pitch. Shallow and low on purpose: facades are vertical, and the T017 evidence records a station that looked at rooftops and produced byte-identical stills. The camera is roughly 290 m outside the cell's eastern bound, so the whole 231-metre curated block band and its 101.5 m sourced structure are in frame with the untextured base massing of the tombstoned cells behind and beside it. This is the pose where a viewer can see, in one frame, that the promoted subset is ONE small block of textured ground in a wave that is otherwise base massing.",
    pose: { lon: -73.94550, lat: 40.80940, height: 150, heading: 270, pitch: -4, roll: 0 },
  },
  {
    stationId: "harlem-125th-skyline",
    profile: "exploration",
    note: "The wide skyline station for the newly promoted cell, read from the south-east at about a kilometre. It is the honest counterpart to wave w04's Central Park West skyline station: this wave's tallest admissible structure is 101.5 m rather than 219.2 m, so what this station shows is a single tall building over four- to eight-storey Harlem stock, which is what northern Manhattan is. It is also past the LOD 0 cut-off, where a 128-pixel tile is repeated most per screen pixel and aliasing shows first.",
    pose: { lon: -73.94300, lat: 40.80200, height: 520, heading: 320, pitch: -8, roll: 0 },
  },
  {
    stationId: "sixwave-wide",
    profile: "exploration",
    note: "The SIX-WAVE wide view, and the station this promotion exists to measure. A high pose south of the island looking north up Manhattan, at the altitude and pitch where the ground of all SIX promoted waves — Block 835, Midtown-core, Lower-Manhattan, Southern-remainder, Central-and-upper-Manhattan and Northern-Manhattan — is inside one frustum rather than merely simultaneously promoted. A six-wave composition had never been measured; T020's wide station was framed for five and could not have held Harlem.",
    pose: { lon: -74.02000, lat: 40.66500, height: 9000, heading: 20, pitch: -25, roll: 0 },
  },
  {
    stationId: "centralpark-west-facade",
    profile: "inspection",
    note: "The T020 Central-and-upper-Manhattan station, pose-for-pose UNCHANGED, kept for continuity across the two promotions. Its numbers are directly comparable with the T020 record's, so \"did adding a sixth wave cost the fifth one anything\" is a comparison rather than an assertion.",
    pose: { lon: -73.97400, lat: 40.77160, height: 150, heading: 272, pitch: -4, roll: 0 },
  },
];

/**
 * The overlay chrome hidden for the STILL only, never for the timing.
 *
 * The app's fallback notices are long and correct — at a Financial District
 * camera they name every Midtown building whose base record has not loaded yet —
 * and they cover the viewport. Hiding them for the screenshot shows the SCENE;
 * hiding them for the measurement would remove real work from the frame, so the
 * injection happens after the frames are timed and the record says so.
 */
const STILL_CHROME_HIDE_CSS = ".exploration-notice, .runtime-note, .inspector, nav, header, footer { display: none !important; }";

function stationUrl(previewBase, station, extraParams = {}) {
  const url = new URL(previewBase);
  url.pathname = "/";
  const params = url.searchParams;
  params.set("data", BASE_RELEASE_ID);
  params.set("release", BASE_RELEASE_ID);
  params.set("view", "explore");
  for (const [key, value] of Object.entries(station.pose)) params.set(key, value.toFixed(6));
  params.set("exteriorProfile", station.profile);
  for (const [key, value] of Object.entries(extraParams)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// Which bundle was actually measured
// ---------------------------------------------------------------------------

/**
 * Identifies the bundle the preview server is SERVING, and refuses to proceed if
 * it is not this build.
 *
 * This exists because of a real incident: the first run of this suite reached a
 * `vite preview` left listening by another worktree, serving a bundle in which
 * this release was not pinned. The `promoted-default-unchanged` journey passed
 * against it — correctly, and meaninglessly, because a release that is not
 * pinned obviously fetches nothing. The evidence record then disclosed the
 * incident in prose and said the re-run was "verified by bundle hash", which was
 * true and entirely unfalsifiable from the record.
 *
 * So the identity is now MEASURED and RECORDED, and three things fail the run
 * rather than being noted:
 *
 *  - the served index or its entry script cannot be read at all;
 *  - the served bytes differ from this repository's `dist/`, which is what a
 *    stale server on a shared port looks like;
 *  - the served entry script does not name this release, which is what a build
 *    predating the pin looks like.
 *
 * The last two overlap deliberately. The dist comparison catches a server for
 * some other tree; the release-name check still holds if someone previews a dist
 * built before `PINNED_EXTERIOR_CELL_RELEASE_IDS` gained this entry.
 */
async function servedBundleIdentity(previewBase) {
  const indexResponse = await fetch(`${previewBase}/`).catch(() => fail(`no preview server answered at ${previewBase}.`));
  if (!indexResponse.ok) fail(`the preview server answered ${indexResponse.status} for /; the served bundle cannot be identified.`);
  const indexHtml = await indexResponse.text();
  const reference = /src="([^"]*index-[^"]*\.js)"/u.exec(indexHtml);
  if (!reference) fail("the served index.html declares no entry script; the served bundle cannot be identified.");
  const entryPath = reference[1];
  const entryResponse = await fetch(new URL(entryPath, `${previewBase}/`)).catch(() => fail(`the served entry script ${entryPath} could not be fetched.`));
  if (!entryResponse.ok) fail(`the preview server answered ${entryResponse.status} for ${entryPath}; the served bundle cannot be identified.`);
  const entryBytes = new Uint8Array(await entryResponse.arrayBuffer());

  const indexChecksum = sha256HexSync(indexHtml);
  const entryChecksum = sha256HexBytes(entryBytes);

  if (!existsSync(join(distRoot, "index.html"))) {
    fail(`there is no ${distRoot}/index.html to compare the served bundle against. Run \`pnpm build\` before capturing, so the record can state WHICH build was measured.`);
  }
  const localIndexChecksum = sha256HexSync(await readFile(join(distRoot, "index.html"), "utf8"));
  if (localIndexChecksum !== indexChecksum) {
    fail(`the preview at ${previewBase} is serving an index.html (${indexChecksum}) that is not this repository's build (${localIndexChecksum}). This is the stale-server failure: start a preview on a port you own, from this tree's dist.`);
  }
  if (!new TextDecoder().decode(entryBytes).includes(NORTHERN_MANHATTAN_P1_RELEASE_ID)) {
    fail(`the served entry script ${entryPath} does not name ${NORTHERN_MANHATTAN_P1_RELEASE_ID}, so it predates the pin and every opt-in journey would fail closed for the wrong reason.`);
  }

  return {
    previewBase,
    indexHtmlChecksumSha256: indexChecksum,
    localDistIndexHtmlChecksumSha256: localIndexChecksum,
    matchesLocalDist: true,
    entryScriptPath: entryPath,
    entryScriptByteSize: entryBytes.byteLength,
    entryScriptChecksumSha256: entryChecksum,
    entryScriptNamesRelease: true,
    statement: "Measured before any capture. The served index.html is byte-identical to this repository's dist/index.html and the served entry script contains this release id, so every reading below is from THIS build. Any of those failing aborts the run rather than being recorded as a caveat.",
  };
}

// ---------------------------------------------------------------------------
// Minimal CDP client
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
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "page evaluation failed");
    return result.result.value;
  }

  close() { this.socket.close(); }
}

async function openFreshPage(port, previewBase) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(previewBase)}`, { method: "PUT" })
    .catch(() => fail(`Chrome is not listening on 127.0.0.1:${port}. Launch it with --remote-debugging-port, --disable-gpu-vsync and --disable-frame-rate-limit.`));
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
  await session.send("HeapProfiler.enable");
  await session.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, mobile: false });
  return session;
}

async function closePage(port, session) {
  session.close();
  try { await fetch(`http://127.0.0.1:${port}/json/close/${session.targetId}`); } catch { /* going away either way */ }
}

/**
 * The rAF loop the page runs. Timed with `performance.now()` deltas, which is
 * the frame INTERVAL the compositor actually delivered — the quantity a vsync
 * cap pins and an uncapped run releases.
 */
const FRAME_LOOP = (settleFrames, measuredFrames) => `(() => new Promise((done) => {
  const deltas = [];
  let previous = performance.now();
  let seen = 0;
  const step = () => {
    const now = performance.now();
    const delta = now - previous;
    previous = now;
    seen += 1;
    if (seen > ${settleFrames}) deltas.push(delta);
    if (deltas.length >= ${measuredFrames}) { done(deltas); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}))()`;

function summarize(deltas) {
  const sorted = [...deltas].sort((left, right) => left - right);
  const quantile = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  return {
    frameCount: sorted.length,
    meanMilliseconds: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50Milliseconds: quantile(0.5),
    p95Milliseconds: quantile(0.95),
    p99Milliseconds: quantile(0.99),
    maximumMilliseconds: sorted[sorted.length - 1],
    minimumMilliseconds: sorted[0],
  };
}

/**
 * The vsync control, and why it is a SECOND BROWSER rather than a blank page.
 *
 * The first version of this control spun the same rAF loop on an empty page in
 * the same uncapped browser, on the theory that an empty page would read the
 * present interval. It read 18 ms — slower than every loaded station — because
 * Chrome throttles rAF on a page with nothing to draw, so the "control" was
 * measuring idle throttling and would have been published as a vsync reading.
 *
 * The control that actually answers the question is the SAME STATION, in a
 * second Chrome launched WITHOUT `--disable-gpu-vsync --disable-frame-rate-limit`.
 * If the capped run pins near the display's present interval and the uncapped
 * run sits far below it, the uncapped run is a headroom measurement. If both
 * read the same, the flags did not take and nothing here is uncapped.
 *
 * It is optional, and its absence is recorded as absence rather than assumed.
 */
async function captureCappedControl(cappedPort, previewBase, station) {
  const capture = await captureStation(cappedPort, previewBase, station, 0, {});
  return {
    stationId: station.stationId,
    remoteDebuggingPort: cappedPort,
    frameMilliseconds: capture.frameMilliseconds,
    statement: "The same station in a second Chrome launched WITHOUT the uncapping flags. Its p50 is the display's present interval; the uncapped run's p50 sitting far below it is what makes the uncapped numbers a headroom measurement rather than a floor reading.",
  };
}

async function captureStation(port, previewBase, station, repeatIndex, extraParams) {
  const session = await openFreshPage(port, previewBase);
  try {
    const url = stationUrl(previewBase, station, extraParams);
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let waves = [];
    for (;;) {
      if (Date.now() > deadline) fail(`${station.stationId} never streamed every promoted wave (last seen: ${JSON.stringify(waves)}).`);
      await new Promise((done) => { setTimeout(done, 750); });
      waves = await session.evaluate(`(() => [...document.querySelectorAll('[data-exterior-release]')].map((node) => ({
        releaseId: node.getAttribute('data-exterior-release'),
        origin: node.getAttribute('data-exterior-snapshot-origin'),
        text: (node.textContent || '').slice(0, 200),
      })))()`).catch(() => []);
      const active = waves.filter((wave) => wave.origin !== null).map((wave) => wave.releaseId);
      if (PROMOTED_RELEASE_IDS.every((releaseId) => active.includes(releaseId))) break;
    }

    const deltas = await session.evaluate(FRAME_LOOP(SETTLE_FRAMES, MEASURED_FRAMES));
    // Heap AFTER a forced collection. The uncollected reading climbs with every
    // navigation whatever the scene, which is exactly the mistake the canary's
    // first heap measurement made and recorded.
    await session.send("HeapProfiler.collectGarbage");
    await new Promise((done) => { setTimeout(done, 250); });
    const heapAfterGcBytes = await session.evaluate("performance.memory ? performance.memory.usedJSHeapSize : null");

    // Network, attributed per release from the request URLs the page actually
    // issued. Attribution by URL prefix rather than by guesswork.
    const requests = session.events
      .filter((event) => event.method === "Network.requestWillBeSent")
      .map((event) => event.params.request.url);
    const responses = new Map(session.events
      .filter((event) => event.method === "Network.responseReceived")
      .map((event) => [event.params.requestId, event.params.response.url]));
    const encoded = session.events
      .filter((event) => event.method === "Network.loadingFinished")
      .map((event) => ({ url: responses.get(event.params.requestId) ?? "", bytes: event.params.encodedDataLength ?? 0 }));
    const perRelease = {};
    for (const releaseId of [...PROMOTED_RELEASE_IDS, NORTHERN_MANHATTAN_RELEASE_ID, BASE_RELEASE_ID]) {
      const marker = `/data/${releaseId}/`;
      const matched = encoded.filter((entry) => entry.url.includes(marker));
      const glbs = matched.filter((entry) => entry.url.endsWith(".glb"));
      // RESPONSES AND DISTINCT ARTIFACTS ARE DIFFERENT NUMBERS at six waves, and
      // the difference is a real runtime behaviour rather than noise: the shared
      // LRU cache holds 512 entries, a six-wave session gets close to that, and an
      // evicted artifact that comes back into view is fetched again. Residency is
      // a question about ENTRIES, so it is derived below from the DISTINCT count;
      // the response count is kept beside it because network cost is a different
      // question and this record must not answer one with the other.
      perRelease[releaseId] = {
        requestCount: requests.filter((url) => url.includes(marker)).length,
        completedCount: matched.length,
        encodedBytes: matched.reduce((total, entry) => total + entry.bytes, 0),
        glbCount: glbs.length,
        distinctGlbCount: new Set(glbs.map((entry) => entry.url)).size,
      };
    }
    const externalHosts = [...new Set(requests
      .map((url) => { try { return new URL(url).host; } catch { return ""; } })
      .filter((host) => host !== "" && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")))];

    // Chrome hidden for the STILL only — after every frame above was timed with
    // it on screen, so nothing was removed from the measured work.
    await session.evaluate(`(() => { const style = document.createElement("style"); style.textContent = ${JSON.stringify(STILL_CHROME_HIDE_CSS)}; document.head.appendChild(style); return true; })()`);
    await new Promise((done) => { setTimeout(done, 1_200); });
    const shot = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const bytes = Buffer.from(shot.data, "base64");
    const stillPath = join(capturesRoot, `${station.stationId}__r${repeatIndex}.png`);
    await mkdir(dirname(stillPath), { recursive: true });
    await writeFile(stillPath, bytes);

    return {
      stationId: station.stationId,
      repeatIndex,
      url,
      profile: station.profile,
      activeWaves: waves.filter((wave) => wave.origin !== null).map((wave) => wave.releaseId).sort(),
      frameMilliseconds: summarize(deltas),
      heapAfterGcBytes,
      network: { perRelease, totalRequestCount: requests.length, externalHosts },
      still: {
        relativeRef: `captures/${station.stationId}__r${repeatIndex}.png`,
        byteSize: bytes.byteLength,
        checksumSha256: sha256HexBytes(new Uint8Array(bytes)),
      },
    };
  } finally {
    await closePage(port, session);
  }
}

// ---------------------------------------------------------------------------
// GPU texture arithmetic — COMPUTED, never measured
// ---------------------------------------------------------------------------

/**
 * Decoded-plus-mipmapped texture memory for the shipped subset.
 *
 * `width * height * 4 * 1.33 * imageCount`, the ADR 0032 precedent, with every
 * term stated:
 *
 *  - `width`/`height` are the catalogue's tile dimensions, read from the
 *    rasterizer constant rather than from a memory of what they are;
 *  - `4` is bytes per texel once decoded. The shipped PNGs are single-channel
 *    grayscale, but a GL texture uploaded from an ImageBitmap is RGBA8, so the
 *    decoded footprint is four times the sampled channel, not one;
 *  - `1.33` is the full mip chain's geometric series (1 + 1/4 + 1/16 + …);
 *  - `imageCount` is every embedded image across every shipped GLB, counted
 *    from the emitted bytes. It is NOT deduplicated across models: the
 *    catalogue has four motifs, but each GLB is its own glTF and CesiumJS
 *    uploads its textures per model, so an all-resident scene holds one upload
 *    per embedded image. Deduplicating would understate the ceiling.
 *
 * This is an UPPER BOUND on an all-resident scene, and it is ARITHMETIC. No
 * instrument reachable from this session reports texture VRAM, and this number
 * must never be reported as a measurement.
 */
async function gpuTextureArithmetic() {
  if (!existsSync(p1AssetsRoot)) fail(`the P1 assets are absent at ${p1AssetsRoot}; the texture arithmetic has nothing to count.`);
  const names = (await readdir(p1AssetsRoot)).filter((name) => name.endsWith(".glb")).sort();
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let imageCount = 0;
  const dimensions = new Map();
  for (const name of names) {
    const bytes = await readFile(join(p1AssetsRoot, name));
    let offset = 0;
    for (;;) {
      const index = bytes.indexOf(signature, offset);
      if (index < 0) break;
      const width = bytes.readUInt32BE(index + 16);
      const height = bytes.readUInt32BE(index + 20);
      dimensions.set(`${width}x${height}`, (dimensions.get(`${width}x${height}`) ?? 0) + 1);
      imageCount += 1;
      offset = index + 8;
    }
  }
  if (imageCount === 0) fail("no embedded image was found in the shipped assets; the arithmetic would report zero texture cost for a textured wave.");
  const size = PROCEDURAL_TEXTURE_TILE_PIXELS;
  const unexpected = [...dimensions.keys()].filter((key) => key !== `${size}x${size}`);
  if (unexpected.length > 0) fail(`shipped images carry unexpected dimensions ${unexpected.join(", ")}; the single-size arithmetic would be wrong.`);
  const decodedBytes = size * size * 4 * imageCount;
  const withMipsBytes = decodedBytes * 1.33;
  return {
    basis: "computed-not-measured",
    statement: "Decoded-plus-mipmapped texture memory for the shipped subset, computed as width * height * 4 * 1.33 * imageCount from the emitted bytes. GPU texture memory was NOT measured: no instrument reachable from this session reports texture VRAM, and usedJSHeapSize does not stand in for it. This is an upper bound on an all-resident scene and it is arithmetic.",
    assetCount: names.length,
    imageCount,
    tileWidthPixels: size,
    tileHeightPixels: size,
    bytesPerTexel: 4,
    mipChainFactor: 1.33,
    decodedBytes,
    decodedMebibytes: decodedBytes / 1024 / 1024,
    withMipsBytes,
    withMipsMebibytes: withMipsBytes / 1024 / 1024,
    deduplicatedAcrossModels: false,
    otherPromotedWavesTextureBytes: null,
    otherPromotedWavesNote: "The Block 835 V3 and Midtown-core V3 waves are TEXTURE-FREE releases and contribute nothing. The Lower-Manhattan P1, Southern-remainder P1 and Central-and-upper-Manhattan P1 waves are NOT: all three are textured LOD 0, over 71, 179 and 40 assets, and each computes its own share in its own T016, T018 and T020 record. The figure above is THIS release's share alone and must not be read as the whole promoted composition's; `promotedCompositionNote` states how the sum is formed.",
    promotedCompositionNote: "FOUR of the six promoted waves carry tiles, and this is the last wave, so the sum is now closed: adding this release's computed share to the T016, T018 and T020 records' gives the whole promoted composition's computed upper bound. All four are arithmetic and none is a measurement.",
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const previewBase = argValue(argv, "--preview", "http://localhost:4174").replace(/\/$/u, "");
  const port = Number(argValue(argv, "--port", "9222"));
  const repeats = Number(argValue(argv, "--repeats", "3"));
  const outPath = resolve(argValue(argv, "--out", defaultOutPath));

  const gpu = await gpuTextureArithmetic();
  if (argv.includes("--gpu-arithmetic")) {
    console.log(JSON.stringify(gpu, null, 2));
    return;
  }

  // WHICH bundle is being served, before anything is measured. Fails the run
  // rather than being recorded as a caveat.
  const servedBundle = await servedBundleIdentity(previewBase);
  console.error(`bundle ${servedBundle.entryScriptPath} ${servedBundle.entryScriptChecksumSha256.slice(0, 16)}`);

  const cappedPort = argv.includes("--capped-port") ? Number(argValue(argv, "--capped-port", "0")) : null;
  const cappedControl = cappedPort
    ? await captureCappedControl(cappedPort, previewBase, STATIONS[1])
    : null;
  const captures = [];
  for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex += 1) {
    for (const station of STATIONS) {
      console.error(`capturing ${station.stationId} repeat ${repeatIndex} ...`);
      captures.push(await captureStation(port, previewBase, station, repeatIndex, {}));
    }
  }

  const perStation = STATIONS.map((station) => {
    const runs = captures.filter((entry) => entry.stationId === station.stationId);
    const budget = FRAME_BUDGETS[station.profile];
    const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
    const p50 = median(runs.map((run) => run.frameMilliseconds.p50Milliseconds));
    const p95 = median(runs.map((run) => run.frameMilliseconds.p95Milliseconds));
    const heaps = runs.map((run) => run.heapAfterGcBytes).filter((value) => typeof value === "number");
    return {
      stationId: station.stationId,
      profile: station.profile,
      note: station.note,
      pose: station.pose,
      repeats: runs.length,
      medianOfRunP50Milliseconds: p50,
      medianOfRunP95Milliseconds: p95,
      worstObservedFrameMilliseconds: Math.max(...runs.map((run) => run.frameMilliseconds.maximumMilliseconds)),
      budget,
      p50WithinBudget: p50 <= budget.p50Milliseconds,
      p95WithinBudget: p95 <= budget.p95Milliseconds,
      p50HeadroomRatio: p50 / budget.p50Milliseconds,
      p95HeadroomRatio: p95 / budget.p95Milliseconds,
      heapAfterGcBytes: { minimum: Math.min(...heaps), maximum: Math.max(...heaps), median: median(heaps) },
      // Off the floor, stated as a comparison rather than as a claim.
      p50OverCappedControlP50: cappedControl ? p50 / cappedControl.frameMilliseconds.p50Milliseconds : null,
    };
  });

  /**
   * Cache residency, DERIVED from the per-release network measurement.
   *
   * The exterior runtime keys its LRU cache per artifact, so one fetched GLB is
   * one resident entry. The counts below are therefore what the session actually
   * put in the cache, read off the requests the page issued.
   *
   * It is DERIVED, not read out of the cache counter. `exteriorCacheSample()`
   * exists but only reaches the DOM in a `VITE_BLOCK835_PROBE=1` build, and this
   * measurement is deliberately taken against the ORDINARY production preview —
   * the build a user gets — so the residency is inferred from the fetches rather
   * than read from an instrument that ordinary build does not carry.
   */
  const residencyRuns = captures.map((capture) => {
    const perRelease = capture.network.perRelease;
    const entries = PROMOTED_RELEASE_IDS.reduce((total, releaseId) => total + perRelease[releaseId].distinctGlbCount, 0);
    const responses = PROMOTED_RELEASE_IDS.reduce((total, releaseId) => total + perRelease[releaseId].glbCount, 0);
    const bytes = PROMOTED_RELEASE_IDS.reduce((total, releaseId) => total + perRelease[releaseId].encodedBytes, 0);
    return { stationId: capture.stationId, repeatIndex: capture.repeatIndex, entries, glbResponses: responses, bytes };
  });
  const worstResidency = residencyRuns.reduce((worst, run) => (run.entries > worst.entries ? run : worst), residencyRuns[0]);
  const cacheResidency = {
    basis: "derived-from-network-not-read-from-the-cache-counter",
    statement: "One DISTINCT fetched GLB is one LRU entry, so the entry count is the count of distinct GLB URLs the session completed and the byte figure is the encoded size of every response. AT SIX WAVES THOSE ARE NO LONGER THE SAME NUMBER, and this is the first record where they differ: the cache holds 512 entries, a six-wave session gets close to that, and an evicted artifact that comes back into view is fetched a second time. `glbResponses` is kept beside `entries` in every run so the gap is visible rather than absorbed — counting responses would OVERSTATE residency, which is the safe direction but not the true one. The in-app cache counter is only published to the DOM in a VITE_BLOCK835_PROBE build; this measurement is against the ordinary production preview a user gets, so residency is derived from the fetches instead.",
    perRun: residencyRuns,
    worstObserved: worstResidency,
    maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
    maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
    withinEntryBudget: worstResidency.entries <= EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
    withinByteBudget: worstResidency.bytes <= EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
    releaseTimeDerivation: {
      maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
      promotedAssetEntriesBeforeThisWave: 474,
      thisWaveAssetEntries: 24,
      residentAssetEntries: 498,
      headroomForFurtherWaves: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries - 498,
      reservedForThisWaveEntries: 36,
      unspentReservedEntries: 12,
      note: "The RELEASE-TIME derivation counts GLB FILES ON DISK: 28 for Block 835 V3, which ships two LODs per building, 156 for Midtown-core V3, 71 for Lower-Manhattan P1, 179 for Southern-remainder P1, 40 for Central-and-upper-Manhattan P1 and 24 for this release. At runtime a session fetches fewer, because only the selected LOD is requested — the T016 record measured 14 Block 835 GLBs against 28 on disk — so the disk derivation is CONSERVATIVE rather than wrong, and `worstObserved` above is what this session actually made resident. An immutable release must be sized against the release-time number, which is why both are recorded. THIS IS THE LEDGER-WIDE END STATE: six of six declared waves are promoted, they occupy 498 of 512 entries, and the 14 that remain are headroom with no unpromoted wave left to reserve them for. This promotion spent 24 of the 36 entries T020's split reserved for it and left 12 unspent, because the curated cell's four edge-neighbours own 40, 41, 53 and 89 buildings and the contiguity precondition refuses a second, non-adjacent island. The cache cap was NOT raised.",
    },
  };

  const evidence = {
    schemaVersion: "1.0",
    releaseId: NORTHERN_MANHATTAN_P1_RELEASE_ID,
    servedBundle,
    capAtMeasurement: {
      maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
      maxCachedBytes: EXTERIOR_RUNTIME_BUDGETS.maxCachedBytes,
      statement: "THE 512-ENTRY CAP WAS IN FORCE FOR EVERY READING BELOW AND THIS PROMOTION DID NOT CHANGE IT. This promotion consumes the 36-entry reservation T020's split committed to this wave rather than cutting a new share or raising a cap, so both cache caps are exactly what T018 left them. The values here are read from EXTERIOR_RUNTIME_BUDGETS in the same tree the served bundle was built from rather than typed into this record, so a reading taken at a different cap cannot be presented as a reading at this one.",
    },
    note: "T022 promotion acceptance, and the last one this ledger can produce. The PROMOTED DEFAULT COMPOSITION — Block 835 V3, Midtown-core V3, and the Lower-Manhattan, Southern-remainder, Central-and-upper-Manhattan and Northern-Manhattan P1 successors streaming together over the pinned manhattan-citywide-20260804 base — measured in the production preview build by the shipping CesiumJS renderer, with Chrome's vsync and frame-rate limit disabled, at the UNCHANGED 512-entry cache cap. A SIX-wave composition had never been measured before this run; T020 measured five. The capped control is captured in a second browser, GPU texture memory is labelled COMPUTED because it is computed, and isolated slow frames are STATED rather than smoothed: `cappedControl` is the reading that proves this run is uncapped, `gpuTextureArithmetic` is computed and is not measured anywhere in this file, and every station carries `worstObservedFrameMilliseconds` beside its medians. WHAT THIS MEASUREMENT IS NOT: it is not evidence that the city is textured. Six of six waves have a promoted default and they ship 498 assets against a pinned base of 45,194 canonical buildings, so what is measured here is a composition of six small curated subsets streaming together, which is exactly what the promotion record claims and nothing more.",
    promotedReleaseIds: PROMOTED_RELEASE_IDS,
    baseReleaseId: BASE_RELEASE_ID,
    capturedWith: {
      viewport: VIEWPORT,
      previewBase,
      remoteDebuggingPort: port,
      settleFrames: SETTLE_FRAMES,
      measuredFrames: MEASURED_FRAMES,
      repeats,
      chromeFlags: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
    },
    frameBudgets: FRAME_BUDGETS,
    cappedControl: cappedControl ?? {
      statement: "NOT CAPTURED. No second, vsync-capped Chrome was supplied with --capped-port, so this run states no measured control for the uncapping flags. The station numbers below are still uncapped readings only if the flags took, and without this control that rests on the command line rather than on evidence.",
    },
    stillCapture: {
      chromeHiddenForStill: true,
      css: STILL_CHROME_HIDE_CSS,
      statement: "The app's overlay chrome and fallback notices are hidden for the SCREENSHOT ONLY, injected after every timed frame was rendered with them on screen. No measured frame had less work in it than a real session's.",
    },
    runtimeBudgets: { ...EXTERIOR_RUNTIME_BUDGETS },
    gpuTextureArithmetic: gpu,
    cacheResidency,
    stations: perStation,
    captures,
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serializeExteriorWaveArtifact(evidence), "utf8");
  console.log(JSON.stringify({
    ok: true,
    outPath,
    outChecksumSha256: sha256HexSync(serializeExteriorWaveArtifact(evidence)),
    cappedControlP50Milliseconds: cappedControl?.frameMilliseconds.p50Milliseconds ?? null,
    stations: perStation.map((station) => ({
      stationId: station.stationId,
      profile: station.profile,
      p50: station.medianOfRunP50Milliseconds,
      p95: station.medianOfRunP95Milliseconds,
      worst: station.worstObservedFrameMilliseconds,
      p50WithinBudget: station.p50WithinBudget,
      p95WithinBudget: station.p95WithinBudget,
    })),
  }, null, 2));
}

await main();
