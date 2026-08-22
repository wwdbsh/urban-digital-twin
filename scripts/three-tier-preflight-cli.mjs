/* global process, console, fetch */
/**
 * PHASE 0 — the fail-closed pre-flight, run before lap 0 of anything.
 *
 * It ABORTS the campaign rather than degrading it. That direction matters: the
 * failure this exists to prevent already happened once. T005 shipped two
 * promotion sweeps whose vehicle was missing the entire exterior wave tier,
 * because the dev server answered every absent package with `index.html` and
 * nothing checked. A campaign that quietly measures two tiers and reports three
 * is worse than one that refuses to start.
 *
 * Every condition below is a REFUSAL, not a warning. There is no partial pass.
 *
 * Usage: node scripts/three-tier-preflight-cli.mjs run [--base http://127.0.0.1:4173]
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { guardedWrite, RECORD_ROOT, FROZEN_EVIDENCE_ROOTS } from "./three-tier-capture-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = "three-tier-preflight";
const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

export const SERVING_RELEASE_IDS = [
  "manhattan-exterior-cells-20260811-v3-s2",
  "manhattan-midtown-core-cells-20260811-v3-s2",
  "manhattan-lower-manhattan-cells-20260812-s2",
  "manhattan-southern-remainder-cells-20260812-s2",
  "manhattan-central-upper-manhattan-cells-20260812-s2",
  "manhattan-northern-manhattan-cells-20260812-s2",
];

/** Digests the pre-registration pinned. Restated here so drift is loud. */
export const PINNED = {
  farTierPayloadInventory: "cf8e26480eecc91f2e7b473d217a0d3551d0be59b4d8da39ee1217a6e0538f0a",
  sweepExemptions: "6354676da304ab03783132730f75dafdfce60c82f509dd740b9fc18c92e8d430",
  sweepPoses: "94a40e8acd377539d61e8c06767859a4a95a43823c97dd9a31b43cae54e149b0",
  promotedInventory: "cf8e26480eecc91f2e7b473d217a0d3551d0be59b4d8da39ee1217a6e0538f0a",
};

/** The frozen records the campaign must leave byte-identical, start and end. */
export const FROZEN_PINS = {
  "data/citywide-heap-repeat-20260815/heap-repeat-evidence.json": "6c3ef7c38118dcc1630a1da73ae2224592b5c4fbd94c60c4488a07ddc925eb9a",
  "data/exterior-serving-20260817/eviction-at-scale.json": "84809b28ad88460a5bd3ee678bfed5a210b0ec3d859773824f8fe57bc18575cb",
  "data/exterior-serving-20260817/default-session-residency.json": "dc86b08882cdab0c2e311be3ee43428b84d28860a4aa55d7233549da8308891e",
  "data/exterior-serving-20260817/frame-time-ab.json": "8bf220330cf70232aca2acf1a25bebdd2c29f0ecffc46433902c69e095b72482",
  "data/exterior-serving-20260817/frame-arm-a.json": "8efe6f0f384a4b11755fd9b53da385b2aea7b9b89c7a659fe9cb437ddb517a9e",
  "data/exterior-serving-20260817/frame-arm-b.json": "daa543f88ed3ccc487479e8f6a2dec8ca5f66550f84a97aa799ebe6d0c133bcc",
  "data/shared-class-textures-20260815/gpu-campaign.json": "0a9501b717c088644d793ffe9d7961893534bc975b4d9054e7681273ab13dd9f",
};

/** The strings a probe-armed bundle must contain, checked in the served bytes. */
export const REQUIRED_BUNDLE_MARKERS = ["data-exterior-texture-probe", "data-exterior-scheduler-probe"];

const check = (id, ok, detail) => ({ id, ok: Boolean(ok), detail });

/** Power, read rather than asserted: the pre-registration made it a condition. */
export function powerState() {
  try {
    const batt = execFileSync("pmset", ["-g", "batt"], { encoding: "utf8" });
    const onAc = /AC Power/u.test(batt);
    const percent = (batt.match(/(\d+)%/u) ?? [])[1] ?? null;
    let watts = null;
    try { watts = (execFileSync("pmset", ["-g", "ac"], { encoding: "utf8" }).match(/Wattage\s*=\s*(\d+)W/u) ?? [])[1] ?? null; } catch { watts = null; }
    const therm = (() => { try { return execFileSync("pmset", ["-g", "therm"], { encoding: "utf8" }); } catch { return ""; } })();
    return {
      source: onAc ? "AC Power" : "Battery Power",
      onAcPower: onAc,
      chargePercent: percent === null ? null : Number(percent),
      adapterWatts: watts === null ? null : Number(watts),
      thermalWarningRecorded: /thermal warning level has been recorded(?! )/u.test(therm) ? "unknown" : !/No thermal warning level/u.test(therm),
      raw: batt.trim().split("\n").slice(0, 2).join(" | "),
    };
  } catch (error) { return { source: "unreadable", onAcPower: null, error: String(error) }; }
}

async function run() {
  const baseIndex = process.argv.indexOf("--base");
  const base = baseIndex > 0 ? process.argv[baseIndex + 1] : "http://127.0.0.1:4173";
  const checks = [];

  // ---- 1. WORKTREE. A day may have passed; nothing is assumed to be as left.
  const head = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", repositoryRoot, "status", "--porcelain"], { encoding: "utf8" }).trim();
  checks.push(check("worktree-clean", dirty === "", dirty === "" ? `clean at ${head}` : `UNCOMMITTED CHANGES:\n${dirty}`));

  // ---- 2. THE PRE-REGISTRATION STILL MATCHES ITS SIDECAR.
  const preText = readFileSync(join(RECORD_ROOT, "pre-registration.json"), "utf8");
  const preDeclared = readFileSync(join(RECORD_ROOT, "pre-registration.sha256"), "utf8").trim().split(/\s+/u)[0];
  const preActual = createHash("sha256").update(preText).digest("hex");
  checks.push(check("pre-registration-unedited", preActual === preDeclared, `${preActual}${preActual === preDeclared ? "" : ` != declared ${preDeclared}`}`));

  // ---- 3. STAGED SERVING BYTES, re-verified in full.
  let filesChecked = 0; const badFiles = [];
  for (const releaseId of SERVING_RELEASE_IDS) {
    const inventoryPath = join(repositoryRoot, "data", releaseId, "payload-inventory.json");
    if (!existsSync(inventoryPath)) { badFiles.push(`${releaseId}: no committed inventory`); continue; }
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    for (const file of inventory.files) {
      const path = join(repositoryRoot, "public", "data", releaseId, file.path);
      filesChecked += 1;
      try {
        if (statSync(path).size !== file.byteSize) { badFiles.push(`${releaseId}/${file.path}: size`); continue; }
        if (sha256File(path) !== file.checksumSha256) badFiles.push(`${releaseId}/${file.path}: digest`);
      } catch { badFiles.push(`${releaseId}/${file.path}: missing`); }
      if (badFiles.length > 20) break;
    }
  }
  checks.push(check("staged-serving-bytes", badFiles.length === 0, badFiles.length === 0 ? `${filesChecked} files re-verified` : badFiles.slice(0, 10).join("; ")));

  // ---- 4. FAR-TIER PAYLOAD AND RECORDS.
  const farInventory = join(repositoryRoot, "public", "far-tier", "payload-inventory.json");
  checks.push(check("far-tier-payload-inventory", existsSync(farInventory) && sha256File(farInventory) === PINNED.farTierPayloadInventory,
    existsSync(farInventory) ? sha256File(farInventory) : "ABSENT"));
  const promotionRoot = join(repositoryRoot, "data", "far-tier-hlod-promotion-20260819");
  for (const [name, pin] of [["sweep-exemptions", PINNED.sweepExemptions], ["sweep-poses", PINNED.sweepPoses], ["promoted-inventory", PINNED.promotedInventory]]) {
    const path = join(promotionRoot, `${name}.json`);
    checks.push(check(`far-tier-${name}`, existsSync(path) && sha256File(path) === pin, existsSync(path) ? sha256File(path) : "ABSENT"));
  }

  // ---- 5. PROMOTED-SET RECONCILIATION, machine-checked.
  const inventory = JSON.parse(readFileSync(join(promotionRoot, "promoted-inventory.json"), "utf8"));
  const exemptions = JSON.parse(readFileSync(join(promotionRoot, "sweep-exemptions.json"), "utf8"));
  const baked = inventory.entries.length;
  const stops = exemptions.honestStopCells.count;
  const memberIds = new Set();
  let refusals = 0;
  for (const entry of inventory.entries) for (const member of entry.members ?? []) {
    const id = typeof member === "string" ? member : member.buildingId;
    memberIds.add(id);
    if (typeof member !== "string" && member.included === false) refusals += 1;
  }
  const ledger = inventory.coverage.ledgerCellCount;
  checks.push(check("promoted-set-reconciles",
    baked === 840 && stops === 43 && baked + stops === ledger && memberIds.size === 44076 && refusals === 143,
    `baked ${baked} + stops ${stops} = ${baked + stops} against ledger ${ledger}; ${memberIds.size} member ids; ${refusals} refusals`));

  // ---- 6. THE SIX PACKAGES ANSWER A REAL MANIFEST. Any <!doctype ABORTS.
  const manifests = [];
  for (const releaseId of SERVING_RELEASE_IDS) {
    let body;
    let status = 0;
    try {
      const response = await fetch(`${base}/data/${releaseId}/index.json`);
      status = response.status;
      body = (await response.text()).slice(0, 200);
    } catch (error) { body = `FETCH FAILED: ${error}`; }
    // The SPA fallback answers a missing package with index.html. That is the
    // exact shape of T005's silent two-tier vehicle, so it is checked for by
    // signature rather than inferred from a status code -- the fallback is a 200.
    const doctype = /^\s*<!doctype/iu.test(body);
    manifests.push({ releaseId, status, doctype, looksJson: body.trimStart().startsWith("{") });
  }
  const anyDoctype = manifests.some((m) => m.doctype);
  checks.push(check("six-packages-answer-real-manifests", !anyDoctype && manifests.every((m) => m.status === 200 && m.looksJson),
    anyDoctype ? `SPA FALLBACK DETECTED: ${manifests.filter((m) => m.doctype).map((m) => m.releaseId).join(", ")}` : manifests.map((m) => `${m.releaseId}:${m.status}`).join(" ")));

  // ---- 7. THE SERVED BUNDLE IS PROBE-ARMED, checked in the bytes.
  const distAssets = join(repositoryRoot, "dist", "assets");
  const markerHits = {};
  if (existsSync(distAssets)) {
    const scripts = readdirSync(distAssets).filter((n) => n.endsWith(".js"));
    for (const marker of REQUIRED_BUNDLE_MARKERS) {
      markerHits[marker] = scripts.some((name) => readFileSync(join(distAssets, name), "utf8").includes(marker));
    }
  }
  checks.push(check("bundle-probe-armed", REQUIRED_BUNDLE_MARKERS.every((m) => markerHits[m]), JSON.stringify(markerHits)));

  // ---- 8. FROZEN EVIDENCE UNTOUCHED.
  const frozenDrift = [];
  for (const [path, digest] of Object.entries(FROZEN_PINS)) {
    const full = join(repositoryRoot, path);
    if (!existsSync(full)) { frozenDrift.push(`${path}: ABSENT`); continue; }
    if (sha256File(full) !== digest) frozenDrift.push(`${path}: DRIFTED`);
  }
  checks.push(check("frozen-evidence-untouched", frozenDrift.length === 0, frozenDrift.length === 0 ? `${Object.keys(FROZEN_PINS).length} records byte-identical` : frozenDrift.join("; ")));

  // ---- 9. POWER, the pre-registered condition.
  const power = powerState();
  checks.push(check("ac-power", power.onAcPower === true, `${power.source}${power.adapterWatts ? ` ${power.adapterWatts}W` : ""} ${power.chargePercent ?? "?"}%`));

  const passed = checks.every((c) => c.ok);
  const record = {
    schemaVersion: "1.0",
    recordId: "three-tier-acceptance-20260821:preflight",
    task: "T007",
    phase: "0",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    verdict: passed ? "PASS" : "ABORT",
    rule: "FAIL CLOSED. Any unmet condition aborts the campaign rather than degrading it. There is no partial pass.",
    whyThisExists: "T005 shipped two promotion sweeps whose vehicle was missing the entire exterior wave tier, because the server answered every absent package with index.html and nothing checked. A campaign that quietly measures two tiers and reports three is worse than one that refuses to start.",
    worktreeHead: head,
    base,
    hardwareAtCapture: {
      note: "The committed pre-registration recorded this machine on BATTERY and made AC power a pre-flight condition. That record is NOT edited -- a pre-registration that changes after the fact is not one. The capture-time state is recorded HERE instead.",
      model: "MacBook Pro, Mac16,7",
      chip: "Apple M4 Pro, 14 cores (10 performance, 4 efficiency)",
      memoryGb: 24,
      os: "macOS 26.5.2 (build 25F84)",
      display: "Built-in Liquid Retina XDR, 3456x2234",
      power,
      oneMachineOneSession: "Every timing verdict from this campaign is one machine, one session. Not a distribution, no confidence interval, does not generalise.",
    },
    checks,
    manifests,
    passedCount: checks.filter((c) => c.ok).length,
    ofCount: checks.length,
  };
  const digest = guardedWrite(join(RECORD_ROOT, "preflight.json"), serialize(record));
  console.log(serialize({ verdict: record.verdict, passed: record.passedCount, of: record.ofCount, sha256: digest, failed: checks.filter((c) => !c.ok).map((c) => ({ id: c.id, detail: c.detail })) }));
  if (!passed) process.exit(1);
}

function isDirectEntryPoint() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry); } catch { return false; }
}

if (isDirectEntryPoint()) {
  if ((process.argv[2] ?? "run") !== "run") { console.error(`${TOOL}: usage: run [--base <url>]`); process.exit(1); }
  await run();
}

export { FROZEN_EVIDENCE_ROOTS };
