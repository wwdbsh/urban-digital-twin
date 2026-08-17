import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BLOCK835_MEMBERSHIP_BUILDING_IDS,
  BLOCK835_V2_EXTERIOR_ACTIVATION,
  BLOCK835_V2_EXTERIOR_ROLLBACK,
  BLOCK835_V3_EXTERIOR_ACTIVATION,
  EXTERIOR_DEFAULT_ACTIVATION,
  EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION,
  EXTERIOR_TWO_LOD_DEFAULT_ROLLBACK,
  exteriorAcceptedCellsDigest,
  exteriorAcceptedIdsDigest,
  exteriorRolledBackReleaseNotice,
  exteriorUnavailableDetail,
  resolveExteriorActivation,
  restoresPromotedDefault,
  verifyPromotedExteriorMembership,
  verifyPromotedExteriorPin,
  type ExteriorAcceptedCell,
  type ExteriorDefaultActivationRecord,
} from "./exterior-default-activation";

const FIXTURE_RELEASE_ID = "udt-fixture-exterior-cells";
const CITYWIDE_BASE = "manhattan-citywide-20260804";
/** What this build promotes for wave w00: the SERVING release, since T005. */
const PROMOTED = EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION.enabled ? EXTERIOR_TWO_LOD_DEFAULT_ACTIVATION : null;
/**
 * The curated V3 record: what this wave promoted until T005, and what the
 * promoted serving record now names as its predecessor. It is still one
 * indivisible record carrying its own release, pin and literal membership, so
 * the per-record cases below follow it rather than losing them to the promotion.
 */
const CURATED = BLOCK835_V3_EXTERIOR_ACTIVATION.enabled ? BLOCK835_V3_EXTERIOR_ACTIVATION : null;
/** The rehearsed rollback is exactly the record's own predecessor. */
const ROLLED_BACK: ExteriorDefaultActivationRecord = PROMOTED ? PROMOTED.predecessor : EXTERIOR_DEFAULT_ACTIVATION;
/** What a curated-record rollback exports: the V2 record plus its withdrawal. */
const CURATED_ROLLED_BACK: ExteriorDefaultActivationRecord = CURATED ? CURATED.predecessor : BLOCK835_V3_EXTERIOR_ACTIVATION;
/**
 * What a COMPLETE rollback of the promoted serving record has to export.
 *
 * `ROLLED_BACK` above is the curated record verbatim, and it states no
 * withdrawal: the serving promotion kept each predecessor byte-identical instead
 * of pairing it with a `*_ROLLBACK` variant the way `BLOCK835_V2_EXTERIOR_ROLLBACK`
 * is paired with the V2 record. Exporting it alone therefore restores V3 as the
 * default and leaves promotion-era `?exteriorCells=<serving release>` bookmarks
 * streaming the withdrawn wave — the exact gap `rolledBackReleaseId` exists to
 * close. That fall is asserted rather than hidden ("names the fall" below), and
 * the refusal cases run against this record, which is what the swap would have
 * to be.
 */
const WITHDRAWING_ROLLBACK: ExteriorDefaultActivationRecord = EXTERIOR_TWO_LOD_DEFAULT_ROLLBACK;
/** A build that never promoted anything has no withdrawn release to refuse. */
const NEVER_PROMOTED: ExteriorDefaultActivationRecord = { enabled: false, releaseId: null, rolledBackReleaseId: null };

/**
 * Read from the release the record actually names, not from a path spelled out
 * here. A drift test that hard-codes a directory stops testing the record the
 * moment the record is repromoted onto a successor release — it would keep
 * proving the OLD bytes were internally consistent while the build shipped new
 * ones. Deriving the path from `CURATED.releaseId` keeps the gate pointed at
 * whatever that record names, so it can never be skipped by a swap.
 *
 * It reads the CURATED release because that is the record these cases are about.
 * The promoted serving release's 5.4 GB payload is gitignored, so its equivalent
 * drift gate cannot read `public/data/` at all and lives in
 * `exterior-serving-promotion-record.test.ts`, which re-derives every serving pin
 * from committed inventories, censuses and the island ledger instead.
 */
function committed(fileName: string): Record<string, unknown> {
  if (!CURATED) throw new Error("This build is rolled back; there is no curated release to read.");
  return JSON.parse(new TextDecoder().decode(readFileSync(`public/data/${CURATED.releaseId}/${fileName}`))) as Record<string, unknown>;
}

/**
 * The head and the cells the promoted SERVING release declares.
 *
 * The serving record states all three acceptance sets as digests, so it carries
 * no list to build a resolve from. These come from that release's own committed
 * `payload-inventory.json` — the record the serving drift gate re-derives every
 * pin from — because a set invented here would prove the gate agrees with a
 * fixture and nothing about the release. The payload directory is gitignored;
 * this file is committed, so these cases run on a fresh clone.
 */
const SERVING_INVENTORY = JSON.parse(
  new TextDecoder().decode(readFileSync(`data/${PROMOTED?.releaseId ?? ""}/payload-inventory.json`)),
) as { assemblyPackageIds: string[]; cellReleases: ExteriorAcceptedCell[] };
const SERVING_PACKAGE_IDS: readonly string[] = SERVING_INVENTORY.assemblyPackageIds;
const SERVING_CELLS: readonly ExteriorAcceptedCell[] = SERVING_INVENTORY.cellReleases;

interface ResolvedOverrides {
  releaseId?: string;
  snapshotId?: string;
  snapshotChecksumSha256?: string;
  assemblyPackageIds?: readonly string[];
  cells?: readonly ExteriorAcceptedCell[];
  buildingIds?: readonly string[];
}

/**
 * A resolve of the promoted release, digested the way a real caller digests it:
 * the digests are computed FROM the sets this fixture carries, so an override
 * moves a set and its digest together. A fixture that overrode the set and kept
 * the accepted digest would pass a gate no runtime could pass.
 */
async function resolved(overrides: ResolvedOverrides = {}) {
  if (!PROMOTED) throw new Error("This build is rolled back; the promoted fixtures do not apply.");
  const assemblyPackageIds = overrides.assemblyPackageIds ?? SERVING_PACKAGE_IDS;
  const cells = overrides.cells ?? SERVING_CELLS;
  const buildingIds = overrides.buildingIds ?? BLOCK835_MEMBERSHIP_BUILDING_IDS;
  return {
    releaseId: overrides.releaseId ?? PROMOTED.releaseId,
    snapshotId: overrides.snapshotId ?? PROMOTED.snapshotId,
    snapshotChecksumSha256: overrides.snapshotChecksumSha256 ?? PROMOTED.snapshotChecksumSha256,
    assemblyPackageIds: [...assemblyPackageIds],
    assemblyPackageIdsDigestSha256: await exteriorAcceptedIdsDigest(assemblyPackageIds),
    cells: cells.map((cell) => ({ ...cell })),
    cellsDigestSha256: await exteriorAcceptedCellsDigest(cells),
    buildingIds: [...buildingIds],
    buildingIdsDigestSha256: await exteriorAcceptedIdsDigest(buildingIds),
  };
}

describe("Block 835 curated V3 promotion record, which the promoted serving record rolls back to", () => {
  it("is one indivisible record whose rollback target is the previous VERIFIED representation", () => {
    expect(CURATED).not.toBeNull();
    expect(CURATED!.releaseId).toBe("manhattan-exterior-cells-20260811-v3");
    expect(CURATED!.approvalRef).toBe("Issue #44 gate approval 2026-08-11 (T026 V3 promotion)");
    // A partial rollback stays unrepresentable: the predecessor is one whole
    // record carrying its own release, pin and membership together, never a flag
    // that can be flipped beside a surviving pin.
    expect(CURATED!.predecessor).toBe(BLOCK835_V2_EXTERIOR_ROLLBACK);
    // On a SECOND promotion the previous verified representation is the wave one
    // version back, not base massing. Rolling back to base would discard
    // verified geometry that was never withdrawn.
    expect(CURATED_ROLLED_BACK.enabled).toBe(true);
    expect(CURATED_ROLLED_BACK.releaseId).toBe("manhattan-exterior-cells-20260811");
    // ...and the rollback withdraws the successor in the SAME record swap, so a
    // promotion-era opt-in link into it cannot keep rendering the withdrawn wave.
    expect(CURATED_ROLLED_BACK.rolledBackReleaseId).toBe(CURATED!.releaseId);
    // A forward promotion withdraws nothing, and no record may ever refuse the
    // release it is simultaneously publishing.
    expect(CURATED!.rolledBackReleaseId ?? null).toBeNull();
    for (const record of [CURATED!, CURATED_ROLLED_BACK, BLOCK835_V2_EXTERIOR_ACTIVATION]) {
      if (record.enabled) expect(record.rolledBackReleaseId ?? null).not.toBe(record.releaseId);
    }
  });

  it("is the record the promoted chain reaches two links down, by identity", () => {
    // The chain grew again with the two-LOD promotion: the build promotes the
    // -s2 release, whose previous verified representation is the -s1 serving
    // record, whose own is this curated record — retained verbatim — whose own
    // is V2.
    expect(EXTERIOR_DEFAULT_ACTIVATION.enabled).toBe(true);
    expect(PROMOTED).not.toBeNull();
    expect(PROMOTED!.releaseId).toBe("manhattan-exterior-cells-20260811-v3-s2");
    expect(ROLLED_BACK).toBe(EXTERIOR_DEFAULT_ACTIVATION);
    expect(EXTERIOR_DEFAULT_ACTIVATION.enabled && EXTERIOR_DEFAULT_ACTIVATION.releaseId).toBe("manhattan-exterior-cells-20260811-v3-s1");
    expect(EXTERIOR_DEFAULT_ACTIVATION.enabled && EXTERIOR_DEFAULT_ACTIVATION.predecessor).toBe(BLOCK835_V3_EXTERIOR_ACTIVATION);
    expect(PROMOTED!.rolledBackReleaseId ?? null).toBeNull();
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
    expect([...CURATED!.membership.buildingIds].sort()).toEqual([...BLOCK835_V2_EXTERIOR_ACTIVATION.membership.buildingIds].sort());
    expect(CURATED!.membership.cellCount).toBe(BLOCK835_V2_EXTERIOR_ACTIVATION.membership.cellCount);
  });

  it("carries that same membership into the serving promotion, one digest instead of fourteen names", async () => {
    // The serving record states its accepted buildings as a digest, so "no
    // availability drift" is checked by RECOMPUTING it over the fourteen curated
    // identities rather than by reading a list. It also licenses every fixture
    // below to use those identities as the resolved membership: they are the
    // accepted set precisely because this digest says so.
    expect(PROMOTED!.membership.buildingCount).toBe(BLOCK835_MEMBERSHIP_BUILDING_IDS.length);
    expect(PROMOTED!.membership.buildingIdsDigestSha256).toBe(await exteriorAcceptedIdsDigest(BLOCK835_MEMBERSHIP_BUILDING_IDS));
    expect(PROMOTED!.membership.cellCount).toBe(CURATED!.membership.cellCount);
  });

  it("pins the committed index defaultHead byte for byte", () => {
    const index = committed("index.json");
    expect(index.releaseId).toBe(CURATED!.releaseId);
    expect(index.defaultHead).toEqual({
      snapshotId: CURATED!.snapshotId,
      checksumSha256: CURATED!.snapshotChecksumSha256,
      assemblyPackageIds: [...CURATED!.assemblyPackageIds],
    });
  });

  it("records exactly the public cell membership and the 14 accepted building identities", () => {
    const graph = committed("release-graph.json") as {
      snapshots: { snapshotId: string; audience: string; cells: { cellId: string; cellReleaseId: string; checksumSha256: string }[] }[];
      cellReleases: { cellReleaseId: string; audience: string; buildingIds: string[] }[];
    };
    const snapshot = graph.snapshots.find((entry) => entry.snapshotId === CURATED!.snapshotId && entry.audience === "public");
    expect(snapshot).toBeDefined();
    expect(snapshot!.cells).toEqual(CURATED!.membership.cells.map((cell) => ({ ...cell })));

    const buildingIds = snapshot!.cells.flatMap((cell) => graph.cellReleases.find((entry) => entry.cellReleaseId === cell.cellReleaseId)?.buildingIds ?? []);
    expect(buildingIds).toHaveLength(14);
    expect([...buildingIds].sort()).toEqual([...CURATED!.membership.buildingIds].sort());
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
    // predecessor must put the -s1 serving release back on as the default over
    // a real base — not turn the wave off, which would discard verified
    // geometry nobody withdrew.
    expect(resolveExteriorActivation({ ...base, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, record: ROLLED_BACK }))
      .toEqual({ streaming: true, releaseId: ROLLED_BACK.enabled ? ROLLED_BACK.releaseId : "", promotedDefault: true, reason: "promoted-default" });
    // The promotion gate is unchanged by the rollback: no real base, no wave.
    expect(resolveExteriorActivation({ ...base, override: null, activeRealBaseReleaseId: null, record: ROLLED_BACK }))
      .toEqual({ streaming: false, releaseId: FIXTURE_RELEASE_ID, promotedDefault: false, reason: "no-real-base" });
    // The withdrawn successor is refused by name in the same swap — but only
    // once the swapped-in record STATES the withdrawal, which the shipped
    // predecessor does not. See "names the fall" below.
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: PROMOTED!.releaseId, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE, record: WITHDRAWING_ROLLBACK }))
      .toMatchObject({ streaming: false, promotedDefault: false, reason: "rolled-back-release" });
    // An explicit opt-in into anything else keeps behaving as it always did.
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: FIXTURE_RELEASE_ID, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE, record: ROLLED_BACK }))
      .toMatchObject({ streaming: true, releaseId: FIXTURE_RELEASE_ID });
    // Forward again: the shipped record streams the successor and refuses nothing.
    expect(resolveExteriorActivation({ ...base, override: null, activeRealBaseReleaseId: CITYWIDE_BASE, record: PROMOTED! }))
      .toEqual({ streaming: true, releaseId: PROMOTED!.releaseId, promotedDefault: true, reason: "promoted-default" });
    expect(exteriorRolledBackReleaseNotice(CURATED!.releaseId, PROMOTED!)).toBeNull();
  });

  /**
   * What the serving promotion gave up, stated as a test rather than left to be
   * discovered during a rollback.
   *
   * Every curated wave paired its rollback target with a withdrawal: exporting
   * `BLOCK835_V2_EXTERIOR_ROLLBACK` restored V2 AND refused `?exteriorCells=`
   * links into the withdrawn V3 in the same edit. The serving promotion names
   * the curated record itself as the predecessor, byte-identical, so the swap
   * this build ships restores geometry and refuses nothing.
   */
  it("names the fall: the shipped predecessor states no withdrawal, so a bare swap leaves the serving link live", () => {
    expect(ROLLED_BACK.rolledBackReleaseId ?? null).toBeNull();
    expect(exteriorRolledBackReleaseNotice(PROMOTED!.releaseId, ROLLED_BACK)).toBeNull();
    // The withdrawn serving release keeps streaming for a promotion-era
    // bookmark, ungated: `promotedDefault` is false, so neither the pin nor the
    // identity gate runs against it.
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: PROMOTED!.releaseId, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE, record: ROLLED_BACK }))
      .toMatchObject({ streaming: true, releaseId: PROMOTED!.releaseId, promotedDefault: false });
    // Stating the withdrawal is what closes it, and it is the only difference
    // between the record this build ships and the one a rollback needs.
    expect({ ...WITHDRAWING_ROLLBACK, rolledBackReleaseId: null }).toEqual({ ...ROLLED_BACK, rolledBackReleaseId: null });
  });

  it("refuses an explicit opt-in into the release the build rolled back", () => {
    // The withdrawn bytes are still on disk and still in the pinned allowlist,
    // so without this refusal every promotion-era bookmark would keep rendering
    // the withdrawn wave — and render it with no promotion gate behind it.
    for (const activeRealBaseReleaseId of [CITYWIDE_BASE, null]) {
      expect(resolveExteriorActivation({ ...base, explicitReleaseId: PROMOTED!.releaseId, override: "on", activeRealBaseReleaseId, record: WITHDRAWING_ROLLBACK }))
        .toMatchObject({ streaming: false, promotedDefault: false, reason: "rolled-back-release" });
    }
    const notice = exteriorRolledBackReleaseNotice(PROMOTED!.releaseId, WITHDRAWING_ROLLBACK);
    expect(notice).toContain(`${PROMOTED!.releaseId} was rolled back in this build`);
    expect(notice).toContain("no substitute exterior release was selected");
    const statement = exteriorUnavailableDetail({ streaming: false, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE, explicitReleaseId: PROMOTED!.releaseId, record: WITHDRAWING_ROLLBACK });
    expect(statement).toContain("was rolled back in this build");
    expect(statement).toContain(CITYWIDE_BASE);

    // Only that release is refused, and only by a build that withdrew it.
    expect(exteriorRolledBackReleaseNotice(FIXTURE_RELEASE_ID, WITHDRAWING_ROLLBACK)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(null, WITHDRAWING_ROLLBACK)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(PROMOTED!.releaseId, NEVER_PROMOTED)).toBeNull();
    expect(exteriorRolledBackReleaseNotice(PROMOTED!.releaseId, EXTERIOR_DEFAULT_ACTIVATION)).toBeNull();
    expect(resolveExteriorActivation({ ...base, explicitReleaseId: PROMOTED!.releaseId, override: "on", activeRealBaseReleaseId: CITYWIDE_BASE, record: NEVER_PROMOTED }))
      .toMatchObject({ streaming: true, reason: "url-explicit" });
  });
});

describe("promoted exterior pin verification", () => {
  it("accepts exactly the accepted hashes and cell membership", async () => {
    expect(verifyPromotedExteriorPin(await resolved())).toEqual({ ok: true });
  });

  it("fails closed on every field of the pinned head", async () => {
    // The head is now stated as a DIGEST, so the two package cases below name
    // the count and the digest where they used to name the package id. That is
    // less legible per failure and it is the cost of the form: 249 package ids
    // in a source file is a diff nobody reads, and the count still names a
    // truncated head as truncated before any digest is printed.
    const cases: [string, Parameters<typeof verifyPromotedExteriorPin>[0], string][] = [
      ["release", await resolved({ releaseId: "manhattan-exterior-cells-20270101" }), "manhattan-exterior-cells-20270101"],
      ["snapshot", await resolved({ snapshotId: "snapshot:manhattan-exterior-cells-20260811:v2" }), "snapshot:manhattan-exterior-cells-20260811:v2"],
      ["snapshot checksum", await resolved({ snapshotChecksumSha256: "0".repeat(64) }), "0".repeat(64)],
      ["assembly package count", await resolved({ assemblyPackageIds: [] }), "assembly package count"],
      ["assembly package digest", await resolved({ assemblyPackageIds: ["manhattan-esb-block-reference-20260810"] }), PROMOTED!.assemblyPackageIdsDigestSha256!],
      ["building count", await resolved({ buildingIds: BLOCK835_MEMBERSHIP_BUILDING_IDS.slice(1) }), "building count"],
      ["building membership digest", await resolved({ buildingIds: [...BLOCK835_MEMBERSHIP_BUILDING_IDS.slice(1), "doitt:000000"] }), PROMOTED!.membership.buildingIdsDigestSha256!],
    ];
    for (const [label, input, expectedFragment] of cases) {
      const result = verifyPromotedExteriorPin(input);
      expect(result.ok, label).toBe(false);
      expect(result.ok === false && result.message, label).toContain(expectedFragment);
      expect(result.ok === false && result.message, label).toContain("No exterior geometry was rendered and no substitute release was selected.");
    }
  });

  it("fails closed when the resolved snapshot carries different cell bytes", async () => {
    const swapped = verifyPromotedExteriorPin(await resolved({ cells: [{ ...SERVING_CELLS[0]!, checksumSha256: "f".repeat(64) }] }));
    expect(swapped.ok).toBe(false);
    expect(swapped.ok === false && swapped.message).toContain("cell membership");
    const extra = verifyPromotedExteriorPin(await resolved({ cells: [...SERVING_CELLS, { cellId: "cell:manhattan:block-836", cellReleaseId: "cell-release:extra:v1", checksumSha256: "a".repeat(64) }] }));
    expect(extra.ok).toBe(false);
    const missing = verifyPromotedExteriorPin(await resolved({ cells: [] }));
    expect(missing.ok).toBe(false);
  });

  it("moves the accepted pin with the rollback instead of accepting either release", async () => {
    // The successor's pins are no longer accepted once the build rolled back...
    const withdrawn = verifyPromotedExteriorPin(await resolved(), ROLLED_BACK);
    expect(withdrawn.ok).toBe(false);
    expect(withdrawn.ok === false && withdrawn.message).toContain(PROMOTED!.releaseId);
    // ...and the restored curated V3 pins are, so the rolled-back build renders
    // exactly the bytes it accepted rather than failing closed on everything.
    // That record states its acceptance literally, so no digest is supplied and
    // none is needed: the literal branch compares the lists themselves.
    // The restored -s1 record states its acceptance as digests, so its pins are
    // rebuilt from that release's own committed inventory, the way the runtime
    // would — and they verify against the rolled-back record.
    const s1Inventory = JSON.parse(
      new TextDecoder().decode(readFileSync(`data/${ROLLED_BACK.enabled ? ROLLED_BACK.releaseId : ""}/payload-inventory.json`)),
    ) as { assemblyPackageIds: string[]; cellReleases: ExteriorAcceptedCell[] };
    expect(verifyPromotedExteriorPin({
      releaseId: ROLLED_BACK.enabled ? ROLLED_BACK.releaseId : "",
      snapshotId: ROLLED_BACK.enabled ? ROLLED_BACK.snapshotId : "",
      snapshotChecksumSha256: ROLLED_BACK.enabled ? ROLLED_BACK.snapshotChecksumSha256 : "",
      assemblyPackageIds: [...s1Inventory.assemblyPackageIds],
      assemblyPackageIdsDigestSha256: await exteriorAcceptedIdsDigest(s1Inventory.assemblyPackageIds),
      cells: s1Inventory.cellReleases.map((cell) => ({ ...cell })),
      cellsDigestSha256: await exteriorAcceptedCellsDigest(s1Inventory.cellReleases),
      buildingIds: [...BLOCK835_MEMBERSHIP_BUILDING_IDS],
      buildingIdsDigestSha256: await exteriorAcceptedIdsDigest(BLOCK835_MEMBERSHIP_BUILDING_IDS),
    }, ROLLED_BACK)).toEqual({ ok: true });
    // A build that promoted nothing still verifies nothing at all.
    const never = verifyPromotedExteriorPin(await resolved(), NEVER_PROMOTED);
    expect(never.ok).toBe(false);
    expect(never.ok === false && never.message).toContain("not promoted in this build");
  });
});

/**
 * The promoted record states its membership as a digest, so the identity gate
 * cannot read a list off it and has to be HANDED the set the pin gate verified.
 * Every case below passes the fourteen curated identities, which the promotion
 * record's own building digest is checked against above — so the set handed in
 * is the accepted set rather than a set this file believes in.
 */
describe("promoted exterior membership verification", () => {
  it("refuses to check anything when it is not handed the verified membership", () => {
    // Deliberate, and not worked around anywhere in this suite: a digest-form
    // record with no resolved set supplied has had NO identity checked, which
    // must fail rather than pass by omission.
    const unverified = verifyPromotedExteriorMembership(BLOCK835_MEMBERSHIP_BUILDING_IDS);
    expect(unverified.ok).toBe(false);
    expect(unverified.ok === false && unverified.message).toContain("must be handed the verified resolved membership");
  });

  it("accepts the accepted identities and an empty degraded render", () => {
    expect(verifyPromotedExteriorMembership(BLOCK835_MEMBERSHIP_BUILDING_IDS, EXTERIOR_DEFAULT_ACTIVATION, BLOCK835_MEMBERSHIP_BUILDING_IDS)).toEqual({ ok: true });
    expect(verifyPromotedExteriorMembership([], EXTERIOR_DEFAULT_ACTIVATION, BLOCK835_MEMBERSHIP_BUILDING_IDS)).toEqual({ ok: true });
    expect(verifyPromotedExteriorMembership(["doitt:778052", "doitt:778052"], EXTERIOR_DEFAULT_ACTIVATION, BLOCK835_MEMBERSHIP_BUILDING_IDS)).toEqual({ ok: true });
  });

  it("fails closed when an identity outside the accepted wave reaches the scene", () => {
    const result = verifyPromotedExteriorMembership(["doitt:778052", "doitt:999999"], EXTERIOR_DEFAULT_ACTIVATION, BLOCK835_MEMBERSHIP_BUILDING_IDS);
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
