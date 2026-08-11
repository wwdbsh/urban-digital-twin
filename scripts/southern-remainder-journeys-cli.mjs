/* global console, process, WebSocket, URL, fetch, setTimeout, Buffer */
/**
 * T017 renderer journeys: the Southern-remainder canary exercised in a real
 * browser against the real pinned citywide base, one journey per claim the
 * canary makes.
 *
 * A release graph, a checksum inventory and a drift gate prove what the BUILD
 * accepts. They cannot prove that an opt-in link streams this release and only
 * this release, that a picked building names its own release and the checksum of
 * the asset on screen, that 175 unshipped cells say so in words, or that pinning
 * a canary left the promoted default alone. Those are browser facts, and this
 * captures them as browser facts.
 *
 * The FIRST journey is load-bearing beyond its own claim. This canary's entry
 * budget rests on `?exteriorCells=` SELECTING the named release rather than
 * ADDING it: three promoted waves already occupy 255 of the 256-entry exterior
 * cache, so if an opt-in session also held the promoted assets there would be no
 * budget to size against. `canary-opt-in` measures that directly — the promoted
 * releases must fetch ZERO GLBs while the canary fetches all 76.
 *
 * Journeys, in the order they run:
 *   promoted-default-unchanged  A clean no-param load streams the three promoted
 *                               waves and NOT this canary.
 *   canary-opt-in               The opt-in link streams the canary ALONE.
 *   textured-pick               A picked building in the renderable cell names
 *                               its release, cell, cell release, asset checksum,
 *                               truth tiers and uncertainty statement.
 *   tombstone-truth             The 175 owned cells this release does not
 *                               materialize are reported in words.
 *
 * Full acceptance measurement — frame time and heap off the vsync floor, GPU
 * texture accounting, cache residency — is NOT here and is not claimed. That is
 * promotion's instrument, it runs against a promoted composition, and this
 * release is not promoted.
 *
 * Usage:
 *   node scripts/southern-remainder-journeys-cli.mjs \
 *     --preview http://localhost:4174 --port 9222 [--out <path>]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import { SOUTHERN_REMAINDER_RELEASE_ID } from "../src/release/southern-remainder-package.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const capturesRoot = join(repositoryRoot, "artifacts", "southern-remainder-20260812-journeys");
const defaultOutPath = join(repositoryRoot, "data", "southern-remainder-20260812", "journey-evidence.json");

const BASE_RELEASE_ID = "manhattan-citywide-20260804";
const BLOCK835_RELEASE_ID = "manhattan-exterior-cells-20260811-v3";
const MIDTOWN_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3";
const LOWER_MANHATTAN_P1_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812-p1";
const PROMOTED_RELEASE_IDS = [BLOCK835_RELEASE_ID, MIDTOWN_RELEASE_ID, LOWER_MANHATTAN_P1_RELEASE_ID];
const TRACKED_RELEASE_IDS = [...PROMOTED_RELEASE_IDS, SOUTHERN_REMAINDER_RELEASE_ID];

/** What the canary ships, read from its own committed record by the caller. */
const CANARY_ASSET_COUNT = 76;
const CANARY_CELL_ID = "manhattan-exterior-cell-w03-000276-17-38590-35872";
const CANARY_OWNED_CELL_COUNT = 176;
const CANARY_TOMBSTONED_CELL_COUNT = 175;
/** The heaviest shipped asset of the renderable cell; a pick anyone can repeat. */
const CANARY_PICK_BUILDING_ID = "doitt:465469";

const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 180_000;
const STILL_CHROME_HIDE_CSS = ".exploration-notice, .runtime-note, nav, header, footer { display: none !important; }";

/** A camera inside the renderable cell, looking north-east across it. */
const CELL_POSE = { lon: -74.00930, lat: 40.73520, height: 170, heading: 35, pitch: -8, roll: 0 };

function fail(message) { throw new Error(`southern-remainder-journeys: ${message}`); }

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

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

function appUrl(previewBase, { pose = null, params = {} } = {}) {
  const url = new URL(previewBase);
  url.pathname = "/";
  url.searchParams.set("data", BASE_RELEASE_ID);
  url.searchParams.set("release", BASE_RELEASE_ID);
  if (pose) {
    url.searchParams.set("view", "explore");
    for (const [key, value] of Object.entries(pose)) url.searchParams.set(key, value.toFixed(6));
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

const READ_WAVES = `[...document.querySelectorAll('[data-exterior-release]')].map((node) => ({
  releaseId: node.getAttribute('data-exterior-release'),
  origin: node.getAttribute('data-exterior-snapshot-origin'),
  text: (node.textContent || '').trim().slice(0, 240),
}))`;

async function waitFor(session, predicate, expression, label) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = null;
  for (;;) {
    if (Date.now() > deadline) fail(`${label} never settled (last: ${JSON.stringify(last)?.slice(0, 400)}).`);
    await new Promise((done) => { setTimeout(done, 750); });
    last = await session.evaluate(expression).catch(() => null);
    if (last !== null && predicate(last)) return last;
  }
}

async function still(session, journeyId) {
  await session.evaluate(`(() => { const style = document.createElement("style"); style.textContent = ${JSON.stringify(STILL_CHROME_HIDE_CSS)}; document.head.appendChild(style); return true; })()`);
  await new Promise((done) => { setTimeout(done, 1_200); });
  const shot = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(shot.data, "base64");
  const path = join(capturesRoot, `${journeyId}.png`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return { relativeRef: `${journeyId}.png`, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(new Uint8Array(bytes)) };
}

function networkPerRelease(session) {
  const responses = new Map(session.events
    .filter((event) => event.method === "Network.responseReceived")
    .map((event) => [event.params.requestId, event.params.response.url]));
  const finished = session.events
    .filter((event) => event.method === "Network.loadingFinished")
    .map((event) => ({ url: responses.get(event.params.requestId) ?? "", bytes: event.params.encodedDataLength ?? 0 }));
  const perRelease = {};
  for (const releaseId of TRACKED_RELEASE_IDS) {
    const matched = finished.filter((entry) => entry.url.includes(`/data/${releaseId}/`));
    perRelease[releaseId] = { glbCount: matched.filter((entry) => entry.url.endsWith(".glb")).length, encodedBytes: matched.reduce((total, entry) => total + entry.bytes, 0) };
  }
  const external = [...new Set(finished
    .map((entry) => { try { return new URL(entry.url).host; } catch { return ""; } })
    .filter((host) => host !== "" && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")))];
  return { perRelease, externalHosts: external };
}

/**
 * Waits for a release's GLB fetches to reach an expected total or stop growing.
 *
 * Readiness means a wave ACTIVATED, not that every asset arrived: the loader is
 * progressive, and sampling the instant a wave goes active reads a partial
 * count. Settling on "reached the total, or stopped growing" makes the claim
 * about what the session streams rather than about when it was sampled.
 */
async function settleGlbCount(session, releaseId, expected) {
  let previous = -1;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const count = networkPerRelease(session).perRelease[releaseId].glbCount;
    if (count === expected) break;
    if (count === previous && attempt > 4) break;
    previous = count;
    await new Promise((done) => { setTimeout(done, 1_000); });
  }
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

async function journeyPromotedDefaultUnchanged(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: CELL_POSE });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    const waves = await waitFor(
      session,
      (value) => PROMOTED_RELEASE_IDS.every((releaseId) => value.some((wave) => wave.releaseId === releaseId && wave.origin !== null)),
      READ_WAVES,
      "promoted-default-unchanged",
    );
    await settleGlbCount(session, LOWER_MANHATTAN_P1_RELEASE_ID, 71);
    const network = networkPerRelease(session);
    return {
      journeyId: "promoted-default-unchanged",
      claim: "Pinning this canary changed nothing about what an ordinary session loads. A clean load with no exterior URL parameter still streams the three promoted waves and fetches ZERO bytes of the Southern-remainder release, even with the camera standing inside its renderable cell.",
      url,
      waves,
      network,
      passed: PROMOTED_RELEASE_IDS.every((releaseId) => network.perRelease[releaseId].glbCount > 0)
        && network.perRelease[SOUTHERN_REMAINDER_RELEASE_ID].glbCount === 0
        && network.perRelease[SOUTHERN_REMAINDER_RELEASE_ID].encodedBytes === 0
        && network.externalHosts.length === 0,
      still: await still(session, "promoted-default-unchanged"),
    };
  } finally { await closePage(port, session); }
}

async function journeyCanaryOptIn(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: CELL_POSE, params: { exteriorCells: SOUTHERN_REMAINDER_RELEASE_ID, exteriorStreaming: "on" } });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    const waves = await waitFor(
      session,
      (value) => value.some((wave) => wave.releaseId === SOUTHERN_REMAINDER_RELEASE_ID && wave.origin !== null),
      READ_WAVES,
      "canary-opt-in",
    );
    await settleGlbCount(session, SOUTHERN_REMAINDER_RELEASE_ID, CANARY_ASSET_COUNT);
    const network = networkPerRelease(session);
    return {
      journeyId: "canary-opt-in",
      claim: "`?exteriorCells=` SELECTS the named release rather than adding it: the opt-in link streams all 76 textured assets of the Southern-remainder canary and ZERO GLBs of any promoted wave. This is the measurement the canary's entry budget rests on — three promoted waves occupy 255 of 256 cache entries, so an opt-in session that also held them would have no budget to size against.",
      url,
      waves,
      network,
      expectedCanaryGlbCount: CANARY_ASSET_COUNT,
      passed: network.perRelease[SOUTHERN_REMAINDER_RELEASE_ID].glbCount === CANARY_ASSET_COUNT
        && PROMOTED_RELEASE_IDS.every((releaseId) => network.perRelease[releaseId].glbCount === 0)
        && network.externalHosts.length === 0,
      still: await still(session, "canary-opt-in"),
    };
  } finally { await closePage(port, session); }
}

async function journeyTexturedPick(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: CELL_POSE, params: { exteriorCells: SOUTHERN_REMAINDER_RELEASE_ID, exteriorStreaming: "on" } });
    await session.send("Page.navigate", { url });
    await waitFor(
      session,
      (value) => value.some((wave) => wave.releaseId === SOUTHERN_REMAINDER_RELEASE_ID && wave.origin !== null),
      READ_WAVES,
      "textured-pick",
    );
    await settleGlbCount(session, SOUTHERN_REMAINDER_RELEASE_ID, CANARY_ASSET_COUNT);
    // Select through the app's own search, so the pick travels the path a
    // user's pick travels rather than a test-only seam.
    await session.evaluate(`(() => {
      const open = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Open details');
      if (open) open.click();
      const search = document.querySelector('input[type="search"], input[placeholder*="Search"]');
      if (search) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(search, ${JSON.stringify(CANARY_PICK_BUILDING_ID)});
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    })()`);
    await new Promise((done) => { setTimeout(done, 2_500); });
    const results = await session.evaluate(`(() => {
      const options = [...document.querySelectorAll('[role="option"], .search-result, li button')];
      const first = options[0];
      if (first) first.click();
      return options.slice(0, 4).map((node) => (node.textContent || '').trim().slice(0, 120));
    })()`).catch(() => []);
    await new Promise((done) => { setTimeout(done, 3_000); });
    const detail = await session.evaluate(`(() => {
      const section = document.querySelector('.exterior-streaming-detail');
      if (!section) return null;
      const rows = {};
      section.querySelectorAll('div').forEach((row) => {
        const term = row.querySelector('dt');
        const value = row.querySelector('dd');
        if (term && value) rows[(term.textContent || '').trim()] = (value.textContent || '').trim();
      });
      const badge = section.querySelector('.truth-badge');
      return {
        badge: badge ? (badge.textContent || '').trim() : null,
        badgeOrigin: badge ? badge.getAttribute('data-exterior-snapshot-origin') : null,
        rows,
        heading: (document.querySelector('h1') || {}).textContent || null,
      };
    })()`);
    const rows = detail?.rows ?? {};
    return {
      journeyId: "textured-pick",
      claim: "A picked building inside the renderable cell names the release it came from, its cell and cell release, the checksum of the exact asset on screen, its generated truth tiers, and an uncertainty statement.",
      url,
      pickedBuildingId: CANARY_PICK_BUILDING_ID,
      searchResults: results,
      detail,
      passed: Boolean(detail)
        && String(detail.badge ?? "").includes(SOUTHERN_REMAINDER_RELEASE_ID)
        && String(rows["Cell / release"] ?? "").includes(CANARY_CELL_ID)
        && /[0-9a-f]{64}/u.test(String(rows["Active asset"] ?? ""))
        && String(rows["Truth tiers"] ?? "").length > 0
        && String(rows["Uncertainty"] ?? "").length > 0,
      still: await still(session, "textured-pick"),
    };
  } finally { await closePage(port, session); }
}

async function journeyTombstoneTruth(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: CELL_POSE, params: { exteriorCells: SOUTHERN_REMAINDER_RELEASE_ID, exteriorStreaming: "on" } });
    await session.send("Page.navigate", { url });
    await waitFor(
      session,
      (value) => value.some((wave) => wave.releaseId === SOUTHERN_REMAINDER_RELEASE_ID && wave.origin !== null),
      READ_WAVES,
      "tombstone-truth",
    );
    await new Promise((done) => { setTimeout(done, 4_000); });
    const notices = await session.evaluate(`(() => [...document.querySelectorAll('[data-exterior-notices] li')].map((node) => (node.textContent || '').trim()))()`);
    const waveNotice = notices.find((notice) => notice.includes(SOUTHERN_REMAINDER_RELEASE_ID)) ?? null;
    return {
      journeyId: "tombstone-truth",
      claim: `The ${CANARY_TOMBSTONED_CELL_COUNT} owned w03 cells this release does NOT materialize are reported in words — the release says how many of its ${CANARY_OWNED_CELL_COUNT} cells ship no exterior geometry and that no substitute was selected — rather than going quiet.`,
      url,
      notices,
      waveNotice,
      passed: typeof waveNotice === "string"
        && waveNotice.includes(`${CANARY_TOMBSTONED_CELL_COUNT} of ${CANARY_OWNED_CELL_COUNT}`)
        && waveNotice.includes("no substitute was selected"),
      still: await still(session, "tombstone-truth"),
    };
  } finally { await closePage(port, session); }
}

// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const previewBase = argValue(argv, "--preview", "http://localhost:4174").replace(/\/$/u, "");
  const port = Number(argValue(argv, "--port", "9222"));
  const outPath = resolve(argValue(argv, "--out", defaultOutPath));

  const journeys = [];
  for (const [label, run] of [
    ["promoted-default-unchanged", journeyPromotedDefaultUnchanged],
    ["canary-opt-in", journeyCanaryOptIn],
    ["textured-pick", journeyTexturedPick],
    ["tombstone-truth", journeyTombstoneTruth],
  ]) {
    console.error(`journey ${label} ...`);
    journeys.push(await run(port, previewBase));
  }

  const evidence = {
    schemaVersion: "1.0",
    releaseId: SOUTHERN_REMAINDER_RELEASE_ID,
    note: "T017 renderer journeys against the production preview and the real pinned citywide base. Each entry records the claim it tests, the URL it used, the DOM text it read, the per-release network measurement, and a checksummed still. `passed` is computed from the readings, not asserted.",
    capturedWith: { viewport: VIEWPORT, previewBase, remoteDebuggingPort: port, pose: CELL_POSE },
    notMeasuredHere: [
      "Frame time, heap, GPU texture accounting and cache residency. Those are PROMOTION's instrument: they measure a promoted composition under the default activation, and this release is not promoted. The tile system's own cost was measured by T015's kill switch and re-measured off the vsync floor by T016; this wave changes which buildings carry those tiles, not the tiles.",
      "Per-wave ROLLBACK rehearsal. No URL expresses a build-time promotion-record swap, and this release has no promotion record to roll back.",
      "Single-cell FAULT isolation. The exterior-cell fault injector is gated behind a VITE_BLOCK835_PROBE=1 build, which is not the production preview a user gets, so it is not exercised here and this record does not claim a browser proved it.",
    ],
    journeys,
    allPassed: journeys.every((journey) => journey.passed),
  };
  await mkdir(dirname(outPath), { recursive: true });
  const text = serializeExteriorWaveArtifact(evidence);
  await writeFile(outPath, text, "utf8");
  console.log(JSON.stringify({
    ok: true,
    outPath,
    outChecksumSha256: sha256HexSync(text),
    results: journeys.map((journey) => ({ journeyId: journey.journeyId, passed: journey.passed })),
  }, null, 2));
}

await main();
