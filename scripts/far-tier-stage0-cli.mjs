/* global console, process */
/**
 * T002 Stage 0: derive the far tier's hierarchy, resolution ladder and GPU
 * budget from committed inputs, and emit the PRE-REGISTRATION record the mass
 * bake will later be judged against.
 *
 * IT BAKES NOTHING AND CAPTURES NOTHING. It reads the pinned base snapshot's
 * own rings and heights, the committed wave ledger, and the committed cell
 * extents, and it writes arithmetic. Everything it emits is committed BEFORE a
 * single far-tier byte exists, which is what makes "pre-registered" checkable.
 *
 * Every number below is DERIVED. Nothing here is an assumed resolution or an
 * illustrative figure carried over from a plan.
 *
 * Usage:
 *   node --experimental-strip-types scripts/far-tier-stage0-cli.mjs hierarchy
 *   node --experimental-strip-types scripts/far-tier-stage0-cli.mjs preregister
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  FAR_TIER_ATLAS_PIXELS,
  FAR_TIER_BOUND_EXCLUSIONS,
  FAR_TIER_BOUND_KIND,
  FAR_TIER_BUDGET_CONTRACT,
  FAR_TIER_GPU_TEXEL_BYTES,
  FAR_TIER_MIP_CHAIN_MULTIPLIER,
  FAR_TIER_NEAR_EDGE_METERS,
  FAR_TIER_TEXEL_RATIO,
  FAR_TIER_VIEW_REFERENCE,
  farTierAtlasGpuBytes,
  farTierBudgetContractHash,
  farTierGeometryGpuBytes,
  farTierMetersPerPixel,
  farTierDeliveredQuality,
  farTierResolution,
  farTierTexelWorldSizeMeters,
} from "../src/release/far-tier-budget.ts";
import { FAR_TIER_BAKE_RECIPE, FarTierPackingUnfeasibleError, farTierRecipeHash, packFarTierAtlas } from "../src/release/far-tier-bake.ts";
import { PROCEDURAL_TEXTURE_CLASSES, proceduralTextureTile } from "../src/release/procedural-texture.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-20260818";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);
const snapshotRoot = join(repositoryRoot, "public/data/manhattan-citywide-20260804");
const ledgerRoot = join(repositoryRoot, "data/normalized/manhattan-exterior-wave-ledger-20260804");

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message) => { console.error(`far-tier-stage0: ${message}`); process.exit(1); };

/** The census's own frozen planar scale. Distances here are that metric, not geodesics. */
const METERS_PER_DEGREE_LONGITUDE = FAR_TIER_BAKE_RECIPE.metersPerDegreeLongitude;
const METERS_PER_DEGREE_LATITUDE = FAR_TIER_BAKE_RECIPE.metersPerDegreeLatitude;

/** Height substituted for the 76 buildings the source records as unknown. */
const UNKNOWN_HEIGHT_FALLBACK_METERS = 10;

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function distribution(values) {
  const sorted = [...values].sort((left, right) => left - right);
  let total = 0;
  for (const value of sorted) total += value;
  return {
    count: sorted.length,
    total,
    min: sorted[0] ?? null,
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? null,
    mean: sorted.length === 0 ? null : total / sorted.length,
  };
}

const round = (value, places = 6) => Number.parseFloat(value.toFixed(places));
const roundAll = (record, places = 6) => Object.fromEntries(
  Object.entries(record).map(([key, value]) => [key, typeof value === "number" ? round(value, places) : value]),
);

/**
 * Read the pinned base snapshot, verifying every shard against the manifest.
 * Fails closed: an absent or drifted shard stops the run rather than producing
 * arithmetic over a partial island.
 */
async function loadSources() {
  const manifestText = await readFile(join(snapshotRoot, "manifest.json"), "utf8").catch(() => null);
  if (manifestText === null) fail(`base snapshot manifest is absent at ${snapshotRoot}; the arithmetic reads real rings and cannot invent them.`);
  const manifest = JSON.parse(manifestText);
  const manifestFileChecksum = sha256HexSync(manifestText);
  const declaredSidecar = (await readFile(join(snapshotRoot, "manifest.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (declaredSidecar !== manifestFileChecksum) fail("base snapshot manifest does not match its own sha256 sidecar.");

  const sources = new Map();
  for (const shard of manifest.geometryShards.filter((entry) => entry.layer === "buildings")) {
    const text = await readFile(join(snapshotRoot, shard.relativeContentRef), "utf8");
    if (sha256HexSync(text) !== shard.checksumSha256) fail(`geometry shard ${shard.shardId} does not match its declared checksum.`);
    for (const feature of JSON.parse(text).features) {
      if (feature.geometry?.type !== "Polygon") continue;
      sources.set(feature.parentId, feature);
    }
  }
  return { manifest, manifestFileChecksum, sources };
}

async function loadLedger() {
  const text = await readFile(join(ledgerRoot, "ledger.json"), "utf8");
  const checksum = sha256HexSync(text);
  const declared = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (declared !== checksum) fail("wave ledger does not match its own sha256 sidecar.");
  return { ledger: JSON.parse(text), checksum };
}

/**
 * Per-cell baked surface area, and the island's face-area distribution.
 *
 * Surface area is every wall face plus the roof cap. Occluded faces are
 * counted: the bake has no visibility information, and inventing some would be
 * a claim this task cannot support.
 */
function censusCells(ledger, sources) {
  const faceAreas = [];
  const cells = [];
  let missing = 0;
  for (const cell of ledger.cells) {
    let facadeArea = 0;
    let roofArea = 0;
    let faceCount = 0;
    let ringVertexCount = 0;
    let present = 0;
    let tallest = 0;
    const cellFaces = [];
    for (const buildingId of cell.buildingIds) {
      const feature = sources.get(buildingId);
      if (!feature) { missing += 1; continue; }
      present += 1;
      const heightMeters = feature.heightMeters == null ? UNKNOWN_HEIGHT_FALLBACK_METERS : feature.heightMeters;
      if (heightMeters > tallest) tallest = heightMeters;
      const closed = feature.geometry.coordinates[0];
      const first = closed[0];
      const last = closed[closed.length - 1];
      const ring = closed.length > 1 && first[0] === last[0] && first[1] === last[1] ? closed.slice(0, -1) : closed;
      ringVertexCount += ring.length;
      let doubleArea = 0;
      for (let index = 0; index < ring.length; index += 1) {
        const [lon1, lat1] = ring[index];
        const [lon2, lat2] = ring[(index + 1) % ring.length];
        const dx = (lon2 - lon1) * METERS_PER_DEGREE_LONGITUDE;
        const dy = (lat2 - lat1) * METERS_PER_DEGREE_LATITUDE;
        // `Math.sqrt` is correctly rounded by IEEE 754; `Math.hypot` is not, and
        // this area feeds every budget bar below.
        const area = Math.sqrt(dx * dx + dy * dy) * heightMeters;
        facadeArea += area;
        faceCount += 1;
        faceAreas.push(area);
        cellFaces.push({ widthMeters: Math.sqrt(dx * dx + dy * dy), heightMeters });
        doubleArea += (lon1 * METERS_PER_DEGREE_LONGITUDE) * (lat2 * METERS_PER_DEGREE_LATITUDE)
          - (lon2 * METERS_PER_DEGREE_LONGITUDE) * (lat1 * METERS_PER_DEGREE_LATITUDE);
      }
      const roofFace = Math.abs(doubleArea) / 2;
      roofArea += roofFace;
      cellFaces.push({ widthMeters: Math.sqrt(roofFace), heightMeters: Math.sqrt(roofFace), roof: true });
    }
    const bounds = cell.bounds;
    cells.push({
      cellId: cell.cellId,
      order: cell.order,
      faces: cellFaces,
      buildingCount: present,
      faceCount,
      ringVertexCount,
      tallestMeters: tallest,
      facadeAreaSquareMeters: facadeArea,
      roofAreaSquareMeters: roofArea,
      surfaceAreaSquareMeters: facadeArea + roofArea,
      // Prism triangle count: n side quads (2 triangles each) plus n-2 roof cap
      // triangles per building, i.e. 3n-2 for an n-vertex ring.
      quadCount: faceCount,
      triangleCount: ringVertexCount - 2 * present,
      totalTriangleCount: 3 * ringVertexCount - 2 * present,
      west: bounds.west * METERS_PER_DEGREE_LONGITUDE,
      east: bounds.east * METERS_PER_DEGREE_LONGITUDE,
      south: bounds.south * METERS_PER_DEGREE_LATITUDE,
      north: bounds.north * METERS_PER_DEGREE_LATITUDE,
    });
  }
  return { cells, faceAreas, missing };
}

/**
 * Roll the ledger cells up into a tile quadtree.
 *
 * The ledger cell ids already CARRY tile coordinates (`...-<z>-<x>-<y>`) at
 * zooms 14 through 18, so the far tier's hierarchy is not invented here — it is
 * the cut the ledger already committed. Block 835 predates that naming and is
 * placed by its own bounds.
 */
function buildTree(cells) {
  const nodes = new Map();
  const lonToTileX = (lon, zoom) => Math.floor(((lon + 180) / 360) * 2 ** zoom);
  const latToTileY = (lat, zoom) => {
    const radians = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom);
  };

  let deepest = 0;
  for (const cell of cells) {
    const match = /-(\d{2})-(\d+)-(\d+)$/u.exec(cell.cellId);
    const centreLon = (cell.west + cell.east) / 2 / METERS_PER_DEGREE_LONGITUDE;
    const centreLat = (cell.south + cell.north) / 2 / METERS_PER_DEGREE_LATITUDE;
    const zoom = match ? Number(match[1]) : 17;
    const x = match ? Number(match[2]) : lonToTileX(centreLon, 17);
    const y = match ? Number(match[3]) : latToTileY(centreLat, 17);
    if (zoom > deepest) deepest = zoom;
    // Two ledger cells resolving to one tile key would make the later one
    // silently REPLACE the earlier, dropping its surface area from every budget
    // figure below. Fail closed instead.
    const leafKey = `${zoom}/${x}/${y}`;
    if (nodes.has(leafKey)) fail(`tile key ${leafKey} is claimed by both ${nodes.get(leafKey).cellId} and ${cell.cellId}; the hierarchy would silently drop one.`);
    nodes.set(leafKey, {
      zoom, x, y, leaf: true, cellId: cell.cellId,
      surfaceAreaSquareMeters: cell.surfaceAreaSquareMeters,
      quadCount: cell.quadCount, triangleCount: cell.triangleCount,
      west: cell.west, east: cell.east, south: cell.south, north: cell.north,
      children: [],
    });
  }

  const ROOT_ZOOM = 8;
  for (let zoom = deepest; zoom > ROOT_ZOOM; zoom -= 1) {
    for (const node of [...nodes.values()]) {
      if (node.zoom !== zoom) continue;
      const key = `${zoom - 1}/${node.x >> 1}/${node.y >> 1}`;
      let parent = nodes.get(key);
      if (!parent) {
        parent = {
          zoom: zoom - 1, x: node.x >> 1, y: node.y >> 1, leaf: false, cellId: null,
          surfaceAreaSquareMeters: 0, quadCount: 0, triangleCount: 0,
          west: Infinity, east: -Infinity, south: Infinity, north: -Infinity, children: [],
        };
        nodes.set(key, parent);
      }
      parent.children.push(node);
      parent.surfaceAreaSquareMeters += node.surfaceAreaSquareMeters;
      parent.quadCount += node.quadCount;
      parent.triangleCount += node.triangleCount;
      parent.west = Math.min(parent.west, node.west);
      parent.east = Math.max(parent.east, node.east);
      parent.south = Math.min(parent.south, node.south);
      parent.north = Math.max(parent.north, node.north);
    }
  }
  return { nodes, roots: [...nodes.values()].filter((node) => node.zoom === ROOT_ZOOM) };
}

/**
 * Worst-case resident far-tier memory over a swept camera grid.
 *
 * Deliberately conservative in three ways, each of which only ever makes the
 * bound larger: no frustum culling (every node behind the camera is counted),
 * no occlusion, and the sweep takes the maximum rather than a percentile.
 */
const ALTITUDES_METERS = [400, 800, 1_200, 2_000, 4_000, 8_000, 16_000];

/** Camera-grid refinement ladder. Each rung doubles the grid on both axes. */
const SWEEP_LADDER_STEPS = [12, 24, 48, 96, 192];

const TARGET_TEXEL_WORLD_SIZE_METERS = farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS);

/**
 * Turn a censused cell's face extents into the shape `packFarTierAtlas` reads.
 *
 * Only the extents matter to packing — `contentExtent` reads corner 0, corner 1
 * and corner 2's height, and nothing else — so no V3 plan is built here. The
 * ordering keys are synthetic and deterministic, which means the resulting
 * `appliedScale` is representative of the real bake rather than byte-identical
 * to it: area is the primary sort in both, and only ties break differently.
 */
function packableFaces(cell) {
  return cell.faces.map((face, index) => {
    const widthMm = face.widthMeters * 1_000;
    const heightMm = face.heightMeters * 1_000;
    return {
      buildingId: `synthetic:${String(index).padStart(6, "0")}`,
      faceIndex: index,
      kind: face.roof === true ? "roof" : "wall",
      areaSquareMeters: face.widthMeters * face.heightMeters,
      cornersMm: [[0, 0, 0], [widthMm, 0, 0], [widthMm, 0, heightMm], [0, 0, heightMm]],
      offsetMeters: [0, 0],
      zones: [],
    };
  });
}

function sweepResidency(nodes, roots, STEPS) {
  for (const node of nodes.values()) {
    const resolution = farTierResolution(Math.max(node.surfaceAreaSquareMeters, 1e-6));
    node.atlasPixels = resolution.atlasPixels;
    node.texelWorldSizeMeters = resolution.texelWorldSizeMeters;
    node.underResolved = resolution.underResolved;
    node.achievedRatio = resolution.achievedRatio;
    // A node may be selected no nearer than the far tier's own boundary, and no
    // nearer than where its own atlas reaches the ratio floor.
    node.selectionDistanceMeters = Math.max(FAR_TIER_NEAR_EDGE_METERS, resolution.criticalDistanceMeters);
    node.atlasGpuBytes = farTierAtlasGpuBytes(node.atlasPixels);
    node.geometryGpuBytes = farTierGeometryGpuBytes(node.quadCount, node.triangleCount);
  }

  const west = Math.min(...roots.map((node) => node.west));
  const east = Math.max(...roots.map((node) => node.east));
  const south = Math.min(...roots.map((node) => node.south));
  const north = Math.max(...roots.map((node) => node.north));

  let worst = null;
  for (const altitudeMeters of ALTITUDES_METERS) {
    for (let i = 0; i <= STEPS; i += 1) {
      for (let j = 0; j <= STEPS; j += 1) {
        const camera = [west + ((east - west) * i) / STEPS, south + ((north - south) * j) / STEPS, altitudeMeters];
        let atlasBytes = 0;
        let geometryBytes = 0;
        let nodeCount = 0;
        const visit = (node) => {
          const dx = Math.max(node.west - camera[0], 0, camera[0] - node.east);
          const dy = Math.max(node.south - camera[1], 0, camera[1] - node.north);
          // `Math.sqrt` is correctly rounded by IEEE 754; `Math.hypot` is not
          // specified to be, and these distances decide a committed budget bar.
          const near = Math.sqrt(dx * dx + dy * dy + camera[2] * camera[2]);
          const fx = Math.max(Math.abs(node.west - camera[0]), Math.abs(node.east - camera[0]));
          const fy = Math.max(Math.abs(node.south - camera[1]), Math.abs(node.north - camera[1]));
          const far = Math.sqrt(fx * fx + fy * fy + camera[2] * camera[2]);
          // Entirely inside the mid tier's detail radius: lod_1's job, not this
          // tier's, so it is not resident here at all.
          if (far < FAR_TIER_NEAR_EDGE_METERS) return;
          if (near >= node.selectionDistanceMeters || node.leaf) {
            atlasBytes += node.atlasGpuBytes;
            geometryBytes += node.geometryGpuBytes;
            nodeCount += 1;
            return;
          }
          for (const child of node.children) visit(child);
        };
        for (const root of roots) visit(root);
        if (!worst || atlasBytes + geometryBytes > worst.totalGpuBytes) {
          worst = { altitudeMeters, gridSteps: STEPS, nodeCount, atlasGpuBytes: atlasBytes, geometryGpuBytes: geometryBytes, totalGpuBytes: atlasBytes + geometryBytes };
        }
      }
    }
  }
  return worst;
}

async function commandHierarchy() {
  const { manifest, manifestFileChecksum, sources } = await loadSources();
  const { ledger, checksum: ledgerChecksum } = await loadLedger();
  const { cells, faceAreas, missing } = censusCells(ledger, sources);
  if (missing > 0) fail(`${missing} ledger building ids are absent from the base snapshot; the census must be total.`);

  const { nodes, roots } = buildTree(cells);

  // THE REFINEMENT LADDER. A sweep maximum is a SAMPLED maximum: coarsening the
  // grid can only miss peaks, never invent them, so a single grid understates
  // the bound and the earlier "every conservatism enlarges it" claim was wrong
  // in this one respect. Refine until two successive doublings stop moving the
  // maximum, and commit the ladder as the evidence for stopping.
  const ladder = [];
  let worst = null;
  for (const steps of SWEEP_LADDER_STEPS) {
    const sample = sweepResidency(nodes, roots, steps);
    ladder.push({
      gridSteps: steps,
      posesSampled: (steps + 1) * (steps + 1) * ALTITUDES_METERS.length,
      atlasGpuBytes: sample.atlasGpuBytes,
      geometryGpuBytes: sample.geometryGpuBytes,
      totalGpuBytes: sample.totalGpuBytes,
      altitudeMeters: sample.altitudeMeters,
    });
    if (!worst || sample.totalGpuBytes > worst.totalGpuBytes) worst = sample;
  }
  const lastThree = ladder.slice(-3);
  const stable = lastThree.length === 3 && lastThree.every((entry) => entry.totalGpuBytes === lastThree[0].totalGpuBytes);

  // THE SWEEP DOES NOT CONVERGE, so it cannot supply the bar. The selection
  // function is discontinuous — the cut changes in steps — so refining the grid
  // keeps finding slightly worse poses, and the ladder above shows it creeping
  // rather than settling. Fall back to a bound that does not depend on the
  // sample at all.
  //
  // EVERY camera pose selects some ANTICHAIN of the tree (a set of nodes with
  // exactly one ancestor-or-self per leaf), minus whatever the 1,200 m boundary
  // excludes. Excluding only subtracts. So the maximum over all antichains
  // dominates every pose, and it is exactly computable by one bottom-up pass:
  //
  //   maxCut(node) = max(cost(node), sum over children of maxCut(child))
  //
  // This is a theorem about the tree, not a sample. "All leaves resident" was
  // considered and REJECTED as the bound: it is not one, because 3 internal
  // nodes of this tree cost more than their children thanks to power-of-two
  // rounding and the 64-texel floor.
  const cutBoundOf = (node) => {
    const own = { atlas: node.atlasGpuBytes, geometry: node.geometryGpuBytes };
    if (node.leaf || node.children.length === 0) return own;
    let atlas = 0;
    let geometry = 0;
    for (const child of node.children) {
      const childBound = cutBoundOf(child);
      atlas += childBound.atlas;
      geometry += childBound.geometry;
    }
    return atlas + geometry > own.atlas + own.geometry ? { atlas, geometry } : own;
  };
  let boundAtlas = 0;
  let boundGeometry = 0;
  for (const root of roots) {
    const rootBound = cutBoundOf(root);
    boundAtlas += rootBound.atlas;
    boundGeometry += rootBound.geometry;
  }
  const cutBound = { atlasGpuBytes: boundAtlas, geometryGpuBytes: boundGeometry, totalGpuBytes: boundAtlas + boundGeometry };

  // The same exact bound at other atlas ceilings, so the choice of 256 rests on
  // comparable arithmetic rather than on figures from a sweep that did not
  // converge. Only the ceiling changes; the ladder, the tree and the DP do not.
  // How many internal nodes cost more than their children, which is why "all
  // leaves resident" is not itself a bound. Reported, because it is the reason
  // the simpler bound was rejected.
  let costlierThanChildren = 0;
  for (const node of nodes.values()) {
    if (node.leaf || node.children.length === 0) continue;
    const childBytes = node.children.reduce((sum, child) => sum + child.atlasGpuBytes + child.geometryGpuBytes, 0);
    if (node.atlasGpuBytes + node.geometryGpuBytes > childBytes) costlierThanChildren += 1;
  }

  const ceilingComparison = [];
  for (const ceiling of [128, 256, 512, 1_024]) {
    const pixelsFor = (area) => {
      const demanded = Math.sqrt(Math.max(area, 1e-6)) / TARGET_TEXEL_WORLD_SIZE_METERS;
      let power = 1;
      while (power < Math.ceil(demanded)) power *= 2;
      return Math.min(ceiling, Math.max(FAR_TIER_ATLAS_PIXELS.minimum, power));
    };
    const atlasAt = new Map();
    for (const [key, node] of nodes) atlasAt.set(key, farTierAtlasGpuBytes(pixelsFor(node.surfaceAreaSquareMeters)));
    const boundAt = (node) => {
      const own = atlasAt.get(`${node.zoom}/${node.x}/${node.y}`);
      if (node.leaf || node.children.length === 0) return own;
      return Math.max(own, node.children.reduce((sum, child) => sum + boundAt(child), 0));
    };
    const atlasBytes = roots.reduce((sum, root) => sum + boundAt(root), 0);

    // THE REAL PACKER, at this ceiling, on every cell. An earlier version of
    // this table estimated infeasibility as `faceCount > ceiling^2 / 64`, which
    // is the same 100%-utilisation idealisation B6 had already been corrected
    // for, and it produced a materially false claim: it said a 512 ceiling
    // removes the blocker entirely. It does not.
    let unpackableAt = 0;
    let unpackableDespiteHeadroom = 0;
    for (const cell of cells) {
      const atlasPixels = pixelsFor(cell.surfaceAreaSquareMeters);
      try {
        packFarTierAtlas(packableFaces(cell), atlasPixels, TARGET_TEXEL_WORLD_SIZE_METERS);
      } catch (error) {
        if (!(error instanceof FarTierPackingUnfeasibleError)) throw error;
        unpackableAt += 1;
        // The decisive diagnostic: this cell's atlas is SMALLER than the
        // ceiling, so raising the ceiling cannot help it.
        if (atlasPixels < ceiling) unpackableDespiteHeadroom += 1;
      }
    }
    ceilingComparison.push({
      atlasCeilingPixels: ceiling,
      cutIndependentAtlasGpuBytes: atlasBytes,
      cutIndependentAtlasMebibytes: round(atlasBytes / 1_048_576, 2),
      maximumFacesAtCeilingSizedAtlas: Math.floor((ceiling ** 2) / ((FAR_TIER_BAKE_RECIPE.faceTexelFloor + 2 * FAR_TIER_BAKE_RECIPE.gutterTexels) ** 2)),
      maximumFacesNote: "An arithmetic capacity for an atlas that is actually AT the ceiling. It is NOT a feasibility count, because most cells are sized well below the ceiling.",
      packerMeasuredUnpackableCellCount: unpackableAt,
      unpackableWhoseAtlasIsBelowTheCeiling: unpackableDespiteHeadroom,
      unpackableWhoseAtlasIsBelowTheCeilingNote: "These cells CANNOT be helped by raising the ceiling at all: atlas edge is chosen from a cell's SURFACE AREA, not from the ceiling, so a low-area, high-face-count cell keeps a small atlas however high the ceiling goes.",
    });
  }

  // B6 FROM THE RESOLUTION THE PACKER ACTUALLY DELIVERS.
  // `farTierResolution` assumes an atlas can be filled to 100%. No packer
  // achieves that: gutters and shelf waste force a global texel-size reduction,
  // and the one baked cell needed a scale of 0.5. Running the real packer over
  // every leaf replaces that assumption with a measurement.
  const leafResolutions = [];
  const unpackable = [];
  const atlasHistogram = {};
  const scaleHistogram = {};
  for (const cell of cells) {
    const ideal = farTierResolution(Math.max(cell.surfaceAreaSquareMeters, 1e-6));
    atlasHistogram[ideal.atlasPixels] = (atlasHistogram[ideal.atlasPixels] ?? 0) + 1;
    let packing;
    try {
      packing = packFarTierAtlas(packableFaces(cell), ideal.atlasPixels, TARGET_TEXEL_WORLD_SIZE_METERS);
    } catch (error) {
      // ONLY a declared infeasibility is recorded as one. A bare catch here
      // would silently reclassify any future input bug as a feasibility
      // blocker, which is the most flattering possible way to be wrong.
      if (!(error instanceof FarTierPackingUnfeasibleError)) throw error;
      unpackable.push({ cellId: cell.cellId, faceCount: cell.faces.length, atlasPixels: ideal.atlasPixels });
      continue;
    }
    const delivered = farTierDeliveredQuality(packing.texelWorldSizeMeters);
    scaleHistogram[packing.appliedScale] = (scaleHistogram[packing.appliedScale] ?? 0) + 1;
    leafResolutions.push({
      cellId: cell.cellId,
      atlasPixels: ideal.atlasPixels,
      idealRatio: ideal.achievedRatio,
      idealUnderResolved: ideal.underResolved,
      appliedScale: packing.appliedScale,
      deliveredTexelWorldSizeMeters: packing.texelWorldSizeMeters,
      deliveredRatio: delivered.achievedRatio,
      deliveredUnderResolved: delivered.underResolved,
      deliveredCriticalDistanceMeters: delivered.criticalDistanceMeters,
      flatFaceShare: packing.flatFaceCount / Math.max(1, packing.faces.length),
    });
  }
  // The IDEAL ladder is a property of every cell, packable or not, so it is
  // computed over all 883 rather than over the packable subset.
  const idealAll = cells.map((cell) => farTierResolution(Math.max(cell.surfaceAreaSquareMeters, 1e-6)));
  const underResolved = idealAll.filter((entry) => entry.underResolved);
  const deliveredUnderResolved = leafResolutions.filter((entry) => entry.deliveredUnderResolved);

  const zoomHistogram = {};
  for (const node of nodes.values()) if (node.leaf) zoomHistogram[node.zoom] = (zoomHistogram[node.zoom] ?? 0) + 1;

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:stage0-hierarchy`,
    task: "T002",
    artifact: "far-tier-hierarchy-and-budget-derivation",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. Nothing here is a capture. Every number is arithmetic over committed inputs, and a timestamp would suggest a measurement session that never happened.",
    claim: "The far tier's hierarchy, resolution ladder and GPU budget, derived from the pinned base snapshot's own rings and heights and from the committed wave ledger. No far-tier byte existed when this was written.",
    inputs: {
      baseRelease: { releaseId: manifest.releaseId, manifestFileChecksumSha256: manifestFileChecksum },
      ledger: { ledgerId: ledger.ledgerId, checksumSha256: ledgerChecksum, cellCount: ledger.cells.length },
      unknownHeightFallbackMeters: UNKNOWN_HEIGHT_FALLBACK_METERS,
      unknownHeightNote: "The source records 76 buildings with no height. They are extruded to 10 m, which is the plan builder's own fallback. A 10 m prism where the real building is unknown is a stated substitution, not a measurement.",
      scaleMetricId: FAR_TIER_BAKE_RECIPE.frameScaleMetricId,
    },
    viewReference: FAR_TIER_VIEW_REFERENCE,
    screenMetric: {
      form: "metersPerPixel = distance * fovRadians / viewportHeightPixels",
      note: "The ARC form. The tangent form 2*d*tan(fov/2)/H gives 0.5132 m/px at 400 m against this form's 0.4654, so the arc form asks for FINER texels and is conservative in the quality direction.",
      metersPerPixel: roundAll({ at400m: farTierMetersPerPixel(400), at1200m: farTierMetersPerPixel(1_200), at2400m: farTierMetersPerPixel(2_400), at4800m: farTierMetersPerPixel(4_800) }),
    },
    tierBoundary: {
      nearEdgeMeters: FAR_TIER_NEAR_EDGE_METERS,
      provenance: "Not a new number. The citywide default flip shipped the detail radius at 1,200 m and EXTERIOR_CELL_SCHEDULER_POLICY.distanceBandEdgesMeters is [1200, 2400]. The far tier begins exactly where the mid tier's detail radius stops.",
    },
    texelRatio: {
      ...FAR_TIER_TEXEL_RATIO,
      targetTexelWorldSizeMeters: round(farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS)),
    },
    islandSurface: {
      note: "Every wall face plus every roof cap. Occluded faces are COUNTED: the bake has no visibility information and inventing some would be a claim this task cannot support.",
      facadeAreaSquareMeters: Math.round(cells.reduce((sum, cell) => sum + cell.facadeAreaSquareMeters, 0)),
      roofAreaSquareMeters: Math.round(cells.reduce((sum, cell) => sum + cell.roofAreaSquareMeters, 0)),
      faceCount: faceAreas.length,
      prismTriangleCount: cells.reduce((sum, cell) => sum + cell.totalTriangleCount, 0),
      comparisonNote: "The shipped textured island is 80,253,286 triangles at lod_0+lod_1 (wave-bytes.json). This prism tier is the number above. That ratio is why the far tier is a prism and not merged lod_1.",
    },
    perCellSurfaceAreaSquareMeters: roundAll(distribution(cells.map((cell) => cell.surfaceAreaSquareMeters)), 1),
    perFaceAreaSquareMeters: roundAll(distribution(faceAreas), 3),
    perCellFaceCount: roundAll(distribution(cells.map((cell) => cell.faceCount)), 1),
    faceTexelFloorJustification: {
      floorTexels: FAR_TIER_BAKE_RECIPE.faceTexelFloor,
      targetTexelWorldSizeMeters: round(farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS)),
      note: "A face gets interior detail only when it is at least 4 texels on both axes at the applied resolution. At the target texel size that is a face roughly 5.6 m on a side. Below it a coursing pattern is not resolved, it is aliased, so a flat area-weighted average is both cheaper and more honest than a wrong pattern.",
      facesBelowFloorAtTargetShare: round(faceAreas.filter((area) => area < (4 * farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS)) ** 2).length / faceAreas.length, 6),
    },
    sourceTileGeometry: {
      note: "One far-tier texel covers many source tile periods, which is why the bake integrates rather than point-samples. Periods below are the shipped tile extents in millimetres.",
      targetTexelWorldSizeMillimetres: Math.round(farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS) * 1_000),
      tiles: PROCEDURAL_TEXTURE_CLASSES.map((textureClass) => {
        const tile = proceduralTextureTile(textureClass);
        return {
          textureClass,
          tileUMm: tile.tileUMm,
          tileVMm: tile.tileVMm,
          pngSha256: tile.pngSha256,
          periodsPerTexelU: round((farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS) * 1_000) / tile.tileUMm, 3),
          periodsPerTexelV: round((farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS) * 1_000) / tile.tileVMm, 3),
        };
      }),
      maxObservedSourceUv: {
        value: 1210.1,
        source: "ADR 0047",
        why: "The shipped assets repeat their tile up to 1,210 times across one wall, which is exactly why ADR 0047 refused an atlas for the NEAR tier: an atlas cannot repeat. The far tier resolves that by baking the repeat INTO the atlas patch at far-tier resolution, so its own UVs stay inside [0,1] by construction. That is a different decision on a different tier, not a reversal of the near-tier finding.",
      },
    },
    leafResolutionLadder: {
      atlasPixelBounds: FAR_TIER_ATLAS_PIXELS,
      histogram: atlasHistogram,
      zoomHistogram,
      note: "Leaf zoom levels are the ledger's own tile ids; the far tier does not invent a hierarchy, it adopts the cut the ledger already committed.",
      idealLadder: {
        basis: "farTierResolution alone, which assumes an atlas can be filled to 100%.",
        underResolvedCellCount: underResolved.length,
        underResolvedShare: round(underResolved.length / cells.length, 6),
        cellsMeasured: idealAll.length,
        worstAchievedRatio: round(idealAll.reduce((least, entry) => Math.min(least, entry.achievedRatio), Infinity), 6),
        caveat: "THIS LADDER IS NOT ACHIEVABLE. No packer fills an atlas completely, so these figures are an upper bound on quality, not a prediction of it.",
      },
      faceCountCeiling: {
        note: "THE HARDEST LIMIT IN THIS TIER, AND IT IS NOT A QUALITY LIMIT — IT IS FEASIBILITY. Every face occupies at least (faceTexelFloor + 2 * gutterTexels)^2 texels however far the global resolution is reduced, so one atlas holds a FIXED MAXIMUM NUMBER OF FACES. A cell above it cannot be baked at this ceiling at any scale.",
        minimumTexelsPerFace: (FAR_TIER_BAKE_RECIPE.faceTexelFloor + 2 * FAR_TIER_BAKE_RECIPE.gutterTexels) ** 2,
        arithmeticCapacityOfACeilingSizedAtlas: Math.floor((FAR_TIER_ATLAS_PIXELS.maximum ** 2) / ((FAR_TIER_BAKE_RECIPE.faceTexelFloor + 2 * FAR_TIER_BAKE_RECIPE.gutterTexels) ** 2)),
        arithmeticCapacityNote: "Capacity of an atlas that is actually AT the 256 ceiling. It is NOT a feasibility count and must not be read as one: most cells are sized well below the ceiling, because atlas edge comes from surface area.",
        packerMeasuredUnpackableCellCount: unpackable.length,
        unpackableShare: round(unpackable.length / cells.length, 6),
        worstFaceCount: cells.reduce((most, cell) => Math.max(most, cell.faces.length), 0),
        raisingTheCeilingDoesNotFixIt: "MEASURED, NOT ASSUMED. The real packer at each ceiling leaves 774 cells unpackable at 128, 172 at 256, 57 at 512 and 57 at 1024. At 512 and 1024 every surviving cell already has an atlas SMALLER than the ceiling, so more ceiling cannot reach it. An earlier version of this record estimated infeasibility as faceCount > ceiling^2/64 and consequently claimed a 512 ceiling removed the blocker entirely. That was false, and it was false in the same 100%-utilisation way the delivered-resolution ladder had already been corrected for.",
        survivingRemedies: [
          "Reduce the gutter below 2 texels, at the cost of mip-level-1 bleed between neighbouring faces.",
          "Lower the per-face texel floor below 4, at the cost of aliasing the faces that fall under it.",
          "Split leaves below the ledger cell, which is a hierarchy change and a T004 decision.",
          "Decouple the per-cell atlas floor from surface area, so a face-dense but low-area cell can be granted a larger atlas than its area alone earns. This is the only remedy that targets the measured mechanism directly.",
        ],
        consequence: "T004 CANNOT MASS-BAKE AT THIS CEILING. This prototype does not choose among the remedies.",
      },
      deliveredLadder: {
        basis: "The real packer run over every PACKABLE leaf, using each cell's own face extents from the base snapshot. This is the resolution a bake actually delivers.",
        cellsMeasured: leafResolutions.length,
        cellsUnpackable: unpackable.length,
        underResolvedCellCount: deliveredUnderResolved.length,
        underResolvedShareOfPackable: round(deliveredUnderResolved.length / Math.max(1, leafResolutions.length), 6),
        underResolvedShareOfAllCells: round(deliveredUnderResolved.length / cells.length, 6),
        shareDenominatorNote: "Two denominators, because they answer different questions and conflating them flatters the tier. The packable share is out of the cells this ladder could measure; the all-cells share is out of every ledger cell, and the cells it cannot measure are UNPACKABLE rather than fine.",
        worstAchievedRatio: round(Math.min(...leafResolutions.map((entry) => entry.deliveredRatio)), 6),
        worstCriticalDistanceMeters: Math.round(Math.max(...leafResolutions.map((entry) => entry.deliveredCriticalDistanceMeters))),
        appliedScaleHistogram: scaleHistogram,
        meanFlatFaceShare: round(leafResolutions.reduce((sum, entry) => sum + entry.flatFaceShare, 0) / leafResolutions.length, 6),
        representativeness: "Ordering keys are synthetic, so `appliedScale` is representative rather than byte-identical to a real bake: face world area is the primary sort in both and only ties break differently.",
      },
      honesty: "THE DELIVERED LADDER IS THE ONE THAT MATTERS, AND IT IS MUCH WORSE THAN THE IDEAL ONE. THIS IS THE TIER'S LARGEST QUALITY SHORTFALL AND IT IS STATED RATHER THAN FUNDED. The ideal ladder puts it at " + underResolved.length + " of " + cells.length + " leaves; the DELIVERED ladder, which is the one that matters, puts it at " + deliveredUnderResolved.length + ". The gap between them is packing overhead — gutters and shelf waste — and it is the dominant term, not a correction. A leaf that cannot reach ratio 1.0 does not get a bigger atlas and does not get a waiver: it renders blurrier than target between the 1,200 m boundary and its own critical distance. Raising the ceiling to 512 or 1024 would help at a worst-case resident cost this project has no evidence it can pay; splitting leaves below the ledger cell would also help and is a T004 question this prototype may not answer. Reducing the gutter from 2 texels would help most of all and would cost mip-level-1 bleed.",
    },
    hierarchy: {
      nodeCount: nodes.size,
      leafCount: cells.length,
      rootCount: roots.length,
      pyramidProperty: "A parent covers 4x the area at 2x the texel size, so its texel count is the same as one child's. The ladder is therefore bounded: resolution per node is constant across levels and only the node COUNT falls with distance.",
      geometryLimitation: "THE HIERARCHY REDUCES TEXTURE RESIDENCY WITH DISTANCE AND DOES NOT REDUCE GEOMETRY RESIDENCY AT ALL. A parent node here is the concatenation of its children's prisms, not a simplified massing of them, so coarsening the cut moves texture bytes and leaves geometry bytes almost unchanged — which is why the swept geometry worst case equals the whole island's prism geometry rather than some fraction of it. At 93.8 MiB that is affordable and bounded, so it does not block this prototype. It is named here rather than discovered during a mass bake: parent-node geometry simplification is a real prerequisite for any tier that must grow past this island's size, and it is out of T002's scope.",
    },
    worstCaseResidency: {
      quantifier: "MAXIMUM OVER THE DECLARED POSE SAMPLE, at the stated grid resolution. NOT a proven bound over all camera poses.",
      quantifierNote: "An earlier draft of this record claimed these figures are never exceeded at any camera pose, and claimed every conservatism enlarged them. Both were wrong in the same direction. A sampled grid can only MISS a peak, never invent one, so grid coarseness makes the figure SMALLER. A 12-step grid reported 133,190,868 atlas bytes; refining found more. The ladder below is the evidence for where refinement stopped moving the answer, and the quantifier above is what the number actually supports.",
      method: "Camera grid across the island bounding box at seven altitudes, with NO frustum culling and NO occlusion. Those two conservatisms do enlarge the bound; the grid sampling does not.",
      altitudesMeters: ALTITUDES_METERS,
      refinementLadder: ladder,
      stabilityRule: "The last three rungs must agree exactly.",
      stable,
      stabilityStatement: stable
        ? "STABLE. The last three rungs of the ladder returned the identical maximum, so further refinement is not expected to move it. This is evidence, not proof."
        : "NOT STABLE. The last three rungs disagree, so the maximum below is the largest SEEN and refinement had not converged when it stopped. It must be read as a lower bound on the true sampled maximum.",
      altitudeMeters: worst.altitudeMeters,
      nodeCount: worst.nodeCount,
      atlasGpuBytes: worst.atlasGpuBytes,
      geometryGpuBytes: worst.geometryGpuBytes,
      totalGpuBytes: worst.totalGpuBytes,
      atlasGpuMebibytes: round(worst.atlasGpuBytes / 1_048_576, 2),
      geometryGpuMebibytes: round(worst.geometryGpuBytes / 1_048_576, 2),
      totalGpuMebibytes: round(worst.totalGpuBytes / 1_048_576, 2),
    },

    cutIndependentBound: {
      note: "THIS IS WHAT THE COMMITTED BARS REST ON, not the sweep. Every camera pose selects some antichain of the tree, minus whatever the 1,200 m boundary excludes, and excluding only subtracts. So the maximum over all antichains dominates every pose.",
      method: "One bottom-up pass: maxCut(node) = max(cost(node), sum of maxCut(children)). A theorem about the tree, not a sample.",
      atlasGpuBytes: cutBound.atlasGpuBytes,
      geometryGpuBytes: cutBound.geometryGpuBytes,
      totalGpuBytes: cutBound.totalGpuBytes,
      atlasGpuMebibytes: round(cutBound.atlasGpuBytes / 1_048_576, 2),
      geometryGpuMebibytes: round(cutBound.geometryGpuBytes / 1_048_576, 2),
      totalGpuMebibytes: round(cutBound.totalGpuBytes / 1_048_576, 2),
      allLeavesRejectedAsBound: {
        why: "'Every leaf resident at once' was considered as the simpler bound and REJECTED: it is not one. Power-of-two rounding and the 64-texel floor make some internal nodes cost MORE than their children.",
        internalNodesCostlierThanTheirChildren: costlierThanChildren,
        allLeavesAtlasGpuBytes: cells.reduce((sum, cell) => sum + farTierAtlasGpuBytes(farTierResolution(Math.max(cell.surfaceAreaSquareMeters, 1e-6)).atlasPixels), 0),
        allLeavesGeometryGpuBytes: cells.reduce((sum, cell) => sum + farTierGeometryGpuBytes(cell.quadCount, cell.triangleCount), 0),
      },
      headroomOverObservedSweepMaximum: cutBound.totalGpuBytes - worst.totalGpuBytes,
      atlasCeilingComparison: ceilingComparison,
      atlasCeilingComparisonNote: "The 256 ceiling is chosen against these, all computed the same exact way. Note that the feasibility column moves faster than the memory column: raising the ceiling buys packability as much as sharpness.",
    },
    gpuAccounting: {
      bytesPerTexel: FAR_TIER_GPU_TEXEL_BYTES,
      bytesPerTexelNote: "RGBA8. A truecolour PNG decodes to RGB8, but no mainstream GPU stores a 3-byte texel; it pads to 4. Counting 3 would understate every figure here by a quarter.",
      mipChainMultiplier: FAR_TIER_MIP_CHAIN_MULTIPLIER,
      mipChainNote: "The atlas bakes no mips because PNG cannot carry a chain, so the runtime generates them. They are generated whether or not this budget counts them, so it counts them.",
      geometryVertexBytes: 20,
      geometryVertexNote: "POSITION and TEXCOORD_0 as float32 on unshared vertices. The canonical writer emits no NORMAL, so none is counted.",
    },
    notClaimedHere: [
      "No far-tier byte has been baked at the time this record is written.",
      "This is arithmetic, not a rendered measurement. It says nothing about whether the prism READS correctly on screen.",
      "The prism's silhouette error is a separate and larger problem, measured in coarse-tier.json at a median 0.045221 and a maximum 0.628806, and it is NOT covered by ADR 0050's 2% cap.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "stage0-hierarchy.json"), text);
  await writeFile(join(evidenceRoot, "stage0-hierarchy.sha256"), `${sha256HexSync(text)}  stage0-hierarchy.json\n`);
  console.log(serialize({
    ok: true,
    checksum: sha256HexSync(text),
    cells: cells.length,
    faces: faceAreas.length,
    underResolvedCellsIdeal: underResolved.length,
    underResolvedCellsDelivered: deliveredUnderResolved.length,
    sweepStable: stable,
    worstResidentMiB: round(worst.totalGpuBytes / 1_048_576, 2),
    worstAtlasBytes: worst.atlasGpuBytes,
    worstGeometryBytes: worst.geometryGpuBytes,
    worstTotalBytes: worst.totalGpuBytes,
    cutBoundAtlas: cutBound.atlasGpuBytes,
    cutBoundGeometry: cutBound.geometryGpuBytes,
    cutBoundTotal: cutBound.totalGpuBytes,
    unpackableCells: unpackable.length,
  }));
}

async function commandPreregister() {
  const hierarchyPath = join(evidenceRoot, "stage0-hierarchy.json");
  const hierarchyText = await readFile(hierarchyPath, "utf8").catch(() => null);
  if (hierarchyText === null) fail("stage0-hierarchy.json is absent; run the `hierarchy` command first. The bars are DERIVED from it and may not be typed by hand.");
  const hierarchy = JSON.parse(hierarchyText);
  const hierarchyChecksum = sha256HexSync(hierarchyText);

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:bake-pre-registration`,
    task: "T002",
    artifact: "far-tier-bake-pre-registration",
    status: "PRE-REGISTERED, THEN AMENDED. The appearance instrument and its bars were written and committed BEFORE any tile was baked and before any still was captured, and are unchanged. The BUDGET bars were amended AFTER the bake and after the first capture, to correct three derivations that were wrong in the flattering direction. See `amendments` — this record must not be read as wholly pre-capture.",
    amendments: {
      why: "An independent review found that three quantitative claims in the first committed version did not hold. Correcting them moved bars that had already been published, which is a real weakening of the pre-registration guarantee and is disclosed here rather than smoothed over.",
      amendedAfterTheBakeAndFirstCapture: [
        "B3 / B4 / B5. Derived from the maximum of a 13x13 camera sweep and asserted to be never exceeded at any pose. A sampled grid can only MISS a peak, so the figures were too low and the quantifier was false. Refinement to 24/48/96/192 steps never converged, so the bars now come from an exact max-over-antichains bound: atlas 133,190,868 -> 291,984,434; total 231,501,492 -> 390,295,058.",
        "B6. Derived from a ladder that assumed a 100%-full atlas. Re-derived from the resolution the real packer delivers: 360 of 883 under-resolved -> 650 of the 711 packable cells, plus 172 cells that cannot be packed at all.",
        "B1's feasibility column. Infeasibility per ceiling was ESTIMATED as faceCount > ceiling^2/64 — the same idealisation B6 had just been corrected for — which produced the false claim that a 512 ceiling removes the packing blocker entirely. Replaced with the real packer at each ceiling: 774 / 172 / 57 / 57.",
      ],
      notAmendedAndNotAmendable: [
        "The `blenderAgreementInstrument` section in its entirety — poses, bar values, primary and secondary measures, camera discipline, scene-clearing rule and the stop rule. It is byte-identical to the version committed before the first still was captured, and the re-capture of the committed tile ran against it unchanged.",
        "The tone bar |unionMeanLuminanceRatio - 1| <= 0.05 and the hue bar of 0.02 channel spread.",
        "`recipe` and its `recipeSha256`, which have not moved since the first commit.",
      ],
      honestReading: "The APPEARANCE verdict rests on a genuinely pre-registered instrument and a bar that was never touched. The BUDGET bars do not carry that guarantee: they were corrected after the fact, and every correction made the tier look worse rather than better, which is the direction that argues they were made in good faith but does not restore the guarantee.",
    },
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. A timestamp here would record when the bars were written, and presenting that as a capture time would be a small lie in the one file whose entire value is that it predates the measurements.",
    claim: "The complete set of recipe constants, budget bars and appearance-agreement bars the far-tier bake is judged against. Nothing here is a measurement.",
    derivedFrom: { record: "stage0-hierarchy.json", sha256: hierarchyChecksum },

    recipe: {
      ...FAR_TIER_BAKE_RECIPE,
      recipeSha256: farTierRecipeHash(),
      settledBeforeAnyBake: [
        "GAMMA. Composition is in LINEAR light: linear = factor * srgbToLinear(texel/255), atlas = 255 * linearToSrgb(linear), consumed with baseColorFactor [1,1,1,1]. The naive encoded-space multiply is rejected by name and a test proves the two differ.",
        "SAMPLING. NEAREST names the reconstruction (piecewise constant, no interpolation between tile texels). Aggregation is the EXACT area-weighted integral of that reconstruction over the destination texel's source footprint, in closed form. There is no sample-count parameter to tune.",
        "MIPS. None baked. PNG cannot carry a chain. RECOMMENDATION: the runtime must generate them; at ratio ~1.0 unmipped minification shimmers under camera motion. Baked mips would need KTX2, which is a format change and a new admission decision.",
        "PACKING ORDER. Descending face world area, then building id ascending, then face index ascending. NEVER map iteration order.",
        "GUTTER. Two texels, edge-clamp replicated. One is halved to nothing at mip level 1 and neighbours bleed; two survives level 1.",
        "TEXEL FLOOR. A face smaller than 4 texels on either axis carries no pattern at all, only its own area-weighted average colour.",
      ],
    },

    budgetBars: {
      contractId: FAR_TIER_BUDGET_CONTRACT.contractId,
      boundKind: FAR_TIER_BOUND_KIND,
      whatB3toB5DoNotBound: {
        statement: "B3-B5 bound the cost of ONE SELECTED CUT — the instantaneous, steady-state residency of the antichain a camera pose selects. They are NOT a bound on a streaming runtime's peak, and citing them as one would be wrong.",
        outsideTheBound: [...FAR_TIER_BOUND_EXCLUSIONS],
        consequence: "NAMED T003 CONSTRAINT. A runtime integration that does any of the above must state its own peak bound on top of this one. These bars do not cover it.",
      },
      contractSha256: farTierBudgetContractHash(),
      scopeStatement: FAR_TIER_BUDGET_CONTRACT.scope,
      separateFromCriterion30: "THE FAR TIER GETS ITS OWN BUDGET AND IS NOT FOLDED INTO THE CLOSED 256 MiB CRITERION #30. That criterion was frozen against a measurement this tier did not exist for. Adding a new tier's memory to a closed criterion would silently reopen it. The two budgets are ADDED when a total is needed, never merged.",
      B1: {
        rule: `Baked atlas edge length is a power of two in [${FAR_TIER_ATLAS_PIXELS.minimum}, ${FAR_TIER_ATLAS_PIXELS.maximum}] texels.`,
        rationale: "Derived, not chosen. The cut-independent atlas bound is 72.2 MiB at a 128 ceiling, 278.5 MiB at 256, 640.0 MiB at 512 and 861.7 MiB at 1024.",
        alsoDecidesFeasibility: `An atlas holds at most ${hierarchy.leafResolutionLadder.faceCountCeiling.maximumFacesPer256Atlas} faces at this ceiling, because every face costs at least ${hierarchy.leafResolutionLadder.faceCountCeiling.minimumTexelsPerFace} texels however far resolution is reduced. ${hierarchy.leafResolutionLadder.faceCountCeiling.unpackableCellCount} of ${hierarchy.inputs.ledger.cellCount} cells exceed what the real packer can place and CANNOT be baked at this ceiling at any scale.`,
      },
      B2: {
        rule: `One far-tier tile occupies at most ${FAR_TIER_BUDGET_CONTRACT.maxTileAtlasGpuBytes} decoded GPU bytes of texture, mip chain included.`,
        expectedByteLength: FAR_TIER_BUDGET_CONTRACT.maxTileAtlasGpuBytes,
        rationale: "256 * 256 * 4 bytes * 4/3 for the mip chain.",
      },
      B3: {
        rule: `Resident far-tier TEXTURE memory for the SELECTED CUT never exceeds ${FAR_TIER_BUDGET_CONTRACT.maxResidentAtlasGpuBytes} decoded GPU bytes, at any camera pose, in the steady state.`,
        derivedValue: hierarchy.cutIndependentBound.atlasGpuBytes,
        basis: "cut-independent-bound",
        rationale: "A BOUND, not a sampled maximum. Every camera pose selects some antichain of the tree, minus whatever the 1,200 m boundary excludes, and excluding only subtracts; so the maximum over all antichains dominates every pose, and that maximum is one bottom-up pass over the tree.",
        supersededSamplingClaim: "An earlier draft of this record derived B3 from the maximum of a 13x13 camera sweep and asserted it was never exceeded at any pose. That was wrong: a sampled grid can only MISS a peak, so refinement kept finding worse poses (133,190,868 at 12 steps creeping to 136,686,118 at 192) and never converged. The sweep is retained as an observation only.",
      },
      B4: {
        rule: `Resident far-tier GEOMETRY memory for the SELECTED CUT never exceeds ${FAR_TIER_BUDGET_CONTRACT.maxResidentGeometryGpuBytes} decoded GPU bytes, at any camera pose, in the steady state.`,
        derivedValue: hierarchy.cutIndependentBound.geometryGpuBytes,
        basis: "cut-independent-bound",
      },
      B5: {
        rule: `Resident far-tier TOTAL for the SELECTED CUT never exceeds ${FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes} decoded GPU bytes, at any camera pose, in the steady state.`,
        derivedValue: hierarchy.cutIndependentBound.totalGpuBytes,
        basis: "cut-independent-bound",
      },
      B6: {
        rule: `Every leaf reaches texel ratio ${FAR_TIER_TEXEL_RATIO.floor} at the ${FAR_TIER_NEAR_EDGE_METERS} m boundary AT THE RESOLUTION THE PACKER ACTUALLY DELIVERS, or is REPORTED as under-resolved with its critical distance.`,
        knownToBeMissed: true,
        measuredShortfallIdeal: {
          note: "Assuming a 100%-full atlas, which no packer achieves. Kept only so the packing penalty is visible as the difference.",
          underResolvedCellCount: hierarchy.leafResolutionLadder.idealLadder.underResolvedCellCount,
          underResolvedShare: hierarchy.leafResolutionLadder.idealLadder.underResolvedShare,
          worstAchievedRatio: hierarchy.leafResolutionLadder.idealLadder.worstAchievedRatio,
        },
        measuredShortfallDelivered: {
          note: "THE ONE THAT COUNTS. The real packer run over every packable leaf.",
          cellsMeasured: hierarchy.leafResolutionLadder.deliveredLadder.cellsMeasured,
          cellsUnpackable: hierarchy.leafResolutionLadder.deliveredLadder.cellsUnpackable,
          underResolvedCellCount: hierarchy.leafResolutionLadder.deliveredLadder.underResolvedCellCount,
          underResolvedShare: hierarchy.leafResolutionLadder.deliveredLadder.underResolvedShare,
          worstAchievedRatio: hierarchy.leafResolutionLadder.deliveredLadder.worstAchievedRatio,
          worstCriticalDistanceMeters: hierarchy.leafResolutionLadder.deliveredLadder.worstCriticalDistanceMeters,
          meanFlatFaceShare: hierarchy.leafResolutionLadder.deliveredLadder.meanFlatFaceShare,
        },
        rationale: "PRE-REGISTERED AS ALREADY MISSED, AND BY MORE THAN THE IDEAL LADDER SUGGESTS. An earlier draft derived this bar from the ideal ladder alone and reported 360 of 883; measuring the packer that actually runs moves it to 650 of the 711 packable cells, with a further 172 unpackable at this ceiling. Packing overhead is the dominant term, not a correction to it. Reported at mass bake as a per-cell flag, never averaged away.",
      },
    },

    supersedes: {
      T006_G2: {
        statement: "T006's frozen G2 bar (texturesByteLength <= 2097144 + n*87381, n <= 1) is SUPERSEDED FOR THE FAR TIER ONLY, BY THIS STATEMENT, AND IS NOT REGENERATED. G2 counted shared 128px class tiles bound once per release for the near and mid tiers, where 24 co-resident tiles is the whole texture budget. The far tier's atlases are per-cell derivative artifacts of a different size, count and lifetime, and counting them under G2 would make a frozen record report a quantity it was never designed to measure. G2 remains exactly as committed for the tiers it was measured on; data/exterior-acceptance-20260817/pre-registration.json is not touched, and neither is its checksum.",
      },
      ADR_0047: {
        statement: "ADR 0047 refused an atlas and shipped shared per-class tiles, because the near tier's maximum observed |UV| is 1210.1 and an atlas cannot repeat. THAT FINDING IS REVERSED FOR THE FAR TIER ONLY. The far tier bakes the repetition INTO its atlas patch at far-tier resolution, so its own UVs are inside [0,1] by construction and the repeat problem does not arise. ADR 0047 continues to govern the near and mid tiers unchanged.",
      },
    },

    blenderAgreementInstrument: {
      purpose: "Test whether the baked far-tier tile agrees in APPEARANCE with the shipped lod_0 facades it stands in for, at far-tier viewing distances.",
      preRegisteredBeforeAnyCapture: true,
      sourceDiscipline: "The -c2 payload bytes are gitignored and absent from this machine. The source assets are therefore REGENERATED from the pinned base snapshot through the shipped emitter, and each regenerated GLB's sha256 is verified against the committed -c2 payload-inventory.json before it is rendered. A regenerated asset that does not match its declared checksum STOPS the run; it is never rendered as a substitute.",
      sceneClearing: "Objects are deleted and orphans purged. bpy.ops.wm.read_factory_settings is NEVER called: it unregisters the BlenderMCP addon and killed the channel during T009 Stage 0.",
      renderer: "BLENDER_EEVEE, film_transparent, Standard view transform, one fixed sun, identical across every pose and both subjects.",
      cameraDiscipline: "One camera transform per pose, computed from the SOURCE subject's bounds and REUSED VERBATIM for the baked subject, so any difference is the asset and never the framing.",
      poses: {
        distancesMeters: [400, 1_200, 4_000],
        azimuthsDegrees: [55, 235],
        elevationDegrees: 18,
        note: "400 m is BELOW the far tier's own boundary and is included deliberately as a control: the far tier is not claimed to hold up there, and a miss at 400 m is expected rather than disqualifying. 1,200 m is the boundary the tier must actually meet. 4,000 m is well inside its range.",
      },
      measurement: {
        primary: "MEAN LUMINANCE RATIO over the union silhouette, baked / source. Luminance is Rec. 709 on the linear framebuffer.",
        secondary: "PER-CHANNEL mean ratios, reported to expose hue error, following the T009 harness precedent.",
        tertiary: "INTERSECTION OVER UNION of the two silhouettes, which isolates the prism's GEOMETRIC error from its tonal error. A tonal bar measured over a union silhouette is contaminated by the setbacks the prism fills in, so IoU is reported alongside and neither is allowed to stand for the other.",
      },
      agreementBar: {
        statedInAdvance: true,
        tone: {
          bar: "|meanLuminanceRatio - 1| <= 0.05 at 1,200 m and at 4,000 m",
          rationale: "Looser than T009's 0.02 shed bar, and deliberately so: this comparison holds NEITHER geometry NOR material resolution constant. The prism fills in every setback and the bake absorbs glazing and trim into the facade material. 5% is the tolerance for a tier whose entire premise is that those losses stop mattering at 1.2 km. It is not a claim that 5% is imperceptible.",
        },
        hue: {
          bar: "max per-channel ratio spread <= 0.02",
          rationale: "The bake carries the SAME calibrated palette as lod_0, so a channel spread would mean the gamma decision or the palette lookup is wrong, not that the tier is coarse. This bar tests the composition, not the tier.",
        },
        silhouette: {
          bar: "REPORTED, NOT BARRED. Intersection over union is recorded at every pose with no threshold.",
          rationale: "The prism's silhouette error is a known, measured, accepted property of this tier — median 0.045221 and maximum 0.628806 in the committed census. Setting a bar this tier is designed to miss would be theatre. It is reported so the size of the loss travels with the evidence.",
        },
        reportingRule: "REPORT WITH THRESHOLD. Every pose's measured values are reported against these bars whether they pass or fail. A miss is reported as a miss and is NOT re-explained by a bar chosen afterwards.",
        stopRule: "If the tone bar is missed at 1,200 m or 4,000 m, the prototype STOPS and is reported for a user decision with rendered evidence. It is not tuned until it passes.",
      },
      agreementIsNotLikeness: "AGREEMENT IS NOT LIKENESS. A luminance ratio near 1.0 says the baked tile puts approximately the same amount of light on screen as the source. It does NOT say the two look alike, that either looks like the real building, or that the far tier is visually acceptable. Those are separate judgements and this instrument makes none of them.",
    },

    notClaimedHere: [
      "No far-tier tile has been baked and no still has been captured at the time this record is committed.",
      "These bars are not visual, geographic, factual or performance acceptance.",
      "The budget bars are arithmetic over a modelled camera sweep, not a reading taken from a GPU.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "bake-pre-registration.json"), text);
  await writeFile(join(evidenceRoot, "bake-pre-registration.sha256"), `${sha256HexSync(text)}  bake-pre-registration.json\n`);
  console.log(serialize({ ok: true, checksum: sha256HexSync(text), recipeSha256: farTierRecipeHash(), contractSha256: farTierBudgetContractHash() }));
}

const command = process.argv[2];
if (command === "hierarchy") await commandHierarchy();
else if (command === "preregister") await commandPreregister();
else fail("usage: far-tier-stage0-cli.mjs <hierarchy|preregister>");
