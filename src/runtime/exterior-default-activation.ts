/**
 * Frozen promotion records for the exterior waves this build activates.
 *
 * The build activates an ORDERED SET of waves (`EXTERIOR_DEFAULT_ACTIVATIONS`),
 * today containing exactly one: Block 835. Each wave is its own record, and the
 * per-record properties below hold PER RECORD — one wave rolling back neither
 * withdraws nor implies anything about another.
 *
 * The promoted release, its operator-pinned head, and its cell/building
 * membership are ONE indivisible constant. Rollback is the single edit that
 * exports `EXTERIOR_DEFAULT_ACTIVATION.predecessor` instead, so a partial
 * rollback (default still on, pin gone; pin kept, membership gone) is not
 * representable in this build. The predecessor also refuses explicit opt-ins
 * into the withdrawn release, so promotion-era `?exteriorCells=` bookmarks fail
 * closed without a second edit. The values are data-in-code on purpose: a
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

/**
 * The disabled state carries no *active* release: it is the base-only
 * predecessor. It does name the release it rolled back, because a rollback that
 * left the withdrawn release reachable through its own `?exteriorCells=` link
 * would not be a rollback — every bookmark taken during the promotion would keep
 * rendering the withdrawn wave, ungated. `rolledBackReleaseId` is what makes
 * those links fail closed, so the one-line record swap stays the whole rollback.
 */
export interface ExteriorDefaultActivationDisabled {
  readonly enabled: false;
  readonly releaseId: null;
  readonly rolledBackReleaseId: string | null;
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
  predecessor: { enabled: false, releaseId: null, rolledBackReleaseId: "manhattan-exterior-cells-20260811" },
} as const;

/**
 * The ordered promotion set this build activates, oldest wave first.
 *
 * Waves are COMPOSED from their own records instead of being copied into a
 * second, independently editable constant: each wave keeps exactly one record
 * and exactly one rollback edit, and composing here means the set can never
 * disagree with the record that edit actually swapped. The records arrive as
 * parameters rather than as reads of this module's own bindings, so a caller
 * holding a record — a build that rolled one back, or a rollback rehearsal —
 * orders precisely the record it holds.
 */
export function exteriorDefaultActivations(
  blockEight35: ExteriorDefaultActivationRecord = EXTERIOR_DEFAULT_ACTIVATION,
): readonly ExteriorDefaultActivationRecord[] {
  return [blockEight35];
}

/** The composed set, for callers with no substituted record of their own. */
export const EXTERIOR_DEFAULT_ACTIVATIONS: readonly ExteriorDefaultActivationRecord[] = exteriorDefaultActivations();

/**
 * One record or a whole set. Every per-record rule below reads the same way for
 * both, so a single-wave caller never has to know the set exists.
 */
export type ExteriorDefaultActivationRecords = ExteriorDefaultActivationRecord | readonly ExteriorDefaultActivationRecord[];

function activationRecordList(input: ExteriorDefaultActivationRecords): readonly ExteriorDefaultActivationRecord[] {
  return Array.isArray(input) ? input as readonly ExteriorDefaultActivationRecord[] : [input as ExteriorDefaultActivationRecord];
}

/**
 * URL intent, kept distinct from the resolved activation it feeds.
 *
 * `"off"` is a user's explicit disable. `"off-unpinned"` is the *parse* failing
 * closed on an `exteriorCells` value this build does not pin: no exterior wave
 * either, but nobody switched anything off, so it must not be reported as if
 * somebody had.
 */
export type ExteriorStreamingOverride = "on" | "off" | "off-unpinned" | null;

/** Every override value that means "no exterior wave", however it was reached. */
export function exteriorStreamingOverrideDisables(override: ExteriorStreamingOverride): boolean {
  return override === "off" || override === "off-unpinned";
}

/**
 * Refusal rule for a rolled-back release. An explicit opt-in link naming the
 * release this build withdrew resolves to nothing at all: the withdrawn bytes
 * are still on disk and still pinned by the allowlist, so without this the
 * rollback would only have removed the *default* while every promotion-era
 * bookmark kept rendering the withdrawn wave — and rendering it ungated, since
 * the pin and identity gates verify against a record that no longer accepts it.
 *
 * The rule is PER WAVE: one withdrawn record refuses opt-ins into ITS release
 * and says nothing about the other waves, which keep streaming. A build with
 * several waves therefore rolls one back without withdrawing the rest.
 */
export function exteriorRolledBackReleaseNotice(
  explicitReleaseId: string | null,
  records: ExteriorDefaultActivationRecords = EXTERIOR_DEFAULT_ACTIVATION,
): string | null {
  if (explicitReleaseId === null) return null;
  for (const record of activationRecordList(records)) {
    if (record.enabled || record.rolledBackReleaseId === null) continue;
    if (explicitReleaseId !== record.rolledBackReleaseId) continue;
    return `Exterior streaming release ${record.rolledBackReleaseId} was rolled back in this build, so this link streamed no exterior geometry; no substitute exterior release was selected.`;
  }
  return null;
}

/**
 * Whether turning streaming back on in this session is the promoted default
 * returning, rather than an explicit opt-in. Used by the toggle: re-enabling
 * with an explicit release equal to the promoted release would serialize a
 * release id into a default-on session's links, and — before the resolver also
 * gated explicitly-named promoted releases — skipped both promotion gates.
 */
export function restoresPromotedDefault(input: {
  targetReleaseId: string;
  activeRealBaseReleaseId: string | null;
  record?: ExteriorDefaultActivationRecords;
}): boolean {
  if (input.activeRealBaseReleaseId === null) return false;
  return activationRecordList(input.record ?? EXTERIOR_DEFAULT_ACTIVATION)
    .some((record) => record.enabled && input.targetReleaseId === record.releaseId);
}

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
  /**
   * True whenever the release being streamed IS the promoted release, however
   * it was selected. The promotion gates key off this, so an explicit link that
   * happens to name the promoted release is verified against the accepted pin
   * and membership too, rather than borrowing the promotion's identity while
   * skipping its acceptance.
   */
  promotedDefault: boolean;
  reason:
    | "url-disabled"
    /** The parse failed closed on an unpinned `exteriorCells` value. */
    | "url-unpinned-release"
    /** An explicit opt-in into the release this build rolled back. */
    | "rolled-back-release"
    | "url-explicit"
    | "promoted-default"
    /** A named release with no on/off override; not reachable from a URL. */
    | "explicit-release"
    | "no-real-base"
    | "not-promoted";
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
  // Streaming the promoted release is streaming the promoted release, whoever
  // named it, so the gates apply to an explicit opt-in into it as well.
  const promotedDefault = record.enabled && releaseId === record.releaseId;
  if (exteriorStreamingOverrideDisables(input.override)) {
    return { streaming: false, releaseId, promotedDefault: false, reason: input.override === "off-unpinned" ? "url-unpinned-release" : "url-disabled" };
  }
  if (exteriorRolledBackReleaseNotice(input.explicitReleaseId, record) !== null) {
    return { streaming: false, releaseId, promotedDefault: false, reason: "rolled-back-release" };
  }
  if (input.override === "on") return { streaming: true, releaseId, promotedDefault, reason: "url-explicit" };
  if (promotable) return { streaming: true, releaseId, promotedDefault, reason: input.explicitReleaseId === null ? "promoted-default" : "explicit-release" };
  return { streaming: false, releaseId, promotedDefault: false, reason: record.enabled ? "no-real-base" : "not-promoted" };
}

/** One record's resolution, carrying the record that governed it. */
export interface ExteriorReleaseActivation extends ExteriorActivationResolution {
  record: ExteriorDefaultActivationRecord;
}

export interface ExteriorActivationSetInput {
  override: ExteriorStreamingOverride;
  explicitReleaseId: string | null;
  activeRealBaseReleaseId: string | null;
  fallbackReleaseId: string;
  records?: readonly ExteriorDefaultActivationRecord[];
}

export interface ExteriorActivationSetResolution {
  /** One resolution per promotion record, in the set's order. */
  releases: readonly ExteriorReleaseActivation[];
  /** The releases a load should actually target, deduplicated, in set order. */
  targets: readonly ExteriorReleaseActivation[];
  /** Whether ANY wave streams. */
  streaming: boolean;
  /**
   * The release explicit intent serializes and the toggle re-pins. It is the
   * first record's resolved release, which for a one-wave build is exactly the
   * single release this session resolved.
   */
  primaryReleaseId: string;
}

/** A build that promoted nothing has no wave to activate and none to refuse. */
const NO_PROMOTION: ExteriorDefaultActivationRecord = { enabled: false, releaseId: null, rolledBackReleaseId: null };

/**
 * Set-level resolution. Two URL rules, stated here because they are what makes
 * a multi-wave default set safe to link to:
 *
 * 1. `exteriorStreaming=off` (and the unpinned-parse variant) disables ALL
 *    default waves. "Off" has never meant "off except the ones you did not
 *    know about", and a session that switched exteriors off must not keep
 *    streaming one because a second wave was promoted later.
 * 2. `exteriorCells=X` means EXACTLY release X and nothing else. Explicit
 *    intent replaces the whole default set rather than adding to it: a link
 *    naming one release must render that release, not that release plus
 *    whatever else this build happens to promote, or the link would stop
 *    meaning what it said the day it was taken.
 *
 * Under rule 2 the governing record is the one that CLAIMS X — the enabled
 * record that publishes it, or the withdrawn record that rolled it back — so a
 * promotion-era bookmark into a wave this build withdrew is refused by that
 * wave's own record while the other waves stay enabled.
 */
export function resolveExteriorActivationSet(input: ExteriorActivationSetInput): ExteriorActivationSetResolution {
  const records = input.records ?? EXTERIOR_DEFAULT_ACTIVATIONS;
  let releases: readonly ExteriorReleaseActivation[];
  if (input.explicitReleaseId === null) {
    releases = records.map((record) => ({ ...resolveExteriorActivation({ ...input, record }), record }));
  } else {
    const claiming = records.find((record) => (
      record.enabled ? record.releaseId === input.explicitReleaseId : record.rolledBackReleaseId === input.explicitReleaseId
    )) ?? records[0] ?? NO_PROMOTION;
    releases = [{ ...resolveExteriorActivation({ ...input, record: claiming }), record: claiming }];
  }
  // Records that cannot promote all resolve the same fallback release, so the
  // target list is deduplicated: an enabled-by-override fixture session must
  // load one runtime, not one per promotion record.
  const seen = new Set<string>();
  const targets: ExteriorReleaseActivation[] = [];
  for (const entry of releases) {
    if (!entry.streaming || seen.has(entry.releaseId)) continue;
    seen.add(entry.releaseId);
    targets.push(entry);
  }
  return {
    releases,
    targets,
    streaming: targets.length > 0,
    primaryReleaseId: releases[0]?.releaseId ?? input.explicitReleaseId ?? input.fallbackReleaseId,
  };
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
    message: `Exterior streaming failed closed: the promoted default rendered ${unexpected.join(", ")}, which the accepted membership of release ${record.releaseId} (${record.approvalRef}) does not contain. No exterior geometry was rendered and no substitute release was selected.`,
  };
}

export interface ExteriorUnavailableInput {
  /** Whether THIS wave is streaming. Another wave streaming says nothing here. */
  streaming: boolean;
  override: ExteriorStreamingOverride;
  activeRealBaseReleaseId: string | null;
  /** A pinned release the URL named, so a refused opt-in can say why. */
  explicitReleaseId?: string | null;
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
  const rolledBack = exteriorRolledBackReleaseNotice(input.explicitReleaseId ?? null, record);
  if (rolledBack) return `${rolledBack} Base massing from release ${input.activeRealBaseReleaseId} is shown.`;
  if (input.override === "off") {
    return `Exterior streaming is switched off for this session, so base massing from release ${input.activeRealBaseReleaseId} is shown; no substitute exterior was selected.`;
  }
  // A typo in a link is not a session the user switched off, and saying so
  // would send them looking for a toggle they never touched.
  if (input.override === "off-unpinned") {
    return `The exterior release this link named is not pinned by this build, so exterior streaming stayed off and base massing from release ${input.activeRealBaseReleaseId} is shown; no substitute exterior was selected.`;
  }
  if (!record.enabled) {
    // Name WHICH wave: with more than one promoted wave, "the exterior wave"
    // would leave the reader unable to tell which one this build withdrew.
    return `The ${record.rolledBackReleaseId ?? "promoted"} exterior wave is not active in this build, so base massing from release ${input.activeRealBaseReleaseId} is shown; no substitute exterior was selected.`;
  }
  return null;
}

/**
 * The explicit-unavailable rule across the whole set: one statement per wave
 * that is not streaming, deduplicated because the session-wide reasons ("you
 * switched exteriors off", "this link named an unpinned release") are true of
 * every wave at once and must not be repeated once per promotion record.
 */
export function exteriorUnavailableStatements(input: {
  set: ExteriorActivationSetResolution;
  override: ExteriorStreamingOverride;
  activeRealBaseReleaseId: string | null;
  explicitReleaseId?: string | null;
}): readonly string[] {
  const seen = new Set<string>();
  const statements: string[] = [];
  for (const entry of input.set.releases) {
    const statement = exteriorUnavailableDetail({
      streaming: entry.streaming,
      override: input.override,
      activeRealBaseReleaseId: input.activeRealBaseReleaseId,
      explicitReleaseId: input.explicitReleaseId ?? null,
      record: entry.record,
    });
    if (statement === null || seen.has(statement)) continue;
    seen.add(statement);
    statements.push(statement);
  }
  return statements;
}
