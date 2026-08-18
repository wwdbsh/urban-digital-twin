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
  farTierResolution,
  farTierTexelWorldSizeMeters,
} from "../src/release/far-tier-budget.ts";
import { FAR_TIER_BAKE_RECIPE, farTierRecipeHash } from "../src/release/far-tier-bake.ts";
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
        const area = Math.hypot(dx, dy) * heightMeters;
        facadeArea += area;
        faceCount += 1;
        faceAreas.push(area);
        doubleArea += (lon1 * METERS_PER_DEGREE_LONGITUDE) * (lat2 * METERS_PER_DEGREE_LATITUDE)
          - (lon2 * METERS_PER_DEGREE_LONGITUDE) * (lat1 * METERS_PER_DEGREE_LATITUDE);
      }
      roofArea += Math.abs(doubleArea) / 2;
    }
    const bounds = cell.bounds;
    cells.push({
      cellId: cell.cellId,
      order: cell.order,
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
    nodes.set(`${zoom}/${x}/${y}`, {
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
function sweepResidency(nodes, roots) {
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
  const STEPS = 12;
  for (const altitudeMeters of [400, 800, 1_200, 2_000, 4_000, 8_000, 16_000]) {
    for (let i = 0; i <= STEPS; i += 1) {
      for (let j = 0; j <= STEPS; j += 1) {
        const camera = [west + ((east - west) * i) / STEPS, south + ((north - south) * j) / STEPS, altitudeMeters];
        let atlasBytes = 0;
        let geometryBytes = 0;
        let nodeCount = 0;
        const visit = (node) => {
          const dx = Math.max(node.west - camera[0], 0, camera[0] - node.east);
          const dy = Math.max(node.south - camera[1], 0, camera[1] - node.north);
          const near = Math.hypot(dx, dy, camera[2]);
          const far = Math.hypot(
            Math.max(Math.abs(node.west - camera[0]), Math.abs(node.east - camera[0])),
            Math.max(Math.abs(node.south - camera[1]), Math.abs(node.north - camera[1])),
            camera[2],
          );
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
          worst = { altitudeMeters, nodeCount, atlasGpuBytes: atlasBytes, geometryGpuBytes: geometryBytes, totalGpuBytes: atlasBytes + geometryBytes };
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
  const worst = sweepResidency(nodes, roots);

  const leafResolutions = cells.map((cell) => farTierResolution(Math.max(cell.surfaceAreaSquareMeters, 1e-6)));
  const underResolved = leafResolutions.filter((entry) => entry.underResolved);
  const atlasHistogram = {};
  for (const entry of leafResolutions) atlasHistogram[entry.atlasPixels] = (atlasHistogram[entry.atlasPixels] ?? 0) + 1;

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
      underResolvedCellCount: underResolved.length,
      underResolvedShare: round(underResolved.length / cells.length, 6),
      worstAchievedRatio: round(Math.min(...leafResolutions.map((entry) => entry.achievedRatio)), 6),
      worstCriticalDistanceMeters: Math.round(Math.max(...leafResolutions.map((entry) => entry.criticalDistanceMeters))),
      honesty: "THIS IS THE TIER'S LARGEST QUALITY SHORTFALL AND IT IS STATED RATHER THAN FUNDED. A leaf whose surface area exceeds what a 256px atlas can carry at ratio 1.0 does not get a bigger atlas and does not get a waiver: it renders blurrier than target between the 1,200 m boundary and its own critical distance. Raising the ceiling to 512 or 1024 would fix it at a worst-case resident cost of 209.8 MiB or 346.0 MiB respectively, against 126.4 MiB at 256. Splitting the leaf below the ledger cell would also fix it and is a T004 question, not one this prototype may answer.",
    },
    hierarchy: {
      nodeCount: nodes.size,
      leafCount: cells.length,
      rootCount: roots.length,
      pyramidProperty: "A parent covers 4x the area at 2x the texel size, so its texel count is the same as one child's. The ladder is therefore bounded: resolution per node is constant across levels and only the node COUNT falls with distance.",
      geometryLimitation: "THE HIERARCHY REDUCES TEXTURE RESIDENCY WITH DISTANCE AND DOES NOT REDUCE GEOMETRY RESIDENCY AT ALL. A parent node here is the concatenation of its children's prisms, not a simplified massing of them, so coarsening the cut moves texture bytes and leaves geometry bytes almost unchanged — which is why the swept geometry worst case equals the whole island's prism geometry rather than some fraction of it. At 93.8 MiB that is affordable and bounded, so it does not block this prototype. It is named here rather than discovered during a mass bake: parent-node geometry simplification is a real prerequisite for any tier that must grow past this island's size, and it is out of T002's scope.",
    },
    worstCaseResidency: {
      method: "Maximum over a 13x13 camera grid across the island bounding box at seven altitudes, with NO frustum culling and NO occlusion. Every conservatism here makes the bound larger, never smaller.",
      altitudesMeters: [400, 800, 1_200, 2_000, 4_000, 8_000, 16_000],
      ...worst,
      atlasGpuMebibytes: round(worst.atlasGpuBytes / 1_048_576, 2),
      geometryGpuMebibytes: round(worst.geometryGpuBytes / 1_048_576, 2),
      totalGpuMebibytes: round(worst.totalGpuBytes / 1_048_576, 2),
    },
    allLeavesResidentUpperBound: {
      note: "The degenerate case where the hierarchy is ignored entirely and every leaf is resident at once. It is NOT the budget; it is what the budget buys protection from.",
      atlasGpuBytes: cells.reduce((sum, cell) => sum + farTierAtlasGpuBytes(farTierResolution(Math.max(cell.surfaceAreaSquareMeters, 1e-6)).atlasPixels), 0),
      geometryGpuBytes: cells.reduce((sum, cell) => sum + farTierGeometryGpuBytes(cell.quadCount, cell.triangleCount), 0),
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
    underResolvedCells: underResolved.length,
    worstResidentMiB: round(worst.totalGpuBytes / 1_048_576, 2),
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
    status: "PRE-REGISTERED — written and committed BEFORE any far-tier tile was baked and before any still was captured",
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
      contractSha256: farTierBudgetContractHash(),
      scopeStatement: FAR_TIER_BUDGET_CONTRACT.scope,
      separateFromCriterion30: "THE FAR TIER GETS ITS OWN BUDGET AND IS NOT FOLDED INTO THE CLOSED 256 MiB CRITERION #30. That criterion was frozen against a measurement this tier did not exist for. Adding a new tier's memory to a closed criterion would silently reopen it. The two budgets are ADDED when a total is needed, never merged.",
      B1: {
        rule: `Baked atlas edge length is a power of two in [${FAR_TIER_ATLAS_PIXELS.minimum}, ${FAR_TIER_ATLAS_PIXELS.maximum}] texels.`,
        rationale: "Derived, not chosen: worst-case resident texture memory over the swept camera grid is 126.4 MiB at a 256 ceiling, 209.8 MiB at 512 and 346.0 MiB at 1024.",
      },
      B2: {
        rule: `One far-tier tile occupies at most ${FAR_TIER_BUDGET_CONTRACT.maxTileAtlasGpuBytes} decoded GPU bytes of texture, mip chain included.`,
        expectedByteLength: FAR_TIER_BUDGET_CONTRACT.maxTileAtlasGpuBytes,
        rationale: "256 * 256 * 4 bytes * 4/3 for the mip chain.",
      },
      B3: {
        rule: `Resident far-tier TEXTURE memory never exceeds ${FAR_TIER_BUDGET_CONTRACT.maxResidentAtlasGpuBytes} decoded GPU bytes at any camera pose.`,
        derivedValue: hierarchy.worstCaseResidency.atlasGpuBytes,
        rationale: "Maximum over a 13x13 camera grid at seven altitudes, with no frustum culling and no occlusion. Every conservatism enlarges the bound.",
      },
      B4: {
        rule: `Resident far-tier GEOMETRY memory never exceeds ${FAR_TIER_BUDGET_CONTRACT.maxResidentGeometryGpuBytes} decoded GPU bytes at any camera pose.`,
        derivedValue: hierarchy.worstCaseResidency.geometryGpuBytes,
      },
      B5: {
        rule: `Resident far-tier TOTAL never exceeds ${FAR_TIER_BUDGET_CONTRACT.maxResidentTotalGpuBytes} decoded GPU bytes at any camera pose.`,
        derivedValue: hierarchy.worstCaseResidency.totalGpuBytes,
      },
      B6: {
        rule: `Every leaf reaches texel ratio ${FAR_TIER_TEXEL_RATIO.floor} at the ${FAR_TIER_NEAR_EDGE_METERS} m boundary, or is REPORTED as under-resolved with its critical distance.`,
        knownToBeMissed: true,
        measuredShortfall: {
          underResolvedCellCount: hierarchy.leafResolutionLadder.underResolvedCellCount,
          underResolvedShare: hierarchy.leafResolutionLadder.underResolvedShare,
          worstAchievedRatio: hierarchy.leafResolutionLadder.worstAchievedRatio,
          worstCriticalDistanceMeters: hierarchy.leafResolutionLadder.worstCriticalDistanceMeters,
        },
        rationale: "PRE-REGISTERED AS ALREADY MISSED. The arithmetic that fixes the ceiling at 256 also proves this bar cannot be met inside it, and saying so here is the whole point of pre-registering. It is reported at mass bake as a per-cell flag, never averaged away.",
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
