#!/usr/bin/env node
/* global console, process, WebSocket, URL, fetch, setTimeout, Buffer, TextDecoder */
/**
 * PUBLIC-BUILD SMOKE for the cross-wave showcase candidate. LOCAL ONLY.
 *
 * WHAT THIS PROVES, against the production build served from this tree's own
 * `dist/`, in a real browser:
 *   (1) BUILD PARTITION. `dist/` contains no directory named `private`, no byte
 *       of any private reference package, and no undeclared private identifier
 *       in any showcase package it carries. `prune-private-partitions.mjs` is
 *       verified by its effect, not trusted by its exit code.
 *   (2) REQUEST CONTAINMENT. A DEFAULT six-wave session — no URL parameter, the
 *       session an ordinary visitor gets — issues requests that are EVERY ONE
 *       classified against the candidate's closed allowlist. A request that
 *       does not classify fails the run. External hosts must be zero.
 *   (3) UNREACHABILITY, POSITIVELY. The private paths the release graphs
 *       declare are fetched from the running server and must answer 404. This
 *       is the compensating proof for the audit's `declared-private-root-metadata`
 *       heading: the path is disclosed, and the byte is not there.
 *   (4) TRUTHFUL PROVENANCE. A picked building's details name the release, the
 *       asset checksum on screen, a GENERATED truth tier and an uncertainty
 *       statement — and claim no real-world facade accuracy.
 *
 * WHAT IT DOES NOT PROVE. It is not a deployment and does not make one: the
 * server is a local `vite preview` on a port the operator owns, and every wave's
 * instrument excludes public internet deployment. It measures no frame time and
 * no memory — that is each wave's own acceptance record. It does not prove the
 * six waves are geographically correct, only that what streams is theirs.
 *
 * PRECONDITIONS, each of which ABORTS rather than being recorded as a caveat:
 *   pnpm build
 *   npx vite preview --port 4177 --strictPort
 *   Chrome with --remote-debugging-port=9225
 *
 * Usage:
 *   node scripts/public-showcase-smoke-cli.mjs [--preview http://localhost:4177] [--port 9225] [--out <path>]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes, sha256HexSync } from "../src/domain/deterministic-hash.ts";
import { serializeExteriorWaveArtifact } from "../src/release/exterior-wave-subset.ts";
import {
  PUBLIC_SHOWCASE_ASSEMBLY_POSTURE,
  PUBLIC_SHOWCASE_CANDIDATE_ID,
  PUBLIC_SHOWCASE_DIGEST_SHA256,
  PUBLIC_SHOWCASE_SCHEMA_VERSION,
  PUBLIC_SHOWCASE_STANDING_REFUSALS,
  PUBLIC_SHOWCASE_BASE_PACKAGES,
  PUBLIC_SHOWCASE_WAVES,
  classifyShowcaseRequestPath,
  computePublicShowcaseDigest,
} from "../src/release/public-showcase-manifest.ts";
import { restrictedIdentifiersFor, scanArtifactForRestricted, scanBytesForRestricted, walkFiles } from "./public-showcase-audit-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = join(repositoryRoot, "dist");
const capturesRoot = join(repositoryRoot, "artifacts", "public-showcase-20260812", "journeys");
const defaultOutPath = join(repositoryRoot, "data", "public-showcase-20260812", "smoke-evidence.json");

const BASE_RELEASE_ID = "manhattan-citywide-20260804";
const PROMOTED_RELEASE_IDS = PUBLIC_SHOWCASE_WAVES.map((wave) => wave.publicReleaseId);
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const READY_TIMEOUT_MS = 180_000;
const STILL_CHROME_HIDE_CSS = ".exploration-notice, .runtime-note, nav, header, footer { display: none !important; }";
/**
 * The pick target: a Northern-Manhattan building the wave materializes
 * (`status: "available"` in the committed cell release for cell w05-000727).
 * Chosen because T022's own journey already proved it selectable, so a failure
 * here is a showcase failure rather than a newly-invented-selector failure.
 */
const PICK_BUILDING_ID = "doitt:342401";
const PICK_POSE = { lon: -73.94550, lat: 40.80940, height: 150, heading: 270, pitch: -4, roll: 0 };

/** A Midtown skyline pose: six waves are active, and this is where they overlap on screen. */
const SHOWCASE_POSE = { lon: -73.98500, lat: 40.74800, height: 900, heading: 20, pitch: -22, roll: 0 };

function fail(message) { throw new Error(`public-showcase-smoke: ${message}`); }

function argValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

/* ------------------------------------------------------------------ (1) build */

/**
 * Audit the BUILD OUTPUT, not the source tree. `public/data/**` still holds four
 * private reference packages; the question this answers is whether any of them
 * survived into the browser-reachable build.
 */
export function auditDistPartition(distDir) {
  if (!existsSync(join(distDir, "index.html"))) fail(`there is no ${distDir}/index.html. Run \`pnpm build\` before capturing, so the record can state WHICH build was measured.`);
  const dataDir = join(distDir, "data");
  const privateDirectories = [];
  const visit = (directory) => {
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(directory, entry.name);
      if (entry.name === "private") { privateDirectories.push(full.slice(distDir.length + 1)); continue; }
      visit(full);
    }
  };
  if (existsSync(dataDir)) visit(dataDir);

  const packages = [];
  let undeclared = 0;
  for (const wave of PUBLIC_SHOWCASE_WAVES) {
    const packageRoot = join(dataDir, wave.packageId);
    if (!existsSync(packageRoot)) fail(`the build output carries no ${wave.packageId}; a showcase candidate that cannot serve an enumerated wave is not a candidate.`);
    const graph = JSON.parse(readFileSync(join(packageRoot, "release-graph.json"), "utf8"));
    const identifiers = restrictedIdentifiersFor(graph, wave);
    const files = [...["index.json", "release-graph.json", "assemblies.json"].map((name) => join(packageRoot, name)), ...walkFiles(join(packageRoot, "public"))];
    const findings = [];
    for (const path of files) {
      const relativeRef = path.slice(packageRoot.length + 1).split("\\").join("/");
      const scanned = relativeRef.endsWith(".json")
        ? scanArtifactForRestricted(JSON.parse(readFileSync(path, "utf8")), identifiers)
        : scanBytesForRestricted(readFileSync(path), identifiers);
      for (const finding of scanned) if (finding.classification === "undeclared-private-reference") findings.push({ relativeRef, ...finding });
    }
    undeclared += findings.length;
    packages.push({ packageId: wave.packageId, scannedFiles: files.length, undeclaredPrivateReferences: findings });
  }

  // The declared private paths must not exist as bytes in the build output.
  const materializedPrivatePaths = [];
  for (const wave of PUBLIC_SHOWCASE_WAVES) {
    const graph = JSON.parse(readFileSync(join(dataDir, wave.packageId, "release-graph.json"), "utf8"));
    const privateRoot = graph.roots.find((root) => root.audience === "private");
    for (const artifact of privateRoot.artifacts ?? []) {
      const candidate = join(dataDir, wave.packageId, artifact.relativeRef);
      if (existsSync(candidate)) materializedPrivatePaths.push(`${wave.packageId}/${artifact.relativeRef}`);
    }
  }

  const totalBytes = walkFiles(dataDir).reduce((total, path) => total + statSync(path).size, 0);
  return {
    distDir,
    privateDirectories,
    packages,
    materializedPrivatePaths,
    dataByteTotal: totalBytes,
    passed: privateDirectories.length === 0 && undeclared === 0 && materializedPrivatePaths.length === 0,
    statement:
      "Measured on the build output after `pnpm build` ran `prune-private-partitions.mjs`. `privateDirectories` empty is the pruning proven by its effect; `undeclaredPrivateReferences` empty is the same structural scan the differential audit runs, re-run on the bytes a browser can actually fetch.",
  };
}

/* ------------------------------------------------------------- served bundle */

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
  const localIndexChecksum = sha256HexSync(await readFile(join(distRoot, "index.html"), "utf8"));
  if (localIndexChecksum !== indexChecksum) {
    fail(`the preview at ${previewBase} is serving an index.html (${indexChecksum}) that is not this repository's build (${localIndexChecksum}). This is the stale-server failure: start a preview on a port you own, from this tree's dist.`);
  }
  const entryText = new TextDecoder().decode(entryBytes);
  const missing = PROMOTED_RELEASE_IDS.filter((releaseId) => !entryText.includes(releaseId));
  if (missing.length > 0) fail(`the served entry script names none of ${missing.join(", ")}, so it predates the six-wave composition this smoke claims to measure.`);
  return {
    previewBase,
    indexHtmlChecksumSha256: indexChecksum,
    localDistIndexHtmlChecksumSha256: localIndexChecksum,
    matchesLocalDist: true,
    entryScriptPath: entryPath,
    entryScriptByteSize: entryBytes.byteLength,
    entryScriptChecksumSha256: sha256HexBytes(entryBytes),
    entryScriptNamesEveryPromotedRelease: true,
    statement: "Measured before any capture. The served index.html is byte-identical to this repository's dist/index.html and the served entry script names all six promoted releases, so every reading below is from THIS build.",
  };
}

/* ---------------------------------------------------------------------- CDP */

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

/**
 * The DEFAULT session URL. It sets a real base release and a pose and NOTHING
 * about exteriors: the six-wave composition must be what an ordinary visitor
 * gets, not something a parameter turns on.
 */
function appUrl(previewBase, { pose = null } = {}) {
  const url = new URL(previewBase);
  url.pathname = "/";
  url.searchParams.set("data", BASE_RELEASE_ID);
  url.searchParams.set("release", BASE_RELEASE_ID);
  if (pose) {
    url.searchParams.set("view", "explore");
    for (const [key, value] of Object.entries(pose)) url.searchParams.set(key, value.toFixed(6));
  }
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

/**
 * THE CONTAINMENT AUDIT.
 *
 * Every URL the page ATTEMPTED is classified against the candidate's closed
 * allowlist — not every URL it successfully received.
 *
 * That distinction is the correction review forced. An earlier cut built the
 * observed set from `Network.responseReceived` alone, so a request that was
 * blocked, DNS-failed, aborted, or refused by CORS never appeared in it at all.
 * The claim attached to that set was "no request left the candidate", which is
 * exactly the claim a *failed* off-origin request would have falsified while
 * being invisible to the measurement. A blocked request to an external host is
 * still the page trying to leave.
 *
 * So `Network.requestWillBeSent` is the spine of the set, `responseReceived`
 * marks which of those completed, and `loadingFailed` is accounted separately
 * rather than silently dropped.
 */
function auditRequests(session, previewBase) {
  const origin = new URL(previewBase).origin;
  const attempted = session.events.filter((event) => event.method === "Network.requestWillBeSent").map((event) => event.params.request?.url).filter((url) => typeof url === "string");
  const received = session.events.filter((event) => event.method === "Network.responseReceived").map((event) => event.params.response.url);
  const failedIds = new Set(session.events.filter((event) => event.method === "Network.loadingFailed").map((event) => event.params.requestId));
  const failedUrls = [...new Set(session.events
    .filter((event) => event.method === "Network.requestWillBeSent" && failedIds.has(event.params.requestId))
    .map((event) => event.params.request?.url)
    .filter((url) => typeof url === "string"))].sort();

  // The union: attempted ∪ received. `received` is folded in because a redirect
  // or a service-worker response can surface a URL that no requestWillBeSent
  // named, and this set must never be smaller than what actually happened.
  const observed = [...new Set([...attempted, ...received])].sort();

  // Exact hostname match. `startsWith("localhost")` would have accepted
  // `localhost.evil.example`, which is precisely the shape of an exfiltration
  // host chosen to look local.
  const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const externalHosts = [...new Set(observed
    .map((url) => { try { return new URL(url).hostname; } catch { return ""; } })
    .filter((hostname) => hostname !== "" && !LOCAL_HOSTNAMES.has(hostname)))].sort();

  const perWave = Object.fromEntries(PUBLIC_SHOWCASE_WAVES.map((wave) => [wave.publicReleaseId, { responses: 0, distinctArtifacts: 0, glbResponses: 0 }]));
  const refusals = [];
  const distinctByWave = new Map(PUBLIC_SHOWCASE_WAVES.map((wave) => [wave.publicReleaseId, new Set()]));
  const perBase = Object.fromEntries(PUBLIC_SHOWCASE_BASE_PACKAGES.map((entry) => [entry.packageId, 0]));
  let appShell = 0;
  for (const url of observed) {
    let path;
    try { path = new URL(url).pathname; } catch { refusals.push({ url, reason: "unparseable URL" }); continue; }
    if (!url.startsWith(origin)) { refusals.push({ url, reason: `off-origin request; the candidate is local-only and its origin is ${origin}` }); continue; }
    try {
      const classified = classifyShowcaseRequestPath(path);
      if (classified.kind === "app-shell") { appShell += 1; continue; }
      if (classified.kind === "base-payload") { perBase[classified.base.packageId] += 1; continue; }
      const entry = perWave[classified.wave.publicReleaseId];
      entry.responses += 1;
      if (path.endsWith(".glb")) entry.glbResponses += 1;
      distinctByWave.get(classified.wave.publicReleaseId).add(path);
    } catch (error) {
      refusals.push({ url, reason: error.message });
    }
  }
  for (const [releaseId, set] of distinctByWave) perWave[releaseId].distinctArtifacts = set.size;

  // Two DIFFERENT properties, deliberately not one flag. A refusal is a URL that
  // was examined and rejected: it means nothing was dropped, and it does NOT
  // mean the request was allowed. Folding refusals into an "accounted for"
  // count would let a leaking session report a tidy true.
  const classifiedTotal = appShell
    + Object.values(perWave).reduce((total, entry) => total + entry.responses, 0)
    + Object.values(perBase).reduce((total, count) => total + count, 0);
  const noRequestDropped = classifiedTotal + refusals.length === observed.length;
  const everyRequestClassified = refusals.length === 0 && classifiedTotal === observed.length;

  return {
    observedDistinctUrls: observed.length,
    attemptedDistinctUrls: [...new Set(attempted)].length,
    receivedDistinctUrls: [...new Set(received)].length,
    failedRequestUrls: failedUrls,
    appShellResponses: appShell,
    perWave,
    perBasePackage: perBase,
    externalHosts,
    refusals,
    classifiedTotal,
    /** Nothing was dropped from the accounting: classified + refused = observed. */
    noRequestDropped,
    /** Nothing was refused, and everything observed classified inside the candidate. */
    everyRequestClassified,
    passed: refusals.length === 0 && externalHosts.length === 0 && noRequestDropped && everyRequestClassified,
  };
}

/* ------------------------------------------------------------------ journeys */

async function journeySixWaveDefault(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: SHOWCASE_POSE });
    await session.send("Page.navigate", { url });
    const waves = await waitFor(
      session,
      (value) => PROMOTED_RELEASE_IDS.every((releaseId) => value.some((wave) => wave.releaseId === releaseId && wave.origin !== null)),
      READ_WAVES,
      "six-wave-default",
    );
    await new Promise((done) => { setTimeout(done, 4_000); });
    const network = auditRequests(session, previewBase);
    const streamingWaves = PROMOTED_RELEASE_IDS.filter((releaseId) => waves.some((wave) => wave.releaseId === releaseId));
    return {
      journeyId: "six-wave-default",
      claim: "A DEFAULT session — no exterior parameter of any kind — resolves all six promoted waves, and every URL the page ATTEMPTED (Network.requestWillBeSent, unioned with responses, so a blocked or failed request cannot hide) classifies against the showcase candidate's closed allowlist. No request was directed outside the candidate, and no hostname outside the local preview was addressed — including by requests that never completed.",
      url,
      urlDeclaresNoExteriorParameter: !url.includes("exterior"),
      waves: streamingWaves,
      network,
      passed: streamingWaves.length === 6 && network.passed && !url.includes("exterior"),
      still: await still(session, "six-wave-default"),
    };
  } finally { await closePage(port, session); }
}

/**
 * The positive unreachability proof.
 *
 * The first draft of this journey asserted the private paths must answer 404,
 * and every one of them answered 200 — which looked, for a moment, exactly like
 * the leak this whole task exists to rule out. It was not. `vite preview` is an
 * SPA server: an unmatched path falls through to `index.html` with status 200,
 * so the status code carries no information about whether a private byte exists.
 *
 * The assertion is therefore about CONTENT, which is the thing that actually
 * matters and is strictly stronger than a status check: for every declared
 * private path, the bytes the server returns must not be that artifact. Each
 * response is hashed in the page and classified against two known digests — the
 * SPA fallback (this build's own `index.html`) and the private artifact's own
 * declared checksum. A response matching the latter is the leak, under any
 * status code whatsoever.
 */
async function journeyPrivatePathsUnreachable(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    await session.send("Page.navigate", { url: appUrl(previewBase) });
    await new Promise((done) => { setTimeout(done, 2_000); });
    const probes = [];
    for (const wave of PUBLIC_SHOWCASE_WAVES) {
      const graph = JSON.parse(readFileSync(join(distRoot, "data", wave.packageId, "release-graph.json"), "utf8"));
      const privateRoot = graph.roots.find((root) => root.audience === "private");
      for (const artifact of privateRoot.artifacts ?? []) {
        probes.push({
          kind: "declared-private-root-artifact",
          path: `/data/${wave.packageId}/${artifact.relativeRef}`,
          declaredPrivateChecksumSha256: artifact.checksumSha256,
          declaredPrivateByteSize: artifact.byteSize,
        });
      }
    }
    // The four private reference packages that `prune-private-partitions.mjs`
    // removes. Their tileset is the single most valuable private byte in the
    // tree, so it is probed by name rather than by pattern.
    for (const packageId of ["manhattan-esb-block-reference-20260810", "manhattan-esb-block-reference-20260811", "manhattan-esb-block-reference-20260811-v3", "manhattan-esb-block-reference-20260811-v3e"]) {
      probes.push({ kind: "pruned-private-reference-package", path: `/data/${packageId}/private/tiles/tileset.json`, declaredPrivateChecksumSha256: null, declaredPrivateByteSize: null });
    }
    const fallbackChecksum = sha256HexBytes(new Uint8Array(readFileSync(join(distRoot, "index.html"))));
    const results = await session.evaluate(`(async () => {
      const probes = ${JSON.stringify(probes.map((probe) => ({ path: probe.path, declared: probe.declaredPrivateChecksumSha256 })))};
      const fallback = ${JSON.stringify(fallbackChecksum)};
      const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const out = [];
      for (const probe of probes) {
        try {
          const response = await fetch(probe.path, { cache: "no-store" });
          const bytes = await response.arrayBuffer();
          const checksum = hex(await crypto.subtle.digest("SHA-256", bytes));
          out.push({
            path: probe.path,
            status: response.status,
            contentType: response.headers.get("content-type"),
            byteSize: bytes.byteLength,
            bodyChecksumSha256: checksum,
            bodyIsSpaFallback: checksum === fallback,
            bodyIsDeclaredPrivateArtifact: probe.declared !== null && checksum === probe.declared,
          });
        } catch (error) { out.push({ path: probe.path, status: -1, byteSize: 0, error: String(error), bodyIsSpaFallback: false, bodyIsDeclaredPrivateArtifact: false }); }
      }
      return out;
    })()`);
    const merged = probes.map((probe, index) => ({ ...probe, ...results[index] }));
    const servedPrivateBytes = merged.filter((entry) => entry.bodyIsDeclaredPrivateArtifact);
    // Anything that is neither a refusal nor the SPA fallback is unexplained,
    // and an unexplained 2xx on a private path is not something to wave past.
    const unexplained = merged.filter((entry) => entry.status >= 200 && entry.status < 300 && !entry.bodyIsSpaFallback);
    return {
      journeyId: "private-paths-unreachable",
      claim: "Every private path the release graphs DECLARE, and the tileset of every private reference package the build prunes, is fetched from the running server by the page itself. None of them returns the private artifact's bytes. Because `vite preview` answers unmatched paths with the SPA shell at status 200, the assertion is on the response's SHA-256 — matched against this build's index.html and against the private artifact's own declared checksum — rather than on the status code, which here carries no information.",
      spaFallbackChecksumSha256: fallbackChecksum,
      probes: merged,
      probeCount: probes.length,
      servedPrivateBytes,
      unexplainedResponses: unexplained,
      passed: servedPrivateBytes.length === 0 && unexplained.length === 0 && merged.length === probes.length,
    };
  } finally { await closePage(port, session); }
}

async function journeyPickProvenance(port, previewBase) {
  const session = await openFreshPage(port);
  try {
    const url = appUrl(previewBase, { pose: PICK_POSE });
    await session.send("Page.navigate", { url });
    await waitFor(
      session,
      (value) => PROMOTED_RELEASE_IDS.every((releaseId) => value.some((wave) => wave.releaseId === releaseId && wave.origin !== null)),
      READ_WAVES,
      "pick-provenance",
    );
    // Select through the app's OWN search, so the pick travels the path a user's
    // pick travels rather than a path only this script can reach.
    //
    // The query is re-typed on every poll rather than typed once and waited on.
    // The search index lives in the citywide base's search shards, which are
    // still streaming when the exterior waves have settled; a single `input`
    // event dispatched before the index is warm produces an empty result list
    // and NOTHING ever re-triggers the search, so the wait would time out with
    // the query sitting in the box. Re-dispatching is what makes this wait
    // actually a wait.
    const TYPE_QUERY = `(() => {
      const open = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Open details');
      if (open) open.click();
      const search = document.querySelector('input[type="search"], input[placeholder*="Search"]');
      if (!search) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(search, ${JSON.stringify(PICK_BUILDING_ID)});
      search.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`;
    const READ_OPTIONS = `[...document.querySelectorAll('[role="option"], .search-result, li button')].map((node) => (node.textContent || '').trim().slice(0, 120))`;
    const searchDeadline = Date.now() + READY_TIMEOUT_MS;
    let searchResults = [];
    for (;;) {
      if (Date.now() > searchDeadline) fail(`pick-provenance search for ${PICK_BUILDING_ID} never returned a result.`);
      await session.evaluate(TYPE_QUERY);
      await new Promise((done) => { setTimeout(done, 1_500); });
      searchResults = await session.evaluate(READ_OPTIONS).catch(() => []);
      if (Array.isArray(searchResults) && searchResults.length > 0) break;
    }
    await session.evaluate(`(() => {
      const options = [...document.querySelectorAll('[role="option"], .search-result, li button')];
      if (options[0]) options[0].click();
      return true;
    })()`);
    await new Promise((done) => { setTimeout(done, 3_000); });
    const detail = await session.evaluate(`(() => {
      // innerText, not textContent, and NOT truncated to a few thousand
      // characters: the rendered attribution sits about 9,000 characters into
      // the page, and an earlier cut of this journey reported "no attribution"
      // when what it had actually done was stop reading before reaching it.
      const pageText = (document.body.innerText || '').trim();
      const attributionLine = [...document.querySelectorAll('*')]
        .filter((node) => node.children.length === 0 && /Office of Technology|jh45-qr5r/iu.test(node.textContent || ''))
        .map((node) => (node.textContent || '').trim())
        .slice(0, 4);
      const section = document.querySelector('.exterior-streaming-detail');
      if (!section) return { badge: null, badgeOrigin: null, rows: {}, rowsText: "", text: "", pageText, attributionLine, sectionPresent: false };
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
        // Row-joined text. section.textContent runs the rows together with no
        // separator, which destroys the word boundary a checksum test needs.
        rowsText: Object.entries(rows).map(([term, value]) => term + ': ' + value).join('\\n'),
        text: (section.textContent || '').trim().slice(0, 4000),
        pageText,
        attributionLine,
        sectionPresent: true,
      };
    })()`);
    const text = detail?.text ?? "";
    const rowsText = detail?.rowsText ?? "";
    const pageText = detail?.pageText ?? "";
    const namesAWave = PROMOTED_RELEASE_IDS.filter((releaseId) => text.includes(releaseId) || pageText.includes(releaseId));
    const carriesChecksum = /[0-9a-f]{64}/u.test(rowsText);
    const namesGeneratedTier = /generated/iu.test(text);
    const carriesUncertainty = /uncertain|does not claim|designed|tolerance/iu.test(text);
    // Matched on what the application actually renders. It names the agency in
    // full and links the source dataset; it does not render the short form
    // "NYC OTI", so asserting that string would be asserting a fiction.
    const namesAttribution = /Office of Technology|jh45-qr5r/iu.test(pageText);
    // The negative claim: nothing on screen may assert real-world facade truth.
    const claimsRealFacadeAccuracy = /survey-grade|photograph of the real|actual facade material|real facade/iu.test(pageText);
    return {
      journeyId: "pick-provenance",
      claim: "A building picked through the application's own search in a DEFAULT six-wave session opens an exterior details panel that names the release the geometry came from, carries a checksum, states a GENERATED truth tier, carries an uncertainty statement, and attributes the source. Nothing on the page asserts real-world facade accuracy.",
      url,
      buildingId: PICK_BUILDING_ID,
      searchResults,
      detailRows: detail?.rows ?? {},
      attributionLine: detail?.attributionLine ?? [],
      pageTextLength: pageText.length,
      badge: detail?.badge ?? null,
      badgeOrigin: detail?.badgeOrigin ?? null,
      readings: { namesAWave, carriesChecksum, namesGeneratedTier, carriesUncertainty, namesAttribution, claimsRealFacadeAccuracy },
      exteriorDetailSectionPresent: detail?.sectionPresent === true,
      passed:
        detail?.sectionPresent === true &&
        namesAWave.length > 0 &&
        carriesChecksum &&
        namesGeneratedTier &&
        carriesUncertainty &&
        namesAttribution &&
        !claimsRealFacadeAccuracy,
      still: await still(session, "pick-provenance"),
    };
  } finally { await closePage(port, session); }
}

/* ---------------------------------------------------------------------- main */

async function main() {
  const argv = process.argv.slice(2);
  const previewBase = argValue(argv, "--preview", "http://localhost:4177").replace(/\/$/u, "");
  const port = Number(argValue(argv, "--port", "9225"));
  const outPath = resolve(argValue(argv, "--out", defaultOutPath));

  const digest = computePublicShowcaseDigest();
  if (digest !== PUBLIC_SHOWCASE_DIGEST_SHA256) fail(`the showcase manifest digest is ${digest} but the module pins ${PUBLIC_SHOWCASE_DIGEST_SHA256}.`);

  const buildPartition = auditDistPartition(distRoot);
  if (!buildPartition.passed) fail(`the build output failed the partition audit: ${JSON.stringify({ privateDirectories: buildPartition.privateDirectories, materialized: buildPartition.materializedPrivatePaths }).slice(0, 500)}`);

  const servedBundle = await servedBundleIdentity(previewBase);
  const journeys = [
    await journeySixWaveDefault(port, previewBase),
    await journeyPrivatePathsUnreachable(port, previewBase),
    await journeyPickProvenance(port, previewBase),
  ];

  const evidence = {
    schemaVersion: PUBLIC_SHOWCASE_SCHEMA_VERSION,
    candidateId: PUBLIC_SHOWCASE_CANDIDATE_ID,
    manifestDigestSha256: digest,
    note:
      "Local public-build smoke for the cross-wave showcase candidate. It measures a production build served by a local `vite preview` on a port the operator owns, driven through CDP in a real Chrome. It is NOT a deployment and makes none: every wave's instrument excludes public (internet) deployment, and this record asserts no right to publish. Readings are computed from what the browser did, never asserted: `passed` on each journey is an expression over the readings beside it.",
    assemblyPosture: PUBLIC_SHOWCASE_ASSEMBLY_POSTURE,
    standingRefusals: PUBLIC_SHOWCASE_STANDING_REFUSALS,
    servedBundle,
    buildPartition,
    capturedWith: { viewport: VIEWPORT, previewBase, remoteDebuggingPort: port, promotedReleaseIds: PROMOTED_RELEASE_IDS, pose: SHOWCASE_POSE },
    coveredByTestsInstead: [
      "That the candidate refuses a seventh root, a private root and an unenumerated package BY NAME is proven in src/release/public-showcase-manifest.test.ts, not by a browser.",
      "That the differential audit detects a planted private reference is proven in scripts/public-showcase-audit.test.mjs against a synthetic package, because the six real waves do not leak and a passing audit over them proves only that they do not.",
      "Frame time, heap and cache residency are NOT measured here; each wave's own acceptance-evidence.json holds those, and the six-wave measurement is data/northern-manhattan-20260812-p1/acceptance-evidence.json.",
    ],
    journeys,
    allPassed: journeys.every((journey) => journey.passed) && buildPartition.passed,
  };

  await mkdir(dirname(outPath), { recursive: true });
  const text = serializeExteriorWaveArtifact(evidence);
  await writeFile(outPath, text, "utf8");
  console.log(JSON.stringify({
    ok: evidence.allPassed,
    outPath,
    outChecksumSha256: sha256HexSync(text),
    buildPartitionPassed: buildPartition.passed,
    journeys: journeys.map((journey) => ({ journeyId: journey.journeyId, passed: journey.passed })),
  }, null, 2));
  if (!evidence.allPassed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
