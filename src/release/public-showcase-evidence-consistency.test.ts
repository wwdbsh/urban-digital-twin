/**
 * Consistency gates on the two COMMITTED records of this candidate:
 * `data/public-showcase-20260812/differential-audit.json` and
 * `.../smoke-evidence.json`.
 *
 * Both records are generated, and a generated record that nothing checks is a
 * record that can quietly stop being true. These tests re-read them and assert
 * they still agree with the manifest, still carry the numbers they claim, and —
 * the part that matters — still report the ZERO findings that make the
 * candidate's central claim ("no private byte, no undeclared private
 * identifier") a measurement rather than an assertion.
 *
 * They deliberately do NOT re-run the audit or the browser. Re-deriving a record
 * inside the suite that guards it proves only that the code is self-consistent.
 * These read what was committed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PUBLIC_SHOWCASE_BASE_PACKAGE_IDS,
  PUBLIC_SHOWCASE_BROWSER_IMPLICIT_PATHS,
  PUBLIC_SHOWCASE_CANDIDATE_ID,
  PUBLIC_SHOWCASE_DIGEST_SHA256,
  PUBLIC_SHOWCASE_STANDING_REFUSALS,
  PUBLIC_SHOWCASE_WAVES,
  showcaseApprovalFingerprint,
  showcaseApprovalId,
} from "./public-showcase-manifest.ts";

const RECORD_ROOT = "data/public-showcase-20260812";

function readRecord(name: string): Record<string, never> {
  return JSON.parse(new TextDecoder().decode(readFileSync(`${RECORD_ROOT}/${name}`))) as Record<string, never>;
}

const audit = readRecord("differential-audit.json") as unknown as {
  candidateId: string;
  manifestDigestSha256: string;
  allPassed: boolean;
  assemblyPosture: string;
  standingRefusals: Record<string, string>;
  totals: Record<string, number>;
  waves: {
    waveId: string;
    packageId: string;
    publicRootId: string;
    privateRootId: string;
    approvalId: string;
    approvalFingerprintSha256: string;
    passed: boolean;
    resolution: { declaredArtifacts: number; resolvedArtifacts: number; unresolved: unknown[]; artifactChecksumDigestSha256: string; unresolvedPayloadRefs: unknown[] };
    exclusion: { privateRootArtifacts: number; entries: { reachableInPayloadTree: boolean; reason: string }[] };
    nonReachability: { undeclaredReferences: unknown[]; privateBytesReachable: unknown[]; declaredDisclosures: unknown[]; declaredPrivateRootMetadata: unknown[]; declaredPrivatePathsMaterialized: unknown[] };
    fallbacks: { unavailableBuildingDetails: number; unexplainedFallbacks: number; distinctReasons: { reason: string; count: number }[] };
  }[];
  excludedPrivateReferencePackages: { packageId: string; privateFileCount: number; inShowcaseCandidate: boolean }[];
  excludedWorkingRecords: { directory: string; fileCount: number }[];
};

const smoke = readRecord("smoke-evidence.json") as unknown as {
  candidateId: string;
  manifestDigestSha256: string;
  allPassed: boolean;
  servedBundle: { matchesLocalDist: boolean; entryScriptNamesEveryPromotedRelease: boolean; entryScriptChecksumSha256: string };
  buildPartition: { passed: boolean; privateDirectories: string[]; materializedPrivatePaths: string[]; packages: { packageId: string; undeclaredPrivateReferences: unknown[] }[] };
  journeys: {
    journeyId: string;
    passed: boolean;
    network?: {
      externalHosts: string[];
      refusals: unknown[];
      noRequestDropped: boolean;
      everyRequestClassified: boolean;
      observedDistinctUrls: number;
      attemptedDistinctUrls: number;
      receivedDistinctUrls: number;
      failedRequestUrls: string[];
      classifiedTotal: number;
      perWave: Record<string, { observedRequests: number; distinctArtifacts: number; glbObservedRequests: number }>;
      perBasePackage: Record<string, { observedRequests: number }>;
      appShellObservedRequests: number;
      browserImplicit: { path: string; status: number | null; encodedDataLength: number; answeredWithoutPayload: boolean }[];
      browserImplicitCount: number;
      browserImplicitAnsweredWithPayload: unknown[];
    };
    waves?: string[];
    servedPrivateBytes?: unknown[];
    unexplainedResponses?: unknown[];
    probeCount?: number;
    readings?: Record<string, unknown>;
  }[];
};

describe("both committed records describe THIS candidate", () => {
  it("carries the pinned manifest digest", () => {
    expect(audit.candidateId).toBe(PUBLIC_SHOWCASE_CANDIDATE_ID);
    expect(smoke.candidateId).toBe(PUBLIC_SHOWCASE_CANDIDATE_ID);
    expect(audit.manifestDigestSha256).toBe(PUBLIC_SHOWCASE_DIGEST_SHA256);
    expect(smoke.manifestDigestSha256).toBe(PUBLIC_SHOWCASE_DIGEST_SHA256);
  });

  it("restates the standing refusals verbatim, including the anti-assembly clause", () => {
    expect(audit.standingRefusals.crossWaveAssembly).toBe(PUBLIC_SHOWCASE_STANDING_REFUSALS.crossWaveAssembly);
    expect(audit.standingRefusals.publicInternetDeployment).toBe(PUBLIC_SHOWCASE_STANDING_REFUSALS.publicInternetDeployment);
    expect(audit.standingRefusals.tileRedistribution).toBe(PUBLIC_SHOWCASE_STANDING_REFUSALS.tileRedistribution);
    expect(audit.assemblyPosture).toContain("not a new redistributable whole");
  });
});

describe("the differential audit record still reports what it claims", () => {
  it("covers exactly the six enumerated waves, with the manifest's own identifiers", () => {
    expect(audit.waves.map((wave) => wave.waveId)).toEqual(PUBLIC_SHOWCASE_WAVES.map((wave) => wave.waveId));
    audit.waves.forEach((recorded, index) => {
      const wave = PUBLIC_SHOWCASE_WAVES[index]!;
      expect(recorded.packageId).toBe(wave.packageId);
      expect(recorded.publicRootId).toBe(wave.publicRootId);
      expect(recorded.privateRootId).toBe(wave.privateRootId);
      expect(recorded.approvalId).toBe(showcaseApprovalId(wave));
      expect(recorded.approvalFingerprintSha256).toBe(showcaseApprovalFingerprint(wave));
      // The independent per-wave digest is the manifest's, recomputed from bytes.
      expect(recorded.resolution.artifactChecksumDigestSha256).toBe(wave.artifactChecksumDigestSha256);
      expect(recorded.resolution.declaredArtifacts).toBe(wave.artifactCount);
    });
  });

  /** AC (1): every declared asset resolves. */
  it("resolves every declared artifact and every declared payload reference", () => {
    for (const wave of audit.waves) {
      expect(wave.resolution.resolvedArtifacts).toBe(wave.resolution.declaredArtifacts);
      expect(wave.resolution.unresolved).toEqual([]);
      expect(wave.resolution.unresolvedPayloadRefs).toEqual([]);
      expect(wave.passed).toBe(true);
    }
    expect(audit.totals.resolvedArtifacts).toBe(audit.totals.declaredArtifacts);
    expect(audit.totals.unresolvedArtifacts).toBe(0);
    expect(audit.totals.unresolvedPayloadRefs).toBe(0);
    expect(audit.allPassed).toBe(true);
  });

  /** AC (1) again, the other half: NO private/restricted asset. */
  it("reports zero reachable private bytes and zero undeclared private references", () => {
    for (const wave of audit.waves) {
      expect(wave.nonReachability.privateBytesReachable).toEqual([]);
      expect(wave.nonReachability.undeclaredReferences).toEqual([]);
      expect(wave.nonReachability.declaredPrivatePathsMaterialized).toEqual([]);
      for (const entry of wave.exclusion.entries) expect(entry.reachableInPayloadTree).toBe(false);
    }
    expect(audit.totals.privateBytesReachable).toBe(0);
    expect(audit.totals.undeclaredPrivateReferences).toBe(0);
    expect(audit.totals.declaredPrivatePathsMaterialized).toBe(0);
  });

  /**
   * The declared disclosures are ACCEPTED, so they must stay small and
   * enumerated. If this count ever grows, something started naming private
   * material in a new place and that deserves a decision, not a passing test.
   */
  it("keeps the accepted disclosures bounded and enumerated", () => {
    expect(audit.totals.declaredDisclosures).toBe(24);
    expect(audit.totals.declaredPrivateRootMetadata).toBe(36);
    for (const wave of audit.waves) {
      expect(wave.nonReachability.declaredDisclosures.length).toBe(4);
      expect(wave.nonReachability.declaredPrivateRootMetadata.length).toBe(6);
    }
  });

  /** AC (2): every exclusion and every fallback is explained. */
  it("explains every exclusion and every tombstone", () => {
    expect(audit.totals.privateRootArtifactsExcluded).toBe(6);
    for (const wave of audit.waves) {
      expect(wave.exclusion.privateRootArtifacts).toBe(1);
      for (const entry of wave.exclusion.entries) expect(entry.reason.length).toBeGreaterThan(20);
      for (const reason of wave.fallbacks.distinctReasons) {
        expect(reason.reason).not.toBe("(no reason stated)");
        expect(reason.count).toBeGreaterThan(0);
      }
      expect(wave.fallbacks.unexplainedFallbacks).toBe(0);
    }
    expect(audit.totals.unexplainedFallbacks).toBe(0);
    expect(audit.totals.unavailableBuildingDetails).toBe(44_710);
  });

  it("names the private reference packages and working records it excludes", () => {
    const packages = audit.excludedPrivateReferencePackages.map((entry) => entry.packageId);
    expect(packages).toEqual([
      "manhattan-esb-block-reference-20260810",
      "manhattan-esb-block-reference-20260811",
      "manhattan-esb-block-reference-20260811-v3",
      "manhattan-esb-block-reference-20260811-v3e",
    ]);
    for (const entry of audit.excludedPrivateReferencePackages) {
      expect(entry.inShowcaseCandidate).toBe(false);
      expect(entry.privateFileCount).toBeGreaterThan(0);
    }
    expect(audit.totals.privateReferencePackageFiles).toBe(116);
    expect(audit.excludedWorkingRecords.length).toBeGreaterThanOrEqual(18);
    for (const record of audit.excludedWorkingRecords) expect(record.fileCount).toBeGreaterThan(0);
  });
});

describe("the smoke record still reports what it claims", () => {
  it("was measured against this repository's own build", () => {
    expect(smoke.servedBundle.matchesLocalDist).toBe(true);
    expect(smoke.servedBundle.entryScriptNamesEveryPromotedRelease).toBe(true);
    expect(smoke.servedBundle.entryScriptChecksumSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  /** AC (3), build half: nothing private survived into the browser-reachable tree. */
  it("reports a build output with no private partition and no undeclared reference", () => {
    expect(smoke.buildPartition.passed).toBe(true);
    expect(smoke.buildPartition.privateDirectories).toEqual([]);
    expect(smoke.buildPartition.materializedPrivatePaths).toEqual([]);
    expect(smoke.buildPartition.packages.map((entry) => entry.packageId)).toEqual(PUBLIC_SHOWCASE_WAVES.map((wave) => wave.packageId));
    for (const entry of smoke.buildPartition.packages) expect(entry.undeclaredPrivateReferences).toEqual([]);
  });

  /** AC (3), request half: every request stayed inside the candidate. */
  it("reports a default six-wave session whose every request was classified", () => {
    const journey = smoke.journeys.find((entry) => entry.journeyId === "six-wave-default")!;
    expect(journey.passed).toBe(true);
    expect(journey.waves).toEqual(PUBLIC_SHOWCASE_WAVES.map((wave) => wave.publicReleaseId));
    expect(journey.network!.refusals).toEqual([]);
    expect(journey.network!.externalHosts).toEqual([]);
    expect(journey.network!.noRequestDropped).toBe(true);
    expect(journey.network!.everyRequestClassified).toBe(true);
    // The measurement is over ATTEMPTED requests, not merely received ones, so
    // a blocked or failed request cannot hide from the containment claim. These
    // two numbers differ in the committed record, which is the whole reason the
    // observed set is built from requestWillBeSent.
    expect(journey.network!.observedDistinctUrls).toBe(journey.network!.attemptedDistinctUrls);
    expect(journey.network!.observedDistinctUrls).toBeGreaterThanOrEqual(journey.network!.receivedDistinctUrls);
    expect(journey.network!.classifiedTotal).toBe(journey.network!.observedDistinctUrls);
    expect(journey.network!.failedRequestUrls).toEqual([]);
    // Every enumerated wave actually served bytes: a "contained" session that
    // fetched nothing would satisfy containment and prove nothing.
    for (const wave of PUBLIC_SHOWCASE_WAVES) expect(journey.network!.perWave[wave.publicReleaseId]!.observedRequests).toBeGreaterThan(0);
    expect(Object.keys(journey.network!.perBasePackage)).toEqual([...PUBLIC_SHOWCASE_BASE_PACKAGE_IDS]);
    for (const packageId of PUBLIC_SHOWCASE_BASE_PACKAGE_IDS) {
      expect(journey.network!.perBasePackage[packageId]!.observedRequests).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * The T029 repair of the T023 reproducibility finding, asserted on the
   * COMMITTED record rather than only in the classifier's unit tests.
   */
  it("classifies the browser-implicit requests a fresh profile issues, and none of them served bytes", () => {
    const journey = smoke.journeys.find((entry) => entry.journeyId === "six-wave-default")!;
    const network = journey.network!;
    // The record must carry the field at all: an older record that predates the
    // repair would silently satisfy an `undefined`-tolerant assertion.
    expect(Array.isArray(network.browserImplicit)).toBe(true);
    expect(network.browserImplicitCount).toBe(network.browserImplicit.length);
    // Classification is not exemption: every one is reported WITH its answer,
    // and the candidate ships no such file, so none may have served bytes.
    for (const entry of network.browserImplicit) {
      expect({ path: entry.path, answeredWithoutPayload: entry.answeredWithoutPayload }).toEqual({ path: entry.path, answeredWithoutPayload: true });
      // A refusal status is what makes it admissible; the byte count is
      // recorded beside it because a 404 body is not zero bytes on the wire.
      expect(entry.status === null || entry.status >= 400 || entry.encodedDataLength === 0).toBe(true);
      expect(PUBLIC_SHOWCASE_BROWSER_IMPLICIT_PATHS).toContain(entry.path);
    }
    expect(network.browserImplicitAnsweredWithPayload).toEqual([]);
    // And they are inside the accounting, not beside it.
    expect(network.classifiedTotal).toBe(network.observedDistinctUrls);
  });

  it("reports that no declared private path served its private bytes", () => {
    const journey = smoke.journeys.find((entry) => entry.journeyId === "private-paths-unreachable")!;
    expect(journey.passed).toBe(true);
    expect(journey.probeCount).toBe(10);
    expect(journey.servedPrivateBytes).toEqual([]);
    expect(journey.unexplainedResponses).toEqual([]);
  });

  /** AC (3), provenance half. */
  it("reports a pick whose panel is provenanced and claims no facade accuracy", () => {
    const journey = smoke.journeys.find((entry) => entry.journeyId === "pick-provenance")!;
    expect(journey.passed).toBe(true);
    expect(journey.readings!.carriesChecksum).toBe(true);
    expect(journey.readings!.namesGeneratedTier).toBe(true);
    expect(journey.readings!.carriesUncertainty).toBe(true);
    expect(journey.readings!.namesAttribution).toBe(true);
    expect(journey.readings!.claimsRealFacadeAccuracy).toBe(false);
  });

  it("passed as a whole", () => {
    expect(smoke.allPassed).toBe(true);
    expect(smoke.journeys.every((journey) => journey.passed)).toBe(true);
  });
});
