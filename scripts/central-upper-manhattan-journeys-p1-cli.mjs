/* global console, process, WebSocket, URL, fetch, setTimeout, Buffer, TextDecoder */
/**
 * T020 renderer journeys: the FIVE-WAVE promoted composition exercised in a real
 * browser against the real base, one journey per claim the promotion makes.
 *
 * A promotion record and a drift gate prove what the BUILD accepts. They cannot
 * prove that a clean session streams five waves, that a picked Central Park West
 * building names its own release and checksum, that an unshipped cell says so in
 * words, or that switching exteriors off switches all five off. Those are browser
 * facts, and this captures them as browser facts.
 *
 * Two disciplines are carried forward from T017 because each was a real defect
 * there:
 *
 *   THE BUNDLE IS IDENTIFIED BEFORE ANY CAPTURE. A stale `vite preview` on a
 *   shared port was measured once and its "pass" was vacuous. `servedBundle` now
 *   measures the served index and entry script, compares them with this tree's
 *   `dist/`, and aborts if the entry script does not name this release.
 *
 *   A TEXTURED/UNTEXTURED CLAIM MUST BE PROVEN BY A STILL THAT DIFFERS. Fetching
 *   assets proves they were downloaded, not that they were drawn: T017's first
 *   corrected pose produced byte-identical stills because it looked at rooftops.
 *   So `streaming-off` runs at the IDENTICAL pose as `cold-default` and requires
 *   its still to DIFFER from it. That comparison is the only thing in this file
 *   that proves the 40 curated assets reach the screen.
 *
 * Every journey writes its own evidence entry with the DOM text it read and a
 * checksummed still, so a reader can check the claim rather than take it.
 *
 * Journeys, in the order they run:
 *   cold-default        A clean no-param load streams all FIVE waves, and the
 *                       curated w04 cells render their 40 textured assets.
 *   cross-wave-pick     A curated w04 skyline building names its release, cell,
 *                       cell release, asset checksum, truth tiers and
 *                       uncertainty statement.
 *   canary-opt-in       The T019 canary's `?exteriorCells=` link still resolves
 *                       to the canary alone, unchanged by its wave's promotion.
 *   streaming-off       `exteriorStreaming=off` disables ALL five waves, and its
 *                       still DIFFERS from the promoted default's at the same
 *                       pose, which is what proves the tiles are drawn.
 *   tombstone-truth     An unshipped w04 cell states that it ships no exterior
 *                       geometry, rather than going quiet.
 *
 * The per-wave ROLLBACK rehearsal and the FAULT isolation journey are not here,
 * for the reasons T016 gave and which have not changed. Rollback is a build-time
 * record swap with no URL that expresses it, so it runs through the promotion
 * record's own injection seam in a named test; the cell fault injector is gated
 * behind a `VITE_BLOCK835_PROBE=1` build, which is not the production preview a
 * user gets. Both are named in `coveredByTestsInstead` rather than left for a
 * reader to assume a browser proved them.
 *
 * Usage:
 *   node scripts/central-upper-manhattan-journeys-p1-cli.mjs \
 *     --preview http://localhost:4174 --port 9222 [--out <path>]
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import { LOWER_MANHATTAN_P1_RELEASE_ID } from "../src/release/lower-manhattan-p1-release.ts";
import { SOUTHERN_REMAINDER_P1_RELEASE_ID } from "../src/release/southern-remainder-p1-release.ts";
import { CENTRAL_UPPER_MANHATTAN_RELEASE_ID } from "../src/release/central-upper-manhattan-package.ts";
import { CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID } from "../src/release/central-upper-manhattan-p1-release.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const capturesRoot = join(repositoryRoot, "artifacts", "central-upper-manhattan-20260812-p1-journeys", "journeys");
const defaultOutPath = join(repositoryRoot, "data", "central-upper-manhattan-20260812-p1", "journey-evidence.json");
const distRoot = join(repositoryRoot, "dist");
const ledgerPath = join(repositoryRoot, "data", "normalized", "manhattan-exterior-wave-ledger-20260804", "ledger.json");

const BASE_RELEASE_ID = "manhattan-citywide-20260804";
const BLOCK835_RELEASE_ID = "manhattan-exterior-cells-20260811-v3";
const MIDTOWN_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3";
const PROMOTED_RELEASE_IDS = [BLOCK835_RELEASE_ID, MIDTOWN_RELEASE_ID, LOWER_MANHATTAN_P1_RELEASE_ID, SOUTHERN_REMAINDER_P1_RELEASE_ID, CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID];

/** Everything this release actually shipped, so no count below is remembered. */
const PROMOTED_ASSET_COUNT = 40;
const CANARY_ASSET_COUNT = 75;
const CANARY_CELL_ID = "manhattan-exterior-cell-w04-000452-17-38598-35840";
/** The tallest sourced structure in any admissible cell of wave w04, at 219.2 m. */
const SKYLINE_BUILDING_ID = "doitt:1305508";

const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 180_000;
const STILL_CHROME_HIDE_CSS = ".exploration-notice, .runtime-note, nav, header, footer { display: none !important; }";

/**
 * A camera standing on the PROMOTED PARKLAND of curated cell 491 and looking WEST
 * at the tower wall of curated cell 490; the same pose the acceptance run measured
 * at `centralpark-west-facade`. Low and shallow on purpose: facades are vertical,
 * and T017 records a corrected pose that stood 260 m up looking down and produced
 * byte-identical stills.
 */
const CURATED_POSE = { lon: -73.97400, lat: 40.77160, height: 150, heading: 272, pitch: -4, roll: 0 };

function fail(message) { throw new Error(`central-upper-manhattan-journeys-p1: ${message}`); }

/**
 * A pose inside the CANARY's own renderable cell, derived from that cell's
 * committed ledger bounds rather than typed by hand — the T017 correction, kept.
 * A journey that claims the camera stands inside a cell must be able to prove it.
 */
const CANARY_CELL_VIEW = { eastFraction: 0.12, northFraction: 0.12, heightMeters: 70, headingDegrees: 45, pitchDegrees: -6 };

async function canaryPose() {
  if (!existsSync(ledgerPath)) fail(`the committed wave ledger is absent at ${ledgerPath}.`);
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const cell = ledger.cells.find((entry) => entry.cellId === CANARY_CELL_ID);
  if (!cell) fail(`the committed ledger declares no cell ${CANARY_CELL_ID}.`);
  const pose = {
    lon: cell.bounds.west + CANARY_CELL_VIEW.eastFraction * (cell.bounds.east - cell.bounds.west),
    lat: cell.bounds.south + CANARY_CELL_VIEW.northFraction * (cell.bounds.north - cell.bounds.south),
    height: CANARY_CELL_VIEW.heightMeters,
    heading: CANARY_CELL_VIEW.headingDegrees,
    pitch: CANARY_CELL_VIEW.pitchDegrees,
    roll: 0,
  };
  const inside = pose.lon >= cell.bounds.west && pose.lon <= cell.bounds.east
    && pose.lat >= cell.bounds.south && pose.lat <= cell.bounds.north;
  if (!inside) fail(`the derived canary pose is outside ${CANARY_CELL_ID}; no journey may claim otherwise.`);
  return { pose, containment: { cellId: CANARY_CELL_ID, cellBounds: { ...cell.bounds }, containment: "asserted before capture from the committed ledger bounds, on both axes" } };
}

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

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
  if (!new TextDecoder().decode(entryBytes).includes(CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID)) {
    fail(`the served entry script ${entryPath} does not name ${CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID}, so it predates the pin and every opt-in journey would fail closed for the wrong reason.`);
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
  return { relativeRef: `journeys/${journeyId}.png`, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(new Uint8Array(bytes)) };
}

function networkPerRelease(session) {
  const responses = new Map(session.events
    .filter((event) => event.method === "Network.responseReceived")
    .map((event) => [event.params.requestId, event.params.response.url]));
  const finished = session.events
    .filter((event) => event.method === "Network.loadingFinished")
    .map((event) => ({ url: responses.get(event.params.requestId) ?? "", bytes: event.params.encodedDataLength ?? 0 }));
  const perRelease = {};
  for (const releaseId of [...PROMOTED_RELEASE_IDS, CENTRAL_UPPER_MANHATTAN_RELEASE_ID]) {
    const matched = finished.filter((entry) => entry.url.includes(`/data/${releaseId}/`));
    perRelease[releaseId] = { glbCount: matched.filter((entry) => entry.url.endsWith(".glb")).length, encodedBytes: matched.reduce((total, entry) => total + entry.bytes, 0) };
  }
  const external = [...new Set(finished
    .map((entry) => { try { return new URL(entry.url).host; } catch { return ""; } })
    .filter((host) => host !== "" && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")))];
  return { perRelease, externalHosts: external };
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

async function journeyColdDefault(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: CURATED_POSE });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    const waves = await waitFor(
      session,
      (value) => PROMOTED_RELEASE_IDS.every((releaseId) => value.some((wave) => wave.releaseId === releaseId && wave.origin !== null)),
      READ_WAVES,
      "cold-default",
    );
    // Readiness means every wave ACTIVATED, not that every asset arrived: the
    // loader is progressive, and T017 records a journey that asserted the full
    // count the instant the wave went active and read 7 of 71. Wait for the w04
    // fetch count to reach its shipped total or stop growing, so the claim is
    // about what the session streams rather than about when it was sampled.
    let previousCount = -1;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const count = networkPerRelease(session).perRelease[CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID].glbCount;
      if (count === PROMOTED_ASSET_COUNT) break;
      if (count === previousCount && attempt > 6) break;
      previousCount = count;
      await new Promise((done) => { setTimeout(done, 1_000); });
    }
    const network = networkPerRelease(session);
    return {
      journeyId: "cold-default",
      claim: "A clean load with no exterior URL parameter streams all FIVE promoted waves over the real citywide base, and the curated w04 cells render their 40 textured assets. The T019 canary is NOT loaded, because it is not promoted.",
      url,
      waves,
      network,
      passed: network.perRelease[CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID].glbCount === PROMOTED_ASSET_COUNT
        && network.perRelease[CENTRAL_UPPER_MANHATTAN_RELEASE_ID].glbCount === 0
        && PROMOTED_RELEASE_IDS.every((releaseId) => network.perRelease[releaseId].glbCount > 0)
        && network.externalHosts.length === 0,
      still: await still(session, "cold-default"),
    };
  } finally { await closePage(port, session); }
}

async function journeyCrossWavePick(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: CURATED_POSE });
    await session.send("Page.navigate", { url });
    await waitFor(
      session,
      (value) => PROMOTED_RELEASE_IDS.every((releaseId) => value.some((wave) => wave.releaseId === releaseId && wave.origin !== null)),
      READ_WAVES,
      "cross-wave-pick",
    );
    // Select through the app's own search, so the pick travels the path a user's
    // pick travels rather than a path only this script can reach.
    await session.evaluate(`(() => {
      const open = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Open details');
      if (open) open.click();
      const search = document.querySelector('input[type="search"], input[placeholder*="Search"]');
      if (search) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(search, ${JSON.stringify(SKYLINE_BUILDING_ID)});
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
      journeyId: "cross-wave-pick",
      claim: "A picked w04 skyline building — the tallest sourced structure in any cell this wave could have promoted, at a sourced 219.2 m — names the release it came from, its cell and cell release, the checksum of the exact asset on screen, its generated truth tiers, and an uncertainty statement. The composition holds FIVE waves at once, so the pick also proves the details panel attributes to the RIGHT wave.",
      url,
      buildingId: SKYLINE_BUILDING_ID,
      searchResults: results,
      detail,
      passed: Boolean(detail)
        && String(detail.badge ?? "").includes(CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID)
        && String(rows["Cell / release"] ?? "").includes("manhattan-exterior-cell-w04-")
        && /[0-9a-f]{64}/u.test(String(rows["Active asset"] ?? ""))
        && String(rows["Truth tiers"] ?? "").length > 0
        && String(rows["Uncertainty"] ?? "").length > 0,
      still: await still(session, "cross-wave-pick"),
    };
  } finally { await closePage(port, session); }
}

async function journeyCanaryOptIn(port, previewBase, canary) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: canary.pose, params: { exteriorCells: CENTRAL_UPPER_MANHATTAN_RELEASE_ID, exteriorStreaming: "on" } });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    const waves = await waitFor(
      session,
      (value) => value.some((wave) => wave.releaseId === CENTRAL_UPPER_MANHATTAN_RELEASE_ID && wave.origin !== null),
      READ_WAVES,
      "canary-opt-in",
    );
    let previousCanaryCount = -1;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const count = networkPerRelease(session).perRelease[CENTRAL_UPPER_MANHATTAN_RELEASE_ID].glbCount;
      if (count === CANARY_ASSET_COUNT) break;
      if (count === previousCanaryCount && attempt > 6) break;
      previousCanaryCount = count;
      await new Promise((done) => { setTimeout(done, 1_000); });
    }
    const network = networkPerRelease(session);
    return {
      journeyId: "canary-opt-in",
      claim: "The T019 canary's opt-in link still resolves to the canary ALONE, from a camera derived from that canary cell's own committed bounds. Promoting the wave's P1 successor did not withdraw the canary, and `?exteriorCells=` still means exactly the release it names — including excluding the successor that supersedes it.",
      url,
      poseContainment: canary.containment,
      waves,
      network,
      // Every promoted wave fetches NOTHING: `?exteriorCells=` means exactly the
      // release it names, so an opt-in replaces the whole five-wave default set
      // rather than adding to it.
      passed: network.perRelease[CENTRAL_UPPER_MANHATTAN_RELEASE_ID].glbCount === CANARY_ASSET_COUNT
        && PROMOTED_RELEASE_IDS.every((releaseId) => network.perRelease[releaseId].glbCount === 0),
      still: await still(session, "canary-opt-in"),
    };
  } finally { await closePage(port, session); }
}

async function journeyStreamingOff(port, previewBase, promotedDefaultStill) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: CURATED_POSE, params: { exteriorStreaming: "off" } });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    await new Promise((done) => { setTimeout(done, 14_000); });
    const waves = await session.evaluate(READ_WAVES);
    const statements = await session.evaluate(`(() => {
      const open = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Open details');
      if (open) open.click();
      return [...document.querySelectorAll('[data-exterior-unavailable]')].map((node) => (node.textContent || '').trim().slice(0, 400));
    })()`);
    const network = networkPerRelease(session);
    const anyGlb = PROMOTED_RELEASE_IDS.reduce((total, releaseId) => total + network.perRelease[releaseId].glbCount, 0);
    const offStill = await still(session, "streaming-off");
    // THE TEXTURED/UNTEXTURED COMPARISON. Identical pose, exteriors off: if this
    // still equalled the promoted default's, the 40 curated assets would have
    // been fetched and not drawn, and every other reading here would be about
    // downloads rather than about pixels.
    const stillDiffers = offStill.checksumSha256 !== promotedDefaultStill.checksumSha256;
    return {
      journeyId: "streaming-off",
      claim: "`exteriorStreaming=off` disables ALL FIVE promoted waves, not just the newest, no exterior GLB is fetched at all, and the resulting still DIFFERS from the promoted default's at the identical pose — which is what proves the curated w04 assets are drawn rather than merely downloaded.",
      url,
      waves,
      unavailableStatements: statements,
      network,
      texturedComparison: {
        pose: CURATED_POSE,
        promotedDefaultStillChecksumSha256: promotedDefaultStill.checksumSha256,
        exteriorsOffStillChecksumSha256: offStill.checksumSha256,
        stillsDiffer: stillDiffers,
        statement: "Both stills were captured at the same camera pose in the same build, one with the promoted default active and one with exteriors switched off. A difference is the only evidence in this record that the textured facades reached the screen; the network counts prove only that their bytes arrived.",
      },
      passed: anyGlb === 0 && waves.every((wave) => wave.origin === null) && stillDiffers,
      still: offStill,
    };
  } finally { await closePage(port, session); }
}

async function journeyTombstoneTruth(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: CURATED_POSE });
    await session.send("Page.navigate", { url });
    await waitFor(
      session,
      (value) => PROMOTED_RELEASE_IDS.every((releaseId) => value.some((wave) => wave.releaseId === releaseId && wave.origin !== null)),
      READ_WAVES,
      "tombstone-truth",
    );
    await new Promise((done) => { setTimeout(done, 5_000); });
    // Leaf list items only. The notice now leads with an aggregate line that
    // carries the per-release lines inside a collapsed `<details>`, so an
    // unfiltered sweep would read the summary and its children as one blob.
    // The per-release sentences themselves are unchanged and still in the DOM.
    const notices = await session.evaluate(`(() => [...document.querySelectorAll('[data-exterior-notices] li')].filter((node) => node.querySelector('li') === null).map((node) => (node.textContent || '').trim()))()`);
    const waveNotice = notices.find((notice) => notice.includes(CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID)) ?? null;
    return {
      journeyId: "tombstone-truth",
      claim: "The 247 owned w04 cells this release does NOT materialize are reported in words — the release says how many of its cells ship no generated exterior geometry, and what draws for them instead — rather than going quiet.",
      url,
      notices,
      waveNotice,
      passed: typeof waveNotice === "string"
        && waveNotice.includes("247 of 249")
        // T007: asserted on the sentence's FIRST clause, which is a pure release
        // fact and is therefore ARM-INDEPENDENT — true under the default, under
        // `?exteriorStreaming=off` and under the rollback `?exteriorScheduler=off`.
        // The second clause is conditional ("where the citywide base tier is
        // active, …") because the rollback arm withdraws the overview residency,
        // and asserting on it would make this journey pass or fail by session
        // configuration rather than by whether the release told the truth.
        // The pre-T007 predicate read "no substitute was selected", which the
        // reword removed; a predicate left behind would have failed every future
        // live run against a sentence that is more truthful, not less.
        && waveNotice.includes("no generated exterior geometry"),
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

  // WHICH bundle, and WHERE the canary camera stands, before anything is
  // captured. Each fails the run rather than being recorded as a caveat.
  const servedBundle = await servedBundleIdentity(previewBase);
  const canary = await canaryPose();
  console.error(`bundle ${servedBundle.entryScriptPath} ${servedBundle.entryScriptChecksumSha256.slice(0, 16)} · canary pose ${canary.pose.lon.toFixed(6)},${canary.pose.lat.toFixed(6)} inside ${CANARY_CELL_ID}`);

  // Order matters: `streaming-off` compares its still with the one
  // `cold-default` took at the identical pose.
  console.error("journey cold-default ...");
  const coldDefault = await journeyColdDefault(port, previewBase);
  console.error("journey cross-wave-pick ...");
  const crossWavePick = await journeyCrossWavePick(port, previewBase);
  console.error("journey canary-opt-in ...");
  const canaryOptIn = await journeyCanaryOptIn(port, previewBase, canary);
  console.error("journey streaming-off ...");
  const streamingOff = await journeyStreamingOff(port, previewBase, coldDefault.still);
  console.error("journey tombstone-truth ...");
  const tombstoneTruth = await journeyTombstoneTruth(port, previewBase);
  const journeys = [coldDefault, crossWavePick, canaryOptIn, streamingOff, tombstoneTruth];

  const evidence = {
    schemaVersion: "1.0",
    releaseId: CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    note: "T020 renderer journeys against the production preview and the real pinned citywide base, with the served bundle identified before any capture. Each entry records the claim it tests, the URL it used, the DOM text it read, the per-release network measurement, and a checksummed still. `passed` is computed from the readings, not asserted.",
    servedBundle,
    capturedWith: { viewport: VIEWPORT, previewBase, remoteDebuggingPort: port, promotedReleaseIds: PROMOTED_RELEASE_IDS },
    coveredByTestsInstead: [
      "Per-wave ROLLBACK rehearsal: no URL expresses a build-time promotion-record swap, so it is proven through the record's own injection seam in src/runtime/exterior-multiwave-activation.test.ts ('rolls the Central-and-upper-Manhattan wave back to BASE MASSING without withdrawing the other four') — which also checks that the withdrawn successor's link is refused BY NAME while the T019 canary's opt-in and the other four waves' links are untouched.",
      "Single-cell FAULT isolation: the exterior-cell fault injector is gated behind a VITE_BLOCK835_PROBE=1 build, which is not the production preview a user gets, so it is not exercised here and this record does not claim a browser proved it.",
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
