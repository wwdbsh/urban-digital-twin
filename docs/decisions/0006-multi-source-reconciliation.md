# Decision 0006: source-preserving reconciliation

Date: 2026-08-03
Status: accepted for synthetic fixtures; real provider ingestion pending approval.

> **Current-state note (2026-08-04):** The reconciliation subsystem remains
> synthetic/provider-neutral, while the separate approved OTI and DOHMH
> adapters are connected to the bounded and citywide releases. Their source
> IDs, inspection observations, unknowns, and local-only rights are preserved;
> pending provider entries remain pending. See [Decision 0013](0013-manhattan-citywide-foundation-delivery.md).

## Decision

Use a versioned provider-neutral `SourceObservation` plus reversible `CanonicalEntity` merge groups. Keep one observation per provider record, with field-level provenance, freshness, confidence, uncertainty and license/source metadata. Use fixed explainable candidate scoring and conservative thresholds; quarantine contradictory high-confidence source IDs only inside a comparable identity namespace and never fabricate missing details.

The browser consumes the same result shape as the offline command. At the 2026-08-03 synthetic milestone, the synthetic catalog was the only connected catalog and was explicitly fixture-only. The separate OTI/DOHMH adapters now provide the approved bounded and citywide local releases without making this reconciliation subsystem a provider-specific merger. Existing Feature/Cesium/runtime contracts remain authoritative for geometry, picking and layer behavior; `runtimeFeatureId` links a reconciled entity to an existing feature without replacing its source refs.

## Rationale and consequences

This tolerates Overture, OSM, NYC and MTA coverage/semantic differences while retaining raw source claims. It makes freshness and licensing visible to visitors and gives operators measurable quality counts (canonical entities, observations, merges, unmerged/quarantined candidates, conflicts, stale observations and rejected records). The tradeoff is that fields may show Unknown or conflict states instead of a convenient but unsupported value.

## Identity and search rule

An ID contradiction is quarantined only when both observations share the same `registryEntryId` namespace (or a future explicitly shared authoritative namespace). Different providers and registries commonly issue unrelated IDs for the same place, so high-confidence cross-provider observations may merge when independent address, name, category, spatial, brand, phone or website evidence reaches the fixed threshold. Search indexes observation ID, source reference ID, registry entry ID, provider, dataset ID, source record ID, canonical ID and normalized visitor-facing fields; Unicode letters and numbers are preserved while accent marks are normalized predictably.

Official evidence and approval gates are recorded in [MANHATTAN_RECONCILIATION_STRATEGY.md](../research/MANHATTAN_RECONCILIATION_STRATEGY.md). No real data was contacted for this reconciliation research checkpoint; the later OTI/DOHMH acquisition is a separate approved adapter path.

## First post-approval task

Approve one dated snapshot and its terms, then run a local-only command after placing that snapshot in the worktree:

```sh
pnpm reconcile:ingest -- --input snapshots/approved/places.json --output artifacts/reconciliation/places-v1 --checksum <sha256> --source-registry-id <approved-entry-id> --ingested-at 2026-08-03T00:00:00Z
```

The command must refuse URLs, absolute/traversal paths, pending sources, checksum mismatch, malformed records and existing outputs before writing anything.
