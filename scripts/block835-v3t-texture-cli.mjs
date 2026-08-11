/* global TextDecoder, console, process */
/**
 * Operator entrypoint for the Block 835 V3T package: the V3 footprint-faithful
 * grammar with procedural detail tiles on its finest level of detail.
 *
 * Commands
 *   tiles        Write the rasterized tile catalogue and its hashed record.
 *   authoring    Emit per-building Blender authoring inputs for the textured GLBs.
 *   build        Write the immutable multi-LOD package (manifest + private content).
 *   census       Report every building: style, tiles, byte cost, budgets, plan-hash identity.
 *   replay       Replay the package through the procedural policy AND the rasterizer.
 *   determinism  Build twice into scratch roots and compare every artifact byte.
 *   evidence     Commit the hashed Blender evidence inventory alongside the census.
 *
 * The pinned pilot release is read-only input and the frozen V3 package is read
 * only for predecessor pins. Nothing here acquires external data, ingests an
 * image, mutates a pinned release, or admits exterior evidence.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BLOCK835_PILOT_RELEASE_ID,
  BLOCK835_V3_PACKAGE_ID,
  BLOCK835_V3T_PACKAGE_ID,
  decidePackageTarget,
  readPilotBuildings,
} from "../src/release/block835-reference-package.ts";
import {
  BLOCK835_V3T_PROFILE,
  BLOCK835_V3_GENERATED_AT,
  V3T_CALIBRATED_PALETTE,
  V3T_QUALITY_BUDGETS,
  V3_REGISTRATION_METHOD,
  V3_REGISTRATION_TOLERANCE,
  assembleBlock835V3Package,
  buildV3Plan,
  v3PredecessorPins,
  v3TextureClassFor,
} from "../src/release/block835-v3-package.ts";
import {
  PROCEDURAL_TEXTURE_CLASSES,
  PROCEDURAL_TEXTURE_LIMITS,
  PROCEDURAL_TEXTURE_PARAMETERS,
  PROCEDURAL_TEXTURE_PROFILE,
  PROCEDURAL_TEXTURE_RASTERIZER_VERSION,
  PROCEDURAL_TEXTURE_TILE_PIXELS,
  proceduralTextureCatalog,
  proceduralTextureParametersHash,
} from "../src/release/procedural-texture.ts";
import { multiLodAssemblyFingerprint, replayMultiLodAssembly, serializeMultiLodAssembly } from "../src/release/multi-lod-assembly.ts";
import { sha256HexBytes, stableSerialize } from "../src/domain/deterministic-hash.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PILOT_RELEASE_PATH = join(ROOT, "public", "data", BLOCK835_PILOT_RELEASE_ID, "release.json");
const V3_DATA_DIR = join(ROOT, "data", BLOCK835_V3_PACKAGE_ID);
const DATA_DIR = join(ROOT, "data", BLOCK835_V3T_PACKAGE_ID);
const MEASUREMENT_PATH = join(V3_DATA_DIR, "silhouette-measurements.json");
const CENSUS_PATH = join(DATA_DIR, "census.json");
const CATALOG_PATH = join(DATA_DIR, "texture-catalog.json");
const PACKAGE_DIR = join(ROOT, "public", "data", BLOCK835_V3T_PACKAGE_ID);
const V3_PACKAGE_DIR = join(ROOT, "public", "data", BLOCK835_V3_PACKAGE_ID);
const EVIDENCE_ROOT = join(ROOT, "artifacts", "blender", BLOCK835_V3T_PACKAGE_ID);

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
function slug(canonicalBuildingId) { return canonicalBuildingId.replace(":", "-"); }

async function loadPilot() {
  const bytes = new Uint8Array(await readFile(PILOT_RELEASE_PATH));
  return { release: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), releaseChecksumSha256: sha256HexBytes(bytes) };
}

/**
 * The V3T silhouette evidence is the V3 evidence, reused deliberately.
 *
 * The measurement is a projected-silhouette ratio between LOD 0 and LOD 1, and
 * texturing moves no vertex: V3T ships the identical plans, the identical
 * tessellation and the identical positions. Re-measuring would produce the same
 * numbers against the same plan hashes. The reuse is only legitimate BECAUSE the
 * plan hashes are identical, which `census` re-checks rather than assumes.
 */
async function loadMeasurements(path = MEASUREMENT_PATH) {
  const raw = await readFile(path, "utf8").catch(() => fail(`Blender silhouette measurements are required at ${path}.`));
  const parsed = JSON.parse(raw);
  if (parsed.packageId !== BLOCK835_V3_PACKAGE_ID || parsed.method !== "projected-silhouette-ratio" || parsed.metricVersion !== "1.0") fail("Silhouette measurement file does not match the approved V3 package/metric identity.");
  return parsed;
}

/** Predecessor pins come from the frozen V3 manifest, which is never edited. */
async function loadPredecessorPins() {
  const path = join(V3_PACKAGE_DIR, "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8").catch(() => fail(`The frozen ${BLOCK835_V3_PACKAGE_ID} manifest is required at ${path}.`)));
  return v3PredecessorPins(manifest, BLOCK835_V3_PACKAGE_ID);
}

async function assemble(measurementPath) {
  const { release, releaseChecksumSha256 } = await loadPilot();
  return assembleBlock835V3Package({
    release, releaseChecksumSha256,
    measurements: await loadMeasurements(measurementPath),
    predecessor: await loadPredecessorPins(),
    profile: BLOCK835_V3T_PROFILE,
  });
}

async function assertWritableTarget(targetDir) {
  const found = await stat(targetDir).catch(() => null);
  const existing = found === null ? "absent" : found.isDirectory() ? "directory" : "file";
  const decision = decidePackageTarget({
    targetDir, packageDir: PACKAGE_DIR, scratchRoot: resolve(ROOT, "artifacts"), separator: sep, existing,
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
  await writeFile(join(targetDir, "registration.json"), `${stableSerialize({ packageId: BLOCK835_V3T_PACKAGE_ID, ...V3_REGISTRATION_METHOD, tolerance: V3_REGISTRATION_TOLERANCE, entries: assembled.registration })}\n`, "utf8");
  return assembled;
}

function catalogRecord() {
  const tiles = [...proceduralTextureCatalog().values()].map((tile) => ({
    textureClass: tile.textureClass,
    widthPixels: tile.widthPixels, heightPixels: tile.heightPixels,
    tileUMm: tile.tileUMm, tileVMm: tile.tileVMm,
    millimetresPerPixelU: tile.tileUMm / tile.widthPixels,
    millimetresPerPixelV: tile.tileVMm / tile.heightPixels,
    pngByteLength: tile.pngBytes.byteLength,
    pngSha256: tile.pngSha256,
    meanModulation: tile.meanModulation,
  }));
  return {
    schemaVersion: "1.0",
    packageId: BLOCK835_V3T_PACKAGE_ID,
    profile: PROCEDURAL_TEXTURE_PROFILE,
    rasterizerVersion: PROCEDURAL_TEXTURE_RASTERIZER_VERSION,
    parametersHashSha256: proceduralTextureParametersHash(),
    tilePixels: PROCEDURAL_TEXTURE_TILE_PIXELS,
    limits: PROCEDURAL_TEXTURE_LIMITS,
    imageSource: "Rasterized in-repo from named constants by src/release/procedural-texture.ts. No image was ingested, decoded, traced, sampled or reproduced.",
    motifs: PROCEDURAL_TEXTURE_PARAMETERS,
    palette: V3T_CALIBRATED_PALETTE,
    tiles,
  };
}

/** Writes the catalogue PNGs for inspection and its hashed record for the ledger. */
async function tiles(targetDir) {
  await mkdir(targetDir, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });
  for (const tile of proceduralTextureCatalog().values()) await writeFile(join(targetDir, `${tile.textureClass}.png`), tile.pngBytes);
  const record = catalogRecord();
  await writeFile(CATALOG_PATH, `${stableSerialize(record)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "tiles", dir: targetDir, path: CATALOG_PATH, parametersHashSha256: record.parametersHashSha256, tiles: record.tiles.map((tile) => ({ textureClass: tile.textureClass, pngByteLength: tile.pngByteLength, pngSha256: tile.pngSha256 })) }, null, 2));
}

async function authoringInputs(targetDir, measurementPath) {
  const { release } = await loadPilot();
  const assembled = await assemble(measurementPath);
  await mkdir(targetDir, { recursive: true });
  const index = [];
  for (const building of readPilotBuildings(release)) {
    const { plan } = buildV3Plan(building);
    const asset = assembled.manifest.assets.find((entry) => entry.canonicalFeatureId === building.canonicalBuildingId);
    const entry = {
      canonicalBuildingId: building.canonicalBuildingId,
      planPath: join(V3_DATA_DIR, "plans", `${slug(building.canonicalBuildingId)}.json`),
      planHashSha256: plan.planHashSha256,
      styleClass: plan.styleClass,
      heightMeters: building.heightMeters,
      textureClasses: [...new Set(plan.materials.map((material) => v3TextureClassFor(plan.styleClass, material.id)).filter((value) => value !== null))].sort(),
      lod0TextureCount: asset.lods[0].quality.textureCount,
      shippedGlb: { lod_0: `private/assets/${slug(building.canonicalBuildingId)}__lod_0.glb`, lod_1: `private/assets/${slug(building.canonicalBuildingId)}__lod_1.glb` },
    };
    await writeFile(join(targetDir, `${slug(building.canonicalBuildingId)}.json`), `${stableSerialize(entry)}\n`, "utf8");
    index.push({ canonicalBuildingId: entry.canonicalBuildingId, planHashSha256: entry.planHashSha256, styleClass: entry.styleClass, textureClasses: entry.textureClasses });
  }
  await writeFile(join(targetDir, "index.json"), `${stableSerialize({ packageId: BLOCK835_V3T_PACKAGE_ID, generatedAt: BLOCK835_V3_GENERATED_AT, profile: PROCEDURAL_TEXTURE_PROFILE, parametersHashSha256: proceduralTextureParametersHash(), buildings: index })}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "authoring", buildings: index.length, dir: targetDir }, null, 2));
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

/**
 * The census gate, and the byte-cost report the ADR quotes.
 *
 * Every plan hash is re-checked against the frozen V3 package: V3T's whole claim
 * is that it changes the SURFACE and not the geometry, and a moved plan hash
 * would falsify that silently.
 */
async function census(measurementPath) {
  const { release } = await loadPilot();
  const buildings = readPilotBuildings(release);
  const assembled = await assemble(measurementPath);
  const v3Manifest = JSON.parse(await readFile(join(V3_PACKAGE_DIR, "manifest.json"), "utf8").catch(() => fail("The frozen V3 manifest is required for the plan-hash and byte comparison.")));
  const v3AssetById = new Map(v3Manifest.assets.map((asset) => [asset.canonicalFeatureId, asset]));
  const v3ArtifactByRef = new Map(v3Manifest.artifacts.map((artifact) => [artifact.relativeRef, artifact]));
  const artifactByRef = new Map(assembled.manifest.artifacts.map((artifact) => [artifact.relativeRef, artifact]));
  const catalog = proceduralTextureCatalog();
  const registrationById = new Map(assembled.registration.map((entry) => [entry.canonicalBuildingId, entry]));

  const rows = buildings.map((building) => {
    const { plan } = buildV3Plan(building);
    const asset = assembled.manifest.assets.find((entry) => entry.canonicalFeatureId === building.canonicalBuildingId);
    if (!asset) fail(`Census is missing a shipped asset for ${building.canonicalBuildingId}.`);
    const previous = v3AssetById.get(building.canonicalBuildingId);
    if (!previous) fail(`The frozen V3 package has no asset for ${building.canonicalBuildingId}.`);
    if (previous.source.planHashSha256 !== plan.planHashSha256) fail(`V3T moved the plan hash for ${building.canonicalBuildingId}; texturing must not touch the grammar.`);
    const textureClasses = [...new Set(plan.materials.map((material) => v3TextureClassFor(plan.styleClass, material.id)).filter((value) => value !== null))].sort();
    const entry = registrationById.get(building.canonicalBuildingId);
    return {
      canonicalBuildingId: building.canonicalBuildingId,
      planHashSha256: plan.planHashSha256,
      styleClass: plan.styleClass,
      textureClasses,
      lods: asset.lods.map((lod) => {
        const previousLod = previous.lods.find((candidate) => candidate.lodId === lod.lodId);
        const bytes = artifactByRef.get(lod.artifactRef).byteSize;
        const previousBytes = v3ArtifactByRef.get(previousLod.artifactRef).byteSize;
        const imageBytes = lod.lodId === "lod_0" ? textureClasses.reduce((sum, textureClass) => sum + catalog.get(textureClass).pngBytes.byteLength, 0) : 0;
        return {
          lodId: lod.lodId,
          triangleCount: lod.quality.triangleCount, materialCount: lod.quality.materialCount, textureCount: lod.quality.textureCount,
          byteSize: bytes, v3ByteSize: previousBytes, byteDelta: bytes - previousBytes,
          imageByteTotal: imageBytes,
          // Everything the tiles did not pay for: the TEXCOORD_0 accessors,
          // their bufferViews, the sampler/texture/image JSON, and padding.
          uvAndJsonByteDelta: bytes - previousBytes - imageBytes,
          triangleCountUnchanged: lod.quality.triangleCount === previousLod.quality.triangleCount,
          withinBudget: lod.quality.triangleCount <= V3T_QUALITY_BUDGETS.maxTriangles
            && lod.quality.materialCount <= V3T_QUALITY_BUDGETS.maxMaterials
            && lod.quality.textureCount <= V3T_QUALITY_BUDGETS.maxTextures
            && imageBytes <= PROCEDURAL_TEXTURE_LIMITS.maxGlbImageBytes,
        };
      }),
      registration: {
        perVertexShapeDeviationMeters: entry.perVertexShapeDeviationMeters,
        horizontalDeviationMeters: entry.horizontalDeviationMeters,
        verticalDeviationMeters: entry.verticalDeviationMeters,
        withinTolerance: entry.withinTolerance,
      },
    };
  });

  if (rows.length !== 14) fail(`Census must cover all fourteen Block 835 buildings; it covered ${rows.length}.`);
  const hashes = rows.map((row) => row.planHashSha256);
  if (new Set(hashes).size !== hashes.length) fail("Census found duplicate plan hashes.");
  const offending = rows.filter((row) => !row.registration.withinTolerance || row.lods.some((lod) => !lod.withinBudget || !lod.triangleCountUnchanged));
  if (offending.length > 0) fail(`Census gate failed for: ${offending.map((row) => row.canonicalBuildingId).join(", ")}`);
  if (rows.some((row) => row.lods.find((lod) => lod.lodId === "lod_1").textureCount !== 0)) fail("LOD 1 must stay texture-free.");
  if (rows.some((row) => row.lods.find((lod) => lod.lodId === "lod_0").textureCount === 0)) fail("LOD 0 must carry detail tiles in the textured package.");

  const lod0 = rows.map((row) => row.lods.find((lod) => lod.lodId === "lod_0"));
  const file = {
    schemaVersion: "1.0",
    packageId: BLOCK835_V3T_PACKAGE_ID,
    predecessorPackageId: BLOCK835_V3_PACKAGE_ID,
    generatedAt: BLOCK835_V3_GENERATED_AT,
    profile: PROCEDURAL_TEXTURE_PROFILE,
    parametersHashSha256: proceduralTextureParametersHash(),
    budgets: V3T_QUALITY_BUDGETS,
    imageLimits: PROCEDURAL_TEXTURE_LIMITS,
    summary: {
      buildings: rows.length,
      planHashesUnchangedFromV3: true,
      distinctTextureClasses: [...new Set(rows.flatMap((row) => row.textureClasses))].sort(),
      worstLod0TextureCount: Math.max(...lod0.map((lod) => lod.textureCount)),
      worstLod0ImageBytes: Math.max(...lod0.map((lod) => lod.imageByteTotal)),
      worstLod0ByteDelta: Math.max(...lod0.map((lod) => lod.byteDelta)),
      totalByteDelta: assembled.manifest.declaredTotalBytes - v3Manifest.declaredTotalBytes,
      v3DeclaredTotalBytes: v3Manifest.declaredTotalBytes,
      declaredTotalBytes: assembled.manifest.declaredTotalBytes,
    },
    buildings: rows,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CENSUS_PATH, `${stableSerialize(file)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "census", ...file.summary, path: CENSUS_PATH }, null, 2));
}

/**
 * The gate that carries the honesty claim: the package is replayed through the
 * procedural policy, which regenerates every embedded PNG and demands byte
 * equality. It is also replayed under the OLD texture-free policy, which must
 * reject it — a package that passes both would mean the texture-free gate had
 * been quietly widened.
 */
async function replay(measurementPath) {
  const assembled = await assemble(measurementPath);
  const accepted = await replayMultiLodAssembly(assembled.manifest, assembled.contents, { proceduralTextureProfile: PROCEDURAL_TEXTURE_PROFILE });
  if (!accepted.ok) fail(`Procedural replay failed: ${accepted.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" | ")}`);
  const refused = await replayMultiLodAssembly(assembled.manifest, assembled.contents, { requireTextureFreeAssembly: true });
  if (refused.ok) fail("A textured package passed the texture-free gate; the embedded-image gate has been weakened.");
  // The replay gate does not depend on the policy flag being passed: it is keyed
  // off each GLB's own declared provenance, so a caller that omits the flag —
  // the browser runtime omits it — still regenerates and byte-compares every
  // embedded tile. This third pass proves that, rather than assuming it.
  const undeclared = await replayMultiLodAssembly(assembled.manifest, assembled.contents);
  if (!undeclared.ok) fail(`Replay without the policy flag failed: ${undeclared.issues.map((issue) => issue.message).join(" | ")}`);

  console.log(JSON.stringify({
    ok: true, command: "replay",
    fingerprintSha256: accepted.value.fingerprintSha256,
    verifiedArtifacts: accepted.value.verifiedArtifacts.length,
    totalBytes: accepted.value.totalBytes,
    parametersHashSha256: proceduralTextureParametersHash(),
    textureFreePolicyRefusals: refused.issues.length,
    rasterizerReplay: "every embedded PNG regenerated from named constants and byte-compared",
  }, null, 2));
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
  const differing = Object.keys(treeA).filter((key) => treeA[key] !== treeB[key]);
  if (Object.keys(treeA).length !== Object.keys(treeB).length || differing.length > 0) fail(`Non-deterministic artifacts: ${differing.join(", ") || "artifact set differs"}`);
  const fingerprintA = multiLodAssemblyFingerprint(runA.manifest); const fingerprintB = multiLodAssemblyFingerprint(runB.manifest);
  if (fingerprintA !== fingerprintB) fail("Multi-LOD assembly fingerprint differs between identical runs.");
  console.log(JSON.stringify({ ok: true, command: "determinism", files: Object.keys(treeA).length, fingerprintSha256: fingerprintA }, null, 2));
}

async function promoteEvidenceInventory(sourcePath) {
  const inventory = JSON.parse(await readFile(sourcePath, "utf8").catch(() => fail(`Blender evidence inventory is required at ${sourcePath}.`)));
  if (inventory.packageId !== BLOCK835_V3T_PACKAGE_ID || !Array.isArray(inventory.files) || inventory.files.length === 0) fail("Blender evidence inventory does not match the approved package identity.");
  await mkdir(DATA_DIR, { recursive: true });
  const written = [join(DATA_DIR, "blender-evidence-inventory.json")];
  await writeFile(written[0], `${stableSerialize(inventory)}\n`, "utf8");
  const evidenceRoot = dirname(sourcePath);
  for (const [name, target, gate] of [
    ["volume-identity.json", "blender-volume-identity.json", (payload) => payload.worstRelativeDeviation <= payload.relativeTolerance],
    ["reimport-up-axis-diff.json", "blender-reimport-up-axis.json", (payload) => payload.files.every((entry) => entry.upAxisIsYUpInFile)],
    ["texture-reimport.json", "blender-texture-reimport.json", (payload) => payload.files.every((entry) => entry.importedWithoutError && entry.uvLayerPresent === entry.expectsUvLayer)],
  ]) {
    const payload = JSON.parse(await readFile(join(evidenceRoot, name), "utf8").catch(() => fail(`Blender ${name} is required next to the evidence inventory.`)));
    if (payload.packageId !== BLOCK835_V3T_PACKAGE_ID) fail(`Blender ${name} does not match the approved package identity.`);
    if (!gate(payload)) fail(`Blender ${name} does not pass its own stated gate; refusing to promote it.`);
    const path = join(DATA_DIR, target);
    await writeFile(path, `${stableSerialize(payload)}\n`, "utf8");
    written.push(path);
  }
  console.log(JSON.stringify({ ok: true, command: "evidence", files: inventory.files.length, promoted: written }, null, 2));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const parsed = options(rest);
  const measurements = parsed.measurements ? resolve(parsed.measurements) : MEASUREMENT_PATH;
  switch (command) {
    case "tiles": return tiles(resolve(parsed.out ?? join(EVIDENCE_ROOT, "tiles")));
    case "authoring": return authoringInputs(resolve(parsed.out ?? join(EVIDENCE_ROOT, "inputs")), measurements);
    case "build": return build(parsed.out ? resolve(parsed.out) : PACKAGE_DIR, measurements);
    case "census": return census(measurements);
    case "replay": return replay(measurements);
    case "determinism": return determinism(resolve(parsed.scratch ?? join(ROOT, "artifacts", "block835-v3t-determinism")), measurements);
    case "evidence": return promoteEvidenceInventory(resolve(parsed.evidence ?? join(EVIDENCE_ROOT, "evidence-inventory.json")));
    default: return fail(`Usage: block835-v3t-texture-cli.mjs <tiles|authoring|build|census|replay|determinism|evidence> [--out DIR] [--scratch DIR] [--measurements FILE] [--evidence FILE]. Known classes: ${PROCEDURAL_TEXTURE_CLASSES.join(", ")}`);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
