/* global process, console, Buffer */
/**
 * T007's far-tier-aware capture harness — the instrument T005 named as its
 * follow-up N11 and nobody has written until now.
 *
 * WHY IT HAD TO BE NEW. The three committed acceptance harnesses
 * (exterior-serving-evidence, exterior-serving-journeys, citywide-heap-repeat)
 * predate the far tier and are blind to it: none reads a single `data-far-tier-*`
 * attribute. A three-tier campaign run on far-tier-blind instruments would
 * report a two-tier scene and call it three, so the far-tier reads are new code
 * — confined to `scripts/`, because T007 may not touch `src/`.
 *
 * WHAT IT REFUSES TO DO. It writes only inside T007's own record root. The
 * acceptance evidence from 20260817 is frozen, and a harness that can overwrite
 * it is one mistyped path away from destroying the baseline this campaign is
 * measured against. `guardedWrite` fails closed on every path outside the root,
 * and a test proves it.
 *
 * WHAT IT WILL NOT LET A CAPTURE CLAIM. Two lessons are wired in rather than
 * remembered:
 *   - FETCH IS NOT DRAW (T006). A wire-level fetch of a coarse GLB does not mean
 *     the coarse GLB was rasterized where the reading was taken, so every
 *     appearance-dependent reading carries a pick result AND a draw-composition
 *     classification.
 *   - A FROZEN PUBLISH LOOKS LIKE A SETTLED SCENE (T005). `data-far-tier-publish-seq`
 *     is monotonic; a reading whose sequence never advanced is a stalled
 *     instrument, not a quiet one, and is recorded as NOT-CAPTURED.
 *
 * Usage:
 *   node scripts/three-tier-capture-cli.mjs probe-source          # the in-page expressions, for `orca eval`
 *   node scripts/three-tier-capture-cli.mjs frame-source          # the rAF sampler
 *   node scripts/three-tier-capture-cli.mjs record --name <n> --in <json> [--still <png>]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RECORD_ID = "three-tier-acceptance-20260821";
export const RECORD_ROOT = join(repositoryRoot, "data", RECORD_ID);
const TOOL = "three-tier-capture";
const fail = (message) => { console.error(`${TOOL}: ${message}`); process.exit(1); };
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/**
 * Roots this harness must never write into. Named individually as well as
 * covered by the root check, so the intent survives a refactor of the check.
 */
export const FROZEN_EVIDENCE_ROOTS = [
  "data/exterior-acceptance-20260817",
  "data/exterior-completion-acceptance-20260817",
  "data/citywide-goal-acceptance-20260815",
  "data/far-tier-hlod-promotion-20260819",
  "data/far-tier-hlod-mass-20260819",
  "data/far-tier-hlod-runtime-20260818",
];

/**
 * FAIL CLOSED. A write is permitted only strictly inside T007's record root.
 * Everything else — a frozen acceptance root, a source file, a path that escapes
 * via `..` — is refused before any byte is written.
 */
export function guardedWrite(path, text, root = RECORD_ROOT) {
  const target = resolve(path);
  const rel = relative(resolve(root), target);
  if (rel === "" || rel.startsWith("..") || resolve(root, rel) !== target) {
    fail(`REFUSING to write outside the T007 record root.\n  target: ${target}\n  root:   ${resolve(root)}\n  This harness may not write frozen acceptance evidence or source.`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  writeFileSync(`${target.replace(/\.json$/u, "")}.sha256`, `${sha256(Buffer.from(text))}  ${target.split("/").pop()}\n`);
  return sha256(Buffer.from(text));
}

/**
 * THE TIER-COMPOSITION PROBE, as a committed expression rather than something
 * typed at the console during a campaign.
 *
 * It reads what is DRAWN and what the runtime SAYS, together, because the two
 * disagreeing is the finding T005 and T006 both turned on.
 */
export const TIER_STATE_PROBE = `(() => {
  const viewport = document.querySelector('.viewport');
  const d = viewport ? viewport.dataset : {};
  const farTier = {};
  for (const key of Object.keys(d)) if (key.startsWith('farTier')) farTier[key] = d[key];
  const statusEl = document.querySelector('[data-far-tier-declared]');
  const status = {};
  if (statusEl) for (const key of Object.keys(statusEl.dataset)) if (key.startsWith('farTier')) status[key] = statusEl.dataset[key];
  let scheduler = null;
  const probe = document.querySelector('[data-exterior-scheduler-probe]');
  if (probe) { try { scheduler = JSON.parse(probe.textContent || ''); } catch (error) { scheduler = { parseError: String(error) }; } }
  const canvas = document.querySelector('.viewport canvas');
  const rect = canvas ? canvas.getBoundingClientRect() : null;
  const resources = performance.getEntriesByType('resource');
  const name = (entry) => entry.name.split('/').pop().split('?')[0];
  const glb = resources.filter((entry) => name(entry).endsWith('.glb')).map(name);
  return JSON.stringify({
    farTierViewport: farTier,
    farTierStatus: status,
    schedulerDecision: scheduler && scheduler.decision ? {
      residentCount: scheduler.decision.residentCount,
      visibleCount: scheduler.decision.visibleCount,
      deferredCount: scheduler.decision.deferredCount,
      retainedCount: scheduler.decision.retainedCount,
      heightBucket: scheduler.decision.heightBucket,
    } : null,
    exteriorStreamingActive: scheduler ? scheduler.exteriorStreamingActive : null,
    canvas: rect ? { cssX: rect.x, cssY: rect.y, cssWidth: rect.width, cssHeight: rect.height } : null,
    devicePixelRatio: window.devicePixelRatio,
    windowInner: { width: window.innerWidth, height: window.innerHeight },
    resourceCount: resources.length,
    resourceBufferAtCap: resources.length >= 250,
    glbCount: glb.length,
    farTierGlbCount: glb.filter((n) => n.includes('.far_0.')).length,
    lod0Count: glb.filter((n) => n.includes('__lod_0')).length,
    lod1Count: glb.filter((n) => n.includes('__lod_1')).length,
  });
})()`;

/** The rAF sampler. Collects deltas for `windowMs`, then resolves. */
export const FRAME_SAMPLER_SOURCE = (windowMs = 12000) => `(() => {
  window.__t7frames = { deltas: [], done: false };
  let last = null;
  const started = performance.now();
  const tick = (now) => {
    if (last !== null) window.__t7frames.deltas.push(now - last);
    last = now;
    if (now - started >= ${windowMs}) { window.__t7frames.done = true; return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 'sampling ${windowMs}ms';
})()`;

export const FRAME_RESULT_SOURCE = `(() => {
  const f = window.__t7frames;
  if (!f) return JSON.stringify({ error: 'sampler was never armed' });
  const d = [...f.deltas].sort((a, b) => a - b);
  const q = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : null);
  return JSON.stringify({ done: f.done, count: d.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), min: d[0] ?? null, max: d[d.length - 1] ?? null });
})()`;

/** The pick control: click is issued by the driver, this reads the answer. */
export const PICK_READ_SOURCE = (expectedId) => `(() => {
  const text = document.body.innerText;
  const index = text.indexOf('Feature ID');
  const selected = index >= 0 ? (text.slice(index, index + 80).match(/doitt:\\d+/) || [null])[0] : null;
  return JSON.stringify({
    selectedFeatureId: selected,
    chooserShown: /Overlapping records/.test(text),
    expected: ${JSON.stringify(expectedId)},
    identityConfirmed: selected === ${JSON.stringify(expectedId)},
  });
})()`;

/** Frame verdict against the pre-registered F1 bar. Bars are constants here. */
export const F1_BAR = { p50MaxMs: 16.7, p95MaxMs: 25, minDeltas: 600 };
export function f1Verdict(frames) {
  if (!frames || frames.count === undefined) return { verdict: "NOT-CAPTURED", reason: "no frame sample" };
  if (frames.count < F1_BAR.minDeltas) return { verdict: "NOT-CAPTURED", reason: `${frames.count} deltas, below the registered minimum of ${F1_BAR.minDeltas}` };
  const p50Pass = frames.p50 <= F1_BAR.p50MaxMs;
  const p95Pass = frames.p95 <= F1_BAR.p95MaxMs;
  return {
    verdict: p50Pass && p95Pass ? "PASS" : "FAIL",
    p50: frames.p50, p95: frames.p95, count: frames.count,
    detail: `p50 ${frames.p50?.toFixed(2)} ms vs ${F1_BAR.p50MaxMs}; p95 ${frames.p95?.toFixed(2)} ms vs ${F1_BAR.p95MaxMs}`,
  };
}

/**
 * Was this station actually the tier composition it was registered as?
 * Never inferred from geometry: the ring is dual-keyed (T006 found the served
 * level tracking a camera-height bucket, not the cell distance the name
 * implies), so composition is read from the DOM or it is not known.
 */
export function tierCompositionOf(state) {
  const status = state.farTierStatus ?? {};
  const viewport = state.farTierViewport ?? {};
  const drawn = Number(status.farTierDrawn ?? viewport.farTierPublishDrawn ?? 0);
  const declared = Number(status.farTierDeclared ?? 0);
  const near = Number(status.farTierNear ?? 0);
  const resident = state.schedulerDecision?.residentCount ?? null;
  const publishSeq = viewport.farTierPublishSeq === undefined ? null : Number(viewport.farTierPublishSeq);
  return {
    farTierDrawnCells: drawn,
    farTierDeclaredCells: declared,
    farTierNearCells: near,
    farTierPresent: drawn > 0,
    exteriorResidentCells: resident,
    exteriorPresent: resident !== null && resident > 0,
    massingActive: Number(viewport.farTierMassingActive ?? 0),
    massingSuppressible: Number(viewport.farTierMassingSuppressible ?? 0),
    massingCovered: Number(viewport.farTierMassingCovered ?? 0),
    massingUncovered: Number(viewport.farTierMassingUncovered ?? 0),
    publishSeq,
    tiersObserved: [
      Number(viewport.farTierMassingActive ?? 0) > 0 ? "dense-massing" : null,
      resident !== null && resident > 0 ? "exterior-wave" : null,
      drawn > 0 ? "far-tier" : null,
    ].filter(Boolean),
  };
}

function record() {
  const nameIndex = process.argv.indexOf("--name");
  const inIndex = process.argv.indexOf("--in");
  if (nameIndex < 0 || inIndex < 0) fail("usage: record --name <n> --in <json> [--still <png>]");
  const name = process.argv[nameIndex + 1];
  const payload = JSON.parse(readFileSync(process.argv[inIndex + 1], "utf8"));
  const stillIndex = process.argv.indexOf("--still");
  const still = stillIndex > 0 ? process.argv[stillIndex + 1] : null;
  const out = {
    schemaVersion: "1.0",
    recordId: `${RECORD_ID}:station:${name}`,
    task: "T007",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    station: name,
    tierComposition: tierCompositionOf(payload.state ?? {}),
    frames: payload.frames ?? null,
    f1: f1Verdict(payload.frames),
    raw: payload,
    stillSha256: still && existsSync(still) ? sha256(readFileSync(still)) : null,
  };
  const digest = guardedWrite(join(RECORD_ROOT, "stations", `${name}.json`), serialize(out));
  console.log(serialize({ ok: true, station: name, sha256: digest, f1: out.f1, tiers: out.tierComposition.tiersObserved }));
}

function isDirectEntryPoint() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry); } catch { return false; }
}

if (isDirectEntryPoint()) {
  const command = process.argv[2] ?? "help";
  if (command === "probe-source") console.log(TIER_STATE_PROBE);
  else if (command === "frame-source") console.log(FRAME_SAMPLER_SOURCE(Number(process.argv[3] ?? 12000)));
  else if (command === "frame-result-source") console.log(FRAME_RESULT_SOURCE);
  else if (command === "record") record();
  else fail("usage: probe-source | frame-source [ms] | frame-result-source | record --name <n> --in <json>");
}
