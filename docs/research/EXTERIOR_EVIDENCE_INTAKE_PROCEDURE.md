# Exterior evidence intake procedure

Operating procedure for supplying exterior reference evidence to the intake
contract in `src/domain/exterior-evidence-intake.ts`. It implements the
admission side of Decision 0022 and stays inside the prohibitions in Decision
0010 and `PLACE_TRUTH_SOURCE_MATRIX.md`.

This procedure describes preparing a record. It does not authorize acquiring
data, calling a provider, publishing, or deploying. Those remain separate
explicitly approved workflows.

## What is auto-rejected

The contract fails closed, with a machine-readable reason code, before any
projection when:

- The source classification is `google-maps`, `street-view`,
  `unlicensed-web-photo` or `platform-restricted`
  (`classification-disallowed`). Google Maps and Street View imagery,
  screenshots, downloaded tiles, scraped place content, extracted textures,
  photogrammetry from Google panoramas, and Google-derived facade measurements
  are prohibited by Decision 0010 and cannot be admitted by any workflow.
- The classification is any other value, including a free-text description
  (`classification-unknown`). There is no "other" category.
- The cited license or approval ID does not resolve
  (`license-linkage-unresolved`, `approval-linkage-unresolved`).
- The attestation fingerprint is not the fingerprint of the cited approval
  turn (`attestation-fingerprint-unbound`).
- The license does not permit private derivative use
  (`private-derivative-not-permitted`).
- Any capture, observation, update or review date, or the approval, is later
  than the evaluation timestamp (`evidence-future-dated`,
  `approval-future-dated`).
- Record retention has already expired, or outlives the license retention
  (`retention-expired`, `retention-exceeds-license`).
- Any structural fault: an unexpected or missing field, a non-canonical UTC
  timestamp, a duplicate record ID, an exclusion value outside the closed token
  vocabulary, or a redaction reference that is not a safe canonical release
  reference.
- A record ID that is not an opaque token matching
  `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/`. The record ID is the only intake
  identifier a public audit may carry, so it must not contain prose, a person's
  name, an address, or a description. Use `record:b2-front-01`, not
  `photo of Jane's shopfront`.

A rejected record is never projected into an evidence graph and never reaches
a release.

## 1. Classify the source

Choose exactly one admitted classification:

| Classification | Use when |
| --- | --- |
| `user-owned` | The operator personally created or owns the artifact. |
| `public-domain` | The artifact is verifiably in the public domain. |
| `compatible-licensed` | A license grants the specific rights this project needs. |
| `explicitly-permitted` | The rights holder gave written permission for this project. |

If none applies, stop. Do not approximate.

## 2. Record the ownership or permission attestation

Every record carries an attestation with a named attester, an explicit
statement of what is owned or permitted, a fingerprint, and exclusion tokens.

The fingerprint must be the SHA-256 fingerprint of the recorded approval turn
that the attestation is keyed to, and it must equal the cited approval's
`fingerprintSha256`. This binds the assertion to a specific recorded approval
rather than to a general claim.

Write the statement plainly and narrowly. It is operator free text: it is kept
in the private audit surface and never published.

## 3. Link license and approval by reference

Add the license and approval to the ledger's `licenses` and `approvals`
collections using the existing exterior contract shapes, and reference them by
ID from the record. Declare every allowed use explicitly, including
`publicDisplay`, `derivativeConveyance`, `redistribution` and `runtimeTexture`.
Absent public rights withhold public eligibility; they do not fail silently.

Express any carve-out as a closed exclusion token:

| Token | Withholds |
| --- | --- |
| `public-display` | Public eligibility |
| `redistribution` | Public eligibility |
| `derivative-conveyance` | Public eligibility |
| `runtime-texture` | Runtime-texture eligibility |
| `training-input` | Recorded; no automatic effect on display |

A carve-out that cannot be expressed as a token must not be written as free
text and then assumed enforced. Unmapped free text withholds public and
runtime-texture eligibility outright. The text itself is never projected into
an artifact; a closed `unmapped-restriction` sentinel is projected in its
place, so the restriction survives serialization and keeps blocking public and
runtime-texture use. If the carve-out matters, get it expressed as a token or
as a license allowed-use decision.

## 4. Complete the privacy review before ingest

Review every supplied artifact for personal identifiers. Record the review on
the record itself:

- `status: "reviewed-no-identifiers"` when no face, plate or other personal
  identifier is present. `identifiersFound` and `redactions` must be empty.
- `status: "reviewed-redacted"` when identifiers were found. List every kind in
  `identifiersFound`, and supply a redaction action for each kind naming the
  method and the retained redacted artifact reference.
- `status: "not-reviewed"` when the review has not happened.

An incomplete, contradictory, or partially redacted review withholds public and
runtime-texture eligibility, and projects a closed `privacy-review-unresolved`
sentinel so the verdict survives serialization. The record can still support
private derivative work. Redact before ingest where possible; a redaction
action is evidence that redaction happened, not a request for it.

This review is an operator attestation. It performs no detection. Treat it as
accountability, not assurance.

## 5. Declare retention and derivative scope

Retention is `permanent` or `expires` with an explicit expiry and explicit
conditions. It must not outlive the license retention.

Derivative scope is one of `measurement-only`, `geometry-derivative` or
`geometry-and-texture`. Only `geometry-and-texture` can support runtime-texture
use, and only when the license and exclusion tokens also permit it.

## 6. Map the record to components and evaluate

Name the building and the inventory component IDs the evidence supports, then
evaluate the ledger with a canonical UTC `evaluatedAt`.

Read the resulting admission, not just its success. Check per-record
`publicEligible`, `runtimeTextureEligible` and `restrictionCodes`, and check
the rejected list. Then project the admitted records for the audience you
actually intend, and let the existing exterior contract validate promotion.

Project for the use you intend, and never reuse a projection for a wider one.
Before promoting any projected graph, call `validateProjectedGraphAudience`
with the audience and runtime-texture use you are actually promoting. The
existing exterior contract does not know about exclusion tokens or privacy
verdicts, and release validation does not call the guard for you.

Admission is not durable. It expresses only what was true at `evaluatedAt`.
Re-evaluate before every promotion, and re-evaluate whenever a license,
approval, consent, or retention condition changes.

## 7. Publish nothing from the private surface

The public audit surface carries only counts, admitted public-eligible record
IDs and reason codes. Never copy an attester name, an attestation statement, a
reviewer name, a redaction note, a retention condition, a source URL, a
redacted artifact reference, or any private path into a public artifact,
issue, changelog or report.
