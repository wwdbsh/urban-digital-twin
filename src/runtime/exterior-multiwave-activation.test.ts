import { describe, expect, it } from "vitest";
import {
  CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION,
  EXTERIOR_DEFAULT_ACTIVATION,
  EXTERIOR_DEFAULT_ACTIVATIONS,
  LOWER_MANHATTAN_EXTERIOR_ACTIVATION,
  MIDTOWN_CORE_EXTERIOR_ACTIVATION,
  SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION,
  exteriorDefaultActivations,
  exteriorRolledBackReleaseNotice,
  exteriorUnavailableDetail,
  exteriorUnavailableStatements,
  resolveExteriorActivation,
  resolveExteriorActivationSet,
  restoresPromotedDefault,
  verifyPromotedExteriorMembership,
  verifyPromotedExteriorPin,
  type ExteriorDefaultActivationRecord,
  type ExteriorStreamingOverride,
} from "./exterior-default-activation";

const FIXTURE_RELEASE_ID = "udt-fixture-exterior-cells";
const CITYWIDE_BASE = "manhattan-citywide-20260804";
const PROMOTED = EXTERIOR_DEFAULT_ACTIVATION.enabled ? EXTERIOR_DEFAULT_ACTIVATION : null;
/**
 * A wave withdrawn all the way to BASE.
 *
 * Block 835's own predecessor is no longer this shape — on its second promotion
 * the previous verified representation is the V2 release, not base massing — but
 * the base-only withdrawal is still representable and is still what the per-wave
 * rules below need: they prove that ONE wave going dark leaves the others
 * streaming, and base is the strongest form of "gone" to prove that against.
 */
const ROLLED_BACK: ExteriorDefaultActivationRecord = { enabled: false, releaseId: null, rolledBackReleaseId: PROMOTED ? PROMOTED.releaseId : null };
/** The rollback this build actually ships: back to the previous verified release. */
const ROLLED_BACK_TO_PREDECESSOR: ExteriorDefaultActivationRecord = PROMOTED ? PROMOTED.predecessor : EXTERIOR_DEFAULT_ACTIVATION;
const MIDTOWN = MIDTOWN_CORE_EXTERIOR_ACTIVATION.enabled ? MIDTOWN_CORE_EXTERIOR_ACTIVATION : null;
/**
 * The Midtown rollback this build actually ships.
 *
 * Since the P3 V3 repromotion this is an ENABLED predecessor — the V2 wave
 * release — not base massing, for the same reason Block 835's is: Midtown's
 * previous verified representation is a release nobody withdrew, and rolling
 * back to base would discard 160 buildings of verified geometry to withdraw a
 * grammar change.
 */
const MIDTOWN_ROLLED_BACK: ExteriorDefaultActivationRecord = MIDTOWN ? MIDTOWN.predecessor : MIDTOWN_CORE_EXTERIOR_ACTIVATION;
const MIDTOWN_V3_RELEASE_ID = "manhattan-midtown-core-cells-20260811-v3";
const MIDTOWN_V2_RELEASE_ID = "manhattan-midtown-core-cells-20260811";
/** A Midtown withdrawal all the way to base, kept representable and tested. */
const ROLLED_BACK_MIDTOWN_TO_BASE: ExteriorDefaultActivationRecord = { enabled: false, releaseId: null, rolledBackReleaseId: MIDTOWN ? MIDTOWN.releaseId : null };
const LOWER_MANHATTAN = LOWER_MANHATTAN_EXTERIOR_ACTIVATION.enabled ? LOWER_MANHATTAN_EXTERIOR_ACTIVATION : null;
const LOWER_MANHATTAN_P1_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812-p1";
const LOWER_MANHATTAN_CANARY_RELEASE_ID = "manhattan-lower-manhattan-cells-20260812";
/**
 * The Lower-Manhattan rollback this build actually ships: back to BASE MASSING.
 *
 * Unlike the other two waves, whose predecessors are enabled records because
 * each has a previously promoted release, wave w02 has never been promoted in
 * any form. Its only other release is the T015 canary, which was pinned but
 * never a default. So the disabled predecessor is not a degenerate shape kept
 * for testing here — it is what this wave genuinely rolls back to.
 */
const LOWER_MANHATTAN_ROLLED_BACK: ExteriorDefaultActivationRecord = LOWER_MANHATTAN ? LOWER_MANHATTAN.predecessor : LOWER_MANHATTAN_EXTERIOR_ACTIVATION;
const SOUTHERN_REMAINDER = SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION.enabled ? SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION : null;
const SOUTHERN_REMAINDER_P1_RELEASE_ID = "manhattan-southern-remainder-cells-20260812-p1";
const SOUTHERN_REMAINDER_CANARY_RELEASE_ID = "manhattan-southern-remainder-cells-20260812";
/**
 * The Southern-remainder rollback this build ships: back to BASE MASSING.
 *
 * Same shape and same reason as Lower-Manhattan's. Wave w03 has never been
 * promoted in any form — its only other release is the T017 canary, pinned but
 * never a default — so the disabled predecessor is what this wave genuinely
 * rolls back to rather than a degenerate shape kept for testing.
 */
const SOUTHERN_REMAINDER_ROLLED_BACK: ExteriorDefaultActivationRecord = SOUTHERN_REMAINDER ? SOUTHERN_REMAINDER.predecessor : SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION;
const CENTRAL_UPPER_MANHATTAN = CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION.enabled ? CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION : null;
const CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812-p1";
const CENTRAL_UPPER_MANHATTAN_CANARY_RELEASE_ID = "manhattan-central-upper-manhattan-cells-20260812";
/**
 * The Central-and-upper-Manhattan rollback this build ships: back to BASE
 * MASSING.
 *
 * Same shape and same reason as Lower-Manhattan's and Southern-remainder's.
 * Wave w04 has never been promoted in any form — its only other release is the
 * T019 canary, pinned but never a default — so the disabled predecessor is what
 * this wave genuinely rolls back to rather than a degenerate shape kept for
 * testing.
 */
const CENTRAL_UPPER_MANHATTAN_ROLLED_BACK: ExteriorDefaultActivationRecord = CENTRAL_UPPER_MANHATTAN ? CENTRAL_UPPER_MANHATTAN.predecessor : CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION;

/** A second, independent wave, used only to prove the per-wave rules. */
const SECOND_WAVE: ExteriorDefaultActivationRecord = {
  enabled: true,
  releaseId: "test-second-exterior-wave",
  snapshotId: "snapshot:test-second-exterior-wave:v1",
  snapshotChecksumSha256: "1".repeat(64),
  assemblyPackageIds: ["test-second-assembly"],
  membership: {
    cells: [{ cellId: "cell:test:second", cellReleaseId: "cell-release:test-second-exterior-wave:v1", checksumSha256: "2".repeat(64) }],
    cellsDigestSha256: null,
    cellCount: 1,
    buildingIds: ["doitt:111111"],
  },
  approvalRef: "test-only record",
  predecessor: { enabled: false, releaseId: null, rolledBackReleaseId: "test-second-exterior-wave" },
};

const OVERRIDES: readonly ExteriorStreamingOverride[] = [null, "on", "off", "off-unpinned"];
const EXPLICIT: readonly (string | null)[] = [null, FIXTURE_RELEASE_ID, PROMOTED?.releaseId ?? FIXTURE_RELEASE_ID, "unknown-release"];
const BASES: readonly (string | null)[] = [CITYWIDE_BASE, null];

/** Every URL/toggle state the app can actually reach, plus the unreachable ones. */
function matrix(): { override: ExteriorStreamingOverride; explicitReleaseId: string | null; activeRealBaseReleaseId: string | null }[] {
  return OVERRIDES.flatMap((override) => EXPLICIT.flatMap((explicitReleaseId) => BASES.map((activeRealBaseReleaseId) => ({ override, explicitReleaseId, activeRealBaseReleaseId }))));
}

describe("the promoted set", () => {
  it("orders Block 835, Midtown-core, Lower-Manhattan, Southern-remainder, then Central-and-upper-Manhattan, from the records the build exports", () => {
    expect(EXTERIOR_DEFAULT_ACTIVATIONS).toHaveLength(5);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[0]).toBe(EXTERIOR_DEFAULT_ACTIVATION);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[1]).toBe(MIDTOWN_CORE_EXTERIOR_ACTIVATION);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[2]).toBe(LOWER_MANHATTAN_EXTERIOR_ACTIVATION);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[3]).toBe(SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[4]).toBe(CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION);
    // Composition, not a second copy: a build that swapped a record orders the
    // swapped record rather than a stale duplicate of the promoted one. Each
    // parameter is independent, which is what makes a per-wave rollback one edit.
    expect(exteriorDefaultActivations(ROLLED_BACK)).toEqual([ROLLED_BACK, MIDTOWN_CORE_EXTERIOR_ACTIVATION, LOWER_MANHATTAN_EXTERIOR_ACTIVATION, SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION, CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION]);
    expect(exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_ROLLED_BACK)).toEqual([EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_ROLLED_BACK, LOWER_MANHATTAN_EXTERIOR_ACTIVATION, SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION, CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION]);
    expect(exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION, LOWER_MANHATTAN_ROLLED_BACK))
      .toEqual([EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION, LOWER_MANHATTAN_ROLLED_BACK, SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION, CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION]);
    expect(exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION, LOWER_MANHATTAN_EXTERIOR_ACTIVATION, SOUTHERN_REMAINDER_ROLLED_BACK))
      .toEqual([EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION, LOWER_MANHATTAN_EXTERIOR_ACTIVATION, SOUTHERN_REMAINDER_ROLLED_BACK, CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION]);
    expect(exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION, LOWER_MANHATTAN_EXTERIOR_ACTIVATION, SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION, CENTRAL_UPPER_MANHATTAN_ROLLED_BACK))
      .toEqual([EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION, LOWER_MANHATTAN_EXTERIOR_ACTIVATION, SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION, CENTRAL_UPPER_MANHATTAN_ROLLED_BACK]);
  });

  /**
   * A withdrawal and a promotion of the same release cannot coexist in one set.
   *
   * `resolveExteriorActivationSet` states a PRECEDENCE for this — a record that
   * publishes X governs X ahead of a record that withdrew X — and that precedence
   * exists so the resolution stays deterministic if it ever happened. It is not a
   * licence for it to happen: a build where one wave withdrew a release another
   * wave is actively serving would refuse promotion-era links into bytes it is
   * simultaneously rendering, and no reader of the records could tell which
   * statement was the intended one. The precedence keeps the resolver total; this
   * invariant keeps the SET honest, and the two are different jobs.
   */
  it("never lets one record withdraw a release another enabled record publishes", () => {
    const published = new Map<string, number>();
    EXTERIOR_DEFAULT_ACTIVATIONS.forEach((record, index) => {
      if (record.enabled) published.set(record.releaseId, index);
    });
    const collisions: string[] = [];
    EXTERIOR_DEFAULT_ACTIVATIONS.forEach((record, index) => {
      const withdrawn = record.rolledBackReleaseId ?? null;
      if (withdrawn === null) return;
      const publisher = published.get(withdrawn);
      if (publisher !== undefined) collisions.push(`record ${index} withdrew ${withdrawn}, which record ${publisher} publishes`);
      // A record may never withdraw its OWN release either, which the
      // per-record suite pins; restated at set level so one loop covers both.
      if (record.enabled && withdrawn === record.releaseId) collisions.push(`record ${index} withdrew its own release ${withdrawn}`);
    });
    expect(collisions).toEqual([]);

    // The invariant is checkable rather than vacuous: a set that DOES collide is
    // detected by the same loop.
    const colliding = [
      EXTERIOR_DEFAULT_ACTIVATION,
      { enabled: false as const, releaseId: null, rolledBackReleaseId: "manhattan-exterior-cells-20260811-v3" },
    ];
    const publishedIds = new Set(colliding.filter((record) => record.enabled).map((record) => record.releaseId));
    expect(colliding.some((record) => record.rolledBackReleaseId !== null && record.rolledBackReleaseId !== undefined && publishedIds.has(record.rolledBackReleaseId))).toBe(true);
  });

  it("promotes disjoint cell ids, so no wave can claim another wave's cell", () => {
    // Resolves the multi-wave collision risk directly: the scene diffs owned
    // collections by cell id, so two waves sharing one would merge into a
    // single collection and one wave's geometry would replace the other's.
    const seen = new Map<string, string>();
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) continue;
      for (const cell of record.membership.cells) {
        expect(seen.has(cell.cellId), `${cell.cellId} is claimed twice`).toBe(false);
        seen.set(cell.cellId, record.releaseId);
      }
    }
    // Block 835 states its cells literally; Midtown states a digest, so the
    // disjointness of the wave with 149 cells is asserted against the release
    // graph it was digested from in exterior-midtown-promotion-record.test.ts.
    expect([...seen.keys()]).toEqual(["cell:manhattan:block-835"]);
  });

  it("states each wave's accepted cells in exactly one form", () => {
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) continue;
      if (record.membership.cellsDigestSha256 === null) {
        expect(record.membership.cells.length, record.releaseId).toBe(record.membership.cellCount);
        expect(record.membership.cells.length).toBeGreaterThan(0);
      } else {
        // The unused form is empty, so nothing can be read as an accepted cell
        // list that the gate is not actually comparing against.
        expect(record.membership.cells, record.releaseId).toEqual([]);
        expect(record.membership.cellCount).toBeGreaterThan(0);
        expect(record.membership.cellsDigestSha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it("keeps the partial-rollback impossibility PER RECORD", () => {
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) {
        // A disabled record carries no pin, no membership, and no release at all.
        expect(record.releaseId).toBeNull();
        continue;
      }
      // The whole PREVIOUS RECORD is the rollback target: there is no way to keep
      // the pin while dropping the default, or the membership while keeping both.
      // The predecessor may be base-only (a first promotion) or the previous
      // verified release (a repromotion); either way it is one indivisible record
      // and it names the release this record's withdrawal would refuse.
      if (record.predecessor.enabled) {
        expect(record.predecessor.rolledBackReleaseId).toBe(record.releaseId);
        expect(record.predecessor.releaseId).not.toBe(record.releaseId);
        expect(record.predecessor.membership.cellCount).toBeGreaterThan(0);
      } else {
        expect(record.predecessor).toEqual({ enabled: false, releaseId: null, rolledBackReleaseId: record.releaseId });
      }
      // Membership is stated, in whichever form the wave uses; a record that
      // stated neither would be a pin with no accepted contents behind it.
      expect(record.membership.cellCount).toBeGreaterThan(0);
      expect(record.membership.cells.length > 0 || record.membership.cellsDigestSha256 !== null).toBe(true);
      expect(record.membership.buildingIds.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The generalization itself stays provably neutral: over a ONE-record set the
 * set resolver must still be the single-record resolver, exactly. This is what
 * made the multi-wave change safe to land ahead of the Midtown record, and it
 * keeps holding now that a second record exists.
 */
describe("behaviour neutrality of the set resolution over one record", () => {
  const ONE_RECORD = [EXTERIOR_DEFAULT_ACTIVATION];
  it("resolves byte-equal to the single-record resolver across the whole URL matrix", () => {
    for (const input of matrix()) {
      const single = resolveExteriorActivation({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, record: EXTERIOR_DEFAULT_ACTIVATION });
      const set = resolveExteriorActivationSet({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, records: ONE_RECORD });
      expect(set.releases, JSON.stringify(input)).toEqual([{ ...single, record: EXTERIOR_DEFAULT_ACTIVATION }]);
      // What the app reads: the streaming verdict and the release the URL writes.
      expect(set.streaming, JSON.stringify(input)).toBe(single.streaming);
      expect(set.primaryReleaseId, JSON.stringify(input)).toBe(single.releaseId);
      expect(set.targets.map((target) => target.releaseId)).toEqual(single.streaming ? [single.releaseId] : []);
    }
  });

  it("produces the same unavailable statement the single-record rule produced", () => {
    for (const input of matrix()) {
      const single = resolveExteriorActivation({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, record: EXTERIOR_DEFAULT_ACTIVATION });
      const statement = exteriorUnavailableDetail({
        streaming: single.streaming,
        override: input.override,
        activeRealBaseReleaseId: input.activeRealBaseReleaseId,
        explicitReleaseId: input.explicitReleaseId,
        record: EXTERIOR_DEFAULT_ACTIVATION,
      });
      const statements = exteriorUnavailableStatements({
        set: resolveExteriorActivationSet({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, records: ONE_RECORD }),
        override: input.override,
        activeRealBaseReleaseId: input.activeRealBaseReleaseId,
        explicitReleaseId: input.explicitReleaseId,
      });
      expect(statements, JSON.stringify(input)).toEqual(statement === null ? [] : [statement]);
    }
  });

  it("keeps the refusal, restore, and verification rules identical for one record", () => {
    for (const explicitReleaseId of EXPLICIT) {
      expect(exteriorRolledBackReleaseNotice(explicitReleaseId, ONE_RECORD))
        .toBe(exteriorRolledBackReleaseNotice(explicitReleaseId, EXTERIOR_DEFAULT_ACTIVATION));
      expect(exteriorRolledBackReleaseNotice(explicitReleaseId, [ROLLED_BACK]))
        .toBe(exteriorRolledBackReleaseNotice(explicitReleaseId, ROLLED_BACK));
    }
    for (const targetReleaseId of [PROMOTED!.releaseId, FIXTURE_RELEASE_ID]) {
      for (const activeRealBaseReleaseId of BASES) {
        expect(restoresPromotedDefault({ targetReleaseId, activeRealBaseReleaseId, record: ONE_RECORD }))
          .toBe(restoresPromotedDefault({ targetReleaseId, activeRealBaseReleaseId, record: EXTERIOR_DEFAULT_ACTIVATION }));
      }
    }
    // The gates still accept exactly the committed record and nothing else.
    expect(verifyPromotedExteriorPin({
      releaseId: PROMOTED!.releaseId,
      snapshotId: PROMOTED!.snapshotId,
      snapshotChecksumSha256: PROMOTED!.snapshotChecksumSha256,
      assemblyPackageIds: [...PROMOTED!.assemblyPackageIds],
      cells: PROMOTED!.membership.cells.map((cell) => ({ ...cell })),
    }, EXTERIOR_DEFAULT_ACTIVATION)).toEqual({ ok: true });
    expect(verifyPromotedExteriorMembership(PROMOTED!.membership.buildingIds, EXTERIOR_DEFAULT_ACTIVATION)).toEqual({ ok: true });
    // The membership failure now names the release instead of hard-coding a
    // block, so a second wave's failure cannot read as the first wave's.
    const failure = verifyPromotedExteriorMembership(["doitt:999999"], EXTERIOR_DEFAULT_ACTIVATION);
    expect(failure.ok).toBe(false);
    expect(failure.ok === false && failure.message).toContain(PROMOTED!.releaseId);
  });
});

describe("per-wave rules once more than one wave is promoted", () => {
  const both = [EXTERIOR_DEFAULT_ACTIVATION, SECOND_WAVE] as const;
  const base = { fallbackReleaseId: FIXTURE_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE } as const;

  it("streams every promoted wave by default over a real base", () => {
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, records: [...both] });
    expect(set.targets.map((target) => target.releaseId)).toEqual([PROMOTED!.releaseId, SECOND_WAVE.releaseId]);
    expect(set.targets.every((target) => target.promotedDefault)).toBe(true);
  });

  it("disables ALL default waves on the explicit off sentinel", () => {
    for (const override of ["off", "off-unpinned"] as const) {
      const set = resolveExteriorActivationSet({ ...base, override, explicitReleaseId: null, records: [...both] });
      expect(set.streaming).toBe(false);
      expect(set.targets).toEqual([]);
    }
  });

  it("treats exteriorCells=X as exactly release X and nothing else", () => {
    const set = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: SECOND_WAVE.releaseId, records: [...both] });
    expect(set.targets.map((target) => target.releaseId)).toEqual([SECOND_WAVE.releaseId]);
    // Explicit intent REPLACES the default set: the other promoted wave is not
    // added behind the link's back.
    expect(set.releases.map((entry) => entry.releaseId)).toEqual([SECOND_WAVE.releaseId]);
    // ...and naming the promoted wave still carries that wave's gates.
    expect(set.targets[0]!.promotedDefault).toBe(true);
    expect(set.targets[0]!.record).toBe(SECOND_WAVE);
  });

  it("refuses one rolled-back wave's opt-in while the other waves keep streaming", () => {
    const partiallyRolledBack = [ROLLED_BACK, SECOND_WAVE];
    // The withdrawn wave's own bookmark fails closed...
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: PROMOTED!.releaseId, records: partiallyRolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(PROMOTED!.releaseId, partiallyRolledBack)).toContain(`${PROMOTED!.releaseId} was rolled back in this build`);
    // ...while the surviving wave still streams by default, and its own opt-in
    // link is untouched by the other wave's withdrawal.
    const surviving = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, records: partiallyRolledBack });
    expect(surviving.targets.map((target) => target.releaseId)).toEqual([SECOND_WAVE.releaseId]);
    expect(exteriorRolledBackReleaseNotice(SECOND_WAVE.releaseId, partiallyRolledBack)).toBeNull();
    expect(restoresPromotedDefault({ targetReleaseId: SECOND_WAVE.releaseId, activeRealBaseReleaseId: CITYWIDE_BASE, record: partiallyRolledBack })).toBe(true);
    expect(restoresPromotedDefault({ targetReleaseId: PROMOTED!.releaseId, activeRealBaseReleaseId: CITYWIDE_BASE, record: partiallyRolledBack })).toBe(false);
  });

  it("names WHICH wave is unavailable, and says the session-wide reasons once", () => {
    const partiallyRolledBack = [ROLLED_BACK, SECOND_WAVE];
    const statements = exteriorUnavailableStatements({
      set: resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, records: partiallyRolledBack }),
      override: null,
      activeRealBaseReleaseId: CITYWIDE_BASE,
      explicitReleaseId: null,
    });
    // The withdrawn wave is named; the streaming wave says nothing.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(PROMOTED!.releaseId);
    expect(statements[0]).toContain("not active in this build");

    // "You switched exteriors off" is true of every wave at once, so it is said
    // once rather than repeated per promotion record.
    const off = exteriorUnavailableStatements({
      set: resolveExteriorActivationSet({ ...base, override: "off", explicitReleaseId: null, records: [...both] }),
      override: "off",
      activeRealBaseReleaseId: CITYWIDE_BASE,
      explicitReleaseId: null,
    });
    expect(off).toHaveLength(1);
    expect(off[0]).toContain("switched off for this session");
  });

  it("loads one runtime, not one per record, when no wave can promote", () => {
    // Fixture mode with an explicit enable: every record resolves the same
    // fallback release, and the target list must not ask for it twice.
    const set = resolveExteriorActivationSet({ fallbackReleaseId: FIXTURE_RELEASE_ID, activeRealBaseReleaseId: null, override: "on", explicitReleaseId: null, records: [...both] });
    expect(set.targets.map((target) => target.releaseId)).toEqual([FIXTURE_RELEASE_ID]);
  });
});

describe("the promoted set as this build actually ships it", () => {
  const base = { fallbackReleaseId: FIXTURE_RELEASE_ID } as const;

  it("stays completely quiet in a fixture-mode session, with five records promoted", () => {
    // No base identity to anchor exterior cells to, so neither wave attempts a
    // load and neither complains about not loading. Promoting a second wave
    // must not turn a fixture session into a failing one.
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: null });
    expect(set.streaming).toBe(false);
    expect(set.targets).toEqual([]);
    expect(set.releases.map((entry) => entry.reason)).toEqual(["no-real-base", "no-real-base", "no-real-base", "no-real-base", "no-real-base"]);
    expect(exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: null, explicitReleaseId: null })).toEqual([]);
  });

  it("streams all five promoted waves over a real base, each gated by its own record", () => {
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811-v3",
      MIDTOWN_V3_RELEASE_ID,
      LOWER_MANHATTAN_P1_RELEASE_ID,
      SOUTHERN_REMAINDER_P1_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    ]);
    expect(set.targets.every((target) => target.promotedDefault)).toBe(true);
    expect(set.targets[0]!.record).toBe(EXTERIOR_DEFAULT_ACTIVATION);
    expect(set.targets[1]!.record).toBe(MIDTOWN_CORE_EXTERIOR_ACTIVATION);
    expect(set.targets[2]!.record).toBe(LOWER_MANHATTAN_EXTERIOR_ACTIVATION);
    expect(set.targets[3]!.record).toBe(SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION);
    expect(set.targets[4]!.record).toBe(CENTRAL_UPPER_MANHATTAN_EXTERIOR_ACTIVATION);
    // The URL still serialises nothing: a default-on session's links stay
    // reproducible against whatever the build promotes.
    expect(set.primaryReleaseId).toBe("manhattan-exterior-cells-20260811-v3");
  });

  it("narrows to exactly the named release, and off kills every wave", () => {
    for (const releaseId of ["manhattan-exterior-cells-20260811-v3", MIDTOWN_V3_RELEASE_ID, LOWER_MANHATTAN_P1_RELEASE_ID, SOUTHERN_REMAINDER_P1_RELEASE_ID, CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID]) {
      const set = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: releaseId, activeRealBaseReleaseId: CITYWIDE_BASE });
      expect(set.targets.map((target) => target.releaseId)).toEqual([releaseId]);
      expect(set.targets[0]!.promotedDefault).toBe(true);
    }
    const off = resolveExteriorActivationSet({ ...base, override: "off", explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(off.streaming).toBe(false);
    expect(off.releases.map((entry) => entry.streaming)).toEqual([false, false, false, false, false]);
  });

  it("re-enabling from off returns to the FULL default set, pinning nothing", () => {
    // The toggle asks whether the release it would re-pin is a promoted one; if
    // it is, it clears the override entirely rather than pinning that release,
    // which under the exteriorCells rule would have narrowed a five-wave
    // session down to one wave every time a user pressed Disable and then Enable.
    const off = resolveExteriorActivationSet({ ...base, override: "off", explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(restoresPromotedDefault({ targetReleaseId: off.primaryReleaseId, activeRealBaseReleaseId: CITYWIDE_BASE })).toBe(true);
    const restored = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(restored.targets).toHaveLength(5);
    // A genuinely explicit fixture session is NOT a promoted default, so it
    // keeps pinning its own release exactly as before.
    expect(restoresPromotedDefault({ targetReleaseId: FIXTURE_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE })).toBe(false);
  });

  it("rehearses the Block 835 V3 rollback and roll-forward with Midtown untouched", () => {
    const rolledBack = exteriorDefaultActivations(ROLLED_BACK_TO_PREDECESSOR, MIDTOWN_CORE_EXTERIOR_ACTIVATION);
    const back = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    // V2 renders again as the default, and Midtown is bit-for-bit the same wave
    // it was before the Block 835 swap: a repromotion of one wave says nothing
    // about another.
    expect(back.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811",
      MIDTOWN_V3_RELEASE_ID,
      LOWER_MANHATTAN_P1_RELEASE_ID,
      SOUTHERN_REMAINDER_P1_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    ]);
    expect(back.targets[1]!.record).toBe(MIDTOWN_CORE_EXTERIOR_ACTIVATION);
    expect(back.targets[2]!.record).toBe(LOWER_MANHATTAN_EXTERIOR_ACTIVATION);
    expect(back.targets[3]!.record).toBe(SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION);
    // The withdrawn V3 link fails closed, by name, and only for Block 835.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: "manhattan-exterior-cells-20260811-v3", activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_V3_RELEASE_ID, rolledBack)).toBeNull();
    // Forward again restores exactly the shipped set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811-v3",
      MIDTOWN_V3_RELEASE_ID,
      LOWER_MANHATTAN_P1_RELEASE_ID,
      SOUTHERN_REMAINDER_P1_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    ]);
  });

  it("rolls the Midtown V3 wave back to its V2 predecessor without withdrawing Block 835", () => {
    const midtownRolledBack = exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_ROLLED_BACK);
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: midtownRolledBack });
    // The rollback restores the previous VERIFIED release rather than going
    // dark: 160 V2 buildings keep rendering, and Block 835 V3 is untouched.
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811-v3",
      MIDTOWN_V2_RELEASE_ID,
      LOWER_MANHATTAN_P1_RELEASE_ID,
      SOUTHERN_REMAINDER_P1_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    ]);
    expect(set.streaming).toBe(true);
    // The withdrawn successor's own bookmark is refused, by its own record,
    // naming it — so the one-record swap is the whole rollback.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: MIDTOWN_V3_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: midtownRolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_V3_RELEASE_ID, midtownRolledBack))
      .toContain(`${MIDTOWN_V3_RELEASE_ID} was rolled back in this build`);
    // Block 835's link is untouched by the Midtown withdrawal, and so is the
    // restored V2 link.
    expect(exteriorRolledBackReleaseNotice("manhattan-exterior-cells-20260811-v3", midtownRolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_V2_RELEASE_ID, midtownRolledBack)).toBeNull();
    // Nothing is unavailable: both waves stream, one of them one version back.
    expect(exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null })).toEqual([]);
    // Forward again restores exactly the shipped set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811-v3",
      MIDTOWN_V3_RELEASE_ID,
      LOWER_MANHATTAN_P1_RELEASE_ID,
      SOUTHERN_REMAINDER_P1_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    ]);
  });

  it("rolls the Lower-Manhattan wave back to BASE MASSING without withdrawing the other four", () => {
    // The rollback rehearsal ADR 0034 promotion owes, run through the record's
    // own injection seam rather than by editing the module.
    const rolledBack = exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION, LOWER_MANHATTAN_ROLLED_BACK);
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    // Wave w02's area returns to base massing — there is no older w02 release to
    // fall back to — while Block 835 and Midtown-core keep streaming untouched.
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811-v3",
      MIDTOWN_V3_RELEASE_ID,
      SOUTHERN_REMAINDER_P1_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    ]);
    expect(set.streaming).toBe(true);
    expect(set.releases[2]!.streaming).toBe(false);
    expect(set.releases[2]!.reason).toBe("not-promoted");

    // The withdrawn opt-in link is refused BY NAME, in the same one-record swap.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: LOWER_MANHATTAN_P1_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_P1_RELEASE_ID, rolledBack))
      .toContain(`${LOWER_MANHATTAN_P1_RELEASE_ID} was rolled back in this build`);

    // The T015 CANARY is untouched by this rollback. It was never promoted, so
    // its opt-in link is not a promotion-era bookmark and stays honoured.
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_CANARY_RELEASE_ID, rolledBack)).toBeNull();
    // ...and so are the other two waves' links.
    expect(exteriorRolledBackReleaseNotice("manhattan-exterior-cells-20260811-v3", rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_V3_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_P1_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID, rolledBack)).toBeNull();

    // Exactly ONE statement, naming exactly this wave: the reader can tell which
    // area went back to base without guessing.
    const statements = exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(LOWER_MANHATTAN_P1_RELEASE_ID);
    expect(statements[0]).toContain("not active in this build");
    expect(statements[0]).toContain(`base massing from release ${CITYWIDE_BASE} is shown`);

    // Forward again restores exactly the shipped five-wave set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811-v3",
      MIDTOWN_V3_RELEASE_ID,
      LOWER_MANHATTAN_P1_RELEASE_ID,
      SOUTHERN_REMAINDER_P1_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    ]);
  });

  it("rolls the Southern-remainder wave back to BASE MASSING without withdrawing the other four", () => {
    // The rollback rehearsal ADR 0035's promotion owes, run through the record's
    // own injection seam rather than by editing the module.
    const rolledBack = exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION, MIDTOWN_CORE_EXTERIOR_ACTIVATION, LOWER_MANHATTAN_EXTERIOR_ACTIVATION, SOUTHERN_REMAINDER_ROLLED_BACK);
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    // Wave w03's area returns to base massing — there is no older w03 release to
    // fall back to — while the other four waves keep streaming untouched.
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811-v3",
      MIDTOWN_V3_RELEASE_ID,
      LOWER_MANHATTAN_P1_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    ]);
    expect(set.streaming).toBe(true);
    expect(set.releases[3]!.streaming).toBe(false);
    expect(set.releases[3]!.reason).toBe("not-promoted");

    // The withdrawn opt-in link is refused BY NAME, in the same one-record swap.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: SOUTHERN_REMAINDER_P1_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_P1_RELEASE_ID, rolledBack))
      .toContain(`${SOUTHERN_REMAINDER_P1_RELEASE_ID} was rolled back in this build`);

    // The T017 CANARY is untouched by this rollback. It was never promoted, so
    // its opt-in link is not a promotion-era bookmark and stays honoured.
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_CANARY_RELEASE_ID, rolledBack)).toBeNull();
    // ...and so are the other three waves' links.
    expect(exteriorRolledBackReleaseNotice("manhattan-exterior-cells-20260811-v3", rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_V3_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_P1_RELEASE_ID, rolledBack)).toBeNull();

    // Exactly ONE statement, naming exactly this wave.
    const statements = exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(SOUTHERN_REMAINDER_P1_RELEASE_ID);
    expect(statements[0]).toContain("not active in this build");
    expect(statements[0]).toContain(`base massing from release ${CITYWIDE_BASE} is shown`);

    // Forward again restores exactly the shipped five-wave set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811-v3",
      MIDTOWN_V3_RELEASE_ID,
      LOWER_MANHATTAN_P1_RELEASE_ID,
      SOUTHERN_REMAINDER_P1_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    ]);
  });

  it("rolls the Central-and-upper-Manhattan wave back to BASE MASSING without withdrawing the other four", () => {
    // The rollback rehearsal ADR 0036 precondition (e) owes, run through the
    // record's own injection seam rather than by editing the module. No URL
    // expresses a build-time record swap, so this — and not a browser journey —
    // is where the rehearsal can actually be performed.
    const rolledBack = exteriorDefaultActivations(
      EXTERIOR_DEFAULT_ACTIVATION,
      MIDTOWN_CORE_EXTERIOR_ACTIVATION,
      LOWER_MANHATTAN_EXTERIOR_ACTIVATION,
      SOUTHERN_REMAINDER_EXTERIOR_ACTIVATION,
      CENTRAL_UPPER_MANHATTAN_ROLLED_BACK,
    );
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    // Wave w04's area returns to base massing — there is no older w04 release to
    // fall back to — while the other four waves keep streaming untouched.
    expect(set.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811-v3",
      MIDTOWN_V3_RELEASE_ID,
      LOWER_MANHATTAN_P1_RELEASE_ID,
      SOUTHERN_REMAINDER_P1_RELEASE_ID,
    ]);
    expect(set.streaming).toBe(true);
    expect(set.releases[4]!.streaming).toBe(false);
    expect(set.releases[4]!.reason).toBe("not-promoted");

    // The withdrawn opt-in link is refused BY NAME, in the same one-record swap.
    const refused = resolveExteriorActivationSet({ ...base, override: "on", explicitReleaseId: CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE, records: rolledBack });
    expect(refused.streaming).toBe(false);
    expect(refused.releases[0]!.reason).toBe("rolled-back-release");
    expect(exteriorRolledBackReleaseNotice(CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID, rolledBack))
      .toContain(`${CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID} was rolled back in this build`);

    // The T019 CANARY is untouched by this rollback. It was never promoted, so
    // its opt-in link is not a promotion-era bookmark and stays honoured.
    expect(exteriorRolledBackReleaseNotice(CENTRAL_UPPER_MANHATTAN_CANARY_RELEASE_ID, rolledBack)).toBeNull();
    // ...and so are the other four waves' links.
    expect(exteriorRolledBackReleaseNotice("manhattan-exterior-cells-20260811-v3", rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(MIDTOWN_V3_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(LOWER_MANHATTAN_P1_RELEASE_ID, rolledBack)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(SOUTHERN_REMAINDER_P1_RELEASE_ID, rolledBack)).toBeNull();

    // Exactly ONE statement, naming exactly this wave.
    const statements = exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID);
    expect(statements[0]).toContain("not active in this build");
    expect(statements[0]).toContain(`base massing from release ${CITYWIDE_BASE} is shown`);

    // Forward again restores exactly the shipped five-wave set.
    const forward = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(forward.targets.map((target) => target.releaseId)).toEqual([
      "manhattan-exterior-cells-20260811-v3",
      MIDTOWN_V3_RELEASE_ID,
      LOWER_MANHATTAN_P1_RELEASE_ID,
      SOUTHERN_REMAINDER_P1_RELEASE_ID,
      CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID,
    ]);
  });

  it("still names WHICH wave is unavailable when one goes dark all the way to base", () => {
    // The base-only withdrawal is no longer what either shipped wave rolls back
    // to, but it stays representable and it is the case the per-wave notice text
    // exists for, so it keeps its own test rather than disappearing with the
    // shape change.
    const midtownDark = exteriorDefaultActivations(EXTERIOR_DEFAULT_ACTIVATION, ROLLED_BACK_MIDTOWN_TO_BASE);
    const set = resolveExteriorActivationSet({ ...base, override: null, explicitReleaseId: null, activeRealBaseReleaseId: CITYWIDE_BASE, records: midtownDark });
    expect(set.targets.map((target) => target.releaseId)).toEqual(["manhattan-exterior-cells-20260811-v3", LOWER_MANHATTAN_P1_RELEASE_ID, SOUTHERN_REMAINDER_P1_RELEASE_ID, CENTRAL_UPPER_MANHATTAN_P1_RELEASE_ID]);
    const statements = exteriorUnavailableStatements({ set, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: null });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(MIDTOWN_V3_RELEASE_ID);
    expect(statements[0]).toContain("not active in this build");
  });
});
