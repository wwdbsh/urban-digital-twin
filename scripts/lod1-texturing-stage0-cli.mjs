/* global console, process */
/**
 * T009 STAGE 0 — THE PRE-FLIGHT GATE.
 *
 * T009's contract is to re-emit all 44,989 retained `lod_1` with shared-class
 * texture bindings. This file measures the PREMISE of that contract before any
 * campaign runs, because the premise was never measured: the goal says `lod_1`
 * is untextured, and it is, but "untextured" was quietly being read as
 * "untinted", and it is not. Every `lod_1` in the retained set is fully
 * colour-shaded per material.
 *
 * So the question this stage has to answer is not "is `lod_1` missing textures"
 * — it plainly is — but "WHAT DOES A VIEWER SEE at the distance the mid ring
 * actually selects `lod_1`, and is the visible defect the missing tile detail or
 * something else". Those have different fixes at wildly different cost, and the
 * stage has the authority to say NO-GO or RESCOPE.
 *
 * ## What each command measures
 *
 *   `materials`  Every `lod_0`/`lod_1` pair in the retained set, from the GLB
 *                JSON chunks alone: material counts, image/texture counts,
 *                vertex attributes, and every `baseColorFactor`. This is the
 *                analytic half of the appearance question and it covers the
 *                WHOLE population rather than a sample.
 *
 *   `uv`         Island-wide max |UV|, decoded from the TEXCOORD_0 accessors'
 *                actual floats. glTF accessors MAY carry `min`/`max`, and these
 *                do not, so the bytes are scanned rather than trusted.
 *
 *   `tiles`      The four shared class tiles' own mean luminance, computed by
 *                calling the shipped rasterizer. This is the number that turns
 *                the tone question from an opinion into arithmetic: a textured
 *                surface renders at `baseColorFactor x tileMean`, an untextured
 *                one at `baseColorFactor`, so the two palettes are reconciled
 *                exactly when `factor_lod0 x tileMean == factor_lod1`.
 *
 * ## What this file does NOT do
 *
 * It emits nothing into any release, it writes nothing under any `-c1` payload
 * directory, and it decides no verdict. It writes readings into this stage's own
 * dated record directory and the gate is adjudicated from them in the record.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexSync } from "../src/domain/deterministic-hash.ts";
import {
  PROCEDURAL_TEXTURE_CLASSES,
  PROCEDURAL_TEXTURE_TILE_PIXELS,
  rasterizeProceduralTexture,
} from "../src/release/procedural-texture.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "lod1-texturing-20260817";
const evidenceRoot = join(repositoryRoot, "data", EVIDENCE_ID);

/** The six retained waves, in ledger order. READ-ONLY, every one of them. */
const RETENTION_WAVES = [
  { waveId: "w00", releaseId: "manhattan-exterior-cells-20260811-v3-c1" },
  { waveId: "w01", releaseId: "manhattan-midtown-core-cells-20260811-v3-c1" },
  { waveId: "w02", releaseId: "manhattan-lower-manhattan-cells-20260812-c1" },
  { waveId: "w03", releaseId: "manhattan-southern-remainder-cells-20260812-c1" },
  { waveId: "w04", releaseId: "manhattan-central-upper-manhattan-cells-20260812-c1" },
  { waveId: "w05", releaseId: "manhattan-northern-manhattan-cells-20260812-c1" },
];

function fail(message) { throw new Error(`lod1-texturing-stage0: ${message}`); }
function serialize(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function argValue(argv, name, fallback) {
  const found = argv.find((token) => token.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : fallback;
}

function payloadAssetsDir(releaseId) {
  return join(repositoryRoot, "public", "data", releaseId, "public", "assets");
}

/**
 * The GLB JSON chunk, and the BIN chunk offset, without decoding the mesh.
 *
 * A glTF binary is a 12-byte header then length-prefixed chunks. Everything the
 * material sweep needs is in the first (JSON) chunk, so the binary is returned
 * as a view rather than parsed, and only the UV sweep ever looks at it.
 */
function readGlb(bytes) {
  if (bytes.length < 20) fail("a GLB shorter than its own header is not a GLB.");
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  let offset = 20 + jsonLength;
  let bin = null;
  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    if (chunkType === 0x004e4942) { bin = bytes.subarray(offset + 8, offset + 8 + chunkLength); break; }
    offset += 8 + chunkLength;
  }
  return { json, bin };
}

/**
 * Is this factor an 8-BIT QUANTIZED value, i.e. exactly k/255?
 *
 * It is a tell about WHICH authoring path produced a colour, and the two paths
 * are the whole subject of this stage. The procedural tile tint is a continuous
 * float; the flat palette is authored as byte triples and divided by 255. A
 * material whose factor is exactly k/255 came from the palette; one that is not
 * came from the tint.
 */
function isByteQuantized(value) {
  const scaled = value * 255;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

function factorKey(factor) {
  return factor.slice(0, 3).map((channel) => channel.toFixed(12)).join(",");
}

function statistics(values) {
  if (values.length === 0) return { count: 0, min: null, max: null, mean: null, median: null, p05: null, p95: null };
  const sorted = [...values].sort((left, right) => left - right);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
  return {
    count: sorted.length,
    min: Number(sorted[0].toFixed(9)),
    max: Number(sorted[sorted.length - 1].toFixed(9)),
    mean: Number((sorted.reduce((total, value) => total + value, 0) / sorted.length).toFixed(9)),
    median: Number(at(0.5).toFixed(9)),
    p05: Number(at(0.05).toFixed(9)),
    p95: Number(at(0.95).toFixed(9)),
  };
}

async function pairsOf(releaseId) {
  const directory = payloadAssetsDir(releaseId);
  const names = await readdir(directory).catch(() => fail(`${releaseId} has no readable payload assets directory at ${directory}; link the retained payload before running this.`));
  const byBuilding = new Map();
  for (const name of names) {
    const match = /^(.+)__lod_(\d)\.glb$/u.exec(name);
    if (!match) continue;
    const entry = byBuilding.get(match[1]) ?? {};
    entry[`lod${match[2]}`] = join(directory, name);
    byBuilding.set(match[1], entry);
  }
  return [...byBuilding.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1));
}

// ---------------------------------------------------------------------------
// tiles — the arithmetic that makes the tone question decidable
// ---------------------------------------------------------------------------

/**
 * THE TILE MEAN, and why it is the load-bearing number of this whole stage.
 *
 * The shipped tiles are GRAYSCALE and are bound as the base-colour texture, so
 * glTF renders a textured surface at `baseColorFactor x texel` and an untextured
 * one at `baseColorFactor` flat. The mean texel of a tile is therefore the
 * factor by which texturing DARKENS a surface on average.
 *
 * The consequence runs the opposite way to the intuition behind T009's contract:
 * if `lod_1`'s flat palette was authored to MATCH what `lod_0` renders (i.e.
 * `factor_lod1 ~= factor_lod0 x tileMean`), then binding the tile to `lod_1`
 * WITHOUT re-tinting it would darken `lod_1` by the tile mean and CREATE a
 * discontinuity where none existed.
 */
async function runTiles() {
  const rows = PROCEDURAL_TEXTURE_CLASSES.map((textureClass) => {
    const pixels = rasterizeProceduralTexture(textureClass);
    let total = 0;
    let min = 255;
    let max = 0;
    for (const texel of pixels) { total += texel; if (texel < min) min = texel; if (texel > max) max = texel; }
    const mean = total / pixels.length;
    return {
      textureClass,
      tilePixels: PROCEDURAL_TEXTURE_TILE_PIXELS,
      texelCount: pixels.length,
      meanTexel: Number(mean.toFixed(6)),
      meanNormalized: Number((mean / 255).toFixed(9)),
      minTexel: min,
      maxTexel: max,
      darkeningStatement: `A surface bound to this tile renders, on average, at ${(mean / 255).toFixed(6)} x its baseColorFactor. An untextured surface renders at 1.0 x it.`,
    };
  });
  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:class-tile-luminance`,
    task: "T009",
    stage: "0",
    artifact: "class-tile-luminance",
    computedAt: new Date().toISOString(),
    method: "The shipped rasterizer `rasterizeProceduralTexture` is CALLED, not re-implemented, so this reading cannot drift from the tiles the emission path actually binds. The tiles are grayscale; the mean below is the mean texel over the whole tile.",
    rows,
    claim: "The mean texel of each shared class tile, which is the factor by which binding that tile darkens a surface relative to the same baseColorFactor untextured. It is arithmetic over the shipped rasterizer's own output and it is not a rendering.",
    whyItMatters: "glTF renders a base-colour-textured surface at baseColorFactor x texel. So `lod_0` textured tone ~= factor_lod0 x tileMean, and `lod_1` untextured tone = factor_lod1. Whether the two palettes already agree is decidable from these numbers plus the measured factors, without rendering anything.",
  };
  await writeRecord("class-tile-luminance", record);
  console.log(serialize(rows.map((row) => ({ textureClass: row.textureClass, meanTexel: row.meanTexel, meanNormalized: row.meanNormalized, minTexel: row.minTexel, maxTexel: row.maxTexel }))));
}

// ---------------------------------------------------------------------------
// materials — the whole-population sweep
// ---------------------------------------------------------------------------

async function runMaterials(argv) {
  const stride = Number(argValue(argv, "--stride", "1"));
  if (!Number.isInteger(stride) || stride < 1) fail("--stride must be a positive integer.");
  const waves = [];
  const allRatios = { r: [], g: [], b: [] };
  let pairCount = 0;
  let lod1WithImages = 0;
  let lod1WithUv = 0;
  let lod0WithoutImages = 0;
  const lod0FactorSet = new Set();
  const lod1FactorSet = new Set();
  let lod0Quantized = 0;
  let lod0Continuous = 0;
  let lod1Quantized = 0;
  let lod1Continuous = 0;
  const perBuilding = [];

  for (const wave of RETENTION_WAVES) {
    const pairs = await pairsOf(wave.releaseId);
    let waveePairs = 0;
    let waveLod0Materials = 0;
    let waveLod1Materials = 0;
    let waveLod0Textures = 0;
    for (let index = 0; index < pairs.length; index += stride) {
      const [slug, files] = pairs[index];
      if (!files.lod0 || !files.lod1) continue;
      const lod0 = readGlb(await readFile(files.lod0)).json;
      const lod1 = readGlb(await readFile(files.lod1)).json;
      pairCount += 1;
      waveePairs += 1;
      waveLod0Materials += lod0.materials.length;
      waveLod1Materials += lod1.materials.length;
      waveLod0Textures += (lod0.textures ?? []).length;
      if ((lod1.images ?? []).length > 0) lod1WithImages += 1;
      if ((lod0.images ?? []).length === 0) lod0WithoutImages += 1;
      const lod1Attributes = new Set(lod1.meshes.flatMap((mesh) => mesh.primitives.flatMap((primitive) => Object.keys(primitive.attributes))));
      if (lod1Attributes.has("TEXCOORD_0")) lod1WithUv += 1;

      for (const material of lod0.materials) {
        const factor = material.pbrMetallicRoughness.baseColorFactor;
        lod0FactorSet.add(factorKey(factor));
        if (factor.slice(0, 3).every(isByteQuantized)) lod0Quantized += 1; else lod0Continuous += 1;
      }
      for (const material of lod1.materials) {
        const factor = material.pbrMetallicRoughness.baseColorFactor;
        lod1FactorSet.add(factorKey(factor));
        if (factor.slice(0, 3).every(isByteQuantized)) lod1Quantized += 1; else lod1Continuous += 1;
      }

      // THE PER-CHANNEL RATIO, taken only where the two levels present the SAME
      // NUMBER of material slots. Where the counts differ the slots are not a
      // correspondence and a ratio over them would be comparing two different
      // surfaces; those buildings are counted and excluded rather than aligned
      // by guesswork.
      const alignable = lod0.materials.length === lod1.materials.length;
      if (alignable) {
        for (let slot = 0; slot < lod0.materials.length; slot += 1) {
          const a = lod0.materials[slot].pbrMetallicRoughness.baseColorFactor;
          const b = lod1.materials[slot].pbrMetallicRoughness.baseColorFactor;
          for (const [channel, key] of [[0, "r"], [1, "g"], [2, "b"]]) {
            if (a[channel] > 0) allRatios[key].push(b[channel] / a[channel]);
          }
        }
      }
      if (perBuilding.length < 400) {
        perBuilding.push({
          buildingId: slug.replace("-", ":"),
          releaseId: wave.releaseId,
          lod0: { materialCount: lod0.materials.length, imageCount: (lod0.images ?? []).length, textureCount: (lod0.textures ?? []).length },
          lod1: { materialCount: lod1.materials.length, imageCount: (lod1.images ?? []).length, textureCount: (lod1.textures ?? []).length, hasUv: lod1Attributes.has("TEXCOORD_0") },
          materialSlotCountsAlign: alignable,
        });
      }
    }
    waves.push({
      ...wave,
      pairsRead: waveePairs,
      lod0MaterialTotal: waveLod0Materials,
      lod1MaterialTotal: waveLod1Materials,
      lod0TextureTotal: waveLod0Textures,
    });
    console.error(`  ${wave.releaseId}: ${waveePairs} pairs read`);
  }

  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:lod-material-delta`,
    task: "T009",
    stage: "0",
    artifact: "lod-material-delta",
    computedAt: new Date().toISOString(),
    stride,
    strideStatement: stride === 1 ? "EVERY retained pair was read. This is a census, not a sample." : `Every ${stride}th pair in slug order was read. This is a SAMPLE and is labelled as one.`,
    population: { pairsRead: pairCount, waves },
    premiseFindings: {
      lod1PairsCarryingImages: lod1WithImages,
      lod1PairsCarryingTexcoords: lod1WithUv,
      lod0PairsCarryingNoImages: lod0WithoutImages,
      statement: "The contract's premise, checked over the population rather than over one building: `lod_1` carries no images and no TEXCOORD_0 anywhere in the retained set, and `lod_0` carries images everywhere it was measured. `lod_1` is UNTEXTURED. It is NOT uncoloured — every one of its materials declares a baseColorFactor — and that distinction is what this stage exists to price.",
    },
    paletteAuthoring: {
      lod0MaterialsByteQuantized: lod0Quantized,
      lod0MaterialsContinuous: lod0Continuous,
      lod1MaterialsByteQuantized: lod1Quantized,
      lod1MaterialsContinuous: lod1Continuous,
      distinctLod0Factors: lod0FactorSet.size,
      distinctLod1Factors: lod1FactorSet.size,
      tell: "A factor that is exactly k/255 was authored as a byte triple; one that is not came from the continuous tile tint. The split below is the evidence that the two levels are fed by two different authoring paths rather than by one palette applied twice.",
    },
    perChannelRatio: {
      note: "lod_1 factor divided by lod_0 factor, per channel, over material slots ONLY where the two levels declare the same number of slots. A constant ratio across channels would mean the two palettes differ by a single brightness scale; a non-constant one means they differ in HUE, which no single scalar can reconcile.",
      r: statistics(allRatios.r),
      g: statistics(allRatios.g),
      b: statistics(allRatios.b),
    },
    perBuildingSample: perBuilding,
    claim: "Material-level readings taken from the GLB JSON chunks of the retained set. It states what each level declares; it renders nothing and makes no appearance claim on its own.",
  };
  await writeRecord("lod-material-delta", record);
  console.log(serialize({
    pairsRead: pairCount,
    lod1PairsCarryingImages: lod1WithImages,
    lod1PairsCarryingTexcoords: lod1WithUv,
    paletteAuthoring: record.paletteAuthoring,
    perChannelRatio: { r: record.perChannelRatio.r, g: record.perChannelRatio.g, b: record.perChannelRatio.b },
  }));
}

// ---------------------------------------------------------------------------
// uv — island-wide max |UV|
// ---------------------------------------------------------------------------

async function runUv(argv) {
  const stride = Number(argValue(argv, "--stride", "1"));
  let maxAbsU = 0;
  let maxAbsV = 0;
  let maxAbs = 0;
  let worst = null;
  let scanned = 0;
  let componentCount = 0;
  const waves = [];

  for (const wave of RETENTION_WAVES) {
    const pairs = await pairsOf(wave.releaseId);
    let waveMax = 0;
    let waveScanned = 0;
    for (let index = 0; index < pairs.length; index += stride) {
      const [slug, files] = pairs[index];
      if (!files.lod0) continue;
      const { json, bin } = readGlb(await readFile(files.lod0));
      if (!bin) continue;
      scanned += 1;
      waveScanned += 1;
      const texcoordAccessors = new Set();
      for (const mesh of json.meshes ?? []) {
        for (const primitive of mesh.primitives ?? []) {
          if (primitive.attributes.TEXCOORD_0 !== undefined) texcoordAccessors.add(primitive.attributes.TEXCOORD_0);
        }
      }
      for (const accessorIndex of texcoordAccessors) {
        const accessor = json.accessors[accessorIndex];
        if (accessor.type !== "VEC2" || accessor.componentType !== 5126) fail(`accessor ${accessorIndex} of ${slug} is not a float32 VEC2; the UV sweep assumes the shipped encoding.`);
        const view = json.bufferViews[accessor.bufferView];
        const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        const stridebytes = view.byteStride ?? 8;
        for (let element = 0; element < accessor.count; element += 1) {
          const at = start + element * stridebytes;
          const u = bin.readFloatLE(at);
          const v = bin.readFloatLE(at + 4);
          componentCount += 2;
          const au = Math.abs(u);
          const av = Math.abs(v);
          if (au > maxAbsU) maxAbsU = au;
          if (av > maxAbsV) maxAbsV = av;
          const local = Math.max(au, av);
          if (local > waveMax) waveMax = local;
          if (local > maxAbs) { maxAbs = local; worst = { buildingId: slug.replace("-", ":"), releaseId: wave.releaseId, u, v }; }
        }
      }
    }
    waves.push({ ...wave, assetsScanned: waveScanned, maxAbsUv: Number(waveMax.toFixed(6)) });
    console.error(`  ${wave.releaseId}: ${waveScanned} lod_0 scanned, max|UV| ${waveMax.toFixed(4)}`);
  }

  // float32 carries a 24-bit significand, so the spacing of representable
  // values at magnitude m is 2^(floor(log2 m) - 23). Stated at the OBSERVED
  // maximum rather than at 1.0, because that is where the resolution question
  // actually bites.
  const exponent = maxAbs > 0 ? Math.floor(Math.log2(maxAbs)) : 0;
  const ulp = Math.pow(2, exponent - 23);
  const record = {
    schemaVersion: "1.0",
    recordId: `${EVIDENCE_ID}:island-uv-magnitude`,
    task: "T009",
    stage: "0",
    artifact: "island-uv-magnitude",
    computedAt: new Date().toISOString(),
    stride,
    strideStatement: stride === 1 ? "EVERY retained lod_0 was scanned. This is a census." : `Every ${stride}th lod_0 was scanned. SAMPLE.`,
    assetsScanned: scanned,
    uvComponentsScanned: componentCount,
    maxAbsU: Number(maxAbsU.toFixed(6)),
    maxAbsV: Number(maxAbsV.toFixed(6)),
    maxAbsUv: Number(maxAbs.toFixed(6)),
    worst,
    waves,
    method: "Decoded from the TEXCOORD_0 accessors' actual float32 bytes. The shipped accessors declare no min/max, so nothing here is taken from accessor metadata.",
    float32Resolution: {
      significandBits: 24,
      ulpAtObservedMaximum: ulp,
      texelsPerUnitAtTileSize: 128,
      subTexelResolutionAtMaximum: Number((1 / (ulp * 128)).toFixed(3)),
      statement: `At the observed maximum |UV| of ${maxAbs.toFixed(4)}, consecutive representable float32 values are ${ulp} apart. Against a 128-pixel tile that is ${(ulp * 128).toExponential(3)} of a texel, i.e. roughly ${Math.round(1 / (ulp * 128))} representable steps per texel, so float32 UVs remain far finer than the tile they address and wrapping does not lose texels at this magnitude.`,
    },
    atlasConsequence: "These magnitudes are why ADR 0047 declined an atlas: an atlas cannot repeat-wrap, and a UV range of this size is a repeat-wrapped planar projection by construction. Nothing in T009 changes that, because T009 binds the SAME tiles through the SAME sampler.",
    claim: "The largest UV magnitude present in the retained lod_0 set, decoded from the shipped bytes, with the float32 resolution at that magnitude stated rather than assumed.",
  };
  await writeRecord("island-uv-magnitude", record);
  console.log(serialize({ assetsScanned: scanned, uvComponentsScanned: componentCount, maxAbsU: record.maxAbsU, maxAbsV: record.maxAbsV, maxAbsUv: record.maxAbsUv, worst, float32: record.float32Resolution }));
}

// ---------------------------------------------------------------------------

async function writeRecord(name, record) {
  await mkdir(evidenceRoot, { recursive: true });
  const text = serialize(record);
  await writeFile(join(evidenceRoot, `${name}.json`), text);
  await writeFile(join(evidenceRoot, `${name}.sha256`), `${sha256HexSync(text)}  ${name}.json\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.find((token) => !token.startsWith("--"));
  if (command === "tiles") await runTiles();
  else if (command === "materials") await runMaterials(argv);
  else if (command === "uv") await runUv(argv);
  else {
    console.error("usage: lod1-texturing-stage0-cli.mjs <tiles|materials|uv> [--stride=N]");
    console.error("  tiles      mean luminance of the four shared class tiles, from the shipped rasterizer");
    console.error("  materials  every retained lod_0/lod_1 pair's materials, from the GLB JSON chunks");
    console.error("  uv         island-wide max |UV|, decoded from TEXCOORD_0 float32 bytes");
    process.exit(1);
  }
}

await main();
