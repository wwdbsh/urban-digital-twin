/* global process, console, fetch, WebSocket, setTimeout */
/**
 * ONE STATION, TWO ARMS — the isolation the committed harness cannot express.
 *
 * WHY THIS EXISTS. T007 recorded an F1 FAIL at `overview-52km-island` and
 * attributed it to the far tier. The T006 two-tier baseline at that SAME station
 * reads p50 16.7 / p95 24.9 — already at the bar before the far tier existed —
 * so a 0.1-0.3 ms movement in one session attributes nothing. Deciding whether
 * the far tier moved that station needs an arm with the far tier OFF, at the
 * same station, in the same session, and the committed frames harness has no
 * far-tier flag. So this samples one station under a URL the caller chooses.
 *
 * IT IS A NEW INSTRUMENT, SO IT IS VALIDATED BEFORE IT IS BELIEVED. The
 * validation is a cross-check, not a self-check: the ON arm must reproduce the
 * committed harness's reading at the same station to within the run-to-run
 * spread that harness itself shows. An instrument that cannot reproduce a
 * measurement somebody else already published is not measuring the same thing.
 *
 * IT ALSO REFUSES WHAT THE COMMITTED HARNESS REFUSES. F1's floor is 600 rAF
 * deltas after 45 s of settle; a short sample returns NOT-CAPTURED however good
 * its percentiles look. And it reads the far-tier DOM state at sample time, so
 * an arm that claims "far tier off" has to prove the tier was actually disarmed
 * rather than merely asked to be.
 *
 * Usage:
 *   node scripts/station-arm-frames-cli.mjs sample --url <url> --label <name>
 *     --expect-far-tier <on|off> [--port 9223] [--out <file>]
 */

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const TOOL = "station-arm-frames";
const fail = (message) => { console.error(`${TOOL}: ${message}`); process.exit(1); };
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** F1's bar, restated so this tool cannot drift from the campaign's. */
export const F1_BAR = { p50MaxMs: 16.7, p95MaxMs: 25, minDeltas: 600, settleMs: 45_000, windowMs: 12_000 };

async function attach(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page") ?? list[0];
  if (!page?.webSocketDebuggerUrl) fail(`no debuggable page on port ${port}; launch the dedicated Chrome first`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) fail(`evaluate failed: ${result.exceptionDetails.text}`);
    return result.result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const SAMPLER = (windowMs) => `(() => {
  window.__armFrames = { deltas: [], done: false };
  let last = null; const started = performance.now();
  const tick = (now) => {
    if (last !== null) window.__armFrames.deltas.push(now - last);
    last = now;
    if (now - started >= ${windowMs}) { window.__armFrames.done = true; return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return 'armed';
})()`;

const RESULT = `(() => {
  const f = window.__armFrames || { deltas: [], done: false };
  const d = [...f.deltas].sort((a, b) => a - b);
  const q = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : null);
  return { done: f.done, count: d.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: d[d.length - 1] ?? null };
})()`;

/** Far-tier state AT SAMPLE TIME, so an "off" arm has to prove it was off. */
const TIER_STATE = `(() => {
  const status = document.querySelector('[data-far-tier-declared]');
  const viewport = document.querySelector('.viewport');
  const d = viewport ? viewport.dataset : {};
  const hasStatus = Boolean(status);
  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
  return {
    farTierStatusElementPresent: hasStatus,
    farTierArmed: hasStatus,
    farTierDrawnCells: hasStatus ? num(status.dataset.farTierDrawn) : null,
    farTierDeclaredCells: hasStatus ? num(status.dataset.farTierDeclared) : null,
    massingActive: num(d.farTierMassingActive),
    publishSeq: num(d.farTierPublishSeq),
    hasFocus: document.hasFocus(),
    visibility: document.visibilityState,
  };
})()`;

export function verdictOf(frames) {
  if (!frames || frames.count === undefined) return { verdict: "NOT-CAPTURED", reason: "no sample" };
  if (frames.count < F1_BAR.minDeltas) return { verdict: "NOT-CAPTURED", reason: `${frames.count} deltas, below the registered floor of ${F1_BAR.minDeltas}` };
  const pass = frames.p50 <= F1_BAR.p50MaxMs && frames.p95 <= F1_BAR.p95MaxMs;
  return { verdict: pass ? "PASS" : "FAIL", p50: frames.p50, p95: frames.p95, count: frames.count };
}

async function sample() {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const url = arg("--url"); const label = arg("--label", "arm");
  if (!url) fail("usage: sample --url <url> --label <name> [--port 9223] [--out <file>]");
  const port = Number(arg("--port", "9223"));
  const session = await attach(port);
  try {
    await session.send("Page.enable");
    await session.send("Page.navigate", { url });
    await wait(F1_BAR.settleMs);
    const before = await session.evaluate(TIER_STATE);
    await session.evaluate(SAMPLER(F1_BAR.windowMs));
    await wait(F1_BAR.windowMs + 2_000);
    const frames = await session.evaluate(RESULT);
    const after = await session.evaluate(TIER_STATE);
    const record = {
      schemaVersion: "1.0", recordId: `three-tier-acceptance-20260821:station-arm:${label}`, task: "T007",
      capturedAt: null, capturedAtStatement: "NULL BY CONSTRUCTION.",
      label, url, bar: F1_BAR, frames, verdict: verdictOf(frames),
      expectedFarTier: (process.argv.indexOf("--expect-far-tier") > 0 ? process.argv[process.argv.indexOf("--expect-far-tier") + 1] : "on"),
      tierStateBeforeWindow: before, tierStateAfterWindow: after,
      focusHeld: before.hasFocus === true && after.hasFocus === true,
      visibilityHeld: before.visibility === "visible" && after.visibility === "visible",
    };
    // REFUSAL RULES, fixed here before the arms were run and disclosed in the
    // record rather than adjusted afterwards.
    //
    // FOCUS IS REPORTED, NOT A REFUSAL. The registered F1 instrument -- the
    // committed frames harness -- does not gate on focus, and its Chrome is
    // launched with --disable-renderer-backgrounding precisely so that rAF keeps
    // running unfocused. This tool launches the same way. Making focus a refusal
    // here would hold the isolation arm to a stricter rule than the measurement
    // it is being compared against, which would not make it more honest.
    //
    // COMPOSITION IS A REFUSAL, because the pre-registration requires expected
    // tier composition to be verified by DOM read at every station. An arm whose
    // far tier has not finished declaring is not the configuration it claims to
    // be: the first run of this tool sampled a cold-cache page where the far
    // tier had declared ZERO cells and the massing layer was drawing all 42,542
    // buildings. Those frames are real and describe a different city.
    const expectFarTier = record.expectedFarTier;
    const declared = after.farTierDeclaredCells;
    const composed = expectFarTier === "on"
      ? after.farTierArmed === true && declared === 840
      : after.farTierArmed === false || declared === null || declared === 0;
    record.compositionMatchedIntent = composed;
    if (!composed) {
      record.verdict = { verdict: "NOT-CAPTURED", reason: `tier composition does not match the arm's intent (expected far tier ${expectFarTier}; armed=${after.farTierArmed}, declared=${declared}, massingActive=${after.massingActive})` };
    }
    const out = arg("--out");
    const text = serialize(record);
    if (out) {
      writeFileSync(out, text);
      writeFileSync(`${out.replace(/\.json$/u, "")}.sha256`, `${createHash("sha256").update(text).digest("hex")}  ${out.split("/").pop()}\n`);
    }
    console.log(text);
  } finally { session.close(); }
}

if ((process.argv[2] ?? "sample") === "sample") await sample();
else fail("usage: sample --url <url> --label <name>");
