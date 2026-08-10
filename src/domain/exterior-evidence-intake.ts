import { isSafeReleaseArtifactReference } from "../runtime/path-security.ts";
import { domainSeparatedSha256 } from "./deterministic-hash.ts";
import {
  EXTERIOR_COMPONENT_SCHEMA_VERSION,
  validateExteriorEvidenceGraphStructure,
  type ExteriorApprovalEvidence,
  type ExteriorClaimEvidence,
  type ExteriorContractIssue,
  type ExteriorContractValidation,
  type ExteriorEvidenceGraph,
  type ExteriorLicenseEvidence,
  type ExteriorSourceEvidence,
} from "./exterior-contract.ts";

export const EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION = "1.0" as const;

/**
 * Phase A rights-cleared evidence admission. Phase B (represented exterior
 * truth) remains owned by `validateExteriorInventoryEvidence`; this module
 * never re-implements its rules and never widens its accepted types.
 */
export const ADMITTED_EXTERIOR_SOURCE_CLASSIFICATIONS = [
  "user-owned",
  "public-domain",
  "compatible-licensed",
  "explicitly-permitted",
] as const;
export type AdmittedExteriorSourceClassification = (typeof ADMITTED_EXTERIOR_SOURCE_CLASSIFICATIONS)[number];

/**
 * Documented disallowed vocabulary. It exists only so rejection accounting can
 * name a prohibited origin without echoing operator free text; it never widens
 * what may be admitted.
 */
export const DISALLOWED_EXTERIOR_SOURCE_CLASSIFICATIONS = [
  "google-maps",
  "street-view",
  "unlicensed-web-photo",
  "platform-restricted",
] as const;
export type DisallowedExteriorSourceClassification = (typeof DISALLOWED_EXTERIOR_SOURCE_CLASSIFICATIONS)[number];

/** Closed exclusion-token vocabulary. Anything else is unmapped free text. */
export const EXTERIOR_EXCLUSION_TOKENS = [
  "public-display",
  "redistribution",
  "derivative-conveyance",
  "runtime-texture",
  "training-input",
] as const;
export type ExteriorExclusionToken = (typeof EXTERIOR_EXCLUSION_TOKENS)[number];

/**
 * Closed sentinel tokens projected into an approval's `exclusions` so a
 * Phase A verdict survives serialization. `ExteriorApprovalEvidence.exclusions`
 * is already `string[]`, so this needs no accepted-type change.
 */
export const EXTERIOR_PROJECTED_EXCLUSION_SENTINELS = ["privacy-review-unresolved", "unmapped-restriction"] as const;
export type ExteriorProjectedExclusionSentinel = (typeof EXTERIOR_PROJECTED_EXCLUSION_SENTINELS)[number];
export type ExteriorProjectedExclusion = ExteriorExclusionToken | ExteriorProjectedExclusionSentinel;

/** Projected exclusions that forbid public conveyance of the evidence. */
export const PUBLIC_BLOCKING_PROJECTED_EXCLUSIONS: readonly ExteriorProjectedExclusion[] = [
  "public-display", "redistribution", "derivative-conveyance", "privacy-review-unresolved", "unmapped-restriction",
];
/** Projected exclusions that forbid runtime-texture use of the evidence. */
export const RUNTIME_TEXTURE_BLOCKING_PROJECTED_EXCLUSIONS: readonly ExteriorProjectedExclusion[] = [
  "runtime-texture", "privacy-review-unresolved", "unmapped-restriction",
];

/** Opaque intake record identity. Keeps operator free text out of audits. */
export const EXTERIOR_INTAKE_RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

export const EXTERIOR_DERIVATIVE_SCOPES = ["measurement-only", "geometry-derivative", "geometry-and-texture"] as const;
export type ExteriorDerivativeScope = (typeof EXTERIOR_DERIVATIVE_SCOPES)[number];

export const PRIVACY_IDENTIFIER_KINDS = ["faces", "plates", "other"] as const;
export type PrivacyIdentifierKind = (typeof PRIVACY_IDENTIFIER_KINDS)[number];

export const PRIVACY_REDACTION_METHODS = ["removed", "masked", "blurred", "cropped"] as const;
export type PrivacyRedactionMethod = (typeof PRIVACY_REDACTION_METHODS)[number];

export const PRIVACY_REVIEW_STATUSES = ["not-reviewed", "reviewed-no-identifiers", "reviewed-redacted"] as const;
export type PrivacyReviewStatus = (typeof PRIVACY_REVIEW_STATUSES)[number];

/** Closed machine-readable vocabulary for the auditable rejection surface. */
export const EXTERIOR_INTAKE_REASON_CODES = [
  "classification-disallowed",
  "classification-unknown",
  "license-linkage-unresolved",
  "approval-linkage-unresolved",
  "attestation-fingerprint-unbound",
  "private-derivative-not-permitted",
  "evidence-future-dated",
  "approval-future-dated",
  "retention-expired",
  "retention-exceeds-license",
  "privacy-review-incomplete",
  "privacy-identifiers-unredacted",
  "personal-data-restricted",
  "public-rights-not-permitted",
  "exclusion-token-conflict",
  "exclusion-free-text-unmapped",
  "runtime-texture-not-permitted",
  "derivative-scope-excludes-texture",
] as const;
export type ExteriorIntakeReasonCode = (typeof EXTERIOR_INTAKE_REASON_CODES)[number];

export interface ExteriorPrivacyRedactionAction {
  identifier: PrivacyIdentifierKind;
  method: PrivacyRedactionMethod;
  /** Reference to the retained redacted artifact; validated as a release-safe reference. */
  redactedArtifactRef: string;
  note: string;
}

/**
 * Attestation-based privacy review. This contract records an operator review
 * and its redaction evidence; it performs no detection and asserts no
 * detection accuracy.
 */
export interface ExteriorPrivacyReviewRecord {
  status: PrivacyReviewStatus;
  identifiersFound: PrivacyIdentifierKind[];
  redactions: ExteriorPrivacyRedactionAction[];
  reviewer: string;
  reviewedAt: string;
}

export interface ExteriorOwnershipAttestation {
  attester: string;
  statement: string;
  /** Must equal the cited approval's durable fingerprint (the recorded approval turn). */
  fingerprintSha256: string;
  exclusions: ExteriorExclusionToken[];
}

export interface ExteriorIntakeRetention {
  mode: "permanent" | "expires";
  expiresAt: string | null;
  conditions: string;
}

export interface ExteriorEvidenceIntakeRecord {
  recordId: string;
  classification: string;
  buildingId: string;
  componentIds: string[];
  provider: string;
  datasetId: string;
  sourceRecordId: string;
  sourceUrl: string;
  attribution: string;
  uncertainty: string;
  sourceDate: string;
  observedAt: string;
  capturedAt: string;
  updatedAt: string;
  /** License linkage by reference into the ledger's `ExteriorLicenseEvidence` collection. */
  licenseId: string;
  /** Approval linkage by reference into the ledger's `ExteriorApprovalEvidence` collection. */
  approvalId: string;
  retention: ExteriorIntakeRetention;
  derivativeScope: ExteriorDerivativeScope;
  attestation: ExteriorOwnershipAttestation;
  privacyReview: ExteriorPrivacyReviewRecord;
}

export interface ExteriorEvidenceIntakeLedger {
  schemaVersion: typeof EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION;
  ledgerId: string;
  licenses: ExteriorLicenseEvidence[];
  approvals: ExteriorApprovalEvidence[];
  records: ExteriorEvidenceIntakeRecord[];
}

export interface AdmittedExteriorEvidenceRecord {
  recordId: string;
  classification: AdmittedExteriorSourceClassification;
  publicEligible: boolean;
  runtimeTextureEligible: boolean;
  /** Closed exclusion tokens resolved from the cited approval and attestation. */
  exclusionTokens: ExteriorExclusionToken[];
  /** Codes explaining every eligibility that was withheld. Private detail. */
  restrictionCodes: ExteriorIntakeReasonCode[];
  record: ExteriorEvidenceIntakeRecord;
}

export interface RejectedExteriorEvidenceRecord {
  recordId: string;
  /** Named only when the submission used the documented disallowed vocabulary. */
  disallowedClassification: DisallowedExteriorSourceClassification | null;
  reasonCodes: ExteriorIntakeReasonCode[];
}

export interface ExteriorEvidenceIntakeAdmission {
  schemaVersion: typeof EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION;
  ledgerId: string;
  ledgerChecksumSha256: string;
  /**
   * Admission is a point-in-time decision, not a durable right. Admitted at
   * intake is not admissible at promotion: rights, retention and approval
   * scope must be re-evaluated at the promotion timestamp by Phase B.
   */
  durability: {
    kind: "non-durable-intake-admission";
    evaluatedAt: string;
    reevaluationRequiredForPromotion: true;
  };
  admitted: AdmittedExteriorEvidenceRecord[];
  rejected: RejectedExteriorEvidenceRecord[];
  /** Licenses referenced by admitted records, reused verbatim from the ledger. */
  licenses: ExteriorLicenseEvidence[];
  /** Approvals cited by admitted records, reused verbatim from the ledger. */
  approvals: ExteriorApprovalEvidence[];
}

export interface ExteriorEvidenceIntakeOptions {
  /** Canonical UTC timestamp at which intake admission is evaluated. */
  evaluatedAt: string;
}

const LEDGER_HASH_NAMESPACE = "urban-digital-twin/exterior-evidence-intake/ledger/1.0";
const APPROVAL_HASH_NAMESPACE = "urban-digital-twin/exterior-evidence-intake/approval-fingerprint/1.0";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(issues: ExteriorContractIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const milliseconds = Date.parse(value);
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function checksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: ExteriorContractIssue[]): void {
  const allowlist = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowlist.has(key)) issue(issues, `${path}.${key}`, "Unexpected field for this intake discriminant.");
  for (const key of allowed) if (!(key in value)) issue(issues, `${path}.${key}`, "Required field is missing.");
}

function closedList<T extends string>(value: unknown, vocabulary: readonly T[], path: string, issues: ExteriorContractIssue[], allowEmpty = true): value is T[] {
  if (!Array.isArray(value) || value.some((entry) => !(vocabulary as readonly unknown[]).includes(entry))) {
    issue(issues, path, "Only the closed vocabulary is accepted here.");
    return false;
  }
  if (!allowEmpty && value.length === 0) issue(issues, path, "At least one entry is required.");
  if (new Set(value).size !== value.length) issue(issues, path, "Entries must be unique.");
  return true;
}

function stringArray(value: unknown, path: string, issues: ExteriorContractIssue[]): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !nonEmpty(entry))) {
    issue(issues, path, "At least one non-empty ID is required.");
    return false;
  }
  if (new Set(value).size !== value.length) issue(issues, path, "IDs must be unique.");
  return true;
}

function validatePrivacyReview(value: unknown, path: string, issues: ExteriorContractIssue[]): void {
  if (!record(value)) return issue(issues, path, "A privacy review record is required for every intake record.");
  exactKeys(value, ["status", "identifiersFound", "redactions", "reviewer", "reviewedAt"], path, issues);
  if (!(PRIVACY_REVIEW_STATUSES as readonly unknown[]).includes(value.status)) issue(issues, `${path}.status`, "Unknown privacy review status.");
  closedList(value.identifiersFound, PRIVACY_IDENTIFIER_KINDS, `${path}.identifiersFound`, issues);
  if (!nonEmpty(value.reviewer)) issue(issues, `${path}.reviewer`, "A named reviewer is required.");
  if (!timestamp(value.reviewedAt)) issue(issues, `${path}.reviewedAt`, "A canonical UTC review timestamp is required.");
  if (!Array.isArray(value.redactions)) return issue(issues, `${path}.redactions`, "Redaction actions must be an array.");
  value.redactions.forEach((action, index) => {
    const actionPath = `${path}.redactions[${index}]`;
    if (!record(action)) return issue(issues, actionPath, "Redaction action must be an object.");
    exactKeys(action, ["identifier", "method", "redactedArtifactRef", "note"], actionPath, issues);
    if (!(PRIVACY_IDENTIFIER_KINDS as readonly unknown[]).includes(action.identifier)) issue(issues, `${actionPath}.identifier`, "Unknown identifier kind.");
    if (!(PRIVACY_REDACTION_METHODS as readonly unknown[]).includes(action.method)) issue(issues, `${actionPath}.method`, "Unknown redaction method.");
    if (!isSafeReleaseArtifactReference(action.redactedArtifactRef)) issue(issues, `${actionPath}.redactedArtifactRef`, "Redacted artifact reference must be a safe canonical release reference.");
    if (!nonEmpty(action.note)) issue(issues, `${actionPath}.note`, "An explicit redaction note is required.");
  });
}

function validateIntakeRecord(value: unknown, path: string, issues: ExteriorContractIssue[]): void {
  if (!record(value)) return issue(issues, path, "Intake record must be an object.");
  exactKeys(value, [
    "recordId", "classification", "buildingId", "componentIds", "provider", "datasetId", "sourceRecordId", "sourceUrl",
    "attribution", "uncertainty", "sourceDate", "observedAt", "capturedAt", "updatedAt", "licenseId", "approvalId",
    "retention", "derivativeScope", "attestation", "privacyReview",
  ], path, issues);
  for (const field of ["recordId", "classification", "buildingId", "provider", "datasetId", "sourceRecordId", "sourceUrl", "attribution", "uncertainty", "licenseId", "approvalId"] as const) {
    if (!nonEmpty(value[field])) issue(issues, `${path}.${field}`, "Non-empty intake field is required.");
  }
  // The record ID is the only intake identifier the public audit surface may
  // carry, so it must be an opaque token rather than operator prose.
  if (typeof value.recordId !== "string" || !EXTERIOR_INTAKE_RECORD_ID_PATTERN.test(value.recordId)) issue(issues, `${path}.recordId`, "Intake record ID must be an opaque token matching the closed identifier grammar.");
  stringArray(value.componentIds, `${path}.componentIds`, issues);
  for (const field of ["sourceDate", "observedAt", "capturedAt", "updatedAt"] as const) {
    if (!timestamp(value[field])) issue(issues, `${path}.${field}`, "A canonical UTC capture/observation date is required.");
  }
  if (!(EXTERIOR_DERIVATIVE_SCOPES as readonly unknown[]).includes(value.derivativeScope)) issue(issues, `${path}.derivativeScope`, "Unknown derivative scope.");
  if (!record(value.retention)) issue(issues, `${path}.retention`, "Retention policy is required.");
  else {
    exactKeys(value.retention, ["mode", "expiresAt", "conditions"], `${path}.retention`, issues);
    if (value.retention.mode !== "permanent" && value.retention.mode !== "expires") issue(issues, `${path}.retention.mode`, "Unknown intake retention mode.");
    if (value.retention.expiresAt !== null && !timestamp(value.retention.expiresAt)) issue(issues, `${path}.retention.expiresAt`, "Expiry must be a valid timestamp or null.");
    if (value.retention.mode === "expires" && !timestamp(value.retention.expiresAt)) issue(issues, `${path}.retention.expiresAt`, "Expiring intake evidence requires an expiry timestamp.");
    if (value.retention.mode === "permanent" && value.retention.expiresAt !== null) issue(issues, `${path}.retention.expiresAt`, "Permanent intake retention cannot declare an expiry timestamp.");
    if (!nonEmpty(value.retention.conditions)) issue(issues, `${path}.retention.conditions`, "Retention conditions must be explicit.");
  }
  if (!record(value.attestation)) issue(issues, `${path}.attestation`, "An ownership/permission attestation is required.");
  else {
    exactKeys(value.attestation, ["attester", "statement", "fingerprintSha256", "exclusions"], `${path}.attestation`, issues);
    if (!nonEmpty(value.attestation.attester)) issue(issues, `${path}.attestation.attester`, "A named attester is required.");
    if (!nonEmpty(value.attestation.statement)) issue(issues, `${path}.attestation.statement`, "An explicit attestation statement is required.");
    if (!checksum(value.attestation.fingerprintSha256)) issue(issues, `${path}.attestation.fingerprintSha256`, "Attestation fingerprint must be lowercase SHA-256.");
    closedList(value.attestation.exclusions, EXTERIOR_EXCLUSION_TOKENS, `${path}.attestation.exclusions`, issues);
  }
  validatePrivacyReview(value.privacyReview, `${path}.privacyReview`, issues);
}

export function validateExteriorEvidenceIntakeLedgerStructure(value: unknown): ExteriorContractValidation<ExteriorEvidenceIntakeLedger> {
  const issues: ExteriorContractIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Exterior evidence intake ledger must be an object." }] };
  exactKeys(value, ["schemaVersion", "ledgerId", "licenses", "approvals", "records"], "$", issues);
  if (value.schemaVersion !== EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION) issue(issues, "schemaVersion", "Unsupported exterior evidence intake schema version.");
  if (!nonEmpty(value.ledgerId)) issue(issues, "ledgerId", "Intake ledger ID is required.");

  // License and approval shapes are reused verbatim from the accepted T002
  // contract; delegate rather than duplicate their structural rules.
  if (!Array.isArray(value.licenses) || !Array.isArray(value.approvals)) issue(issues, "$", "License and approval collections must be arrays.");
  else {
    const linkage = validateExteriorEvidenceGraphStructure({
      schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
      sources: [],
      licenses: value.licenses,
      approvals: value.approvals,
      evidence: [],
    });
    if (!linkage.ok) issues.push(...linkage.issues.map((entry) => ({ ...entry, path: `linkage.${entry.path}` })));
  }

  if (!Array.isArray(value.records)) issue(issues, "records", "Intake records must be an array.");
  else {
    value.records.forEach((entry, index) => validateIntakeRecord(entry, `records[${index}]`, issues));
    const recordIds = value.records.filter(record).map((entry) => entry.recordId).filter(nonEmpty);
    if (new Set(recordIds).size !== recordIds.length) issue(issues, "records", "Intake record IDs must be unique.");
  }
  return issues.length === 0 ? { ok: true, value: value as unknown as ExteriorEvidenceIntakeLedger } : { ok: false, issues };
}

/** Deterministic ledger checksum used to pin projected approval fingerprints. */
export function exteriorEvidenceIntakeLedgerChecksum(ledger: ExteriorEvidenceIntakeLedger): string {
  return domainSeparatedSha256(LEDGER_HASH_NAMESPACE, {
    schemaVersion: ledger.schemaVersion,
    ledgerId: ledger.ledgerId,
    licenses: [...ledger.licenses].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    approvals: [...ledger.approvals].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
    records: [...ledger.records].sort((left, right) => (left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0)),
  });
}

/**
 * Chains the intake ledger checksum and the operator attestation into the
 * projected approval fingerprint so downstream release validation can
 * re-verify integrity without widening the accepted T002 approval type.
 */
export function projectedIntakeApprovalFingerprint(input: {
  ledgerChecksumSha256: string;
  recordId: string;
  sourceApprovalId: string;
  attestationFingerprintSha256: string;
  /** Binds the projected use, so a private projection relabelled public fails. */
  audience: "private" | "public";
  runtimeTexture: boolean;
  /** Binds the carried restrictions, so stripping a sentinel is tamper-evident. */
  exclusions: readonly string[];
  /** Binds the preserved provenance, so rewriting the scope is tamper-evident. */
  scope: string;
}): string {
  return domainSeparatedSha256(APPROVAL_HASH_NAMESPACE, { ...input, exclusions: [...input.exclusions].sort() });
}

interface RecordEvaluation {
  admitted: AdmittedExteriorEvidenceRecord | null;
  rejected: RejectedExteriorEvidenceRecord | null;
}

function mapExclusions(entries: readonly string[]): { tokens: Set<ExteriorExclusionToken>; unmapped: boolean } {
  const tokens = new Set<ExteriorExclusionToken>();
  let unmapped = false;
  for (const entry of entries) {
    if ((EXTERIOR_EXCLUSION_TOKENS as readonly string[]).includes(entry)) tokens.add(entry as ExteriorExclusionToken);
    else unmapped = true;
  }
  return { tokens, unmapped };
}

function evaluateRecord(
  entry: ExteriorEvidenceIntakeRecord,
  licenses: ReadonlyMap<string, ExteriorLicenseEvidence>,
  approvals: ReadonlyMap<string, ExteriorApprovalEvidence>,
  evaluationMilliseconds: number,
): RecordEvaluation {
  const rejections: ExteriorIntakeReasonCode[] = [];
  const restrictions: ExteriorIntakeReasonCode[] = [];
  const disallowed = (DISALLOWED_EXTERIOR_SOURCE_CLASSIFICATIONS as readonly string[]).includes(entry.classification)
    ? (entry.classification as DisallowedExteriorSourceClassification)
    : null;
  const admittedClassification = (ADMITTED_EXTERIOR_SOURCE_CLASSIFICATIONS as readonly string[]).includes(entry.classification)
    ? (entry.classification as AdmittedExteriorSourceClassification)
    : null;
  if (disallowed !== null) rejections.push("classification-disallowed");
  else if (admittedClassification === null) rejections.push("classification-unknown");

  const license = licenses.get(entry.licenseId);
  const approval = approvals.get(entry.approvalId);
  if (!license) rejections.push("license-linkage-unresolved");
  if (!approval) rejections.push("approval-linkage-unresolved");
  if (approval && entry.attestation.fingerprintSha256 !== approval.fingerprintSha256) rejections.push("attestation-fingerprint-unbound");

  for (const field of ["sourceDate", "observedAt", "capturedAt", "updatedAt"] as const) {
    if (Date.parse(entry[field]) > evaluationMilliseconds) { rejections.push("evidence-future-dated"); break; }
  }
  if (Date.parse(entry.privacyReview.reviewedAt) > evaluationMilliseconds) rejections.push("evidence-future-dated");
  if (approval && Date.parse(approval.approvedAt) > evaluationMilliseconds) rejections.push("approval-future-dated");

  if (entry.retention.expiresAt !== null && Date.parse(entry.retention.expiresAt) <= evaluationMilliseconds) rejections.push("retention-expired");
  if (license) {
    if (license.retention.expiresAt !== null && Date.parse(license.retention.expiresAt) <= evaluationMilliseconds) rejections.push("retention-expired");
    const licenseExpiry = license.retention.expiresAt === null ? null : Date.parse(license.retention.expiresAt);
    const recordExpiry = entry.retention.expiresAt === null ? null : Date.parse(entry.retention.expiresAt);
    if (licenseExpiry !== null && (recordExpiry === null || recordExpiry > licenseExpiry)) rejections.push("retention-exceeds-license");
    if (!license.allowedUse.privateDerivative) rejections.push("private-derivative-not-permitted");
  }

  const privacy = entry.privacyReview;
  const redactedIdentifiers = new Set(privacy.redactions.map((action) => action.identifier));
  const reviewIncomplete = privacy.status === "not-reviewed"
    || (privacy.status === "reviewed-no-identifiers" && (privacy.identifiersFound.length > 0 || privacy.redactions.length > 0))
    || (privacy.status === "reviewed-redacted" && privacy.identifiersFound.length === 0);
  if (reviewIncomplete) restrictions.push("privacy-review-incomplete");
  else if (privacy.status === "reviewed-redacted" && privacy.identifiersFound.some((kind) => !redactedIdentifiers.has(kind))) restrictions.push("privacy-identifiers-unredacted");

  const declaredExclusions = mapExclusions([...(approval?.exclusions ?? []), ...entry.attestation.exclusions]);
  if (declaredExclusions.unmapped) restrictions.push("exclusion-free-text-unmapped");
  if (["public-display", "redistribution", "derivative-conveyance"].some((token) => declaredExclusions.tokens.has(token as ExteriorExclusionToken))) restrictions.push("exclusion-token-conflict");
  if (license) {
    if (license.personalDataRestricted) restrictions.push("personal-data-restricted");
    if (!license.allowedUse.publicDisplay || !license.allowedUse.derivativeConveyance || !license.allowedUse.redistribution) restrictions.push("public-rights-not-permitted");
    if (!license.allowedUse.runtimeTexture) restrictions.push("runtime-texture-not-permitted");
  }
  if (declaredExclusions.tokens.has("runtime-texture") && !restrictions.includes("runtime-texture-not-permitted")) restrictions.push("runtime-texture-not-permitted");
  if (entry.derivativeScope !== "geometry-and-texture") restrictions.push("derivative-scope-excludes-texture");

  if (rejections.length > 0 || admittedClassification === null) {
    return { admitted: null, rejected: { recordId: entry.recordId, disallowedClassification: disallowed, reasonCodes: [...new Set(rejections)].sort() } };
  }
  const privacyBlocked = restrictions.includes("privacy-review-incomplete") || restrictions.includes("privacy-identifiers-unredacted");
  const publicEligible = !privacyBlocked
    && !restrictions.includes("personal-data-restricted")
    && !restrictions.includes("public-rights-not-permitted")
    && !restrictions.includes("exclusion-token-conflict")
    && !restrictions.includes("exclusion-free-text-unmapped");
  const runtimeTextureEligible = !privacyBlocked
    && !restrictions.includes("personal-data-restricted")
    && !restrictions.includes("runtime-texture-not-permitted")
    && !restrictions.includes("derivative-scope-excludes-texture")
    && !restrictions.includes("exclusion-free-text-unmapped");
  return {
    admitted: {
      recordId: entry.recordId,
      classification: admittedClassification,
      publicEligible,
      runtimeTextureEligible,
      exclusionTokens: [...declaredExclusions.tokens].sort(),
      restrictionCodes: [...new Set(restrictions)].sort(),
      record: entry,
    },
    rejected: null,
  };
}

/**
 * Structural then semantic fail-closed admission. Malformed input fails the
 * whole ledger; per-record rights, privacy, exclusion, chronology and
 * retention faults become auditable rejection or restriction accounting.
 */
export function validateExteriorEvidenceIntakeLedger(
  value: unknown,
  options: ExteriorEvidenceIntakeOptions,
): ExteriorContractValidation<ExteriorEvidenceIntakeAdmission> {
  const structural = validateExteriorEvidenceIntakeLedgerStructure(value);
  const issues: ExteriorContractIssue[] = structural.ok ? [] : [...structural.issues];
  if (!timestamp(options.evaluatedAt)) issue(issues, "evaluatedAt", "A canonical UTC evaluation timestamp is required.");
  if (!structural.ok || !timestamp(options.evaluatedAt)) return { ok: false, issues };

  const ledger = structural.value;
  const evaluationMilliseconds = Date.parse(options.evaluatedAt);
  const licenses = new Map(ledger.licenses.map((entry) => [entry.id, entry]));
  const approvals = new Map(ledger.approvals.map((entry) => [entry.id, entry]));
  const admitted: AdmittedExteriorEvidenceRecord[] = [];
  const rejected: RejectedExteriorEvidenceRecord[] = [];
  for (const entry of ledger.records) {
    const evaluation = evaluateRecord(entry, licenses, approvals, evaluationMilliseconds);
    if (evaluation.admitted) admitted.push(evaluation.admitted);
    if (evaluation.rejected) rejected.push(evaluation.rejected);
  }
  const usedLicenseIds = new Set(admitted.map((entry) => entry.record.licenseId));
  const usedApprovalIds = new Set(admitted.map((entry) => entry.record.approvalId));
  return {
    ok: true,
    value: {
      schemaVersion: EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION,
      ledgerId: ledger.ledgerId,
      ledgerChecksumSha256: exteriorEvidenceIntakeLedgerChecksum(ledger),
      durability: { kind: "non-durable-intake-admission", evaluatedAt: options.evaluatedAt, reevaluationRequiredForPromotion: true },
      admitted,
      rejected,
      licenses: ledger.licenses.filter((entry) => usedLicenseIds.has(entry.id)),
      approvals: ledger.approvals.filter((entry) => usedApprovalIds.has(entry.id)),
    },
  };
}

export interface ExteriorEvidenceProjectionOptions {
  audience: "private" | "public";
  runtimeTexture?: boolean;
  /** Restrict the projection to a single building's admitted evidence. */
  buildingId?: string;
}

export interface ExteriorEvidenceProjectionBinding {
  recordId: string;
  approvalId: string;
  sourceApprovalId: string;
  attestationFingerprintSha256: string;
}

export interface ExteriorEvidenceProjection {
  schemaVersion: typeof EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION;
  audience: "private" | "public";
  runtimeTexture: boolean;
  evaluatedAt: string;
  ledgerChecksumSha256: string;
  /** Inputs shaped for `validateExteriorInventoryEvidence` (Phase B). */
  graph: ExteriorEvidenceGraph;
  /** Component ID to projected claim-evidence IDs, for inventory assembly. */
  componentEvidenceIds: Record<string, string[]>;
  bindings: ExteriorEvidenceProjectionBinding[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Mapped exclusion tokens plus closed sentinels for the record-level Phase A
 * verdicts (privacy review, unmappable free text) that a serialized evidence
 * graph would otherwise lose.
 */
function projectedExclusions(entry: AdmittedExteriorEvidenceRecord): ExteriorProjectedExclusion[] {
  const projected = new Set<ExteriorProjectedExclusion>(entry.exclusionTokens);
  if (entry.restrictionCodes.includes("privacy-review-incomplete") || entry.restrictionCodes.includes("privacy-identifiers-unredacted")) projected.add("privacy-review-unresolved");
  if (entry.restrictionCodes.includes("exclusion-free-text-unmapped")) projected.add("unmapped-restriction");
  return [...projected].sort(compareText);
}

/**
 * Graph-level audience guard. Phase B knows nothing about exclusion tokens, so
 * a projected graph that is re-serialized, re-parented, or handed to a
 * different audience must be re-checked here before promotion.
 */
export function validateProjectedGraphAudience(
  graph: ExteriorEvidenceGraph,
  options: { audience: "private" | "public"; runtimeTexture?: boolean },
): ExteriorContractValidation<ExteriorEvidenceGraph> {
  const issues: ExteriorContractIssue[] = [];
  const blocking = new Set<string>([
    ...(options.audience === "public" ? PUBLIC_BLOCKING_PROJECTED_EXCLUSIONS : []),
    ...(options.runtimeTexture === true ? RUNTIME_TEXTURE_BLOCKING_PROJECTED_EXCLUSIONS : []),
  ]);
  for (const approval of graph.approvals) {
    for (const exclusion of approval.exclusions) {
      if (blocking.has(exclusion)) issue(issues, `approvals.${approval.id}.exclusions`, `Approval exclusion ${exclusion} forbids this audience or use.`);
    }
  }
  return issues.length === 0 ? { ok: true, value: graph } : { ok: false, issues };
}

/**
 * Projects admitted, audience-eligible intake records into Phase B evidence
 * graph inputs. Records that were rejected, or restricted away from the
 * requested audience or runtime-texture use, are never projected.
 */
export function projectAdmittedExteriorEvidence(
  admission: ExteriorEvidenceIntakeAdmission,
  options: ExteriorEvidenceProjectionOptions,
): ExteriorEvidenceProjection {
  const runtimeTexture = options.runtimeTexture === true;
  const eligible = admission.admitted
    .filter((entry) => (options.buildingId === undefined || entry.record.buildingId === options.buildingId))
    .filter((entry) => (options.audience === "public" ? entry.publicEligible : true))
    .filter((entry) => (runtimeTexture ? entry.runtimeTextureEligible : true))
    .sort((left, right) => compareText(left.recordId, right.recordId));

  const approvalsById = new Map(admission.approvals.map((entry) => [entry.id, entry]));
  const sources: ExteriorSourceEvidence[] = [];
  const projectedApprovals: ExteriorApprovalEvidence[] = [];
  const claims: ExteriorClaimEvidence[] = [];
  const bindings: ExteriorEvidenceProjectionBinding[] = [];
  const licenseIds = new Set<string>();
  const componentEvidenceIds: Record<string, string[]> = Object.create(null) as Record<string, string[]>;

  for (const entry of eligible) {
    const source = entry.record;
    const sourceId = `source:${source.recordId}`;
    const approvalId = `approval:${source.recordId}`;
    licenseIds.add(source.licenseId);
    sources.push({
      id: sourceId,
      provider: source.provider,
      datasetId: source.datasetId,
      sourceRecordId: source.sourceRecordId,
      sourceUrl: source.sourceUrl,
      sourceDate: source.sourceDate,
      observedAt: source.observedAt,
      capturedAt: source.capturedAt,
      updatedAt: source.updatedAt,
      attribution: source.attribution,
      licenseId: source.licenseId,
      approvalId,
    });
    bindings.push({
      recordId: source.recordId,
      approvalId,
      sourceApprovalId: source.approvalId,
      attestationFingerprintSha256: source.attestation.fingerprintSha256,
    });
    const sourceApproval = approvalsById.get(source.approvalId);
    // Preserve what was actually approved: the original approval ID and its
    // verbatim scope text, so a shard consumer keeps real provenance.
    const scope = `${source.approvalId}: ${sourceApproval?.scope ?? "Intake-admitted exterior evidence."} (building ${source.buildingId})`;
    // Mapped closed tokens plus closed sentinels for Phase A verdicts that
    // would otherwise be lost once the graph is serialized.
    const exclusions = projectedExclusions(entry);
    projectedApprovals.push({
      id: approvalId,
      fingerprintSha256: projectedIntakeApprovalFingerprint({
        ledgerChecksumSha256: admission.ledgerChecksumSha256,
        recordId: source.recordId,
        sourceApprovalId: source.approvalId,
        attestationFingerprintSha256: source.attestation.fingerprintSha256,
        audience: options.audience,
        runtimeTexture,
        exclusions,
        scope,
      }),
      scope,
      exclusions,
      approvedAt: sourceApproval?.approvedAt ?? source.observedAt,
    });
    for (const componentId of [...source.componentIds].sort(compareText)) {
      const claimId = `claim:${source.recordId}:${componentId}`;
      claims.push({ id: claimId, sourceId, basis: "source-observed", uncertainty: source.uncertainty });
      componentEvidenceIds[componentId] = [...(componentEvidenceIds[componentId] ?? []), claimId];
    }
  }

  return {
    schemaVersion: EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION,
    audience: options.audience,
    runtimeTexture,
    evaluatedAt: admission.durability.evaluatedAt,
    ledgerChecksumSha256: admission.ledgerChecksumSha256,
    graph: {
      schemaVersion: EXTERIOR_COMPONENT_SCHEMA_VERSION,
      sources: sources.sort((left, right) => compareText(left.id, right.id)),
      licenses: admission.licenses.filter((entry) => licenseIds.has(entry.id)).sort((left, right) => compareText(left.id, right.id)),
      approvals: projectedApprovals.sort((left, right) => compareText(left.id, right.id)),
      evidence: claims.sort((left, right) => compareText(left.id, right.id)),
    },
    componentEvidenceIds,
    bindings: bindings.sort((left, right) => compareText(left.recordId, right.recordId)),
  };
}

/**
 * Re-verifies that every projected approval fingerprint still chains to the
 * pinned intake ledger checksum. Downstream release validation can call this
 * without decoding any private intake detail.
 */
export function verifyExteriorEvidenceProjectionIntegrity(
  projection: ExteriorEvidenceProjection,
  ledgerChecksumSha256: string,
): ExteriorContractValidation<ExteriorEvidenceProjection> {
  const issues: ExteriorContractIssue[] = [];
  if (projection.ledgerChecksumSha256 !== ledgerChecksumSha256) issue(issues, "ledgerChecksumSha256", "Projection is not pinned to the supplied intake ledger checksum.");
  const approvals = new Map(projection.graph.approvals.map((entry) => [entry.id, entry]));
  if (approvals.size !== projection.bindings.length) issue(issues, "bindings", "Every projected approval requires exactly one intake binding.");
  for (const binding of projection.bindings) {
    const approval = approvals.get(binding.approvalId);
    if (!approval) { issue(issues, `bindings.${binding.recordId}`, "Projected approval does not resolve."); continue; }
    const expected = projectedIntakeApprovalFingerprint({
      ledgerChecksumSha256,
      recordId: binding.recordId,
      sourceApprovalId: binding.sourceApprovalId,
      attestationFingerprintSha256: binding.attestationFingerprintSha256,
      // Recomputed from the projection's own labels, so relabelling a private
      // projection as public breaks every fingerprint.
      audience: projection.audience,
      runtimeTexture: projection.runtimeTexture,
      // Recomputed from the carried approval, so stripping a sentinel token or
      // rewriting the preserved scope no longer matches the stored fingerprint.
      exclusions: approval.exclusions,
      scope: approval.scope,
    });
    if (approval.fingerprintSha256 !== expected) issue(issues, `bindings.${binding.recordId}.fingerprintSha256`, "Projected approval fingerprint does not chain to the intake ledger.");
  }
  // Source closure: a graph carrying any source that no binding produced is not
  // this projection, however well-formed the injected node looks.
  const boundSourceIds = new Set(projection.bindings.map((binding) => `source:${binding.recordId}`));
  if (projection.graph.sources.length !== boundSourceIds.size) issue(issues, "sources", "Projected source count does not match the intake binding set.");
  for (const source of projection.graph.sources) {
    if (!boundSourceIds.has(source.id)) issue(issues, `sources.${source.id}`, "Source evidence was not produced by the intake projection.");
    else if (source.approvalId !== `approval:${source.id.slice("source:".length)}`) issue(issues, `sources.${source.id}.approvalId`, "Projected source must cite its own intake approval.");
  }
  return issues.length === 0 ? { ok: true, value: projection } : { ok: false, issues };
}

export interface ExteriorIntakeReasonCodeCount {
  code: ExteriorIntakeReasonCode;
  count: number;
}

/**
 * Public audit surface. It carries only counts, admitted public record IDs and
 * closed reason codes. It must never carry a private reference, a filesystem
 * path, or operator free text.
 */
export interface ExteriorEvidenceIntakePublicAudit {
  schemaVersion: typeof EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION;
  evaluatedAt: string;
  ledgerChecksumSha256: string;
  counts: { submitted: number; admitted: number; rejected: number; publicEligible: number; runtimeTextureEligible: number };
  admittedPublicRecordIds: string[];
  rejectionCodes: ExteriorIntakeReasonCodeCount[];
  restrictionCodes: ExteriorIntakeReasonCodeCount[];
}

export interface ExteriorEvidenceIntakePrivateAuditRecord {
  recordId: string;
  classification: AdmittedExteriorSourceClassification | DisallowedExteriorSourceClassification | null;
  admitted: boolean;
  publicEligible: boolean;
  runtimeTextureEligible: boolean;
  reasonCodes: ExteriorIntakeReasonCode[];
  attester: string | null;
  reviewer: string | null;
  redactedArtifactRefs: string[];
}

export interface ExteriorEvidenceIntakePrivateAudit extends ExteriorEvidenceIntakePublicAudit {
  ledgerId: string;
  records: ExteriorEvidenceIntakePrivateAuditRecord[];
}

export interface ExteriorEvidenceIntakeAudit {
  private: ExteriorEvidenceIntakePrivateAudit;
  public: ExteriorEvidenceIntakePublicAudit;
}

function tally(codes: readonly ExteriorIntakeReasonCode[][]): ExteriorIntakeReasonCodeCount[] {
  const counts = new Map<ExteriorIntakeReasonCode, number>();
  for (const list of codes) for (const code of list) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts.entries()].map(([code, count]) => ({ code, count })).sort((left, right) => compareText(left.code, right.code));
}

export function buildExteriorEvidenceIntakeAudit(admission: ExteriorEvidenceIntakeAdmission): ExteriorEvidenceIntakeAudit {
  const admittedPublicRecordIds = admission.admitted.filter((entry) => entry.publicEligible).map((entry) => entry.recordId).sort(compareText);
  const publicSurface: ExteriorEvidenceIntakePublicAudit = {
    schemaVersion: EXTERIOR_EVIDENCE_INTAKE_SCHEMA_VERSION,
    evaluatedAt: admission.durability.evaluatedAt,
    ledgerChecksumSha256: admission.ledgerChecksumSha256,
    counts: {
      submitted: admission.admitted.length + admission.rejected.length,
      admitted: admission.admitted.length,
      rejected: admission.rejected.length,
      publicEligible: admittedPublicRecordIds.length,
      runtimeTextureEligible: admission.admitted.filter((entry) => entry.runtimeTextureEligible).length,
    },
    admittedPublicRecordIds,
    rejectionCodes: tally(admission.rejected.map((entry) => entry.reasonCodes)),
    restrictionCodes: tally(admission.admitted.map((entry) => entry.restrictionCodes)),
  };
  const records: ExteriorEvidenceIntakePrivateAuditRecord[] = [
    ...admission.admitted.map((entry) => ({
      recordId: entry.recordId,
      classification: entry.classification as AdmittedExteriorSourceClassification | DisallowedExteriorSourceClassification | null,
      admitted: true,
      publicEligible: entry.publicEligible,
      runtimeTextureEligible: entry.runtimeTextureEligible,
      reasonCodes: entry.restrictionCodes,
      attester: entry.record.attestation.attester,
      reviewer: entry.record.privacyReview.reviewer,
      redactedArtifactRefs: entry.record.privacyReview.redactions.map((action) => action.redactedArtifactRef).sort(compareText),
    })),
    ...admission.rejected.map((entry) => ({
      recordId: entry.recordId,
      classification: entry.disallowedClassification,
      admitted: false,
      publicEligible: false,
      runtimeTextureEligible: false,
      reasonCodes: entry.reasonCodes,
      attester: null,
      reviewer: null,
      redactedArtifactRefs: [],
    })),
  ].sort((left, right) => compareText(left.recordId, right.recordId));
  return {
    private: { ...publicSurface, ledgerId: admission.ledgerId, records },
    public: publicSurface,
  };
}
