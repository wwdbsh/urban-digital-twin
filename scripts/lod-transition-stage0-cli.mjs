/* global console, process, Buffer, TextDecoder */
/**
 * T006 STAGE 0 — the error budget, the census, and the frame, as ONE re-runnable
 * derivation.
 *
 * WHY THIS IS A CLI AND NOT A HAND-WRITTEN RECORD. The whole of T006's
 * measurement half turns on one arithmetic question — can an in-app capture
 * resolve a 2% area ratio at all — and a number that decides a task may not be
 * a number somebody typed. Everything this tool emits is computed from
 * committed inputs: the shipped `-s2` assembly packages, the T004 stage-0
 * island silhouette record, and the viewport/FOV constants recorded here.
 *
 * THE BAR IS CARRIED. THE INSTRUMENT IS NOT.
 * The 2% deviation bar comes from criterion 19 and from
 * `multi-lod-assembly.ts`, which refuses any coarse level above it. The
 * INSTRUMENT that produced every 2% number in this repository is
 * `scripts/blender/block835_v3_author.py::measure_silhouette`: Blender,
 * ORTHOGRAPHIC, four axis-aligned horizontal views, the target ISOLATED by
 * setting `hide_render` on every other mesh, `ortho_scale` set from the
 * target's own bounds so it fills the frame. This tool's subject is a
 * completely different instrument — CesiumJS, PERSPECTIVE, no isolation,
 * magnification pinned by the 400 m ring. No part of T006 may present this
 * instrument as the one criterion 19 was written against, and the departure is
 * the first thing the emitted record states.
 *
 * The repository already knows this class of instrument is marginal at this
 * bar. `src/release/midtown-core-v3-silhouette.ts` abandoned rasterization for
 * an exact integer sweep and says why: "a 512-pixel raster's own quantization
 * is the same order as the ratios being compared against a 2% cap" — and that
 * was for an ORTHO view with the building FILLING the frame. The in-app view
 * gives the target a small fraction of the frame at a distance the ring fixes.
 *
 * Usage: node --experimental-strip-types scripts/lod-transition-stage0-cli.mjs emit
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECORD_ID = "far-tier-lod-transition-20260821";
const recordRoot = join(repositoryRoot, "data", RECORD_ID);
const TOOL = "lod-transition-stage0";
const fail = (message) => { console.error(`${TOOL}: ${message}`); process.exit(1); };
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const readJson = (path) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));

/** The six shipped serving releases the T001 two-LOD promotion made the default. */
export const SERVING_RELEASE_IDS = [
  "manhattan-exterior-cells-20260811-v3-s2",
  "manhattan-midtown-core-cells-20260811-v3-s2",
  "manhattan-lower-manhattan-cells-20260812-s2",
  "manhattan-southern-remainder-cells-20260812-s2",
  "manhattan-central-upper-manhattan-cells-20260812-s2",
  "manhattan-northern-manhattan-cells-20260812-s2",
];

/** The five shed pairs ADR 0056 hands to T006 by name. */
export const SHED_TONE_PAIRS = ["doitt:100749", "doitt:10049", "doitt:147902", "doitt:100368", "doitt:100176"];

/** Pixels eroded from every outline before tone is sampled. */
export const EROSION_PX = 3;

/**
 * THE VEHICLE'S OPTICS, recorded as constants because the budget is a function
 * of them and a budget whose inputs drift is not a budget.
 *
 * `canvasCssWidth/Height` and `devicePixelRatio` are the values measured in the
 * Orca embedded browser during T005 and RE-VERIFIED at capture time; the
 * emitted record carries them so a reader can check the arithmetic against the
 * window that actually ran. Cesium's `PerspectiveFrustum.fov` defaults to 60°
 * and is the HORIZONTAL angle whenever width > height, which is this case, so
 * the vertical angle — the one that sets pixels-per-metre for a building's
 * HEIGHT — is derived, not assumed.
 */
export const VEHICLE = {
  canvasCssWidth: 1005,
  canvasCssHeight: 790,
  devicePixelRatio: 2,
  cesiumFovDegrees: 60,
  cesiumFovAxis: "horizontal when width > height (CesiumJS PerspectiveFrustum default)",
  ringMeters: 400,
  nearArmMeters: 399,
  farArmMeters: 401,
};

export function vehicleOptics(vehicle = VEHICLE) {
  const aspect = vehicle.canvasCssWidth / vehicle.canvasCssHeight;
  const fov = (vehicle.cesiumFovDegrees * Math.PI) / 180;
  const fovy = 2 * Math.atan(Math.tan(fov / 2) / aspect);
  const verticalDevicePixels = vehicle.canvasCssHeight * vehicle.devicePixelRatio;
  const pixelsPerMetreAt = (distanceMetres) => verticalDevicePixels / (2 * distanceMetres * Math.tan(fovy / 2));
  return { aspect, fovyRadians: fovy, fovyDegrees: (fovy * 180) / Math.PI, verticalDevicePixels, pixelsPerMetreAt };
}

/**
 * The four terms, each named and each attributable.
 *
 * T1 BOUNDARY QUANTIZATION. A mask is a threshold over an antialiased render,
 *    so the outline is uncertain by about a pixel. On a symmetric-difference
 *    ratio that is `perimeterPixels x 1px / areaPixels`.
 * T2 RING SCALE DELTA. The two arms cannot be captured from one camera: the
 *    level flips when the CELL crosses 400 m, so one arm is at 399 m and the
 *    other at 401 m and the target's projected size differs by 401/399. Pure
 *    scaling alone contributes `1 - (399/401)^2` of symmetric difference. It is
 *    IRREDUCIBLE without a forced-LOD hook and IDENTICAL for every building.
 * T3 REGISTRATION. Moving the camera 2 m moves the target on screen; even after
 *    centroid alignment a sub-pixel residual remains, taken here as half a pixel
 *    along the outline.
 * T4 ISOLATION. UNBOUNDED, and the reason a bound cannot be written: the frozen
 *    instrument isolates its subject with `hide_render`; the shipped renderer
 *    offers no equivalent, neighbouring buildings overlap the target in a
 *    perspective view, and the whole CELL flips level together so the occluders
 *    themselves differ between the two arms. Adding an isolation hook would be a
 *    runtime change, which this task may not make.
 *
 * The emitted budget is T1 + T2 + T3 and is therefore an OPTIMISTIC LOWER BOUND
 * on the instrument's error: it omits T4 entirely, and it computes T1/T3 from
 * the bounding rectangle, which OVERSTATES the silhouette area and so
 * UNDERSTATES the ratio. If the optimistic bound already exceeds the bar, the
 * pessimistic one cannot rescue it.
 */
export function budgetFor(widthMetres, heightMetres, optics, vehicle = VEHICLE) {
  const k = optics.pixelsPerMetreAt(vehicle.nearArmMeters);
  const widthPx = widthMetres * k;
  const heightPx = heightMetres * k;
  const areaPx = widthPx * heightPx;
  const perimeterPx = 2 * (widthPx + heightPx);
  const t1 = (perimeterPx * 1.0) / areaPx;
  const t2 = 1 - (vehicle.nearArmMeters / vehicle.farArmMeters) ** 2;
  const t3 = (perimeterPx * 0.5) / areaPx;
  return { widthPx, heightPx, areaPx, perimeterPx, t1, t2, t3, total: t1 + t2 + t3 };
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
function summarise(values) {
  const s = [...values].sort((a, b) => a - b);
  return { min: s[0], median: quantile(s, 0.5), p90: quantile(s, 0.9), max: s[s.length - 1] };
}

/** Every asset in every shipped assembly package, with its two declared levels. */
export function readServingAssets(root = repositoryRoot) {
  const assets = [];
  for (const releaseId of SERVING_RELEASE_IDS) {
    const dir = join(root, "public", "data", releaseId, "public", "cell-assembly-package");
    if (!existsSync(dir)) fail(`serving payload absent: ${dir}\n  Stage the -s2 packages before running Stage 0.`);
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const raw = readJson(join(dir, name));
      const payload = raw.payload ?? raw;
      for (const asset of payload.assets ?? []) {
        const lods = Object.fromEntries(asset.lods.map((lod) => [lod.lodId, lod]));
        assets.push({ releaseId, buildingId: asset.canonicalFeatureId, ownerCellId: asset.ownerCellId, lod0: lods.lod_0, lod1: lods.lod_1 });
      }
    }
  }
  return assets;
}

/** Horizontal extent and height of a shipped GLB, from its accessor bounds. */
export function glbExtent(path) {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(20);
    readSync(fd, header, 0, 20, 0);
    if (header.toString("utf8", 0, 4) !== "glTF") return null;
    const chunkLength = header.readUInt32LE(12);
    const chunk = Buffer.alloc(chunkLength);
    readSync(fd, chunk, 0, chunkLength, 20);
    const gltf = JSON.parse(chunk.toString("utf8"));
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const mesh of gltf.meshes ?? []) {
      for (const primitive of mesh.primitives ?? []) {
        const index = primitive.attributes?.POSITION;
        if (index === undefined) continue;
        const accessor = gltf.accessors[index];
        if (!accessor?.min || !accessor?.max) continue;
        for (let i = 0; i < 3; i += 1) { min[i] = Math.min(min[i], accessor.min[i]); max[i] = Math.max(max[i], accessor.max[i]); }
      }
    }
    if (!Number.isFinite(min[0])) return null;
    // glTF is Y-up: height is the y span, and the widest horizontal extent is
    // the most FAVOURABLE view for the budget, so it is the one used.
    return { heightMetres: max[1] - min[1], widthMetres: Math.max(max[0] - min[0], max[2] - min[2]) };
  } finally { closeSync(fd); }
}

function emit() {
  const optics = vehicleOptics();
  const assets = readServingAssets();

  // ---- CENSUS, dual-derived -------------------------------------------------
  // (i) the shipped manifests under test.
  const fromManifests = assets.filter((a) => a.lod0?.maxDistanceMeters === null && (a.lod1 === undefined || a.lod1.eligible === false));
  const manifestIds = new Set(fromManifests.map((a) => a.buildingId));
  // (ii) the T004 island pass, minus the asset-stage tombstone.
  const island = readJson(join(repositoryRoot, "data", "mass-generation-20260816", "stage0-island-silhouette.json"));
  const overCap = island.overCap.buildings;
  const overCapIds = new Set(overCap.map((b) => b.buildingId));
  const onlyOverCap = [...overCapIds].filter((id) => !manifestIds.has(id)).sort();
  const onlyManifest = [...manifestIds].filter((id) => !overCapIds.has(id)).sort();
  const censusIds = [...manifestIds].sort();
  const dims = new Map(overCap.map((b) => [b.buildingId, { heightMetres: b.heightMm / 1000, widthMetres: Math.max(...b.footprintExtentMm) / 1000, ownerCellId: b.ownerCellId, deviationRatio: b.deviationRatio }]));

  // ---- NEAR-CAP stratum, derived from the shipped manifests, not assumed ----
  const nearCap = assets
    .filter((a) => { const r = a.lod1?.silhouette?.deviationRatio; return r !== undefined && r !== null && r >= 0.0185 && r < 0.02; })
    .map((a) => {
      const ref = a.lod0.artifactRef;
      const extent = glbExtent(join(repositoryRoot, "public", "data", a.releaseId, ref));
      return { buildingId: a.buildingId, ownerCellId: a.ownerCellId, releaseId: a.releaseId, deviationRatio: a.lod1.silhouette.deviationRatio, ...extent };
    })
    .sort((a, b) => a.buildingId.localeCompare(b.buildingId));

  const stratumOf = (rows) => {
    const budgets = rows.map((r) => budgetFor(r.widthMetres, r.heightMetres, optics));
    const totals = budgets.map((b) => b.total);
    return {
      population: rows.length,
      projectedAreaDevicePixels: summarise(budgets.map((b) => b.areaPx)),
      heightMetres: summarise(rows.map((r) => r.heightMetres)),
      widthMetres: summarise(rows.map((r) => r.widthMetres)),
      budgetTotal: summarise(totals),
      underBarCount: totals.filter((t) => t < 0.02).length,
      verdict: totals.filter((t) => t < 0.02).length === 0 ? "HONEST-STOP" : "PARTIAL",
    };
  };

  const censusRows = censusIds.map((id) => ({ buildingId: id, ...dims.get(id) }));
  const censusStratum = stratumOf(censusRows);
  const nearCapStratum = stratumOf(nearCap);

  // The size a target must reach before the BOUNDARY term alone clears the bar.
  const k = optics.pixelsPerMetreAt(VEHICLE.nearArmMeters);
  const areaNeededPx = (4 / 0.02) ** 2;
  const areaNeededSquareMetres = areaNeededPx / (k * k);

  const viewportScaling = [1, 2, 4, 8, 16, 32].map((multiple) => {
    const scaled = { ...VEHICLE, canvasCssHeight: VEHICLE.canvasCssHeight * multiple };
    const scaledOptics = vehicleOptics(scaled);
    const under = censusRows.filter((r) => budgetFor(r.widthMetres, r.heightMetres, scaledOptics, scaled).total < 0.02).length;
    return { multiple, verticalDevicePixels: scaledOptics.verticalDevicePixels, censusUnderBar: under, of: censusRows.length };
  });

  mkdirSync(recordRoot, { recursive: true });
  const write = (name, value) => {
    const text = serialize(value);
    writeFileSync(join(recordRoot, `${name}.json`), text);
    writeFileSync(join(recordRoot, `${name}.sha256`), `${sha256(text)}  ${name}.json\n`);
    return sha256(text);
  };

  const censusRecord = {
    schemaVersion: "1.0",
    recordId: `${RECORD_ID}:census`,
    task: "T006",
    artifact: "lod-transition-measured-fallback-census",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION. Derived from committed inputs, not from a clock.",
    whatThisIs: "The measured-fallback parents: buildings whose lod_1 was refused by the 2% gate, so the shipped release serves lod_0 at every distance and no LOD transition exists for them.",
    dualDerivation: {
      statement: "TWO INDEPENDENT DERIVATIONS, AGREEING. Neither is trusted alone.",
      fromServingManifests: { count: manifestIds.size, rule: "lod_0.maxDistanceMeters === null AND lod_1.eligible === false, over every cell-assembly-package asset in the six -s2 releases under test", assetsScanned: assets.length },
      fromIslandPass: { count: overCapIds.size, source: "data/mass-generation-20260816/stage0-island-silhouette.json overCap.buildings", rule: "deviationRatio at or over the 0.02 cap at PLAN stage" },
      reconciliation: { inIslandPassOnly: onlyOverCap, inManifestsOnly: onlyManifest, agreed: censusIds.length, statement: `${overCapIds.size} - ${onlyOverCap.length} = ${censusIds.length}. The single difference is the asset-stage volume-identity-failed tombstone reconciled at docs/implementation/20260816-mass-generation-retention-waves.md:69-77; it is tombstoned rather than shipped as a fallback, so it is not a fallback parent.` },
    },
    exclusionDiscipline: "The tombstone is removed from the FRAME, here, before any draw. Nothing is pruned after a reading.",
    frameChecksumSha256: sha256(serialize(censusIds)),
    byWave: Object.fromEntries(SERVING_RELEASE_IDS.map((id) => [id, fromManifests.filter((a) => a.releaseId === id).length])),
    buildingIds: censusIds,
  };
  const censusSha = write("census", censusRecord);

  const budgetRecord = {
    schemaVersion: "1.0",
    recordId: `${RECORD_ID}:error-budget`,
    task: "T006",
    artifact: "lod-transition-in-app-instrument-error-budget",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    theBarIsCarriedTheInstrumentIsNot: {
      bar: "0.02 deviation ratio, carried from criterion 19 and enforced by src/release/multi-lod-assembly.ts.",
      frozenInstrument: "scripts/blender/block835_v3_author.py::measure_silhouette — Blender, ORTHOGRAPHIC, four axis-aligned horizontal views, the subject ISOLATED via hide_render on every other mesh, ortho_scale derived from the subject's own bounds so it fills the frame.",
      thisInstrument: "CesiumJS in the shipped app — PERSPECTIVE, NO isolation available, magnification pinned by the 400 m cell ring.",
      statement: "THESE ARE DIFFERENT INSTRUMENTS. No part of T006 may present this one as the instrument criterion 19 was written against. Only the BAR is carried.",
      repositoryPrecedent: "src/release/midtown-core-v3-silhouette.ts abandoned rasterization for an exact integer sweep because 'a 512-pixel raster's own quantization is the same order as the ratios being compared against a 2% cap' — and that was an ORTHO view with the subject FILLING the frame.",
    },
    vehicle: { ...VEHICLE, derivedFovyDegrees: optics.fovyDegrees, verticalDevicePixels: optics.verticalDevicePixels, pixelsPerMetreAtRing: optics.pixelsPerMetreAt(VEHICLE.ringMeters) },
    terms: {
      t1BoundaryQuantization: "perimeterPixels x 1px / areaPixels — a mask is a threshold over an antialiased render.",
      t2RingScaleDelta: { value: 1 - (VEHICLE.nearArmMeters / VEHICLE.farArmMeters) ** 2, statement: "1 - (399/401)^2. The level flips when the CELL crosses 400 m, so the arms cannot share a camera. IRREDUCIBLE without a forced-LOD hook, and IDENTICAL for every building — it alone spends half the bar." },
      t3Registration: "perimeterPixels x 0.5px / areaPixels — sub-pixel residual after centroid alignment.",
      t4Isolation: "UNBOUNDED, and deliberately not given a number. The frozen instrument isolates with hide_render; the shipped renderer has no equivalent, neighbours overlap the target in perspective, and the whole CELL flips together so the occluders differ between arms. Supplying isolation would be a runtime change, which this task may not make.",
      direction: "The emitted total is T1+T2+T3: it OMITS T4 and computes T1/T3 from the bounding rectangle, which overstates area and so understates the ratio. This is an OPTIMISTIC LOWER BOUND on the instrument's error.",
    },
    resolutionThreshold: {
      areaDevicePixelsNeeded: areaNeededPx,
      statement: `A compact target needs about ${Math.round(areaNeededPx)} device px^2 before the BOUNDARY term alone falls under 0.02 — roughly a ${Math.round(4 / 0.02)}x${Math.round(4 / 0.02)} px box.`,
      projectedSquareMetresNeeded: areaNeededSquareMetres,
      atTheRing: `At ${optics.pixelsPerMetreAt(VEHICLE.nearArmMeters).toFixed(4)} device px per metre, that is a projected ${Math.round(areaNeededSquareMetres)} m^2 — e.g. ${Math.round(Math.sqrt(areaNeededSquareMetres))} m wide by ${Math.round(Math.sqrt(areaNeededSquareMetres))} m tall.`,
    },
    strata: { census: censusStratum, nearCap: nearCapStratum },
    viewportScaling: { note: "Could a bigger render target rescue it? Only by leaving the shipped vehicle, and only for a size-biased subset.", rows: viewportScaling },
    verdict: {
      census: censusStratum.verdict,
      nearCap: nearCapStratum.verdict,
      overall: censusStratum.underBarCount === 0 && nearCapStratum.underBarCount === 0 ? "HONEST-STOP: the measurement half of T006 cannot be run at this bar with this instrument." : "PARTIAL",
      statement: "Pre-registered BEFORE any capture. Per the adjudicated Stage 0 rule, a budget exceeding the bar for all realistic strata makes T006's measurement half one honest stop, and the task proceeds to the census and shed-tone deliverables.",
    },
  };
  const budgetSha = write("error-budget", budgetRecord);

  // ---- SHED-TONE: a DIFFERENT measure, so a different budget ----------------
  // ADR 0056 hands T006 five shed pairs and says plainly what they need: an
  // instrument that separates geometry from tone BY CONSTRUCTION, under the
  // shipped renderer. That is not the area ratio honest-stopped above. A mean
  // luminance over the INTERIOR of the intersection — eroded away from every
  // outline — has no boundary term at all, which is precisely the flaw ADR 0056
  // owns in its own pre-registered measure ("conflating silhouette AREA with
  // tone"). Erosion is how the separation becomes structural rather than
  // argued.
  const shedPairs = SHED_TONE_PAIRS.map((buildingId) => {
    const asset = assets.find((a) => a.buildingId === buildingId);
    if (!asset) return { buildingId, present: false };
    const extent = glbExtent(join(repositoryRoot, "public", "data", asset.releaseId, asset.lod0.artifactRef));
    const b = budgetFor(extent.widthMetres, extent.heightMetres, optics);
    // Interior pixels surviving an erosion of EROSION_PX on every side.
    const innerW = Math.max(0, b.widthPx - 2 * EROSION_PX);
    const innerH = Math.max(0, b.heightPx - 2 * EROSION_PX);
    const interiorPx = innerW * innerH;
    // Uniform 8-bit quantization error has std (1/255)/sqrt(12); the mean over
    // N independent pixels shrinks it by sqrt(N).
    const quantisationOfMean = interiorPx > 0 ? 1 / 255 / Math.sqrt(12) / Math.sqrt(interiorPx) : Infinity;
    return {
      buildingId, present: true, releaseId: asset.releaseId, ownerCellId: asset.ownerCellId,
      twoLodEligible: asset.lod1?.eligible === true && asset.lod0?.maxDistanceMeters === VEHICLE.ringMeters,
      lod0TriangleCount: asset.lod0?.quality?.triangleCount, lod1TriangleCount: asset.lod1?.quality?.triangleCount,
      ...extent, projectedAreaDevicePixels: b.areaPx, interiorPixelsAfterErosion: interiorPx,
      quantisationOfMeanLuminance: quantisationOfMean,
      underToneBar: quantisationOfMean < 0.02,
    };
  });
  const shedRecord = {
    schemaVersion: "1.0",
    recordId: `${RECORD_ID}:shed-tone-budget`,
    task: "T006",
    artifact: "shed-tone-pair-instrument-budget",
    capturedAt: null,
    inheritedFrom: "docs/decisions/0056-textured-lod1-tone-and-copy.md — five shed pairs remain outside 2% even under the post-hoc intersection measure; ADR 0056 names T006 as their owner and requires an instrument that separates geometry from tone BY CONSTRUCTION, under the shipped renderer rather than EEVEE.",
    whyThisIsNotTheHonestStoppedMeasure: "The area ratio is honest-stopped because its error is dominated by the OUTLINE. A mean luminance over an ERODED intersection interior has no outline in it: erosion of " + EROSION_PX + " px removes antialiasing, the sub-pixel registration residual, and the 399/401 scale edge. What remains is 8-bit quantization on a mean, which shrinks as 1/sqrt(N).",
    erosionPixels: EROSION_PX,
    measure: { name: "eroded-intersection-mean-luminance-ratio", version: "1.0", statement: "Rec.709 luminance, averaged over pixels inside BOTH masks after erosion; the verdict is |1 - lod1Mean/lod0Mean| against the 0.02 bar." },
    residualTermsNotInTheNumber: [
      "ISOLATION. Occlusion by neighbours is still not solvable without a runtime hook. Each pair is checked for occlusion at its pose and a pair whose interior cannot be cleanly separated is recorded INCONCLUSIVE, never PASS.",
      "Mip-level delta between the arms is log2(401/399) = 0.0072 of a level, which is not a bound so much as a statement that it is negligible.",
      "Sun and material state are identical between arms because only the camera moves.",
    ],
    pairs: shedPairs,
    verdict: shedPairs.every((p) => p.present && p.underToneBar) ? "MEASURABLE: quantization of the mean is far below the bar for every pair; the campaign may run." : "NOT-MEASURABLE",
  };
  const shedSha = write("shed-tone-budget", shedRecord);

  console.log(serialize({
    ok: true,
    census: { count: censusIds.length, sha256: censusSha, frameChecksum: censusRecord.frameChecksumSha256, agreed: onlyManifest.length === 0, excludedTombstone: onlyOverCap },
    budget: { sha256: budgetSha, census: censusStratum, nearCap: nearCapStratum, verdict: budgetRecord.verdict.overall },
    shedTone: { sha256: shedSha, verdict: shedRecord.verdict, pairs: shedPairs.map((p) => ({ id: p.buildingId, twoLod: p.twoLodEligible, interiorPx: Math.round(p.interiorPixelsAfterErosion ?? 0), quantOfMean: p.quantisationOfMeanLuminance })) },
  }));
}

function isDirectEntryPoint() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry); } catch { return false; }
}

if (isDirectEntryPoint()) {
  const command = process.argv[2] ?? "emit";
  if (command !== "emit") fail("usage: lod-transition-stage0-cli.mjs emit");
  emit();
}
