/* global console, process, WebSocket, URL, fetch, setTimeout, Buffer, TextDecoder */
/**
 * T029 bounded-gap closures: the four machine-executable NOT-MET items the T024
 * reconciliation left open, measured in a real Chrome and committed as records.
 *
 * A sibling of `scripts/northern-manhattan-acceptance-cli.mjs`, which stays
 * exactly as it is. This file reuses that CLI's instrument — the served-bundle
 * identity gate, the minimal CDP client, the fresh page per capture, the forced
 * collection before a heap read, the checksummed still — and adds only what the
 * four stop reports actually ask for:
 *
 *   `facade-1440p`      criterion 7  — the committed 8-pose Block 835 path,
 *                                      re-captured at a 2560x1440 CSS viewport.
 *   `accessibility`     criterion 24 — real keyboard traversal with the DOM
 *                                      focus path recorded per step, plus a
 *                                      prefers-reduced-motion behaviour read.
 *   `heap-concurrency`  criterion 30 — the existing block835CanaryHeapVerdict
 *                                      method over a REPEATED deterministic
 *                                      camera path on the six-wave default
 *                                      composition, with forced collection, and
 *                                      the MEASURED peak concurrent request
 *                                      count beside it.
 *   `mobile-journey`    criterion 8  — one mobile-emulated journey over the
 *                                      newly wired lower-LOD path.
 *
 * WHAT UNBLOCKED THREE OF THE FOUR. T009 recorded a CDP focus limitation: the
 * embedded tab took no OS focus, `document.hasFocus()` read false, and both the
 * in-app canary probe and any keyboard traversal refused to start. CDP has an
 * explicit answer — `Emulation.setFocusEmulationEnabled` — and every subcommand
 * here that needs focus enables it and RECORDS that it did, because a focus that
 * was emulated is not an OS-level focus and the records must not imply it was.
 *
 * Preconditions, refused loudly rather than worked around:
 *   1. `pnpm build` has produced a `dist/` carrying the promoted payloads
 *      (`heap-concurrency` additionally needs the probe-harness build; see its
 *      own gate, which refuses a bundle without the probe rather than reporting
 *      a measurement it could not take);
 *   2. `pnpm preview` is serving THAT dist;
 *   3. Chrome is listening on the given remote-debugging port.
 *
 * Usage:
 *   node scripts/goal-bounded-gaps-cli.mjs <subcommand> \
 *     --preview http://localhost:4176 --port 9224 [--out <path>]
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { LOWER_MANHATTAN_P1_RELEASE_ID } from "../src/release/lower-manhattan-p1-release.ts";
import { SOUTHERN_REMAINDER_P1_RELEASE_ID } from "../src/release/southern-remainder-p1-release.ts";
import { CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID } from "../src/release/central-upper-manhattan-p1-release.ts";
import { NORTHERN_MANHATTAN_P1_RELEASE_ID } from "../src/release/northern-manhattan-p1-release.ts";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const recordRoot = join(repositoryRoot, "data", "goal-bounded-gaps-20260812");
const capturesRoot = join(repositoryRoot, "artifacts", "goal-bounded-gaps-20260812", "captures");
const distRoot = join(repositoryRoot, "dist");

const BASE_RELEASE_ID = "manhattan-citywide-20260804";
const BLOCK835_RELEASE_ID = "manhattan-exterior-cells-20260811-v3";
const MIDTOWN_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3";
const PROMOTED_RELEASE_IDS = [
  BLOCK835_RELEASE_ID,
  MIDTOWN_RELEASE_ID,
  LOWER_MANHATTAN_P1_RELEASE_ID,
  SOUTHERN_REMAINDER_P1_RELEASE_ID,
  CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
  NORTHERN_MANHATTAN_P1_RELEASE_ID,
];
/** Block 835 ships fourteen buildings; "renders 14/14" is this number. */
const BLOCK835_EXPECTED_GLB_COUNT = 14;

/** The 1440p-class desktop target criterion 7 names, and that no capture in this Goal ever used. */
const VIEWPORT_1440P = { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false };
/**
 * The mobile class. iPhone-14-sized because that is the device class the
 * project's own Stage 3 overlay work used, so the two are comparable.
 */
const VIEWPORT_MOBILE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
const MOBILE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const READY_TIMEOUT_MS = 180_000;

function fail(message) { throw new Error(`goal-bounded-gaps: ${message}`); }

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

// ---------------------------------------------------------------------------
// Which bundle was actually measured
// ---------------------------------------------------------------------------

/**
 * Identifies the bundle the preview is SERVING and refuses to proceed if it is
 * not this repository's build. Carried over verbatim in intent from the T016
 * instrument, which exists because a run once reached a `vite preview` left
 * listening by another worktree and produced a meaningless pass.
 *
 * `expectProbeHarness` is accepted and deliberately UNUSED here. The first cut
 * of this gate answered it by grepping the served bytes for the probe's query
 * parameter name — which is present whether or not the harness flag was set at
 * build time, so it was a check that always passed while reading like one that
 * meant something. The question is asked of the running page instead, by
 * `requireLiveProbe` inside `heapConcurrency`; the parameter is kept so callers
 * still declare the expectation at the call site.
 */
async function servedBundleIdentity(previewBase, { expectProbeHarness = false } = {}) {
  const indexResponse = await fetch(`${previewBase}/`).catch(() => fail(`no preview server answered at ${previewBase}.`));
  if (!indexResponse.ok) fail(`the preview server answered ${indexResponse.status} for /; the served bundle cannot be identified.`);
  const indexHtml = await indexResponse.text();
  const reference = /src="([^"]*index-[^"]*\.js)"/u.exec(indexHtml);
  if (!reference) fail("the served index.html declares no entry script; the served bundle cannot be identified.");
  const entryPath = reference[1];
  const entryResponse = await fetch(new URL(entryPath, `${previewBase}/`)).catch(() => fail(`the served entry script ${entryPath} could not be fetched.`));
  if (!entryResponse.ok) fail(`the preview server answered ${entryResponse.status} for ${entryPath}; the served bundle cannot be identified.`);
  const entryBytes = new Uint8Array(await entryResponse.arrayBuffer());
  const entryText = new TextDecoder().decode(entryBytes);

  const indexChecksum = sha256HexSync(indexHtml);
  const entryChecksum = sha256HexBytes(entryBytes);

  if (!existsSync(join(distRoot, "index.html"))) {
    fail(`there is no ${distRoot}/index.html to compare the served bundle against. Run \`pnpm build\` before capturing, so the record can state WHICH build was measured.`);
  }
  const localIndexChecksum = sha256HexSync(await readFile(join(distRoot, "index.html"), "utf8"));
  if (localIndexChecksum !== indexChecksum) {
    fail(`the preview at ${previewBase} is serving an index.html (${indexChecksum}) that is not this repository's build (${localIndexChecksum}). This is the stale-server failure: start a preview on a port you own, from this tree's dist.`);
  }
  for (const releaseId of PROMOTED_RELEASE_IDS) {
    if (!entryText.includes(releaseId)) fail(`the served entry script does not name ${releaseId}, so it predates the six-wave promotion and nothing measured against it would describe the shipped composition.`);
  }
  // Deliberately NOT a bundle string check. The probe's query-parameter name
  // and its output element both appear in the emitted bytes whether or not the
  // harness flag was set at build time, so grepping for either would be a gate
  // that always passes — which is worse than no gate, because it reads like
  // one. Whether the harness is live is asked of the RUNNING PAGE instead, by
  // `requireLiveProbe` below.
  void expectProbeHarness;

  return {
    previewBase,
    indexHtmlChecksumSha256: indexChecksum,
    localDistIndexHtmlChecksumSha256: localIndexChecksum,
    matchesLocalDist: true,
    entryScriptPath: entryPath,
    entryScriptByteSize: entryBytes.byteLength,
    entryScriptChecksumSha256: entryChecksum,
    entryScriptNamesAllSixPromotedReleases: true,
    statement: `Measured before any capture. The served index.html is byte-identical to this repository's dist/index.html and the served entry script names all ${PROMOTED_RELEASE_IDS.length} promoted releases, so every reading below is from THIS build. Any of those failing aborts the run rather than being recorded as a caveat.`,
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

/**
 * A FRESH page per capture.
 *
 * The T015 discipline, kept deliberately: a reused page carries the previous
 * capture's resident cache, so a per-pose artifact count taken on a reused page
 * measures what the session has ever streamed rather than what this pose
 * needed, and a heap read on one is a reading about the whole session.
 */
async function openFreshPage(port, previewBase, { viewport, userAgent = null, focusEmulation = false, reducedMotion = false } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(previewBase)}`, { method: "PUT" })
    .catch(() => fail(`Chrome is not listening on 127.0.0.1:${port}. Launch it with --remote-debugging-port.`));
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
  await session.send("Emulation.setDeviceMetricsOverride", viewport);
  if (userAgent) await session.send("Emulation.setUserAgentOverride", { userAgent });
  if (viewport.mobile) await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  // Emulated, never OS-level. Every record that relies on it says so.
  if (focusEmulation) await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  if (reducedMotion) await session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  return session;
}

async function closePage(port, session) {
  session.close();
  try { await fetch(`http://127.0.0.1:${port}/json/close/${session.targetId}`); } catch { /* going away either way */ }
}

const delay = (ms) => new Promise((done) => { setTimeout(done, ms); });

/** Distinct GLB artifacts streamed per release, from the URLs the page issued. */
function distinctGlbByRelease(session) {
  const responses = new Map(session.events
    .filter((event) => event.method === "Network.responseReceived")
    .map((event) => [event.params.requestId, event.params.response.url]));
  const finished = session.events
    .filter((event) => event.method === "Network.loadingFinished")
    .map((event) => responses.get(event.params.requestId) ?? "");
  const perRelease = {};
  for (const releaseId of PROMOTED_RELEASE_IDS) {
    const marker = `/data/${releaseId}/`;
    perRelease[releaseId] = new Set(finished.filter((url) => url.includes(marker) && url.endsWith(".glb"))).size;
  }
  return perRelease;
}

function externalHostsOf(session) {
  const urls = session.events.filter((event) => event.method === "Network.requestWillBeSent").map((event) => event.params.request.url);
  return [...new Set(urls
    .map((url) => { try { return new URL(url).hostname; } catch { return ""; } })
    .filter((hostname) => hostname !== "" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)))].sort();
}

/** Waits until every promoted wave reports an active runtime, or fails by name. */
async function waitForSixWaves(session, label) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let waves = [];
  for (;;) {
    if (Date.now() > deadline) fail(`${label} never streamed every promoted wave (last seen: ${JSON.stringify(waves)}).`);
    await delay(750);
    waves = await session.evaluate(`(() => [...document.querySelectorAll('[data-exterior-release]')].map((node) => ({
      releaseId: node.getAttribute('data-exterior-release'),
      origin: node.getAttribute('data-exterior-snapshot-origin'),
    })))()`).catch(() => []);
    const active = waves.filter((wave) => wave.origin !== null).map((wave) => wave.releaseId);
    if (PROMOTED_RELEASE_IDS.every((releaseId) => active.includes(releaseId))) return active.sort();
  }
}

async function still(session, name) {
  await delay(1_200);
  const shot = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const bytes = Buffer.from(shot.data, "base64");
  const path = join(capturesRoot, `${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return { relativeRef: `captures/${name}.png`, byteSize: bytes.byteLength, checksumSha256: sha256HexBytes(new Uint8Array(bytes)) };
}

/** The viewport the page actually got, read from the page rather than assumed. */
/**
 * WHETHER THE DISCLOSURE IS ACTUALLY LEGIBLE, not merely present.
 *
 * The first cut of the mobile journey passed leg 1 on `disclosurePresent`, and
 * its own still showed the line clamped to one ellipsised row underneath two
 * stacked control panels. DOM presence and on-screen legibility are different
 * claims, and a record that asserts the second from the first is wrong however
 * true the first is.
 *
 * So this measures the rendered box: whether the element has area, whether it
 * sits inside the viewport, whether its own computed style still clamps it to a
 * single line, whether its full text fits the box it was given, and — by
 * hit-testing points across the element — whether something else is painted on
 * top. `occludedByElements` names what was found there, so an occlusion is
 * reported as a NAMED overlay rather than as a boolean.
 */
const READ_DISCLOSURE_LEGIBILITY = `(() => {
  const node = document.querySelector('[data-mobile-lower-lod]');
  if (!node) return { present: false };
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  const points = [];
  for (const fx of [0.1, 0.5, 0.9]) {
    for (const fy of [0.15, 0.5, 0.85]) {
      points.push([rect.left + rect.width * fx, rect.top + rect.height * fy]);
    }
  }
  const covering = new Map();
  let hits = 0;
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
    hits += 1;
    const top = document.elementFromPoint(x, y);
    if (top && top !== node && !node.contains(top)) {
      const description = top.tagName.toLowerCase()
        + (top.className && typeof top.className === "string" && top.className ? "." + top.className.trim().split(/\\s+/u).join(".") : "")
        + (top.getAttribute("data-exterior-notices") !== null ? "[data-exterior-notices]" : "");
      covering.set(description, (covering.get(description) ?? 0) + 1);
    }
  }
  return {
    present: true,
    boundingBox: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    hasArea: rect.width > 0 && rect.height > 0,
    insideViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
    whiteSpace: style.whiteSpace,
    overflow: style.overflow,
    textOverflow: style.textOverflow,
    fontSizePx: style.fontSize,
    singleLineClamped: style.whiteSpace === "nowrap",
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    textFitsItsBox: node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1,
    renderedLineCount: rect.height > 0 ? Math.round(rect.height / (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.45)) : 0,
    sampledPoints: hits,
    occludedPoints: [...covering.values()].reduce((total, count) => total + count, 0),
    occludedByElements: [...covering.entries()].map(([element, count]) => ({ element, count })).sort((left, right) => right.count - left.count),
  };
})()`;

/**
 * Overlays and notices painted over the map at capture time, named per leg.
 *
 * The six-wave default session raises a legitimate "Exterior streaming
 * fallback" notice — 870 of 883 cells ship no exterior geometry and the product
 * says so — and on a 390px viewport that notice is large. It is honest and it
 * is also occlusion, so every leg records what was on screen instead of leaving
 * a reader to discover it in a still.
 */
const READ_OVERLAY_STATE = `(() => {
  const notices = document.querySelector('[data-exterior-notices]');
  const rect = notices ? notices.getBoundingClientRect() : null;
  const viewportArea = window.innerWidth * window.innerHeight;
  const panels = [...document.querySelectorAll('.runtime-note, .exploration-notice, .diagnostics-toggle, .directions-toggle, .layers-toggle')]
    .map((node) => {
      const box = node.getBoundingClientRect();
      return { element: node.className || node.tagName.toLowerCase(), width: Math.round(box.width), height: Math.round(box.height) };
    })
    .filter((entry) => entry.width > 0 && entry.height > 0);
  return {
    exteriorFallbackNoticePresent: notices !== null,
    exteriorFallbackNoticeViewportFraction: rect ? Number(((rect.width * rect.height) / viewportArea).toFixed(3)) : 0,
    overlayPanelCount: panels.length,
    overlayPanels: panels,
  };
})()`;

const READ_VIEWPORT = `(() => ({
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  devicePixelRatio: window.devicePixelRatio,
  documentHasFocus: document.hasFocus(),
  prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  userAgent: window.navigator.userAgent,
}))()`;

function appUrl(previewBase, params) {
  const url = new URL(previewBase);
  url.pathname = "/";
  const search = url.searchParams;
  search.set("data", BASE_RELEASE_ID);
  search.set("release", BASE_RELEASE_ID);
  search.set("view", "explore");
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }
  return url.toString();
}

async function writeRecord(outPath, record) {
  await mkdir(dirname(outPath), { recursive: true });
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  await writeFile(outPath, serialized);
  const checksum = sha256HexSync(serialized);
  await writeFile(`${outPath}.sha256`, `${checksum}\n`);
  return checksum;
}

export {
  BLOCK835_EXPECTED_GLB_COUNT,
  BLOCK835_RELEASE_ID,
  PROMOTED_RELEASE_IDS,
  VIEWPORT_1440P,
  VIEWPORT_MOBILE,
  appUrl,
  distinctGlbByRelease,
  externalHostsOf,
};

// ---------------------------------------------------------------------------
// Criterion 7 — the 1440p-class capture
// ---------------------------------------------------------------------------

/**
 * THE BOUND THIS CAPTURE INHERITS, STATED BEFORE ITS RESULTS.
 *
 * The committed path's poses sit 4 to 40 metres above the ellipsoid, and the
 * application's navigation parser CLAMPS a deep-linked camera height to a
 * floor. A URL therefore cannot express the fixture's own heights, and T009
 * captured this path under exactly the same clamp — its row 2 records the same
 * limitation in its own words and makes no per-pose composition claim from the
 * close poses because of it.
 *
 * This capture changes ONE variable, which is the one criterion 7 is about: the
 * viewport. Every other term — the pose list, the plan hashes, the anchors, the
 * reading procedure, the clamp — is the committed one. Anything else would make
 * the result incomparable with the reading it supersedes.
 */
const FACADE_CLAMP_DISCLOSURE = "The committed path's poses are delivered as deep links, so the application's navigation parser clamps each camera height to its floor exactly as it did for the T009 capture of the same path. The pose longitude, latitude, heading, pitch and roll are the committed fixture's; the height is the clamped one, and the record carries both. This capture changes the VIEWPORT and nothing else, which is the single variable criterion 7 names.";

/**
 * THE QUALITATIVE READING, carried in the record instead of only in prose
 * elsewhere.
 *
 * Criterion 7 asks about composition, openings, entrances, material classes and
 * roofline. None of those is a counter, and this repository has no automated
 * facade-composition metric — so the reading is a HUMAN one, made by opening
 * the captured stills, and it is written down here with the stills it was made
 * from named. It is deliberately scoped: three of sixteen, chosen to cover both
 * framings and both a near-field and a skyline pose. A reading of three stills
 * is not a reading of sixteen, and the record says which it is.
 */
const FACADE_VISUAL_READING = {
  method: "Human visual reading of the captured 2560x1440 stills. No automated facade-composition metric exists in this repository and none is invented here; the per-pose MACHINE verdict is viewport, artifact count, host containment and labelling, and this block is separate from it.",
  stillsRead: [
    "captures/facade-1440p__level__canary-facade-03.png",
    "captures/facade-1440p__level__canary-facade-08.png",
    "captures/facade-1440p__oblique__canary-facade-03-oblique.png",
  ],
  stillsCaptured: 16,
  observed: [
    "Facade bays with regular, recessed window openings resolved individually at this viewport, across both the near-field level pose and the oblique pose.",
    "Floor banding and spandrel divisions continuous across each facade, with no interruption at a bay boundary.",
    "Setback massing with its deck surfaces and the cornice band at each setback, read on the tiered tower in canary-facade-08.",
    "Roof equipment as discrete masses, and a water-tank prism on legs visible in canary-facade-03.",
    "Four distinguishable material classes in one frame - masonry-warm terracotta, masonry-light cream, curtain-cool teal and stone-neutral grey - so the material-class assignment is legible as variation rather than as a single tone.",
    "Ground-plane divisions at the base of the near-field facades.",
  ],
  notObserved: [
    "No blank placeholder wall on any visible surface in any of the three stills.",
    "No visibly broken LOD transition, and no missing geometry where a building was streamed.",
    "No tenant name, logo, glyph or signage text anywhere, consistent with the packages being glyph-free by construction.",
  ],
  disclosedOcclusion: "The truthful 'Exterior streaming fallback' notice - the tombstone statement for the 870 of 883 cells that ship no exterior geometry - occupies a large central region of every 1440p still. It occludes scene content. It is honest and it is not cropped, and it means each still shows less of the facade than the viewport could have.",
  bound: "Three of sixteen stills were read. No per-pose composition claim is made for the other thirteen, whose verdicts rest on the machine readings alone. The reading is qualitative and is not a measurement.",
};

async function facade1440p(previewBase, port, outPath) {
  const identity = await servedBundleIdentity(previewBase);
  const pathRecord = JSON.parse(await readFile(join(repositoryRoot, "data", "block835-canary-validation-20260811", "facade-path.json"), "utf8"));
  const obliqueRecord = JSON.parse(await readFile(join(repositoryRoot, "data", "block835-canary-validation-20260811", "facade-path-oblique.json"), "utf8"));
  const poseSets = [
    { setId: pathRecord.pathId, framing: "level", poses: pathRecord.poses },
    { setId: obliqueRecord.pathId, framing: "oblique", poses: obliqueRecord.poses },
  ];

  const captures = [];
  for (const set of poseSets) {
    for (const pose of set.poses) {
      const session = await openFreshPage(port, previewBase, { viewport: VIEWPORT_1440P });
      try {
        const url = appUrl(previewBase, {
          lon: pose.pose.longitude.toFixed(9),
          lat: pose.pose.latitude.toFixed(9),
          height: pose.pose.height.toFixed(3),
          heading: pose.pose.heading.toFixed(3),
          pitch: pose.pose.pitch.toFixed(3),
          roll: pose.pose.roll.toFixed(3),
        });
        session.events.length = 0;
        await session.send("Page.navigate", { url });
        const activeWaves = await waitForSixWaves(session, `${set.setId}:${pose.poseId}`);
        // Block 835's fourteen assets are small and arrive with the wave; give
        // the scene a settle window before counting, then count what ARRIVED.
        await delay(6_000);
        const viewport = await session.evaluate(READ_VIEWPORT);
        const perRelease = distinctGlbByRelease(session);
        const labeling = await session.evaluate(`(() => {
          const notes = [...document.querySelectorAll('[data-exterior-release]')].map((node) => (node.textContent || "").trim());
          return {
            runtimeNotes: notes,
            statesGeneratedOnly: notes.every((text) => !/evidence-backed|photograph|survey-grade/iu.test(text)),
            statesVerifiedLocalBytes: notes.some((text) => text.includes("verified local GLB bytes only")),
          };
        })()`);
        const capture = await still(session, `facade-1440p__${set.framing}__${pose.poseId}`);
        const viewportIs1440p = viewport.innerWidth === VIEWPORT_1440P.width && viewport.innerHeight === VIEWPORT_1440P.height;
        const renderedAll14 = perRelease[BLOCK835_RELEASE_ID] === BLOCK835_EXPECTED_GLB_COUNT;
        captures.push({
          setId: set.setId,
          framing: set.framing,
          poseId: pose.poseId,
          buildingId: pose.buildingId,
          facade: pose.facade,
          committedCameraToFacadeMeters: pose.cameraToFacadeMeters,
          committedPose: pose.pose,
          planHashSha256: pose.plan?.planHashSha256 ?? null,
          url,
          viewport,
          viewportIs1440p,
          activeWaves,
          block835DistinctGlbCount: perRelease[BLOCK835_RELEASE_ID],
          expectedBlock835GlbCount: BLOCK835_EXPECTED_GLB_COUNT,
          renderedAll14,
          perReleaseDistinctGlbCount: perRelease,
          externalHosts: externalHostsOf(session),
          labeling,
          still: capture,
          passed: viewportIs1440p && renderedAll14 && externalHostsOf(session).length === 0 && labeling.statesGeneratedOnly,
        });
        console.log(`  ${set.framing}/${pose.poseId}: ${viewport.innerWidth}x${viewport.innerHeight} block835 GLBs ${perRelease[BLOCK835_RELEASE_ID]}/${BLOCK835_EXPECTED_GLB_COUNT}`);
      } finally {
        await closePage(port, session);
      }
    }
  }

  const failedPoses = captures.filter((capture) => !capture.passed).map((capture) => `${capture.framing}/${capture.poseId}`);
  const record = {
    schemaVersion: "1.0",
    recordId: "goal-bounded-gaps-20260812:facade-1440p",
    task: "T029 (Issue #62)",
    criterion: 7,
    capturedAt: new Date().toISOString(),
    claim: `The committed Block 835 facade path, re-captured at a ${VIEWPORT_1440P.width}x${VIEWPORT_1440P.height} CSS viewport — the 1440p-class desktop target criterion 7 names and that no capture in this Goal had ever used. Every reading is per pose and every pose carries its own verdict.`,
    clampDisclosure: FACADE_CLAMP_DISCLOSURE,
    servedBundle: identity,
    targetViewport: VIEWPORT_1440P,
    committedPaths: poseSets.map((set) => ({ setId: set.setId, framing: set.framing, poseCount: set.poses.length })),
    visualReading: FACADE_VISUAL_READING,
    minimumCameraToFacadeMeters: pathRecord.minimumCameraToFacadeMeters,
    closestCameraToFacadeMeters: pathRecord.closestCameraToFacadeMeters,
    captures,
    totals: {
      poseCount: captures.length,
      posesAt1440p: captures.filter((capture) => capture.viewportIs1440p).length,
      posesRenderingAll14: captures.filter((capture) => capture.renderedAll14).length,
      posesPassed: captures.filter((capture) => capture.passed).length,
      failedPoses,
    },
    allPassed: failedPoses.length === 0,
  };
  const checksum = await writeRecord(outPath, record);
  console.log(`facade-1440p: ${record.totals.posesPassed}/${record.totals.poseCount} poses passed at ${VIEWPORT_1440P.width}x${VIEWPORT_1440P.height}; record ${checksum}`);
  if (failedPoses.length > 0) console.log(`  FAILED POSES: ${failedPoses.join(", ")}`);
  return record;
}

// ---------------------------------------------------------------------------
// Criterion 24 — accessibility behaviour
// ---------------------------------------------------------------------------

/**
 * The traversal, driven with REAL key events through `Input.dispatchKeyEvent`.
 *
 * T009 enumerated the focusable elements and could not traverse them, because
 * the page held no focus. The elements were never the open question; the
 * behaviour was. So this records, at every step, WHERE FOCUS ACTUALLY WENT —
 * the active element's tag, role, accessible name and its own data attributes —
 * rather than asserting that a step "worked".
 */
async function pressKey(session, key, { code, keyCode, modifiers = 0, text } = {}) {
  const base = { key, code: code ?? key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
  await session.send("Input.dispatchKeyEvent", { ...base, type: text ? "keyDown" : "rawKeyDown", text });
  await session.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  await delay(220);
}

const READ_FOCUS = `(() => {
  const node = document.activeElement;
  if (!node) return null;
  const attributes = {};
  for (const attribute of node.attributes || []) if (attribute.name.startsWith("data-") || attribute.name.startsWith("aria-")) attributes[attribute.name] = attribute.value;
  const label = node.getAttribute("aria-label") || (node.textContent || "").trim().slice(0, 80);
  return {
    tagName: node.tagName.toLowerCase(),
    type: node.getAttribute("type"),
    role: node.getAttribute("role"),
    accessibleName: label,
    id: node.id || null,
    className: typeof node.className === "string" ? node.className : null,
    attributes,
    isBody: node === document.body,
  };
})()`;

async function accessibility(previewBase, port, outPath) {
  const identity = await servedBundleIdentity(previewBase);
  const steps = [];
  const record = { keyboard: null, reducedMotion: null };

  // --- keyboard traversal -------------------------------------------------
  {
    const session = await openFreshPage(port, previewBase, { viewport: VIEWPORT_1440P, focusEmulation: true });
    try {
      await session.send("Page.navigate", { url: appUrl(previewBase, {}) });
      await waitForSixWaves(session, "accessibility-keyboard");
      await delay(4_000);
      const viewport = await session.evaluate(READ_VIEWPORT);
      if (!viewport.documentHasFocus) fail("the page did not hold focus even with Emulation.setFocusEmulationEnabled; a keyboard traversal cannot be claimed.");

      const structure = await session.evaluate(`(() => {
        const focusable = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        return {
          focusableCount: focusable.length,
          buttonCount: focusable.filter((node) => node.tagName === "BUTTON").length,
          unlabeledButtonCount: focusable.filter((node) => node.tagName === "BUTTON" && !(node.getAttribute("aria-label") || (node.textContent || "").trim())).length,
          landmarkCount: document.querySelectorAll("main, header, nav, footer, section[aria-label], [role=main], [role=banner], [role=navigation], [role=contentinfo]").length,
        };
      })()`);

      const capture = async (stepId, note) => {
        const focus = await session.evaluate(READ_FOCUS);
        steps.push({ stepId, note, focus });
        return focus;
      };

      // 1. Tab from the document into the first focusable control.
      await session.evaluate("(() => { document.body.focus(); return true; })()");
      await pressKey(session, "Tab", { code: "Tab", keyCode: 9 });
      await capture("tab-into-app", "First Tab from the document body.");

      // 2. Reach the search field by tabbing, and record every stop on the way
      //    rather than jumping to it — the traversal IS the claim.
      let searchFocus = null;
      for (let index = 0; index < 40 && !searchFocus; index += 1) {
        const focus = await session.evaluate(READ_FOCUS);
        if (focus && (focus.type === "search" || /search/iu.test(focus.accessibleName ?? "") || /search/iu.test(focus.className ?? ""))) {
          if (focus.tagName === "input") { searchFocus = focus; break; }
        }
        await pressKey(session, "Tab", { code: "Tab", keyCode: 9 });
      }
      if (!searchFocus) searchFocus = await session.evaluate(READ_FOCUS);
      steps.push({ stepId: "tab-to-search", note: "Tabbed forward until the search input held focus.", focus: searchFocus });

      // 3. Type a query with real key events and read the results list.
      for (const character of "empire") {
        await pressKey(session, character, { code: `Key${character.toUpperCase()}`, keyCode: character.toUpperCase().charCodeAt(0), text: character });
      }
      await delay(2_500);
      const results = await session.evaluate(`(() => {
        const list = document.querySelector('[data-search-results], .search-results, ul.results');
        const options = [...document.querySelectorAll('[role=option], .search-results li, [data-search-result]')];
        return { hasResultsContainer: list !== null, resultCount: options.length, firstResultText: (options[0]?.textContent || "").trim().slice(0, 120) };
      })()`);
      steps.push({ stepId: "type-query", note: "Typed 'empire' into the focused search field with real key events.", focus: await session.evaluate(READ_FOCUS), reading: results });

      // 4. Move into the results and activate one with the keyboard alone.
      await pressKey(session, "ArrowDown", { code: "ArrowDown", keyCode: 40 });
      await capture("arrow-into-results", "ArrowDown from the search field.");
      await pressKey(session, "Enter", { code: "Enter", keyCode: 13 });
      await delay(3_000);
      const afterSelect = await session.evaluate(`(() => ({
        inspectorPresent: document.querySelector('.inspector, [data-inspector], aside') !== null,
        detailsText: (document.querySelector('.inspector, [data-inspector], aside')?.textContent || "").trim().slice(0, 400),
        urlFeature: new URLSearchParams(window.location.search).get('feature'),
      }))()`);
      steps.push({ stepId: "activate-result", note: "Enter on the highlighted result, with no pointer event of any kind.", focus: await session.evaluate(READ_FOCUS), reading: afterSelect });

      // 5. Escape, and where focus lands afterwards.
      const beforeEscape = await session.evaluate(READ_FOCUS);
      await pressKey(session, "Escape", { code: "Escape", keyCode: 27 });
      await delay(1_500);
      const afterEscape = await session.evaluate(`(() => ({
        inspectorPresent: document.querySelector('.inspector, [data-inspector], aside') !== null,
        urlFeature: new URLSearchParams(window.location.search).get('feature'),
      }))()`);
      steps.push({ stepId: "escape-close", note: "Escape pressed while the details surface was open.", focusBefore: beforeEscape, focus: await session.evaluate(READ_FOCUS), reading: afterEscape });

      const keyboardStill = await still(session, "accessibility-keyboard-traversal");
      const focusEverLeftBody = steps.some((step) => step.focus && !step.focus.isBody);
      record.keyboard = {
        focusEmulation: {
          enabled: true,
          method: "Emulation.setFocusEmulationEnabled",
          disclosure: "Focus is EMULATED by the DevTools protocol, not taken from the operating system's window manager. It unblocks the traversal T009 could not run and it is not the same thing as a user's OS-level focus; every reading below inherits that bound.",
        },
        viewport,
        structure,
        steps,
        focusEverLeftBody,
        reachedSearch: steps.some((step) => step.stepId === "tab-to-search" && step.focus?.tagName === "input"),
        activatedWithoutPointer: afterSelect.urlFeature !== null,
        detailsOpenedFromKeyboard: afterSelect.inspectorPresent,
        escapeClosedDetails: afterEscape.inspectorPresent === false || afterEscape.urlFeature === null,
        focusRestoredAfterEscape: steps.at(-1)?.focus?.isBody === false,
        still: keyboardStill,
      };
    } finally {
      await closePage(port, session);
    }
  }

  // --- prefers-reduced-motion --------------------------------------------
  {
    // Two sessions, identical but for the emulated media feature, so the
    // difference is attributable to the preference and to nothing else.
    const read = async (reducedMotion) => {
      const session = await openFreshPage(port, previewBase, { viewport: VIEWPORT_1440P, focusEmulation: true, reducedMotion });
      try {
        await session.send("Page.navigate", { url: appUrl(previewBase, {}) });
        await waitForSixWaves(session, `accessibility-reduced-motion-${reducedMotion}`);
        await delay(3_000);
        const reading = await session.evaluate(`(() => ({
          matchesReduceQuery: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          stylesheetCarriesRule: [...document.styleSheets].some((sheet) => {
            try { return [...sheet.cssRules].some((rule) => (rule.conditionText || rule.media?.mediaText || "").includes("prefers-reduced-motion")); }
            catch { return false; }
          }),
        }))()`);
        const capture = await still(session, `accessibility-reduced-motion-${reducedMotion ? "reduce" : "no-preference"}`);
        return { ...reading, still: capture };
      } finally { await closePage(port, session); }
    };
    const noPreference = await read(false);
    const reduce = await read(true);
    record.reducedMotion = {
      finding: "respected-by-behaviour",
      noPreference,
      reduce,
      behaviouralBasis: "src/features/explorer/CesiumViewport.tsx cameraDuration() reads window.matchMedia('(prefers-reduced-motion: reduce)').matches and returns a 0.01 s flight instead of the requested seconds, and the same file reads the preference again when composing its camera transitions. Motion-dependent behaviour therefore EXISTS and is conditioned on the preference; this is not a case of there being no motion to reduce.",
      measured: {
        preferenceReachesThePage: reduce.matchesReduceQuery === true && noPreference.matchesReduceQuery === false,
        shippedStylesheetCarriesTheRule: reduce.stylesheetCarriesRule === true,
      },
      bound: "What is measured here is that the preference REACHES the running application and that the shipped stylesheet carries its rule, plus a still under each condition. The camera-flight shortening is read from the source that implements it rather than timed in the browser: a deterministic camera flight is not triggered by this journey, and timing one would have required a synthetic interaction that the record would then have had to explain. No claim is made that every animated surface was individually measured.",
      passed: reduce.matchesReduceQuery === true && noPreference.matchesReduceQuery === false && reduce.stylesheetCarriesRule === true,
    };
  }

  const full = {
    schemaVersion: "1.0",
    recordId: "goal-bounded-gaps-20260812:accessibility",
    task: "T029 (Issue #62)",
    criterion: 24,
    capturedAt: new Date().toISOString(),
    claim: "The two accessibility halves T009 recorded as 'not proven, blocked by the focus limitation': a real keyboard traversal with the DOM focus path recorded at every step, and a prefers-reduced-motion reading under emulated media.",
    servedBundle: identity,
    ...record,
    allPassed: Boolean(record.keyboard?.reachedSearch && record.keyboard?.detailsOpenedFromKeyboard && record.keyboard?.escapeClosedDetails && record.reducedMotion?.passed),
  };
  const checksum = await writeRecord(outPath, full);
  console.log(`accessibility: keyboard steps ${steps.length}, reduced-motion ${full.reducedMotion.passed ? "respected" : "NOT PROVEN"}; record ${checksum}`);
  return full;
}

// ---------------------------------------------------------------------------
// Criterion 30 — retained heap over a repeated path, and the measured peak
// ---------------------------------------------------------------------------

/**
 * The stop report asks for one thing and one smaller thing, and this runs both
 * in a single session because they are properties of the same load:
 *
 *  - `block835CanaryHeapVerdict` over a REPEATED deterministic camera path on
 *    the SIX-WAVE DEFAULT composition, with a forced collection between
 *    repeats. The in-app probe already implements exactly that shape — it flies
 *    the committed 8-pose path four times, calls `window.gc()` before each heap
 *    sample when the flag is present, and computes the first-half versus
 *    second-half verdict against a 0.1 noise band — so this drives the existing
 *    method rather than inventing a second one that would have no committed
 *    predecessor to be compared against.
 *  - The MEASURED peak concurrent exterior request count. The probe reports it
 *    from the aggregate request budget's own counter, never from the configured
 *    ceiling; `grep -rn "peakConcurren" data/` returned zero before this run.
 */
async function heapConcurrency(previewBase, port, outPath) {
  const identity = await servedBundleIdentity(previewBase, { expectProbeHarness: true });
  const session = await openFreshPage(port, previewBase, { viewport: VIEWPORT_1440P, focusEmulation: true });
  try {
    const url = appUrl(previewBase, { block835CanaryPerformance: "exploration" });
    session.events.length = 0;
    await session.send("Page.navigate", { url });
    await waitForSixWaves(session, "heap-concurrency");
    const viewport = await session.evaluate(READ_VIEWPORT);
    if (!viewport.documentHasFocus) fail("the page did not hold focus; the in-app probe refuses to start without it and would have timed out.");

    // THE HARNESS GATE, asked of the running page rather than of the bytes.
    // A production build compiles the probe out entirely, so its output element
    // never mounts; that is the difference a bundle grep cannot see.
    const probeMounted = await (async () => {
      const deadline = Date.now() + 60_000;
      for (;;) {
        if (Date.now() > deadline) return false;
        if (await session.evaluate("document.querySelector('[data-block835-canary-probe]') !== null")) return true;
        await delay(2_000);
      }
    })();
    if (!probeMounted) {
      fail("the served bundle mounted no Block 835 canary probe, so its harness was compiled out. Build with VITE_BLOCK835_PROBE=1 and preview THAT dist; a heap verdict cannot be taken from a bundle that carries no probe.");
    }

    const deadline = Date.now() + 900_000;
    let probe = null;
    for (;;) {
      if (Date.now() > deadline) fail(`the canary probe never completed (last status: ${JSON.stringify(probe?.status ?? null)}, reason: ${JSON.stringify(probe?.reason ?? null)}).`);
      await delay(3_000);
      probe = await session.evaluate(`(() => { const node = document.querySelector('[data-block835-canary-probe]'); if (!node) return null; try { return JSON.parse(node.textContent || "null"); } catch { return null; } })()`);
      if (probe && (probe.status === "complete" || probe.status === "invalid")) break;
    }
    if (probe.status !== "complete") fail(`the canary probe self-invalidated: ${probe.reason ?? "no reason given"}. A self-invalidated probe is not a measurement and is not being recorded as one.`);

    const perRelease = distinctGlbByRelease(session);
    const capture = await still(session, "heap-concurrency-sixwave");

    const heap = probe.heap;
    const runtime = probe.runtime;
    const repeats = probe.perRepeat ?? [];
    const record = {
      schemaVersion: "1.0",
      recordId: "goal-bounded-gaps-20260812:heap-concurrency",
      task: "T029 (Issue #62)",
      criterion: 30,
      capturedAt: new Date().toISOString(),
      claim: "The retained-heap conjunct of criterion 30, measured where it had never been measured: a REPEATED deterministic camera path over the SIX-WAVE DEFAULT composition, with a forced collection before every heap sample, plus the MEASURED peak concurrent request count from the same session.",
      servedBundle: identity,
      probeHarnessLive: true,
      harnessDisclosure: "The in-app canary probe is compiled out of an ordinary production build and this measurement therefore ran against a bundle built with VITE_BLOCK835_PROBE=1. The two builds differ by that flag alone; the probe observes the runtime and does not change which releases are pinned, which artifacts are eligible, or how a cell is loaded. The served-bundle gate above records the exact bytes measured.",
      focusEmulation: { enabled: true, method: "Emulation.setFocusEmulationEnabled", disclosure: "The probe refuses to start unless the page is focused and visible. Focus here is EMULATED by the DevTools protocol, not taken from the window manager." },
      viewport,
      composition: {
        activeWaves: PROMOTED_RELEASE_IDS,
        perReleaseDistinctGlbCount: perRelease,
        totalDistinctGlb: Object.values(perRelease).reduce((total, count) => total + count, 0),
      },
      method: {
        pathId: probe.pathId ?? null,
        poseCount: probe.poseCount ?? null,
        repeats: probe.repeats ?? repeats.length,
        settleMs: probe.settleMs ?? null,
        samplesPerPose: probe.samplesPerPose ?? null,
        forcedCollection: heap.forcedCollection,
        noiseBandRatio: heap.noiseBandRatio,
        statement: "block835CanaryHeapVerdict: first-half versus second-half MEDIAN of the per-repeat heap samples, judged against a 0.1 noise band. Each sample is taken after an explicit window.gc(), which is what makes surviving growth retention rather than collection lag.",
      },
      heapPerRepeat: repeats.map((entry) => ({ repeatIndex: entry.repeatIndex, jsHeapBytes: entry.jsHeapBytes, cacheEntries: entry.cacheEntries, cachedBytes: entry.cachedBytes, cacheEvictions: entry.cacheEvictions, peakConcurrentRequests: entry.peakConcurrentRequests })),
      heapVerdict: heap,
      monotonicGrowthDetected: heap.monotonicGrowthDetected,
      peakConcurrency: {
        measuredPeakConcurrentRequests: runtime.peakConcurrentRequests,
        configuredRuntimeCeiling: EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests,
        criterionCeiling: runtime.maxActiveRequests,
        withinConfiguredCeiling: runtime.peakConcurrentRequests !== null && runtime.peakConcurrentRequests <= EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests,
        withinCriterionCeiling: runtime.concurrencyPass,
        statement: "MEASURED from the aggregate request budget's own peak counter over the whole session, which includes the cold load. It is not the configured maxConcurrentRequests, which is what the four wave acceptance records carry.",
      },
      cache: {
        peakCachedBytes: runtime.peakCachedBytes,
        maxCachedBytes: runtime.maxCachedBytes,
        cachePass: runtime.cachePass,
      },
      /**
       * THE BOUND ON THIS VERDICT, stated beside it rather than left for a
       * reader to derive from the numbers.
       *
       * All six waves are ACTIVE — this is the promoted default composition —
       * but a camera path is not a tour of the city, and the Block 835 facade
       * path stays in one midtown block. So the RESIDENT working set is far
       * below the 512-entry cache ceiling, and the verdict below is about
       * retention across repeats of that path, not about behaviour at peak
       * residency. `cacheEvictions` is reported for the same reason: a run with
       * no evictions has not exercised the eviction path at all.
       */
      residency: {
        activeWaveCount: PROMOTED_RELEASE_IDS.length,
        residentCacheEntriesPerRepeat: repeats.map((entry) => entry.cacheEntries),
        cacheEvictionsPerRepeat: repeats.map((entry) => entry.cacheEvictions),
        maxCacheEntries: EXTERIOR_RUNTIME_BUDGETS.maxCacheEntries,
        distinctGlbStreamedThisSession: Object.values(perRelease).reduce((total, count) => total + count, 0),
        statement: "All six promoted waves were active and the verdict is over the six-wave DEFAULT composition. The camera path is the committed Block 835 facade path, which stays inside one midtown block, so the resident working set is a fraction of the 512-entry ceiling and no eviction was forced. This record therefore certifies retention ACROSS REPEATS OF A DETERMINISTIC PATH, which is the criterion's wording, and does NOT certify behaviour at peak residency or under eviction pressure.",
      },
      externalHosts: externalHostsOf(session),
      still: capture,
      disclosures: probe.disclosures ?? null,
      passed: heap.available === true
        && heap.forcedCollection === true
        && heap.sampleCount >= 3
        && heap.monotonicGrowthDetected === false
        && runtime.concurrencyPass === true
        && runtime.cachePass === true,
    };
    const checksum = await writeRecord(outPath, record);
    console.log(`heap-concurrency: growthRatio ${heap.growthRatio}, monotonic ${heap.monotonicGrowthDetected}, peak concurrency ${runtime.peakConcurrentRequests}; record ${checksum}`);
    return record;
  } finally {
    await closePage(port, session);
  }
}

// ---------------------------------------------------------------------------
// Criterion 8 — one mobile-emulated journey
// ---------------------------------------------------------------------------

/**
 * The legibility verdict, kept as a named function so the rule is one thing a
 * reader can check rather than a conjunction repeated per leg.
 *
 * A disclosure is legible when it has area, sits inside the viewport, is not
 * clamped to a single line, its full text fits the box it was given, and
 * nothing is painted over it.
 */
function legible(reading) {
  return Boolean(reading
    && reading.present
    && reading.hasArea
    && reading.insideViewport
    && reading.singleLineClamped === false
    && reading.textFitsItsBox
    && reading.occludedPoints === 0);
}

/**
 * What the still SHOWS, stated in the record rather than left to a reader who
 * opens the PNG. `notes` is written from the measurements, so a leg cannot pass
 * while its own visual state says something was covered.
 */
function visualState(overlays, legibility) {
  const notes = [];
  if (overlays.exteriorFallbackNoticePresent) {
    notes.push(`The 'Exterior streaming fallback' notice is on screen, covering ${(overlays.exteriorFallbackNoticeViewportFraction * 100).toFixed(1)}% of the viewport. It is the truthful tombstone statement for the 870 of 883 cells that ship no exterior geometry, and it is also occlusion; it is named here rather than cropped out of the still.`);
  }
  notes.push(`${overlays.overlayPanelCount} control-lane overlay panel(s) were painted at capture time.`);
  if (legibility) {
    notes.push(legibility.occludedPoints === 0
      ? `The lower-LOD disclosure was hit-tested at ${legibility.sampledPoints} points across its rendered box and nothing was painted over it; it rendered on ${legibility.renderedLineCount} wrapped line(s) at ${legibility.fontSizePx}, with its full text inside its box.`
      : `THE LOWER-LOD DISCLOSURE WAS OCCLUDED at ${legibility.occludedPoints} of ${legibility.sampledPoints} hit-tested points, by: ${legibility.occludedByElements.map((entry) => entry.element).join(", ")}.`);
    if (legibility.singleLineClamped) notes.push("THE DISCLOSURE IS CLAMPED TO ONE ELLIPSISED LINE by its computed white-space, so its text cannot be read whatever else is true.");
    if (!legibility.textFitsItsBox) notes.push(`THE DISCLOSURE OVERFLOWS ITS BOX (scroll ${legibility.scrollWidth}x${legibility.scrollHeight} against client ${legibility.clientWidth}x${legibility.clientHeight}).`);
  }
  return { ...overlays, notes };
}

async function mobileJourney(previewBase, port, outPath) {
  const identity = await servedBundleIdentity(previewBase);
  const legs = [];
  const session = await openFreshPage(port, previewBase, { viewport: VIEWPORT_MOBILE, userAgent: MOBILE_USER_AGENT, focusEmulation: true });
  try {
    // --- 1. navigation ----------------------------------------------------
    await session.send("Page.navigate", { url: appUrl(previewBase, {}) });
    const activeWaves = await waitForSixWaves(session, "mobile-journey");
    await delay(5_000);
    const viewport = await session.evaluate(READ_VIEWPORT);
    const lowerLod = await session.evaluate(`(() => {
      const node = document.querySelector('[data-mobile-lower-lod]');
      const region = document.querySelector('.map-region');
      return {
        disclosurePresent: node !== null,
        disclosureText: (node?.textContent || "").trim(),
        role: node?.getAttribute('role') ?? null,
        effectiveProfile: node?.getAttribute('data-mobile-effective-profile') ?? null,
        requestedProfile: node?.getAttribute('data-mobile-requested-profile') ?? null,
        clamped: node?.getAttribute('data-mobile-profile-clamped') ?? null,
        viewportClass: region?.getAttribute('data-viewport-class') ?? null,
        overlayDesktopRightInset: region?.getAttribute('data-overlay-desktop-right-inset') ?? null,
        overlayMobileBottomInset: region?.getAttribute('data-overlay-mobile-bottom-inset') ?? null,
      };
    })()`);
    const navLegibility = await session.evaluate(READ_DISCLOSURE_LEGIBILITY);
    const navOverlays = await session.evaluate(READ_OVERLAY_STATE);
    legs.push({
      legId: "navigation",
      claim: "A default mobile session navigates, streams all six promoted waves, reports a mobile viewport class, and RENDERS the explicit lower-LOD disclosure legibly — not merely carries it in the DOM.",
      viewport,
      activeWaves,
      lowerLod,
      disclosureLegibility: navLegibility,
      visualState: visualState(navOverlays, navLegibility),
      still: await still(session, "mobile-01-navigation"),
      passed: activeWaves.length === 6
        && lowerLod.disclosurePresent
        && lowerLod.viewportClass === "mobile"
        && lowerLod.effectiveProfile === "exploration"
        && legible(navLegibility),
    });

    // --- 2. search --------------------------------------------------------
    const searched = await session.evaluate(`(async () => {
      const input = document.querySelector('input[type=search], input[name=q], .search input, [data-search-input]');
      if (!input) return { found: false };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "empire");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((done) => setTimeout(done, 2500));
      const options = [...document.querySelectorAll('[role=option], .search-results li, [data-search-result]')];
      return { found: true, resultCount: options.length, firstResultText: (options[0]?.textContent || "").trim().slice(0, 160) };
    })()`);
    legs.push({
      legId: "search",
      claim: "Search remains available and returns results on the mobile layout.",
      reading: searched,
      visualState: visualState(await session.evaluate(READ_OVERLAY_STATE), null),
      still: await still(session, "mobile-02-search"),
      passed: searched.found === true && (searched.resultCount ?? 0) > 0,
    });

    // --- 3 & 4. picking / selection and details with provenance -----------
    // Selection is driven through the application's own deep-link seam rather
    // than a synthetic canvas tap: a tap dispatched at a guessed pixel would
    // prove nothing about WHICH feature was chosen, and the record would then
    // have to explain a coordinate. The deep link names the feature, so what is
    // being measured — that a mobile session resolves it, opens details, and
    // shows provenance — is the thing actually claimed. This bound is stated.
    await session.send("Page.navigate", { url: appUrl(previewBase, { feature: "doitt:778052" }) });
    await waitForSixWaves(session, "mobile-journey-details");
    await delay(6_000);
    const details = await session.evaluate(`(() => {
      const panel = document.querySelector('.inspector, [data-inspector], aside');
      const exterior = document.querySelector('.exterior-streaming-detail');
      const profile = document.querySelector('[data-exterior-profile]');
      return {
        panelPresent: panel !== null,
        panelText: (panel?.textContent || "").trim().slice(0, 600),
        exteriorSectionPresent: exterior !== null,
        exteriorText: (exterior?.textContent || "").trim().slice(0, 600),
        renderProfileAttribute: profile?.getAttribute('data-exterior-profile') ?? null,
        requestedProfileAttribute: profile?.getAttribute('data-exterior-requested-profile') ?? null,
        urlFeature: new URLSearchParams(window.location.search).get('feature'),
      };
    })()`);
    legs.push({
      legId: "selection-and-details",
      claim: "A mobile session resolves a named canonical feature, opens its details surface, and shows the exterior provenance section with the render profile the session is actually getting.",
      selectionBound: "Driven through the application's deep-link seam, not through a synthetic canvas tap. A tap at a guessed pixel would not identify WHICH feature was picked, so this leg claims deep-link selection and details, and does not claim an OS-level pointer pick. Native Cesium picking on the desktop class is evidenced separately by criterion 10.",
      reading: details,
      visualState: visualState(await session.evaluate(READ_OVERLAY_STATE), null),
      still: await still(session, "mobile-03-details"),
      passed: details.panelPresent && details.urlFeature === "doitt:778052" && details.renderProfileAttribute === "exploration",
    });

    // --- 5. deep link restore --------------------------------------------
    const deepLinkUrl = appUrl(previewBase, { feature: "doitt:778052", exteriorProfile: "inspection" });
    await session.send("Page.navigate", { url: deepLinkUrl });
    await waitForSixWaves(session, "mobile-journey-deeplink");
    await delay(6_000);
    const restored = await session.evaluate(`(() => {
      const node = document.querySelector('[data-mobile-lower-lod]');
      const profile = document.querySelector('[data-exterior-profile]');
      return {
        urlFeature: new URLSearchParams(window.location.search).get('feature'),
        urlExteriorProfile: new URLSearchParams(window.location.search).get('exteriorProfile'),
        effectiveProfile: node?.getAttribute('data-mobile-effective-profile') ?? null,
        requestedProfile: node?.getAttribute('data-mobile-requested-profile') ?? null,
        clamped: node?.getAttribute('data-mobile-profile-clamped') ?? null,
        renderProfileAttribute: profile?.getAttribute('data-exterior-profile') ?? null,
        renderProfileText: (profile?.textContent || "").trim().slice(0, 240),
      };
    })()`);
    const deepLinkLegibility = await session.evaluate(READ_DISCLOSURE_LEGIBILITY);
    const deepLinkOverlays = await session.evaluate(READ_OVERLAY_STATE);
    legs.push({
      legId: "deep-link-restore",
      claim: "A deep link naming both a feature and the inspection profile restores on mobile: the feature resolves, the URL keeps the REQUESTED profile so the link means the same thing on a desktop, and the clamp is disclosed LEGIBLY rather than applied silently.",
      reading: restored,
      disclosureLegibility: deepLinkLegibility,
      visualState: visualState(deepLinkOverlays, deepLinkLegibility),
      still: await still(session, "mobile-04-deep-link"),
      passed: restored.urlFeature === "doitt:778052"
        && restored.urlExteriorProfile === "inspection"
        && restored.effectiveProfile === "exploration"
        && restored.clamped === "true"
        && legible(deepLinkLegibility),
    });

    const externalHosts = externalHostsOf(session);
    const record = {
      schemaVersion: "1.0",
      recordId: "goal-bounded-gaps-20260812:mobile-journey",
      task: "T029 (Issue #62)",
      criterion: 8,
      capturedAt: new Date().toISOString(),
      claim: `One mobile-emulated journey over the newly wired mobile path: navigation, search, selection, details with provenance, and deep-link restore at ${VIEWPORT_MOBILE.width}x${VIEWPORT_MOBILE.height} dpr ${VIEWPORT_MOBILE.deviceScaleFactor}.`,
      emulationDisclosure: "EMULATED, not a device. Chrome's Emulation.setDeviceMetricsOverride with mobile: true, touch emulation enabled and an iOS user-agent string. It measures the application's response to a mobile viewport, touch capability and user agent. It does NOT measure a real phone's GPU, memory ceiling, thermal behaviour, browser engine or network, and no claim about any of those is made here.",
      parityDisclosure: "No desktop visual parity is claimed. The mobile path deliberately renders the COARSEST verified LOD, and the product says so on screen.",
      servedBundle: identity,
      viewport: VIEWPORT_MOBILE,
      userAgent: MOBILE_USER_AGENT,
      legs,
      externalHosts,
      allPassed: legs.every((leg) => leg.passed) && externalHosts.length === 0,
    };
    const checksum = await writeRecord(outPath, record);
    console.log(`mobile-journey: ${legs.filter((leg) => leg.passed).length}/${legs.length} legs passed; record ${checksum}`);
    return record;
  } finally {
    await closePage(port, session);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];
  const previewBase = argValue(argv, "--preview", "http://localhost:4176").replace(/\/$/u, "");
  const port = Number(argValue(argv, "--port", "9224"));
  const outputs = {
    "facade-1440p": join(recordRoot, "facade-1440p-evidence.json"),
    accessibility: join(recordRoot, "accessibility-evidence.json"),
    "heap-concurrency": join(recordRoot, "heap-concurrency-evidence.json"),
    "mobile-journey": join(recordRoot, "mobile-journey-evidence.json"),
  };
  const outPath = argValue(argv, "--out", outputs[subcommand]);
  switch (subcommand) {
    case "facade-1440p": await facade1440p(previewBase, port, outPath); return;
    case "accessibility": await accessibility(previewBase, port, outPath); return;
    case "heap-concurrency": await heapConcurrency(previewBase, port, outPath); return;
    case "mobile-journey": await mobileJourney(previewBase, port, outPath); return;
    default: fail(`unknown subcommand ${String(subcommand)}. Expected one of: ${Object.keys(outputs).join(", ")}.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error.message ?? error); process.exit(1); });
}
