/* global console, process */
/**
 * T010 Stage A: re-census far-tier packing feasibility under recipe v2.
 *
 * WHAT THIS ANSWERS THAT T002's CENSUS DID NOT.
 *
 * 1. ALL NODES, NOT JUST LEAVES. T002 packed the 883 ledger cells and reported
 *    172 as unpackable. It never packed an INTERNAL node, and the far tier is a
 *    hierarchy — if parents cannot be baked, the tier is leaves-only and the
 *    distance ladder above the leaf level does not exist. This census packs all
 *    1,221 nodes.
 * 2. THE FLAT-FACE FIX. v1 gave a constant-colour face a 4x4 content rect; v2
 *    gives it 1x1. Both gutter widths for the flat case are measured, so the
 *    gutter decision rests on a number rather than on a preference.
 *
 * IT DOES NOT TOUCH v1. `far-tier-stage0-cli.mjs` is untouched and still
 * reproduces the T002 records byte for byte; this writes to a NEW directory.
 *
 * Usage: node --experimental-strip-types scripts/far-tier-v2-stage0-cli.mjs census
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  FAR_TIER_BAKE_RECIPE,
  FAR_TIER_BAKE_RECIPE_V2,
  FarTierPackingUnfeasibleError,
  farTierEffectiveParameters,
  packFarTierAtlas,
} from "../src/release/far-tier-bake.ts";
import {
  FAR_TIER_ATLAS_PIXELS,
  FAR_TIER_NEAR_EDGE_METERS,
  farTierDeliveredQuality,
  farTierResolution,
  farTierTexelWorldSizeMeters,
} from "../src/release/far-tier-budget.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-v2-20260818";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);
const snapshotRoot = join(repositoryRoot, "public/data/manhattan-citywide-20260804");
const ledgerRoot = join(repositoryRoot, "data/normalized/manhattan-exterior-wave-ledger-20260804");
const t002Root = join(repositoryRoot, "data/far-tier-hlod-20260818");

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message) => { console.error(`far-tier-v2-stage0: ${message}`); process.exit(1); };
const round = (value, places = 6) => Number.parseFloat(value.toFixed(places));

const METERS_PER_DEGREE_LONGITUDE = FAR_TIER_BAKE_RECIPE.metersPerDegreeLongitude;
const METERS_PER_DEGREE_LATITUDE = FAR_TIER_BAKE_RECIPE.metersPerDegreeLatitude;
const UNKNOWN_HEIGHT_FALLBACK_METERS = 10;
const TARGET_TEXEL_WORLD_SIZE_METERS = farTierTexelWorldSizeMeters(FAR_TIER_NEAR_EDGE_METERS);

/** v2 with the wider flat gutter, so the gutter decision is measured both ways. */
const V2_GUTTER_2 = { ...FAR_TIER_BAKE_RECIPE_V2, recipeId: "far-tier-hlod-bake-v2-flatgutter2", flatFaceGutterTexels: 2 };

async function loadSources() {
  const manifestText = await readFile(join(snapshotRoot, "manifest.json"), "utf8").catch(() => null);
  if (manifestText === null) fail(`base snapshot manifest is absent at ${snapshotRoot}.`);
  const manifest = JSON.parse(manifestText);
  const manifestFileChecksum = sha256HexSync(manifestText);
  const sidecar = (await readFile(join(snapshotRoot, "manifest.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (sidecar !== manifestFileChecksum) fail("base snapshot manifest does not match its own sha256 sidecar.");
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
  const sidecar = (await readFile(join(ledgerRoot, "ledger.sha256"), "utf8")).trim().split(/\s+/u)[0];
  if (sidecar !== checksum) fail("wave ledger does not match its own sha256 sidecar.");
  return { ledger: JSON.parse(text), checksum };
}

/** Per-cell face extents and surface area. Same arithmetic the T002 census used. */
function censusCells(ledger, sources) {
  const cells = [];
  let missing = 0;
  for (const cell of ledger.cells) {
    const faces = [];
    let facadeArea = 0;
    let roofArea = 0;
    let ringVertexCount = 0;
    let present = 0;
    for (const buildingId of cell.buildingIds) {
      const feature = sources.get(buildingId);
      if (!feature) { missing += 1; continue; }
      present += 1;
      const heightMeters = feature.heightMeters == null ? UNKNOWN_HEIGHT_FALLBACK_METERS : feature.heightMeters;
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
        const widthMeters = Math.sqrt(dx * dx + dy * dy);
        facadeArea += widthMeters * heightMeters;
        faces.push({ widthMeters, heightMeters });
        doubleArea += (lon1 * METERS_PER_DEGREE_LONGITUDE) * (lat2 * METERS_PER_DEGREE_LATITUDE)
          - (lon2 * METERS_PER_DEGREE_LONGITUDE) * (lat1 * METERS_PER_DEGREE_LATITUDE);
      }
      const roofFace = Math.abs(doubleArea) / 2;
      roofArea += roofFace;
      faces.push({ widthMeters: Math.sqrt(roofFace), heightMeters: Math.sqrt(roofFace), roof: true });
    }
    const bounds = cell.bounds;
    cells.push({
      cellId: cell.cellId, order: cell.order, faces, buildingCount: present, ringVertexCount,
      surfaceAreaSquareMeters: facadeArea + roofArea,
      quadCount: faces.filter((face) => face.roof !== true).length,
      triangleCount: ringVertexCount - 2 * present,
      west: bounds.west * METERS_PER_DEGREE_LONGITUDE, east: bounds.east * METERS_PER_DEGREE_LONGITUDE,
      south: bounds.south * METERS_PER_DEGREE_LATITUDE, north: bounds.north * METERS_PER_DEGREE_LATITUDE,
    });
  }
  return { cells, missing };
}

/** The ledger's own quadtree, rolled up to a root. Identical rule to T002. */
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
    const key = `${zoom}/${x}/${y}`;
    if (nodes.has(key)) fail(`tile key ${key} is claimed twice; the hierarchy would silently drop a cell.`);
    nodes.set(key, { zoom, x, y, leaf: true, cellId: cell.cellId, cell, children: [], surfaceAreaSquareMeters: cell.surfaceAreaSquareMeters });
  }
  const ROOT_ZOOM = 8;
  for (let zoom = deepest; zoom > ROOT_ZOOM; zoom -= 1) {
    for (const node of [...nodes.values()]) {
      if (node.zoom !== zoom) continue;
      const key = `${zoom - 1}/${node.x >> 1}/${node.y >> 1}`;
      let parent = nodes.get(key);
      if (!parent) {
        parent = { zoom: zoom - 1, x: node.x >> 1, y: node.y >> 1, leaf: false, cellId: null, cell: null, children: [], surfaceAreaSquareMeters: 0 };
        nodes.set(key, parent);
      }
      parent.children.push(node);
      parent.surfaceAreaSquareMeters += node.surfaceAreaSquareMeters;
    }
  }
  return { nodes, roots: [...nodes.values()].filter((node) => node.zoom === ROOT_ZOOM) };
}

/** Face extents in the shape the packer reads. Only extents matter to packing. */
function packableFaces(faces) {
  return faces.map((face, index) => {
    const widthMm = face.widthMeters * 1_000;
    const heightMm = face.heightMeters * 1_000;
    return {
      buildingId: `synthetic:${String(index).padStart(7, "0")}`,
      faceIndex: index,
      kind: face.roof === true ? "roof" : "wall",
      areaSquareMeters: face.widthMeters * face.heightMeters,
      cornersMm: [[0, 0, 0], [widthMm, 0, 0], [widthMm, 0, heightMm], [0, 0, heightMm]],
      offsetMeters: [0, 0],
      zones: [],
    };
  });
}

function atlasPixelsFor(surfaceAreaSquareMeters) {
  return farTierResolution(Math.max(surfaceAreaSquareMeters, 1e-6)).atlasPixels;
}

/** Pack one node under one recipe, classifying the outcome. */
function packNode(faces, surfaceArea, recipe) {
  const atlasPixels = atlasPixelsFor(surfaceArea);
  try {
    const packing = packFarTierAtlas(packableFaces(faces), atlasPixels, TARGET_TEXEL_WORLD_SIZE_METERS, recipe);
    const delivered = farTierDeliveredQuality(packing.texelWorldSizeMeters);
    return {
      packed: true, atlasPixels, appliedScale: packing.appliedScale,
      deliveredRatio: delivered.achievedRatio, deliveredUnderResolved: delivered.underResolved,
      flatFaceShare: packing.flatFaceCount / Math.max(1, packing.faces.length),
      occupancy: packing.occupancy,
    };
  } catch (error) {
    if (!(error instanceof FarTierPackingUnfeasibleError)) throw error;
    return { packed: false, atlasPixels, faceCount: faces.length };
  }
}

function summarize(rows) {
  const packed = rows.filter((row) => row.packed);
  const scales = {};
  for (const row of packed) scales[row.appliedScale] = (scales[row.appliedScale] ?? 0) + 1;
  const ratios = packed.map((row) => row.deliveredRatio).sort((left, right) => left - right);
  return {
    nodes: rows.length,
    packedCount: packed.length,
    unpackableCount: rows.length - packed.length,
    unpackableShare: round((rows.length - packed.length) / Math.max(1, rows.length), 6),
    underResolvedCount: packed.filter((row) => row.deliveredUnderResolved).length,
    underResolvedShareOfPacked: round(packed.filter((row) => row.deliveredUnderResolved).length / Math.max(1, packed.length), 6),
    appliedScaleHistogram: scales,
    deliveredRatio: ratios.length === 0 ? null : {
      min: round(ratios[0], 6),
      median: round(ratios[Math.floor(ratios.length / 2)], 6),
      max: round(ratios[ratios.length - 1], 6),
    },
    meanFlatFaceShare: packed.length === 0 ? null : round(packed.reduce((sum, row) => sum + row.flatFaceShare, 0) / packed.length, 6),
  };
}

async function commandCensus() {
  const { manifest, manifestFileChecksum, sources } = await loadSources();
  const { ledger, checksum: ledgerChecksum } = await loadLedger();
  const { cells, missing } = censusCells(ledger, sources);
  if (missing > 0) fail(`${missing} ledger building ids are absent from the base snapshot; the census must be total.`);
  const { nodes, roots } = buildTree(cells);

  const RECIPES = [
    { id: "v1", recipe: FAR_TIER_BAKE_RECIPE },
    { id: "v2-flatgutter2", recipe: V2_GUTTER_2 },
    { id: "v2-flatgutter1", recipe: FAR_TIER_BAKE_RECIPE_V2 },
  ];

  // Post-order: each node returns its own descendant-leaf face list, the parent
  // concatenates, and the list is released once the parent has packed. Peak
  // memory is one root's worth rather than the whole tree's.
  const byRecipe = new Map(RECIPES.map((entry) => [entry.id, { leaves: [], internal: [] }]));
  const perNodeFaceCount = { leaves: [], internal: [] };
  const byZoom = new Map(RECIPES.map((entry) => [entry.id, new Map()]));

  const visit = (node) => {
    let faces;
    if (node.leaf) faces = node.cell.faces;
    else {
      faces = [];
      for (const child of node.children) faces = faces.concat(visit(child));
    }
    const bucket = node.leaf ? "leaves" : "internal";
    perNodeFaceCount[bucket].push(faces.length);
    for (const entry of RECIPES) {
      const outcome = packNode(faces, node.surfaceAreaSquareMeters, entry.recipe);
      byRecipe.get(entry.id)[bucket].push(outcome);
      const zoomMap = byZoom.get(entry.id);
      if (!zoomMap.has(node.zoom)) zoomMap.set(node.zoom, []);
      zoomMap.get(node.zoom).push(outcome);
    }
    return faces;
  };
  for (const root of roots) visit(root);

  const leafCount = [...nodes.values()].filter((node) => node.leaf).length;
  const internalCount = nodes.size - leafCount;

  const t002 = JSON.parse(await readFile(join(t002Root, "stage0-hierarchy.json"), "utf8"));
  const t002Checksum = sha256HexSync(await readFile(join(t002Root, "stage0-hierarchy.json"), "utf8"));

  const results = {};
  for (const entry of RECIPES) {
    const buckets = byRecipe.get(entry.id);
    results[entry.id] = {
      parameters: farTierEffectiveParameters(entry.recipe),
      minimumTexelsPerFlatFace: (farTierEffectiveParameters(entry.recipe).flatFaceTexels + 2 * farTierEffectiveParameters(entry.recipe).flatFaceGutterTexels) ** 2,
      leaves: summarize(buckets.leaves),
      internalNodes: summarize(buckets.internal),
      allNodes: summarize([...buckets.leaves, ...buckets.internal]),
      // PER ZOOM LEVEL. This is what decides whether the far tier has a usable
      // distance ladder or is leaves-only: a level whose nodes cannot be baked
      // does not exist as a level, however affordable its memory would be.
      byZoomLevel: [...byZoom.get(entry.id).entries()]
        .sort((left, right) => right[0] - left[0])
        .map(([zoom, rows]) => ({
          zoom,
          nodes: rows.length,
          packedCount: rows.filter((row) => row.packed).length,
          unpackableCount: rows.filter((row) => !row.packed).length,
        })),
    };
  }

  const sortedLeafFaces = [...perNodeFaceCount.leaves].sort((left, right) => left - right);
  const sortedInternalFaces = [...perNodeFaceCount.internal].sort((left, right) => left - right);

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:stage-a-packing-census`,
    task: "T010",
    artifact: "far-tier-v2-packing-feasibility-census",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. Every number here is arithmetic over committed inputs; a timestamp would be the only field a replay could not reproduce.",
    claim: "Packing feasibility and delivered resolution for every node of the far-tier hierarchy, under recipe v1 and under recipe v2 at both candidate flat-face gutter widths.",

    lineage: {
      supersedesRecord: "data/far-tier-hlod-20260818/stage0-hierarchy.json",
      supersededRecordSha256: t002Checksum,
      supersededRecordIsImmutable: "The T002 records and their sidecars are NOT edited by this task. Its own amendments block forbids it, and this record lives in a separate directory precisely so that stays true.",
      whatT002Measured: {
        leavesOnly: true,
        leafUnpackableCount: t002.leafResolutionLadder.faceCountCeiling.packerMeasuredUnpackableCellCount,
        leafUnderResolvedCount: t002.leafResolutionLadder.deliveredLadder.underResolvedCellCount,
        internalNodesNeverPacked: "T002 packed the 883 ledger cells and no internal node at all, so it could not see whether the hierarchy above the leaf level is bakeable.",
      },
    },

    inputs: {
      baseRelease: { releaseId: manifest.releaseId, manifestFileChecksumSha256: manifestFileChecksum },
      ledger: { ledgerId: ledger.ledgerId, checksumSha256: ledgerChecksum, cellCount: ledger.cells.length },
      targetTexelWorldSizeMeters: round(TARGET_TEXEL_WORLD_SIZE_METERS),
      atlasPixelBounds: FAR_TIER_ATLAS_PIXELS,
      atlasCeilingUnchanged: "B1-B5 are NOT touched by this task. The atlas ceiling stays at 256 and no memory bar moves; the only change is how many texels a resolved-away face costs.",
    },

    hierarchy: {
      totalNodes: nodes.size,
      leafNodes: leafCount,
      internalNodes: internalCount,
      facesPerLeaf: { min: sortedLeafFaces[0], median: sortedLeafFaces[Math.floor(sortedLeafFaces.length / 2)], p99: sortedLeafFaces[Math.floor(0.99 * sortedLeafFaces.length)], max: sortedLeafFaces[sortedLeafFaces.length - 1] },
      facesPerInternalNode: { min: sortedInternalFaces[0], median: sortedInternalFaces[Math.floor(sortedInternalFaces.length / 2)], p99: sortedInternalFaces[Math.floor(0.99 * sortedInternalFaces.length)], max: sortedInternalFaces[sortedInternalFaces.length - 1] },
    },

    results,
    notClaimedHere: [
      "This is packing arithmetic. It says nothing about how the tier LOOKS.",
      "No tile was baked and no still was captured for this record.",
      "Delivered resolution is measured with synthetic ordering keys, so a cell's appliedScale here is representative of a real bake rather than byte-identical to it: face world area is the primary sort in both and only ties break differently.",
    ],
  };

  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, "stage-a-packing-census.json"), text);
  await writeFile(join(evidenceRoot, "stage-a-packing-census.sha256"), `${sha256HexSync(text)}  stage-a-packing-census.json\n`);
  console.log(serialize({
    ok: true,
    checksum: sha256HexSync(text),
    nodes: nodes.size,
    v1: { leafUnpackable: results.v1.leaves.unpackableCount, internalUnpackable: results.v1.internalNodes.unpackableCount },
    v2g2: { leafUnpackable: results["v2-flatgutter2"].leaves.unpackableCount, internalUnpackable: results["v2-flatgutter2"].internalNodes.unpackableCount },
    v2g1: { leafUnpackable: results["v2-flatgutter1"].leaves.unpackableCount, internalUnpackable: results["v2-flatgutter1"].internalNodes.unpackableCount },
  }));
}

const command = process.argv[2];
if (command === "census") await commandCensus();
else fail("usage: far-tier-v2-stage0-cli.mjs <census>");
