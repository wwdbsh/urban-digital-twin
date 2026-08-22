/* global process, console */
/**
 * WHAT IS ACTUALLY DRAWN IN A REGION — the control T006 learned the hard way.
 *
 * T006's shed-tone campaign scored a 0.008% "PASS" on a pair whose region was
 * 100% procedural massing in BOTH arms: massing compared against massing, read
 * as a perfect tone match. The wire-level control had said the target's coarse
 * GLB was fetched, and it was — but FETCH IS NOT DRAW. Nothing in that campaign
 * could tell the difference, so a false pass sailed through until the region's
 * composition was finally looked at.
 *
 * This module is that check, committed as an instrument instead of improvised
 * at the end of a campaign. Any appearance or identity claim in T007 has to pass
 * it: a reading whose region is procedural massing is not a reading about wave
 * or far-tier geometry, whatever the network log says.
 *
 * HOW IT SEPARATES THE TIERS. The dense massing fallback is drawn in exactly one
 * colour — `DENSE_MASSING_CSS_COLOR` = #d7a85d at `DENSE_MASSING_BASE_ALPHA` =
 * 0.82 — which over the app's dark backdrop lands near (208,170,105). Its
 * signature is a large green-to-blue gap: for #d7a85d, G−B = 75. Facade and
 * far-tier surfaces are near-neutral or cool by comparison; terracotta roof
 * tones are warm but their G−B is around 18. So G−B is the discriminator, and it
 * is committed here as a named constant rather than tuned per capture.
 *
 * WHAT IT IS NOT. It is not a claim about which tier drew the non-massing
 * pixels: far-tier baked geometry and exterior-wave GLB both read as "not
 * massing" here. Telling THOSE two apart needs the far-tier DOM state, which is
 * what the capture harness records alongside every still.
 */

import { readFileSync } from "node:fs";
import { decodePng, luminance709 } from "./shed-tone-compare-cli.mjs";

/** #d7a85d at 0.82 over the app's backdrop. */
export const MASSING_SIGNATURE = {
  cssColor: "#d7a85d",
  baseAlpha: 0.82,
  approximateRenderedRgb: [208, 170, 105],
  minRed: 110,
  minRedMinusGreen: 22,
  /** The discriminator: massing ~75, terracotta roof ~18, neutral facade ~0. */
  minGreenMinusBlue: 45,
  maxBlue: 170,
};

/** True when one pixel carries the procedural massing signature. */
export function isProceduralMassing(r, g, b, signature = MASSING_SIGNATURE) {
  return r > signature.minRed
    && r - g > signature.minRedMinusGreen
    && g - b > signature.minGreenMinusBlue
    && b < signature.maxBlue;
}

/** The app's dark backdrop and its grid sit below this; any surface sits above. */
export const BACKDROP_LUMINANCE_CEILING = 0.10;

/**
 * Composition of a region: how much of it is massing, surface, and backdrop.
 *
 * `roi` is in the coordinate space of the IMAGE. If a caller holds canvas-space
 * coordinates it must add the canvas origin first — the defect that invalidated
 * T006's first campaign was exactly that omission, so this function takes image
 * coordinates only and says so.
 */
export function drawCompositionOf(image, roi) {
  const x0 = Math.max(0, roi.x0);
  const y0 = Math.max(0, roi.y0);
  const x1 = Math.min(image.width, roi.x1);
  const y1 = Math.min(image.height, roi.y1);
  if (x1 <= x0 || y1 <= y0) return { pixels: 0, proceduralMassingShare: null, surfaceShare: null, backdropShare: null, meanRgb: null };
  let pixels = 0, massing = 0, backdrop = 0, sr = 0, sg = 0, sb = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const p = (y * image.width + x) * image.channels;
      const r = image.data[p], g = image.data[p + 1], b = image.data[p + 2];
      pixels += 1; sr += r; sg += g; sb += b;
      if (isProceduralMassing(r, g, b)) massing += 1;
      if (luminance709(r, g, b) <= BACKDROP_LUMINANCE_CEILING) backdrop += 1;
    }
  }
  return {
    pixels,
    proceduralMassingShare: massing / pixels,
    backdropShare: backdrop / pixels,
    surfaceShare: (pixels - backdrop) / pixels,
    meanRgb: [Math.round(sr / pixels), Math.round(sg / pixels), Math.round(sb / pixels)],
  };
}

export const compositionOfFile = (path, roi) => drawCompositionOf(decodePng(readFileSync(path)), roi);

/**
 * The disposition an appearance reading gets from its composition.
 *
 * Pre-registered so it cannot be chosen after a number is seen: a region that is
 * more than `massingRefusalShare` procedural massing cannot support a claim
 * about wave or far-tier appearance, and is refused rather than scored.
 */
export const MASSING_REFUSAL_SHARE = 0.02;
export function appearanceDisposition(composition) {
  if (composition.pixels === 0) return { admissible: false, reason: "empty region" };
  if (composition.proceduralMassingShare > MASSING_REFUSAL_SHARE) {
    return { admissible: false, reason: `region is ${(composition.proceduralMassingShare * 100).toFixed(1)}% procedural massing, so it cannot carry a claim about wave or far-tier geometry` };
  }
  if (composition.surfaceShare < 0.5) {
    return { admissible: false, reason: `region is ${(composition.backdropShare * 100).toFixed(1)}% backdrop, so it is mostly sky or ground rather than a building` };
  }
  return { admissible: true, reason: null };
}

if (process.argv[2] === "inspect") {
  const [, , , path, x0, y0, x1, y1] = process.argv;
  const composition = compositionOfFile(path, { x0: Number(x0), y0: Number(y0), x1: Number(x1), y1: Number(y1) });
  console.log(JSON.stringify({ composition, disposition: appearanceDisposition(composition) }, null, 2));
}
