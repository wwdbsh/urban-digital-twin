# Decision 0022: rights-cleared exterior evidence intake and partition security

Date: 2026-08-10

Status: accepted for contract and synthetic-fixture validation. It authorizes
no acquisition, no provider request, no publication, and no operator CLI.

## Decision

Exterior evidence admission is split into two phases with an explicit seam.

Phase A is new and owned by `src/domain/exterior-evidence-intake.ts`. It decides
whether an operator-supplied evidence record may be admitted at all, and for
which audience and use. Phase B is unchanged and remains owned by the accepted
`validateExteriorInventoryEvidence` contract: whether represented exterior
truth may be promoted into a release. Phase A never re-implements a Phase B
rule, never widens an accepted T002 type, and hands Phase B ordinary
`ExteriorEvidenceGraph` inputs through a projection function.

Phase A is additive. It reuses the accepted `ExteriorLicenseEvidence` and
`ExteriorApprovalEvidence` shapes by ID reference and delegates their structural
validation to `validateExteriorEvidenceGraphStructure`, so the accepted
exterior contract types keep their exact-key closure.

## Closed vocabularies

Source classification is mandatory and closed-world. Only `user-owned`,
`public-domain`, `compatible-licensed` and `explicitly-permitted` are admitted.
A separate documented vocabulary — `google-maps`, `street-view`,
`unlicensed-web-photo`, `platform-restricted` — exists solely so rejection
accounting can name a prohibited origin. Any other value, including an unknown
free-text string, fails closed as `classification-unknown`, and the operator
string is never echoed into an audit surface.

Exclusions are a closed token vocabulary: `public-display`, `redistribution`,
`derivative-conveyance`, `runtime-texture`, `training-input`. Tokens are
resolved from the cited approval and the operator attestation. A token that
contradicts the requested use withholds that eligibility.

Two closed sentinel tokens — `privacy-review-unresolved` and
`unmapped-restriction` — are additionally projected into an approval's
`exclusions` so that record-level Phase A verdicts survive serialization.
`ExteriorApprovalEvidence.exclusions` is already `string[]`, so this needs no
accepted-type change. Operator free text that cannot be mapped to a token is
replaced by the `unmapped-restriction` sentinel and is never itself projected
into an artifact.

Because Phase B has no notion of exclusions, a graph-level audience guard,
`validateProjectedGraphAudience`, re-derives the verdict from the projected
approvals. A graph that is re-serialized, re-parented, or handed to a different
audience must pass it before promotion: `public-display`, `redistribution`,
`derivative-conveyance`, `privacy-review-unresolved` and `unmapped-restriction`
block public use, and `runtime-texture`, `privacy-review-unresolved` and
`unmapped-restriction` block runtime-texture use.

Rejection and restriction reasons are a closed machine-readable code
vocabulary. Codes are the only rights vocabulary the public audit surface may
carry.

## Attestation-only privacy review and its structural backstop

Personal-identifier review is attestation-based. An operator records a review
status, the identifier kinds found (`faces`, `plates`, `other`), redaction
actions with references to the retained redacted artifact, a named reviewer,
and a review timestamp. The contract performs no detection and asserts no
detection accuracy.

The review is per record. It is deliberately not routed through the per-license
`personalDataRestricted` flag, because one license commonly covers many
artifacts with different identifier exposure; a per-license flag cannot express
that one photograph in a set contained a face.

An incomplete or self-contradictory review, and identifiers found without
matching redaction evidence, withhold public and runtime-texture eligibility
entirely. Such records may still be admitted for private derivative work.
Redaction artifact references are validated with the existing
`isSafeReleaseArtifactReference` grammar; an unsafe reference is a structural
failure of the whole ledger.

Because attestation is unverifiable by this repository, it is backed by a
structural gate in `src/release/multi-lod-assembly.ts`. A public assembly
package, and any package that declares intake-derived lineage, must be
texture-free. This matters because the measured `textureCount` only observes
textures reachable from a material used by a primitive, so raw imagery — the
one payload that can carry a face or a plate — could ride into a public package
through several routes that every metadata-level rights check accepted. A
texture-free package must therefore satisfy all of:

- every declared LOD texture count is zero, and no packaged GLB declares glTF
  `images` or `textures`;
- every declared `bufferView` is referenced by an accessor, closing imagery
  reachable only through a view nothing reads;
- the declared `bufferView` set covers the BIN buffer as a contiguous union:
  the lowest view starts at offset zero and no view begins more than the
  three-byte alignment slack past the running covered end, closing imagery
  hidden in an interior gap between two otherwise legitimate views;
- `buffers[0].byteLength` equals that union coverage rounded up to four,
  closing imagery hidden in a declared BIN tail that no view covers.

Union coverage is required rather than maximum extent: a maximum-extent rule
admits two live views at, say, `[0, 36)` and `[2036, 2048)` while two thousand
uncovered interior bytes carry a JPEG. This list closes the routes known to
this decision; it is not a proof that no other route exists.

Public enforcement is unconditional; the lineage flag can only add enforcement,
never remove it. Private packages remain free to hold operator-owned imagery,
and all three rules are inert for them.

## Audit surface redaction invariant

The intake audit has two surfaces. The private surface may carry full detail.
The public surface carries only counts, the IDs of admitted public-eligible
records, and closed reason codes. It must never carry a private reference, a
filesystem path, an artifact path, a source URL, or any operator free text,
including attester names, attestation statements, reviewer names, retention
conditions or redaction notes. Rejected record IDs are not published either.
This invariant is asserted negatively by test, not merely by construction.

The record ID is the only intake identifier the public surface may carry, so it
is constrained at structural validation to an opaque grammar,
`/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/`. An operator cannot smuggle prose into a
public audit by writing it as a record ID.

## Non-durable admission

Admission records the `evaluatedAt` instant at which it was decided and
declares itself non-durable. Admitted at intake is not admissible at
promotion. Future-dated evidence, future-dated approvals, expired retention,
and record retention that outlives its license retention all fail closed
against `evaluatedAt`; but nothing about that decision survives a change of
timestamp, license, approval, or consent. Phase B independently re-evaluates
rights, chronology and retention at the frozen cell promotion timestamp, and it
remains the only authority for promotion.

Every projected approval fingerprint chains the deterministic intake ledger
checksum, the projected audience, the projected runtime-texture flag, the
approval's sorted `exclusions`, and its preserved `scope`. Relabelling a private
projection as public, stripping a `privacy-review-unresolved` or
`unmapped-restriction` sentinel, adding a token, and rewriting the preserved
provenance scope are therefore all tamper-evident: recomputation reads those
fields back from the carried approval, so an edit no longer matches the stored
fingerprint. Forging a matching fingerprint requires the private ledger
checksum and attestation fingerprint. Projected sources must also close exactly
over the intake binding set, so a foreign source injected into a projected
graph is detectable even when it is otherwise well formed.

This re-verification is a capability, not an enforced release gate, and its
reach is limited. It requires the private intake ledger checksum and the
projection bindings. **Neither is persisted in any shipped artifact today.**
An `ExteriorEvidenceShard` cannot carry the bindings without breaking its
`exactKeys` closure, and a dedicated bindings artifact would require widening
`ExteriorArtifactKind` and adding a release graph collection. Both are type
widenings of an accepted contract, so persisting a bindings sidecar is
deliberately deferred to a follow-up task. Until then, re-verification is
available only to a caller that still holds the in-memory admission and
projection.

## Consequences and deferrals

The only accepted module changed is `src/release/multi-lod-assembly.ts`, and
only to add the texture-free gate and its optional lineage flag. No source
registry row, no operator CLI, and no package script is added; a denylist row
in a source registry would add zero enforcement and is deliberately omitted.
Verification is deterministic tests over synthetic fixtures only.

## Residual risks, explicitly disclosed

- Ownership and permission attestation is operator-asserted. This repository
  cannot verify that an attester actually owns an artifact, that a claimed
  public-domain status is correct, or that a claimed permission exists. The
  contract records and binds an assertion; it does not establish a right.
- The privacy review is attestation-only. A missed face or plate is not
  detected. The texture-free gate is a structural backstop for imagery
  reaching public packages, not a detector. It closes declared textures,
  embedded images, unreferenced bufferViews and uncovered BIN tails; it does
  not inspect geometry, and it does not apply to private packages.
- Public-display exclusion does not withhold runtime-texture eligibility,
  because a private runtime texture is a legitimate use of evidence that may
  not be publicly displayed. The audience guard blocks the public+runtime
  combination, so this does not widen public exposure.
- Admitted at intake is not admissible at promotion. An admission is a
  point-in-time decision that consent withdrawal, license change, retention
  lapse, or approval-scope change invalidates.
- Phase A rules and their backstops. Phase B knows only about license
  allowed-use, retention and chronology. Every other Phase A rule needs its own
  backstop, and they are not equally covered:

  | Phase A rule | Survives serialization? | Backstop |
  | --- | --- | --- |
  | Source classification | No | None. A disallowed origin is excluded by Phase A alone. A graph authored by any path other than the intake projection is not recognized as prohibited by Phase B or by the audience guard. Only `verifyExteriorEvidenceProjectionIntegrity`, which needs the private bindings, detects an injected source. |
  | Approval exclusion tokens | Yes | Projected verbatim into `approvals[].exclusions` and enforced by `validateProjectedGraphAudience`. Tamper-evident, but only to a caller that can re-verify integrity. |
  | Unmappable free-text exclusions | Yes | Projected as the `unmapped-restriction` sentinel and enforced by the audience guard for public and runtime-texture use. Tamper-evident under integrity re-verification. |
  | Per-record privacy review | Yes | Projected as the `privacy-review-unresolved` sentinel and enforced by the audience guard for public and runtime-texture use; structurally backstopped for imagery by the texture-free gate. Tamper-evident under integrity re-verification. |
  | `derivativeScope` | No | None. It restricts runtime-texture eligibility at projection time only. A graph projected for a texture-bearing use and then reused elsewhere carries no scope marker; the caller must project for the use it intends. |
  | Audience and runtime-texture labelling | Yes | Bound into the projected approval fingerprint, so relabelling breaks integrity re-verification. |

  The audience guard must be called. Nothing in `validateExteriorReleaseGraph`
  invokes it today, so a consumer that skips it gets Phase B semantics only.
  Sentinel and scope tamper-evidence is real but only reaches a caller that can
  re-verify integrity, which today means one still holding the private
  admission and projection in memory. A consumer reading only a shipped shard
  can enforce the sentinels through the audience guard, but cannot yet detect
  that one was removed.
- Runtime provider-request and local-only enforcement remains deferred to T005.
  This decision does not authorize any provider request.
- Deterministic tests are not legal, licensing, privacy or regulatory adequacy
  proof, and are not visual, geographic, factual, accessibility or performance
  acceptance.
