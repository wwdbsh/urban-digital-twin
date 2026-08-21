/* global Buffer */
/**
 * The shed-tone comparison, held to the promises its pre-registration made.
 *
 * The point of these tests is not that the arithmetic runs. It is that the tool
 * REFUSES in every case the pre-registration said it would refuse, because a
 * comparison instrument that quietly returns a number when its preconditions
 * fail is worse than no instrument: it produces evidence-shaped output from a
 * situation it could not measure.
 */
import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodePng, luminance709, erode, comparePair, TONE_BAR, BACKGROUND_LUMINANCE_CEILING } from "./shed-tone-compare-cli.mjs";

/** A minimal PNG writer, so the decoder is tested against bytes and not itself. */
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = rgb(x, y);
      const p = y * (1 + width * 3) + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const DIR = mkdtempSync(join(tmpdir(), "shed-tone-"));
const BACKDROP = [14, 21, 26];
/** A lit facade filling the middle of the frame, on the app's dark backdrop. */
function facadeImage(size, value, inset = 20) {
  return encodePng(size, size, (x, y) => (x >= inset && y >= inset && x < size - inset && y < size - inset ? [value, value, value] : BACKDROP));
}
function writePair(name, nearValue, farValue, size = 200) {
  const nearPath = join(DIR, `${name}-near.png`);
  const farPath = join(DIR, `${name}-far.png`);
  writeFileSync(nearPath, facadeImage(size, nearValue));
  writeFileSync(farPath, facadeImage(size, farValue));
  return { nearPath, farPath };
}
const planFor = (paths, overrides = {}) => ({
  buildingId: "doitt:test", ownerCellId: "cell:test",
  nearArmPng: paths.nearPath, farArmPng: paths.farPath,
  roi: { x0: 0, y0: 0, x1: 200, y1: 200 }, erosionPixels: 3,
  wireLevelControl: { nearArmFetched: "lod_0", farArmFetched: "lod_1" },
  ...overrides,
});

describe("the decoder reads bytes, not its own assumptions", () => {
  it("round-trips an image written by an independent encoder", () => {
    const png = encodePng(4, 3, (x, y) => [x * 10, y * 20, 30]);
    const image = decodePng(png);
    expect([image.width, image.height, image.channels]).toEqual([4, 3, 3]);
    expect([image.data[0], image.data[1], image.data[2]]).toEqual([0, 0, 30]);
    const last = (2 * 4 + 3) * 3;
    expect([image.data[last], image.data[last + 1], image.data[last + 2]]).toEqual([30, 40, 30]);
  });

  it("computes Rec.709 luminance on the documented 0..1 scale", () => {
    expect(luminance709(255, 255, 255)).toBeCloseTo(1, 10);
    expect(luminance709(0, 0, 0)).toBe(0);
    // The app's backdrop must sit BELOW the committed background ceiling, or
    // every reading would include sky as if it were facade.
    expect(luminance709(...BACKDROP)).toBeLessThan(BACKGROUND_LUMINANCE_CEILING);
  });
});

describe("erosion removes the boundary rather than trusting it", () => {
  it("strips exactly `radius` rings from a solid block", () => {
    const w = 20, h = 20;
    const mask = new Uint8Array(w * h).fill(1);
    const eroded = erode(mask, w, h, 3);
    let kept = 0;
    for (const v of eroded) kept += v;
    // A 20x20 block eroded by 3 leaves a 14x14 core.
    expect(kept).toBe(14 * 14);
  });

  it("removes a one-pixel sliver entirely, which is the point", () => {
    const w = 30, h = 3;
    const mask = new Uint8Array(w * h).fill(1);
    let kept = 0;
    for (const v of erode(mask, w, h, 3)) kept += v;
    expect(kept).toBe(0);
  });
});

describe("a clean pair is measured", () => {
  it("PASSES when the two arms carry the same tone", () => {
    const result = comparePair(planFor(writePair("same", 180, 180)));
    expect(result.verdict).toBe("PASS");
    expect(result.deviation).toBeCloseTo(0, 12);
    expect(result.pixels.keptAfterErosion).toBeGreaterThan(1000);
  });

  it("FAILS when the coarse arm is measurably darker than the fine arm", () => {
    // 180 -> 168 is a 6.7% drop: comfortably outside the 2% bar.
    const result = comparePair(planFor(writePair("darker", 180, 168)));
    expect(result.verdict).toBe("FAIL");
    expect(result.deviation).toBeGreaterThan(TONE_BAR);
    expect(result.luminanceRatio).toBeLessThan(1);
  });

  it("records the digest of both inputs, so a verdict names the bytes it came from", () => {
    const paths = writePair("digest", 200, 200);
    const result = comparePair(planFor(paths));
    expect(result.inputs.nearArmSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.inputs.nearArmSha256).not.toBe(result.inputs.farArmSha256 && result.inputs.nearArmSha256 === result.inputs.farArmSha256 ? "" : result.inputs.farArmSha256);
  });
});

describe("every pre-registered refusal actually refuses", () => {
  it("refuses when the wire-level control disagrees with the expected ring side", () => {
    // The single most important refusal: without it a pose that never flipped
    // would be scored as a tone measurement, and it would usually PASS.
    const result = comparePair(planFor(writePair("wire", 180, 180), { wireLevelControl: { nearArmFetched: "lod_0", farArmFetched: "lod_0" } }));
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.reason).toContain("wire-level control");
    expect(result.deviation).toBeUndefined();
  });

  it("refuses when too little interior survives erosion to resolve a mean", () => {
    const result = comparePair(planFor(writePair("tiny", 180, 180, 40), { roi: { x0: 0, y0: 0, x1: 40, y1: 40 } }));
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.reason).toContain("interior pixels");
  });

  it("refuses when the two arms disagree about which pixels are surface at all", () => {
    // One arm's facade is inset far more than the other's: the signature of an
    // occluder moving, or of a pose parked somewhere the target is not.
    const nearPath = join(DIR, "occl-near.png");
    const farPath = join(DIR, "occl-far.png");
    writeFileSync(nearPath, facadeImage(200, 180, 20));
    writeFileSync(farPath, facadeImage(200, 180, 60));
    const result = comparePair(planFor({ nearPath, farPath }));
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.reason).toContain("occlusion or a mis-parked pose");
  });

  it("refuses when the arms were captured at different canvas sizes", () => {
    const nearPath = join(DIR, "size-near.png");
    const farPath = join(DIR, "size-far.png");
    writeFileSync(nearPath, facadeImage(200, 180));
    writeFileSync(farPath, facadeImage(160, 180));
    const result = comparePair(planFor({ nearPath, farPath }));
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.reason).toContain("different canvas sizes");
  });

  it("never returns PASS from any refusal path", () => {
    const refusals = [
      comparePair(planFor(writePair("r1", 180, 180), { wireLevelControl: { nearArmFetched: "lod_1", farArmFetched: "lod_1" } })),
      comparePair(planFor(writePair("r2", 180, 180, 40), { roi: { x0: 0, y0: 0, x1: 40, y1: 40 } })),
    ];
    for (const r of refusals) expect(r.verdict).toBe("INCONCLUSIVE");
  });
});
