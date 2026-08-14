/**
 * Fail-closed availability gate for the pinned citywide snapshot (Task T001).
 *
 * Every wave CLI, the full-snapshot dry run and this goal's overview census all
 * regenerate deterministically from ONE set of source bytes: the gitignored
 * `manhattan-citywide-20260804` release whose `manifest.json` hashes to
 * `EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256`. Those bytes are not in git, they
 * are reached through a symlink in every Orca worktree, and their absence or
 * drift is the single most likely reason a "deterministic" measurement silently
 * describes something other than the snapshot it claims to describe.
 *
 * Each CLI re-implements its own inline version of this check. This module is
 * the shared, unit-testable one: it takes an already-performed probe (so the
 * decision logic has no I/O and can be tested against synthetic bytes) and
 * returns either `ok` or a list of stops with an operator message that names
 * the path, the expectation and the action.
 *
 * It is a GATE, not a repair. It never acquires, replaces, downloads or
 * regenerates anything. A stop means: stop, and hand the named action to an
 * operator.
 */
import { sha256HexSync } from "../domain/deterministic-hash.ts";
import {
  EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
} from "../domain/exterior-fullsnapshot-input.ts";

export const CITYWIDE_SNAPSHOT_GATE_SCHEMA_VERSION = "1.0" as const;

/**
 * Every way the gate can refuse, in the order it checks them. A code is part of
 * the contract: operator runbooks and tests key off it, so codes are added
 * rather than renamed.
 */
export const CITYWIDE_SNAPSHOT_GATE_STOP_CODES = [
  "snapshot-root-absent",
  "manifest-unreadable",
  "recorded-checksum-unreadable",
  "recorded-checksum-mismatch",
  "pinned-checksum-mismatch",
  "manifest-unparsable",
  "release-id-mismatch",
  "fixture-only-snapshot",
  "geometry-shards-absent",
] as const;
export type CitywideSnapshotGateStopCode = (typeof CITYWIDE_SNAPSHOT_GATE_STOP_CODES)[number];

/**
 * The result of looking at the filesystem. The caller performs the I/O; this
 * module decides. `null` always means "could not be read", never "empty".
 */
export interface CitywideSnapshotProbe {
  /** Absolute path probed, quoted verbatim in the operator message. */
  snapshotRoot: string;
  /** Whether `snapshotRoot` resolves to a directory (following symlinks). */
  snapshotRootPresent: boolean;
  /** Contents of `manifest.json`, or `null` when it could not be read. */
  manifestText: string | null;
  /** Contents of `manifest.sha256`, or `null` when it could not be read. */
  recordedChecksumText: string | null;
  /**
   * Number of `*.json` files found under `geometry/buildings/`, or `null` when
   * the directory could not be listed. The census reads every one of them, so
   * an intact manifest beside an empty geometry tree is a stop, not a pass.
   */
  buildingShardFileCount: number | null;
}

export interface CitywideSnapshotGateStop {
  code: CitywideSnapshotGateStopCode;
  detail: string;
  /** What an operator must do. Never "the tool will fix it". */
  operatorAction: string;
}

export interface CitywideSnapshotGateResult {
  schemaVersion: typeof CITYWIDE_SNAPSHOT_GATE_SCHEMA_VERSION;
  ok: boolean;
  snapshotRoot: string;
  expectedReleaseId: string;
  pinnedManifestChecksumSha256: string;
  /** Re-derived from the probed bytes; `null` when the manifest was unreadable. */
  observedManifestChecksumSha256: string | null;
  /** The first whitespace-delimited token of `manifest.sha256`; `null` when unreadable. */
  recordedManifestChecksumSha256: string | null;
  buildingShardFileCount: number | null;
  stops: CitywideSnapshotGateStop[];
  /** Multi-line, operator-facing. Safe to print verbatim to stderr. */
  message: string;
}

export interface CitywideSnapshotGateExpectation {
  expectedReleaseId?: string;
  pinnedManifestChecksumSha256?: string;
  /**
   * Minimum building-shard file count. Defaults to 1: the gate proves the
   * geometry tree is non-empty, and leaves "is it the RIGHT count" to the
   * per-shard checksum verification the consumers already run.
   */
  minimumBuildingShardFileCount?: number;
}

function firstToken(value: string): string {
  return value.trim().split(/\s+/u)[0] ?? "";
}

/** `null` for anything that is not a JSON object, including a parse failure. */
function parseManifest(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether the probed snapshot may be used as a measurement base.
 *
 * Checks run in dependency order and later checks are skipped once their input
 * is known-bad, so the message names the ROOT cause rather than a cascade.
 */
export function verifyCitywideSnapshot(
  probe: CitywideSnapshotProbe,
  expectation: CitywideSnapshotGateExpectation = {},
): CitywideSnapshotGateResult {
  const expectedReleaseId = expectation.expectedReleaseId ?? EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID;
  const pinned = expectation.pinnedManifestChecksumSha256 ?? EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256;
  const minimumShards = expectation.minimumBuildingShardFileCount ?? 1;
  const stops: CitywideSnapshotGateStop[] = [];
  const observed = probe.manifestText === null ? null : sha256HexSync(probe.manifestText);
  const recorded = probe.recordedChecksumText === null ? null : firstToken(probe.recordedChecksumText);

  if (!probe.snapshotRootPresent) {
    stops.push({
      code: "snapshot-root-absent",
      detail: `No directory resolves at ${probe.snapshotRoot}.`,
      operatorAction: `Publish or link the approved local release ${expectedReleaseId} at that path. In an Orca worktree this path is normally a symlink into the main checkout's public/data/; a broken link reads exactly like an absent snapshot. This gate never acquires data.`,
    });
  } else if (probe.manifestText === null) {
    stops.push({
      code: "manifest-unreadable",
      detail: `${probe.snapshotRoot}/manifest.json could not be read.`,
      operatorAction: "Restore the release directory from the approved local publication; do not hand-write a manifest.",
    });
  } else {
    if (probe.recordedChecksumText === null) {
      stops.push({
        code: "recorded-checksum-unreadable",
        detail: `${probe.snapshotRoot}/manifest.sha256 could not be read, so the manifest cannot be checked against its own recorded digest.`,
        operatorAction: "Restore the release directory from the approved local publication.",
      });
    } else if (recorded !== observed) {
      stops.push({
        code: "recorded-checksum-mismatch",
        detail: `manifest.sha256 records ${recorded || "(empty)"} but manifest.json hashes to ${observed}.`,
        operatorAction: "The local snapshot is internally inconsistent (partial copy or local edit). Re-publish it; do not update the sidecar to match.",
      });
    }
    if (observed !== pinned) {
      stops.push({
        code: "pinned-checksum-mismatch",
        detail: `manifest.json hashes to ${observed}, not the pinned base ${pinned}.`,
        operatorAction: `Every deterministic constant in this repository — the generation instant, plan hashes, the ledger, every wave's committed evidence — is defined only relative to ${pinned}. A different snapshot needs a new pin and a recorded decision, not a re-run.`,
      });
    }
    const manifest = parseManifest(probe.manifestText);
    if (manifest === null) {
      stops.push({
        code: "manifest-unparsable",
        detail: "manifest.json is not a JSON object.",
        operatorAction: "Restore the release directory from the approved local publication.",
      });
    } else {
      if (manifest.releaseId !== expectedReleaseId) {
        stops.push({
          code: "release-id-mismatch",
          detail: `manifest.releaseId is ${JSON.stringify(manifest.releaseId)}, expected ${JSON.stringify(expectedReleaseId)}.`,
          operatorAction: "Point the gate at the pinned base release, or record a decision that changes the base.",
        });
      }
      if (manifest.fixtureOnly !== false) {
        stops.push({
          code: "fixture-only-snapshot",
          detail: `manifest.fixtureOnly is ${JSON.stringify(manifest.fixtureOnly)}; a fixture snapshot must never back a measurement that is reported as citywide.`,
          operatorAction: "Use the real published local release; fixture bytes may not be measured and reported as the city.",
        });
      }
    }
  }

  if (probe.snapshotRootPresent && (probe.buildingShardFileCount === null || probe.buildingShardFileCount < minimumShards)) {
    stops.push({
      code: "geometry-shards-absent",
      detail: probe.buildingShardFileCount === null
        ? `${probe.snapshotRoot}/geometry/buildings could not be listed.`
        : `${probe.snapshotRoot}/geometry/buildings holds ${probe.buildingShardFileCount} shard files, below the required ${minimumShards}.`,
      operatorAction: "Restore the full release directory. A manifest without its geometry tree passes a checksum check and still cannot be censused.",
    });
  }

  const ok = stops.length === 0;
  const header = ok
    ? `Citywide snapshot gate PASS — ${expectedReleaseId} at ${probe.snapshotRoot} matches the pinned manifest checksum ${pinned}.`
    : `Citywide snapshot gate STOP — the pinned base ${expectedReleaseId} is not usable as a measurement base.`;
  const body = ok
    ? [`Building geometry shard files: ${probe.buildingShardFileCount ?? 0}.`]
    : stops.flatMap((stop) => [`  [${stop.code}] ${stop.detail}`, `      action: ${stop.operatorAction}`]);
  return {
    schemaVersion: CITYWIDE_SNAPSHOT_GATE_SCHEMA_VERSION,
    ok,
    snapshotRoot: probe.snapshotRoot,
    expectedReleaseId,
    pinnedManifestChecksumSha256: pinned,
    observedManifestChecksumSha256: observed,
    recordedManifestChecksumSha256: recorded,
    buildingShardFileCount: probe.buildingShardFileCount,
    stops,
    message: [header, ...body].join("\n"),
  };
}
