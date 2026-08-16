/**
 * The stage-fingerprint pins.
 *
 * `midtownCoreV3StageFingerprint` decides whether a resumable stage may reuse a
 * receipt. Two things it depended on were invisible to it before T004 — the
 * GRAMMAR STATE a wave is materialized under, and WHERE its detail tiles are
 * delivered — which is the ADR 0046 D5b defect class: a receipt taken under one
 * policy silently satisfying a stage running another.
 *
 * Closing that must not move a single frozen wave's fingerprints, because a
 * moved fingerprint invalidates every receipt of a release whose bytes are
 * frozen and would re-run stages that have nothing to re-derive. The thirteen
 * committed profile fingerprints below are therefore PINNED TO LITERALS
 * computed on the commit before the change, not merely compared to each other:
 * a self-comparison would pass just as happily if every value had moved
 * together.
 */
import { describe, expect, it } from "vitest";
import {
  V3_ROOFTOP_HONESTY_OPTIONS,
  V3_SHIPPED_GRAMMAR_OPTIONS,
} from "../domain/deterministic-facade-generator-v3.ts";
import { CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE } from "./central-upper-manhattan-p1-release.ts";
import { CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE, CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE } from "./central-upper-manhattan-release.ts";
import { EXTERIOR_T1_VARIANTS } from "./exterior-t1-variants.ts";
import { LOWER_MANHATTAN_P1_WAVE_PROFILE } from "./lower-manhattan-p1-release.ts";
import { LOWER_MANHATTAN_CENSUS_PROFILE, LOWER_MANHATTAN_WAVE_PROFILE } from "./lower-manhattan-release.ts";
import { MIDTOWN_CORE_V3_WAVE_PROFILE, type V3WaveProfile } from "./midtown-core-v3-materialization.ts";
import { midtownCoreV3StageFingerprint } from "./midtown-core-v3-source.ts";
import { NORTHERN_MANHATTAN_P1_WAVE_PROFILE } from "./northern-manhattan-p1-release.ts";
import { NORTHERN_MANHATTAN_CENSUS_PROFILE, NORTHERN_MANHATTAN_WAVE_PROFILE } from "./northern-manhattan-release.ts";
import { SOUTHERN_REMAINDER_P1_WAVE_PROFILE } from "./southern-remainder-p1-release.ts";
import { SOUTHERN_REMAINDER_CENSUS_PROFILE, SOUTHERN_REMAINDER_WAVE_PROFILE } from "./southern-remainder-release.ts";

const SHARED = {
  stage: "plans",
  baseManifestChecksumSha256: "a".repeat(64),
  parentLedgerChecksumSha256: "b".repeat(64),
  subsetLedgerChecksumSha256: "c".repeat(64),
  predecessorInventoryChecksumSha256: "d".repeat(64),
  renderableCellCount: 7,
  shippedLodId: "lod_0",
};

/** Computed at 9e120e1, the commit before the grammar envelope existed. */
const FROZEN_FINGERPRINTS: ReadonlyArray<readonly [string, V3WaveProfile, string]> = [
  ["w01 midtown-core", MIDTOWN_CORE_V3_WAVE_PROFILE, "5bfdf427a770d3e17b987e489d983445cbab94851d8c7bc682ad198f4c0b3bfa"],
  ["lower-manhattan wave", LOWER_MANHATTAN_WAVE_PROFILE, "b8172986a852cc65b2bc11e70440943ed5b3a8f2dbede7d86d659c911ca5ebe0"],
  ["lower-manhattan census", LOWER_MANHATTAN_CENSUS_PROFILE, "cb08522d06477d7b0ede310d8272efec16f1f6a8d62ae22f6c1c55a11bc4d7f7"],
  ["lower-manhattan p1", LOWER_MANHATTAN_P1_WAVE_PROFILE, "2eacab3b98817a04c28216abbcc92aeff05e09b66f0f798930e2f1000acf5354"],
  ["central-upper wave", CENTRAL_UPPER_MANHATTAN_WAVE_PROFILE, "67cbdbf3f1ead08acc6b6566d2d9a27a8d5262f7e91ada96d2c2d8ba6b7a459b"],
  ["central-upper census", CENTRAL_UPPER_MANHATTAN_CENSUS_PROFILE, "07759bea30b9f467d894651c1dd02193ad0b431ac74e3e611709f6e5ff5fac28"],
  ["central-upper p1", CENTRAL_UPPER_MANHATTAN_P1_WAVE_PROFILE, "54e62bbf5cd900a6323153e7c4f415976594a6f25668a4996d4762ecc9d28b40"],
  ["northern wave", NORTHERN_MANHATTAN_WAVE_PROFILE, "66e2edc7f0e9acd72733babf462380e0361149a918d07881b8db52bed520666c"],
  ["northern census", NORTHERN_MANHATTAN_CENSUS_PROFILE, "c2aa7dc5ff29790cbdc24d46e9a9d174e30e8b7e27a4e37388202fb752bb1803"],
  ["northern p1", NORTHERN_MANHATTAN_P1_WAVE_PROFILE, "157c2f80cb56406325a1bbec6c67770648ce25c1caf76a26192282a1c7b10a12"],
  ["southern wave", SOUTHERN_REMAINDER_WAVE_PROFILE, "be86acf3c09063b43f5d10df7b3e1d1394da12bac42ea0f8ce30617c1f71239a"],
  ["southern census", SOUTHERN_REMAINDER_CENSUS_PROFILE, "771fba82803df43820ebe7a5a6bd2ce203f9a787c11d9b060e39d29a7b88c1b3"],
  ["southern p1", SOUTHERN_REMAINDER_P1_WAVE_PROFILE, "ec278816c6f2ebc8a32222d7f5e947860614013fd9bd57d2e94fa7fae6ad1477"],
];

describe("every frozen wave profile's stage fingerprint is unmoved", () => {
  it.each(FROZEN_FINGERPRINTS.map(([name, profile, expected]) => ({ name, profile, expected })))(
    "$name",
    ({ profile, expected }) => {
      expect(midtownCoreV3StageFingerprint({ ...SHARED, profile })).toBe(expected);
    },
  );

  it("pins the shipped grammar on every frozen profile, so the envelope is declared rather than assumed", () => {
    for (const [name, profile] of FROZEN_FINGERPRINTS) {
      expect(profile.admissionEnvelope, name).toEqual(V3_SHIPPED_GRAMMAR_OPTIONS);
    }
  });

  it("is unmoved whether the shipped envelope is pinned, omitted or spelled out field by field", () => {
    const pinned = midtownCoreV3StageFingerprint({ ...SHARED, profile: MIDTOWN_CORE_V3_WAVE_PROFILE });
    const omitted = midtownCoreV3StageFingerprint({
      ...SHARED,
      profile: { ...MIDTOWN_CORE_V3_WAVE_PROFILE, admissionEnvelope: undefined },
    });
    const partial = midtownCoreV3StageFingerprint({
      ...SHARED,
      profile: { ...MIDTOWN_CORE_V3_WAVE_PROFILE, admissionEnvelope: { lowRiseFloorHeight: false } },
    });
    expect(omitted).toBe(pinned);
    expect(partial).toBe(pinned);
  });
});

describe("the fingerprint now SEES what it was blind to", () => {
  /**
   * A raised cap of 65, rather than the T003 extended envelope's constant.
   *
   * The T003 inertness guard asserts that nothing outside that envelope's own
   * definition, its tests and the census CLI so much as NAMES it — the guard is
   * a substring scan over `src` and `scripts`, so even a mention in a comment
   * counts, which is exactly the strictness it wants. What this test has to
   * prove is that the fingerprint READS the field at all, and one more
   * admissible vertex proves that as well as any larger cap would.
   */
  it("moves for a raised ring-vertex cap", () => {
    expect(midtownCoreV3StageFingerprint({
      ...SHARED,
      profile: { ...MIDTOWN_CORE_V3_WAVE_PROFILE, admissionEnvelope: { maxRingVertices: 65 } },
    })).not.toBe(midtownCoreV3StageFingerprint({ ...SHARED, profile: MIDTOWN_CORE_V3_WAVE_PROFILE }));
  });

  it("moves for the low-rise floor-height derivation", () => {
    expect(midtownCoreV3StageFingerprint({
      ...SHARED,
      profile: { ...MIDTOWN_CORE_V3_WAVE_PROFILE, admissionEnvelope: { lowRiseFloorHeight: true } },
    })).not.toBe(midtownCoreV3StageFingerprint({ ...SHARED, profile: MIDTOWN_CORE_V3_WAVE_PROFILE }));
  });

  it("moves for each rooftop rule INDEPENDENTLY, so neither can ride in unnoticed", () => {
    const base = midtownCoreV3StageFingerprint({ ...SHARED, profile: MIDTOWN_CORE_V3_WAVE_PROFILE });
    const prints = new Set([base]);
    for (const envelope of [
      { rooftopGroupContainment: true },
      { rooftopClusterHeightClamp: true },
      { ...V3_ROOFTOP_HONESTY_OPTIONS },
      { maxRingVertices: 65, lowRiseFloorHeight: true, ...V3_ROOFTOP_HONESTY_OPTIONS },
    ]) {
      prints.add(midtownCoreV3StageFingerprint({
        ...SHARED,
        profile: { ...MIDTOWN_CORE_V3_WAVE_PROFILE, admissionEnvelope: envelope },
      }));
    }
    expect(prints.size).toBe(5);
  });

  it("moves for shared-uri delivery, which is what the four -t1 variants exist for", () => {
    const embedded = midtownCoreV3StageFingerprint({
      ...SHARED,
      profile: { ...LOWER_MANHATTAN_P1_WAVE_PROFILE, textureDelivery: "embedded" },
    });
    // `embedded` is the default, so naming it explicitly must not move anything.
    expect(embedded).toBe(midtownCoreV3StageFingerprint({ ...SHARED, profile: LOWER_MANHATTAN_P1_WAVE_PROFILE }));
    for (const variant of EXTERIOR_T1_VARIANTS) {
      expect(variant.waveProfile.textureDelivery).toBe("shared-uri");
      // A -t1 fingerprint deliberately DIFFERS from its -p1 predecessor's now.
      // Their receipts live in gitignored work roots; no committed record pins
      // one, and a receipt that could not see the delivery was the defect.
      expect(midtownCoreV3StageFingerprint({ ...SHARED, profile: variant.waveProfile }))
        .not.toBe(midtownCoreV3StageFingerprint({
          ...SHARED,
          profile: { ...variant.waveProfile, textureDelivery: "embedded" },
        }));
    }
  });

  /**
   * (T004 F5a) THE LOD-1 POLICY, on the same conditional-spread precedent.
   *
   * `measured-fallback` changes WHAT BYTES LOD 1 carries for the buildings whose
   * measured deviation exceeds the cap, so a receipt taken under one policy must
   * not satisfy a stage running the other. And naming the shipped default
   * explicitly must move nothing, or every frozen wave's fingerprint would
   * depend on whether somebody had written the field down — the same defect the
   * effective-envelope normalization exists to prevent.
   */
  it("moves for measured-fallback and stays put when the default is named explicitly", () => {
    const base = midtownCoreV3StageFingerprint({ ...SHARED, profile: MIDTOWN_CORE_V3_WAVE_PROFILE });
    expect(midtownCoreV3StageFingerprint({
      ...SHARED,
      profile: { ...MIDTOWN_CORE_V3_WAVE_PROFILE, lod1Policy: "shed-protrusions" },
    })).toBe(base);
    expect(midtownCoreV3StageFingerprint({
      ...SHARED,
      profile: { ...MIDTOWN_CORE_V3_WAVE_PROFILE, lod1Policy: "measured-fallback" },
    })).not.toBe(base);
  });

  /**
   * And the pin that matters: the fallback fingerprint is a LITERAL, so the day
   * a successor wave's receipts are written under it, "the policy is visible"
   * is a checkable statement about a specific value rather than an inequality
   * that would pass just as happily if both sides had moved.
   */
  it("pins the measured-fallback fingerprint to a literal", () => {
    expect(midtownCoreV3StageFingerprint({
      ...SHARED,
      profile: { ...MIDTOWN_CORE_V3_WAVE_PROFILE, lod1Policy: "measured-fallback" },
    })).toBe("8e118580af7b0d09656c01364bdac4e6363cf3cb2695af5e8ee6c4873ff5b685");
  });
});
