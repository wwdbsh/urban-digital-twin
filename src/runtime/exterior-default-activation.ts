/**
 * Frozen promotion record for the Block 835 exterior wave.
 *
 * The promoted release, its operator-pinned head, and its cell/building
 * membership are ONE indivisible constant. Rollback is the single edit that
 * exports `EXTERIOR_DEFAULT_ACTIVATION.predecessor` instead, so a partial
 * rollback (default still on, pin gone; pin kept, membership gone) is not
 * representable in this build. The values are data-in-code on purpose: a
 * runtime-fetched promotion document could disagree with the bytes this build
 * was reviewed against, and nothing here is fetched, parsed, or negotiated.
 *
 * `snapshotId`, `snapshotChecksumSha256`, and `assemblyPackageIds` are a byte
 * copy of `defaultHead` in the committed
 * `public/data/manhattan-exterior-cells-20260811/index.json`;
 * `exterior-default-activation.test.ts` fails closed on any drift.
 */

export interface ExteriorDefaultActivationMembership {
  readonly cells: readonly { readonly cellId: string; readonly cellReleaseId: string; readonly checksumSha256: string }[];
  readonly buildingIds: readonly string[];
}

/** The disabled state carries no release: it is the base-only predecessor. */
export interface ExteriorDefaultActivationDisabled {
  readonly enabled: false;
  readonly releaseId: null;
}

export interface ExteriorDefaultActivationEnabled {
  readonly enabled: true;
  readonly releaseId: string;
  readonly snapshotId: string;
  readonly snapshotChecksumSha256: string;
  readonly assemblyPackageIds: readonly string[];
  readonly membership: ExteriorDefaultActivationMembership;
  readonly approvalRef: string;
  readonly predecessor: ExteriorDefaultActivationDisabled;
}

export type ExteriorDefaultActivationRecord = ExteriorDefaultActivationEnabled | ExteriorDefaultActivationDisabled;

/** Rollback: export `EXTERIOR_DEFAULT_ACTIVATION.predecessor` from here instead. */
export const EXTERIOR_DEFAULT_ACTIVATION: ExteriorDefaultActivationRecord = {
  enabled: true,
  releaseId: "manhattan-exterior-cells-20260811",
  snapshotId: "snapshot:manhattan-exterior-cells-20260811:v1",
  snapshotChecksumSha256: "18e1689e19264543d8aaacafe989769b5d74f04cf0f5ca9cfc6c5407632e0ae7",
  assemblyPackageIds: ["manhattan-esb-block-reference-20260811"],
  membership: {
    cells: [{
      cellId: "cell:manhattan:block-835",
      cellReleaseId: "cell-release:manhattan-exterior-cells-20260811:v1",
      checksumSha256: "418ec17d40cdbe89be781367df5cf4d47dc4fba3bf3902b019c6431e05ce4a87",
    }],
    buildingIds: [
      "doitt:102705", "doitt:131170", "doitt:147902", "doitt:262867", "doitt:39969",
      "doitt:460555", "doitt:498980", "doitt:502491", "doitt:584049", "doitt:778052",
      "doitt:812702", "doitt:835659", "doitt:925937", "doitt:982383",
    ],
  },
  approvalRef: "Issue #11 gate approval 2026-08-11 + perf evidence PR #38",
  predecessor: { enabled: false, releaseId: null },
} as const;

/** URL intent, kept distinct from the resolved activation it feeds. */
export type ExteriorStreamingOverride = "on" | "off" | null;

export interface ExteriorActivationInput {
  /** `"on"`/`"off"` come from an explicit URL parameter or the Disable toggle. */
  override: ExteriorStreamingOverride;
  /** A pinned release named by `exteriorCells`; `null` means "no URL opinion". */
  explicitReleaseId: string | null;
  /** Non-null only while a compatible real base release is genuinely active. */
  activeRealBaseReleaseId: string | null;
  /** The pre-promotion default release (the synthetic fixture package). */
  fallbackReleaseId: string;
  record?: ExteriorDefaultActivationRecord;
}

export interface ExteriorActivationResolution {
  /** Whether a load should be attempted at all. */
  streaming: boolean;
  /** The release a load would target. Meaningful only when `streaming`. */
  releaseId: string;
  /** True only when the promoted record — not a URL — turned streaming on. */
  promotedDefault: boolean;
  reason: "url-disabled" | "url-explicit" | "promoted-default" | "no-real-base" | "not-promoted";
}

/**
 * The promotion gate. A promoted default activates ONLY over an active
 * compatible real base: a fixture-mode session has no base identity to anchor
 * exterior cells to, so it stays exterior-quiet rather than attempting a load it
 * would have to fail loudly. Explicit URL/toggle intent still wins in both
 * directions, which keeps every pre-promotion deep link behaving as it did.
 */
export function resolveExteriorActivation(input: ExteriorActivationInput): ExteriorActivationResolution {
  const record = input.record ?? EXTERIOR_DEFAULT_ACTIVATION;
  const promotable = record.enabled && input.activeRealBaseReleaseId !== null;
  const releaseId = input.explicitReleaseId ?? (promotable && record.enabled ? record.releaseId : input.fallbackReleaseId);
  if (input.override === "off") return { streaming: false, releaseId, promotedDefault: false, reason: "url-disabled" };
  if (input.override === "on") return { streaming: true, releaseId, promotedDefault: false, reason: "url-explicit" };
  if (promotable) return { streaming: true, releaseId, promotedDefault: input.explicitReleaseId === null, reason: "promoted-default" };
  return { streaming: false, releaseId, promotedDefault: false, reason: record.enabled ? "no-real-base" : "not-promoted" };
}

export interface ExteriorPinVerificationInput {
  releaseId: string;
  snapshotId: string;
  snapshotChecksumSha256: string;
  assemblyPackageIds: readonly string[];
  cells: readonly { cellId: string; cellReleaseId: string; checksumSha256: string }[];
}

export type ExteriorPinVerification = { ok: true } | { ok: false; message: string };

function cellKey(cell: { cellId: string; cellReleaseId: string; checksumSha256: string }): string {
  return `${cell.cellId}|${cell.cellReleaseId}|${cell.checksumSha256}`;
}

/**
 * Acceptance gate for the promoted default: the release the runtime actually
 * resolved must be the accepted hashes and the accepted cell membership, or
 * nothing renders. This never "repairs" a mismatch and never substitutes a
 * same-named release that resolved different bytes.
 */
export function verifyPromotedExteriorPin(
  resolved: ExteriorPinVerificationInput,
  record: ExteriorDefaultActivationRecord = EXTERIOR_DEFAULT_ACTIVATION,
): ExteriorPinVerification {
  if (!record.enabled) {
    return { ok: false, message: "Exterior streaming is not promoted in this build, so no promoted pin could be verified; no substitute release was selected." };
  }
  const mismatch = (field: string, expected: string, actual: string) => ({
    ok: false as const,
    message: `Exterior streaming failed closed: the promoted default resolved ${field} ${actual}, but this build accepted ${expected} (${record.approvalRef}). No exterior geometry was rendered and no substitute release was selected.`,
  });
  if (resolved.releaseId !== record.releaseId) return mismatch("release", record.releaseId, resolved.releaseId);
  if (resolved.snapshotId !== record.snapshotId) return mismatch("snapshot", record.snapshotId, resolved.snapshotId);
  if (resolved.snapshotChecksumSha256 !== record.snapshotChecksumSha256) return mismatch("snapshot checksum", record.snapshotChecksumSha256, resolved.snapshotChecksumSha256);
  const expectedPackages = [...record.assemblyPackageIds].sort().join(", ");
  const actualPackages = [...resolved.assemblyPackageIds].sort().join(", ");
  if (expectedPackages !== actualPackages) return mismatch("assembly packages", expectedPackages, actualPackages);
  const expectedCells = record.membership.cells.map(cellKey).sort().join(", ");
  const actualCells = resolved.cells.map(cellKey).sort().join(", ");
  if (expectedCells !== actualCells) return mismatch("cell membership", expectedCells, actualCells);
  return { ok: true };
}

/**
 * Identity gate for what actually reached the scene. Rendered exterior assets
 * reuse canonical base building identities, so an identity outside the accepted
 * membership means the resolved bytes are not the accepted wave. A cell that
 * degraded to base massing renders no asset and is reported by the existing
 * per-cell notices, so an empty set is not a mismatch here.
 */
export function verifyPromotedExteriorMembership(
  renderedFeatureIds: readonly string[],
  record: ExteriorDefaultActivationRecord = EXTERIOR_DEFAULT_ACTIVATION,
): ExteriorPinVerification {
  if (!record.enabled) {
    return { ok: false, message: "Exterior streaming is not promoted in this build, so no promoted membership could be verified; no substitute release was selected." };
  }
  const accepted = new Set(record.membership.buildingIds);
  const unexpected = [...new Set(renderedFeatureIds)].filter((featureId) => !accepted.has(featureId)).sort();
  if (unexpected.length === 0) return { ok: true };
  return {
    ok: false,
    message: `Exterior streaming failed closed: the promoted default rendered ${unexpected.join(", ")}, which the accepted Block 835 membership (${record.approvalRef}) does not contain. No exterior geometry was rendered and no substitute release was selected.`,
  };
}

export interface ExteriorUnavailableInput {
  streaming: boolean;
  override: ExteriorStreamingOverride;
  activeRealBaseReleaseId: string | null;
  record?: ExteriorDefaultActivationRecord;
}

/**
 * Explicit-unavailable rule. When a real base is active and the exterior wave is
 * not, the details panel says so in words instead of letting the exterior
 * section silently disappear. Fixture-mode sessions stay quiet: they never
 * claimed an exterior wave, so there is nothing to report as missing.
 */
export function exteriorUnavailableDetail(input: ExteriorUnavailableInput): string | null {
  const record = input.record ?? EXTERIOR_DEFAULT_ACTIVATION;
  if (input.streaming || input.activeRealBaseReleaseId === null) return null;
  if (input.override === "off") {
    return `Exterior streaming is switched off for this session, so base massing from release ${input.activeRealBaseReleaseId} is shown; no substitute exterior was selected.`;
  }
  if (!record.enabled) {
    return `The Block 835 exterior wave is not active in this build, so base massing from release ${input.activeRealBaseReleaseId} is shown; no substitute exterior was selected.`;
  }
  return null;
}
