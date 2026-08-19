/* global console, process */
/**
 * Shared plumbing for the v4 adoption cycle and the mass campaign.
 *
 * Everything here is the part that would otherwise be copied: how a ledger cell
 * becomes a `FarTierCellInput`, and how a baked cell becomes the two files the
 * runtime expects. Both callers use these so that the cycle which ADOPTED v4
 * and the campaign which SHIPS it cannot drift apart.
 */

import { sha256HexBytes } from "../src/domain/deterministic-hash.ts";
import { FAR_TIER_BAKE_RECIPE } from "../src/release/far-tier-bake.ts";
import { farTierBudgetContractHash } from "../src/release/far-tier-budget.ts";
import { buildMidtownCoreV3Plan } from "../src/release/midtown-core-v3-materialization.ts";
import { encodeRgbPng } from "../src/release/procedural-texture.ts";
import { writeCanonicalGlb } from "../src/release/canonical-glb.ts";

/**
 * The runtime's expected names. FLAT layout, one directory, two files per cell.
 * `far-tier-hlod-runtime-20260818` reads exactly these.
 */
export const tileGlbName = (cellId) => `${cellId}.far_0.glb`;
export const tileAtlasName = (cellId) => `${cellId}.atlas.png`;

/**
 * Turn one ledger cell into the input `bakeFarTierCell` takes.
 *
 * A building the snapshot does not carry and a building the grammar refuses are
 * BOTH refusals here, with distinguishable reasons, because a campaign that
 * reports "48 of 50 included" must be able to say which kind each was.
 */
export function cellInputFor(context, cell) {
  const origin = [cell.bounds.west, cell.bounds.south];
  return {
    cellId: cell.cellId,
    buildingIds: [...cell.buildingIds],
    planFor(buildingId) {
      const source = context.sources.get(buildingId);
      if (!source) return { refusal: "no source record in the pinned base snapshot" };
      let plan;
      try {
        plan = buildMidtownCoreV3Plan(source, context.planChecksumSha256, context.profile).plan;
      } catch (error) {
        return { refusal: `refused by the V3 grammar: ${error?.code ?? error?.message ?? "unknown stop"}` };
      }
      return {
        plan,
        offsetMeters: [
          (source.representative[0] - origin[0]) * FAR_TIER_BAKE_RECIPE.metersPerDegreeLongitude,
          (source.representative[1] - origin[1]) * FAR_TIER_BAKE_RECIPE.metersPerDegreeLatitude,
        ],
      };
    },
  };
}

export const FAR_TIER_RIGHTS = {
  derivation: "Derivative of the generated procedural facade tiles and the sourced OTI building footprints and heights.",
  envelope: "The NARROWER of the inherited envelopes travels with this artifact. Retention and local display only. No publication, no redistribution, no public conveyance.",
  attribution: "Source: NYC Office of Technology and Innovation GIS, Building Footprints; accessed through NYC Open Data.",
  note: "Baking does not widen an approval envelope. A derivative of a retention-only artifact is retention-only.",
};

export const FAR_TIER_UNCERTAINTY_V4 =
  "Far-tier HLOD massing, recipe v4. The sourced footprint extruded to the sourced height, carrying a facade appearance baked from the generated procedural tiles, with each wall zone's colour set to the AREA-WEIGHTED LINEAR-LIGHT AGGREGATE of the vertical facade, glazing and trim surfaces that wall stands in for. Setback steps, tier insets, rooftop groups and window openings are ABSENT BY CONSTRUCTION and are filled in solid; `material:metal` is EXCLUDED from the aggregate as a geometric omission rather than an absorbed material. No lighting, ambient occlusion or shadowing is baked in. This asserts nothing about the material, colour, age, condition or cladding of any real building, and its silhouette is a coarser claim than ADR 0050's 2% standard covers.";

/** Emit the two files for one baked cell, and their digests. */
export function emitTileBytes(context, cell, bake, { recipeId, recipeSha256, capture }) {
  const atlasPng = encodeRgbPng(bake.packing.atlasPixels, bake.packing.atlasPixels, bake.rgb);
  const tile = writeCanonicalGlb({
    quads: bake.geometry.quads,
    triangles: bake.geometry.triangles,
    materials: [{ baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }],
    metadata: {
      canonicalFeatureId: cell.cellId,
      lodId: "far_0",
      ownerCellId: cell.cellId,
      tierId: recipeId,
      recipeSha256,
      budgetContractSha256: farTierBudgetContractHash(),
      sourceReleaseId: context.c2ReleaseId,
      sourceInventoryChecksumSha256: context.inventoryChecksumSha256,
      parentLedgerChecksumSha256: context.ledgerChecksumSha256,
      membershipChecksumSha256: cell.membershipChecksumSha256,
      memberBuildingIds: bake.members.filter((member) => member.included).map((member) => member.buildingId),
      atlasPixels: bake.packing.atlasPixels,
      appliedResolutionScale: bake.packing.appliedScale,
      sourceDates: { capturedAt: capture.capturedAt, updatedAt: capture.updatedAt },
      rights: FAR_TIER_RIGHTS,
      uncertainty: FAR_TIER_UNCERTAINTY_V4,
    },
    uriTextures: {
      images: [{ mimeType: "image/png", uri: tileAtlasName(cell.cellId) }],
      materialImage: [0],
      filter: { magFilter: FAR_TIER_BAKE_RECIPE.samplerMagFilter, minFilter: FAR_TIER_BAKE_RECIPE.samplerMinFilter },
    },
  });
  return {
    glbBytes: tile.bytes,
    atlasBytes: atlasPng,
    glbSha256: sha256HexBytes(tile.bytes),
    glbByteSize: tile.bytes.byteLength,
    atlasSha256: sha256HexBytes(atlasPng),
    atlasByteSize: atlasPng.byteLength,
  };
}

/**
 * The inventory row the runtime consumes, in `FarTierInventoryEntry`'s exact
 * shape.
 *
 * `members` CARRIES THE REFUSED BUILDINGS TOO. It is
 * `{ buildingId, included }[]`, not a list of included ids: T007's refusal
 * transparency depends on a refused building keeping its massing and keeping an
 * explanation, and the runtime reads `included: false` to do that. An earlier
 * draft of this function filtered them out and flattened the rest to strings,
 * which would have type-checked nowhere and silently erased every refusal from
 * the shipped inventory.
 */
export function inventoryEntry(cell, bake, emitted) {
  return {
    cellId: cell.cellId,
    glbSha256: emitted.glbSha256,
    glbByteSize: emitted.glbByteSize,
    atlasSha256: emitted.atlasSha256,
    atlasByteSize: emitted.atlasByteSize,
    members: bake.members.map((member) => ({ buildingId: member.buildingId, included: member.included })),
  };
}

export const fail = (tool, message) => { console.error(`${tool}: ${message}`); process.exit(1); };
