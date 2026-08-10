#!/usr/bin/env node
/* global console, process */
/**
 * Derive the deterministic Block 835 canary facade camera path from committed
 * release bytes.
 *
 * Two byte sources, both recorded with their own hashes so a reader can
 * recompute every number in the emitted fixture:
 *
 * 1. `data/manhattan-esb-block-reference-20260811/plans/<building>.json` — the
 *    committed V2 facade plans. Tier 0 is the widest tier, so its `minX/maxX/
 *    minY/maxY` bounds are the ground-level facade planes in local millimetres,
 *    and the plan's own `planHashSha256` pins the bytes the extents came from.
 * 2. The citywide base geometry shard that carries the building's WGS84
 *    `coordinates`. This is the anchor the renderer actually uses: exterior-cell
 *    entities are placed at `baseFeature.coordinates` with an ENU orientation
 *    (`planExteriorOverlayUpdate` in `src/features/explorer/CesiumViewport.tsx`),
 *    so no other anchor would describe the geometry that is on screen.
 *
 * The pose specs below are declarative. Everything else — standoff, camera
 * height, pitch, longitude, latitude — is computed here, so the fixture is a
 * derivation and not a hand-written camera list.
 *
 * Usage: node scripts/block835-canary-facade-path-cli.mjs [--check]
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_DIR = join(repoRoot, "data/manhattan-esb-block-reference-20260811/plans");
const CITYWIDE_GEOMETRY_DIR = join(repoRoot, "public/data/manhattan-citywide-20260804/geometry/buildings");
const OUTPUT_DIR = join(repoRoot, "data/block835-canary-validation-20260811");
const OUTPUT_FILE = join(OUTPUT_DIR, "facade-path.json");

export const BLOCK835_CANARY_FACADE_PATH_ID = "block835-canary-facade-v1";

/**
 * Declared framing reference. CesiumJS applies its default 60 degree field of
 * view to the *wider* viewport axis, so on a landscape 16:9 viewport the
 * vertical half-angle is atan(tan(30 deg) / (16/9)) = 18.005 degrees. Any pose
 * that claims a roofline is in frame must stand off far enough for that angle.
 * The real viewport aspect is recorded at run time; this is the assumption the
 * standoff was solved against, not a measurement.
 */
const REFERENCE_ASPECT = { width: 16, height: 9 };
const VERTICAL_HALF_ANGLE_DEG = (Math.atan(Math.tan((30 * Math.PI) / 180) / (REFERENCE_ASPECT.width / REFERENCE_ASPECT.height)) * 180) / Math.PI;

/** Contract floor: no accepted Block 835 facade viewpoint is closer than 10 m. */
const MINIMUM_CAMERA_TO_FACADE_METERS = 10;

/**
 * `full-facade` solves the standoff so the whole building height fits the
 * declared vertical framing with a level camera. `street-level-lower-facade` is
 * a fixed close standoff with the camera pitched up; it inspects the lower
 * facade of a tower and explicitly does not claim the roofline.
 */
const POSE_SPECS = [
  { poseId: "canary-facade-01", buildingId: "doitt:262867", facade: "south", framing: "full-facade" },
  { poseId: "canary-facade-02", buildingId: "doitt:102705", facade: "west", framing: "full-facade" },
  { poseId: "canary-facade-03", buildingId: "doitt:498980", facade: "north", framing: "full-facade" },
  { poseId: "canary-facade-04", buildingId: "doitt:39969", facade: "east", framing: "full-facade" },
  { poseId: "canary-facade-05", buildingId: "doitt:835659", facade: "south", framing: "full-facade" },
  { poseId: "canary-facade-06", buildingId: "doitt:584049", facade: "west", framing: "full-facade" },
  { poseId: "canary-facade-07", buildingId: "doitt:982383", facade: "east", framing: "street-level-lower-facade" },
  { poseId: "canary-facade-08", buildingId: "doitt:778052", facade: "north", framing: "street-level-lower-facade" },
];

const STREET_LEVEL_STANDOFF_METERS = 25;
const STREET_LEVEL_CAMERA_HEIGHT_METERS = 12;
const STREET_LEVEL_PITCH_DEGREES = 25;

/** Camera sits on the outward side of the named facade and looks back at it. */
const FACADE_GEOMETRY = {
  east: { heading: 270, axis: "x", sign: 1 },
  west: { heading: 90, axis: "x", sign: -1 },
  north: { heading: 180, axis: "y", sign: 1 },
  south: { heading: 0, axis: "y", sign: -1 },
};

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Round to a fixed number of decimals so the fixture is byte-reproducible. */
function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * WGS84 metres-per-degree at a latitude. The standard truncated series is used
 * so a reader can reproduce it without a geodesy library; over the ~600 m the
 * path spans it is well inside the metre the poses are quoted to.
 */
export function metersPerDegree(latitudeDegrees) {
  const phi = (latitudeDegrees * Math.PI) / 180;
  return {
    latitude: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi),
    longitude: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
  };
}

/** Standoff that fits `heightMeters` in the declared vertical framing. */
export function fullFacadeStandoffMeters(heightMeters) {
  const halfAngle = (VERTICAL_HALF_ANGLE_DEG * Math.PI) / 180;
  return Math.ceil(heightMeters / (2 * Math.tan(halfAngle)));
}

/** Pure pose derivation. Every input is a committed-byte fact. */
export function deriveFacadePose(spec, building) {
  const facade = FACADE_GEOMETRY[spec.facade];
  if (!facade) throw new Error(`Unknown facade ${spec.facade} for ${spec.poseId}.`);
  const halfExtentMeters = facade.axis === "x" ? building.tier0HalfExtentEastMeters : building.tier0HalfExtentNorthMeters;
  const fullFacade = spec.framing === "full-facade";
  const standoffMeters = fullFacade
    ? Math.max(MINIMUM_CAMERA_TO_FACADE_METERS, fullFacadeStandoffMeters(building.heightMeters))
    : STREET_LEVEL_STANDOFF_METERS;
  const cameraHeightMeters = fullFacade ? round(building.heightMeters / 2, 3) : STREET_LEVEL_CAMERA_HEIGHT_METERS;
  const pitchDegrees = fullFacade ? 0 : STREET_LEVEL_PITCH_DEGREES;
  const offsetMeters = facade.sign * (halfExtentMeters + standoffMeters);
  const scale = metersPerDegree(building.anchorLatitude);
  const longitude = facade.axis === "x" ? building.anchorLongitude + offsetMeters / scale.longitude : building.anchorLongitude;
  const latitude = facade.axis === "y" ? building.anchorLatitude + offsetMeters / scale.latitude : building.anchorLatitude;
  const verticalExtentMeters = 2 * standoffMeters * Math.tan((VERTICAL_HALF_ANGLE_DEG * Math.PI) / 180);
  return {
    poseId: spec.poseId,
    buildingId: spec.buildingId,
    facade: spec.facade,
    framing: spec.framing,
    // The perpendicular camera-to-facade-plane distance. Recompute it as
    // |offsetMeters| - halfExtentMeters from the numbers in this record.
    cameraToFacadeMeters: standoffMeters,
    cameraToBuildingCentreMeters: round(Math.abs(offsetMeters), 3),
    tier0HalfExtentMeters: round(halfExtentMeters, 3),
    buildingHeightMeters: round(building.heightMeters, 3),
    rooflineInFrame: fullFacade && verticalExtentMeters >= building.heightMeters,
    referenceVerticalExtentMeters: round(verticalExtentMeters, 3),
    pose: {
      longitude: round(longitude, 9),
      latitude: round(latitude, 9),
      height: cameraHeightMeters,
      heading: facade.heading,
      pitch: pitchDegrees,
      roll: 0,
    },
    anchor: {
      longitude: building.anchorLongitude,
      latitude: building.anchorLatitude,
      source: building.anchorSource,
    },
    plan: {
      file: building.planFile,
      planHashSha256: building.planHashSha256,
      fileSha256: building.planFileSha256,
      tier0BoundsMm: building.tier0BoundsMm,
      heightMm: building.heightMm,
    },
  };
}

function readPlans() {
  const plans = new Map();
  for (const name of readdirSync(PLAN_DIR).sort()) {
    if (!name.endsWith(".json") || name === "plan-index.json") continue;
    const bytes = readFileSync(join(PLAN_DIR, name));
    const plan = JSON.parse(bytes.toString("utf8"));
    const tier0 = plan.tiers.find((tier) => tier.index === 0);
    if (!tier0) throw new Error(`Plan ${name} has no tier 0.`);
    plans.set(plan.input.buildingId, {
      planFile: `data/manhattan-esb-block-reference-20260811/plans/${name}`,
      planHashSha256: plan.planHashSha256,
      planFileSha256: sha256Hex(bytes),
      heightMm: plan.input.geometry.heightMm,
      heightMeters: plan.input.geometry.heightMm / 1000,
      tier0BoundsMm: { minX: tier0.minX, maxX: tier0.maxX, minY: tier0.minY, maxY: tier0.maxY },
      tier0HalfExtentEastMeters: tier0.maxX / 1000,
      tier0HalfExtentNorthMeters: tier0.maxY / 1000,
    });
  }
  return plans;
}

function readAnchors(buildingIds) {
  const wanted = new Set(buildingIds);
  const anchors = new Map();
  for (const name of readdirSync(CITYWIDE_GEOMETRY_DIR).sort()) {
    if (!name.endsWith(".json")) continue;
    const bytes = readFileSync(join(CITYWIDE_GEOMETRY_DIR, name));
    if (!buildingIds.some((id) => bytes.includes(id.split(":")[1]))) continue;
    const shard = JSON.parse(bytes.toString("utf8"));
    let shardSha = null;
    for (const feature of shard.features ?? []) {
      const parentId = feature.parentId;
      if (!wanted.has(parentId) || anchors.has(parentId)) continue;
      shardSha ??= sha256Hex(bytes);
      anchors.set(parentId, {
        longitude: feature.coordinates[0],
        latitude: feature.coordinates[1],
        source: {
          releaseId: "manhattan-citywide-20260804",
          file: `public/data/manhattan-citywide-20260804/geometry/buildings/${name}`,
          fileSha256: shardSha,
          partId: feature.partId,
          heightMeters: feature.heightMeters,
          note: "Exterior-cell entities are anchored at this base building coordinate, so it is the anchor the rendered geometry actually uses.",
        },
      });
    }
    if (anchors.size === wanted.size) break;
  }
  return anchors;
}

export function buildFacadePathFixture() {
  const plans = readPlans();
  const buildingIds = [...new Set(POSE_SPECS.map((spec) => spec.buildingId))];
  const anchors = readAnchors(buildingIds);
  const poses = POSE_SPECS.map((spec) => {
    const plan = plans.get(spec.buildingId);
    if (!plan) throw new Error(`No committed plan for ${spec.buildingId}.`);
    const anchor = anchors.get(spec.buildingId);
    if (!anchor) throw new Error(`No citywide base anchor for ${spec.buildingId}.`);
    return deriveFacadePose(spec, {
      ...plan,
      anchorLongitude: anchor.longitude,
      anchorLatitude: anchor.latitude,
      anchorSource: anchor.source,
    });
  });
  const closest = Math.min(...poses.map((pose) => pose.cameraToFacadeMeters));
  if (closest < MINIMUM_CAMERA_TO_FACADE_METERS) throw new Error(`Pose closer than the ${MINIMUM_CAMERA_TO_FACADE_METERS} m contract floor: ${closest} m.`);
  return {
    schemaVersion: "1.0",
    pathId: BLOCK835_CANARY_FACADE_PATH_ID,
    generator: "urban-digital-twin:block835-canary-facade-path",
    minimumCameraToFacadeMeters: MINIMUM_CAMERA_TO_FACADE_METERS,
    closestCameraToFacadeMeters: closest,
    framingReference: {
      note: "CesiumJS applies its default 60 degree field of view to the wider viewport axis. These standoffs were solved against the declared aspect below; the real viewport aspect is recorded with each probe run and governs what was actually framed.",
      aspect: `${REFERENCE_ASPECT.width}:${REFERENCE_ASPECT.height}`,
      verticalHalfAngleDegrees: round(VERTICAL_HALF_ANGLE_DEG, 6),
    },
    poses,
  };
}

function main() {
  const check = process.argv.includes("--check");
  const fixture = buildFacadePathFixture();
  const serialized = `${JSON.stringify(fixture, null, 2)}\n`;
  if (check) {
    if (!existsSync(OUTPUT_FILE)) {
      console.error(`Missing ${OUTPUT_FILE}.`);
      process.exit(1);
    }
    const current = readFileSync(OUTPUT_FILE, "utf8");
    if (current !== serialized) {
      console.error("Committed facade path fixture does not match a fresh derivation.");
      process.exit(1);
    }
    console.log(`facade path check: ok (${fixture.poses.length} poses, closest ${fixture.closestCameraToFacadeMeters} m, fingerprint ${sha256Hex(stableSerialize(fixture))})`);
    return;
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, serialized);
  console.log(`Wrote ${OUTPUT_FILE}`);
  console.log(`${fixture.poses.length} poses, closest camera-to-facade ${fixture.closestCameraToFacadeMeters} m`);
  for (const pose of fixture.poses) {
    console.log(`  ${pose.poseId} ${pose.buildingId} ${pose.facade} ${pose.cameraToFacadeMeters} m ${pose.framing} roofline=${pose.rooflineInFrame}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
