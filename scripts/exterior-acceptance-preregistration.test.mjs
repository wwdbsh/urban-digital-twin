import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CAMPAIGN_EVIDENCE_ID, EXPECTED_TEXTURE_BYTE_LENGTH, SCHEDULER_RESIDENT_UNIT_CAP } from "./exterior-acceptance-campaign-constants.mjs";

/**
 * The drift instrument for the committed T006 PRE-REGISTRATION.
 *
 * This record's entire authority rests on being older than the measurements it
 * will be used to judge. Two things therefore have to stay true, and this file
 * asserts both rather than trusting them:
 *
 *   1. THE RECORD STILL MATCHES ITS SIDECAR. A pre-registration that can be
 *      edited after a capture is not a pre-registration, so the checksum is
 *      recomputed here and compared byte-for-byte.
 *   2. THE RECORD CONTAINS NO MEASUREMENT. `capturedAt` must be null and no gate
 *      may carry a reading. This is the assertion that would catch the specific
 *      failure this whole discipline exists to prevent: numbers quietly landing
 *      in the pre-registration after they were observed.
 *
 * It ALSO re-checks the frozen records this campaign is forbidden to touch. The
 * heap instrument is re-run by T006 with `--out` pointed at the campaign's own
 * dated root; if that flag ever regresses, the T008 record would be silently
 * overwritten and its checksum would move. Pinning it here makes that loud.
 */
const RECORD_PATH = `data/${CAMPAIGN_EVIDENCE_ID}/pre-registration.json`;
const SIDECAR_PATH = `data/${CAMPAIGN_EVIDENCE_ID}/pre-registration.sha256`;
const text = readFileSync(RECORD_PATH, "utf8");
const record = JSON.parse(text);

describe("T006 pre-registration record", () => {
  it("matches its committed checksum sidecar", () => {
    const recomputed = createHash("sha256").update(text).digest("hex");
    expect(readFileSync(SIDECAR_PATH, "utf8")).toBe(`${recomputed}  pre-registration.json\n`);
  });

  it("contains NO measurement", () => {
    // The one assertion that catches numbers landing here after they were seen.
    expect(record.capturedAt).toBeNull();
    expect(record.capturedAtStatement).toContain("NULL BY CONSTRUCTION");
    expect(record.notPreRegisteredHere.join(" ")).toContain("no reading taken from a running app");

    // Checked on KEYS, not on the serialized text. The record legitimately
    // DISCUSSES attempt counts and measurements in its rules ("attemptCount is
    // recorded", "GPU texture memory measured"), and a substring check would
    // fail on that prose while missing the thing that actually matters: a field
    // holding a reading. Only a key can hold a reading.
    //
    // The rule is "no reading taken from a running app BY THIS CAMPAIGN", not
    // "no number anywhere". PRIOR-TASK readings are legitimate and load-bearing:
    // the forcing argument's empirical leg cites T005's observed stationary
    // stops, and citing them is the opposite of hiding them. That subtree is
    // therefore exempt BY NAME, and it carries `observedStationarySource` so a
    // reader can see whose measurement it is.
    const priorTaskSubtrees = new Set(["observedStationaryStops"]);
    const forbidden = new Set(["attemptCount", "measuredTextureByteLength", "deltaByteLength", "texturesByteLength", "peakConcurrentRequests", "jsHeapBytes", "p50", "p95"]);
    const seen = [];
    const walk = (node) => {
      if (Array.isArray(node)) { for (const entry of node) walk(entry); return; }
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (priorTaskSubtrees.has(key)) continue;
        if (forbidden.has(key)) seen.push(key);
        walk(value);
      }
    };
    walk(record);
    expect(seen).toEqual([]);
    // ...and the exempted subtree must actually be attributed, or the exemption
    // would be a loophole rather than a citation.
    expect(record.gates.eviction.forcingArgument.observedStationarySource).toContain("data/exterior-serving-20260817/");
  });

  it("records the S0 reconciliation readings the campaign depends on", () => {
    const reconciliation = record.reconciliation;
    expect(reconciliation.pinnedExteriorCellReleaseIds.checked).toBe("manhattan-exterior-cells-20260811-v3");
    expect(reconciliation.pinnedExteriorCellReleaseIds.stillPinned).toBe(true);
    // L2's premise, machine-checked from the committed inventories.
    expect(reconciliation.servingComposition.everyWaveShipsASingleLod).toBe(true);
    expect(reconciliation.servingComposition.releases).toHaveLength(6);
    for (const release of reconciliation.servingComposition.releases) {
      expect(release.shippedLodIds).toEqual(["lod_0"]);
      expect(typeof release.retentionSourceReleaseId).toBe("string");
    }
    expect(reconciliation.servingComposition.totalBuildingCount).toBe(44_989);
    // L1's premise.
    expect(reconciliation.block835LodPair.shippedLodIds).toEqual(["lod_0", "lod_1"]);
    expect(reconciliation.block835LodPair.buildingCount).toBe(14);
    // AC #3's correction: no atlas, measured equivalent.
    expect(reconciliation.textureArchitecture.atlas).toBe(false);
    expect(reconciliation.textureArchitecture.uniqueTileCount).toBe(24);
    expect(reconciliation.textureArchitecture.expectedTextureByteLength).toBe(EXPECTED_TEXTURE_BYTE_LENGTH);
    // The Blender inheritance, with its sample limit stated.
    expect(reconciliation.blenderInheritance.sampledBuildings).toBe(94);
    expect(reconciliation.blenderInheritance.failingSamples).toBe(0);
    expect(reconciliation.blenderInheritance.everyServingReleaseDeclaresARetentionSource).toBe(true);
    expect(reconciliation.blenderInheritance.limitOfTheInheritance).toContain("does NOT extend the sample to the population");
  });

  it("carries a forcing argument that is computed, fits, and states its own margin", () => {
    const forcing = record.gates.eviction.forcingArgument;
    expect(forcing.schedulerResidentUnitCap.value).toBe(SCHEDULER_RESIDENT_UNIT_CAP);
    // The argument only works if the worst REACHABLE anchor fits the cap.
    expect(forcing.reachableBound.fitsByteCap).toBe(true);
    expect(forcing.reachableBound.fitsEntryCap).toBe(true);
    expect(forcing.reachableBound.bytes).toBeLessThan(forcing.byteCap);
    // ...and if the modelled heaviest set, which does NOT fit, is labelled
    // unreachable rather than quoted as a bound.
    expect(forcing.modelledUnreachableHeaviestSet.bytes).toBeGreaterThan(forcing.byteCap);
    expect(forcing.modelledUnreachableHeaviestSet.note).toContain("cannot be co-resident");
    expect(forcing.claim).toContain("ONLY IN TRANSIT");
    expect(forcing.marginStatement).toContain("thin");
    expect(forcing.whatWouldFalsifyIt).toContain("WRONG");
    // The empirical leg: T005's heaviest stationary stop fit too.
    const heaviest = forcing.observedStationaryStops.reduce((worst, stop) => (stop.cachedBytes > worst.cachedBytes ? stop : worst));
    expect(heaviest.cacheEntries).toBe(876);
    expect(heaviest.cacheEvictions).toBe(0);
    expect(heaviest.cachedBytes).toBeLessThan(forcing.byteCap);
  });

  it("registers the corrected criterion mapping and the two-pool ceiling", () => {
    expect(record.acceptanceCriterionMapping["#7"]).toContain("request ceiling");
    expect(record.acceptanceCriterionMapping["#8"]).toContain("VISUAL VERIFICATION");
    expect(record.requestCeilings.exteriorPoolMaxConcurrent).toBe(4);
    expect(record.requestCeilings.citywidePoolMaxConcurrent).toBe(4);
    expect(record.requestCeilings.neverSum).toContain("never summed");
  });
});

/**
 * THE FROZEN RECORDS THIS CAMPAIGN MUST NOT TOUCH.
 *
 * Checksums captured from the tree at 228d17d, before any campaign edit. The
 * heap record is the one at genuine risk — T006 re-runs its instrument — and the
 * seven journey records are frozen because they describe compositions that no
 * longer exist and could not be reproduced if overwritten.
 */
const FROZEN = {
  "data/citywide-heap-repeat-20260815/heap-repeat-evidence.json": "6c3ef7c38118dcc1630a1da73ae2224592b5c4fbd94c60c4488a07ddc925eb9a",
  // ADDED AT THE CAPTURE COMMIT, for a reason the S1 list did not yet have:
  // these T005 records are the BASELINES the T006 gates are defined against.
  // E-1a's comparison condition is byte-identical to `eviction-at-scale.json`'s
  // `findings.evictionsObserved === false`, the E-1 forcing argument quotes
  // `default-session-residency.json`'s stationary stops, and G4 restates
  // `gpu-campaign.json`'s two arms. The T006 instrument writes to a different
  // root and refuses to run without `--out`; this is the check that the refusal
  // held.
  "data/exterior-serving-20260817/eviction-at-scale.json": "84809b28ad88460a5bd3ee678bfed5a210b0ec3d859773824f8fe57bc18575cb",
  "data/exterior-serving-20260817/default-session-residency.json": "dc86b08882cdab0c2e311be3ee43428b84d28860a4aa55d7233549da8308891e",
  "data/exterior-serving-20260817/frame-time-ab.json": "8bf220330cf70232aca2acf1a25bebdd2c29f0ecffc46433902c69e095b72482",
  "data/exterior-serving-20260817/frame-arm-a.json": "8efe6f0f384a4b11755fd9b53da385b2aea7b9b89c7a659fe9cb437ddb517a9e",
  "data/exterior-serving-20260817/frame-arm-b.json": "daa543f88ed3ccc487479e8f6a2dec8ca5f66550f84a97aa799ebe6d0c133bcc",
  "data/shared-class-textures-20260815/gpu-campaign.json": "0a9501b717c088644d793ffe9d7961893534bc975b4d9054e7681273ab13dd9f",
  "data/central-upper-manhattan-20260812/journey-evidence.json": "d7af843a7b07f3eea1602528010e48b553296d843d0025eb1347e976e61909cf",
  "data/central-upper-manhattan-20260812-p1/journey-evidence.json": "6ce55d588828eed17c0f05060f32645e2e697322f4283e799907b21087294a5f",
  "data/lower-manhattan-20260812-p1/journey-evidence.json": "348b174021f9f896d930232153bf827fa6cd7c88ebf44d7a2ff1625d5cdff0cb",
  "data/northern-manhattan-20260812/journey-evidence.json": "5e193a763616190c634f7e6117d440f34c0725e49199c234d890fc273963ade9",
  "data/northern-manhattan-20260812-p1/journey-evidence.json": "43295555a75582f9e663ce11bf1dc872b59b016233ed272af6685beec76c6b93",
  "data/southern-remainder-20260812/journey-evidence.json": "6dfd1d9004217c160f924b3065f2cfe0069bc9e718d8d9e357e20fc7ec66ca41",
  "data/southern-remainder-20260812-p1/journey-evidence.json": "ad6a2ba7d97085685aa1c8352bf6fd6670fd5fa910f9d03948dc04df69e59551",
};

describe("frozen prior-task evidence stays untouched by the T006 campaign", () => {
  for (const [path, checksum] of Object.entries(FROZEN)) {
    it(`${path} is byte-identical to its pre-campaign state`, () => {
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(checksum);
    });
  }
});
