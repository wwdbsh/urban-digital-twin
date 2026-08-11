import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BLOCK835_V2_EXTERIOR_ACTIVATION,
  BLOCK835_V2_EXTERIOR_ROLLBACK,
  EXTERIOR_DEFAULT_ACTIVATION,
  exteriorRolledBackReleaseNotice,
  exteriorUnavailableDetail,
  resolveExteriorActivation,
  restoresPromotedDefault,
  verifyPromotedExteriorMembership,
  verifyPromotedExteriorPin,
  type ExteriorDefaultActivationRecord,
} from "./exterior-default-activation";

const FIXTURE_RELEASE_ID = "udt-fixture-exterior-cells";
const CITYWIDE_BASE = "manhattan-citywide-20260804";
const PROMOTED = EXTERIOR_DEFAULT_ACTIVATION.enabled ? EXTERIOR_DEFAULT_ACTIVATION : null;
/** The rehearsed rollback is exactly the record's own predecessor. */
const ROLLED_BACK: ExteriorDefaultActivationRecord = PROMOTED ? PROMOTED.predecessor : EXTERIOR_DEFAULT_ACTIVATION;
/** A build that never promoted anything has no withdrawn release to refuse. */
const NEVER_PROMOTED: ExteriorDefaultActivationRecord = { enabled: false, releaseId: null, rolledBackReleaseId: null };

/**
 * Read from the release the record actually names, not from a path spelled out
 * here. A drift test that hard-codes a directory stops testing the record the
 * moment the record is repromoted onto a successor release — it would keep
 * proving the OLD bytes were internally consistent while the build shipped new
 * ones. Deriving the path from `PROMOTED.releaseId` keeps the gate pointed at
 * whatever this build promoted, so it can never be skipped by a swap.
 */
function committed(fileName: string): Record<string, unknown> {
  if (!PROMOTED) throw new Error("This build is rolled back; there is no promoted release to read.");
  return JSON.parse(new TextDecoder().decode(readFileSync(`public/data/${PROMOTED.releaseId}/${fileName}`))) as Record<string, unknown>;
}

function resolved(overrides: Partial<Parameters<typeof verifyPromotedExteriorPin>[0]> = {}) {
  if (!PROMOTED) throw new Error("This build is rolled back; the promoted fixtures do not apply.");
  return {
    releaseId: PROMOTED.releaseId,
    snapshotId: PROMOTED.snapshotId,
    snapshotChecksumSha256: PROMOTED.snapshotChecksumSha256,
    assemblyPackageIds: [...PROMOTED.assemblyPackageIds],
    cells: PROMOTED.membership.cells.map((cell) => ({ ...cell })),
    ...overrides,
  };
}

describe("Block 835 exterior promotion record", () => {
  it("is one indivisible record whose rollback target is the previous VERIFIED representation", () => {
    expect(EXTERIOR_DEFAULT_ACTIVATION.enabled).toBe(true);
    expect(PROMOTED).not.toBeNull();
    expect(PROMOTED!.releaseId).toBe("manhattan-exterior-cells-20260811-v3");
    expect(PROMOTED!.approvalRef).toBe("Issue #44 gate approval 2026-08-11 (T026 V3 promotion)");
    // A partial rollback stays unrepresentable: the predecessor is one whole
    // record carrying its own release, pin and membership together, never a flag
    // that can be flipped beside a surviving pin.
    expect(PROMOTED!.predecessor).toBe(BLOCK835_V2_EXTERIOR_ROLLBACK);
    // On a SECOND promotion the previous verified representation is the wave one
    // version back, not base massing. Rolling back to base would discard
    // verified geometry that was never withdrawn.
    expect(ROLLED_BACK.enabled).toBe(true);
    expect(ROLLED_BACK.releaseId).toBe("manhattan-exterior-cells-20260811");
    // ...and the rollback withdraws the successor in the SAME record swap, so a
    // promotion-era opt-in link into it cannot keep rendering the withdrawn wave.
    expect(ROLLED_BACK.rolledBackReleaseId).toBe(PROMOTED!.releaseId);
    // A forward promotion withdraws nothing, and no record may ever refuse the
    // release it is simultaneously publishing.
    expect(PROMOTED!.rolledBackReleaseId ?? null).toBeNull();
    for (const record of [PROMOTED!, ROLLED_BACK, BLOCK835_V2_EXTERIOR_ACTIVATION]) {
      if (record.enabled) expect(record.rolledBackReleaseId ?? null).not.toBe(record.releaseId);
    }
  });

  it("keeps the V2 predecessor byte-identical to the release it names", () => {
    const index = JSON.parse(new TextDecoder().decode(readFileSync("public/data/manhattan-exterior-cells-20260811/index.json"))) as {
      releaseId: string;
      defaultHead: { snapshotId: string; checksumSha256: string; assemblyPackageIds: string[] };
    };
    expect(index.releaseId).toBe(BLOCK835_V2_EXTERIOR_ACTIVATION.releaseId);
    expect(index.defaultHead).toEqual({
      snapshotId: BLOCK835_V2_EXTERIOR_ACTIVATION.snapshotId,
      checksumSha256: BLOCK835_V2_EXTERIOR_ACTIVATION.snapshotChecksumSha256,
      assemblyPackageIds: [...BLOCK835_V2_EXTERIOR_ACTIVATION.assemblyPackageIds],
    });
    // The rollback target differs from the retained V2 record in exactly one
    // field, so "the V2 record verbatim, plus its withdrawal" is checkable.
    expect({ ...BLOCK835_V2_EXTERIOR_ROLLBACK, rolledBackReleaseId: null }).toEqual({ ...BLOCK835_V2_EXTERIOR_ACTIVATION, rolledBackReleaseId: null });
  });

  it("promotes without availability drift: the successor owns exactly V2's fourteen identities", () => {
    expect([...PROMOTED!.membership.buildingIds].sort()).toEqual([...BLOCK835_V2_EXTERIOR_ACTIVATION.membership.buildingIds].sort());
    expect(PROMOTED!.membership.cellCount).toBe(BLOCK835_V2_EXTERIOR_ACTIVATION.membership.cellCount);
  });

  it("pins the committed index defaultHead byte for byte", () => {
    const index = committed("index.json");
    expect(index.releaseId).toBe(PROMOTED!.releaseId);
    expect(index.defaultHead).toEqual({
      snapshotId: PROMOTED!.snapshotId,
      checksumSha256: PROMOTED!.snapshotChecksumSha256,
      assemblyPackageIds: [...PROMOTED!.assemblyPackageIds],
    });
  });

  it("records exactly the public cell membership and the 14 accepted building identities", () => {
    const graph = committed("release-graph.json") as {
      snapshots: { snapshotId: string; audience: string; cells: { cellId: string; cellReleaseId: string; checksumSha256: string }[] }[];
      cellReleases: { cellReleaseId: string; audience: string; buildingIds: string[] }[];
    };
    const snapshot = graph.snapshots.find((entry) => entry.snapshotId === PROMOTED!.snapshotId && entry.audience === "public");
    expect(snapshot).toBeDefined();
    expect(snapshot!.cells).toEqual(PROMOTED!.membership.cells.map((cell) => ({ ...cell })));

    const buildingIds = snapshot!.cells.flatMap((cell) => graph.cellReleases.find((entry) => entry.cellReleaseId === cell.cellReleaseId)?.buildingIds ?? []);
    expect(buildingIds).toHaveLength(14);
    expect([...buildingIds].sort()).toEqual([...PROMOTED!.membership.buildingIds].sort());
  });
});

describe("promoted exterior activation resolution", () => {
  const base = { explicitReleaseId: null, fallbackReleaseId: FIXTURE_RELEASE_ID } as const;

  it("activates the promoted release with no URL parameters once a real base is active", () => {
    expect(resolveExteriorActivation({ ...base, override: null, activeRealBaseReleaseId: CITYWIDE_BASE }))
      .toEqual({ streaming: true, releaseId: PROMOTED!.releaseId, promotedDefault: true, reason: "promoted-default" });
  });

  it("stays quiet in a fixture-mode default session instead of attempting a load it must fail", () => {
    expect(resolveExteriorActivation({ ...base, override: null, activeRealBaseReleaseId: null }))
      .toEqual({ streaming: false, releaseId: FIXTURE_RELEASE_ID, promotedDefault: false, reason: "no-real-base" });
  });

  it("honours the explicit disable sentinel over an active real base", () => {
    expect(resolveExteriorActivation({ ...base, override: "off", activeRealBaseReleaseId: CITYWIDE_BASE }))
      .toMatchObject({ streaming: false, promotedDefault: false, reason: "url-disabled" });
  });

  it("targets the promoted release when a disabled real-base session is switched back on", () => {
    // Reverses the pre-promotion expectation: enabling with no explicit release
    // over a real base used to resolve the synthetic fixture package.
    expect(resolveExteriorActivation({ ...base, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE }))
      .toEqual({ streaming: true, releaseId: PROMOTED!.releaseId, promotedDefault: true, reason: "url-explicit" });
    // ...but a fixture-mode session still enables the fixture package.
    expect(resolveExteriorActivation({ ...base, override: "on", activeRealBaseReleaseId: null }))
      .toEqual({ streaming: true, releaseId: FIXTURE_RELEASE_ID, promotedDefault: false, reason: "url-explicit" });
  });

  it("keeps an explicit URL release exactly as it behaved before the promotion", () => {
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: FIXTURE_RELEASE_ID, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE }))
      .toEqual({ streaming: true, releaseId: FIXTURE_RELEASE_ID, promotedDefault: false, reason: "url-explicit" });
    // A link naming a DIFFERENT release is never verified as the promoted wave:
    // borrowing the promotion's acceptance for other bytes would be a false claim.
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: FIXTURE_RELEASE_ID, override: "on", activeRealBaseReleaseId: null }).promotedDefault).toBe(false);
    // A link naming the promoted release IS the promoted wave, so it carries the
    // promotion's gates rather than escaping them by being explicit.
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: PROMOTED!.releaseId, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE }).promotedDefault).toBe(true);
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: PROMOTED!.releaseId, override: "on", activeRealBaseReleaseId: null }).promotedDefault).toBe(true);
  });

  it("names an explicit release with no on/off override accurately instead of calling it the promoted default", () => {
    // Not reachable from URL parsing, where a named release always implies "on".
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: FIXTURE_RELEASE_ID, override: null, activeRealBaseReleaseId: CITYWIDE_BASE }))
      .toEqual({ streaming: true, releaseId: FIXTURE_RELEASE_ID, promotedDefault: false, reason: "explicit-release" });
  });

  it("distinguishes a parse that failed closed on an unpinned release from a session someone switched off", () => {
    expect(resolveExteriorActivation({ ...base, override: "off-unpinned", activeRealBaseReleaseId: CITYWIDE_BASE }))
      .toEqual({ streaming: false, releaseId: PROMOTED!.releaseId, promotedDefault: false, reason: "url-unpinned-release" });
    const statement = exteriorUnavailableDetail({ streaming: false, override: "off-unpinned", activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(statement).toContain("not pinned by this build");
    expect(statement).not.toContain("switched off for this session");
    expect(statement).toContain("no substitute exterior was selected");
  });

  it("returns to the gated promoted default when a real-base session re-enables, and pins nothing otherwise", () => {
    expect(restoresPromotedDefault({ targetReleaseId: PROMOTED!.releaseId, activeRealBaseReleaseId: CITYWIDE_BASE })).toBe(true);
    // Fixture mode has no base to anchor to, and a different release is a
    // genuine opt-in that must stay pinned in the link.
    expect(restoresPromotedDefault({ targetReleaseId: PROMOTED!.releaseId, activeRealBaseReleaseId: null })).toBe(false);
    expect(restoresPromotedDefault({ targetReleaseId: FIXTURE_RELEASE_ID, activeRealBaseReleaseId: CITYWIDE_BASE })).toBe(false);
    expect(restoresPromotedDefault({ targetReleaseId: PROMOTED!.releaseId, activeRealBaseReleaseId: CITYWIDE_BASE, record: ROLLED_BACK })).toBe(false);
    // What the toggle then resolves: the gated default, serializing no params.
    expect(resolveExteriorActivation({ ...base, override: null, activeRealBaseReleaseId: CITYWIDE_BASE }))
      .toEqual({ streaming: true, releaseId: PROMOTED!.releaseId, promotedDefault: true, reason: "promoted-default" });
  });

  it("restores the previous VERIFIED release atomically when the record is rolled back, and rolls forward again", () => {
    // Rehearsal, in the direction the swap actually goes. Exporting the
    // predecessor must put V2 back on as the default over a real base — not turn
    // the wave off, which would discard verified geometry nobody withdrew.
    expect(resolveExteriorActivation({ ...base, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, record: ROLLED_BACK }))
      .toEqual({ streaming: true, releaseId: "manhattan-exterior-cells-20260811", promotedDefault: true, reason: "promoted-default" });
    // The promotion gate is unchanged by the rollback: no real base, no wave.
    expect(resolveExteriorActivation({ ...base, override: null, activeRealBaseReleaseId: null, record: ROLLED_BACK }))
      .toEqual({ streaming: false, releaseId: FIXTURE_RELEASE_ID, promotedDefault: false, reason: "no-real-base" });
    // The withdrawn successor is refused by name in the same swap.
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: PROMOTED!.releaseId, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE, record: ROLLED_BACK }))
      .toMatchObject({ streaming: false, promotedDefault: false, reason: "rolled-back-release" });
    // An explicit opt-in into anything else keeps behaving as it always did.
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: FIXTURE_RELEASE_ID, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE, record: ROLLED_BACK }))
      .toMatchObject({ streaming: true, releaseId: FIXTURE_RELEASE_ID });
    // Forward again: the shipped record streams the successor and refuses nothing.
    expect(resolveExteriorActivation({ ...base, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, record: PROMOTED! }))
      .toEqual({ streaming: true, releaseId: PROMOTED!.releaseId, promotedDefault: true, reason: "promoted-default" });
    expect(exteriorRolledBackReleaseNotice("manhattan-exterior-cells-20260811", PROMOTED!)).toBeNull();
  });

  it("refuses an explicit opt-in into the release the build rolled back", () => {
    // The withdrawn bytes are still on disk and still in the pinned allowlist,
    // so without this refusal every promotion-era bookmark would keep rendering
    // the withdrawn wave — and render it with no promotion gate behind it.
    for (const activeRealBaseReleaseId of [CITYWIDE_BASE, null]) {
      expect(resolveExteriorActivation({ ...base, explicitReleaseId: PROMOTED!.releaseId, override: "on", activeRealBaseReleaseId, record: ROLLED_BACK }))
        .toMatchObject({ streaming: false, promotedDefault: false, reason: "rolled-back-release" });
    }
    const notice = exteriorRolledBackReleaseNotice(PROMOTED!.releaseId, ROLLED_BACK);
    expect(notice).toContain(`${PROMOTED!.releaseId} was rolled back in this build`);
    expect(notice).toContain("no substitute exterior release was selected");
    const statement = exteriorUnavailableDetail({ streaming: false, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: PROMOTED!.releaseId, record: ROLLED_BACK });
    expect(statement).toContain("was rolled back in this build");
    expect(statement).toContain(CITYWIDE_BASE);

    // Only that release is refused, and only by a build that withdrew it.
    expect(exteriorRolledBackReleaseNotice(FIXTURE_RELEASE_ID, ROLLED_BACK)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(null, ROLLED_BACK)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(PROMOTED!.releaseId, NEVER_PROMOTED)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(PROMOTED!.releaseId, EXTERIOR_DEFAULT_ACTIVATION)).toBeNull();
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: PROMOTED!.releaseId, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE, record: NEVER_PROMOTED }))
      .toMatchObject({ streaming: true, reason: "url-explicit" });
  });
});

describe("promoted exterior pin verification", () => {
  it("accepts exactly the accepted hashes and cell membership", () => {
    expect(verifyPromotedExteriorPin(resolved())).toEqual({ ok: true });
  });

  it("fails closed on every field of the pinned head", () => {
    const cases: [string, Parameters<typeof verifyPromotedExteriorPin>[0], string][] = [
      ["release", resolved({ releaseId: "manhattan-exterior-cells-20270101" }), "manhattan-exterior-cells-20270101"],
      ["snapshot", resolved({ snapshotId: "snapshot:manhattan-exterior-cells-20260811:v2" }), "snapshot:manhattan-exterior-cells-20260811:v2"],
      ["snapshot checksum", resolved({ snapshotChecksumSha256: "0".repeat(64) }), "0".repeat(64)],
      ["assembly packages", resolved({ assemblyPackageIds: ["manhattan-esb-block-reference-20260810"] }), "manhattan-esb-block-reference-20260810"],
    ];
    for (const [label, input, expectedFragment] of cases) {
      const result = verifyPromotedExteriorPin(input);
      expect(result.ok, label).toBe(false);
      expect(result.ok === false && result.message).toContain(expectedFragment);
      expect(result.ok === false && result.message).toContain("No exterior geometry was rendered and no substitute release was selected.");
    }
  });

  it("fails closed when the resolved snapshot carries different cell bytes", () => {
    const swapped = verifyPromotedExteriorPin(resolved({ cells: [{ ...PROMOTED!.membership.cells[0]!, checksumSha256: "f".repeat(64) }] }));
    expect(swapped.ok).toBe(false);
    expect(swapped.ok === false && swapped.message).toContain("cell membership");
    const extra = verifyPromotedExteriorPin(resolved({ cells: [...PROMOTED!.membership.cells, { cellId: "cell:manhattan:block-836", cellReleaseId: "cell-release:extra:v1", checksumSha256: "a".repeat(64) }] }));
    expect(extra.ok).toBe(false);
    const missing = verifyPromotedExteriorPin(resolved({ cells: [] }));
    expect(missing.ok).toBe(false);
  });

  it("moves the accepted pin with the rollback instead of accepting either release", () => {
    // The successor's pins are no longer accepted once the build rolled back...
    const withdrawn = verifyPromotedExteriorPin(resolved(), ROLLED_BACK);
    expect(withdrawn.ok).toBe(false);
    expect(withdrawn.ok === false && withdrawn.message).toContain(PROMOTED!.releaseId);
    // ...and the restored V2 pins are, so the rolled-back build renders exactly
    // the bytes it accepted rather than failing closed on everything.
    expect(verifyPromotedExteriorPin({
      releaseId: ROLLED_BACK.enabled ? ROLLED_BACK.releaseId : "",
      snapshotId: ROLLED_BACK.enabled ? ROLLED_BACK.snapshotId : "",
      snapshotChecksumSha256: ROLLED_BACK.enabled ? ROLLED_BACK.snapshotChecksumSha256 : "",
      assemblyPackageIds: ROLLED_BACK.enabled ? [...ROLLED_BACK.assemblyPackageIds] : [],
      cells: ROLLED_BACK.enabled ? ROLLED_BACK.membership.cells.map((cell) => ({ ...cell })) : [],
    }, ROLLED_BACK)).toEqual({ ok: true });
    // A build that promoted nothing still verifies nothing at all.
    const never = verifyPromotedExteriorPin(resolved(), NEVER_PROMOTED);
    expect(never.ok).toBe(false);
    expect(never.ok === false && never.message).toContain("not promoted in this build");
  });
});

describe("promoted exterior membership verification", () => {
  it("accepts the accepted identities and an empty degraded render", () => {
    expect(verifyPromotedExteriorMembership(PROMOTED!.membership.buildingIds)).toEqual({ ok: true });
    expect(verifyPromotedExteriorMembership([])).toEqual({ ok: true });
    expect(verifyPromotedExteriorMembership(["doitt:778052", "doitt:778052"])).toEqual({ ok: true });
  });

  it("fails closed when an identity outside the accepted wave reaches the scene", () => {
    const result = verifyPromotedExteriorMembership(["doitt:778052", "doitt:999999"]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("doitt:999999");
    expect(result.ok === false && result.message).not.toContain("doitt:778052,");
    expect(result.ok === false && result.message).toContain("no substitute release was selected");
  });
});

describe("explicit-unavailable statement", () => {
  it("states a base-only rolled-back build in words instead of dropping the section", () => {
    // The base-only rollback shape is still reachable and still says so: it is
    // the predecessor of the FIRST Block 835 promotion, which the V2 record
    // retains unchanged.
    const statement = exteriorUnavailableDetail({ streaming: false, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, record: BLOCK835_V2_EXTERIOR_ACTIVATION.predecessor });
    expect(statement).toContain("not active in this build");
    expect(statement).toContain(CITYWIDE_BASE);
    expect(statement).toContain("no substitute exterior was selected");
  });

  it("distinguishes a session the user switched off from a build that never promoted the wave", () => {
    const off = exteriorUnavailableDetail({ streaming: false, override: "off", activeRealBaseReleaseId: CITYWIDE_BASE });
    expect(off).toContain("switched off for this session");
    expect(off).toContain("no substitute exterior was selected");
  });

  it("stays silent where no exterior wave was ever promised", () => {
    // Fixture-mode default: quiet, no failure banner, nothing to report missing.
    expect(exteriorUnavailableDetail({ streaming: false, override: null, activeRealBaseReleaseId: null })).toBeNull();
    expect(exteriorUnavailableDetail({ streaming: false, override: null, activeRealBaseReleaseId: null, record: ROLLED_BACK })).toBeNull();
    // An active wave speaks through its own provenance section.
    expect(exteriorUnavailableDetail({ streaming: true, override: null, activeRealBaseReleaseId: CITYWIDE_BASE })).toBeNull();
  });
});
