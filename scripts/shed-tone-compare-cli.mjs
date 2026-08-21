/* global console, process, Buffer, TextDecoder */
/**
 * T006 STAGE 1 — the shed-tone comparison, as a deterministic CLI.
 *
 * THE PNG IS AN INPUT, NOT A VERDICT. A still cannot show that a ratio is
 * inside a bar, and a reviewer squinting at two screenshots is not a
 * measurement. This tool takes two checksummed captures and emits the verdict
 * as JSON, so the number can be re-derived from the same bytes by anyone.
 *
 * WHAT IT MEASURES, AND WHY IT IS NOT THE MEASURE T006 HONEST-STOPPED.
 * ADR 0056 owns the flaw in its own pre-registered shed measure: it conflated
 * silhouette AREA with tone. The area half of that conflation is what T006's
 * error budget stops — at the 400 m ring the outline is worth 6% to 35% of the
 * silhouette and the bar is 2%. This tool never touches the outline. It samples
 * the mean luminance of the INTERIOR, eroded `erosionPixels` away from every
 * boundary, over the INTERSECTION of the two arms' building masks. Erosion is
 * how "separates geometry from tone BY CONSTRUCTION" stops being an argument
 * and becomes a property of the instrument: with the boundary removed, neither
 * the antialiasing, nor the sub-pixel registration residual, nor the 399/401
 * scale edge can reach the number.
 *
 * WHAT IT CANNOT DO, STATED RATHER THAN HIDDEN. It cannot isolate the target
 * from a neighbour that stands in front of it. The frozen Blender instrument
 * isolates with `hide_render`; the shipped renderer offers no equivalent and
 * this task may not add one. So occlusion is DETECTED and disclosed rather than
 * corrected: a pair whose region of interest is not dominated by its target, or
 * whose two arms disagree about which pixels are building at all, is recorded
 * INCONCLUSIVE. It is never recorded PASS.
 *
 * Usage:
 *   node --experimental-strip-types scripts/shed-tone-compare-cli.mjs compare --plan <plan.json> [--out <results.json>]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = "shed-tone-compare";
const fail = (message) => { console.error(`${TOOL}: ${message}`); process.exit(1); };
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256Of = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** The bar T006 inherits, and the measure's own name. */
export const TONE_BAR = 0.02;
export const MEASURE = { name: "eroded-intersection-mean-luminance-ratio", version: "1.0" };

/**
 * A minimal PNG reader: 8-bit RGB or RGBA, non-interlaced.
 *
 * Written out rather than taken from a dependency because the verdict must be
 * re-derivable from committed bytes with the toolchain the repository already
 * has, and because a decoder that silently handles a format it was not given
 * would corrupt a measurement rather than refuse it.
 */
export function decodePng(bytes) {
  if (bytes.readUInt32BE(0) !== 0x89504e47) fail("not a PNG");
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = 0, interlace = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colourType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) fail(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) fail("interlaced PNG is not supported");
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (channels === 0) fail(`unsupported PNG colour type ${colourType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos]; pos += 1;
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = value & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** Rec.709 relative luminance on 0..1, from 8-bit sRGB values as displayed. */
export const luminance709 = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * BUILDING versus NOT-BUILDING inside the region of interest.
 *
 * The scene's non-building content at these poses is the dark navy backdrop and
 * the thin grid drawn on it. Both are far darker than any lit facade, so a
 * single committed luminance floor separates them, and the floor is recorded in
 * the result rather than tuned per pair. Anything at or above it is treated as
 * surface; anything below is treated as background and is excluded from BOTH
 * arms by intersection, so a pixel only counts when both arms agree it is
 * surface.
 */
export const BACKGROUND_LUMINANCE_CEILING = 0.10;

function maskOf(image, roi) {
  const { x0, y0, x1, y1 } = roi;
  const mask = new Uint8Array((x1 - x0) * (y1 - y0));
  let index = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1, index += 1) {
      const p = (y * image.width + x) * image.channels;
      mask[index] = luminance709(image.data[p], image.data[p + 1], image.data[p + 2]) > BACKGROUND_LUMINANCE_CEILING ? 1 : 0;
    }
  }
  return mask;
}

/** Remove every pixel within `radius` of a zero, so no boundary survives. */
export function erode(mask, width, height, radius) {
  let current = mask;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (current[i] === 0) continue;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
        if (current[i - 1] && current[i + 1] && current[i - width] && current[i + width]) next[i] = 1;
      }
    }
    current = next;
  }
  return current;
}

function meanLuminance(image, roi, keep) {
  const { x0, y0, x1, y1 } = roi;
  let sum = 0, count = 0, index = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1, index += 1) {
      if (!keep[index]) continue;
      const p = (y * image.width + x) * image.channels;
      sum += luminance709(image.data[p], image.data[p + 1], image.data[p + 2]);
      count += 1;
    }
  }
  return { mean: count > 0 ? sum / count : null, count };
}

export function comparePair(pair, root = repositoryRoot) {
  // `resolve`, not `join`: a plan may name an absolute path, and `join` would
  // silently prefix the repository root onto it and then fail to find it.
  const nearBytes = readFileSync(resolve(root, pair.nearArmPng));
  const farBytes = readFileSync(resolve(root, pair.farArmPng));
  const near = decodePng(nearBytes);
  const far = decodePng(farBytes);
  if (near.width !== far.width || near.height !== far.height) {
    return { buildingId: pair.buildingId, verdict: "INCONCLUSIVE", reason: "the two arms were captured at different canvas sizes, so no pixel correspondence exists" };
  }
  const roi = pair.roi;
  const w = roi.x1 - roi.x0, h = roi.y1 - roi.y0;
  const nearMask = maskOf(near, roi);
  const farMask = maskOf(far, roi);
  const intersection = new Uint8Array(nearMask.length);
  let nearOnly = 0, farOnly = 0, both = 0;
  for (let i = 0; i < nearMask.length; i += 1) {
    if (nearMask[i] && farMask[i]) { intersection[i] = 1; both += 1; }
    else if (nearMask[i]) nearOnly += 1;
    else if (farMask[i]) farOnly += 1;
  }
  const kept = erode(intersection, w, h, pair.erosionPixels ?? 3);
  const nearStats = meanLuminance(near, roi, kept);
  const farStats = meanLuminance(far, roi, kept);
  const result = {
    buildingId: pair.buildingId,
    ownerCellId: pair.ownerCellId,
    measure: MEASURE,
    inputs: {
      nearArmPng: pair.nearArmPng, nearArmSha256: sha256Of(nearBytes),
      farArmPng: pair.farArmPng, farArmSha256: sha256Of(farBytes),
      canvas: { width: near.width, height: near.height },
    },
    wireLevelControl: pair.wireLevelControl ?? null,
    roi,
    backgroundLuminanceCeiling: BACKGROUND_LUMINANCE_CEILING,
    erosionPixels: pair.erosionPixels ?? 3,
    pixels: { roi: w * h, surfaceInBothArms: both, surfaceInNearArmOnly: nearOnly, surfaceInFarArmOnly: farOnly, keptAfterErosion: nearStats.count },
    nearArmMeanLuminance: nearStats.mean,
    farArmMeanLuminance: farStats.mean,
  };
  // Pre-registered refusals, applied before any ratio is looked at.
  const wire = pair.wireLevelControl;
  if (wire && (wire.nearArmFetched !== "lod_0" || wire.farArmFetched !== "lod_1")) {
    return { ...result, verdict: "INCONCLUSIVE", reason: `the wire-level control disagrees with the expected ring side: near arm fetched ${wire.nearArmFetched}, far arm fetched ${wire.farArmFetched}` };
  }
  if (nearStats.count < 1000) {
    return { ...result, verdict: "INCONCLUSIVE", reason: `only ${nearStats.count} interior pixels survived erosion; the pre-registered budget assumed thousands, so the mean is not resolvable here` };
  }
  const disagreement = (nearOnly + farOnly) / Math.max(1, both);
  if (disagreement > 0.25) {
    return { ...result, verdict: "INCONCLUSIVE", reason: `the two arms disagree about ${(disagreement * 100).toFixed(1)}% of the region's surface pixels, which is the signature of occlusion or a mis-parked pose rather than a tone difference` };
  }
  const ratio = farStats.mean / nearStats.mean;
  const deviation = Math.abs(1 - ratio);
  return { ...result, surfaceDisagreementShare: disagreement, luminanceRatio: ratio, deviation, bar: TONE_BAR, verdict: deviation <= TONE_BAR ? "PASS" : "FAIL" };
}

function compare() {
  const planIndex = process.argv.indexOf("--plan");
  if (planIndex < 0) fail("usage: shed-tone-compare-cli.mjs compare --plan <plan.json> [--out <results.json>]");
  const planPath = process.argv[planIndex + 1];
  const plan = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(planPath)));
  const results = plan.pairs.map((pair) => comparePair(pair));
  const record = {
    schemaVersion: "1.0",
    recordId: "far-tier-lod-transition-20260821:shed-tone-results",
    task: "T006",
    artifact: "shed-tone-pair-results",
    capturedAt: null,
    capturedAtStatement: "NULL BY CONSTRUCTION.",
    measure: MEASURE,
    bar: TONE_BAR,
    barProvenance: "Carried from criterion 19 and from ADR 0056's own shed pre-registration. The INSTRUMENT is this tool, not the Blender pass; see the Stage 0 pre-registration.",
    planSha256: sha256Of(readFileSync(planPath)),
    pairs: results,
    summary: {
      pass: results.filter((r) => r.verdict === "PASS").length,
      fail: results.filter((r) => r.verdict === "FAIL").length,
      inconclusive: results.filter((r) => r.verdict === "INCONCLUSIVE").length,
      of: results.length,
    },
  };
  const outIndex = process.argv.indexOf("--out");
  const text = serialize(record);
  if (outIndex > 0) {
    writeFileSync(process.argv[outIndex + 1], text);
    writeFileSync(`${process.argv[outIndex + 1].replace(/\.json$/u, "")}.sha256`, `${sha256Of(Buffer.from(text))}  ${process.argv[outIndex + 1].split("/").pop()}\n`);
  }
  console.log(text);
}

function isDirectEntryPoint() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry); } catch { return false; }
}

if (isDirectEntryPoint()) {
  const command = process.argv[2] ?? "compare";
  if (command !== "compare") fail("usage: shed-tone-compare-cli.mjs compare --plan <plan.json>");
  compare();
}
