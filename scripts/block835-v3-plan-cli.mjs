/* global TextDecoder, console, process */
/**
 * Operator entrypoint for the Block 835 V3 package (footprint-faithful grammar).
 *
 * Commands
 *   plans        Regenerate the committed canonical V3 facade plans.
 *   authoring    Emit per-building Blender authoring inputs (plan path + height).
 *   measurements Convert the Blender silhouette evidence into the committed measurement input.
 *   evidence     Commit the hashed Blender evidence inventory alongside the plans.
 *   build        Write the immutable multi-LOD package (manifest + private content).
 *   registration Report shipped-vs-SOURCED-polygon registration, vertex for vertex.
 *   census       Report every building: tiers, setback disclosure, budgets, plan-hash uniqueness.
 *   determinism  Build twice into scratch roots and compare every artifact byte.
 *
 * The pinned pilot release is read-only input, and the frozen V1/V2 packages are
 * read only for predecessor pins. Nothing here acquires external data, mutates a
 * pinned release, or admits exterior evidence.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOCK835_PILOT_RELEASE_ID,
  BLOCK835_V3_PACKAGE_ID,
  decidePackageTarget,
  readPilotBuildings,
} from "../src/release/block835-reference-package.ts";
import {
  BLOCK835_V3_GENERATED_AT,
  BLOCK835_V3_PREDECESSOR_PACKAGE_ID,
  V3_QUALITY_BUDGETS,
  V3_REGISTRATION_METHOD,
  V3_REGISTRATION_TOLERANCE,
  assembleBlock835V3Package,
  buildV3Plan,
  v3PredecessorPins,
  v3TruthTiers,
} from "../src/release/block835-v3-package.ts";
import { multiLodAssemblyFingerprint, serializeMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";
import { sha256HexBytes, stableSerialize } from "../src/domain/deterministic-hash.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PILOT_RELEASE_PATH = join(ROOT, "public", "data", BLOCK835_PILOT_RELEASE_ID, "release.json");
const DATA_DIR = join(ROOT, "data", BLOCK835_V3_PACKAGE_ID);
const PLAN_DIR = join(DATA_DIR, "plans");
const MEASUREMENT_PATH = join(DATA_DIR, "silhouette-measurements.json");
const CENSUS_PATH = join(DATA_DIR, "census.json");
const PACKAGE_DIR = join(ROOT, "public", "data", BLOCK835_V3_PACKAGE_ID);
const EVIDENCE_ROOT = join(ROOT, "artifacts", "blender", BLOCK835_V3_PACKAGE_ID);

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
  if (parsed.packageId !== BLOCK835_V3_PACKAGE_ID || parsed.method !== "projected-silhouette-ratio" || parsed.metricVersion !== "1.0") fail("Silhouette measurement file does not match the approved package/metric identity.");
  if (!Array.isArray(parsed.buildings) || parsed.buildings.length === 0) fail("Silhouette measurement file declares no buildings.");
  return parsed;
}
function slug(canonicalBuildingId) { return canonicalBuildingId.replace(":", "-"); }
function planFileName(canonicalBuildingId) { return `${slug(canonicalBuildingId)}.json`; }

async function writePlans() {
  const { release } = await loadPilot();
  await rm(PLAN_DIR, { recursive: true, force: true });
  await mkdir(PLAN_DIR, { recursive: true });
  const summary = [];
  for (const building of readPilotBuildings(release)) {
    const { plan } = buildV3Plan(building);
    await writeFile(join(PLAN_DIR, planFileName(building.canonicalBuildingId)), `${stableSerialize(plan)}\n`, "utf8");
    summary.push({
      canonicalBuildingId: plan.buildingId,
      planId: plan.planId,
      planHashSha256: plan.planHashSha256,
      styleClass: plan.styleClass,
      sourceRingVertexCount: plan.input.geometry.footprint.outer.length,
      reflexVertexCount: plan.massing.reflexVertexIndexes.length,
      effectiveTierCount: plan.massing.effectiveTierCount,
      setbackState: plan.inventory.components.find((component) => component.kind === "setbacks").state,
      truthTiers: v3TruthTiers(plan),
      placements: plan.placements.length,
    });
  }
  const hashes = summary.map((entry) => entry.planHashSha256);
  if (new Set(hashes).size !== hashes.length) fail("Two V3 plans share a plan hash; the grammar is not building distinct assets.");
  await writeFile(join(DATA_DIR, "plan-index.json"), `${stableSerialize({ packageId: BLOCK835_V3_PACKAGE_ID, plans: summary })}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "plans", plans: summary.length, planDir: PLAN_DIR }, null, 2));
}

/**
 * Blender authoring inputs. Blender re-derives geometry from the same committed
 * plan through its own tessellator, so agreement catches transcription and
 * transport errors; the volume identity and the up-axis diff are the checks that
 * are genuinely independent of the TypeScript writer.
 */
async function authoringInputs(targetDir) {
  const { release } = await loadPilot();
  await mkdir(targetDir, { recursive: true });
  const index = [];
  for (const building of readPilotBuildings(release)) {
    const { plan } = buildV3Plan(building);
    const entry = {
      canonicalBuildingId: building.canonicalBuildingId,
      planPath: join(PLAN_DIR, planFileName(building.canonicalBuildingId)),
      planHashSha256: plan.planHashSha256,
      heightMeters: building.heightMeters,
      shippedGlb: { lod_0: `private/assets/${slug(building.canonicalBuildingId)}__lod_0.glb`, lod_1: `private/assets/${slug(building.canonicalBuildingId)}__lod_1.glb` },
    };
    await writeFile(join(targetDir, planFileName(building.canonicalBuildingId)), `${stableSerialize(entry)}\n`, "utf8");
    index.push({ canonicalBuildingId: entry.canonicalBuildingId, planHashSha256: entry.planHashSha256 });
  }
  await writeFile(join(targetDir, "index.json"), `${stableSerialize({ packageId: BLOCK835_V3_PACKAGE_ID, generatedAt: BLOCK835_V3_GENERATED_AT, buildings: index })}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "authoring", buildings: index.length, dir: targetDir }, null, 2));
}

async function promoteMeasurements(evidencePath) {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8").catch(() => fail(`Blender silhouette evidence is required at ${evidencePath}.`)));
  if (evidence.packageId !== BLOCK835_V3_PACKAGE_ID || evidence.method !== "projected-silhouette-ratio" || evidence.metricVersion !== "1.0") fail("Blender silhouette evidence does not match the approved package/metric identity.");
  const { release } = await loadPilot();
  const measuredById = new Map(evidence.buildings.map((entry) => [entry.canonicalBuildingId, entry]));
  const buildings = readPilotBuildings(release).map((building) => {
    const measured = measuredById.get(building.canonicalBuildingId);
    if (!measured) fail(`Blender silhouette evidence is missing ${building.canonicalBuildingId}.`);
    if (!(measured.deviationRatio >= 0) || measured.deviationRatio > 0.02) fail(`Measured silhouette deviation for ${building.canonicalBuildingId} is outside the approved 2% bound.`);
    return {
      canonicalBuildingId: building.canonicalBuildingId,
      planHashSha256: buildV3Plan(building).plan.planHashSha256,
      viewIds: [...measured.viewIds].sort(),
      deviationRatio: measured.deviationRatio,
    };
  });
  const file = {
    schemaVersion: "1.0",
    packageId: BLOCK835_V3_PACKAGE_ID,
    method: "projected-silhouette-ratio",
    metricVersion: "1.0",
    tool: "blender-mcp:BLENDER_WORKBENCH:orthographic-512",
    measuredAt: BLOCK835_V3_GENERATED_AT,
    buildings,
  };
  await mkdir(DATA_DIR, { recursive: true });
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
  if (inventory.packageId !== BLOCK835_V3_PACKAGE_ID || !Array.isArray(inventory.files) || inventory.files.length === 0) fail("Blender evidence inventory does not match the approved package identity.");
  await mkdir(DATA_DIR, { recursive: true });
  const written = [join(DATA_DIR, "blender-evidence-inventory.json")];
  await writeFile(written[0], `${stableSerialize(inventory)}\n`, "utf8");

  // The inventory alone only proves the raw tree has not changed. The two
  // headline P5 proofs are promoted verbatim as well, so the numbers stay
  // readable after the gitignored `artifacts/` tree is gone.
  const evidenceRoot = dirname(sourcePath);
  for (const [name, target, gate] of [
    ["volume-identity.json", "blender-volume-identity.json", (payload) => payload.worstRelativeDeviation <= payload.relativeTolerance],
    ["reimport-up-axis-diff.json", "blender-reimport-up-axis.json", (payload) => payload.files.every((entry) => entry.upAxisIsYUpInFile)],
  ]) {
    const payload = JSON.parse(await readFile(join(evidenceRoot, name), "utf8").catch(() => fail(`Blender ${name} is required next to the evidence inventory.`)));
    if (payload.packageId !== BLOCK835_V3_PACKAGE_ID) fail(`Blender ${name} does not match the approved package identity.`);
    if (!gate(payload)) fail(`Blender ${name} does not pass its own stated gate; refusing to promote it.`);
    const path = join(DATA_DIR, target);
    await writeFile(path, `${stableSerialize(payload)}\n`, "utf8");
    written.push(path);
  }
  console.log(JSON.stringify({ ok: true, command: "evidence", files: inventory.files.length, promoted: written }, null, 2));
}

/** Predecessor pins come from the frozen V2 manifest, which is never edited. */
async function loadPredecessorPins() {
  const path = join(ROOT, "public", "data", BLOCK835_V3_PREDECESSOR_PACKAGE_ID, "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8").catch(() => fail(`The frozen ${BLOCK835_V3_PREDECESSOR_PACKAGE_ID} manifest is required at ${path}.`)));
  return v3PredecessorPins(manifest);
}

async function assemble(measurementPath) {
  const { release, releaseChecksumSha256 } = await loadPilot();
  return assembleBlock835V3Package({
    release,
    releaseChecksumSha256,
    measurements: await loadMeasurements(measurementPath),
    predecessor: await loadPredecessorPins(),
  });
}

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
  await writeFile(join(targetDir, "registration.json"), `${stableSerialize({ packageId: BLOCK835_V3_PACKAGE_ID, ...V3_REGISTRATION_METHOD, tolerance: V3_REGISTRATION_TOLERANCE, entries: assembled.registration })}\n`, "utf8");
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
  if (offending.length > 0) fail(`V3 registration gate failed for: ${offending.map((entry) => entry.canonicalBuildingId).join(", ")}`);
  console.log(JSON.stringify({
    ok: true, command: "registration", buildings: assembled.registration.length,
    tolerance: V3_REGISTRATION_TOLERANCE,
    worstPerVertexShapeMeters: Math.max(...assembled.registration.map((entry) => entry.perVertexShapeDeviationMeters)),
    worstHorizontalMeters: Math.max(...assembled.registration.map((entry) => entry.horizontalDeviationMeters)),
    worstVerticalMeters: Math.max(...assembled.registration.map((entry) => entry.verticalDeviationMeters)),
  }, null, 2));
}

/**
 * The census gate: every one of the fourteen buildings, what the grammar decided
 * for it, and what it costs against the V3 budget. It is a build record rather
 * than a contract artifact, so it lives in `data/` and is not checksum-pinned in
 * the manifest.
 */
async function census(measurementPath) {
  const { release } = await loadPilot();
  const buildings = readPilotBuildings(release);
  const assembled = await assemble(measurementPath);
  const registrationById = new Map(assembled.registration.map((entry) => [entry.canonicalBuildingId, entry]));
  const rows = buildings.map((building) => {
    const { plan } = buildV3Plan(building);
    const asset = assembled.manifest.assets.find((entry) => entry.canonicalFeatureId === building.canonicalBuildingId);
    if (!asset) fail(`Census is missing a shipped asset for ${building.canonicalBuildingId}.`);
    const entry = registrationById.get(building.canonicalBuildingId);
    return {
      canonicalBuildingId: building.canonicalBuildingId,
      planHashSha256: plan.planHashSha256,
      styleClass: plan.styleClass,
      sourceRingVertexCount: plan.input.geometry.footprint.outer.length,
      reflexVertexCount: plan.massing.reflexVertexIndexes.length,
      requestedTierCount: plan.massing.requestedTierCount,
      effectiveTierCount: plan.massing.effectiveTierCount,
      setbackState: plan.inventory.components.find((component) => component.kind === "setbacks").state,
      setbackDisclosure: plan.massing.setbackDisclosure,
      truthTiers: asset.truthTiers,
      lods: asset.lods.map((lod) => ({
        lodId: lod.lodId,
        triangleCount: lod.quality.triangleCount,
        materialCount: lod.quality.materialCount,
        textureCount: lod.quality.textureCount,
        triangleBudgetUsedRatio: lod.quality.triangleCount / V3_QUALITY_BUDGETS.maxTriangles,
        // Assertion, not a report: a build that broke the budget never reaches here.
        withinBudget: lod.quality.triangleCount <= V3_QUALITY_BUDGETS.maxTriangles
          && lod.quality.materialCount <= V3_QUALITY_BUDGETS.maxMaterials
          && lod.quality.textureCount === V3_QUALITY_BUDGETS.maxTextures,
      })),
      registration: {
        perVertexShapeDeviationMeters: entry.perVertexShapeDeviationMeters,
        horizontalDeviationMeters: entry.horizontalDeviationMeters,
        verticalDeviationMeters: entry.verticalDeviationMeters,
        withinTolerance: entry.withinTolerance,
      },
      lod1SilhouetteDeviationRatio: asset.lods[1].silhouette.deviationRatio,
    };
  });
  if (rows.length !== 14) fail(`Census must cover all fourteen Block 835 buildings; it covered ${rows.length}.`);
  const hashes = rows.map((row) => row.planHashSha256);
  if (new Set(hashes).size !== hashes.length) fail("Census found duplicate plan hashes: two buildings would ship identical geometry.");
  const offending = rows.filter((row) => !row.registration.withinTolerance || row.lods.some((lod) => !lod.withinBudget));
  if (offending.length > 0) fail(`Census gate failed for: ${offending.map((row) => row.canonicalBuildingId).join(", ")}`);
  const file = {
    schemaVersion: "1.0",
    packageId: BLOCK835_V3_PACKAGE_ID,
    generatedAt: BLOCK835_V3_GENERATED_AT,
    budgets: V3_QUALITY_BUDGETS,
    registrationMethod: V3_REGISTRATION_METHOD,
    registrationTolerance: V3_REGISTRATION_TOLERANCE,
    summary: {
      buildings: rows.length,
      distinctPlanHashes: new Set(hashes).size,
      setbacksAbsent: rows.filter((row) => row.setbackState === "absent").map((row) => row.canonicalBuildingId),
      worstTriangleCount: Math.max(...rows.flatMap((row) => row.lods.map((lod) => lod.triangleCount))),
      worstPerVertexShapeDeviationMeters: Math.max(...rows.map((row) => row.registration.perVertexShapeDeviationMeters)),
    },
    buildings: rows,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CENSUS_PATH, `${stableSerialize(file)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "census", ...file.summary, path: CENSUS_PATH }, null, 2));
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
    case "authoring": return authoringInputs(resolve(parsed.out ?? join(EVIDENCE_ROOT, "inputs")));
    case "measurements": return promoteMeasurements(resolve(parsed.evidence ?? join(EVIDENCE_ROOT, "silhouette-measurement.json")));
    case "evidence": return promoteEvidenceInventory(resolve(parsed.evidence ?? join(EVIDENCE_ROOT, "evidence-inventory.json")));
    case "build": return build(parsed.out ? resolve(parsed.out) : PACKAGE_DIR, measurements);
    case "registration": return registration(measurements);
    case "census": return census(measurements);
    case "determinism": return determinism(resolve(parsed.scratch ?? join(ROOT, "artifacts", "block835-v3-determinism")), measurements);
    default: return fail("Usage: block835-v3-plan-cli.mjs <plans|authoring|measurements|evidence|build|registration|census|determinism> [--out DIR] [--scratch DIR] [--measurements FILE] [--evidence FILE]");
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
