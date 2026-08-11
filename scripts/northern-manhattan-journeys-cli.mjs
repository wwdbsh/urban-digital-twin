/* global console, process, WebSocket, URL, fetch, setTimeout, Buffer, TextDecoder */
/**
 * T021 renderer journeys: the Northern-Manhattan canary exercised in a real
 * browser against the real pinned citywide base, one journey per claim the canary
 * makes.
 *
 * A release graph, a checksum inventory and a drift gate prove what the BUILD
 * accepts. They cannot prove that an opt-in link streams this release and only
 * this release, that a picked building names its own release and the checksum of
 * the asset on screen, that 181 unshipped cells say so in words, or that pinning
 * a canary left the promoted default alone. Those are browser facts, and this
 * captures them as browser facts.
 *
 * The SECOND journey is load-bearing beyond its own claim. This canary's entry
 * budget rests on `?exteriorCells=` SELECTING the named release rather than
 * ADDING it: FIVE promoted waves now occupy 474 of the 512 exterior cache
 * entries, leaving 38 — far less than this canary's 76 shipped assets — so if an
 * opt-in session also held the promoted assets the subset could not be resident
 * at all. `canary-opt-in` measures that directly: the promoted releases must
 * fetch ZERO GLBs while the canary fetches all 76.
 *
 * Journeys, in the order they run:
 *   promoted-default-unchanged  A clean no-param load streams the five promoted
 *                               waves and NOT this canary.
 *   canary-opt-in               The opt-in link streams the canary ALONE.
 *   textured-pick               A picked building in the framed renderable cell
 *                               names its release, cell, cell release, asset
 *                               checksum, truth tiers and uncertainty statement.
 *   tombstone-truth             The 181 owned cells this release does not
 *                               materialize are reported in words.
 *
 * Full acceptance measurement — frame time and heap off the vsync floor, GPU
 * texture accounting, cache residency — is NOT here and is not claimed. That is
 * promotion's instrument, it runs against a promoted composition, and this
 * release is not promoted.
 *
 * Usage:
 *   node scripts/northern-manhattan-journeys-cli.mjs \
 *     --preview http://localhost:4176 --port 9222 [--out <path>]
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { EXTERIOR_WAVE_LEDGER_RELEASE_ID } from "../src/release/exterior-wave-ledger.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import { NORTHERN_MANHATTAN_RELEASE_ID } from "../src/release/northern-manhattan-package.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const capturesRoot = join(repositoryRoot, "artifacts", "northern-manhattan-20260812-journeys");
const recordRoot = join(repositoryRoot, "data", "northern-manhattan-20260812");
const defaultOutPath = join(recordRoot, "journey-evidence.json");
const ledgerRoot = join(repositoryRoot, "data", "normalized", EXTERIOR_WAVE_LEDGER_RELEASE_ID);
const distRoot = join(repositoryRoot, "dist");

const BASE_RELEASE_ID = "manhattan-citywide-20260804";
const BLOCK835_RELEASE_ID = "manhattan-exterior-cells-20260811-v3";
const MIDTOWN_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3";
const LOWER_MANHATTAN_P1_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812-p1";
const SOUTHERN_REMAINDER_P1_RELEASE_ID = "manhattan-southern-remainder-cells-20260812-p1";
const CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812-p1";
/** All FIVE promoted waves, which is now every wave the ledger declares except
 *  this one. A promotion that missed this list would make `canary-opt-in` claim
 *  isolation it had not measured. */
const PROMOTED_RELEASE_IDS = [BLOCK835_RELEASE_ID, MIDTOWN_RELEASE_ID, LOWER_MANHATTAN_P1_RELEASE_ID, SOUTHERN_REMAINDER_P1_RELEASE_ID, CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID];
/** The heaviest promoted wave, used only to know when a clean load has settled. */
const SETTLE_PROMOTED_RELEASE_ID = SOUTHERN_REMAINDER_P1_RELEASE_ID;
const SETTLE_PROMOTED_GLB_COUNT = 179;
const TRACKED_RELEASE_IDS = [...PROMOTED_RELEASE_IDS, NORTHERN_MANHATTAN_RELEASE_ID];

const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 180_000;
const STILL_CHROME_HIDE_CSS = ".exploration-notice, .runtime-note, nav, header, footer { display: none !important; }";
/**
 * Where inside the framed cell the camera stands, and which way it looks.
 *
 * Carried unchanged from the T017 suite, including the two corrections that suite
 * paid for. The pose must be INSIDE the framed cell's committed bounds, which a
 * hand-typed latitude 81 m south of them was not. And it must show FACADES,
 * because facades are what a textured wave ships: a pose at the cell centre 260 m
 * up at pitch -40 produced byte-identical stills of rooftops, in which opting into
 * a textured wave was invisible.
 *
 * So the camera stands in the cell's south-west quadrant — inside the bounds on
 * both axes — low, looking north-east across the cell at a shallow pitch.
 */
const CELL_VIEW = {
  /** Fraction of the cell's span, from the west/south edge. Must be in (0, 1). */
  eastFraction: 0.12,
  northFraction: 0.12,
  heightMeters: 70,
  headingDegrees: 45,
  pitchDegrees: -6,
};

function fail(message) { throw new Error(`northern-manhattan-journeys: ${message}`); }

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

// ---------------------------------------------------------------------------
// What this release IS, read from its own committed records
// ---------------------------------------------------------------------------

/**
 * The subject of every claim below, derived rather than typed.
 *
 * The counts in these journeys' claims — 75 assets, 246 of 249 tombstoned, which
 * cells are renderable — are facts about what the release shipped, and they are
 * read out of its committed payload inventory. Typing them beside the release
 * lets a claim keep asserting a number the release stopped shipping.
 *
 * THIS WAVE'S CANARY RENDERS ONE CELL, and the selection rule is kept anyway. It
 * is derived from committed bytes — the renderable cell that owns the MOST
 * buildings, ties broken by cell id — and over a one-cell subset it trivially
 * selects that cell. Keeping the rule rather than reading `renderableCellIds[0]`
 * means the suite states WHY the camera stands where it does, and keeps saying so
 * if a rebuild ever admits a second cell. `renderableCells` below records the
 * whole set, so the record shows the camera stands in one of one.
 */
async function readSubject() {
  const inventory = JSON.parse(await readFile(join(recordRoot, "payload-inventory.json"), "utf8"));
  if (inventory.releaseId !== NORTHERN_MANHATTAN_RELEASE_ID) {
    fail(`the committed inventory describes ${inventory.releaseId}, not ${NORTHERN_MANHATTAN_RELEASE_ID}.`);
  }
  if (inventory.renderableCellIds.length === 0) fail("the committed inventory declares no renderable cell.");
  const digest = JSON.parse(await readFile(join(ledgerRoot, "membership-digest.json"), "utf8"));
  const renderable = inventory.renderableCellIds.map((cellId) => {
    const cell = digest.cells.find((entry) => entry.cellId === cellId);
    if (!cell) fail(`the committed membership digest declares no cell ${cellId}.`);
    return { cellId, buildingCount: cell.buildingCount, bounds: cell.bounds };
  });
  const framed = [...renderable].sort((left, right) =>
    right.buildingCount - left.buildingCount || (left.cellId < right.cellId ? -1 : 1))[0];
  return {
    framedCellId: framed.cellId,
    framedCellBuildingCount: framed.buildingCount,
    framedCellBounds: framed.bounds,
    framedCellSelectionRule: "the renderable cell owning the most buildings, ties broken by cell id, read from the committed membership digest",
    renderableCells: renderable.map((cell) => ({ cellId: cell.cellId, buildingCount: cell.buildingCount })),
    assetCount: inventory.census.materializedBuildingCount,
    ownedCellCount: inventory.stats.cellCount,
    tombstonedCellCount: inventory.stats.notShippedCellCount,
  };
}

/**
 * A building inside the framed cell, chosen as the heaviest asset the release
 * shipped there — a pick anyone can repeat from committed bytes alone.
 *
 * Derived rather than typed for the same reason the counts are: a hand-picked id
 * keeps naming a building after the subset that contained it has moved.
 */
async function readPickBuildingId(framedCellId) {
  const inventory = JSON.parse(await readFile(join(recordRoot, "payload-inventory.json"), "utf8"));
  const ledger = JSON.parse(await readFile(join(ledgerRoot, "ledger.json"), "utf8"));
  const cell = ledger.cells.find((entry) => entry.cellId === framedCellId);
  if (!cell) fail(`the committed wave ledger declares no cell ${framedCellId}.`);
  const owned = new Set(cell.buildingIds);
  let best = null;
  for (const file of inventory.files) {
    const match = /^public\/assets\/(.+)__lod_0\.glb$/u.exec(file.path);
    if (!match) continue;
    const buildingId = match[1].replace("-", ":");
    if (!owned.has(buildingId)) continue;
    if (!best || file.byteSize > best.byteSize || (file.byteSize === best.byteSize && buildingId < best.buildingId)) {
      best = { buildingId, byteSize: file.byteSize };
    }
  }
  if (!best) fail(`the committed inventory declares no shipped LOD 0 asset inside ${framedCellId}.`);
  return best;
}

/**
 * A camera standing INSIDE the framed cell, derived from that cell's own bounds.
 *
 * This exists because the first version of the T017 suite typed a pose by hand
 * and got it wrong: the latitude was about 81 m south of the cell's committed
 * south bound, so the journey claiming "the camera standing inside its renderable
 * cell" was captured from outside it. Review caught it. A derived pose plus the
 * assertion below is what stops a hand-typed number from contradicting a
 * committed claim again.
 */
function poseInsideCell(bounds) {
  return {
    lon: bounds.west + CELL_VIEW.eastFraction * (bounds.east - bounds.west),
    lat: bounds.south + CELL_VIEW.northFraction * (bounds.north - bounds.south),
    height: CELL_VIEW.heightMeters,
    heading: CELL_VIEW.headingDegrees,
    pitch: CELL_VIEW.pitchDegrees,
    roll: 0,
  };
}

/** Fails the run before a single capture if the pose is not inside the cell. */
function assertPoseInsideCell(pose, bounds, cellId) {
  const inside = pose.lon >= bounds.west && pose.lon <= bounds.east
    && pose.lat >= bounds.south && pose.lat <= bounds.north;
  if (!inside) {
    fail(`the camera pose (${pose.lon}, ${pose.lat}) is outside cell ${cellId}, whose committed bounds are west ${bounds.west}, south ${bounds.south}, east ${bounds.east}, north ${bounds.north}. No journey may claim the camera stands inside a cell it stands outside.`);
  }
  return {
    cellId,
    cellBounds: { ...bounds },
    containment: "asserted before capture: the pose lies within the cell's committed ledger bounds on both axes",
  };
}

// ---------------------------------------------------------------------------
// Which bundle was actually measured
// ---------------------------------------------------------------------------

/**
 * Identifies the bundle the preview server is SERVING, and refuses to proceed if
 * it is not this build.
 *
 * This exists because of a real incident during T017: the first run of that suite
 * reached a `vite preview` left listening by another worktree, serving a bundle in
 * which the release under test was not pinned. Its `promoted-default-unchanged`
 * journey passed against it — correctly, and meaninglessly, because a release that
 * is not pinned obviously fetches nothing.
 *
 * So the identity is MEASURED and RECORDED, and three things fail the run rather
 * than being noted:
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
  if (!new TextDecoder().decode(entryBytes).includes(NORTHERN_MANHATTAN_RELEASE_ID)) {
    fail(`the served entry script ${entryPath} does not name ${NORTHERN_MANHATTAN_RELEASE_ID}, so it predates the pin and every opt-in journey would fail closed for the wrong reason.`);
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
 * progressive, and sampling the instant a wave goes active reads a partial count.
 * Settling on "reached the total, or stopped growing" makes the claim about what
 * the session streams rather than about when it was sampled.
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

async function journeyPromotedDefaultUnchanged(port, previewBase, subject, pose) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    const waves = await waitFor(
      session,
      (value) => PROMOTED_RELEASE_IDS.every((releaseId) => value.some((wave) => wave.releaseId === releaseId && wave.origin !== null)),
      READ_WAVES,
      "promoted-default-unchanged",
    );
    await settleGlbCount(session, SETTLE_PROMOTED_RELEASE_ID, SETTLE_PROMOTED_GLB_COUNT);
    const network = networkPerRelease(session);
    return {
      journeyId: "promoted-default-unchanged",
      claim: "Pinning this canary changed nothing about what an ordinary session loads. A clean load with no exterior URL parameter still streams all FIVE promoted waves and fetches ZERO bytes of the Northern-Manhattan release, even with the camera standing inside its framed renderable cell — a pose derived from that cell's committed ledger bounds and asserted to lie within them before any capture. Five is every wave the committed ledger declares except this one, so this journey is also the first to measure that a session loading the whole promoted city still loads none of the last wave.",
      url,
      waves,
      network,
      passed: PROMOTED_RELEASE_IDS.every((releaseId) => network.perRelease[releaseId].glbCount > 0)
        && network.perRelease[NORTHERN_MANHATTAN_RELEASE_ID].glbCount === 0
        && network.perRelease[NORTHERN_MANHATTAN_RELEASE_ID].encodedBytes === 0
        && network.externalHosts.length === 0,
      still: await still(session, "promoted-default-unchanged"),
    };
  } finally { await closePage(port, session); }
}

async function journeyCanaryOptIn(port, previewBase, subject, pose, promotedDefaultStill) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose, params: { exteriorCells: NORTHERN_MANHATTAN_RELEASE_ID, exteriorStreaming: "on" } });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    const waves = await waitFor(
      session,
      (value) => value.some((wave) => wave.releaseId === NORTHERN_MANHATTAN_RELEASE_ID && wave.origin !== null),
      READ_WAVES,
      "canary-opt-in",
    );
    await settleGlbCount(session, NORTHERN_MANHATTAN_RELEASE_ID, subject.assetCount);
    const network = networkPerRelease(session);
    const capture = await still(session, "canary-opt-in");
    // The network count proves the assets were FETCHED. It cannot prove they were
    // DRAWN — and during T017 a top-down pose produced a still byte-identical to
    // the promoted default, in which opting into a whole textured wave changed
    // nothing visible. So the picture from this pose must differ from the picture
    // the promoted default produced at the SAME pose, and that difference is part
    // of passing rather than a note beside it.
    const stillDiffersFromPromotedDefault = capture.checksumSha256 !== promotedDefaultStill.checksumSha256;
    return {
      journeyId: "canary-opt-in",
      claim: "`?exteriorCells=` SELECTS the named release rather than adding it: the opt-in link streams all of the Northern-Manhattan canary's textured assets and ZERO GLBs of any of the FIVE promoted waves. This is the measurement the canary's entry budget rests on, and for this wave it is the measurement that makes the budget POSSIBLE rather than merely convenient: the promoted waves occupy 474 of 512 cache entries, leaving 38, and this subset ships 76 assets. A session that held both could not be resident. The still must also DIFFER from the promoted default's still at the identical pose, so the assets are shown to be drawn rather than merely fetched.",
      url,
      waves,
      network,
      expectedCanaryGlbCount: subject.assetCount,
      promotedDefaultStillChecksumSha256: promotedDefaultStill.checksumSha256,
      stillDiffersFromPromotedDefault,
      passed: network.perRelease[NORTHERN_MANHATTAN_RELEASE_ID].glbCount === subject.assetCount
        && PROMOTED_RELEASE_IDS.every((releaseId) => network.perRelease[releaseId].glbCount === 0)
        && network.externalHosts.length === 0
        && stillDiffersFromPromotedDefault,
      still: capture,
    };
  } finally { await closePage(port, session); }
}

async function journeyTexturedPick(port, previewBase, subject, pose, pick) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose, params: { exteriorCells: NORTHERN_MANHATTAN_RELEASE_ID, exteriorStreaming: "on" } });
    await session.send("Page.navigate", { url });
    await waitFor(
      session,
      (value) => value.some((wave) => wave.releaseId === NORTHERN_MANHATTAN_RELEASE_ID && wave.origin !== null),
      READ_WAVES,
      "textured-pick",
    );
    await settleGlbCount(session, NORTHERN_MANHATTAN_RELEASE_ID, subject.assetCount);
    // Select through the app's own search, so the pick travels the path a user's
    // pick travels rather than a test-only seam.
    await session.evaluate(`(() => {
      const open = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Open details');
      if (open) open.click();
      const search = document.querySelector('input[type="search"], input[placeholder*="Search"]');
      if (search) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(search, ${JSON.stringify(pick.buildingId)});
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
      claim: "A picked building inside the framed renderable cell names the release it came from, its cell and cell release, the checksum of the exact asset on screen, its generated truth tiers, and an uncertainty statement.",
      url,
      pickedBuildingId: pick.buildingId,
      pickedAssetByteSize: pick.byteSize,
      pickSelectionRule: "the heaviest LOD 0 asset the committed inventory declares inside the framed cell",
      searchResults: results,
      detail,
      passed: Boolean(detail)
        && String(detail.badge ?? "").includes(NORTHERN_MANHATTAN_RELEASE_ID)
        && String(rows["Cell / release"] ?? "").includes(subject.framedCellId)
        && /[0-9a-f]{64}/u.test(String(rows["Active asset"] ?? ""))
        && String(rows["Truth tiers"] ?? "").length > 0
        && String(rows["Uncertainty"] ?? "").length > 0,
      still: await still(session, "textured-pick"),
    };
  } finally { await closePage(port, session); }
}

async function journeyTombstoneTruth(port, previewBase, subject, pose, canaryOptInStill) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose, params: { exteriorCells: NORTHERN_MANHATTAN_RELEASE_ID, exteriorStreaming: "on" } });
    await session.send("Page.navigate", { url });
    await waitFor(
      session,
      (value) => value.some((wave) => wave.releaseId === NORTHERN_MANHATTAN_RELEASE_ID && wave.origin !== null),
      READ_WAVES,
      "tombstone-truth",
    );
    await new Promise((done) => { setTimeout(done, 4_000); });
    const notices = await session.evaluate(`(() => [...document.querySelectorAll('[data-exterior-notices] li')].map((node) => (node.textContent || '').trim()))()`);
    const waveNotice = notices.find((notice) => notice.includes(NORTHERN_MANHATTAN_RELEASE_ID)) ?? null;
    const capture = await still(session, "tombstone-truth");
    return {
      journeyId: "tombstone-truth",
      claim: `The ${subject.tombstonedCellCount} owned w05 cells this release does NOT materialize are reported in words — the release says how many of its ${subject.ownedCellCount} cells ship no exterior geometry and that no substitute was selected — rather than going quiet.`,
      url,
      notices,
      waveNotice,
      // OBSERVED, NOT REQUIRED. This journey loads the identical URL at the
      // identical pose as `canary-opt-in` in a separate browser page, so its still
      // is expected to be byte-identical — and it is. That is renderer determinism
      // across sessions, recorded because a reader who noticed two equal checksums
      // in one evidence file would otherwise reasonably suspect one capture was
      // reused. It is deliberately NOT part of `passed`: progressive streaming
      // could legitimately settle differently, and this journey is about the
      // tombstone sentence, not about pixels.
      stillMatchesCanaryOptIn: capture.checksumSha256 === canaryOptInStill.checksumSha256,
      canaryOptInStillChecksumSha256: canaryOptInStill.checksumSha256,
      stillEqualityStatement: "Observed, not asserted. This journey and `canary-opt-in` load the same URL at the same pose in separate pages; equal still checksums are renderer determinism across sessions, and unequal ones would be progressive streaming settling differently. Neither outcome affects whether this journey passed, which turns on the tombstone sentence alone.",
      passed: typeof waveNotice === "string"
        && waveNotice.includes(`${subject.tombstonedCellCount} of ${subject.ownedCellCount}`)
        && waveNotice.includes("no substitute was selected"),
      still: capture,
    };
  } finally { await closePage(port, session); }
}

// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const previewBase = argValue(argv, "--preview", "http://localhost:4176").replace(/\/$/u, "");
  const port = Number(argValue(argv, "--port", "9222"));
  const outPath = resolve(argValue(argv, "--out", defaultOutPath));

  // Everything the claims are about, before anything is measured: WHICH bundle is
  // being served, WHAT this release shipped, WHICH renderable cell is framed, and
  // WHERE the camera stands. Each of them fails the run rather than being recorded
  // as a caveat.
  const servedBundle = await servedBundleIdentity(previewBase);
  const subject = await readSubject();
  const pick = await readPickBuildingId(subject.framedCellId);
  const pose = poseInsideCell(subject.framedCellBounds);
  const poseContainment = assertPoseInsideCell(pose, subject.framedCellBounds, subject.framedCellId);
  console.error(`bundle ${servedBundle.entryScriptPath} ${servedBundle.entryScriptChecksumSha256.slice(0, 16)} · pose ${pose.lon.toFixed(6)},${pose.lat.toFixed(6)} inside ${subject.framedCellId} · pick ${pick.buildingId}`);

  // Order matters for the first two: `canary-opt-in` compares its own still with
  // the one `promoted-default-unchanged` took at the identical pose.
  console.error("journey promoted-default-unchanged ...");
  const promotedDefault = await journeyPromotedDefaultUnchanged(port, previewBase, subject, pose);
  console.error("journey canary-opt-in ...");
  const canaryOptIn = await journeyCanaryOptIn(port, previewBase, subject, pose, promotedDefault.still);
  console.error("journey textured-pick ...");
  const texturedPick = await journeyTexturedPick(port, previewBase, subject, pose, pick);
  console.error("journey tombstone-truth ...");
  const tombstoneTruth = await journeyTombstoneTruth(port, previewBase, subject, pose, canaryOptIn.still);
  const journeys = [promotedDefault, canaryOptIn, texturedPick, tombstoneTruth];

  const evidence = {
    schemaVersion: "1.0",
    releaseId: NORTHERN_MANHATTAN_RELEASE_ID,
    note: "T021 renderer journeys against the production preview and the real pinned citywide base. Each entry records the claim it tests, the URL it used, the DOM text it read, the per-release network measurement, and a checksummed still. `passed` is computed from the readings, not asserted.",
    capturedWith: {
      viewport: VIEWPORT,
      previewBase,
      remoteDebuggingPort: port,
      servedBundle,
      subject,
      pick,
      pose,
      poseContainment,
    },
    notMeasuredHere: [
      "Frame time, heap, GPU texture accounting and cache residency. Those are PROMOTION's instrument: they measure a promoted composition under the default activation, and this release is not promoted. The tile system's own cost was measured by T015's kill switch, re-measured off the vsync floor by T016, re-measured over a four-wave composition at the raised cache cap by T018, and re-measured over a FIVE-wave composition by T020; this wave changes which buildings carry those tiles, not the tiles. A SIX-wave measurement does not exist and is not implied by any reading here — it is T022's to take.",
      "The 181 owned cells this release does not materialize, beyond the fact that it says so. No still is taken from inside a tombstoned cell and none is claimed.",
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
