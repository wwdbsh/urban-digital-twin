/* global console, process, TextDecoder */
/**
 * T028 operator entrypoint for the Cesium sampler-aliasing evidence.
 *
 * Commands
 *   plan      Write the harness input: the two built sampler variants, their
 *             per-building LOD 0 artifacts, WGS84 anchors, and the fixed camera
 *             stations both variants are captured at.
 *   evidence  Hash the captured stills and the harness input, and commit the
 *             checksummed evidence record beside the V3T census.
 *
 * Nothing here builds, publishes or mutates a release. The two variant packages
 * are produced by `block835-v3t-texture-cli.mjs build --out ... --sampler-filter ...`
 * into the gitignored `artifacts/` scratch root; their GLB payloads are never
 * committed. What IS committed is this record: checksums, byte sizes, the camera
 * stations, and the written verdict, so the evidence stays checkable after the
 * scratch tree is removed.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BLOCK835_PILOT_RELEASE_ID, BLOCK835_V3T_PACKAGE_ID, readPilotBuildings } from "../src/release/block835-reference-package.ts";
import { sha256HexBytes, stableSerialize } from "../src/domain/deterministic-hash.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SAMPLER_EVIDENCE_SCRATCH_DIR = join(ROOT, "artifacts", "block835-v3t-cesium-20260811");
const PILOT_RELEASE_PATH = join(ROOT, "public", "data", BLOCK835_PILOT_RELEASE_ID, "release.json");
const DATA_DIR = join(ROOT, "data", BLOCK835_V3T_PACKAGE_ID);
const EVIDENCE_PATH = join(DATA_DIR, "cesium-sampler-evidence.json");
/**
 * Derived from the scratch root in use, never from the default.
 *
 * The two commands take `--scratch`, and a harness input bound to the default
 * root while the variant packages and the captures came from another one would
 * hash a plan that does not describe the images beside it -- a mixed-root
 * evidence record that still looks internally consistent.
 */
const harnessPathFor = (scratchDir) => join(scratchDir, "harness.json");

/** The two builds compared. `renderer-default` is the shape the committed V3T package ships. */
export const SAMPLER_VARIANTS = [
  { variantId: "renderer-default", samplerFilter: null, note: "Writer emits wrapS/wrapT only; minification and magnification are whatever the renderer picks." },
  { variantId: "trilinear", samplerFilter: { magFilter: 9729, minFilter: 9987 }, note: "LINEAR magnification with LINEAR_MIPMAP_LINEAR minification, named in the shipped bytes." },
];

const ESB_BUILDING_ID = "doitt:778052";

/**
 * Fixed camera stations, derived from the Empire State Building anchor.
 *
 * All three look at the SAME building from the SAME bearing, so the only thing
 * that differs between two captures at one station is the sampler. The far
 * station exists because that is where the aliasing question actually lives: the
 * ESB shaft carries roughly 160 vertical tile repeats, and a station that puts
 * the whole shaft inside the frame puts several tile periods inside one screen
 * pixel — the regime where an unmipmapped sampler produces moire.
 */
const STATIONS = [
  // Ground distances are measured from the ESB CENTROID, so anything under
  // roughly 70 m is inside its own footprint. A first pass at 28 m put the
  // camera inside the massing and produced an unlit interior; the station was
  // discarded on that basis rather than reported.
  { stationId: "inspection-facade", groundDistanceMeters: 95, eyeHeightMeters: 20, pitchDegrees: 10, note: "Inspection profile: street-level, looking up at the lower facade, well inside the LOD 0 range." },
  { stationId: "exploration-street", groundDistanceMeters: 220, eyeHeightMeters: 95, pitchDegrees: -6, note: "Exploration profile: block seen from across the avenue, several buildings in frame." },
  { stationId: "far-shaft-repeats", groundDistanceMeters: 620, eyeHeightMeters: 230, pitchDegrees: -6, note: "Whole ESB shaft in frame: ~160 vertical tile repeats compressed toward the screen-pixel floor." },
];

/** Bearing FROM the building TO the camera. 225 puts the camera off the southwest corner. */
const STATION_BEARING_DEGREES = 225;

const METRES_PER_DEGREE_LATITUDE = 111_132;

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

/**
 * Offsets an anchor by a ground distance along a bearing, and returns the camera
 * heading that looks back at it. Plain equirectangular offsets: the stations are
 * hundreds of metres, not kilometres, and the numbers only have to be REPEATABLE
 * between two captures, not geodetically exact.
 */
function station(anchor, entry) {
  const bearing = (STATION_BEARING_DEGREES * Math.PI) / 180;
  const north = Math.cos(bearing) * entry.groundDistanceMeters;
  const east = Math.sin(bearing) * entry.groundDistanceMeters;
  const metresPerDegreeLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((anchor.latitude * Math.PI) / 180);
  return {
    stationId: entry.stationId,
    note: entry.note,
    targetBuildingId: ESB_BUILDING_ID,
    groundDistanceMeters: entry.groundDistanceMeters,
    longitude: anchor.longitude + east / metresPerDegreeLongitude,
    latitude: anchor.latitude + north / METRES_PER_DEGREE_LATITUDE,
    heightMeters: entry.eyeHeightMeters,
    // Look back along the reciprocal bearing.
    headingDegrees: (STATION_BEARING_DEGREES + 180) % 360,
    pitchDegrees: entry.pitchDegrees,
    rollDegrees: 0,
  };
}

async function loadPilotBuildings() {
  const release = JSON.parse(await readFile(PILOT_RELEASE_PATH, "utf8").catch(() => fail(`The pinned pilot release is required at ${PILOT_RELEASE_PATH}.`)));
  return readPilotBuildings(release);
}

async function variantAssets(variantDir, buildings) {
  const manifestPath = join(variantDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8").catch(() => fail(`Build the variant first: ${manifestPath} is absent. Run: pnpm block835-v3t:build --out <dir> --sampler-filter <variant>.`)));
  if (manifest.packageId !== BLOCK835_V3T_PACKAGE_ID) fail(`${manifestPath} is not a ${BLOCK835_V3T_PACKAGE_ID} package.`);
  const artifactByRef = new Map(manifest.artifacts.map((artifact) => [artifact.relativeRef, artifact]));
  const anchorById = new Map(buildings.map((building) => [building.canonicalBuildingId, building.anchor]));
  return manifest.assets.map((asset) => {
    const lod0 = asset.lods.find((lod) => lod.lodId === "lod_0") ?? fail(`Asset ${asset.canonicalFeatureId} has no lod_0.`);
    const artifact = artifactByRef.get(lod0.artifactRef) ?? fail(`Asset ${asset.canonicalFeatureId} lod_0 has no artifact declaration.`);
    const anchor = anchorById.get(asset.canonicalFeatureId) ?? fail(`No pilot anchor for ${asset.canonicalFeatureId}.`);
    return {
      canonicalBuildingId: asset.canonicalFeatureId,
      relativeRef: lod0.artifactRef,
      byteSize: artifact.byteSize,
      checksumSha256: artifact.checksumSha256,
      textureCount: lod0.quality.textureCount,
      longitude: anchor.longitude,
      latitude: anchor.latitude,
    };
  }).sort((left, right) => (left.canonicalBuildingId < right.canonicalBuildingId ? -1 : 1));
}

async function plan(scratchDir) {
  const buildings = await loadPilotBuildings();
  const esb = buildings.find((building) => building.canonicalBuildingId === ESB_BUILDING_ID) ?? fail(`The pilot release has no ${ESB_BUILDING_ID}.`);
  const variants = [];
  for (const variant of SAMPLER_VARIANTS) {
    const assets = await variantAssets(join(scratchDir, variant.variantId), buildings);
    if (assets.some((asset) => asset.textureCount === 0)) fail(`Variant ${variant.variantId} has an untextured LOD 0; the comparison would be meaningless.`);
    variants.push({ ...variant, assets });
  }
  const record = {
    schemaVersion: "1.0",
    packageId: BLOCK835_V3T_PACKAGE_ID,
    purpose: "T028 shipping-renderer sampler-aliasing evidence. Dev-only harness input; no release, no allow-list entry, no partition change.",
    stations: STATIONS.map((entry) => station(esb.anchor, entry)),
    variants,
  };
  await mkdir(scratchDir, { recursive: true });
  const harnessPath = harnessPathFor(scratchDir);
  await writeFile(harnessPath, `${stableSerialize(record)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "plan", path: harnessPath, variants: variants.map((entry) => ({ variantId: entry.variantId, assets: entry.assets.length })), stations: record.stations.map((entry) => entry.stationId) }, null, 2));
}

async function evidence(scratchDir, verdictPath) {
  const harnessPath = harnessPathFor(scratchDir);
  const harnessBytes = new Uint8Array(await readFile(harnessPath).catch(() => fail(`Run \`plan\` first; ${harnessPath} is absent.`)));
  const harness = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(harnessBytes));
  const verdict = JSON.parse(await readFile(verdictPath, "utf8").catch(() => fail(`A written aliasing/legibility verdict is required at ${verdictPath}.`)));
  for (const key of ["decision", "samplerFilter", "reading", "capturedAt", "renderer", "viewport"]) {
    if (verdict[key] === undefined) fail(`The verdict record is missing \`${key}\`.`);
  }
  const captureDir = join(scratchDir, "captures");
  const names = (await readdir(captureDir).catch(() => fail(`Captured stills are required in ${captureDir}.`))).filter((name) => name.endsWith(".png")).sort();
  if (names.length === 0) fail(`No captured stills in ${captureDir}.`);
  const captures = [];
  for (const name of names) {
    const bytes = new Uint8Array(await readFile(join(captureDir, name)));
    captures.push({ file: name, byteSize: bytes.byteLength, sha256: sha256HexBytes(bytes) });
  }
  const expected = harness.stations.flatMap((entry) => harness.variants.map((variant) => `${entry.stationId}__${variant.variantId}.png`)).sort();
  const missing = expected.filter((name) => !names.includes(name));
  if (missing.length > 0) fail(`Every station must be captured for BOTH variants; missing: ${missing.join(", ")}.`);
  const record = {
    schemaVersion: "1.0",
    packageId: BLOCK835_V3T_PACKAGE_ID,
    purpose: "ADR 0032 precondition 7: Cesium-side filtering and aliasing, measured in the shipping renderer.",
    harnessInput: { file: "harness.json", byteSize: harnessBytes.byteLength, sha256: sha256HexBytes(harnessBytes) },
    stations: harness.stations,
    variants: harness.variants.map((variant) => ({ variantId: variant.variantId, samplerFilter: variant.samplerFilter, note: variant.note })),
    captures,
    verdict,
    scratchRootNote: "The capture PNGs and the two variant GLB packages live in the gitignored artifacts/ scratch root and are deliberately not committed. Their checksums above keep this record checkable after that tree is removed.",
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(EVIDENCE_PATH, `${stableSerialize(record)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, command: "evidence", path: EVIDENCE_PATH, captures: captures.length, decision: verdict.decision }, null, 2));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const parsed = options(rest);
  const scratchDir = parsed.scratch ? resolve(parsed.scratch) : SAMPLER_EVIDENCE_SCRATCH_DIR;
  switch (command) {
    case "plan": return plan(scratchDir);
    case "evidence": return evidence(scratchDir, parsed.verdict ? resolve(parsed.verdict) : join(scratchDir, "verdict.json"));
    default: return fail("Usage: block835-v3t-sampler-evidence-cli.mjs <plan|evidence> [--scratch DIR] [--verdict FILE].");
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
