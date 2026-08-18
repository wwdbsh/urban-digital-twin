/* global console, process */
/**
 * T010 Stage B, step 1: emit the roof/wall LUMINANCE DECOMPOSITION subjects.
 *
 * WHY THIS EXISTS. The far tier's one failing pose is the shadow side, and the
 * candidate fix is a baked darkening term. Whether that term can be facade-only
 * depends on how much of the tile's screen luminance the WALLS carry at each
 * pose — a fact nobody has measured. Darkening walls enough to move a pose the
 * walls barely contribute to would require a scalar that destroys the lit pose.
 *
 * THE PRE-REGISTERED FEASIBILITY THRESHOLD, derived from the committed T002
 * readings before any of this was rendered:
 *
 *   shadow pose must fall from r = 1.072801 to <= 1.05, i.e. by 0.000899 in
 *     absolute mean linear luminance;
 *   lit pose may not fall below r = 0.95, i.e. by at most 0.013226;
 *   a wall-only scalar t moves them by W_sh*(1-t) and W_lit*(1-t),
 *   so it is feasible iff W_sh / W_lit >= 0.000899 / 0.013226 = 0.06797.
 *
 * HOW THE DECOMPOSITION IS TAKEN. Not by rendering walls alone — that would
 * show walls a roof occludes and overstate them. Instead the FULL geometry is
 * rendered every time, with one class's colour forced to black:
 *
 *   L(roof-black)  = wall contribution, with roofs still occluding correctly
 *   L(wall-black)  = roof contribution, likewise
 *   L(full)        = both, and W + R = L(full) is the arithmetic sanity check
 *
 * There is no environment light and no bounce, so the contributions are
 * additive and that check is meaningful rather than decorative.
 *
 * THIS IS DISCLOSED INSTRUMENTATION, NOT THE AGREEMENT CAPTURE. It renders
 * variant subjects that are not the shipped artifact, to measure a property of
 * it. The agreement instrument is untouched.
 *
 * Usage: node --experimental-strip-types scripts/far-tier-v2-decompose-cli.mjs emit [--cell <id>]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256HexBytes } from "../src/domain/deterministic-hash.ts";
import { writeCanonicalGlb } from "../src/release/canonical-glb.ts";
import { FAR_TIER_BAKE_RECIPE, farTierGeometry } from "../src/release/far-tier-bake.ts";
import { CAPTURE, DEFAULT_CELL_ID, bakeCell, materializeCell } from "./far-tier-bake-cli.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ID = "far-tier-hlod-v2-20260818";
const workRoot = join(repositoryRoot, "artifacts", EVIDENCE_ID);

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message) => { console.error(`far-tier-v2-decompose: ${message}`); process.exit(1); };

/**
 * A TRULY black occluder, which needs `metallicFactor: 1`.
 *
 * A black DIELECTRIC is not black: glTF's metallic-roughness model gives every
 * dielectric a fixed ~4% specular reflectance, so a base colour of zero still
 * returns a neutral specular lobe. Measured here at 0.016708 over 3,131 pixels
 * before the fix, which corrupted the shadow-pose split by more than the whole
 * quantity being measured. A conductor's F0 IS its base colour, so black metal
 * reflects nothing and occludes without contributing.
 */
const BLACK = { baseColorFactor: [0, 0, 0, 1], metallicFactor: 1, roughnessFactor: 1 };
const LIT = { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 };

/**
 * Emit one decomposition variant.
 *
 * Geometry is IDENTICAL to the shipped tile in every variant — same quads, same
 * triangles, same uvs, same order — so occlusion is preserved exactly and the
 * only difference is which material a face points at.
 */
function writeVariant(cellId, geometry, atlasRelativeRef, variant) {
  const wallMaterial = variant === "wall-black" ? 0 : 1;
  const roofMaterial = variant === "roof-black" ? 0 : 1;
  return writeCanonicalGlb({
    quads: geometry.quads.map((quad) => ({ ...quad, materialIndex: wallMaterial })),
    triangles: geometry.triangles.map((triangle) => ({ ...triangle, materialIndex: roofMaterial })),
    // Slot 0 is black, slot 1 is the lit textured material. Only slot 1 samples
    // the atlas, so a blacked-out class contributes exactly zero light.
    materials: [BLACK, LIT],
    metadata: {
      canonicalFeatureId: cellId,
      lodId: "far_0",
      variant,
      instrumentation: "DECOMPOSITION SUBJECT, NOT A SHIPPABLE ARTIFACT. One surface class is forced to black so the other's screen luminance can be measured with occlusion intact. It asserts nothing about any real building and must never be served.",
      sourceDates: { capturedAt: CAPTURE.capturedAt, updatedAt: CAPTURE.updatedAt },
    },
    uriTextures: {
      images: [{ mimeType: "image/png", uri: atlasRelativeRef }],
      // Only the lit material samples the atlas; the black one carries no image.
      materialImage: [null, 0],
      filter: { magFilter: FAR_TIER_BAKE_RECIPE.samplerMagFilter, minFilter: FAR_TIER_BAKE_RECIPE.samplerMinFilter },
    },
  });
}

async function commandEmit(cellId) {
  const context = await materializeCell(cellId);
  const baked = bakeCell(context);
  const geometry = farTierGeometry(baked.packing);
  const atlasRelativeRef = `${cellId}.atlas.png`;

  await mkdir(workRoot, { recursive: true });
  await writeFile(join(workRoot, atlasRelativeRef), baked.atlasPng);

  const emitted = [];
  for (const variant of ["roof-black", "wall-black"]) {
    const written = writeVariant(cellId, geometry, atlasRelativeRef, variant);
    const name = `${cellId}.${variant}.glb`;
    await writeFile(join(workRoot, name), written.bytes);
    emitted.push({ variant, name, sha256: sha256HexBytes(written.bytes), triangles: written.counts.triangleCount });
  }

  // The unmodified tile, so L(full) is measured from the same emission run
  // rather than assumed equal to a previously written file.
  const full = writeCanonicalGlb({
    quads: geometry.quads,
    triangles: geometry.triangles,
    materials: [LIT],
    metadata: { canonicalFeatureId: cellId, lodId: "far_0", variant: "full", instrumentation: "Decomposition control." },
    uriTextures: {
      images: [{ mimeType: "image/png", uri: atlasRelativeRef }],
      materialImage: [0],
      filter: { magFilter: FAR_TIER_BAKE_RECIPE.samplerMagFilter, minFilter: FAR_TIER_BAKE_RECIPE.samplerMinFilter },
    },
  });
  await writeFile(join(workRoot, `${cellId}.full.glb`), full.bytes);
  emitted.push({ variant: "full", name: `${cellId}.full.glb`, sha256: sha256HexBytes(full.bytes), triangles: full.counts.triangleCount });

  if (new Set(emitted.map((entry) => entry.triangles)).size !== 1) {
    fail("decomposition variants do not share a triangle count; occlusion would differ and the split would be meaningless.");
  }

  console.log(serialize({ ok: true, cellId, root: workRoot, atlasSha256: sha256HexBytes(baked.atlasPng), emitted }));
}

const command = process.argv[2];
const cellIndex = process.argv.indexOf("--cell");
const cellId = cellIndex > 0 ? process.argv[cellIndex + 1] : DEFAULT_CELL_ID;
if (command === "emit") await commandEmit(cellId);
else fail("usage: far-tier-v2-decompose-cli.mjs emit [--cell <cellId>]");
