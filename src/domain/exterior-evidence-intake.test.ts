import { describe, expect, it } from "vitest";
import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  REQUIRED_EXTERIOR_COMPONENT_KINDS,
  validateExteriorInventoryEvidence,
  type ExteriorApprovalEvidence,
  type ExteriorComponentInventory,
  type ExteriorLicenseEvidence,
} from "./exterior-contract.ts";
import {
  DISALLOWED_EXTERIOR_SOURCE_CLASSIFICATIONS,
  EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION,
  buildExteriorEvidenceIntakeAudit,
  exteriorEvidenceIntakeLedgerChecksum,
  projectAdmittedExteriorEvidence,
  validateExteriorEvidenceIntakeLedger,
  validateProjectedGraphAudience,
  verifyExteriorEvidenceProjectionIntegrity,
  type ExteriorEvidenceIntakeAdmission,
  type ExteriorEvidenceIntakeLedger,
  type ExteriorEvidenceIntakeRecord,
} from "./exterior-evidence-intake.ts";

const NOW = "2026-08-09T00:00:00.000Z";
const FINGERPRINT = "a".repeat(64);
const OTHER_FINGERPRINT = "b".repeat(64);

const ATTESTER = "Operator Alice Owner";
const STATEMENT = "I own these photographs and grant this project derivative and public-display rights.";
const REVIEWER = "Operator Bob Reviewer";
const REDACTED_REF = "private/intake/b1-front-redacted.png";

function license(overrides: Partial<ExteriorLicenseEvidence> = {}): ExteriorLicenseEvidence {
  return {
    id: "license:owned",
    termsUrl: "https://example.invalid/owner-release",
    attribution: "Synthetic owner-supplied fixture.",
    retention: { mode: "permanent", expiresAt: null, conditions: "Retained until the owner withdraws consent." },
    allowedUse: {
      privateDerivative: true, publicDisplay: true, derivativeConveyance: true, redistribution: true,
      runtimeTexture: true, trainingInput: false, generationInput: false, validationOnly: false,
    },
    personalDataRestricted: false,
    ...overrides,
  };
}

function approval(overrides: Partial<ExteriorApprovalEvidence> = {}): ExteriorApprovalEvidence {
  return {
    id: "approval:owned",
    fingerprintSha256: FINGERPRINT,
    scope: "Synthetic owner-supplied exterior evidence.",
    exclusions: [],
    approvedAt: NOW,
    ...overrides,
  };
}

function intakeRecord(overrides: Partial<ExteriorEvidenceIntakeRecord> = {}): ExteriorEvidenceIntakeRecord {
  return {
    recordId: "record:owned",
    classification: "user-owned",
    buildingId: "b1",
    componentIds: ["b1:windows", "b1:storefronts"],
    provider: "Operator supplied",
    datasetId: "operator-photo-set",
    sourceRecordId: "b1-front",
    sourceUrl: "https://example.invalid/owner/b1-front",
    attribution: "Photograph by the operator.",
    uncertainty: "Single-elevation photograph; no measured survey.",
    sourceDate: NOW,
    observedAt: NOW,
    capturedAt: NOW,
    updatedAt: NOW,
    licenseId: "license:owned",
    approvalId: "approval:owned",
    retention: { mode: "permanent", expiresAt: null, conditions: "Retained with the owner release." },
    derivativeScope: "geometry-and-texture",
    attestation: { attester: ATTESTER, statement: STATEMENT, fingerprintSha256: FINGERPRINT, exclusions: [] },
    privacyReview: { status: "reviewed-no-identifiers", identifiersFound: [], redactions: [], reviewer: REVIEWER, reviewedAt: NOW },
    ...overrides,
  };
}

function ledger(overrides: Partial<ExteriorEvidenceIntakeLedger> = {}): ExteriorEvidenceIntakeLedger {
  return {
    schemaVersion: EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION,
    ledgerId: "intake:fixture",
    licenses: [license()],
    approvals: [approval()],
    records: [intakeRecord()],
    ...overrides,
  };
}

function admit(value: unknown, evaluatedAt = NOW): ExteriorEvidenceIntakeAdmission {
  const result = validateExteriorEvidenceIntakeLedger(value, { evaluatedAt });
  if (!result.ok) throw new Error(`fixture ledger must be structurally valid: ${JSON.stringify(result.issues)}`);
  return result.value;
}

function onlyAdmitted(value: unknown, evaluatedAt = NOW) {
  const admission = admit(value, evaluatedAt);
  expect(admission.rejected).toHaveLength(0);
  const entry = admission.admitted[0];
  if (!entry) throw new Error("expected exactly one admitted record");
  return { admission, entry };
}

function onlyRejected(value: unknown, evaluatedAt = NOW) {
  const admission = admit(value, evaluatedAt);
  expect(admission.admitted).toHaveLength(0);
  const entry = admission.rejected[0];
  if (!entry) throw new Error("expected exactly one rejected record");
  return { admission, entry };
}

/** Builds an inventory that consumes every projected claim for a building. */
function inventoryFor(buildingId: string, componentEvidenceIds: Record<string, string[]>): ExteriorComponentInventory {
  return {
    schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
    buildingId,
    components: REQUIRED_EXTERIOR_COMPONENT_KINDS.map((kind) => {
      const componentId = `${buildingId}:${kind}`;
      const evidenceIds = componentEvidenceIds[componentId];
      if (evidenceIds && evidenceIds.length > 0) {
        return { componentId, kind, state: "evidence-backed" as const, basis: "source-observed" as const, evidenceIds, uncertainty: "Observed from admitted intake evidence." };
      }
      return {
        componentId, kind, state: "generated" as const, uncertainty: "Procedural fixture; no real-world claim.",
        generator: { id: "fixture", version: "1", inputFingerprintSha256: FINGERPRINT, seed: componentId, generatedAt: NOW, constraintSourceIds: [] },
      };
    }),
  };
}

describe("exterior evidence intake structure", () => {
  it("admits a complete owner-attested record and pins a non-durable admission", () => {
    const { admission, entry } = onlyAdmitted(ledger());
    expect(entry.classification).toBe("user-owned");
    expect(entry.publicEligible).toBe(true);
    expect(entry.runtimeTextureEligible).toBe(true);
    expect(entry.restrictionCodes).toEqual([]);
    expect(admission.durability).toEqual({ kind: "non-durable-intake-admission", evaluatedAt: NOW, reevaluationRequiredForPromotion: true });
    expect(admission.ledgerChecksumSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails structurally closed on malformed ledgers, records and unsafe redaction references", () => {
    for (const malformed of [
      null,
      [],
      {},
      { ...ledger(), unexpected: true },
      { ...ledger(), schemaVersion: "2.0" },
      { ...ledger(), records: [{ ...intakeRecord(), unexpected: true }] },
      { ...ledger(), records: [{ ...intakeRecord(), capturedAt: "2026-08-09" }] },
      { ...ledger(), records: [{ ...intakeRecord(), componentIds: [] }] },
      { ...ledger(), records: [intakeRecord(), intakeRecord()] },
      { ...ledger(), records: [{ ...intakeRecord(), attestation: { attester: ATTESTER, statement: STATEMENT, fingerprintSha256: "short", exclusions: [] } }] },
      { ...ledger(), records: [{ ...intakeRecord(), attestation: { attester: ATTESTER, statement: STATEMENT, fingerprintSha256: FINGERPRINT, exclusions: ["whatever the owner said"] } }] },
      { ...ledger(), records: [{ ...intakeRecord(), retention: { mode: "expires", expiresAt: null, conditions: "Missing expiry." } }] },
      { ...ledger(), records: [{ ...intakeRecord(), derivativeScope: "anything-goes" }] },
      { ...ledger(), records: [{ ...intakeRecord(), recordId: "photo of Jane's shopfront, taken 2026" }] },
      { ...ledger(), records: [{ ...intakeRecord(), recordId: "-leading-dash" }] },
      { ...ledger(), records: [{ ...intakeRecord(), recordId: `record:${"x".repeat(70)}` }] },
      {
        ...ledger(),
        records: [{
          ...intakeRecord(),
          privacyReview: { status: "reviewed-redacted", identifiersFound: ["faces"], redactions: [{ identifier: "faces", method: "blurred", redactedArtifactRef: "../escape.png", note: "Blurred." }], reviewer: REVIEWER, reviewedAt: NOW },
        }],
      },
    ]) {
      expect(validateExteriorEvidenceIntakeLedger(malformed, { evaluatedAt: NOW }).ok).toBe(false);
    }
    expect(validateExteriorEvidenceIntakeLedger(ledger(), { evaluatedAt: "not-a-timestamp" }).ok).toBe(false);
  });

  it("produces a reordering-stable deterministic ledger checksum", () => {
    const first = ledger({
      licenses: [license(), license({ id: "license:other" })],
      approvals: [approval(), approval({ id: "approval:other" })],
      records: [intakeRecord(), intakeRecord({ recordId: "record:second" })],
    });
    const reversed = { ...first, licenses: [...first.licenses].reverse(), approvals: [...first.approvals].reverse(), records: [...first.records].reverse() };
    expect(exteriorEvidenceIntakeLedgerChecksum(reversed)).toBe(exteriorEvidenceIntakeLedgerChecksum(first));
    const mutated = { ...first, records: [{ ...first.records[0]!, uncertainty: "Different." }, first.records[1]!] };
    expect(exteriorEvidenceIntakeLedgerChecksum(mutated)).not.toBe(exteriorEvidenceIntakeLedgerChecksum(first));
  });
});

describe("exterior evidence intake classification and rights", () => {
  it.each(DISALLOWED_EXTERIOR_SOURCE_CLASSIFICATIONS)("rejects the disallowed origin %s", (classification) => {
    const { entry } = onlyRejected(ledger({ records: [intakeRecord({ classification })] }));
    expect(entry.reasonCodes).toContain("classification-disallowed");
    expect(entry.disallowedClassification).toBe(classification);
  });

  it("rejects an unknown classification without echoing the operator string", () => {
    const { admission, entry } = onlyRejected(ledger({ records: [intakeRecord({ classification: "borrowed from a friend of a friend" })] }));
    expect(entry.reasonCodes).toEqual(["classification-unknown"]);
    expect(entry.disallowedClassification).toBeNull();
    expect(JSON.stringify(buildExteriorEvidenceIntakeAudit(admission).public)).not.toContain("borrowed from a friend");
  });

  it("rejects missing or unbound rights evidence", () => {
    expect(onlyRejected(ledger({ records: [intakeRecord({ licenseId: "license:missing" })] })).entry.reasonCodes).toContain("license-linkage-unresolved");
    expect(onlyRejected(ledger({ records: [intakeRecord({ approvalId: "approval:missing" })] })).entry.reasonCodes).toContain("approval-linkage-unresolved");
    expect(onlyRejected(ledger({
      records: [intakeRecord({ attestation: { attester: ATTESTER, statement: STATEMENT, fingerprintSha256: OTHER_FINGERPRINT, exclusions: [] } })],
    })).entry.reasonCodes).toContain("attestation-fingerprint-unbound");
    expect(onlyRejected(ledger({
      licenses: [license({ allowedUse: { ...license().allowedUse, privateDerivative: false } })],
    })).entry.reasonCodes).toContain("private-derivative-not-permitted");
  });

  it("rejects future-dated evidence, future approvals and expired or over-broad retention", () => {
    expect(onlyRejected(ledger({ records: [intakeRecord({ capturedAt: "2027-01-01T00:00:00.000Z" })] })).entry.reasonCodes).toContain("evidence-future-dated");
    expect(onlyRejected(ledger({ approvals: [approval({ approvedAt: "2027-01-01T00:00:00.000Z" })] })).entry.reasonCodes).toContain("approval-future-dated");
    expect(onlyRejected(ledger({
      records: [intakeRecord({ retention: { mode: "expires", expiresAt: "2026-01-01T00:00:00.000Z", conditions: "Lapsed owner release." } })],
    })).entry.reasonCodes).toContain("retention-expired");
    expect(onlyRejected(ledger({
      licenses: [license({ retention: { mode: "expires", expiresAt: "2026-09-01T00:00:00.000Z", conditions: "Limited window." } })],
    })).entry.reasonCodes).toContain("retention-exceeds-license");
  });
});

describe("exterior evidence intake privacy and exclusion gates", () => {
  it("withholds public and runtime eligibility until the privacy review is complete", () => {
    const notReviewed = onlyAdmitted(ledger({
      records: [intakeRecord({ privacyReview: { status: "not-reviewed", identifiersFound: [], redactions: [], reviewer: REVIEWER, reviewedAt: NOW } })],
    })).entry;
    expect(notReviewed.restrictionCodes).toContain("privacy-review-incomplete");
    expect(notReviewed.publicEligible).toBe(false);
    expect(notReviewed.runtimeTextureEligible).toBe(false);

    const contradictory = onlyAdmitted(ledger({
      records: [intakeRecord({ privacyReview: { status: "reviewed-no-identifiers", identifiersFound: ["faces"], redactions: [], reviewer: REVIEWER, reviewedAt: NOW } })],
    })).entry;
    expect(contradictory.publicEligible).toBe(false);
  });

  it("withholds public and runtime eligibility for identifiers found without redaction evidence", () => {
    const unredacted = onlyAdmitted(ledger({
      records: [intakeRecord({ privacyReview: { status: "reviewed-redacted", identifiersFound: ["faces", "plates"], redactions: [{ identifier: "plates", method: "masked", redactedArtifactRef: REDACTED_REF, note: "Plate masked." }], reviewer: REVIEWER, reviewedAt: NOW } })],
    })).entry;
    expect(unredacted.restrictionCodes).toContain("privacy-identifiers-unredacted");
    expect(unredacted.publicEligible).toBe(false);
    expect(unredacted.runtimeTextureEligible).toBe(false);

    const redacted = onlyAdmitted(ledger({
      records: [intakeRecord({ privacyReview: { status: "reviewed-redacted", identifiersFound: ["faces"], redactions: [{ identifier: "faces", method: "blurred", redactedArtifactRef: REDACTED_REF, note: "Face blurred before ingest." }], reviewer: REVIEWER, reviewedAt: NOW } })],
    })).entry;
    expect(redacted.restrictionCodes).toEqual([]);
    expect(redacted.publicEligible).toBe(true);
  });

  it("withholds public and runtime eligibility for restricted personal data and missing public rights", () => {
    expect(onlyAdmitted(ledger({ licenses: [license({ personalDataRestricted: true })] })).entry.publicEligible).toBe(false);
    expect(onlyAdmitted(ledger({ licenses: [license({ allowedUse: { ...license().allowedUse, redistribution: false } })] })).entry.publicEligible).toBe(false);
    expect(onlyAdmitted(ledger({ licenses: [license({ allowedUse: { ...license().allowedUse, runtimeTexture: false } })] })).entry.runtimeTextureEligible).toBe(false);
    expect(onlyAdmitted(ledger({ records: [intakeRecord({ derivativeScope: "measurement-only" })] })).entry.runtimeTextureEligible).toBe(false);
  });

  it("fails public admission closed on contradicting exclusion tokens and unmapped free text", () => {
    const contradicting = onlyAdmitted(ledger({ approvals: [approval({ exclusions: ["public-display"] })] })).entry;
    expect(contradicting.restrictionCodes).toContain("exclusion-token-conflict");
    expect(contradicting.publicEligible).toBe(false);

    const freeText = onlyAdmitted(ledger({ approvals: [approval({ exclusions: ["no billboards please"] })] })).entry;
    expect(freeText.restrictionCodes).toContain("exclusion-free-text-unmapped");
    expect(freeText.publicEligible).toBe(false);

    const runtimeExcluded = onlyAdmitted(ledger({
      records: [intakeRecord({ attestation: { attester: ATTESTER, statement: STATEMENT, fingerprintSha256: FINGERPRINT, exclusions: ["runtime-texture"] } })],
    })).entry;
    expect(runtimeExcluded.runtimeTextureEligible).toBe(false);
    expect(runtimeExcluded.publicEligible).toBe(true);
  });
});

describe("exterior evidence intake projection into phase B", () => {
  it("projects admitted records into an evidence graph the accepted phase B validator accepts", () => {
    const admission = admit(ledger());
    const projection = projectAdmittedExteriorEvidence(admission, { audience: "public", runtimeTexture: true });
    expect(projection.graph.sources).toHaveLength(1);
    expect(projection.graph.licenses).toHaveLength(1);
    expect(projection.graph.approvals).toHaveLength(1);
    expect(projection.graph.evidence).toHaveLength(2);

    const phaseB = validateExteriorInventoryEvidence(
      inventoryFor("b1", projection.componentEvidenceIds),
      projection.graph,
      { audience: "public", runtimeTexture: true, evaluatedAt: NOW },
    );
    expect(phaseB.ok).toBe(true);
  });

  it("never projects rejected or audience-restricted records", () => {
    const admission = admit(ledger({
      licenses: [license(), license({ id: "license:private-only", personalDataRestricted: true })],
      approvals: [approval()],
      records: [
        intakeRecord(),
        intakeRecord({ recordId: "record:private-only", licenseId: "license:private-only", componentIds: ["b1:cornices"] }),
        intakeRecord({ recordId: "record:street-view", classification: "street-view", componentIds: ["b1:materials"] }),
      ],
    }));
    const publicProjection = projectAdmittedExteriorEvidence(admission, { audience: "public" });
    const privateProjection = projectAdmittedExteriorEvidence(admission, { audience: "private" });
    expect(JSON.stringify(publicProjection)).not.toContain("record:private-only");
    expect(JSON.stringify(publicProjection)).not.toContain("record:street-view");
    expect(JSON.stringify(privateProjection)).toContain("record:private-only");
    expect(JSON.stringify(privateProjection)).not.toContain("record:street-view");
  });

  it("pins and re-verifies the intake ledger checksum through the projected approval fingerprint chain", () => {
    const admission = admit(ledger());
    const projection = projectAdmittedExteriorEvidence(admission, { audience: "public" });
    expect(verifyExteriorEvidenceProjectionIntegrity(projection, admission.ledgerChecksumSha256).ok).toBe(true);
    expect(verifyExteriorEvidenceProjectionIntegrity(projection, FINGERPRINT).ok).toBe(false);

    const tampered = { ...projection, graph: { ...projection.graph, approvals: [{ ...projection.graph.approvals[0]!, fingerprintSha256: OTHER_FINGERPRINT }] } };
    expect(verifyExteriorEvidenceProjectionIntegrity(tampered, admission.ledgerChecksumSha256).ok).toBe(false);
  });

  it("fails integrity when a private projection is relabelled public or runtime-texture", () => {
    const admission = admit(ledger());
    const privateProjection = projectAdmittedExteriorEvidence(admission, { audience: "private" });
    expect(verifyExteriorEvidenceProjectionIntegrity(privateProjection, admission.ledgerChecksumSha256).ok).toBe(true);

    const relabelledPublic = { ...privateProjection, audience: "public" as const };
    expect(verifyExteriorEvidenceProjectionIntegrity(relabelledPublic, admission.ledgerChecksumSha256).ok).toBe(false);

    const relabelledRuntime = { ...privateProjection, runtimeTexture: true };
    expect(verifyExteriorEvidenceProjectionIntegrity(relabelledRuntime, admission.ledgerChecksumSha256).ok).toBe(false);
  });

  it("fails integrity when a projected exclusion sentinel is stripped or a scope is rewritten", () => {
    const admission = admit(ledger({
      records: [intakeRecord({ privacyReview: { status: "not-reviewed", identifiersFound: [], redactions: [], reviewer: REVIEWER, reviewedAt: NOW } })],
    }));
    const projection = projectAdmittedExteriorEvidence(admission, { audience: "private" });
    expect(projection.graph.approvals[0]!.exclusions).toContain("privacy-review-unresolved");
    expect(verifyExteriorEvidenceProjectionIntegrity(projection, admission.ledgerChecksumSha256).ok).toBe(true);

    const withApproval = (overrides: Partial<(typeof projection.graph.approvals)[number]>) => ({
      ...projection,
      graph: { ...projection.graph, approvals: [{ ...projection.graph.approvals[0]!, ...overrides }] },
    });

    const stripped = withApproval({ exclusions: projection.graph.approvals[0]!.exclusions.filter((token) => token !== "privacy-review-unresolved") });
    expect(validateProjectedGraphAudience(stripped.graph, { audience: "public" }).ok).toBe(true);
    expect(verifyExteriorEvidenceProjectionIntegrity(stripped, admission.ledgerChecksumSha256).ok).toBe(false);

    const rewrittenScope = withApproval({ scope: "approval:owned: Unrestricted public use approved by the owner." });
    expect(verifyExteriorEvidenceProjectionIntegrity(rewrittenScope, admission.ledgerChecksumSha256).ok).toBe(false);

    const addedToken = withApproval({ exclusions: [...projection.graph.approvals[0]!.exclusions, "training-input"] });
    expect(verifyExteriorEvidenceProjectionIntegrity(addedToken, admission.ledgerChecksumSha256).ok).toBe(false);
  });

  it("fails integrity when a foreign source is injected into a projected graph", () => {
    const admission = admit(ledger());
    const projection = projectAdmittedExteriorEvidence(admission, { audience: "public" });
    const injected = {
      ...projection,
      graph: {
        ...projection.graph,
        sources: [...projection.graph.sources, {
          id: "source:record:smuggled", provider: "Street View", datasetId: "panorama", sourceRecordId: "b1",
          sourceUrl: "https://example.invalid/panorama", sourceDate: NOW, observedAt: NOW, capturedAt: NOW, updatedAt: NOW,
          attribution: "Not cleared.", licenseId: "license:owned", approvalId: "approval:record:owned",
        }],
      },
    };
    expect(verifyExteriorEvidenceProjectionIntegrity(injected, admission.ledgerChecksumSha256).ok).toBe(false);
  });

  it("carries the original approval ID and verbatim scope into the projected approval", () => {
    const projection = projectAdmittedExteriorEvidence(admit(ledger()), { audience: "public" });
    const projectedApproval = projection.graph.approvals[0]!;
    expect(projectedApproval.scope).toContain("approval:owned");
    expect(projectedApproval.scope).toContain(approval().scope);
  });
});

describe("projected graph audience guard", () => {
  it("blocks a re-serialized private projection presented as public", () => {
    const admission = admit(ledger({
      approvals: [approval(), approval({ id: "approval:display-excluded", exclusions: ["public-display"] })],
      records: [
        intakeRecord({ recordId: "record:exclusion-locked", approvalId: "approval:display-excluded" }),
        intakeRecord({
          recordId: "record:unredacted",
          privacyReview: { status: "reviewed-redacted", identifiersFound: ["faces"], redactions: [], reviewer: REVIEWER, reviewedAt: NOW },
        }),
      ],
    }));
    // The reviewer's probe: project privately, re-serialize, present as public.
    const privateProjection = projectAdmittedExteriorEvidence(admission, { audience: "private" });
    const reparented = JSON.parse(JSON.stringify(privateProjection.graph)) as typeof privateProjection.graph;
    expect(reparented.approvals).toHaveLength(2);

    expect(validateProjectedGraphAudience(reparented, { audience: "private" }).ok).toBe(true);
    const asPublic = validateProjectedGraphAudience(reparented, { audience: "public" });
    expect(asPublic.ok).toBe(false);
    if (asPublic.ok) throw new Error("private projection presented as public must fail closed");
    expect(asPublic.issues.map((entry) => entry.message)).toEqual(expect.arrayContaining([
      "Approval exclusion public-display forbids this audience or use.",
      "Approval exclusion privacy-review-unresolved forbids this audience or use.",
    ]));
    expect(validateProjectedGraphAudience(reparented, { audience: "private", runtimeTexture: true }).ok).toBe(false);
  });

  it("projects a privacy sentinel that survives serialization", () => {
    const admission = admit(ledger({
      records: [intakeRecord({ privacyReview: { status: "not-reviewed", identifiersFound: [], redactions: [], reviewer: REVIEWER, reviewedAt: NOW } })],
    }));
    const projection = projectAdmittedExteriorEvidence(admission, { audience: "private" });
    expect(projection.graph.approvals[0]!.exclusions).toContain("privacy-review-unresolved");
    expect(validateProjectedGraphAudience(projection.graph, { audience: "public" }).ok).toBe(false);
    expect(validateProjectedGraphAudience(projection.graph, { audience: "private", runtimeTexture: true }).ok).toBe(false);
    expect(validateProjectedGraphAudience(projection.graph, { audience: "private" }).ok).toBe(true);
  });

  it("projects an unmapped-restriction sentinel for unmappable free-text exclusions", () => {
    const admission = admit(ledger({ approvals: [approval({ exclusions: ["no billboards please"] })] }));
    const projection = projectAdmittedExteriorEvidence(admission, { audience: "private" });
    const exclusions = projection.graph.approvals[0]!.exclusions;
    expect(exclusions).toContain("unmapped-restriction");
    expect(exclusions).not.toContain("no billboards please");
    expect(validateProjectedGraphAudience(projection.graph, { audience: "public" }).ok).toBe(false);
    expect(validateProjectedGraphAudience(projection.graph, { audience: "private", runtimeTexture: true }).ok).toBe(false);
    expect(admission.admitted[0]!.publicEligible).toBe(false);
  });

  it("admits a clean projected graph for both audiences", () => {
    const projection = projectAdmittedExteriorEvidence(admit(ledger()), { audience: "public", runtimeTexture: true });
    expect(validateProjectedGraphAudience(projection.graph, { audience: "public", runtimeTexture: true }).ok).toBe(true);
  });
});

describe("exterior evidence intake audit surfaces", () => {
  it("keeps operator free text, reviewers and private refs out of the public audit surface", () => {
    const admission = admit(ledger({
      licenses: [license(), license({ id: "license:restricted", personalDataRestricted: true })],
      approvals: [approval()],
      records: [
        intakeRecord(),
        intakeRecord({ recordId: "record:google", classification: "google-maps" }),
        intakeRecord({
          recordId: "record:faces", licenseId: "license:restricted",
          privacyReview: { status: "reviewed-redacted", identifiersFound: ["faces"], redactions: [{ identifier: "faces", method: "blurred", redactedArtifactRef: REDACTED_REF, note: "Face blurred." }], reviewer: REVIEWER, reviewedAt: NOW },
        }),
      ],
    }));
    const audit = buildExteriorEvidenceIntakeAudit(admission);

    expect(audit.public.counts).toEqual({ submitted: 3, admitted: 2, rejected: 1, publicEligible: 1, runtimeTextureEligible: 1 });
    expect(audit.public.admittedPublicRecordIds).toEqual(["record:owned"]);
    expect(audit.public.rejectionCodes).toEqual([{ code: "classification-disallowed", count: 1 }]);
    expect(audit.public.restrictionCodes).toContainEqual({ code: "personal-data-restricted", count: 1 });

    const serializedPublic = JSON.stringify(audit.public);
    for (const secret of [ATTESTER, STATEMENT, REVIEWER, REDACTED_REF, "private/", "https://example.invalid", "record:google", "record:faces"]) {
      expect(serializedPublic).not.toContain(secret);
    }

    const serializedPrivate = JSON.stringify(audit.private);
    for (const detail of [ATTESTER, REVIEWER, REDACTED_REF, "record:google", "record:faces"]) {
      expect(serializedPrivate).toContain(detail);
    }
  });
});
