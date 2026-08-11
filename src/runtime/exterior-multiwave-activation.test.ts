import { describe, expect, it } from "vitest";
import {
  EXTERIOR_DEFAULT_ACTIVATION,
  EXTERIOR_DEFAULT_ACTIVATIONS,
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
const ROLLED_BACK: ExteriorDefaultActivationRecord = PROMOTED ? PROMOTED.predecessor : EXTERIOR_DEFAULT_ACTIVATION;

/** A second, independent wave, used only to prove the per-wave rules. */
const SECOND_WAVE: ExteriorDefaultActivationRecord = {
  enabled: true,
  releaseId: "test-second-exterior-wave",
  snapshotId: "snapshot:test-second-exterior-wave:v1",
  snapshotChecksumSha256: "1".repeat(64),
  assemblyPackageIds: ["test-second-assembly"],
  membership: {
    cells: [{ cellId: "cell:test:second", cellReleaseId: "cell-release:test-second-exterior-wave:v1", checksumSha256: "2".repeat(64) }],
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

describe("the promoted set is exactly today's single record", () => {
  it("orders one wave, and orders the record the build actually exports", () => {
    expect(EXTERIOR_DEFAULT_ACTIVATIONS).toHaveLength(1);
    expect(EXTERIOR_DEFAULT_ACTIVATIONS[0]).toBe(EXTERIOR_DEFAULT_ACTIVATION);
    // Composition, not a second copy: a build that swapped the record orders the
    // swapped record rather than a stale duplicate of the promoted one.
    expect(exteriorDefaultActivations(ROLLED_BACK)).toEqual([ROLLED_BACK]);
  });

  it("keeps the partial-rollback impossibility PER RECORD", () => {
    for (const record of EXTERIOR_DEFAULT_ACTIVATIONS) {
      if (!record.enabled) {
        // A disabled record carries no pin, no membership, and no release at all.
        expect(record.releaseId).toBeNull();
        continue;
      }
      // The whole disabled state is the rollback target: there is no way to keep
      // the pin while dropping the default, or the membership while keeping both.
      expect(record.predecessor).toEqual({ enabled: false, releaseId: null, rolledBackReleaseId: record.releaseId });
      expect(record.membership.cells.length).toBeGreaterThan(0);
      expect(record.membership.buildingIds.length).toBeGreaterThan(0);
    }
  });
});

describe("behaviour neutrality of the set resolution over one record", () => {
  it("resolves byte-equal to the single-record resolver across the whole URL matrix", () => {
    for (const input of matrix()) {
      const single = resolveExteriorActivation({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, record: EXTERIOR_DEFAULT_ACTIVATION });
      const set = resolveExteriorActivationSet({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, records: EXTERIOR_DEFAULT_ACTIVATIONS });
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
        set: resolveExteriorActivationSet({ ...input, fallbackReleaseId: FIXTURE_RELEASE_ID, records: EXTERIOR_DEFAULT_ACTIVATIONS }),
        override: input.override,
        activeRealBaseReleaseId: input.activeRealBaseReleaseId,
        explicitReleaseId: input.explicitReleaseId,
      });
      expect(statements, JSON.stringify(input)).toEqual(statement === null ? [] : [statement]);
    }
  });

  it("keeps the refusal, restore, and verification rules identical for one record", () => {
    for (const explicitReleaseId of EXPLICIT) {
      expect(exteriorRolledBackReleaseNotice(explicitReleaseId, EXTERIOR_DEFAULT_ACTIVATIONS))
        .toBe(exteriorRolledBackReleaseNotice(explicitReleaseId, EXTERIOR_DEFAULT_ACTIVATION));
      expect(exteriorRolledBackReleaseNotice(explicitReleaseId, [ROLLED_BACK]))
        .toBe(exteriorRolledBackReleaseNotice(explicitReleaseId, ROLLED_BACK));
    }
    for (const targetReleaseId of [PROMOTED!.releaseId, FIXTURE_RELEASE_ID]) {
      for (const activeRealBaseReleaseId of BASES) {
        expect(restoresPromotedDefault({ targetReleaseId, activeRealBaseReleaseId, record: EXTERIOR_DEFAULT_ACTIVATIONS }))
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
    }, EXTERIOR_DEFAULT_ACTIVATIONS[0]!)).toEqual({ ok: true });
    expect(verifyPromotedExteriorMembership(PROMOTED!.membership.buildingIds, EXTERIOR_DEFAULT_ACTIVATIONS[0]!)).toEqual({ ok: true });
    // The membership failure now names the release instead of hard-coding a
    // block, so a second wave's failure cannot read as the first wave's.
    const failure = verifyPromotedExteriorMembership(["doitt:999999"], EXTERIOR_DEFAULT_ACTIVATIONS[0]!);
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
