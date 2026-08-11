export const EXTERIOR_COMPONENT_SCHEMA_VERSION = "1.0" as const;

export const REQUIRED_EXTERIOR_COMPONENT_KINDS = [
  "massing",
  "setbacks",
  "facade-bays",
  "windows",
  "entrances",
  "ground-floor-divisions",
  "storefronts",
  "cornices",
  "roof-form",
  "balconies",
  "fire-escapes",
  "roof-equipment",
  "water-tanks",
  "materials",
  "signage",
] as const;

/**
 * Component kinds whose absence can be a DETERMINATION rather than a gap.
 *
 * Every other required kind is unconditionally applicable: a promoted building
 * has a massing, a roof form and a material treatment, so an inventory that
 * declares one of those absent is shipping a hole, and
 * `isExteriorComponentReleaseEligible` refuses it exactly as it always has.
 *
 * `setbacks` is different, and the V3 footprint-faithful grammar is what made
 * the difference observable. On a real, irregular footprint the inward tier
 * offset can collapse into self-intersection; V3 REFUSES that offset rather than
 * repairing it, and the resulting massing is a single tier that genuinely has no
 * setbacks. The component is then absent because the generated massing cannot
 * carry one, not because a representable component went unrepresented — and
 * refusing to promote it would have pushed the grammar back toward inventing a
 * setback to satisfy a gate, which is the precise failure the refusal exists to
 * avoid.
 *
 * This is a REFINEMENT of the original rule, not a weakening of it. The rule
 * prevented promoting an incomplete representation SILENTLY; the admission below
 * is kind-scoped at the contract level — no release can widen its own gate — and
 * additionally requires the component's machine-readable `reason`, which travels
 * into per-building provenance and is rendered in the details panel. Adding a
 * kind here is a reviewable contract edit.
 */
export const CONDITIONALLY_APPLICABLE_EXTERIOR_COMPONENT_KINDS = ["setbacks"] as const;

export type ExteriorComponentKind = (typeof REQUIRED_EXTERIOR_COMPONENT_KINDS)[number];
export type ExteriorEvidenceBasis = "source-observed" | "derived";

interface ExteriorComponentBase {
  componentId: string;
  kind: ExteriorComponentKind;
  uncertainty: string;
}

export interface GeneratedExteriorComponent extends ExteriorComponentBase {
  state: "generated";
  generator: {
    id: string;
    version: string;
    inputFingerprintSha256: string;
    seed?: string;
    parametersHashSha256?: string;
    generatedAt: string;
    constraintSourceIds: string[];
  };
}

export interface EvidenceBackedExteriorComponent extends ExteriorComponentBase {
  state: "evidence-backed";
  basis: ExteriorEvidenceBasis;
  evidenceIds: string[];
}

export interface AbsentExteriorComponent extends ExteriorComponentBase {
  state: "absent";
  representation: "none";
  reason: string;
}

export type NotApplicableExteriorComponent =
  | (ExteriorComponentBase & {
      state: "not-applicable";
      basis: "grammar";
      reason: string;
    })
  | (ExteriorComponentBase & {
      state: "not-applicable";
      basis: "evidence";
      reason: string;
      evidenceIds: string[];
    });

export type ExteriorComponentEntry =
  | GeneratedExteriorComponent
  | EvidenceBackedExteriorComponent
  | AbsentExteriorComponent
  | NotApplicableExteriorComponent;

export interface ExteriorComponentInventory {
  schemaVersion: typeof EXTERIOR_COMPONENT_SCHEMA_VERSION;
  buildingId: string;
  components: ExteriorComponentEntry[];
}

export interface ExteriorAllowedUse {
  privateDerivative: boolean;
  publicDisplay: boolean;
  derivativeConveyance: boolean;
  redistribution: boolean;
  runtimeTexture: boolean;
  trainingInput: boolean;
  generationInput: boolean;
  validationOnly: boolean;
}

export interface ExteriorSourceEvidence {
  id: string;
  provider: string;
  datasetId: string;
  sourceRecordId: string;
  sourceUrl: string;
  sourceDate: string;
  observedAt: string;
  capturedAt: string;
  updatedAt: string;
  attribution: string;
  licenseId: string;
  approvalId: string;
}

export interface ExteriorLicenseEvidence {
  id: string;
  termsUrl: string;
  attribution: string;
  retention: {
    mode: "permanent" | "expires" | "conditional";
    expiresAt: string | null;
    conditions: string;
  };
  allowedUse: ExteriorAllowedUse;
  personalDataRestricted: boolean;
}

export interface ExteriorApprovalEvidence {
  id: string;
  fingerprintSha256: string;
  scope: string;
  exclusions: string[];
  approvedAt: string;
}

export interface ExteriorClaimEvidence {
  id: string;
  sourceId: string;
  basis: ExteriorEvidenceBasis;
  uncertainty: string;
}

export interface ExteriorEvidenceGraph {
  schemaVersion: typeof EXTERIOR_COMPONENT_SCHEMA_VERSION;
  sources: ExteriorSourceEvidence[];
  licenses: ExteriorLicenseEvidence[];
  approvals: ExteriorApprovalEvidence[];
  evidence: ExteriorClaimEvidence[];
}

export interface ExteriorContractIssue {
  path: string;
  message: string;
}

export type ExteriorContractValidation<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ExteriorContractIssue[] };

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
  for (const key of Object.keys(value)) if (!allowlist.has(key)) issue(issues, `${path}.${key}`, "Unexpected field for this discriminant.");
  for (const key of allowed) if (!(key in value)) issue(issues, `${path}.${key}`, "Required field is missing.");
}

function stringArray(value: unknown, path: string, issues: ExteriorContractIssue[], requireNonEmpty = false): value is string[] {
  if (!Array.isArray(value) || value.some((item) => !nonEmpty(item))) {
    issue(issues, path, "Expected an array of non-empty IDs.");
    return false;
  }
  if (requireNonEmpty && value.length === 0) issue(issues, path, "At least one ID is required.");
  if (new Set(value).size !== value.length) issue(issues, path, "IDs must be unique.");
  return true;
}

function validateComponent(value: unknown, path: string, issues: ExteriorContractIssue[]): void {
  if (!record(value)) {
    issue(issues, path, "Exterior component entry must be an object.");
    return;
  }
  if (!nonEmpty(value.componentId)) issue(issues, `${path}.componentId`, "Component ID is required.");
  if (!(REQUIRED_EXTERIOR_COMPONENT_KINDS as readonly unknown[]).includes(value.kind)) issue(issues, `${path}.kind`, "Unknown exterior component kind.");
  if (!nonEmpty(value.uncertainty)) issue(issues, `${path}.uncertainty`, "An explicit uncertainty statement is required.");

  if (value.state === "generated") {
    exactKeys(value, ["componentId", "kind", "uncertainty", "state", "generator"], path, issues);
    if (!record(value.generator)) {
      issue(issues, `${path}.generator`, "Generator evidence is required.");
      return;
    }
    const generator = value.generator;
    const optional = ["seed", "parametersHashSha256"].filter((key) => key in generator);
    exactKeys(generator, ["id", "version", "inputFingerprintSha256", "generatedAt", "constraintSourceIds", ...optional], `${path}.generator`, issues);
    if (!nonEmpty(generator.id) || !nonEmpty(generator.version)) issue(issues, `${path}.generator`, "Generator ID and version are required.");
    if (!checksum(generator.inputFingerprintSha256)) issue(issues, `${path}.generator.inputFingerprintSha256`, "A lowercase SHA-256 input fingerprint is required.");
    if (!timestamp(generator.generatedAt)) issue(issues, `${path}.generator.generatedAt`, "A valid generated timestamp is required.");
    const hasSeed = nonEmpty(generator.seed);
    const hasParameters = checksum(generator.parametersHashSha256);
    if (!hasSeed && !hasParameters) issue(issues, `${path}.generator`, "A deterministic seed or parameters hash is required.");
    if (generator.seed !== undefined && !hasSeed) issue(issues, `${path}.generator.seed`, "Seed must be non-empty when present.");
    if (generator.parametersHashSha256 !== undefined && !hasParameters) issue(issues, `${path}.generator.parametersHashSha256`, "Parameters hash must be lowercase SHA-256 when present.");
    stringArray(generator.constraintSourceIds, `${path}.generator.constraintSourceIds`, issues);
    return;
  }

  if (value.state === "evidence-backed") {
    exactKeys(value, ["componentId", "kind", "uncertainty", "state", "basis", "evidenceIds"], path, issues);
    if (value.basis !== "source-observed" && value.basis !== "derived") issue(issues, `${path}.basis`, "Evidence basis must be source-observed or derived.");
    stringArray(value.evidenceIds, `${path}.evidenceIds`, issues, true);
    return;
  }

  if (value.state === "absent") {
    exactKeys(value, ["componentId", "kind", "uncertainty", "state", "representation", "reason"], path, issues);
    if (value.representation !== "none") issue(issues, `${path}.representation`, "Absent means no representation; it is not a real-world absence claim.");
    if (!nonEmpty(value.reason)) issue(issues, `${path}.reason`, "Absent representation reason is required.");
    return;
  }

  if (value.state === "not-applicable") {
    if (value.basis === "grammar") {
      exactKeys(value, ["componentId", "kind", "uncertainty", "state", "basis", "reason"], path, issues);
    } else if (value.basis === "evidence") {
      exactKeys(value, ["componentId", "kind", "uncertainty", "state", "basis", "reason", "evidenceIds"], path, issues);
      stringArray(value.evidenceIds, `${path}.evidenceIds`, issues, true);
    } else issue(issues, `${path}.basis`, "Not-applicable basis must be grammar or evidence.");
    if (!nonEmpty(value.reason)) issue(issues, `${path}.reason`, "Not-applicable reason is required.");
    return;
  }

  issue(issues, `${path}.state`, "Unknown exterior inventory truth state.");
}

export function validateExteriorComponentInventory(value: unknown): ExteriorContractValidation<ExteriorComponentInventory> {
  const issues: ExteriorContractIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Exterior component inventory must be an object." }] };
  exactKeys(value, ["schemaVersion", "buildingId", "components"], "$", issues);
  if (value.schemaVersion !== EXTERIOR_COMPONENT_SCHEMA_VERSION) issue(issues, "schemaVersion", "Unsupported exterior component schema version.");
  if (!nonEmpty(value.buildingId)) issue(issues, "buildingId", "Building ID is required.");
  if (!Array.isArray(value.components)) issue(issues, "components", "Component inventory is required.");
  else {
    value.components.forEach((component, index) => validateComponent(component, `components[${index}]`, issues));
    const entries = value.components.filter(record);
    const ids = entries.map((entry) => entry.componentId).filter(nonEmpty);
    if (new Set(ids).size !== ids.length) issue(issues, "components", "Component IDs must be unique within a building.");
    for (const kind of REQUIRED_EXTERIOR_COMPONENT_KINDS) {
      const count = entries.filter((entry) => entry.kind === kind).length;
      if (count !== 1) issue(issues, "components", `Exactly one class-level ${kind} entry is required.`);
    }
    if (entries.length !== REQUIRED_EXTERIOR_COMPONENT_KINDS.length) issue(issues, "components", "Only the required class-level component vocabulary is allowed.");
  }
  return issues.length === 0 ? { ok: true, value: value as unknown as ExteriorComponentInventory } : { ok: false, issues };
}

function validateAllowedUse(value: unknown, path: string, issues: ExteriorContractIssue[]): void {
  if (!record(value)) {
    issue(issues, path, "Allowed-use policy is required.");
    return;
  }
  const fields = ["privateDerivative", "publicDisplay", "derivativeConveyance", "redistribution", "runtimeTexture", "trainingInput", "generationInput", "validationOnly"] as const;
  exactKeys(value, fields, path, issues);
  for (const field of fields) if (typeof value[field] !== "boolean") issue(issues, `${path}.${field}`, "Allowed-use decisions must be explicit booleans.");
  if (value.validationOnly === true && fields.some((field) => field !== "validationOnly" && value[field] === true)) issue(issues, path, "Validation-only evidence cannot simultaneously authorize another use.");
}

export function validateExteriorEvidenceGraphStructure(value: unknown): ExteriorContractValidation<ExteriorEvidenceGraph> {
  const issues: ExteriorContractIssue[] = [];
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "Exterior evidence graph must be an object." }] };
  exactKeys(value, ["schemaVersion", "sources", "licenses", "approvals", "evidence"], "$", issues);
  if (value.schemaVersion !== EXTERIOR_COMPONENT_SCHEMA_VERSION) issue(issues, "schemaVersion", "Unsupported exterior evidence schema version.");
  for (const collection of ["sources", "licenses", "approvals", "evidence"] as const) if (!Array.isArray(value[collection])) issue(issues, collection, "Evidence collection must be an array.");

  if (Array.isArray(value.sources)) value.sources.forEach((source, index) => {
    const path = `sources[${index}]`;
    if (!record(source)) return issue(issues, path, "Source evidence must be an object.");
    const fields = ["id", "provider", "datasetId", "sourceRecordId", "sourceUrl", "sourceDate", "observedAt", "capturedAt", "updatedAt", "attribution", "licenseId", "approvalId"] as const;
    exactKeys(source, fields, path, issues);
    for (const field of ["id", "provider", "datasetId", "sourceRecordId", "sourceUrl", "attribution", "licenseId", "approvalId"] as const) if (!nonEmpty(source[field])) issue(issues, `${path}.${field}`, "Non-empty source evidence field is required.");
    for (const field of ["sourceDate", "observedAt", "capturedAt", "updatedAt"] as const) if (!timestamp(source[field])) issue(issues, `${path}.${field}`, "A valid explicit source date is required.");
  });

  if (Array.isArray(value.licenses)) value.licenses.forEach((license, index) => {
    const path = `licenses[${index}]`;
    if (!record(license)) return issue(issues, path, "License evidence must be an object.");
    exactKeys(license, ["id", "termsUrl", "attribution", "retention", "allowedUse", "personalDataRestricted"], path, issues);
    for (const field of ["id", "termsUrl", "attribution"] as const) if (!nonEmpty(license[field])) issue(issues, `${path}.${field}`, "Non-empty license field is required.");
    if (!record(license.retention)) issue(issues, `${path}.retention`, "Retention policy is required.");
    else {
      exactKeys(license.retention, ["mode", "expiresAt", "conditions"], `${path}.retention`, issues);
      if (!["permanent", "expires", "conditional"].includes(String(license.retention.mode))) issue(issues, `${path}.retention.mode`, "Unknown retention mode.");
      if (license.retention.expiresAt !== null && !timestamp(license.retention.expiresAt)) issue(issues, `${path}.retention.expiresAt`, "Expiry must be a valid timestamp or null.");
      if (license.retention.mode === "expires" && !timestamp(license.retention.expiresAt)) issue(issues, `${path}.retention.expiresAt`, "Expiring evidence requires an expiry timestamp.");
      if (license.retention.mode === "permanent" && license.retention.expiresAt !== null) issue(issues, `${path}.retention.expiresAt`, "Permanent retention cannot declare an expiry timestamp.");
      if (!nonEmpty(license.retention.conditions)) issue(issues, `${path}.retention.conditions`, "Retention conditions must be explicit.");
    }
    validateAllowedUse(license.allowedUse, `${path}.allowedUse`, issues);
    if (typeof license.personalDataRestricted !== "boolean") issue(issues, `${path}.personalDataRestricted`, "Personal-data restriction must be explicit.");
  });

  if (Array.isArray(value.approvals)) value.approvals.forEach((approval, index) => {
    const path = `approvals[${index}]`;
    if (!record(approval)) return issue(issues, path, "Approval evidence must be an object.");
    exactKeys(approval, ["id", "fingerprintSha256", "scope", "exclusions", "approvedAt"], path, issues);
    if (!nonEmpty(approval.id) || !nonEmpty(approval.scope)) issue(issues, path, "Approval ID and scope are required.");
    if (!checksum(approval.fingerprintSha256)) issue(issues, `${path}.fingerprintSha256`, "Durable approval fingerprint must be lowercase SHA-256.");
    stringArray(approval.exclusions, `${path}.exclusions`, issues);
    if (!timestamp(approval.approvedAt)) issue(issues, `${path}.approvedAt`, "Approval timestamp is required.");
  });

  if (Array.isArray(value.evidence)) value.evidence.forEach((evidence, index) => {
    const path = `evidence[${index}]`;
    if (!record(evidence)) return issue(issues, path, "Claim evidence must be an object.");
    exactKeys(evidence, ["id", "sourceId", "basis", "uncertainty"], path, issues);
    if (!nonEmpty(evidence.id) || !nonEmpty(evidence.sourceId)) issue(issues, path, "Evidence and source IDs are required.");
    if (evidence.basis !== "source-observed" && evidence.basis !== "derived") issue(issues, `${path}.basis`, "Unknown evidence basis.");
    if (!nonEmpty(evidence.uncertainty)) issue(issues, `${path}.uncertainty`, "Evidence uncertainty is required.");
  });

  for (const collection of ["sources", "licenses", "approvals", "evidence"] as const) if (Array.isArray(value[collection])) {
    const ids = value[collection].filter(record).map((entry) => entry.id).filter(nonEmpty);
    if (new Set(ids).size !== ids.length) issue(issues, collection, "Evidence graph IDs must be unique within their collection.");
  }
  return issues.length === 0 ? { ok: true, value: value as unknown as ExteriorEvidenceGraph } : { ok: false, issues };
}

export interface ExteriorEvidenceValidationOptions {
  audience: "private" | "public";
  runtimeTexture?: boolean;
  /** Canonical UTC timestamp at which promotion/rights eligibility is evaluated. */
  evaluatedAt: string;
}

export function validateExteriorInventoryEvidence(
  inventoryValue: unknown,
  graphValue: unknown,
  options: ExteriorEvidenceValidationOptions,
): ExteriorContractValidation<{ inventory: ExteriorComponentInventory; graph: ExteriorEvidenceGraph }> {
  const inventoryResult = validateExteriorComponentInventory(inventoryValue);
  const graphResult = validateExteriorEvidenceGraphStructure(graphValue);
  const issues: ExteriorContractIssue[] = [];
  if (!inventoryResult.ok) issues.push(...inventoryResult.issues);
  if (!graphResult.ok) issues.push(...graphResult.issues.map((entry) => ({ ...entry, path: `evidenceGraph.${entry.path}` })));
  if (!timestamp(options.evaluatedAt)) issue(issues, "evaluatedAt", "A canonical UTC evaluation timestamp is required.");
  if (!inventoryResult.ok || !graphResult.ok || !timestamp(options.evaluatedAt)) return { ok: false, issues };
  const inventory = inventoryResult.value;
  const graph = graphResult.value;
  const evaluationMilliseconds = Date.parse(options.evaluatedAt);
  const sources = new Map(graph.sources.map((entry) => [entry.id, entry]));
  const licenses = new Map(graph.licenses.map((entry) => [entry.id, entry]));
  const approvals = new Map(graph.approvals.map((entry) => [entry.id, entry]));
  const evidence = new Map(graph.evidence.map((entry) => [entry.id, entry]));
  const usedSources = new Set<string>();
  const usedEvidence = new Set<string>();

  const validateSourceRights = (sourceId: string, path: string, generationConstraint: boolean): void => {
    const source = sources.get(sourceId);
    if (!source) return issue(issues, path, "Referenced source evidence does not resolve.");
    usedSources.add(sourceId);
    const license = licenses.get(source.licenseId);
    if (!license) issue(issues, path, "Referenced source license does not resolve.");
    const approval = approvals.get(source.approvalId);
    if (!approval) issue(issues, path, "Referenced source approval does not resolve.");
    if (!license) return;
    for (const field of ["sourceDate", "observedAt", "capturedAt", "updatedAt"] as const) if (Date.parse(source[field]) > evaluationMilliseconds) issue(issues, `evidenceGraph.sources.${source.id}.${field}`, "Source chronology cannot be later than the evaluation timestamp.");
    if (approval && Date.parse(approval.approvedAt) > evaluationMilliseconds) issue(issues, `evidenceGraph.approvals.${approval.id}.approvedAt`, "Approval cannot be later than the evaluation timestamp.");
    if (license.retention.expiresAt !== null && Date.parse(license.retention.expiresAt) <= evaluationMilliseconds) issue(issues, `evidenceGraph.licenses.${license.id}.retention.expiresAt`, "Source retention is expired at the evaluation timestamp.");
    if (!license.allowedUse.privateDerivative) issue(issues, path, "Private derivative use is not allowed.");
    if (generationConstraint && !license.allowedUse.generationInput) issue(issues, path, "Source is not approved as generation input.");
    if (license.allowedUse.validationOnly && !generationConstraint) issue(issues, path, "Validation-only evidence cannot support represented exterior truth.");
    if (options.audience === "public" && (!license.allowedUse.publicDisplay || !license.allowedUse.derivativeConveyance || !license.allowedUse.redistribution)) issue(issues, path, "Public display, derivative conveyance, and redistribution rights are required.");
    if (options.runtimeTexture && !license.allowedUse.runtimeTexture) issue(issues, path, "Runtime texture use is not allowed.");
    if (license.personalDataRestricted && (options.audience === "public" || options.runtimeTexture)) issue(issues, path, "Personal-data-restricted evidence cannot enter public or runtime-texture content.");
  };

  inventory.components.forEach((component, index) => {
    const path = `components[${index}]`;
    if (component.state === "generated") {
      if (Date.parse(component.generator.generatedAt) > evaluationMilliseconds) issue(issues, `${path}.generator.generatedAt`, "Generated content cannot be later than the evaluation timestamp.");
      component.generator.constraintSourceIds.forEach((sourceId, sourceIndex) => validateSourceRights(sourceId, `${path}.generator.constraintSourceIds[${sourceIndex}]`, true));
      return;
    }
    const evidenceIds = component.state === "evidence-backed" || (component.state === "not-applicable" && component.basis === "evidence") ? component.evidenceIds : [];
    evidenceIds.forEach((evidenceId, evidenceIndex) => {
      const claim = evidence.get(evidenceId);
      if (!claim) return issue(issues, `${path}.evidenceIds[${evidenceIndex}]`, "Referenced claim evidence does not resolve.");
      usedEvidence.add(evidenceId);
      const expectedBasis = component.state === "evidence-backed" ? component.basis : undefined;
      if (expectedBasis !== undefined && claim.basis !== expectedBasis) issue(issues, `${path}.evidenceIds[${evidenceIndex}]`, "Claim evidence basis does not match the component basis.");
      validateSourceRights(claim.sourceId, `${path}.evidenceIds[${evidenceIndex}]`, false);
    });
  });

  const usedLicenses = new Set([...usedSources].map((id) => sources.get(id)?.licenseId).filter(nonEmpty));
  const usedApprovals = new Set([...usedSources].map((id) => sources.get(id)?.approvalId).filter(nonEmpty));
  for (const [collection, all, used] of [
    ["sources", sources, usedSources],
    ["licenses", licenses, usedLicenses],
    ["approvals", approvals, usedApprovals],
    ["evidence", evidence, usedEvidence],
  ] as const) for (const id of all.keys()) if (!used.has(id)) issue(issues, `evidenceGraph.${collection}`, `Unreferenced ${collection} node ${id} leaves the evidence graph open.`);

  return issues.length === 0 ? { ok: true, value: { inventory, graph } } : { ok: false, issues };
}

export function exteriorComponentFidelity(component: ExteriorComponentEntry): "generated" | "evidence-backed" | "no-representation" | "not-applicable" {
  if (component.state === "absent") return "no-representation";
  return component.state;
}

/**
 * Whether a component may be promoted inside a `status:"available"` building.
 *
 * Unchanged for every state except `absent`, and unchanged for every absent kind
 * except the conditionally-applicable ones. For those, the absence must still be
 * EXPLAINED: the reason is re-checked here rather than relied on from the shape
 * validator, so the promotion gate itself is what refuses an unexplained gap.
 */
export function isExteriorComponentReleaseEligible(component: ExteriorComponentEntry): boolean {
  if (component.state !== "absent") return true;
  if (!(CONDITIONALLY_APPLICABLE_EXTERIOR_COMPONENT_KINDS as readonly string[]).includes(component.kind)) return false;
  return typeof component.reason === "string" && component.reason.trim().length > 0;
}
