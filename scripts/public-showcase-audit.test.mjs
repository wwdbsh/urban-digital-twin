/* global Buffer */
/**
 * Gates on the private/public differential audit.
 *
 * An audit that only ever reports a pass is worthless, and the six real waves
 * do not leak, so the only way to prove this one detects a leak is to build a
 * package that HAS one and require the audit to name it. Every test below that
 * plants something is written in the pre-fix-failing form: it asserts the
 * planted identifier appears in the finding by name, so an audit that reported
 * "1 problem" without saying which would fail here too.
 *
 * Written as `.mjs` under `scripts/` because it drives the CLI module directly
 * and touches `node:fs` on a throwaway tree.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/** This repository's own data/ tree, resolved from this file rather than from the process cwd. */
const repositoryDataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

import {
  ACCEPTED_DISCLOSURE_IDENTIFIER_KINDS,
  AUDITED_WORKING_RECORD_DIRECTORIES,
  auditWorkingRecords,
  DECLARED_PRIVATE_ROOT_KEYS,
  EXCLUSION_REASONS,
  auditPrivateReferencePackages,
  auditWave,
  privateRootPathPrefix,
  restrictedIdentifiersFor,
  runPublicShowcaseAudit,
  scanArtifactForRestricted,
  walkFiles,
} from "./public-showcase-audit-cli.mjs";
import { answeredWithoutPayload } from "./public-showcase-smoke-cli.mjs";

const PRIVATE_ROOT_ID = "root:fixture-showcase-wave:private";
const PUBLIC_ROOT_ID = "root:fixture-showcase-wave:public";
const PRIVATE_ARTIFACT_PATH = "private/ownership-ledger/ownership-ledger-fixture.json";

function sha256(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/**
 * A minimal but structurally faithful package: two roots, a public artifact
 * that resolves, and a private root whose one artifact is never materialized —
 * exactly the shape the six real waves have.
 */
function buildFixturePackage(root, { plant } = {}) {
  const packageId = "fixture-showcase-wave";
  const packageRoot = join(root, packageId);
  const ledgerBody = `${JSON.stringify({ ledgerId: "ownership-ledger:fixture" }, null, 2)}\n`;
  const ledgerRef = "public/ownership-ledger/ownership-ledger-fixture.json";
  mkdirSync(dirname(join(packageRoot, ledgerRef)), { recursive: true });
  writeFileSync(join(packageRoot, ledgerRef), ledgerBody, "utf8");

  const publicArtifact = {
    logicalId: "ownership-ledger:fixture",
    kind: "ownership-ledger",
    relativeRef: ledgerRef,
    byteSize: Buffer.byteLength(ledgerBody, "utf8"),
    checksumSha256: sha256(ledgerBody),
  };
  const privateArtifact = {
    logicalId: "ownership-ledger:fixture",
    kind: "ownership-ledger",
    relativeRef: PRIVATE_ARTIFACT_PATH,
    byteSize: 11,
    checksumSha256: "d".repeat(64),
  };
  const privateRoot = {
    schemaVersion: "1.0",
    audience: "private",
    rootId: PRIVATE_ROOT_ID,
    releaseId: "fixture-showcase-wave-private",
    artifactAllowlist: [PRIVATE_ARTIFACT_PATH, ...(plant?.extraAllowlistRef ? [plant.extraAllowlistRef] : [])],
    artifacts: [privateArtifact],
    rootChecksumSha256: "e".repeat(64),
  };
  const publicRoot = {
    schemaVersion: "1.0",
    audience: "public",
    rootId: PUBLIC_ROOT_ID,
    releaseId: packageId,
    artifactAllowlist: [ledgerRef],
    artifacts: [publicArtifact],
    approval: { id: "approval:fixture", fingerprintSha256: "f".repeat(64), scope: "fixture", exclusions: ["public internet deployment"], approvedAt: "2026-08-12T00:00:00.000Z" },
    privatePredecessor: { rootId: PRIVATE_ROOT_ID, rootChecksumSha256: "e".repeat(64) },
    rootChecksumSha256: "a".repeat(64),
    ...(plant?.publicRootField ?? {}),
  };
  const graph = { schemaVersion: "1.0", roots: [privateRoot, publicRoot], cellReleases: [], inventoryShards: [], evidenceShards: [], snapshots: [] };
  writeFileSync(join(packageRoot, "release-graph.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
  writeFileSync(join(packageRoot, "index.json"), `${JSON.stringify({ releaseId: packageId, audience: "public", ...(plant?.indexField ?? {}) }, null, 2)}\n`, "utf8");
  writeFileSync(join(packageRoot, "assemblies.json"), `${JSON.stringify([{ packageId: "assembly:fixture", audience: "public", assets: [], artifacts: [] }], null, 2)}\n`, "utf8");

  if (plant?.publicFile) {
    const planted = join(packageRoot, plant.publicFile.relativeRef);
    mkdirSync(dirname(planted), { recursive: true });
    writeFileSync(planted, plant.publicFile.body, "utf8");
  }

  const wave = {
    waveId: "fixture",
    packageId,
    cityId: "city:fixture",
    configId: "config:fixture",
    publicRootId: PUBLIC_ROOT_ID,
    publicReleaseId: packageId,
    publicRootChecksumSha256: "a".repeat(64),
    artifactCount: 1,
    artifactByteTotal: publicArtifact.byteSize,
    artifactChecksumDigestSha256: sha256(`${ledgerRef} ${publicArtifact.checksumSha256} ${publicArtifact.byteSize}\n`),
    privateRootId: PRIVATE_ROOT_ID,
    privateRootChecksumSha256: "e".repeat(64),
    privateArtifactCount: 1,
    textureAdmission: "texture-free",
    attribution: "fixture",
    fidelity: { geometryTier: "generated", designedAppearance: "fixture", uncertainty: "fixture" },
    rights: { instrument: publicRoot.approval, redistribution: "generated-geometry-covered" },
  };
  return { wave, publicDataDir: root, packageRoot };
}

function withFixture(plant, run) {
  const root = mkdtempSync(join(tmpdir(), "udt-showcase-audit-"));
  try {
    return run(buildFixturePackage(root, { plant }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the differential audit passes a clean package", () => {
  it("resolves the declared public artifact and names the excluded private one", () => {
    withFixture(undefined, ({ wave, publicDataDir }) => {
      const report = auditWave(wave, { publicDataDir });
      expect(report.passed).toBe(true);
      expect(report.resolution.resolvedArtifacts).toBe(1);
      expect(report.resolution.unresolved).toEqual([]);
      expect(report.exclusion.entries).toHaveLength(1);
      expect(report.exclusion.entries[0].relativeRef).toBe(PRIVATE_ARTIFACT_PATH);
      expect(report.exclusion.entries[0].reason).toBe(EXCLUSION_REASONS.unmaterializedByDesign);
      expect(report.exclusion.entries[0].reachableInPayloadTree).toBe(false);
      expect(report.nonReachability.undeclaredReferences).toEqual([]);
      expect(report.nonReachability.privateBytesReachable).toEqual([]);
    });
  });

  it("counts the schema-mandated private-root block separately from the provenance citation", () => {
    withFixture(undefined, ({ wave, publicDataDir }) => {
      const report = auditWave(wave, { publicDataDir });
      // privatePredecessor.rootId + .rootChecksumSha256 on the public root.
      expect(report.nonReachability.declaredDisclosures.length).toBe(2);
      // The private root's own id, releaseId, checksum, allowlisted path,
      // artifact path and artifact checksum.
      expect(report.nonReachability.declaredPrivateRootMetadata.length).toBeGreaterThanOrEqual(5);
      for (const finding of report.nonReachability.declaredPrivateRootMetadata) {
        expect(finding.jsonPath.startsWith("roots[0].")).toBe(true);
      }
    });
  });
});

describe("the differential audit catches a planted leak BY NAME", () => {
  /**
   * The load-bearing test. A private root id smuggled into a public-root field
   * that is NOT `privatePredecessor` must fail, even though the very same
   * string is accepted two fields away.
   */
  it("refuses a private root id placed outside its declared field", () => {
    withFixture({ publicRootField: { note: `derived from ${PRIVATE_ROOT_ID}` } }, ({ wave, publicDataDir }) => {
      const report = auditWave(wave, { publicDataDir });
      expect(report.passed).toBe(false);
      const finding = report.nonReachability.undeclaredReferences.find((entry) => entry.identifier === PRIVATE_ROOT_ID);
      expect(finding).toBeDefined();
      expect(finding.relativeRef).toBe("release-graph.json");
      expect(finding.jsonPath).toBe("roots[1].note");
      expect(finding.identifierKind).toBe("private-root-id");
      expect(finding.classification).toBe("undeclared-private-reference");
    });
  });

  it("refuses a private artifact path smuggled into a public artifact's bytes", () => {
    withFixture({ publicFile: { relativeRef: "public/evidence/evidence-fixture.json", body: `${JSON.stringify({ sourceRef: PRIVATE_ARTIFACT_PATH }, null, 2)}\n` } }, ({ wave, publicDataDir }) => {
      const report = auditWave(wave, { publicDataDir });
      expect(report.passed).toBe(false);
      const finding = report.nonReachability.undeclaredReferences.find((entry) => entry.relativeRef === "public/evidence/evidence-fixture.json");
      expect(finding).toBeDefined();
      expect(finding.identifier).toBe(PRIVATE_ARTIFACT_PATH);
      expect(finding.identifierKind).toBe("private-artifact-path");
      expect(finding.jsonPath).toBe("sourceRef");
    });
  });

  it("refuses a private identifier carried in a non-JSON public payload", () => {
    withFixture({ publicFile: { relativeRef: "public/assets/doitt-1__lod_0.glb", body: `glTF-ish bytes referencing ${PRIVATE_ROOT_ID}` } }, ({ wave, publicDataDir }) => {
      const report = auditWave(wave, { publicDataDir });
      expect(report.passed).toBe(false);
      const finding = report.nonReachability.undeclaredReferences.find((entry) => entry.relativeRef === "public/assets/doitt-1__lod_0.glb");
      expect(finding).toBeDefined();
      expect(finding.identifier).toBe(PRIVATE_ROOT_ID);
      expect(finding.jsonPath).toBeNull();
    });
  });

  /** A private BYTE inside the browser-reachable tree is a separate failure. */
  it("refuses an actual private byte materialized under the package", () => {
    withFixture({ publicFile: { relativeRef: PRIVATE_ARTIFACT_PATH, body: "{}\n" } }, ({ wave, publicDataDir }) => {
      const report = auditWave(wave, { publicDataDir });
      expect(report.passed).toBe(false);
      expect(report.exclusion.entries[0].reachableInPayloadTree).toBe(true);
      expect(report.exclusion.entries[0].reason).toBe(EXCLUSION_REASONS.privateAudienceRoot);
      expect(report.nonReachability.declaredPrivatePathsMaterialized).toContain(PRIVATE_ARTIFACT_PATH);
    });
  });

  /**
   * Two different mechanisms, deliberately not conflated: the artifact-checksum
   * DIGEST pins what the graph declares, while RESOLUTION checks the bytes on
   * disk against those declarations. Tampering with a byte therefore leaves the
   * digest intact — the declaration did not move — and is caught as a
   * checksum mismatch naming the artifact.
   */
  it("refuses an altered public artifact and names the artifact whose bytes moved", () => {
    withFixture({ publicFile: { relativeRef: "public/ownership-ledger/ownership-ledger-fixture.json", body: "{ \"tampered\": true }\n" } }, ({ wave, publicDataDir }) => {
      const report = auditWave(wave, { publicDataDir });
      expect(report.passed).toBe(false);
      expect(report.resolution.resolvedArtifacts).toBe(0);
      const finding = report.resolution.unresolved.find((entry) => entry.relativeRef === "public/ownership-ledger/ownership-ledger-fixture.json");
      expect(finding).toBeDefined();
      expect(["checksum-mismatch", "byte-size-mismatch"]).toContain(finding.reason);
      expect(finding.declared).not.toBe(finding.observed);
      // The digest is unmoved: no DECLARATION changed.
      expect(report.resolution.artifactChecksumDigestSha256).toBe(wave.artifactChecksumDigestSha256);
    });
  });
});

describe("the audit refuses a manifest that disagrees with the bytes", () => {
  it("refuses a moved public root checksum", () => {
    withFixture(undefined, ({ wave, publicDataDir }) => {
      const drifted = { ...wave, publicRootChecksumSha256: "9".repeat(64) };
      expect(() => auditWave(drifted, { publicDataDir })).toThrow(/public root checksum moved/u);
    });
  });

  it("refuses an approval the graph does not pin", () => {
    withFixture(undefined, ({ wave, publicDataDir }) => {
      const swapped = { ...wave, rights: { ...wave.rights, instrument: { ...wave.rights.instrument, id: "approval:someone-elses" } } };
      expect(() => auditWave(swapped, { publicDataDir })).toThrow(/is not the instrument the manifest references/u);
    });
  });

  /** The showcase may not quietly drop an exclusion the release asserted. */
  it("refuses a showcase that omits an exclusion the release asserted", () => {
    withFixture(undefined, ({ wave, publicDataDir }) => {
      const weakened = { ...wave, rights: { ...wave.rights, instrument: { ...wave.rights.instrument, exclusions: [] } } };
      expect(() => auditWave(weakened, { publicDataDir })).toThrow(/omits exclusions the release asserted/u);
    });
  });

  it("refuses a package that is not present rather than reporting a pass it did not check", () => {
    withFixture(undefined, ({ wave }) => {
      expect(() => auditWave(wave, { publicDataDir: join(tmpdir(), "udt-showcase-absent") })).toThrow(/refuses to report a pass it did not check/u);
    });
  });

  it("runs end to end through the CLI entry point with an injected wave", () => {
    withFixture(undefined, ({ wave, publicDataDir }) => {
      // The fixture tree carries none of this repository's evidence
      // directories, so the audited working-record scope is empty for it.
      const report = runPublicShowcaseAudit({ waves: [wave], publicDataDir, dataDir: join(publicDataDir, "no-data"), workingRecordDirectories: [] });
      expect(report.allPassed).toBe(true);
      expect(report.totals.declaredArtifacts).toBe(1);
      expect(report.totals.undeclaredPrivateReferences).toBe(0);
    });
  });
});

/**
 * Every test here plants something review proved the earlier, looser classifier
 * ACCEPTED. Each is written in the pre-fix-failing form: it asserts the planted
 * item is classified `undeclared-private-reference`, so a classifier that goes
 * back to accepting it fails here by name.
 */
describe("the accepted headings are narrow enough to still catch a leak", () => {
  const identifiers = new Map([
    [PRIVATE_ROOT_ID, "private-root-id"],
    [PRIVATE_ARTIFACT_PATH, "private-artifact-path"],
    ["e".repeat(64), "private-root-checksum"],
  ]);
  const privateRoot = { audience: "private", rootId: PRIVATE_ROOT_ID };

  /** H1: a private ARTIFACT PATH is not a root citation, wherever it sits. */
  it("refuses a private artifact path sitting at a privatePredecessor position", () => {
    const findings = scanArtifactForRestricted({
      roots: [privateRoot, { audience: "public", privatePredecessor: { rootId: PRIVATE_ROOT_ID, id: PRIVATE_ARTIFACT_PATH } }],
    }, identifiers);
    const cited = findings.find((finding) => finding.jsonPath === "roots[1].privatePredecessor.rootId");
    expect(cited.classification).toBe("declared-provenance-disclosure");
    const smuggled = findings.find((finding) => finding.identifier === PRIVATE_ARTIFACT_PATH);
    expect(smuggled).toBeDefined();
    expect(smuggled.classification).toBe("undeclared-private-reference");
    expect(ACCEPTED_DISCLOSURE_IDENTIFIER_KINDS).not.toContain("private-artifact-path");
  });

  /** H1: the citation path is anchored, not suffix-matched. */
  it("refuses a privatePredecessor nested somewhere the schema never puts one", () => {
    const findings = scanArtifactForRestricted({
      roots: [privateRoot, { audience: "public", note: { privatePredecessor: { rootId: PRIVATE_ROOT_ID } } }],
    }, identifiers);
    const nested = findings.find((finding) => finding.jsonPath === "roots[1].note.privatePredecessor.rootId");
    expect(nested).toBeDefined();
    expect(nested.classification).toBe("undeclared-private-reference");
  });

  /** H2: an undeclared key inside the private root is not covered by the prefix. */
  it("refuses an invented key inside the private root subtree", () => {
    const findings = scanArtifactForRestricted({
      roots: [{ ...privateRoot, leakedFetchUrl: `https://example.invalid/${PRIVATE_ROOT_ID}` }, { audience: "public" }],
    }, identifiers);
    const leaked = findings.find((finding) => finding.jsonPath === "roots[0].leakedFetchUrl");
    expect(leaked).toBeDefined();
    expect(leaked.classification).toBe("undeclared-private-reference");
    // The schema-mandated sibling in the same object is still accepted.
    const declared = findings.find((finding) => finding.jsonPath === "roots[0].rootId");
    expect(declared.classification).toBe("declared-private-root-metadata");
    expect(DECLARED_PRIVATE_ROOT_KEYS).not.toContain("leakedFetchUrl");
  });

  /** H3: the secret can be the KEY. */
  it("refuses a private identifier used as an object key", () => {
    const findings = scanArtifactForRestricted({
      roots: [privateRoot, { audience: "public", cache: { [PRIVATE_ROOT_ID]: { warm: true } } }],
    }, identifiers);
    const keyed = findings.find((finding) => finding.jsonPath.endsWith("#key") && finding.identifier === PRIVATE_ROOT_ID);
    expect(keyed).toBeDefined();
    expect(keyed.classification).toBe("undeclared-private-reference");
  });

  it("accepts the real declared positions in both graph shapes", () => {
    const graph = scanArtifactForRestricted({ roots: [privateRoot, { audience: "public", privatePredecessor: { rootId: PRIVATE_ROOT_ID } }] }, identifiers);
    expect(graph.find((finding) => finding.jsonPath === "roots[1].privatePredecessor.rootId").classification).toBe("declared-provenance-disclosure");
    // assemblies.json is a top-level ARRAY; index stripping must not leave a leading dot.
    const assemblies = scanArtifactForRestricted([{ audience: "public", release: { privatePredecessor: { id: PRIVATE_ROOT_ID } } }], identifiers);
    expect(assemblies.find((finding) => finding.jsonPath === "[0].release.privatePredecessor.id").classification).toBe("declared-provenance-disclosure");
  });
});

describe("the byte-absence proof covers every admitted private path", () => {
  /** H4: an allowlisted path with no artifact entry must still be proven absent. */
  it("proves absence for a path declared only in the artifact allowlist", () => {
    withFixture({ extraAllowlistRef: "private/tiles/tileset.json" }, ({ wave, publicDataDir }) => {
      const report = auditWave(wave, { publicDataDir });
      const refs = report.exclusion.entries.map((entry) => entry.relativeRef);
      expect(refs).toContain("private/tiles/tileset.json");
      const allowlisted = report.exclusion.entries.find((entry) => entry.relativeRef === "private/tiles/tileset.json");
      expect(allowlisted.declaredIn).toBe("private-root-artifact-allowlist");
      expect(allowlisted.reachableInPayloadTree).toBe(false);
      expect(report.passed).toBe(true);
    });
  });
});

describe("the scanning primitives are narrow", () => {
  it("locates the private root subtree from content, not from a path pattern", () => {
    expect(privateRootPathPrefix({ roots: [{ audience: "public" }, { audience: "private" }] })).toBe("roots[1].");
    expect(privateRootPathPrefix({ roots: [{ audience: "public" }] })).toBeNull();
    expect(privateRootPathPrefix({ notAGraph: true })).toBeNull();
    expect(privateRootPathPrefix(null)).toBeNull();
  });

  it("classifies the same identifier differently by where it sits", () => {
    const identifiers = restrictedIdentifiersFor({ roots: [{ audience: "private", rootId: PRIVATE_ROOT_ID, releaseId: "x-private", rootChecksumSha256: "e".repeat(64), artifacts: [], artifactAllowlist: [] }] }, { packageId: "fixture" });
    const graphLike = {
      roots: [
        { audience: "private", rootId: PRIVATE_ROOT_ID },
        { audience: "public", privatePredecessor: { rootId: PRIVATE_ROOT_ID }, description: PRIVATE_ROOT_ID },
      ],
    };
    const findings = scanArtifactForRestricted(graphLike, identifiers);
    const byPath = Object.fromEntries(findings.map((finding) => [finding.jsonPath, finding.classification]));
    expect(byPath["roots[0].rootId"]).toBe("declared-private-root-metadata");
    expect(byPath["roots[1].privatePredecessor.rootId"]).toBe("declared-provenance-disclosure");
    expect(byPath["roots[1].description"]).toBe("undeclared-private-reference");
  });

  it("enumerates private reference packages that sit inside the public tree", () => {
    const root = mkdtempSync(join(tmpdir(), "udt-showcase-refpkg-"));
    try {
      mkdirSync(join(root, "some-reference-package", "private", "assets"), { recursive: true });
      writeFileSync(join(root, "some-reference-package", "private", "assets", "a.glb"), "x", "utf8");
      const packages = auditPrivateReferencePackages(root);
      expect(packages).toHaveLength(1);
      expect(packages[0].packageId).toBe("some-reference-package");
      expect(packages[0].privateFileCount).toBe(1);
      expect(packages[0].inShowcaseCandidate).toBe(false);
      expect(packages[0].reason).toBe(EXCLUSION_REASONS.privateReferencePackage);
      expect(walkFiles(root)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * T029 repair of the T024 self-invalidation finding.
 *
 * `workingRecordDirectories` used to be a count of whatever existed under
 * `data/` when the audit ran, so committing ANY later evidence directory
 * changed this record's checksum. These tests pin the property that repairs it
 * — a sibling directory must not move the enumeration — and the two ways the
 * declared scope could rot.
 */
describe("the working-record enumeration is stable under sibling record directories", () => {
  function dataTreeWith(directories) {
    const root = mkdtempSync(join(tmpdir(), "showcase-working-records-"));
    for (const name of directories) {
      mkdirSync(join(root, name), { recursive: true });
      writeFileSync(join(root, name, "record.json"), JSON.stringify({ name }));
    }
    return root;
  }

  it("enumerates exactly the declared set and ignores an undeclared sibling", () => {
    const declared = ["alpha-record", "beta-record"];
    const root = dataTreeWith([...declared, "gamma-record-committed-by-a-later-task"]);
    try {
      const records = auditWorkingRecords(root, declared);
      // Pre-fix this returned THREE, and the count was the record's checksum.
      expect(records.map((entry) => entry.directory)).toEqual(declared);
      expect(records).toHaveLength(2);
      for (const entry of records) expect(entry.reason).toBe(EXCLUSION_REASONS.workingEvidenceRecord);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("returns byte-identical results before and after a sibling appears", () => {
    const declared = ["alpha-record", "beta-record"];
    const root = dataTreeWith(declared);
    try {
      const before = JSON.stringify(auditWorkingRecords(root, declared));
      mkdirSync(join(root, "zeta-record-from-the-next-task"), { recursive: true });
      writeFileSync(join(root, "zeta-record-from-the-next-task", "record.json"), "{}");
      expect(JSON.stringify(auditWorkingRecords(root, declared))).toBe(before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("fails closed when a declared directory is absent, rather than shrinking the count", () => {
    // The scope cannot rot in the other direction either: a declared directory
    // that vanished must break the audit, not quietly reduce the total.
    const root = dataTreeWith(["alpha-record"]);
    try {
      expect(() => auditWorkingRecords(root, ["alpha-record", "missing-record"]))
        .toThrow(/declared working-record director(y is|ies are) absent or empty: missing-record/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("treats an empty declared directory as absent", () => {
    const root = dataTreeWith(["alpha-record"]);
    try {
      mkdirSync(join(root, "empty-record"), { recursive: true });
      expect(() => auditWorkingRecords(root, ["alpha-record", "empty-record"])).toThrow(/empty-record/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps the declared set sorted, unique, and matching this repository's data/ tree", () => {
    const declared = [...AUDITED_WORKING_RECORD_DIRECTORIES];
    expect(new Set(declared).size).toBe(declared.length);
    expect(declared).toEqual([...declared].sort());
    // Every declared directory really exists here, so the constant cannot drift
    // into naming a directory this repository does not carry.
    expect(() => auditWorkingRecords(repositoryDataDir)).not.toThrow();
  });
});

/**
 * The browser-implicit admission rule, tested without a browser.
 *
 * It is a separate conjunct from classification: classifying `/favicon.ico`
 * says the browser asked for it, and this says the server did not answer with
 * a payload. Only both together make the request admissible.
 */
describe("a browser-implicit request is admitted only while the server answers with nothing", () => {
  it("admits a refusal status whatever its error body weighs", () => {
    // The real measurement: the preview answers /favicon.ico with a 404 that
    // still carries 157 bytes of error body. A rule written as "zero bytes"
    // would have failed the journey it was written to fix.
    expect(answeredWithoutPayload({ status: 404, encodedDataLength: 157 })).toBe(true);
    expect(answeredWithoutPayload({ status: 410, encodedDataLength: 2_048 })).toBe(true);
  });

  it("admits a zero-byte success", () => {
    expect(answeredWithoutPayload({ status: 200, encodedDataLength: 0 })).toBe(true);
    expect(answeredWithoutPayload({ status: 204, encodedDataLength: 0 })).toBe(true);
  });

  it("treats a request that produced no response at all as serving nothing", () => {
    // Blocked, aborted or DNS-failed. The absence of a response is the
    // strongest form of "served nothing" and must not read as unmeasured.
    expect(answeredWithoutPayload(null)).toBe(true);
    expect(answeredWithoutPayload(undefined)).toBe(true);
  });

  it("REFUSES a build that started actually serving one", () => {
    // The whole point of keeping this conjunct: the candidate ships no favicon,
    // so a 200 with bytes is a change in what the release contains.
    expect(answeredWithoutPayload({ status: 200, encodedDataLength: 1 })).toBe(false);
    expect(answeredWithoutPayload({ status: 200, encodedDataLength: 15_406 })).toBe(false);
    expect(answeredWithoutPayload({ status: 304, encodedDataLength: 900 })).toBe(false);
  });
});
