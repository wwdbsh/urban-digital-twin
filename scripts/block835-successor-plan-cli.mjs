/* global TextDecoder, console, process */
/**
 * Operator entrypoint for the Block 835 SUCCESSOR package (V2 grammar).
 *
 * Commands
 *   plans        Regenerate the committed canonical facade plans.
 *   authoring    Emit per-building Blender authoring inputs (plan path + ENU frame).
 *   measurements Convert the Blender silhouette evidence into the committed measurement input.
 *   evidence     Commit the hashed Blender evidence inventory alongside the plans.
 *   build        Write the immutable multi-LOD package (manifest + private content).
 *   registration Report exported-vs-source massing registration.
 *   determinism  Build twice into scratch roots and compare every artifact byte.
 *
 * The pinned pilot release is read-only input. Nothing here acquires external
 * data, mutates a pinned release, or admits exterior evidence.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOCK835_PILOT_RELEASE_ID,
    BLOCK835_REGISTRATION_METHOD,
  BLOCK835_REGISTRATION_TOLERANCE,
  BLOCK835_SUCCESSOR_PACKAGE_ID,
  decidePackageTarget,
  readPilotBuildings,
} from "../src/release/block835-reference-package.ts";
import {
  BLOCK835_SUCCESSOR_GENERATED_AT,
  assembleBlock835SuccessorPackage,
  buildSuccessorPlan,
  successorPredecessorPins,
  successorRoofEquipmentHeightMm,
} from "../src/release/block835-successor-package.ts";
import { multiLodAssemblyFingerprint, serializeMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";
import { sha256HexBytes, stableSerialize } from "../src/domain/deterministic-hash.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PILOT_RELEASE_PATH = join(ROOT, "public", "data", BLOCK835_PILOT_RELEASE_ID, "release.json");
const PLAN_DIR = join(ROOT, "data", BLOCK835_SUCCESSOR_PACKAGE_ID, "plans");
const MEASUREMENT_PATH = join(ROOT, "data", BLOCK835_SUCCESSOR_PACKAGE_ID, "silhouette-measurements.json");
const PACKAGE_DIR = join(ROOT, "public", "data", BLOCK835_SUCCESSOR_PACKAGE_ID);

function fail(message) { throw new Error(message); }
function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${token}.`);
    result[token.slice(2)] = value; index += 1;
  }
  return result;
}
async function loadPilot() {
  const bytes = new Uint8Array(await readFile(PILOT_RELEASE_PATH));
  return { release: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), releaseChecksumSha256: sha256HexBytes(bytes) };
}
async function loadMeasurements(path = MEASUREMENT_PATH) {
  const raw = await readFile(path, "utf8").catch(() => fail(`Blender silhouette measurements are required at ${path}. Run the Blender authoring pass first.`));
  const parsed = JSON.parse(raw);
  if (parsed.packageId !== BLOCK835_SUCCESSOR_PACKAGE_ID || parsed.method !== "projected-silhouette-ratio" || parsed.metricVersion !== "1.0") fail("Silhouette measurement file does not match the approved package/metric identity.");
  if (!Array.isArray(parsed.buildings) || parsed.buildings.length === 0) fail("Silhouette measurement file declares no buildings.");
  return parsed;
}
function planFileName(canonicalBuildingId) { return `${canonicalBuildingId.replace(":", "-")}.json`; }

async function writePlans() {
  const { release } = await loadPilot();
  await rm(PLAN_DIR, { recursive: true, force: true });
  await mkdir(PLAN_DIR, { recursive: true });
  const summary = [];
  for (const building of readPilotBuildings(release)) {
    const { plan } = buildSuccessorPlan(building);
    await writeFile(join(PLAN_DIR, planFileName(building.canonicalBuildingId)), `${stableSerialize(plan)}\n`, "utf8");
    summary.push({
      canonicalBuildingId: plan.buildingId,
      planId: plan.planId,
      planHashSha256: plan.planHashSha256,
      componentCount: plan.inventory.components.length,
      truthTiers: [...new Set(plan.inventory.components.map((component) => component.state))].sort(),
      placements: plan.placements.length,
    });
  }
  await writeFile(join(dirname(PLAN_DIR), "plan-index.json"), `${stableSerialize({ packageId: BLOCK835_SUCCESSOR_PACKAGE_ID, plans: summary })}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "plans", plans: summary.length, planDir: PLAN_DIR }, null, 2));
}

/**
 * Blender authoring inputs. Blender re-derives geometry from the same committed
 * plan through its own tessellator; only the rigid plan-to-ENU frame and the
 * shared tessellation constants are handed over, so the re-import diff stays a
 * genuine cross-implementation check rather than a replay of the same code.
 */
async function authoringInputs(targetDir) {
  const { release } = await loadPilot();
  await mkdir(targetDir, { recursive: true });
  const index = [];
  for (const building of readPilotBuildings(release)) {
    const context = buildSuccessorPlan(building);
    const entry = {
      canonicalBuildingId: building.canonicalBuildingId,
      planPath: join(PLAN_DIR, planFileName(building.canonicalBuildingId)),
      planHashSha256: context.plan.planHashSha256,
      enuFrame: { axis: context.rectangle.axis, center: context.rectangle.center },
      tessellation: { openingInsetMm: context.plan.input.parameters.openingInsetMm, roofEquipmentHeightMm: successorRoofEquipmentHeightMm(context.plan) },
      shippedGlb: { lod_0: `private/assets/${building.canonicalBuildingId.replace(":", "-")}__lod_0.glb`, lod_1: `private/assets/${building.canonicalBuildingId.replace(":", "-")}__lod_1.glb` },
    };
    await writeFile(join(targetDir, `${building.canonicalBuildingId.replace(":", "-")}.json`), `${stableSerialize(entry)}\n`, "utf8");
    index.push({ canonicalBuildingId: entry.canonicalBuildingId, planHashSha256: entry.planHashSha256 });
  }
  await writeFile(join(targetDir, "index.json"), `${stableSerialize({ packageId: BLOCK835_SUCCESSOR_PACKAGE_ID, generatedAt: BLOCK835_SUCCESSOR_GENERATED_AT, buildings: index })}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "authoring", buildings: index.length, dir: targetDir }, null, 2));
}

/**
 * Promotes the Blender-measured silhouette evidence to the committed build
 * input, binding every measurement to the plan hash it was measured against so
 * a stale measurement can never survive a plan change.
 */
async function promoteMeasurements(evidencePath) {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8").catch(() => fail(`Blender silhouette evidence is required at ${evidencePath}.`)));
  if (evidence.packageId !== BLOCK835_SUCCESSOR_PACKAGE_ID || evidence.method !== "projected-silhouette-ratio" || evidence.metricVersion !== "1.0") fail("Blender silhouette evidence does not match the approved package/metric identity.");
  const { release } = await loadPilot();
  const measuredById = new Map(evidence.buildings.map((entry) => [entry.canonicalBuildingId, entry]));
  const buildings = readPilotBuildings(release).map((building) => {
    const measured = measuredById.get(building.canonicalBuildingId);
    if (!measured) fail(`Blender silhouette evidence is missing ${building.canonicalBuildingId}.`);
    if (!(measured.deviationRatio >= 0) || measured.deviationRatio > 0.02) fail(`Measured silhouette deviation for ${building.canonicalBuildingId} is outside the approved 2% bound.`);
    return {
      canonicalBuildingId: building.canonicalBuildingId,
      planHashSha256: buildSuccessorPlan(building).plan.planHashSha256,
      viewIds: [...measured.viewIds].sort(),
      deviationRatio: measured.deviationRatio,
    };
  });
  const file = {
    schemaVersion: "1.0",
    packageId: BLOCK835_SUCCESSOR_PACKAGE_ID,
    method: "projected-silhouette-ratio",
    metricVersion: "1.0",
    tool: "blender-mcp:BLENDER_WORKBENCH:orthographic-512",
    measuredAt: BLOCK835_SUCCESSOR_GENERATED_AT,
    buildings,
  };
  await mkdir(dirname(MEASUREMENT_PATH), { recursive: true });
  await writeFile(MEASUREMENT_PATH, `${stableSerialize(file)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "measurements", buildings: buildings.length, worstDeviationRatio: Math.max(...buildings.map((entry) => entry.deviationRatio)), path: MEASUREMENT_PATH }, null, 2));
}

/**
 * Copies the hashed Blender evidence inventory into the committed data
 * directory so the evidence hashes stay checkable after the untracked
 * worktree-local `artifacts/` tree is removed.
 */
async function promoteEvidenceInventory(sourcePath) {
  const inventory = JSON.parse(await readFile(sourcePath, "utf8").catch(() => fail(`Blender evidence inventory is required at ${sourcePath}.`)));
  if (inventory.packageId !== BLOCK835_SUCCESSOR_PACKAGE_ID || !Array.isArray(inventory.files) || inventory.files.length === 0) fail("Blender evidence inventory does not match the approved package identity.");
  const target = join(ROOT, "data", BLOCK835_SUCCESSOR_PACKAGE_ID, "blender-evidence-inventory.json");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${stableSerialize(inventory)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "evidence", files: inventory.files.length, path: target }, null, 2));
}

/** Predecessor pins come from the frozen 20260810 manifest, which is never edited. */
async function loadPredecessorPins() {
  const path = join(ROOT, "public", "data", "manhattan-esb-block-reference-20260810", "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8").catch(() => fail(`The frozen 20260810 manifest is required at ${path}.`)));
  if (manifest.packageId !== "manhattan-esb-block-reference-20260810") fail("Predecessor manifest identity does not match the frozen 20260810 package.");
  return successorPredecessorPins(manifest);
}

async function assemble(measurementPath) {
  const { release, releaseChecksumSha256 } = await loadPilot();
  return assembleBlock835SuccessorPackage({
    release,
    releaseChecksumSha256,
    measurements: await loadMeasurements(measurementPath),
    predecessor: await loadPredecessorPins(),
  });
}

/**
 * Refuses to recursively delete anything that is not this package's own output.
 *
 * `--out` is operator-supplied, and a typo pointing at a pinned immutable
 * release would otherwise be unrecoverable. A target is only writable when it is
 * the canonical package directory, or lives under an explicit scratch root, and
 * any directory that already exists must prove it is this package by carrying a
 * matching `manifest.json`.
 */
async function assertWritableTarget(targetDir) {
  const found = await stat(targetDir).catch(() => null);
  const existing = found === null ? "absent" : found.isDirectory() ? "directory" : "file";
  const decision = decidePackageTarget({
    targetDir,
    packageDir: PACKAGE_DIR,
    scratchRoot: resolve(ROOT, "artifacts"),
    separator: sep,
    existing,
    existingManifest: existing === "directory" ? await readFile(join(targetDir, "manifest.json"), "utf8").catch(() => null) : null,
  });
  if (!decision.allowed) fail(decision.reason);
}

async function writePackage(targetDir, measurementPath) {
  await assertWritableTarget(targetDir);
  const assembled = await assemble(measurementPath);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(join(targetDir, "private", "assets"), { recursive: true });
  await mkdir(join(targetDir, "private", "tiles"), { recursive: true });
  for (const [relativeRef, bytes] of [...assembled.contents].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    await writeFile(join(targetDir, ...relativeRef.split("/")), bytes);
  }
  await writeFile(join(targetDir, "manifest.json"), serializeMultiLodAssembly(assembled.manifest), "utf8");
  await writeFile(join(targetDir, "ownership-ledger.json"), `${stableSerialize(assembled.ownershipLedger)}\n`, "utf8");
  await writeFile(join(targetDir, "registration.json"), `${stableSerialize({ packageId: BLOCK835_SUCCESSOR_PACKAGE_ID, ...BLOCK835_REGISTRATION_METHOD, tolerance: BLOCK835_REGISTRATION_TOLERANCE, entries: assembled.registration })}\n`, "utf8");
  return assembled;
}

async function build(target, measurementPath) {
  const assembled = await writePackage(target, measurementPath);
  console.log(JSON.stringify({
    ok: true, command: "build", packageId: assembled.manifest.packageId, dir: target,
    assets: assembled.manifest.assets.length, artifacts: assembled.manifest.artifacts.length,
    declaredTotalBytes: assembled.manifest.declaredTotalBytes,
    fingerprintSha256: multiLodAssemblyFingerprint(assembled.manifest),
  }, null, 2));
}

async function registration(measurementPath) {
  const assembled = await assemble(measurementPath);
  const offending = assembled.registration.filter((entry) => !entry.withinTolerance);
  if (offending.length > 0) fail(`Registration gate failed for: ${offending.map((entry) => entry.canonicalBuildingId).join(", ")}`);
  const worstHorizontal = Math.max(...assembled.registration.map((entry) => entry.horizontalDeviationMeters));
  const worstVertical = Math.max(...assembled.registration.map((entry) => entry.verticalDeviationMeters));
  console.log(JSON.stringify({ ok: true, command: "registration", buildings: assembled.registration.length, tolerance: BLOCK835_REGISTRATION_TOLERANCE, worstHorizontalMeters: worstHorizontal, worstVerticalMeters: worstVertical }, null, 2));
}

async function hashTree(directory) {
  const entries = {};
  const walk = async (current, prefix) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) => (left.name < right.name ? -1 : 1))) {
      const next = join(current, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(next, key);
      else entries[key] = sha256HexBytes(new Uint8Array(await readFile(next)));
    }
  };
  await walk(directory, "");
  return entries;
}

async function determinism(scratchRoot, measurementPath) {
  const first = join(scratchRoot, "run-a"); const second = join(scratchRoot, "run-b");
  const runA = await writePackage(first, measurementPath); const runB = await writePackage(second, measurementPath);
  const treeA = await hashTree(first); const treeB = await hashTree(second);
  const fingerprintA = multiLodAssemblyFingerprint(runA.manifest); const fingerprintB = multiLodAssemblyFingerprint(runB.manifest);
  const differing = Object.keys(treeA).filter((key) => treeA[key] !== treeB[key]);
  if (Object.keys(treeA).length !== Object.keys(treeB).length || differing.length > 0) fail(`Non-deterministic artifacts: ${differing.join(", ") || "artifact set differs"}`);
  if (fingerprintA !== fingerprintB) fail("Multi-LOD assembly fingerprint differs between identical runs.");
  console.log(JSON.stringify({ ok: true, command: "determinism", files: Object.keys(treeA).length, fingerprintSha256: fingerprintA }, null, 2));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const parsed = options(rest);
  const measurements = parsed.measurements ? resolve(parsed.measurements) : MEASUREMENT_PATH;
  switch (command) {
    case "plans": return writePlans();
    case "evidence": return promoteEvidenceInventory(resolve(parsed.evidence ?? join(ROOT, "artifacts", "blender", BLOCK835_SUCCESSOR_PACKAGE_ID, "evidence-inventory.json")));
    case "measurements": return promoteMeasurements(resolve(parsed.evidence ?? join(ROOT, "artifacts", "blender", BLOCK835_SUCCESSOR_PACKAGE_ID, "silhouette-measurement.json")));
    case "authoring": return authoringInputs(resolve(parsed.out ?? join(ROOT, "artifacts", "blender", BLOCK835_SUCCESSOR_PACKAGE_ID, "inputs")));
    case "build": return build(parsed.out ? resolve(parsed.out) : PACKAGE_DIR, measurements);
    case "registration": return registration(measurements);
    case "determinism": return determinism(resolve(parsed.scratch ?? join(ROOT, "artifacts", "block835-reference-determinism")), measurements);
    default: return fail("Usage: block835-successor-plan-cli.mjs <plans|authoring|measurements|evidence|build|registration|determinism> [--out DIR] [--scratch DIR] [--measurements FILE]");
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
