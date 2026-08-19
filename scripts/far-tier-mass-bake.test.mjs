/**
 * The campaign's wave wiring, pinned to the SHIPPED constants.
 *
 * The failure this exists to catch is the cheap one: a hand-kept table of wave
 * profiles and `-c2` release ids that is correct on the day it is written and
 * silently wrong after the next release. `far-tier-bake-cli.mjs` already grew
 * such a table — two of six waves, inline — and the campaign must not grow a
 * third copy. Every assertion below is an IDENTITY check, not a value check:
 * the profile must BE the imported constant, not merely look like it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FALLBACK_AREA_SHARE_BAR, WAVE_IDS, waveWiring } from "./far-tier-mass-bake-cli.mjs";
import { WAVE_BASE_PROFILES } from "./mass-generation-wave-cli.mjs";
import { EXTERIOR_SERVING_WAVES } from "../src/release/exterior-serving-waves.ts";
import { exteriorTwoLodRetentionReleaseId } from "../src/release/exterior-serving-release.ts";
import { MIDTOWN_CORE_V3_WAVE_PROFILE } from "../src/release/midtown-core-v3-materialization.ts";
import { LOWER_MANHATTAN_WAVE_PROFILE } from "../src/release/lower-manhattan-release.ts";
import { SOUTHERN_REMAINDER_WAVE_PROFILE } from "../src/release/southern-remainder-release.ts";
import { CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE } from "../src/release/central-upper-manhattan-release.ts";
import { NORTHERN_MANHATTAN_WAVE_PROFILE } from "../src/release/northern-manhattan-release.ts";
import { FAR_TIER_ADOPTED_RECIPE } from "../src/release/far-tier-bake.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** w00 has no `src/release/` profile: Block 835 shipped through the block package builder. */
const SHIPPED_PROFILE_BY_WAVE = {
  w01: MIDTOWN_CORE_V3_WAVE_PROFILE,
  w02: LOWER_MANHATTAN_WAVE_PROFILE,
  w03: SOUTHERN_REMAINDER_WAVE_PROFILE,
  w04: CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE,
  w05: NORTHERN_MANHATTAN_WAVE_PROFILE,
};

describe("every wave profile IS the shipped constant, not a copy of it", () => {
  it("covers all six ledger waves", () => {
    expect(WAVE_IDS).toEqual(["w00", "w01", "w02", "w03", "w04", "w05"]);
  });

  for (const [waveId, shipped] of Object.entries(SHIPPED_PROFILE_BY_WAVE)) {
    it(`${waveId} resolves to the imported release-module constant by identity`, () => {
      expect(waveWiring(waveId).baseProfile).toBe(shipped);
    });
  }

  it("takes w00 from the wave CLI's registry, which is its only home", () => {
    expect(waveWiring("w00").baseProfile).toBe(WAVE_BASE_PROFILES.w00);
    // And it is NOT one of the district profiles that do live in src/release/.
    for (const shipped of Object.values(SHIPPED_PROFILE_BY_WAVE)) {
      expect(waveWiring("w00").baseProfile).not.toBe(shipped);
    }
  });

  it("resolves every profile through the same registry the other wave CLIs import", () => {
    for (const waveId of WAVE_IDS) {
      expect(waveWiring(waveId).baseProfile).toBe(WAVE_BASE_PROFILES[waveId]);
    }
  });
});

describe("every -c2 release id is composed, never typed", () => {
  for (const wave of EXTERIOR_SERVING_WAVES) {
    it(`${wave.waveId} composes its id and the package exists on disk`, () => {
      const wiring = waveWiring(wave.waveId);
      expect(wiring.c2ReleaseId).toBe(exteriorTwoLodRetentionReleaseId(wave.retentionReleaseId));
      expect(wiring.retentionReleaseId).toBe(wave.retentionReleaseId);
      const root = join(repositoryRoot, "data", wiring.c2ReleaseId);
      expect(existsSync(join(root, "payload-inventory.json")), `${wiring.c2ReleaseId} is not on disk`).toBe(true);
    });

    it(`${wave.waveId}'s committed package declares the same wave id`, () => {
      const wiring = waveWiring(wave.waveId);
      const inventory = JSON.parse(readFileSync(join(repositoryRoot, "data", wiring.c2ReleaseId, "payload-inventory.json"), "utf8"));
      // The cross-check the CLI enforces at run time, pinned here too.
      expect(inventory.waveId).toBe(wave.waveId);
      expect(inventory.cellManifestCount).toBe(wave.cellCount);
    });
  }

  it("declares the island's 883 cells across the six waves", () => {
    expect(EXTERIOR_SERVING_WAVES.reduce((sum, wave) => sum + wave.cellCount, 0)).toBe(883);
  });
});

describe("the campaign bakes the adopted recipe and judges its fallbacks", () => {
  it("targets the adopted recipe", () => {
    expect(FAR_TIER_ADOPTED_RECIPE.recipeId).toBe("far-tier-hlod-bake-v4");
  });

  it("carries the pre-registered fallback bar, halved from its derivation", () => {
    // share x 0.048 x 0.21 <= 0.001 gives 9.92 per cent; the bar is half of it.
    const unhalved = 0.001 / (0.048 * 0.21);
    expect(FALLBACK_AREA_SHARE_BAR).toBeCloseTo(unhalved / 2, 2);
    expect(FALLBACK_AREA_SHARE_BAR).toBe(0.05);
  });

  it("reads the bar out of the committed pre-registration, not out of the code alone", () => {
    const record = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-mass-20260819/campaign-pre-registration.json"), "utf8"));
    expect(record.zoneFallbackBar.bar).toBe(FALLBACK_AREA_SHARE_BAR);
    expect(record.zoneFallbackBar.unhalvedBar).toBeCloseTo(0.0992, 4);
    expect(record.totalDeclaredCells).toBe(883);
    expect(record.refusalClasses.map((entry) => entry.code)).toContain("over-b2-atlas-budget");
  });

  it("states the wave stop rule as protecting records and operator time, not a serving surface", () => {
    const record = JSON.parse(readFileSync(join(repositoryRoot, "data/far-tier-hlod-mass-20260819/campaign-pre-registration.json"), "utf8"));
    expect(record.waveStopRule.whatItProtects).toContain("protects NO SERVING SURFACE");
    expect(record.waveStopRule.noGo).toContain("before that wave's replay");
  });
});
