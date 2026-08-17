import { describe, expect, it } from "vitest";

import {
  AC_MAPPING,
  BLOCK_835_V3_RELEASE_ID,
  CACHE_CEILINGS,
  EVICTION_GATES,
  EVICTION_LOOP,
  EXPECTED_TEXTURE_BYTE_LENGTH,
  EXPECTED_UNIQUE_TILE_COUNT,
  FRAME_F1,
  FRAME_F2,
  FRAME_F4,
  GPU_GATES,
  HEADROOM_H1,
  HEAP_GATES,
  LOD_L1,
  LOD_L2,
  PROMOTED_WAVE_COUNT,
  REQUEST_CEILINGS,
  SHARED_CLASS_TILES_PER_WAVE,
  SCHEDULER_RESIDENT_UNIT_CAP,
  STATIONS,
  STORM_S1,
  STORM_TRANSLATIONS,
  TEXTURE_TOLERANCE_TILES,
} from "./exterior-acceptance-campaign-constants.mjs";
import { PINNED_EXTERIOR_CELL_RELEASE_IDS } from "../src/app/App.tsx";
import { EXTERIOR_RUNTIME_BUDGETS } from "../src/runtime/exterior-cell-runtime.ts";
import { CITYWIDE_OVERVIEW_BUDGETS } from "../src/release/citywide-release.ts";
import { EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY } from "../src/runtime/exterior-visibility-scheduler.ts";
import { predictedTextureByteLength } from "../src/features/explorer/gpu-texture-probe.ts";

/**
 * THE PINNING TEST FOR THE PRE-REGISTRATION.
 *
 * "Pre-registered" is only a meaningful word if changing a bar after the fact is
 * DIFFICULT AND VISIBLE. This file is the mechanism: every load-bearing number
 * the campaign is judged against is asserted here byte-for-byte, so editing a
 * bar to fit a reading breaks a committed test in the same diff that edits it.
 *
 * It also re-derives the numbers that are supposed to be derivations rather than
 * constants (the 24-tile total, the texture byte budget) from the shipped
 * modules, so a bar cannot quietly drift away from the arithmetic it claims to
 * be. And it re-checks the S0 reconciliation fact the L1 and J3 arms depend on.
 */
describe("T006 acceptance-campaign pre-registration", () => {
  it("pins the S0 reconciliation fact: the Block 835 -v3 release is still pinned by the build", () => {
    // L1 and J3 both address this release through `?exteriorCells=`. If the build
    // stops pinning it, neither arm can run at all, and the failure would show up
    // as an unexplained activation timeout rather than as a missing pin.
    expect(BLOCK_835_V3_RELEASE_ID).toBe("manhattan-exterior-cells-20260811-v3");
    expect(PINNED_EXTERIOR_CELL_RELEASE_IDS).toContain(BLOCK_835_V3_RELEASE_ID);
  });

  it("pins the five stations, including the nadir island overview", () => {
    expect(STATIONS.map((station) => station.stationId)).toEqual([
      "overview-52km-island",
      "overview-2400m-anchor",
      "transition-1200m-anchor",
      "street-260m-midtown",
      "street-260m-w02-lower",
    ]);
    const island = STATIONS[0];
    expect({ lon: island.lon, lat: island.lat, height: island.height, pitch: island.pitch }).toEqual({ lon: -73.9712, lat: 40.7831, height: 52_000, pitch: -90 });
    expect(STATIONS[1]).toMatchObject({ lon: -73.986360, lat: 40.748775, height: 2_400, heading: 45, pitch: -50 });
    expect(STATIONS[2]).toMatchObject({ lon: -73.986360, lat: 40.748775, height: 1_200, heading: 45, pitch: -45 });
    expect(STATIONS[3]).toMatchObject({ lon: -73.986360, lat: 40.748775, height: 260, heading: 45, pitch: -25 });
    expect(STATIONS[4]).toMatchObject({ lon: -74.009000, lat: 40.706900, height: 260, heading: 45, pitch: -25 });
  });

  it("pins the strict frame pair, the sample floor and the settle", () => {
    expect(FRAME_F1.p50Ms).toBe(16.7);
    expect(FRAME_F1.p95Ms).toBe(25);
    expect(FRAME_F1.minimumFrames).toBe(600);
    expect(FRAME_F1.settleMs).toBe(45_000);
    // The window must be able to REACH the floor on a 60 Hz display after the
    // sampler drops its first delta. 10 s yields 599 and would fail by
    // construction; this assertion is the arithmetic that forced 12 s.
    const nominalFramesAt60Hz = Math.floor(FRAME_F1.windowMs / (1000 / 60)) - 1;
    expect(nominalFramesAt60Hz).toBeGreaterThanOrEqual(FRAME_F1.minimumFrames);
  });

  it("pins the control discipline as an interpretation rule in both vsync modes", () => {
    expect(FRAME_F2.modes).toEqual(["vsync-on", "vsync-off"]);
    expect(FRAME_F2.sameBrowserRequired).toBe(true);
    expect(FRAME_F2.rule).toContain("only MEANINGFUL above the control's own p95");
  });

  it("pins D-11's inherited leg-Y bar and the named-carry outcome", () => {
    expect(FRAME_F4.legYDoubleDrawMs).toBe(4_000);
    expect(FRAME_F4.legXRebuildMs).toBe(8_000);
    expect(FRAME_F4.rule).toContain("named carry of D-11");
    expect(FRAME_F4.rule).toContain("NOT as a campaign failure");
    // Exceeding the bar must not be reported as a pass either: the registered
    // outcome is a carry with the measured value attached.
    expect(FRAME_F4.rule).toContain("with the measured value");
  });

  it("pins the headroom gates as non-gating, with the detectability condition", () => {
    expect(HEADROOM_H1.gating).toBe(false);
    expect(HEADROOM_H1.launchFlags).toEqual(["--disable-gpu-vsync", "--disable-frame-rate-limit"]);
    expect(HEADROOM_H1.detectabilityCondition).toContain("INSTRUMENT-STILL-SATURATED");
  });

  it("pins the storm shape and the stricter resolution of the T005 exclusion", () => {
    expect(STORM_S1.dragCount).toBe(12);
    expect(STORM_S1.zoomExcursions).toHaveLength(4);
    expect(STORM_TRANSLATIONS).toHaveLength(6);
    expect(STORM_S1.gates["S-1a"].rule).toContain("16.7");
    expect(STORM_S1.gates["S-1a"].rule).toContain("25");
    expect(STORM_S1.gates["S-1a"].stricterThanT005).toContain("EXCLUDED");
    // S-1c is the regression gate. Zero is the only passing value; if this
    // assertion is ever relaxed the cancellation defect can return unobserved.
    expect(STORM_S1.gates["S-1c"].rule).toContain("=== 0");
    expect(STORM_S1.gates["S-1c"].whyItExists).toContain("CANCELLATION-DEFECT REGRESSION GATE");
  });

  it("pins the storm translation list as a committed route of roughly 600 m steps", () => {
    // Re-derives each step's ground distance from the committed coordinates, so
    // a waypoint edited into a cheaper corner changes a measured number here.
    const metresPerDegreeLat = 111_320;
    for (let index = 1; index < STORM_TRANSLATIONS.length; index += 1) {
      const previous = STORM_TRANSLATIONS[index - 1];
      const current = STORM_TRANSLATIONS[index];
      const dLat = (current.lat - previous.lat) * metresPerDegreeLat;
      const dLon = (current.lon - previous.lon) * metresPerDegreeLat * Math.cos((current.lat * Math.PI) / 180);
      const metres = Math.hypot(dLat, dLon);
      expect(metres).toBeGreaterThan(500);
      expect(metres).toBeLessThan(700);
    }
  });

  it("DERIVES the 24-tile texture budget rather than asserting a typed total", () => {
    expect(SHARED_CLASS_TILES_PER_WAVE).toBe(4);
    expect(PROMOTED_WAVE_COUNT).toBe(6);
    expect(EXPECTED_UNIQUE_TILE_COUNT).toBe(24);
    // 24 * trunc(128 * 128 * 4 * 4 / 3) = 24 * 87,381.
    expect(predictedTextureByteLength(1)).toBe(87_381);
    expect(EXPECTED_TEXTURE_BYTE_LENGTH).toBe(2_097_144);
    expect(EXPECTED_TEXTURE_BYTE_LENGTH).toBe(EXPECTED_UNIQUE_TILE_COUNT * 87_381);
    expect(TEXTURE_TOLERANCE_TILES).toBe(1);
  });

  it("pins G1 as an exact-zero instrument validation, not a tolerance", () => {
    expect(GPU_GATES.G1.barBytes).toBe(0);
    expect(GPU_GATES.G1.rule).toContain("exactly 0");
    expect(GPU_GATES.G1.rule).toContain("NOT reported as measurements");
    // G3 is the architecture claim and must be captured at both ends of the
    // residency range, or it cannot distinguish sharing from duplication.
    expect(GPU_GATES.G3.residentAssetHigh).toBe(300);
    expect(GPU_GATES.G3.residentAssetLow).toBe(20);
    expect(GPU_GATES.G4.gating).toBe(false);
  });

  it("pins the eviction loop as CLOSED and its gates", () => {
    expect(EVICTION_LOOP).toHaveLength(8);
    const first = EVICTION_LOOP[0];
    const last = EVICTION_LOOP[EVICTION_LOOP.length - 1];
    // A loop that does not return to its start cannot test re-admission.
    expect({ lon: last.lon, lat: last.lat, height: last.height, heading: last.heading, pitch: last.pitch, roll: last.roll })
      .toEqual({ lon: first.lon, lat: first.lat, height: first.height, heading: first.heading, pitch: first.pitch, roll: first.roll });
    expect(EVICTION_GATES["E-1a"].rule).toContain("cacheEvictions > 0");
    expect(EVICTION_GATES["E-1b"].rule).toContain("byte-identical re-entry");
  });

  it("pins the corrected selection selector and the non-null conjunct", () => {
    // The whole point of E-1e. Two nulls are equal, so equality alone is
    // satisfied by an instrument that reads nothing; the non-null conjunct is
    // what makes the gate capable of failing.
    expect(EVICTION_GATES["E-1e"].selector).toBe('aside.inspector[aria-label="Selected feature details"]');
    expect(EVICTION_GATES["E-1e"].rule).toContain("EQUAL and BOTH NON-NULL");
    expect(EVICTION_GATES["E-1e"].whyNonNullIsRegistered).toContain("IMPLICIT");
    expect(EVICTION_GATES["E-1f"].rule).toContain("CANVAS PICK");
  });

  it("pins the heap instrument's new validity condition and the raised cap with its reason", () => {
    expect(HEAP_GATES.M2.rule).toContain("activeRequests === 0");
    expect(HEAP_GATES.M2.onViolation).toContain("INSTRUMENT-FAILURE ABORT");
    expect(HEAP_GATES.lapPhaseCapMs).toBe(75 * 60 * 1_000);
    // Raised from T008's 50 minutes, and the reason is committed with the number.
    expect(HEAP_GATES.lapPhaseCapMs).toBeGreaterThan(50 * 60 * 1_000);
    expect(HEAP_GATES.lapPhaseCapReason).toContain("RAISED from 50 to 75 minutes");
    expect(HEAP_GATES.frozenPathProhibition).toContain("citywide-heap-repeat-20260815");
  });

  it("pins the TWO-POOL ceiling statement and forbids a combined '8'", () => {
    expect(REQUEST_CEILINGS.exteriorPoolMaxConcurrent).toBe(4);
    expect(REQUEST_CEILINGS.exteriorPoolMaxConcurrent).toBe(EXTERIOR_RUNTIME_BUDGETS.maxConcurrentRequests);
    expect(REQUEST_CEILINGS.citywidePoolMaxConcurrent).toBe(4);
    expect(REQUEST_CEILINGS.citywidePoolMaxConcurrent).toBe(CITYWIDE_OVERVIEW_BUDGETS.maxConcurrentRequests);
    expect(REQUEST_CEILINGS.appWideSharedSemaphoreMaxConcurrent).toBe(4);
    expect(REQUEST_CEILINGS.gate).toContain("peak <= 4");
    expect(REQUEST_CEILINGS.neverSum).toContain("never summed");
    // No bar anywhere in the registered ceilings may be an 8.
    expect(JSON.stringify(REQUEST_CEILINGS)).not.toMatch(/<=\s*8\b(?!\s*active requests' is superseded)/u);
    expect(CACHE_CEILINGS).toEqual({ maxCacheEntries: 1_024, maxCachedBytes: 256 * 1024 * 1024 });
  });

  it("pins the scheduler resident-unit cap against the real scheduler policy", () => {
    // The constant is RESTATED in the constants module because a .mjs CLI cannot
    // import the scheduler (it uses extensionless relative imports). This
    // assertion is the compensating control: vitest CAN import it, so a drift in
    // the scheduler breaks here instead of silently invalidating the E-1
    // forcing argument, which is computed at this cap.
    expect(SCHEDULER_RESIDENT_UNIT_CAP).toBe(EXTERIOR_CELL_GLOBAL_SCHEDULER_POLICY.maxResidentUnits);
    expect(SCHEDULER_RESIDENT_UNIT_CAP).toBe(8);
  });

  it("pins L1 as a mechanism demonstration that does NOT discharge AC #4, and L2 as a registered stop", () => {
    expect(LOD_L1.buildingCount).toBe(14);
    expect(LOD_L1.stillHeightsM).toEqual([300, 200]);
    // The profile is part of the frozen method: the exploration profile never
    // selects lod_0, so a pair captured there would show one LOD twice and
    // could be misread as a working transition.
    expect(LOD_L1.profile).toBe("inspection");
    expect(LOD_L1.lodSeamMeters).toBe(250);
    // The still heights must BUCKET to opposite sides of the seam. This is the
    // arithmetic that rejected 260 m, which buckets to 300 and would have put
    // both stills on the same side.
    const bucket = (height) => Math.max(50, Math.round(height / 100) * 100);
    const buckets = LOD_L1.stillHeightsM.map(bucket);
    expect(buckets).toEqual([300, 200]);
    expect(Math.min(...buckets)).toBeLessThanOrEqual(LOD_L1.lodSeamMeters);
    expect(Math.max(...buckets)).toBeGreaterThan(LOD_L1.lodSeamMeters);
    expect(bucket(260)).toBe(300);
    // No probe exposes lodId; the only surface is the details panel row.
    expect(LOD_L1.lodIdReadMethod).toContain("Active asset");
    expect(LOD_L1.explicitlyNotDischarging).toContain("#4");
    expect(LOD_L2.verdict).toBe("HONEST-STOP");
    expect(LOD_L2.rule).toContain("SINGLE LOD");
    expect(LOD_L2.reachabilityRoutes).toHaveLength(2);
  });

  it("pins the CORRECTED acceptance-criterion mapping", () => {
    // The correction that matters: #7 owns the request ceiling, #8 owns the
    // stills and the journey suites. A campaign that measures the right things
    // against transposed criterion numbers discharges nothing.
    expect(AC_MAPPING["#7"]).toContain("CACHE AND STREAMING GOVERNANCE");
    expect(AC_MAPPING["#7"]).toContain("request ceiling");
    expect(AC_MAPPING["#8"]).toContain("VISUAL VERIFICATION");
    expect(AC_MAPPING["#8"]).toContain("journey suites");
    expect(AC_MAPPING["#3"]).toContain("NO ATLAS");
    expect(AC_MAPPING["#3"]).toContain("measured-equivalent");
    expect(AC_MAPPING.correctionNote).toContain("transposed");
  });
});
