import { describe, expect, it } from "vitest";

import { sha256HexSync } from "../domain/deterministic-hash.ts";
import {
  EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256,
  EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID,
} from "../domain/exterior-fullsnapshot-input.ts";
import {
  verifyCitywideSnapshot,
  type CitywideSnapshotProbe,
} from "./citywide-snapshot-gate.ts";

const RELEASE_ID = "fixture-citywide-release";
const MANIFEST_TEXT = JSON.stringify({ releaseId: RELEASE_ID, fixtureOnly: false, layers: [] });
const MANIFEST_SHA256 = sha256HexSync(MANIFEST_TEXT);
const EXPECTATION = { expectedReleaseId: RELEASE_ID, pinnedManifestChecksumSha256: MANIFEST_SHA256 };

function probe(overrides: Partial<CitywideSnapshotProbe> = {}): CitywideSnapshotProbe {
  return {
    snapshotRoot: "/fixture/public/data/fixture-citywide-release",
    snapshotRootPresent: true,
    manifestText: MANIFEST_TEXT,
    recordedChecksumText: `${MANIFEST_SHA256}  manifest.json\n`,
    buildingShardFileCount: 56,
    ...overrides,
  };
}

function codes(result: ReturnType<typeof verifyCitywideSnapshot>): string[] {
  return result.stops.map((stop) => stop.code);
}

describe("verifyCitywideSnapshot", () => {
  it("passes only when every condition holds, and re-derives the checksum from the probed bytes", () => {
    const result = verifyCitywideSnapshot(probe(), EXPECTATION);
    expect(result.ok).toBe(true);
    expect(result.stops).toEqual([]);
    expect(result.observedManifestChecksumSha256).toBe(MANIFEST_SHA256);
    expect(result.recordedManifestChecksumSha256).toBe(MANIFEST_SHA256);
    expect(result.message).toContain("PASS");
  });

  it("defaults to the ADR 0025 pin, so a caller that passes no expectation still gates on the real base", () => {
    const result = verifyCitywideSnapshot(probe({ manifestText: null, snapshotRootPresent: false }));
    expect(result.expectedReleaseId).toBe(EXTERIOR_FULLSNAPSHOT_BASE_RELEASE_ID);
    expect(result.pinnedManifestChecksumSha256).toBe(EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256);
    expect(EXTERIOR_FULLSNAPSHOT_BASE_MANIFEST_SHA256).toBe(
      "acb5a9b52014f86535c8478e7d4e516efc03f6dff95c17e9896dfea4413c203c",
    );
  });

  it("stops on an absent snapshot root and names the worktree symlink case, without cascading", () => {
    const result = verifyCitywideSnapshot(probe({ snapshotRootPresent: false }), EXPECTATION);
    expect(result.ok).toBe(false);
    expect(codes(result)).toEqual(["snapshot-root-absent"]);
    expect(result.stops[0]!.operatorAction).toContain("symlink");
    expect(result.stops[0]!.operatorAction).toContain("never acquires data");
  });

  it("stops on an unreadable manifest without also reporting the derived-checksum failures", () => {
    const result = verifyCitywideSnapshot(probe({ manifestText: null }), EXPECTATION);
    expect(codes(result)).toEqual(["manifest-unreadable"]);
    expect(result.observedManifestChecksumSha256).toBeNull();
  });

  it("stops when the sidecar disagrees with the bytes, and refuses to suggest rewriting the sidecar", () => {
    const result = verifyCitywideSnapshot(probe({ recordedChecksumText: `${"0".repeat(64)}  manifest.json` }), EXPECTATION);
    expect(codes(result)).toEqual(["recorded-checksum-mismatch"]);
    expect(result.stops[0]!.operatorAction).toContain("do not update the sidecar");
  });

  it("stops when the sidecar is unreadable", () => {
    const result = verifyCitywideSnapshot(probe({ recordedChecksumText: null }), EXPECTATION);
    expect(codes(result)).toEqual(["recorded-checksum-unreadable"]);
  });

  it("stops when the bytes are self-consistent but are not the pinned base", () => {
    const other = JSON.stringify({ releaseId: RELEASE_ID, fixtureOnly: false, layers: [], drift: 1 });
    const result = verifyCitywideSnapshot(
      probe({ manifestText: other, recordedChecksumText: sha256HexSync(other) }),
      EXPECTATION,
    );
    expect(codes(result)).toEqual(["pinned-checksum-mismatch"]);
    expect(result.stops[0]!.operatorAction).toContain("recorded decision");
  });

  it("stops on an unparsable manifest", () => {
    const broken = "{not json";
    const result = verifyCitywideSnapshot(
      probe({ manifestText: broken, recordedChecksumText: sha256HexSync(broken) }),
      { ...EXPECTATION, pinnedManifestChecksumSha256: sha256HexSync(broken) },
    );
    expect(codes(result)).toEqual(["manifest-unparsable"]);
  });

  it("stops on a release-id mismatch and on a fixture-only snapshot", () => {
    const fixture = JSON.stringify({ releaseId: "some-other-release", fixtureOnly: true, layers: [] });
    const result = verifyCitywideSnapshot(
      probe({ manifestText: fixture, recordedChecksumText: sha256HexSync(fixture) }),
      { ...EXPECTATION, pinnedManifestChecksumSha256: sha256HexSync(fixture) },
    );
    expect(codes(result)).toEqual(["release-id-mismatch", "fixture-only-snapshot"]);
  });

  it("stops when the manifest is intact but the geometry tree is empty or unlistable", () => {
    expect(codes(verifyCitywideSnapshot(probe({ buildingShardFileCount: 0 }), EXPECTATION))).toEqual(["geometry-shards-absent"]);
    expect(codes(verifyCitywideSnapshot(probe({ buildingShardFileCount: null }), EXPECTATION))).toEqual(["geometry-shards-absent"]);
    const belowFloor = verifyCitywideSnapshot(probe({ buildingShardFileCount: 3 }), { ...EXPECTATION, minimumBuildingShardFileCount: 56 });
    expect(codes(belowFloor)).toEqual(["geometry-shards-absent"]);
  });

  it("reports every independent stop at once so an operator sees the whole repair, not one round trip at a time", () => {
    const fixture = JSON.stringify({ releaseId: "other", fixtureOnly: true, layers: [] });
    const result = verifyCitywideSnapshot(
      probe({ manifestText: fixture, recordedChecksumText: "deadbeef", buildingShardFileCount: 0 }),
      EXPECTATION,
    );
    expect(codes(result)).toEqual([
      "recorded-checksum-mismatch",
      "pinned-checksum-mismatch",
      "release-id-mismatch",
      "fixture-only-snapshot",
      "geometry-shards-absent",
    ]);
    for (const stop of result.stops) expect(result.message).toContain(stop.code);
  });
});
