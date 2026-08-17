/* global console, process, fetch, WebSocket, URL, setTimeout, clearTimeout, Buffer */
/**
 * THE T006 JOURNEY SUITE: acceptance criterion #8, on the six-wave default.
 *
 * ## Why this file is NEW rather than one more run of an existing journey CLI
 *
 * Seven curated journey CLIs already exist, and each one wrote a
 * `journey-evidence.json` describing the composition it was captured for — one
 * wave, or a `-p1` curated cut, at the caps that build shipped. Those records
 * are FROZEN: their value is precisely that they describe arrangements that no
 * longer exist, and re-running one to get a six-wave reading would overwrite a
 * document that could not be reproduced. So this file is new, it writes to the
 * campaign's own dated root, and it touches none of them. The drift test asserts
 * their checksums are unchanged.
 *
 * ## What a journey here is, and what it is not
 *
 * Each journey drives the SHIPPED UI through a user-visible path and records
 * what the app said, plus a rendered still. That is what-is-drawn and
 * what-is-stated evidence. It is NOT visual acceptance: a still proves pixels
 * were produced at a pose, not that they are a good likeness of Manhattan, and
 * this file claims only the former.
 *
 * ## The one journey that takes no measurement
 *
 * J6 CROSS-REFERENCES the eviction capture rather than repeating it. Selection
 * identity across an eviction cycle is measured once, by the E-1 loop, and
 * reported once. This file reads that record's digest pair and its verdict and
 * carries them by reference; if the record is missing, J6 says so instead of
 * running a second, differently-shaped loop and calling it the same thing.
 *
 * T008 CHROME DISCIPLINE: a DEDICATED Chrome on its own debugging port with its
 * own scratch profile, launched by this file and killed by it, with the
 * surviving-process count READ rather than assumed.
 *
 * Usage:
 *   node scripts/exterior-serving-journeys-cli.mjs \
 *     --base=http://127.0.0.1:4173/ --out=exterior-acceptance-20260817 --attempt=1
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  BLOCK_835_CAMERA,
  BLOCK_835_V3_RELEASE_ID,
  CAMPAIGN_DISCIPLINE,
  CAMPAIGN_EVIDENCE_ID,
  JOURNEY_GATES,
  STATIONS,
  VISUAL_GATES,
} from "./exterior-acceptance-campaign-constants.mjs";

const run = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let evidenceRoot = join(repositoryRoot, "data", CAMPAIGN_EVIDENCE_ID);

const PORT = 9225;
const USER_DATA_DIR = "/tmp/t006-journeys-chrome";
const BASE_CHROME_FLAGS = [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${USER_DATA_DIR}`,
  "--no-first-run",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];
const CHROME_LAUNCH_COMMAND = `open -na "Google Chrome" --args ${BASE_CHROME_FLAGS.join(" ")}`;
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 300_000;
const EVALUATE_TIMEOUT_MS = 120_000;
/** Enough for a wave to boot, schedule and draw; journeys take no percentile. */
const SETTLE_MS = 20_000;

/** The journey pose: the midtown street station, where the served city is. */
const JOURNEY_POSE = STATIONS.find((station) => station.stationId === "street-260m-midtown");
/** The wave whose committed inventory names the building every journey selects. */
const JOURNEY_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3-s1";
const PROMOTED_WAVE_COUNT = 6;
const BOOT_DOCUMENTS_PER_WAVE = 3;

function fail(message) { throw new Error(`exterior-serving-journeys: ${message}`); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function wait(ms) { return new Promise((done) => { setTimeout(done, ms); }); }
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

  /** A page exception is a FAILURE, never a null: every reading is load-bearing. */
  async evaluate(expression, what = "page evaluation") {
    const result = await withTimeout(this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), EVALUATE_TIMEOUT_MS, what);
    if (result.exceptionDetails) fail(`${what} threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result.value;
  }

  responses() { return this.events.filter((event) => event.method === "Network.responseReceived").map((event) => event.params.response); }

  async screenshot(what = "still") {
    const shot = await withTimeout(this.send("Page.captureScreenshot", { format: "png" }), EVALUATE_TIMEOUT_MS, what);
    return Buffer.from(shot.data, "base64");
  }

  close() { try { this.socket.close(); } catch { /* already gone */ } }
}

async function attach(initialUrl) {
  const listResponse = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(initialUrl)}`, { method: "PUT" }).catch(() => null);
  if (!listResponse?.ok) fail(`could not open a tab on debugging port ${PORT}; the scratch Chrome did not come up. Launch line: ${CHROME_LAUNCH_COMMAND}`);
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

/**
 * Kills ONLY the scratch instance, matched on its own profile directory NAME.
 *
 * The name rather than the whole `--user-data-dir=` flag, because `pkill` parses
 * a pattern that begins with `--` as an option and the call silently fails. The
 * result is READ rather than assumed: this returns how many processes remain, so
 * "cleaned up" is a number in the record and not a hope.
 */
async function killChrome() {
  await run("/usr/bin/pkill", ["-f", USER_DATA_DIR.replace("/tmp/", "")]).catch(() => null);
  await wait(1_500);
  const remaining = await run("/usr/bin/pgrep", ["-f", USER_DATA_DIR.replace("/tmp/", "")]).then(
    ({ stdout }) => stdout.split("\n").filter((line) => line.trim().length > 0).length,
    () => 0,
  );
  if (remaining > 0) console.error(`exterior-serving-journeys: WARNING — ${remaining} scratch Chrome processes survived cleanup.`);
  return remaining;
}

// ---------------------------------------------------------------------------
// page reads
// ---------------------------------------------------------------------------

const READ_SCHEDULER_PROBE = `(() => {
  const node = document.querySelector("[data-exterior-scheduler-probe]");
  if (!node) return null;
  const probe = JSON.parse(node.textContent);
  return {
    exteriorStreamingActive: probe.exteriorStreamingActive,
    decision: probe.decision,
    traceLength: probe.traceLength,
    waves: (probe.waves || []).map((wave) => ({ releaseId: wave.releaseId, declaredCellCount: wave.declaredCellCount, metrics: wave.metrics })),
  };
})()`;

/**
 * The details panel, read through the selector the pre-registration fixed.
 *
 * `aside.inspector[aria-label="Selected feature details"]`, NOT
 * `[role="complementary"]`: an `<aside>` carries the complementary role
 * implicitly and has no `role` attribute, so the old attribute selector matched
 * nothing and reported `null` for a panel that was on screen the whole time.
 */
const READ_PANEL = `(() => {
  const panel = document.querySelector('aside.inspector[aria-label="Selected feature details"]');
  if (!panel) return { present: false, digest: null, length: 0, rows: {}, sectionLabels: [] };
  const text = (panel.textContent || "").replace(/\\s+/gu, " ").trim();
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  const rows = {};
  for (const term of panel.querySelectorAll("dt")) {
    const label = (term.textContent || "").trim();
    const value = term.nextElementSibling ? (term.nextElementSibling.textContent || "").replace(/\\s+/gu, " ").trim() : null;
    if (label && !(label in rows)) rows[label] = value;
  }
  return {
    present: true,
    digest: (hash >>> 0).toString(16),
    length: text.length,
    head: text.slice(0, 200),
    rows,
    sectionLabels: [...panel.querySelectorAll("section[aria-label]")].map((node) => node.getAttribute("aria-label")),
    exteriorUnavailableStatements: [...panel.querySelectorAll("[data-exterior-unavailable] .section-label")].map((node) => (node.textContent || "").replace(/\\s+/gu, " ").trim()),
    href: window.location.href,
  };
})()`;

const READ_NOTICES = `(() => {
  const root = document.querySelector("[data-exterior-notices]");
  if (!root) return { present: false, items: [] };
  return { present: true, items: [...root.querySelectorAll("li")].map((node) => (node.textContent || "").replace(/\\s+/gu, " ").trim()).filter((text) => text.length > 0) };
})()`;

function poseUrl(base, pose, options = {}) {
  const url = new URL(base);
  url.searchParams.set("data", "real-pilot");
  url.searchParams.set("release", "manhattan-citywide-20260804");
  url.searchParams.set("view", "free");
  if (options.releaseId) url.searchParams.set("exteriorCells", options.releaseId);
  if (options.featureId) url.searchParams.set("feature", options.featureId);
  if (options.profile) url.searchParams.set("exteriorProfile", options.profile);
  if (options.streaming === false) url.searchParams.set("exteriorStreaming", "off");
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

/** The three whole documents `loadExteriorCellRuntime` fetches per release. */
function bootDocumentCounts(session) {
  const byRelease = new Map();
  for (const response of session.responses()) {
    const match = /\/data\/([^/]+)\/(index\.json|release-graph\.json|assemblies\.json)(?:\?|$)/u.exec(response.url);
    if (!match) continue;
    const entry = byRelease.get(match[1]) ?? new Set();
    entry.add(match[2]);
    byRelease.set(match[1], entry);
  }
  return [...byRelease.entries()]
    .map(([releaseId, documents]) => ({ releaseId, documentCount: documents.size, documents: [...documents].sort() }))
    .sort((left, right) => (left.releaseId < right.releaseId ? -1 : left.releaseId > right.releaseId ? 1 : 0));
}

function externalHosts(session, base) {
  const origin = new URL(base).host;
  return [...new Set(session.responses().map((response) => {
    try { return new URL(response.url).host; } catch { return ""; }
  }).filter((host) => host && host !== origin))].sort();
}

async function writeCapture(name, bytes) {
  await mkdir(join(evidenceRoot, "captures"), { recursive: true });
  await writeFile(join(evidenceRoot, "captures", `${name}.png`), bytes);
  return { file: `captures/${name}.png`, byteSize: bytes.byteLength, sha256: sha256HexBytes(new Uint8Array(bytes)) };
}

/**
 * A served building of the journey wave, from its COMMITTED inventory.
 *
 * Read rather than typed, so a re-cut wave cannot leave this suite selecting a
 * building that is no longer served — which would turn a real regression into a
 * journey that quietly searched for nothing.
 */
async function servedFeatureId(releaseId) {
  const inventory = JSON.parse(await readFile(join(repositoryRoot, "data", releaseId, "payload-inventory.json"), "utf8"));
  const glb = inventory.files.find((file) => file.path.startsWith("public/assets/") && file.path.endsWith("__lod_0.glb"));
  if (!glb) fail(`the committed inventory for ${releaseId} declares no shipped lod_0 asset.`);
  return glb.path.slice("public/assets/".length, -"__lod_0.glb".length).replace("-", ":");
}

// ---------------------------------------------------------------------------
// the journeys
// ---------------------------------------------------------------------------

async function inTab(base, url, body) {
  const { session, targetId } = await attach(url);
  try {
    return await body(session);
  } finally {
    session.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => null);
    void base;
  }
}

/** J1 — a cold default session activates all six promoted serving waves. */
async function journeyColdDefault(base) {
  const url = poseUrl(base, JOURNEY_POSE);
  return inTab(base, url, async (session) => {
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "J1 default activation");
    await wait(SETTLE_MS);
    const probe = await session.evaluate(READ_SCHEDULER_PROBE, "J1 probe");
    const notices = await session.evaluate(READ_NOTICES, "J1 notices");
    const boot = bootDocumentCounts(session).filter((entry) => entry.releaseId.endsWith("-s1"));
    const still = await writeCapture("journey-j1-cold-default", await session.screenshot("J1 still"));
    const waveIds = probe.waves.map((wave) => wave.releaseId).sort();
    const bootComplete = boot.length === PROMOTED_WAVE_COUNT && boot.every((entry) => entry.documentCount === BOOT_DOCUMENTS_PER_WAVE);
    return {
      journeyId: JOURNEY_GATES.J1.journeyId,
      claim: JOURNEY_GATES.J1.claim,
      url,
      activeWaveIds: waveIds,
      activeWaveCount: waveIds.length,
      declaredCellTotal: probe.waves.reduce((total, wave) => total + (wave.declaredCellCount ?? 0), 0),
      bootReleases: boot,
      bootDocumentTotal: boot.reduce((total, entry) => total + entry.documentCount, 0),
      bootDocumentsComplete: bootComplete,
      notices,
      externalHosts: externalHosts(session, base),
      still,
      pass: waveIds.length === PROMOTED_WAVE_COUNT && bootComplete && externalHosts(session, base).length === 0,
      passRule: "Six promoted serving waves active, each having fetched its three boot documents, with no exterior parameter in the URL and no external host contacted.",
    };
  });
}

/**
 * J2 — search resolves a served building, selection opens the details panel.
 *
 * The query is typed through `Input.insertText` against the focused combobox
 * rather than by setting `value` from script: React does not observe a
 * programmatic value assignment, so a script-set field would leave the app's
 * state untouched and the journey would be testing nothing. The result is
 * activated with a real `click()`, which React's synthetic handler does see.
 */
async function journeySearchSelect(base, featureId) {
  const url = poseUrl(base, JOURNEY_POSE);
  return inTab(base, url, async (session) => {
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "J2 default activation");
    await wait(SETTLE_MS);
    await session.evaluate('document.querySelector(\'input[aria-label="Search Manhattan"]\').focus()', "J2 focus search");
    await session.send("Input.insertText", { text: featureId });
    await wait(1_500);
    const results = await session.evaluate('(() => [...document.querySelectorAll(\'#unified-search-results [role="option"]\')].map((node) => (node.textContent || "").replace(/\\s+/gu, " ").trim()))()', "J2 search results");
    let selected = false;
    if (results.length > 0) {
      await session.evaluate('(() => { document.querySelector(\'#unified-search-results [role="option"]\').click(); return true; })()', "J2 activate first result");
      await wait(5_000);
      selected = true;
    }
    const panel = await session.evaluate(READ_PANEL, "J2 panel");
    const still = await writeCapture("journey-j2-search-select", await session.screenshot("J2 still"));
    const required = ["Cell / release", "Active asset", "Truth tiers", "Uncertainty"];
    const presentRows = required.filter((label) => typeof panel.rows?.[label] === "string" && panel.rows[label].length > 0);
    return {
      journeyId: JOURNEY_GATES.J2.journeyId,
      claim: JOURNEY_GATES.J2.claim,
      url,
      query: featureId,
      searchResultCount: results.length,
      searchResults: results.slice(0, 8),
      resultActivated: selected,
      panel,
      requiredRows: required,
      presentRows,
      missingRows: required.filter((label) => !presentRows.includes(label)),
      still,
      pass: results.length > 0 && selected && panel.present && presentRows.length === required.length,
      passRule: "The typed query returns at least one result, activating it opens the details panel, and the panel carries the cell/release, active asset, truth tiers and uncertainty rows with non-empty values.",
    };
  });
}

/** J3 — the Block 835 -v3 opt-in still resolves through `?exteriorCells=`. */
async function journeyBlock835OptIn(base) {
  const pose = { ...BLOCK_835_CAMERA, height: 900 };
  const url = poseUrl(base, pose, { releaseId: BLOCK_835_V3_RELEASE_ID, profile: "inspection" });
  return inTab(base, url, async (session) => {
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "J3 opt-in activation");
    await wait(SETTLE_MS);
    const probe = await session.evaluate(READ_SCHEDULER_PROBE, "J3 probe");
    const notices = await session.evaluate(READ_NOTICES, "J3 notices");
    const still = await writeCapture("journey-j3-block835-opt-in", await session.screenshot("J3 still"));
    const waveIds = probe.waves.map((wave) => wave.releaseId).sort();
    return {
      journeyId: JOURNEY_GATES.J3.journeyId,
      claim: JOURNEY_GATES.J3.claim,
      url,
      activeWaveIds: waveIds,
      resolvedOptIn: waveIds.includes(BLOCK_835_V3_RELEASE_ID),
      declaredCellTotal: probe.waves.reduce((total, wave) => total + (wave.declaredCellCount ?? 0), 0),
      residentCount: probe.decision?.residentCount ?? null,
      notices,
      still,
      pass: waveIds.includes(BLOCK_835_V3_RELEASE_ID) && (probe.decision?.residentCount ?? 0) > 0,
      passRule: "The opt-in release is the active exterior wave and the scheduler holds at least one resident cell for it.",
      claimCorrection: "THE CLAIM'S PHRASING IS CORRECTED BY THE CODE, and the correction is recorded rather than argued away. `resolveExteriorActivationSet` (src/runtime/exterior-default-activation.ts) takes the `?exteriorCells=` branch and returns EXACTLY ONE target, so an explicit opt-in REPLACES the promoted six-wave set; it does not render beside it. What this journey establishes is that the opt-in still resolves, activates and renders over the citywide base — not that two exterior sets are co-resident. That would be a different arrangement and no capture here produces it.",
    };
  });
}

/** J4 — a `?feature=` deep link resolves the same building, and round-trips. */
async function journeyDeepLinkIdentity(base, featureId, interactivePanel) {
  const url = poseUrl(base, JOURNEY_POSE, { featureId });
  return inTab(base, url, async (session) => {
    await waitFor(session, READ_SCHEDULER_PROBE, (probe) => probe.exteriorStreamingActive, "J4 default activation");
    await wait(SETTLE_MS);
    const panel = await session.evaluate(READ_PANEL, "J4 panel");
    const still = await writeCapture("journey-j4-deep-link", await session.screenshot("J4 still"));
    const roundTripped = typeof panel.href === "string" && new URL(panel.href).searchParams.get("feature") === featureId;
    const digestsMatch = panel.digest != null && interactivePanel?.digest != null && panel.digest === interactivePanel.digest;
    return {
      journeyId: JOURNEY_GATES.J4.journeyId,
      claim: JOURNEY_GATES.J4.claim,
      url,
      featureId,
      panel,
      href: panel.href,
      urlRoundTripped: roundTripped,
      interactiveDigest: interactivePanel?.digest ?? null,
      deepLinkDigest: panel.digest ?? null,
      digestsMatch,
      bothNonNull: panel.digest != null && interactivePanel?.digest != null,
      still,
      pass: panel.present && roundTripped && digestsMatch,
      passRule: "The deep-linked panel is present, the URL still carries the feature parameter after the app has rewritten it, and the panel digest EQUALS the digest of the same building selected interactively in J2 — both non-null.",
      digestNote: "The digest is a hash of the whole panel's rendered text. Equality therefore says the deep link and the interactive selection produced the same sourced information, not merely the same identifier.",
    };
  });
}

/** J5 — with exterior streaming off, the app states what is unavailable. */
async function journeyStreamingOffHonesty(base, featureId, defaultStill) {
  const url = poseUrl(base, JOURNEY_POSE, { featureId, streaming: false });
  return inTab(base, url, async (session) => {
    await waitFor(session, READ_PANEL, (panel) => panel.present, "J5 details panel");
    await wait(SETTLE_MS);
    const probe = await session.evaluate(READ_SCHEDULER_PROBE, "J5 probe");
    const panel = await session.evaluate(READ_PANEL, "J5 panel");
    const notices = await session.evaluate(READ_NOTICES, "J5 notices");
    const still = await writeCapture("journey-j5-streaming-off", await session.screenshot("J5 still"));
    const statements = panel.exteriorUnavailableStatements ?? [];
    const differsFromDefault = defaultStill?.sha256 != null && still.sha256 !== defaultStill.sha256;
    return {
      journeyId: JOURNEY_GATES.J5.journeyId,
      claim: JOURNEY_GATES.J5.claim,
      url,
      exteriorStreamingActive: probe?.exteriorStreamingActive ?? null,
      unavailableStatements: statements,
      panel,
      notices,
      still,
      comparedStill: defaultStill ?? null,
      stillDiffersFromDefaultArm: differsFromDefault,
      pass: probe?.exteriorStreamingActive === false && statements.length > 0 && differsFromDefault,
      passRule: "Exterior streaming is off, the details panel STATES what is unavailable in words rather than silently drawing less, and the still differs by checksum from the default arm's still at the same pose.",
    };
  });
}

/** J6 — reads the E-1 record. It takes no measurement of its own. */
async function journeyEvictionCrossReference() {
  const path = join(evidenceRoot, "eviction-loop.json");
  const record = await readFile(path, "utf8").then((text) => JSON.parse(text)).catch(() => null);
  if (!record) {
    return {
      journeyId: JOURNEY_GATES.J6.journeyId,
      claim: JOURNEY_GATES.J6.claim,
      crossReference: JOURNEY_GATES.J6.crossReference,
      source: `data/${CAMPAIGN_EVIDENCE_ID}/eviction-loop.json`,
      available: false,
      pass: null,
      statement: "THE E-1 RECORD IS NOT PRESENT, so this journey reports nothing rather than running a second, differently-shaped loop and calling it the same measurement. J6 is a cross-reference by construction; without its referent it has no content.",
    };
  }
  const gate = record.gates?.["E-1e"] ?? null;
  return {
    journeyId: JOURNEY_GATES.J6.journeyId,
    claim: JOURNEY_GATES.J6.claim,
    crossReference: JOURNEY_GATES.J6.crossReference,
    source: `data/${CAMPAIGN_EVIDENCE_ID}/eviction-loop.json`,
    available: true,
    selectionFeatureId: record.selectionFeatureId ?? null,
    selectionDigestFirstVisit: gate?.selectionDigestFirstVisit ?? null,
    selectionDigestAfterReEntry: gate?.selectionDigestAfterReEntry ?? null,
    bothNonNull: gate?.bothNonNull ?? null,
    equal: gate?.equal ?? null,
    pass: gate?.pass ?? null,
    uncapturedGap: record.uncapturedGap ?? null,
    statement: "Reported BY REFERENCE. The eviction loop is the capture; this row restates its E-1e verdict so one measurement is reported once, and it does not re-run the loop.",
  };
}

// ---------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------

async function servedBundlePreflight(base) {
  const index = await (await fetch(base)).text();
  const localIndex = await readFile(join(repositoryRoot, "dist", "index.html"), "utf8");
  const scripts = [...index.matchAll(/src="([^"]+\.js)"/gu)].map((match) => match[1]);
  const assets = [];
  let schedulerProbePresent = false;
  for (const relative of scripts) {
    const bytes = new Uint8Array(await (await fetch(new URL(relative, base))).arrayBuffer());
    if (Buffer.from(bytes).toString("utf8").includes("data-exterior-scheduler-probe")) schedulerProbePresent = true;
    assets.push({ ref: relative, byteSize: bytes.byteLength, sha256: sha256HexBytes(bytes) });
  }
  const record = {
    previewBase: base,
    indexHtmlChecksumSha256: sha256HexSync(index),
    localDistIndexHtmlChecksumSha256: sha256HexSync(localIndex),
    matchesLocalDist: sha256HexSync(index) === sha256HexSync(localIndex),
    assets,
    schedulerProbePresent,
    statement: "Checked BEFORE Chrome is launched and fail-closed: the served index.html is byte-identical to this worktree's dist/index.html, and the served bytes carry the scheduler probe marker the journeys read wave activation from.",
  };
  if (!record.matchesLocalDist) fail("pre-flight: the served index.html does not match this worktree's dist/index.html.");
  if (!schedulerProbePresent) fail("pre-flight: the served bundle carries no data-exterior-scheduler-probe marker; rebuild with VITE_EXTERIOR_SCHEDULER_PROBE=1.");
  return record;
}

async function main() {
  const argv = process.argv.slice(2);
  const base = argValue(argv, "--base", "http://127.0.0.1:4173/");
  const out = argValue(argv, "--out", CAMPAIGN_EVIDENCE_ID);
  evidenceRoot = join(repositoryRoot, "data", out);
  const attemptCount = Number(argValue(argv, "--attempt", "1"));
  if (!Number.isInteger(attemptCount) || attemptCount < 1) fail("--attempt must be a positive integer; the record states how many attempts this capture took.");

  const servedBundle = await servedBundlePreflight(base);
  const featureId = await servedFeatureId(JOURNEY_RELEASE_ID);
  const browser = await launchChrome();
  /** The T008 cleanup reading: how many scratch processes SURVIVED the kill. */
  let surviving;
  let journeys;
  try {
    const j1 = await journeyColdDefault(base);
    console.log(`  J1 waves=${j1.activeWaveCount} bootDocs=${j1.bootDocumentTotal} pass=${j1.pass}`);
    const j2 = await journeySearchSelect(base, featureId);
    console.log(`  J2 results=${j2.searchResultCount} rows=${j2.presentRows.length}/${j2.requiredRows.length} pass=${j2.pass}`);
    const j3 = await journeyBlock835OptIn(base);
    console.log(`  J3 waves=${j3.activeWaveIds.join(",")} resident=${j3.residentCount} pass=${j3.pass}`);
    const j4 = await journeyDeepLinkIdentity(base, featureId, j2.panel);
    console.log(`  J4 roundTrip=${j4.urlRoundTripped} digestsMatch=${j4.digestsMatch} pass=${j4.pass}`);
    const j5 = await journeyStreamingOffHonesty(base, featureId, j4.still);
    console.log(`  J5 statements=${j5.unavailableStatements.length} differs=${j5.stillDiffersFromDefaultArm} pass=${j5.pass}`);
    const j6 = await journeyEvictionCrossReference();
    console.log(`  J6 available=${j6.available} pass=${j6.pass}`);
    journeys = [j1, j2, j3, j4, j5, j6];
  } finally {
    surviving = await killChrome();
    console.log(`  cleanup: survivingChromeProcessCount=${surviving}`);
  }

  const gating = journeys.filter((journey) => typeof journey.pass === "boolean");
  const record = {
    schemaVersion: "1.0",
    recordId: `${CAMPAIGN_EVIDENCE_ID}:journeys`,
    task: "T006",
    artifact: "serving-journeys",
    capturedAt: new Date().toISOString(),
    attemptCount,
    attemptPolicy: CAMPAIGN_DISCIPLINE.attemptPolicy,
    browser,
    viewport: VIEWPORT,
    base,
    pose: JOURNEY_POSE,
    selectionFeatureId: featureId,
    selectionReleaseId: JOURNEY_RELEASE_ID,
    servedBundle,
    chromeLaunchCommand: CHROME_LAUNCH_COMMAND,
    chromeDiscipline: CAMPAIGN_DISCIPLINE.chromeDiscipline,
    survivingChromeProcessCount: surviving,
    preRegistration: `data/${CAMPAIGN_EVIDENCE_ID}/pre-registration.json`,
    frozenCliProhibition: JOURNEY_GATES.frozenCliProhibition,
    visualRule: VISUAL_GATES.rule,
    blenderInheritance: VISUAL_GATES.blenderInheritance,
    journeys,
    passedJourneyIds: gating.filter((journey) => journey.pass).map((journey) => journey.journeyId),
    failedJourneyIds: gating.filter((journey) => !journey.pass).map((journey) => journey.journeyId),
    ok: gating.every((journey) => journey.pass),
    claim: "Six journeys through the SHIPPED UI on the promoted six-wave default, each carrying a rendered still. They state what the app resolved, selected, said and drew at these poses. Passing them is not visual, geographic, factual or accessibility acceptance, and a still is evidence that pixels were produced rather than evidence of likeness.",
    uncapturedGap: "NO CANVAS PICK on exterior geometry is captured here. Every selection in this suite is reached through search or through a ?feature= deep link against the canonical base identity set. That is a real gap and is named rather than approximated.",
  };
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(join(evidenceRoot, "journeys.json"), serialize(record));
  await writeFile(join(evidenceRoot, "journeys.sha256"), `${sha256HexSync(serialize(record))}  journeys.json\n`);
  console.log(serialize({ ok: record.ok, passed: record.passedJourneyIds, failed: record.failedJourneyIds, survivingChromeProcessCount: surviving }));
  if (!record.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (error) => { await killChrome(); console.error(error instanceof Error ? error.stack : String(error)); process.exit(1); });
}
