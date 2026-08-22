/* global Buffer, TextDecoder */
/**
 * G1-STYLE VALIDATION OF A NEW INSTRUMENT, on a known scene, before it is used.
 *
 * T007 introduces this classifier, so T007 owes a demonstration that it reads
 * the right thing — not a demonstration that it runs. Two levels:
 *
 *  1. EXACT ZERO AND ONE on synthesised scenes whose answer is known by
 *     construction: pure massing must read 1.000000, pure facade 0.000000. Not
 *     "close to": exactly.
 *  2. AGREEMENT WITH A COMMITTED RECORD on a real scene. T006 measured the
 *     composition of six real captures and committed both the stills and the
 *     numbers. This suite re-derives them from the same bytes and requires the
 *     same values. If the classifier ever drifts, a record that a previous task
 *     already published stops matching.
 */
import { readFileSync, existsSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { decodePng } from "./shed-tone-compare-cli.mjs";
import {
  drawCompositionOf, compositionOfFile, isProceduralMassing, appearanceDisposition,
  MASSING_SIGNATURE, MASSING_REFUSAL_SHARE, BACKDROP_LUMINANCE_CEILING,
} from "./draw-composition.mjs";

/** Minimal PNG writer so the decoder is exercised against real bytes. */
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = rgb(x, y);
      const p = y * (1 + width * 3) + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    let crc = 0xffffffff;
    for (const byte of body) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const image = (w, h, rgb) => decodePng(encodePng(w, h, rgb));
const FULL = (w, h) => ({ x0: 0, y0: 0, x1: w, y1: h });

const MASSING = MASSING_SIGNATURE.approximateRenderedRgb;
const FACADE = [200, 199, 195];   // the near-neutral facade tone T006 measured
const TERRACOTTA = [193, 140, 122]; // a warm roof: the classifier's hard case
const BACKDROP = [14, 21, 26];

describe("exact zero and one on scenes whose answer is known by construction", () => {
  it("reads a pure massing region as EXACTLY 1", () => {
    const c = drawCompositionOf(image(40, 40, () => MASSING), FULL(40, 40));
    expect(c.proceduralMassingShare).toBe(1);
    expect(c.pixels).toBe(1600);
  });

  it("reads a pure facade region as EXACTLY 0", () => {
    expect(drawCompositionOf(image(40, 40, () => FACADE), FULL(40, 40)).proceduralMassingShare).toBe(0);
  });

  it("does not mistake a terracotta roof for massing", () => {
    // Both are warm; only massing has the large green-to-blue gap. Without this
    // the classifier would refuse half the island's roofs as "massing".
    expect(TERRACOTTA[0] - TERRACOTTA[1]).toBeGreaterThan(MASSING_SIGNATURE.minRedMinusGreen);
    expect(TERRACOTTA[1] - TERRACOTTA[2]).toBeLessThan(MASSING_SIGNATURE.minGreenMinusBlue);
    expect(drawCompositionOf(image(20, 20, () => TERRACOTTA), FULL(20, 20)).proceduralMassingShare).toBe(0);
    expect(isProceduralMassing(...MASSING)).toBe(true);
    expect(isProceduralMassing(...TERRACOTTA)).toBe(false);
  });

  it("splits a half-and-half region at exactly 0.5", () => {
    const c = drawCompositionOf(image(40, 40, (x) => (x < 20 ? MASSING : FACADE)), FULL(40, 40));
    expect(c.proceduralMassingShare).toBe(0.5);
  });

  it("separates backdrop from surface at the committed ceiling", () => {
    const c = drawCompositionOf(image(40, 40, (x) => (x < 10 ? BACKDROP : FACADE)), FULL(40, 40));
    expect(c.backdropShare).toBe(0.25);
    expect(c.surfaceShare).toBe(0.75);
    expect(BACKDROP_LUMINANCE_CEILING).toBe(0.10);
  });
});

describe("the disposition is pre-registered, not chosen per reading", () => {
  it("refuses a region that is mostly massing", () => {
    const d = appearanceDisposition(drawCompositionOf(image(20, 20, () => MASSING), FULL(20, 20)));
    expect(d.admissible).toBe(false);
    expect(d.reason).toContain("procedural massing");
  });

  it("refuses a region that is mostly backdrop", () => {
    const d = appearanceDisposition(drawCompositionOf(image(20, 20, () => BACKDROP), FULL(20, 20)));
    expect(d.admissible).toBe(false);
    expect(d.reason).toContain("backdrop");
  });

  it("admits a clean facade region", () => {
    expect(appearanceDisposition(drawCompositionOf(image(20, 20, () => FACADE), FULL(20, 20))).admissible).toBe(true);
  });

  it("keeps the refusal share at the registered 2%", () => {
    expect(MASSING_REFUSAL_SHARE).toBe(0.02);
  });
});

/**
 * The real-scene half. T006 committed six captures and the composition it
 * measured for each; those numbers are re-derived here from the same bytes.
 */
const T006_ROOT = join("data", "far-tier-lod-transition-20260821");
const T006_RESULTS = join(T006_ROOT, "shed-tone-results-v2.json");
const T006_PLAN = join(T006_ROOT, "shed-tone-plan-v2.json");
const readJson = (p) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(p)));

describe("agreement with a committed record, on a real scene", () => {
  const available = existsSync(T006_RESULTS) && existsSync(T006_PLAN);

  it("finds T006's committed captures to validate against", () => {
    // Guarded deliberately: if this checkout ever loses those records the suite
    // must say so rather than quietly validate against nothing.
    expect(available, "T006 shed-tone records are absent; the real-scene validation cannot run").toBe(true);
  });

  it("re-derives every composition T006 published, from the same bytes", () => {
    const results = readJson(T006_RESULTS);
    const plan = readJson(T006_PLAN);
    const roiOf = new Map(plan.pairs.map((p) => [p.buildingId, p]));
    let checked = 0;
    for (const pair of results.pairs) {
      const planned = roiOf.get(pair.buildingId);
      const origin = planned.canvasOrigin;
      const roi = {
        x0: planned.roi.x0 + origin.x, y0: planned.roi.y0 + origin.y,
        x1: planned.roi.x1 + origin.x, y1: planned.roi.y1 + origin.y,
      };
      for (const [arm, png] of [["nearArm", planned.nearArmPng], ["farArm", planned.farArmPng]]) {
        const recorded = pair.roiComposition[arm];
        const derived = compositionOfFile(png, roi);
        expect(derived.pixels, `${pair.buildingId} ${arm} pixels`).toBe(recorded.pixels);
        expect(Number(derived.proceduralMassingShare.toFixed(4)), `${pair.buildingId} ${arm} massing share`).toBe(recorded.proceduralMassingShare);
        // Mean RGB agrees to within one unit per channel, and the difference is
        // a ROUNDING CONVENTION, not a disagreement about the pixels: T006's
        // record was produced with floor division, this module rounds. The
        // decisive quantities -- pixel count and massing share -- match exactly,
        // and the convention is stated here rather than quietly matched by
        // adopting a less correct rounding to make a test go green.
        for (let channel = 0; channel < 3; channel += 1) {
          expect(Math.abs(derived.meanRgb[channel] - recorded.meanRgb[channel]),
            `${pair.buildingId} ${arm} mean rgb channel ${channel}`).toBeLessThanOrEqual(1);
        }
        checked += 1;
      }
    }
    expect(checked).toBe(12);
  });

  it("would have refused the false PASS T006 nearly published", () => {
    // doitt:147902 read 0.008% deviation -- a perfect-looking tone match -- with
    // BOTH arms at 100% procedural massing. This is the reading that instrument
    // must refuse, and the reason this module exists.
    const results = readJson(T006_RESULTS);
    const pair = results.pairs.find((p) => p.buildingId === "doitt:147902");
    for (const arm of ["nearArm", "farArm"]) {
      expect(pair.roiComposition[arm].proceduralMassingShare).toBe(1);
      expect(appearanceDisposition(pair.roiComposition[arm]).admissible).toBe(false);
    }
  });
});
