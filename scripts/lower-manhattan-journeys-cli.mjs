/* global console, process, WebSocket, URL, fetch, setTimeout, Buffer */
/**
 * T016 renderer journeys: the promoted composition exercised in a real browser
 * against the real base, one journey per claim the promotion makes.
 *
 * A promotion record and a drift gate prove what the BUILD accepts. They cannot
 * prove that a clean session streams three waves, that a picked Financial
 * District building names its own release and checksum, that an unshipped cell
 * says so in words, or that switching exteriors off switches all three off.
 * Those are browser facts, and this captures them as browser facts.
 *
 * Every journey writes its own evidence entry with the DOM text it read and a
 * checksummed still, so a reader can check the claim rather than take it.
 *
 * Journeys, in the order they run:
 *   cold-default        A clean no-param load streams all three waves, and the
 *                       curated w02 cells render textured.
 *   cross-release-pick  A Financial District building names its release, cell,
 *                       cell release, asset checksum, truth tiers and
 *                       uncertainty statement.
 *   canary-opt-in       The T015 canary's `?exteriorCells=` link still resolves
 *                       to the canary alone, unchanged by its wave's promotion.
 *   streaming-off       `exteriorStreaming=off` disables ALL three waves.
 *   tombstone-truth     An unshipped w02 cell states that it ships no exterior
 *                       geometry, rather than going quiet.
 *
 * The per-wave ROLLBACK rehearsal and the FAULT isolation journey are not here.
 * Rollback is a build-time record swap with no URL that expresses it, and the
 * cell fault injector is gated behind a `VITE_BLOCK835_PROBE=1` build; both are
 * covered by named tests instead, and this file says so rather than leaving a
 * reader to assume a browser proved them.
 *
 * Usage:
 *   node scripts/lower-manhattan-journeys-cli.mjs \
 *     --preview http://localhost:4174 --port 9222 [--out <path>]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import { LOWER_MANHATTAN_P1_RELEASE_ID } from "../src/release/lower-manhattan-p1-release.ts";
import { LOWER_MANHATTAN_RELEASE_ID } from "../src/release/lower-manhattan-package.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const capturesRoot = join(repositoryRoot, "artifacts", "lower-manhattan-20260812-p1-acceptance", "journeys");
const defaultOutPath = join(repositoryRoot, "data", "lower-manhattan-20260812-p1", "journey-evidence.json");

const BASE_RELEASE_ID = "manhattan-citywide-20260804";
const BLOCK835_RELEASE_ID = "manhattan-exterior-cells-20260811-v3";
const MIDTOWN_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3";
const PROMOTED_RELEASE_IDS = [BLOCK835_RELEASE_ID, MIDTOWN_RELEASE_ID, LOWER_MANHATTAN_P1_RELEASE_ID];

const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 180_000;
const STILL_CHROME_HIDE_CSS = ".exploration-notice, .runtime-note, nav, header, footer { display: none !important; }";

/** A camera inside the curated pair; the same pose the acceptance run measured. */
const FIDI_POSE = { lon: -74.01800, lat: 40.70750, height: 180, heading: 40, pitch: -5, roll: 0 };

function fail(message) { throw new Error(`lower-manhattan-journeys: ${message}`); }

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
  for (const releaseId of [...PROMOTED_RELEASE_IDS, LOWER_MANHATTAN_RELEASE_ID]) {
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
    const url = appUrl(previewBase, { pose: FIDI_POSE });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    const waves = await waitFor(
      session,
      (value) => PROMOTED_RELEASE_IDS.every((releaseId) => value.some((wave) => wave.releaseId === releaseId && wave.origin !== null)),
      READ_WAVES,
      "cold-default",
    );
    // Readiness means every wave ACTIVATED, not that every asset arrived: the
    // loader is progressive, and asserting the full count the instant the third
    // wave went active read 7 of 71 and called the journey failed. Wait for the
    // w02 fetch count to reach its shipped total or stop growing, so the claim
    // is about what the session streams rather than about when it was sampled.
    let previousCount = -1;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const count = networkPerRelease(session).perRelease[LOWER_MANHATTAN_P1_RELEASE_ID].glbCount;
      if (count === 71) break;
      if (count === previousCount && attempt > 4) break;
      previousCount = count;
      await new Promise((done) => { setTimeout(done, 1_000); });
    }
    const network = networkPerRelease(session);
    return {
      journeyId: "cold-default",
      claim: "A clean load with no exterior URL parameter streams all three promoted waves over the real citywide base, and the curated w02 cells render their 71 textured assets.",
      url,
      waves,
      network,
      passed: network.perRelease[LOWER_MANHATTAN_P1_RELEASE_ID].glbCount === 71
        && network.perRelease[LOWER_MANHATTAN_RELEASE_ID].glbCount === 0
        && network.externalHosts.length === 0,
      still: await still(session, "cold-default"),
    };
  } finally { await closePage(port, session); }
}

async function journeyCrossReleasePick(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: FIDI_POSE });
    await session.send("Page.navigate", { url });
    await waitFor(
      session,
      (value) => PROMOTED_RELEASE_IDS.every((releaseId) => value.some((wave) => wave.releaseId === releaseId && wave.origin !== null)),
      READ_WAVES,
      "cross-release-pick",
    );
    // Open the details panel and select a curated building through the app's own
    // search, so the pick travels the path a user's pick travels.
    await session.evaluate(`(() => {
      const open = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Open details');
      if (open) open.click();
      const search = document.querySelector('input[type="search"], input[placeholder*="Search"]');
      if (search) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(search, 'doitt:1114961');
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
      journeyId: "cross-release-pick",
      claim: "A picked Financial District building names the release it came from, its cell and cell release, the checksum of the exact asset on screen, its generated truth tiers, and an uncertainty statement.",
      url,
      searchResults: results,
      detail,
      passed: Boolean(detail)
        && String(detail.badge ?? "").includes(LOWER_MANHATTAN_P1_RELEASE_ID)
        && String(rows["Cell / release"] ?? "").includes("manhattan-exterior-cell-w02-")
        && /[0-9a-f]{64}/u.test(String(rows["Active asset"] ?? ""))
        && String(rows["Truth tiers"] ?? "").length > 0
        && String(rows["Uncertainty"] ?? "").length > 0,
      still: await still(session, "cross-release-pick"),
    };
  } finally { await closePage(port, session); }
}

async function journeyCanaryOptIn(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: FIDI_POSE, params: { exteriorCells: LOWER_MANHATTAN_RELEASE_ID, exteriorStreaming: "on" } });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    const waves = await waitFor(
      session,
      (value) => value.some((wave) => wave.releaseId === LOWER_MANHATTAN_RELEASE_ID && wave.origin !== null),
      READ_WAVES,
      "canary-opt-in",
    );
    let previousCanaryCount = -1;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const count = networkPerRelease(session).perRelease[LOWER_MANHATTAN_RELEASE_ID].glbCount;
      if (count === 41) break;
      if (count === previousCanaryCount && attempt > 4) break;
      previousCanaryCount = count;
      await new Promise((done) => { setTimeout(done, 1_000); });
    }
    const network = networkPerRelease(session);
    return {
      journeyId: "canary-opt-in",
      claim: "The T015 canary's promotion-era-independent opt-in link still resolves to the canary ALONE. Promoting the wave's P1 successor did not withdraw the canary, and `?exteriorCells=` still means exactly the release it names.",
      url,
      waves,
      network,
      passed: network.perRelease[LOWER_MANHATTAN_RELEASE_ID].glbCount === 41
        && network.perRelease[LOWER_MANHATTAN_P1_RELEASE_ID].glbCount === 0
        && network.perRelease[MIDTOWN_RELEASE_ID].glbCount === 0,
      still: await still(session, "canary-opt-in"),
    };
  } finally { await closePage(port, session); }
}

async function journeyStreamingOff(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: FIDI_POSE, params: { exteriorStreaming: "off" } });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    await new Promise((done) => { setTimeout(done, 12_000); });
    const waves = await session.evaluate(READ_WAVES);
    const statements = await session.evaluate(`(() => {
      const open = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Open details');
      if (open) open.click();
      return [...document.querySelectorAll('[data-exterior-unavailable]')].map((node) => (node.textContent || '').trim().slice(0, 400));
    })()`);
    const network = networkPerRelease(session);
    const anyGlb = PROMOTED_RELEASE_IDS.reduce((total, releaseId) => total + network.perRelease[releaseId].glbCount, 0);
    return {
      journeyId: "streaming-off",
      claim: "`exteriorStreaming=off` disables ALL three promoted waves, not just the newest, and no exterior GLB is fetched at all.",
      url,
      waves,
      unavailableStatements: statements,
      network,
      passed: anyGlb === 0 && waves.every((wave) => wave.origin === null),
      still: await still(session, "streaming-off"),
    };
  } finally { await closePage(port, session); }
}

async function journeyTombstoneTruth(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: FIDI_POSE });
    await session.send("Page.navigate", { url });
    await waitFor(
      session,
      (value) => PROMOTED_RELEASE_IDS.every((releaseId) => value.some((wave) => wave.releaseId === releaseId && wave.origin !== null)),
      READ_WAVES,
      "tombstone-truth",
    );
    await new Promise((done) => { setTimeout(done, 4_000); });
    const notices = await session.evaluate(`(() => [...document.querySelectorAll('[data-exterior-notices] li')].map((node) => (node.textContent || '').trim()))()`);
    const w02Notice = notices.find((notice) => notice.includes(LOWER_MANHATTAN_P1_RELEASE_ID)) ?? null;
    return {
      journeyId: "tombstone-truth",
      claim: "The 124 owned w02 cells this release does NOT materialize are reported in words — the release says how many of its cells ship no exterior geometry and that no substitute was selected — rather than going quiet.",
      url,
      notices,
      w02Notice,
      passed: typeof w02Notice === "string"
        && w02Notice.includes("124 of 126")
        && w02Notice.includes("no substitute was selected"),
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
    ["cold-default", journeyColdDefault],
    ["cross-release-pick", journeyCrossReleasePick],
    ["canary-opt-in", journeyCanaryOptIn],
    ["streaming-off", journeyStreamingOff],
    ["tombstone-truth", journeyTombstoneTruth],
  ]) {
    console.error(`journey ${label} ...`);
    journeys.push(await run(port, previewBase));
  }

  const evidence = {
    schemaVersion: "1.0",
    releaseId: LOWER_MANHATTAN_P1_RELEASE_ID,
    note: "T016 renderer journeys against the production preview and the real pinned citywide base. Each entry records the claim it tests, the URL it used, the DOM text it read, the per-release network measurement, and a checksummed still. `passed` is computed from the readings, not asserted.",
    capturedWith: { viewport: VIEWPORT, previewBase, remoteDebuggingPort: port },
    coveredByTestsInstead: [
      "Per-wave ROLLBACK rehearsal: no URL expresses a build-time promotion-record swap, so it is proven through the record's own injection seam in src/runtime/exterior-multiwave-activation.test.ts ('rolls the Lower-Manhattan wave back to BASE MASSING without withdrawing the other two').",
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
