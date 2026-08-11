/**
 * The rights-cleared evidence intake behind Block 835's cited facade-material
 * style overrides, and the override map itself.
 *
 * Both live in ONE module on purpose. The override names an intake record id and
 * the plan hash covers that id, so an override whose record did not exist — or
 * existed but was rejected, or was admitted only for a use this does not make —
 * would be a citation to nothing. Keeping the ledger beside the map makes that
 * checkable by reading, and `block835-facade-material-intake.test.ts` checks it
 * by running the real intake admission over the real ledger.
 *
 * WHAT THIS ADMITS, EXACTLY
 *
 * A TEXT fact from an encyclopaedia article: which materials the Empire State
 * Building's exterior is documented to use. It admits no image. Nothing is
 * traced, sampled, colour-picked or reproduced from any photograph, and the
 * record says so in its own `derivativeScope: "measurement-only"`, which the
 * intake evaluator turns into the restriction code
 * `derivative-scope-excludes-texture`. That restriction is CORRECT and is meant
 * to stay: the fact may drive a designed style class, and may never become a
 * texture.
 *
 * WHY THE PROJECTION IS NOT SPLICED INTO THE RELEASE EVIDENCE GRAPH
 *
 * `validateExteriorInventoryEvidence` closes its graph: every evidence node must
 * be referenced by a component that is `evidence-backed`, or `not-applicable`
 * with an evidence basis. The V3 inventory declares its components `generated`
 * (or, for a refused setback, `absent`), and that is the honest description —
 * the shipped geometry IS generated, and a sourced material fact does not make
 * a generated bay rhythm evidence-backed. Splicing a claim node in would have
 * forced one of two lies: relabelling generated components as evidence-backed,
 * or leaving an orphan node that the closure rule exists to forbid.
 *
 * So the citation travels where it is true: in the PLAN, whose hash covers it,
 * and from there into per-asset provenance and the details panel. The release's
 * evidence graph keeps saying exactly what it always said — the rights basis for
 * the geometry is the NYC footprint dataset — which remains true.
 */

import {
  buildExteriorEvidenceIntakeAudit,
  validateExteriorEvidenceIntakeLedger,
  type ExteriorEvidenceIntakeAdmission,
  type ExteriorEvidenceIntakeLedger,
} from "../domain/exterior-evidence-intake.ts";
import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";
import type { ExteriorApprovalEvidence, ExteriorLicenseEvidence } from "../domain/exterior-contract.ts";
import type { V3StyleOverride } from "../domain/deterministic-facade-generator-v3.ts";

export const BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER_ID = "intake-ledger:manhattan:block-835:facade-material:20260811" as const;
export const BLOCK835_FACADE_MATERIAL_INTAKE_EVALUATED_AT = "2026-08-11T00:00:00.000Z" as const;
export const BLOCK835_FACADE_MATERIAL_APPROVAL_ID = "approval:manhattan:block-835:facade-material-intake:20260811" as const;
export const BLOCK835_FACADE_MATERIAL_LICENSE_ID = "license:wikipedia:cc-by-sa-4.0" as const;

/** Opaque intake record id, and the exact token the plan cites. */
export const ESB_FACADE_MATERIAL_RECORD_ID = "intake:wikipedia:doitt-778052:facade-material" as const;

export const BLOCK835_FACADE_MATERIAL_APPROVAL_SCOPE =
  "Admission of documented TEXT facts about exterior facade materials, from compatible-licensed encyclopaedia article prose, for the sole purpose of selecting a designed facade style class in the deterministic V3 exterior grammar for Manhattan Block 835. It admits no imagery and authorizes no texture, no tracing, no colour sampling and no reproduction of any photograph." as const;

export const BLOCK835_FACADE_MATERIAL_APPROVAL_EXCLUSIONS: readonly string[] = [
  "runtime-texture",
  "training-input",
];

export const BLOCK835_FACADE_MATERIAL_APPROVAL_NOTE =
  "In-session user authorization dated 2026-08-11 admitted the Wikipedia article text facts about the Empire State Building's exterior materials as a rights-cleared source for selecting a designed facade STYLE CLASS only. The admitted material is article prose under CC BY-SA, cited and attributed; no image from that article or any other source was ingested, traced, sampled or reproduced. The admission does not authorize a runtime texture, does not authorize training use, and does not license any claim that the shipped surface reproduces the real building." as const;

export function block835FacadeMaterialApprovalFingerprint(): string {
  return sha256HexSync(stableSerialize({
    scope: BLOCK835_FACADE_MATERIAL_APPROVAL_SCOPE,
    exclusions: [...BLOCK835_FACADE_MATERIAL_APPROVAL_EXCLUSIONS],
    approvedAt: BLOCK835_FACADE_MATERIAL_INTAKE_EVALUATED_AT,
    approvalNote: BLOCK835_FACADE_MATERIAL_APPROVAL_NOTE,
  }));
}

export const BLOCK835_FACADE_MATERIAL_APPROVAL: ExteriorApprovalEvidence = {
  id: BLOCK835_FACADE_MATERIAL_APPROVAL_ID,
  fingerprintSha256: block835FacadeMaterialApprovalFingerprint(),
  scope: BLOCK835_FACADE_MATERIAL_APPROVAL_SCOPE,
  exclusions: [...BLOCK835_FACADE_MATERIAL_APPROVAL_EXCLUSIONS],
  approvedAt: BLOCK835_FACADE_MATERIAL_INTAKE_EVALUATED_AT,
};

/**
 * CC BY-SA 4.0, as Wikipedia article text is licensed.
 *
 * `runtimeTexture: false` is not a formality. The licence would not stop a
 * texture on its own; the point is that this project never derives one from
 * this evidence, and the intake evaluator raises `runtime-texture-not-permitted`
 * from exactly this flag.
 */
export const BLOCK835_FACADE_MATERIAL_LICENSE: ExteriorLicenseEvidence = {
  id: BLOCK835_FACADE_MATERIAL_LICENSE_ID,
  termsUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  attribution: "Wikipedia contributors, \"Empire State Building\", Wikipedia, licensed CC BY-SA 4.0.",
  retention: {
    mode: "conditional",
    expiresAt: null,
    conditions: "Attribution and share-alike must travel with any conveyed derivative of the admitted text. Only the text fact is retained; no image is retained, and no image was ingested.",
  },
  allowedUse: {
    privateDerivative: true,
    publicDisplay: true,
    derivativeConveyance: true,
    redistribution: true,
    runtimeTexture: false,
    trainingInput: false,
    generationInput: true,
    validationOnly: false,
  },
  personalDataRestricted: false,
};

/**
 * The admitted fact, in the words the details panel may show.
 *
 * It is a materials list, not an appearance claim, and it is deliberately short
 * enough to be read in full in a panel rather than summarised into something
 * the source does not say.
 */
export const ESB_FACADE_MATERIAL_FACT =
  "Indiana limestone facade with stainless steel window frames, aluminium spandrels and a black granite base." as const;

export const BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER: ExteriorEvidenceIntakeLedger = {
  schemaVersion: "1.0",
  ledgerId: BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER_ID,
  licenses: [BLOCK835_FACADE_MATERIAL_LICENSE],
  approvals: [BLOCK835_FACADE_MATERIAL_APPROVAL],
  records: [{
    recordId: ESB_FACADE_MATERIAL_RECORD_ID,
    classification: "compatible-licensed",
    buildingId: "doitt:778052",
    // The one component a facade-material fact bears on. It bears on no other,
    // and listing more would over-claim what the source supports.
    componentIds: ["doitt:778052:materials"],
    provider: "wikipedia",
    datasetId: "wikipedia-article-text",
    sourceRecordId: "Empire_State_Building",
    sourceUrl: "https://en.wikipedia.org/wiki/Empire_State_Building",
    attribution: "Wikipedia contributors, \"Empire State Building\", Wikipedia, licensed CC BY-SA 4.0.",
    uncertainty: "Documented material list taken from encyclopaedia article prose. It records WHICH materials the building is documented to use; it is not a measurement, not a survey, and says nothing about tone, coursing, condition, weathering or how any surface looks today.",
    sourceDate: "2026-08-11T00:00:00.000Z",
    observedAt: "2026-08-11T00:00:00.000Z",
    capturedAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    licenseId: BLOCK835_FACADE_MATERIAL_LICENSE_ID,
    approvalId: BLOCK835_FACADE_MATERIAL_APPROVAL_ID,
    retention: {
      mode: "permanent",
      expiresAt: null,
      conditions: "Only the admitted text fact and its attribution are retained. No image was ingested and none is retained.",
    },
    // The load-bearing field. `measurement-only` is what raises
    // `derivative-scope-excludes-texture`, and that restriction must remain.
    derivativeScope: "measurement-only",
    attestation: {
      attester: "urban-digital-twin operator (in-session authorization 2026-08-11)",
      statement: "The admitted material is Wikipedia article TEXT under CC BY-SA, cited and attributed. No image was ingested, traced, sampled or reproduced. The fact is used only to select a designed facade style class.",
      fingerprintSha256: block835FacadeMaterialApprovalFingerprint(),
      exclusions: ["runtime-texture", "training-input"],
    },
    privacyReview: {
      // Article prose about a building's cladding carries no personal
      // identifier, and no image was ingested that could carry one.
      status: "reviewed-no-identifiers",
      identifiersFound: [],
      redactions: [],
      reviewer: "urban-digital-twin operator",
      reviewedAt: "2026-08-11T00:00:00.000Z",
    },
  }],
};

/** The admission verdict for the ledger above, evaluated at intake time. */
export function block835FacadeMaterialAdmission(): ExteriorEvidenceIntakeAdmission {
  const result = validateExteriorEvidenceIntakeLedger(BLOCK835_FACADE_MATERIAL_INTAKE_LEDGER, {
    evaluatedAt: BLOCK835_FACADE_MATERIAL_INTAKE_EVALUATED_AT,
  });
  if (!result.ok) throw new Error(`Block 835 facade-material intake ledger is invalid: ${stableSerialize(result.issues)}`);
  return result.value;
}

/** Counts-and-codes audit surface for the record, carrying no operator prose. */
export function block835FacadeMaterialAudit(): ReturnType<typeof buildExteriorEvidenceIntakeAudit> {
  return buildExteriorEvidenceIntakeAudit(block835FacadeMaterialAdmission());
}

/**
 * Hand-listed, one entry per building. There is no rule here and there is not
 * meant to be: an override exists only where a rights-cleared record exists, and
 * a mechanism that could infer one would be inventing the citation it claims to
 * carry. Thirteen of Block 835's fourteen buildings appear nowhere below and
 * keep `selectV3StyleClass`'s designed draw untouched.
 */
export const BLOCK835_V3_STYLE_OVERRIDES: ReadonlyMap<string, V3StyleOverride> = new Map<string, V3StyleOverride>([
  ["doitt:778052", {
    // Limestone with a stone base and metal trim is what `stone-neutral`
    // designs. The class is still a DESIGNED look; the citation makes it the
    // less wrong of the four, not a reproduction. Before this override the
    // Empire State Building drew `curtain-cool` — a glass curtain wall.
    styleClass: "stone-neutral",
    evidenceRecordId: ESB_FACADE_MATERIAL_RECORD_ID,
    fact: ESB_FACADE_MATERIAL_FACT,
  }],
]);

/**
 * The panel-facing citation for one override, resolved from the intake ledger
 * rather than restated. The plan carries the record ID and the fact; provider,
 * URL and attribution belong to the record, and reading them from it is what
 * keeps the shipped citation and the admitted evidence from drifting apart.
 */
export function block835CitedStyleFor(canonicalBuildingId: string): {
  styleClass: string;
  evidenceRecordId: string;
  fact: string;
  provider: string;
  sourceUrl: string;
  attribution: string;
} | undefined {
  const override = BLOCK835_V3_STYLE_OVERRIDES.get(canonicalBuildingId);
  if (!override) return undefined;
  const admission = block835FacadeMaterialAdmission();
  const admitted = admission.admitted.find((entry) => entry.recordId === override.evidenceRecordId);
  // A citation to a record that was NOT admitted, or was admitted but is not
  // publicly conveyable, must never reach a public asset. Failing here is the
  // whole reason the resolution reads the admission rather than the ledger.
  if (!admitted) throw new Error(`Cited style for ${canonicalBuildingId} names intake record ${override.evidenceRecordId}, which was not admitted.`);
  if (!admitted.publicEligible) throw new Error(`Intake record ${override.evidenceRecordId} is not eligible for public conveyance.`);
  if (admitted.record.buildingId !== canonicalBuildingId) throw new Error(`Intake record ${override.evidenceRecordId} is not about ${canonicalBuildingId}.`);
  return {
    styleClass: override.styleClass,
    evidenceRecordId: override.evidenceRecordId,
    fact: override.fact,
    provider: admitted.record.provider,
    sourceUrl: admitted.record.sourceUrl,
    attribution: admitted.record.attribution,
  };
}
