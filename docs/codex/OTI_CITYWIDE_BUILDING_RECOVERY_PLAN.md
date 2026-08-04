# OTI citywide building acquisition recovery plan

Status: Sol Medium recovery handoff for Luna Max, 2026-08-04.

Decision: **a safe same-provider recovery exists**. Replace the hand-drawn
candidate envelope as a completeness boundary with two independent, unbounded
`returnIdsOnly` queries against the approved OTI Building Footprints layer:
`BASE_BBL LIKE '1%'` and `MAPPLUTO_BBL LIKE '1%'`, with no geometry filter.
Accept a capture only when both queries return the same sorted OBJECTID set
before and after geometry acquisition under an unchanged official layer schema
and `editingInfo.lastEditDate`. OBJECTID remains acquisition bookkeeping;
`DOITT_ID` remains the stable building parent identity.

The old envelope remains historical discovery evidence only. It returned
132,410 candidates but omitted 88 records that the two direct source-internal
Manhattan sets agree belong to the snapshot-relative Manhattan membership set.
Geometry is validated as source geometry, but coordinate containment is never
used to include or exclude a source identity.

The user's scope approval remains Orca message `msg_91770ac6d098`: immutable
local all-Manhattan snapshots, raw retention, derived local spatial/search/detail
artifacts, and local browser display for OTI `jh45-qr5r` and DOHMH `43nn-pn8j`
only. No new provider, Google-derived data, public deployment, unrelated dataset,
credential, paid service, package, commit, or push is approved or required.

This plan supersedes only the building-acquisition clauses listed in section 4.
All other requirements in `MANHATTAN_CITYWIDE_WAVE_PLAN.md` and
`DOHMH_CITYWIDE_ACQUISITION_RECOVERY_PLAN.md` remain binding, including the
accepted immutable DOHMH root, citywide release/runtime budgets, all seven
coverage anchors, truth and accessibility requirements, protected landmark and
Blender work, fail-closed behavior, and no external browser requests.

## 1. Requirements for CP2C recovery and CP3-CP7

### 1.1 Source-relative membership and identity

1. “All Manhattan buildings” means every OTI Building Footprints record in the
   accepted immutable capture whose two published BBL fields consistently encode
   Manhattan in this source snapshot. It does not mean every structure that
   exists in the real world, a legal borough polygon containment result, or the
   contents of a convenient map envelope.
2. Membership discovery must query the official approved FeatureServer layer
   without geometry parameters. The independent sets from
   `BASE_BBL LIKE '1%'` and `MAPPLUTO_BBL LIKE '1%'` must be byte-for-byte equal
   after numeric sorting and must remain equal before and after acquisition.
3. Every returned member must have a 10-digit `BASE_BBL` and 10-digit
   `MAPPLUTO_BBL`, both beginning with borough code `1`. A `LIKE '1%'` match is
   not sufficient if the returned value is malformed. BIN, when supplied, must
   be a seven-digit source value; dummy/million BINs remain source facts, not
   unique identities.
4. `OBJECTID` is the FeatureServer object-ID field and may be used only to obtain
   complete batches during one unchanged source-truth interval. It must not
   become a canonical building ID or be described as OTI's stable building key.
5. `DOITT_ID` is required, finite/integer-shaped, unique across accepted source
   records, preserved exactly, and used as the stable parent identity. BIN and
   both BBLs remain searchable source evidence; multipart render parts resolve
   to the same DOITT parent.
6. The discovery envelope `-74.03,40.68,-73.91,40.88` may be retained only as a
   labelled diagnostic comparison. It may not limit membership, geometry fetch,
   normalization, coverage, rendering, or the citywide claim.
7. Valid WGS84 geometry outside that discovery envelope must not be clipped,
   dropped, or reclassified. Geometry location does not override consistent
   source identity. Invalid geometry is quarantined and prevents zero-remainder
   citywide completion; it is never silently repaired.
8. Source-relative membership does not imply source infallibility. The release
   must state that OTI fields can have synchronization issues and that geometry,
   BBL, BIN, names, dates, heights, and status are source facts with the recorded
   uncertainty and capture time.

### 1.2 Acquisition truth, immutability, and accounting

1. Record the official layer metadata and response headers before and after the
   ID-set and geometry sequence. The selected schema fingerprint,
   `objectIdField`, layer spatial reference, capabilities, `maxRecordCount`, and
   `editingInfo.lastEditDate` must not change.
2. Run the two no-envelope ID queries before acquisition and repeat both after
   acquisition. Pre-BASE = pre-MAPPLUTO = post-BASE = post-MAPPLUTO, including
   exact count, sorted IDs, and SHA-256 over `id + LF`.
3. Query geometry only by sorted accepted OBJECTIDs, in bounded POST batches.
   Every requested ID must be returned exactly once, no unrequested ID may
   appear, and every returned attribute must still satisfy the accepted BBL,
   BIN, DOITT, schema, and identity contract.
4. The raw output is a new immutable GeoJSON byte sequence with exact byte size,
   SHA-256, fields, CRS, request/batch/retry evidence, source metadata, capture
   times, approval, terms, attribution, membership proof, geometry metrics, and
   zero-remainder accounting. It must never overwrite or incorporate the
   quarantined partial.
5. The accepted DOHMH A/B responses, manifest, replay, and evidence under
   `data/raw/manhattan-citywide-20260804/` are immutable. Building staging and
   rollback must touch only a newly created building-specific path.
6. Partial or failed building attempts are never resumed, appended, concatenated,
   or promoted. Move the complete invocation-owned staging directory to a unique
   sibling under `data/raw/citywide-recovery-quarantine/` with its failure reason.
7. Downstream normalization reads only the promoted local manifest-pinned raw
   path and checksum. It makes no provider request and does not use the old
   envelope for clipping.
8. Building accounting must prove:

   ```text
   accepted membership IDs = requested geometry IDs = returned raw OBJECTIDs
   raw source records = normalized parents + explicit rejected/quarantined records
   accepted DOITT parents = unique DOITT_ID count
   normalized render parts = sum of valid deterministic polygon parts
   unexplained remainder = 0
   ```

### 1.3 Geometry, height, provenance, and release truth

1. Accept only a GeoJSON `FeatureCollection` of Polygon/MultiPolygon features in
   explicitly requested EPSG:4326. Coordinates must be finite, in global WGS84
   ranges, rings valid/closed, geometry non-empty, and the aggregate per-query
   extent must contain every returned vertex. Do not introduce a Manhattan
   containment test.
2. Record full raw and accepted bounds, diagnostic-envelope outside feature/
   vertex counts, geometry-type counts, invalid/null counts, coordinate extrema,
   and outlier IDs. An outside-envelope count is expected to be nonzero and is
   evidence, not a rejection reason.
3. Preserve `HEIGHT_ROOF` as feet-equivalent source values normalized by
   `0.3048`; zero/null stays unavailable. Preserve `GROUND_ELEVATION` raw with
   unknown numeric unit and no fabricated meter value. Preserve geometry source,
   feature code, construction year, status, edit date, name limitations, CRS,
   vertical-datum uncertainty, and capture/update timestamps.
4. Generalize the current pilot ingest through an explicit citywide scope mode.
   Pilot defaults and clipping tests remain unchanged; citywide mode must not
   call the pilot `manhattanAdapter` rectangle or any envelope clipping helper.
5. CP3 through CP7 retain the original compact L14 partitioning, sharded search
   and detail, camera-driven loading, stable DOITT picking/deep links, procedural
   massing, verified landmark selection, fail-closed local runtime, performance,
   accessibility, and deterministic release requirements.

### 1.4 Fixed budgets

These gates are not permission to increase an original limit. The existing
quarantined partial provides an early estimate, but actual bytes are authoritative.

| Item | Gate |
| --- | --- |
| Direct Manhattan membership | expected current `45,194`; hard stop at changed current count pending report; absolute original stop remains `>200,000` |
| Normal geometry requests | exactly `ceil(45,194 / 250) = 181` batches at the observed source truth |
| Retry budget | at most 12 additional geometry POSTs total; at most 3 attempts for one batch; no retry for semantic/validation failure |
| Truth/membership requests | 2 metadata + 4 no-envelope ID-set requests; optional extent/count probes must keep the whole CP2C run <=205 official requests including retries |
| Per request | batch <=250; connect/header and total timeout 30 s unless a recorded official response requires the still-approved <=300 s ceiling |
| Raw building GeoJSON | <=300 MiB and <=200,000 features; preflight free disk >=1 GiB |
| Projection checkpoint | after the first 5,000 promoted-order features, projected raw size <=240 MiB; otherwise stop before spending the remaining request budget |
| Runtime root/shards/total | unchanged: root <=256 KiB; geometry <=2 MiB and 2,000 features; search/detail <=1 MiB; total <=300 MiB; <=512 shards |
| Browser/network/cache/render | unchanged: first camera <=12 MiB/16 release requests; <=4 concurrent; cache <=24 shards/48 MiB; <=6,000 settled dense features |
| Search/pick/frame/heap/bundle | every original section 1.4 budget remains exact and mandatory |

The CP2C partial is `1,612,450` bytes for 1,720 unique serialized features,
`937.47` bytes/feature, projecting about `42,368,062` bytes at 45,194 features.
The entire quarantined directory is `26,365,860` bytes because membership
evidence dominates it. The stop report's phrase “26 MiB partial geometry stream”
must not be reused as a raw-file measurement; the file and directory sizes are
separate facts. Neither projection is an acceptance substitute.

## 2. Current state and authoritative evidence

### 2.1 Last passing work and protected inputs

- CP1 remains the passing release-contract baseline. CP2A/CP2B subsequently
  implemented and accepted the DOHMH dual full-response multiset capture.
- Accepted DOHMH A and B each contain 109,386 rows / 12,439 CAMIS and
  114,488,021 bytes, SHA-256
  `cb4cb6fce7a3744672882e63f2d3542674d7f76334d1a8aa2a7bfa76bd48b627`.
  Their multiset digest is
  `f73458bbc5cec1d6709f9d85787950efcf422e4b0290a0ea4dbfc71cc6ac66f0`.
  Those bytes and manifest are immutable; CP2C recovery does not reopen CP2B.
- The first CP2C attempt was correctly quarantined at
  `data/raw/citywide-recovery-quarantine/manhattan-citywide-20260804-cp2c-geometry-outside-20260804/`.
  No building final manifest/snapshot was promoted, and nothing from that root
  may be used as production input.
- `scripts/acquire-manhattan-citywide-buildings.mjs` is the relevant current
  seam. It already uses exclusive files, sorted IDs, bounded POST geometry,
  exact returned-ID checks, SHA-256, and a final manifest. It currently forces
  the envelope into all three ID queries, classifies all 132,410 candidates,
  and rejects any coordinate outside the envelope; those are the blocker.
- `src/ingestion/nyc-building-footprints.ts` preserves checksum, terms, source
  provenance, DOITT identity, Polygon/MultiPolygon handling, multipart IDs,
  height-unit truth, and accounting. It currently clips all features to the
  pilot city adapter; citywide normalization must parameterize that behavior.
- `src/data/source-registry.ts` already records approval
  `msg_91770ac6d098`, source `jh45-qr5r`, NYC terms/attribution, local-only
  scope, and public-deployment/new-provider exclusions. No approval edit is
  required for this recovery.
- Planning validation on the authoritative dirty tree passed 25 test files /
  123 tests, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and
  `git diff --check`. The build remains 4,523.63 kB minified / 1,218.48 kB gzip
  for the main JavaScript asset and emits the already-known >500 kB warning.
  This is baseline evidence, not permission to increase the original bundle
  regression budget.
- `git status --short` contains extensive prior authorized modified/untracked
  plans, research, acquisition, source-registry, runtime, application, public,
  landmark, and artifact work. Luna must record that exact baseline and may
  attribute only its scoped checkpoint hunks/new invocation paths to itself.

### 2.2 Proven failed envelope assumption

The stopped CP2C attempt recorded, under layer edit timestamp
`1785637047174` (`2026-08-02T02:17:27.174Z`):

| Evidence | Exact value |
| --- | --- |
| Envelope candidate query | `1=1`, geometry `-74.03,40.68,-73.91,40.88`, intersects, EPSG:4326 |
| Candidate IDs | 132,410; SHA-256 `632f3e560cd262c4d5ec88efeab04f853c77058264d887533438f683e02cf7a9` |
| Envelope-scoped BASE/MAP sets | both 45,106; SHA-256 `668afa44b52881518a387297f0e54a81d6b27060064681e63bb434c93f6fabff` |
| Envelope candidate remainder | 87,304 non-members; zero unresolved inside the envelope |
| Trigger | OBJECTID 48190 / DOITT_ID 1040355 reached east `-73.9099003119409`, beyond envelope east `-73.91` |
| Quarantined partial | 1,612,450 bytes; 1,720 unique features; incomplete, never promoted |

The feature intersected the envelope but extended beyond it. This proves that
“all vertices inside” was incompatible even with `esriSpatialRelIntersects`; it
does not prove the source identity was non-Manhattan.

### 2.3 New official read-only evidence

Bounded probes were run against the same official OTI layer on 2026-08-04 UTC;
no production geometry snapshot was retained.

1. Layer metadata before/after every direct-set probe remained:
   `objectIdField=OBJECTID`, `globalIdField=""`, `maxRecordCount=2000`,
   `hasStaticData=true`, capabilities `Query,Extract`, pagination/order support
   true, and `editingInfo.lastEditDate=1785637047174`. `hasStaticData` is an
   ArcGIS layer flag, not a claim that the weekly public layer cannot change.
2. Two independent no-envelope BASE queries and two independent no-envelope
   MAPPLUTO queries each returned exactly 45,194 sorted unique OBJECTIDs,
   minimum 20, maximum 1,092,150, SHA-256
   `8fb429da8b5387905bf54207af77638ed304e08df077b43f196c12f678e64f3c`.
   BASE-not-MAP and MAP-not-BASE were both zero in both sequences.
3. Count-only probes returned BASE 45,194, MAPPLUTO 45,194, conjunction 45,194,
   BASE-only 0, and MAPPLUTO-only 0.
4. Repeating the candidate-envelope ID query under the same edit timestamp
   returned the same 132,410 count and candidate hash as the stopped attempt.
   Therefore the difference is not explained by source drift.
5. Direct source set minus envelope candidate set contains exactly 88 IDs,
   SHA-256 `567958ebc811f10caa3a90eaf18acdcb5796a74ffcc8f959b72774b31cd0f967`.
   Candidate minus direct source set remains 87,304,
   SHA-256 `278d582ff2a85d78e71d09a61d186a15ed78e1fb6ed1af1b5b2d19394455fb2d`.
6. A bounded attribute/geometry probe of the 88 omitted IDs found 88 valid
   code-1 BASE BBLs, 88 valid code-1 MAPPLUTO BBLs, valid BIN/DOITT shapes,
   zero duplicate DOITT groups within the delta, 88 non-null geometries, and
   2,148 vertices. Their combined WGS84 extent was west
   `-74.0472880301562`, south `40.6888136985346`, east
   `-73.9066377790676`, north `40.8786959203305`.

This evidence establishes a source-internal set contract, not a legal boundary
or independent real-world accuracy proof.

### 2.4 Official primary references

- [NYC OTI Building Footprints metadata](https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_BuildingFootprints.md)
  identifies DOITT_ID as the consistent unique building identifier, OBJECTID as
  a synthetic software key, BIN's first digit as borough code, BASE_BBL and
  MAPPLUTO_BBL as Borough-Block-Lot fields, weekly publication/daily staff edits,
  temporary lot synchronization caveats, and geometry/height uncertainty.
- [Official OTI FeatureServer layer metadata](https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/BUILDING_view/FeatureServer/0?f=pjson)
  supplies the current object-ID field, schema, spatial reference, extent,
  capabilities, transfer limit, and editing timestamp.
- [Official OTI FeatureServer query endpoint](https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/BUILDING_view/FeatureServer/0/query)
  is the only building data endpoint allowed by this recovery.
- [Esri query-feature-layer documentation](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/)
  documents `where`, `objectIds`, `outFields`, `outSR`, `returnIdsOnly`,
  `returnCountOnly`, and response behavior; it states that the number of object
  IDs returned by an IDs-only query is not limited by the layer's maximum record
  count. Luna must still validate array uniqueness/count/hash explicitly.
- [NYC Open Data overview/terms](https://opendata.cityofnewyork.us/overview/)
  remains the recorded terms/disclaimer source. Informational publication is not
  a warranty of completeness or accuracy and does not broaden local approval.

## 3. Ranked risks and mitigations

| Rank | Risk | Severity | Likelihood | Mitigation | Hard stop |
| --- | --- | --- | --- | --- | --- |
| 1 | Envelope is treated as authoritative Manhattan membership | Critical | Proven | Remove geometry from BASE/MAP ID queries; accepted set is equal direct source sets; envelope only reports historical delta | Any code still intersects/clips/rejects membership by candidate envelope |
| 2 | Source-internal fields disagree or are mistaken for real-world boundary truth | Critical | Low now, possible later | Independent BASE/MAP pre/post sets; validate both 10-digit code-1 attributes; label claim snapshot/source-relative | Any set/count/hash mismatch, malformed code, or wording claims legal/physical borough completeness |
| 3 | Source mutates across 181 geometry batches | Critical | Medium | Bracket with metadata plus both full ID sets; record per-request evidence and LAST_EDITED_DATE; quarantine on change | Metadata/schema/edit timestamp or any pre/post set changes |
| 4 | OBJECTID becomes product identity | High | Medium | Use it only for accepted-set/batch accounting; require unique DOITT_ID for parent/search/pick/URL | OBJECTID appears as canonical parent or stable OTI building identity |
| 5 | Valid source geometry lies outside Manhattan-looking bounds | High | Proven | Validate global WGS84/GeoJSON and source query extent, report outliers, never membership-filter coordinates | Code clips/drops/reclassifies outside-envelope geometry; invalid/null/non-finite geometry yields nonzero remainder |
| 6 | ArcGIS batching omits/adds/duplicates records | Critical | Medium | <=250 sorted IDs, exact batch set equality, global returned set equality, no transfer-limit response, deterministic local order | Missing, extra, duplicate ID; count mismatch; malformed/error/partial response |
| 7 | Mutable attributes differ from the accepted ID predicate | Critical | Low/Medium | Revalidate both BBLs, BIN, DOITT and fields on every returned feature; compare source edit timestamp | Any returned member fails its source predicate or identity contract |
| 8 | Large/complex geometry exceeds disk/raw/runtime budgets | High | Medium | 1 GiB disk preflight, 300 MiB byte cap, 5,000-feature 240 MiB projection gate, early stop, compact derived shards | Limit/projection exceeded, ENOSPC/OOM, >200k records, or release/shard budget failure |
| 9 | Retry/resume creates plausible corrupt raw bytes | Critical | Medium | Exclusive invocation staging, bounded retries of whole batches, never append a prior attempt, final manifest last | More than 12 retries, partial promotion, resume/concatenate, or reused quarantine bytes |
| 10 | DOITT/multipart identity collides or churns | High | Medium | Unique DOITT parent gate; deterministic polygon-part ordering independent of provider response; pilot replay | Missing/duplicate DOITT, order-dependent part IDs, pilot canonical-ID drift |
| 11 | Licensing/approval is broadened | Critical | Low/Medium | Cite exact message and existing terms/attribution; same source/dataset/local paths only | New source/boundary/provider, credential/cost, Google data, or public deployment needed |
| 12 | Dirty shared tree or protected assets are overwritten | Critical | High | Baseline status; one-checkpoint scoped patches; exclusive new paths; reverse Luna hunks only | Unexplained overlap, protected hash change, destructive rollback, or unrelated baseline failure |
| 13 | Citywide raw succeeds but runtime loads it monolithically | Critical | High without CP4/5 gates | Preserve compact partition contract, lazy local search/detail/geometry, camera cache and no provider browser requests | All-feature adapter/eager JSON, >512 shards, performance or network gate failure |

Mitigation does not mean accepting a lower-fidelity subset. Any hard stop keeps
citywide mode unavailable and reports the exact last passing checkpoint.

## 4. Same-provider decision and superseded-clause map

### 4.1 Mechanism decision

| Mechanism | Decision | Reason |
| --- | --- | --- |
| Direct no-envelope BASE_BBL and MAPPLUTO_BBL IDs-only sets | **Accept as authoritative source-internal membership proof** | Same approved layer and attributes; official IDs-only mechanism is not capped by `maxRecordCount`; two independent fields returned equal 45,194 sets twice under unchanged source truth. Equality and per-feature validation fail closed. |
| Combined no-envelope `BASE_BBL LIKE '1%' AND MAPPLUTO_BBL LIKE '1%'` | **Accept as count/diagnostic only** | Confirms current conjunction count but is not a substitute for independently obtaining and comparing both sets. |
| Candidate envelope | **Defer to historical diagnostics; reject as membership/boundary** | It omitted 88 direct members and rejects valid intersecting polygons that cross an edge. It may be compared and displayed only as discovery evidence. |
| Geometry centroid/vertex containment | **Reject for borough membership** | Coordinates are geometry truth with stated uncertainty, not the source identity predicate; containment would require a separately approved legal/borough boundary and would contradict observed source records. |
| BIN-only borough query | **Reject as primary membership** | Official metadata permits dummy/unassigned million BINs and duplicated BINs. Preserve/search BIN, but do not let it override agreeing BBL membership or DOITT identity. |
| New borough polygon, PLUTO download, geocoder, OSM/Google/other provider | **Reject for this wave** | Not approved or needed. Stop if direct source membership ceases to reconcile rather than adding one. |

The plan does not claim that an ArcGIS multi-request sequence is transactionally
atomic. It is acceptably bounded by unchanged official layer truth, equal pre/post
full membership sets, exact requested/returned geometry accounting, and immutable
raw replay. If those facts do not all hold, no snapshot is accepted.

### 4.2 Superseded clauses in `MANHATTAN_CITYWIDE_WAVE_PLAN.md`

Only the following building clauses are superseded:

1. Section 1.2 and section 3 risk 2 insofar as they require the 132,410 envelope
   to contain every Manhattan source member. Replacement: direct no-envelope
   equal BASE/MAPPLUTO membership sets; envelope is diagnostics only.
2. CP2 step 2's requirement to obtain candidate-envelope IDs before Manhattan
   identity sets. Replacement: direct source sets are obtained first and are the
   acquisition set; historical envelope evidence is reused, not refreshed as a
   dependency.
3. CP2 step 3's instruction to classify all candidates and quarantine geometry
   outside the candidate envelope. Replacement: validate every direct member's
   source fields and geometry; outside-envelope is measured, never rejected.
4. CP2 completion text and section 7 condition 2 requiring candidate set
   containment/source-not-candidate zero. Replacement: record the proven 88-ID
   delta and require pre/post direct-set equality plus requested/returned zero
   remainder.
5. Section 8.2's mandatory `--candidate-envelope` CLI argument. Replacement:
   the CP2C command in section 8 here, with explicit `--membership-mode
   direct-bbl-code-1` and no geometry filter.
6. Section 10 item 4's automatic stop solely because geometry lies outside the
   candidate envelope. Replacement: outside-envelope valid geometry is accepted
   as source geometry; stop only on invalid geometry, source-set conflict, source
   drift, or accounting failure.
7. Pre-exit text that can be read as requiring the candidate envelope to be a
   superset. Replacement: the exact envelope omission is documented and the
   source membership proof is envelope-independent.

### 4.3 Superseded clauses in `DOHMH_CITYWIDE_ACQUISITION_RECOVERY_PLAN.md`

1. Section 1.1 item 10's statement that every original envelope-based building
   gate is unchanged. Replacement: only the building clauses above change.
2. Recovery CP2C's instruction to resume the original building acquisition
   unchanged. Replacement: checkpoints CP2C-R1 through CP2C-R3 below.
3. Section 8.2 and section 11 references to candidate/source containment and
   “no envelope shortcut.” Replacement: no-envelope direct membership is not a
   shortcut; it is the stronger source-internal completeness proof.
4. Section 10 item 7 insofar as outside-envelope geometry alone is an unresolved
   membership record. Replacement: source-field conflict/invalid geometry remains
   a stop; valid out-of-envelope geometry does not.

All other clauses of both prior plans remain binding without relaxation.

## 5. Exact Luna allowed and do-not-touch areas

### 5.1 Allowed

- `scripts/acquire-manhattan-citywide-buildings.mjs` and a narrowly scoped new
  dependency-free helper/test for direct-set comparison, geometry validation,
  manifest construction, exclusive staging, retry limits, and quarantine.
- `scripts/validate-manhattan-citywide-raw.mjs` and its tests only to validate
  the new building manifest/set/hash/geometry/accounting contract while retaining
  the accepted DOHMH validator unchanged.
- `package.json` only if an existing exact citywide script name needs wiring; no
  dependency or lockfile change. `citywide:acquire:buildings` and
  `citywide:validate:raw` already exist and should remain the public commands.
- `src/ingestion/nyc-building-footprints.ts` and tests only to add an explicit
  citywide no-clip scope/membership mode, deterministic multipart ordering, and
  citywide accounting while preserving every pilot default/test.
- Original-plan allowed CP3-CP7 provider-neutral `src/release/**`,
  `src/runtime/**`, domain/search/navigation, App/Cesium/style, scripts/tests,
  and `package.json` areas after CP2C passes.
- Exclusive ignored building staging/final paths under
  `data/raw/manhattan-citywide-20260804/`, corresponding new ignored generated/
  public citywide roots, and new ignored recovery evidence under
  `artifacts/citywide-wave-20260804/recovery-*`.
- On failure, a new unique directory under
  `data/raw/citywide-recovery-quarantine/` containing only the current
  invocation-owned building staging files.

### 5.2 Do not touch

- `AGENTS.md`, this plan, both prior citywide plans, all other `docs/**`,
  decisions, research, runbooks, `.gitignore`, lockfile, dependencies, CI,
  deployment, credentials, Vite/Cesium versions, or environment configuration.
- Accepted DOHMH files under `data/raw/manhattan-citywide-20260804/`, especially
  both 114,488,021-byte snapshots, acquisition manifest/hash, metadata/count/
  header evidence, multiset files, and replay directory.
- Any prior quarantine including the failed CP2C root; existing pilot raw,
  generated, public, and evidence roots; or any prior manifest/hash.
- `artifacts/blender/**`, Blender files, `public/assets/landmarks/**`, protected
  landmark hashes, `src/runtime/landmark-assets.*`, or asset semantics.
- Source registry approval/terms fields: they already contain the exact approved
  scope. Do not broaden or rewrite them during recovery.
- Any new boundary data, PLUTO data, Google/OSM/Overture/MTA/other source,
  imagery, ratings/reviews/hours, routing/transit/facades, hosted service, public
  deployment, or browser provider request.
- Raw/generated/public production payloads in Git. No reset, clean, checkout,
  force operation, blanket formatter, commit, push, destructive rollback, or
  whole-file restoration that can erase prior dirty work.

## 6. Ordered checkpoints with rollback points

### CP2C-R1 — implement the direct-set proof with fixtures only

1. Re-read AGENTS, this plan, both prior plans, CP2A/CP2B evidence, the CP2C stop,
   current status/diff, current acquisition script, validator, ingest, registry,
   and protected hashes. Record a new baseline without modifying prior evidence.
2. Refactor query construction so membership queries cannot accept geometry,
   envelope, spatial relation, offset, result pagination, or a nonofficial host.
   Keep the exact official endpoint and fields pinned.
3. Add pure validators for metadata fingerprint, IDs-only response,
   sorted-unique integer IDs, LF hash, BASE/MAP equality, pre/post equality,
   BBL/BIN/DOITT attributes, geometry type/rings/WGS84, batch/global accounting,
   size projection, and redacted difference reports.
4. Replace `coordinateOutside(...candidateEnvelope)` with geometry validity and
   aggregate provider-query-extent consistency. Keep a separate diagnostic
   counter for the historical envelope; it cannot reject a feature.
5. Stage beneath a new exclusive building-only invocation directory. Final
   `buildings/` is created by atomic same-filesystem rename only after validation;
   an existing final/staging path fails before any request.
6. Fixture tests must cover: equal 45,194-like sets at small scale; envelope
   omission; crossing polygon; geometry wholly outside diagnostic envelope;
   BASE/MAP difference; pre/post difference; duplicate/malformed ID; transfer
   limit/error response; malformed code-1 value; missing/duplicate DOITT; invalid
   BIN; null/invalid/nonfinite/unclosed Polygon/MultiPolygon; missing/extra batch
   feature; schema/edit drift; size cap/projection; retry exhaustion; exclusive
   output; quarantine; deterministic order/hash; and no envelope filtering.
7. Run focused tests, full tests, typecheck, lint, syntax check, and diff check.
   No provider geometry acquisition occurs in R1.

Completion: fixtures prove the stronger contract; exact current commands remain
available; only allowlisted hunks exist; accepted DOHMH/protected hashes match.

Rollback: save an R1 scoped patch and reverse only Luna-owned hunks with
`apply_patch`; move only R1 fixture evidence aside. Do not restore whole dirty
files or touch CP1/CP2A/CP2B.

### CP2C-R2 — bounded live membership and geometry staging

1. Preflight free disk >=1 GiB, absent final building root, exact approval and
   endpoint, Node/script hash, and source metadata. Create exclusive mode-0700
   invocation staging without modifying any DOHMH file.
2. Query BASE and MAPPLUTO IDs separately with no geometry. Require exact current
   observed count 45,194 and hash
   `8fb429da8b5387905bf54207af77638ed304e08df077b43f196c12f678e64f3c`
   for each. A changed count/hash is source drift/new evidence: stop and report,
   do not edit expected constants during the run.
3. Save exact encoded query, response headers/request IDs, raw IDs response
   bytes/hash, sorted set/hash, and equality evidence. Query a source-set extent
   as diagnostics only; never turn it into membership.
4. Acquire the 45,194 sorted OBJECTIDs in exactly 181 normal POST batches of at
   most 250 with pinned 13 fields, geometry true, EPSG:4326, GeoJSON. Validate
   each batch before writing deterministic feature order.
5. Allow only transient/network/429/5xx retries: 2 s then 8 s, at most 3 attempts
   per batch and 12 extra POSTs total. Honor at most one bounded Retry-After.
   HTTP 200 semantic/schema/identity/geometry failures are not retryable.
6. Stream to an exclusive `.partial` while incrementally hashing/counting bytes.
   Abort at 300 MiB. At 5,000 features, extrapolate from actual serialized bytes;
   stop if >240 MiB projected. The final byte cap remains authoritative.
7. Repeat metadata, BASE IDs, and MAPPLUTO IDs after the final batch. Require the
   complete equality chain and unchanged selected metadata/edit timestamp.
8. On any failure, close handles, record redacted reason/bytes/requests/last
   complete batch, and move the entire invocation staging to a unique quarantine
   sibling. Do not alter the accepted DOHMH root or prior quarantine.

Completion: one complete staged GeoJSON has 45,194 exactly accounted features,
all direct membership/truth/geometry/size/request gates pass, and no final path
yet exists.

Rollback: move only this invocation's building staging directory intact to a new
quarantine sibling. Never delete, append, resume, or rename the accepted DOHMH
root.

### CP2C-R3 — immutable promotion and offline replay

1. Reparse staged raw bytes offline. Require complete FeatureCollection syntax,
   exact unique OBJECTID set/hash, unique required DOITT parents, valid source
   fields/geometry, deterministic feature order, and zero remainder.
2. Emit evidence: pre/post metadata; four ID responses; direct set and hash;
   historical envelope counts/hashes and 88-ID delta; fields/query/CRS; 181 plus
   retry requests; times/status/request IDs; raw bytes/SHA; parent/geometry type/
   vertex/bounds/outside-diagnostic counts; invalid/rejected reasons; terms,
   attribution, approval/exclusions; and every invariant result.
3. Write manifest last with exclusive semantics, hash it externally, then
   atomically rename the invocation directory to the absent final `buildings/`.
   No provider request occurs after promotion.
4. Run raw validation twice against local bytes and require identical output.
   Reorder a fixture-only response to prove provider response order does not
   alter the accepted sorted raw/replay identity evidence.
5. Capture status, diff, DOHMH hashes, protected hashes, and exact validation
   output before CP3.

Completion: immutable final building raw/manifest exists beside but does not
modify accepted DOHMH; all local replay/accounting is deterministic; CP2 is fully
passing for both approved sources.

Rollback: if promotion validation fails, move only the new `buildings/` directory
to a unique quarantine sibling and leave citywide mode unavailable. Never edit
the promoted bytes in place or touch DOHMH.

### CP3 — citywide normalization and complete accounting

1. Add explicit building citywide mode that validates the R3 manifest and raw
   checksum, does no provider call, does not clip, preserves all Polygon/
   MultiPolygon rings, and orders multipart render parts deterministically.
2. Require 45,194 raw records = accepted DOITT parents + explicit rejected/
   quarantined records, accepted membership ID set exact, unique DOITT parents,
   zero unexplained remainder, and stable pilot replay IDs/heights/semantics.
3. Resume accepted DOHMH normalization exactly from the recovery plan: preserve
   all 109,386 occurrences, 12,439 CAMIS parents, duplicate multiplicities,
   derived occurrence identity, unlocated parents, and zero remainder.
4. Emit source-specific counts/hashes, latitude bands/anchor coverage, bounds,
   located/unlocated, parent/part counts, identity collisions, reason histograms,
   freshness, and uncertainty. Empty source-backed anchor evidence stops.

Rollback: move only new normalized citywide roots to checkpoint quarantine and
reverse only CP3 Luna hunks. Raw, pilot, and accepted DOHMH remain immutable.

### CP4 — compact deterministic release

Resume original CP4 without architectural changes: build into a new exclusive
staging root; emit L14 WGS84 geometry with deterministic dense splitting, compact
ID/prefix search and detail shards, safe local refs, complete sizes/SHA/counts/
source/coverage/freshness, and no raw history in marker/search payloads. Build
twice into different roots and require byte-identical file lists/content before
atomic local publish. All original root/shard/total/count budgets remain.

Rollback: move only new staging/generated/public citywide roots to quarantine;
keep citywide unavailable and pilot/Fixture active.

### CP5 — local runtime streaming, search, details, and failures

Resume original CP5: root-manifest-first local loading, viewport-intersecting
geometry shards plus bounded prefetch, <=4 concurrency, bounded LRU, incremental
per-tile Cesium primitives, sharded search/details, stable DOITT/CAMIS parent
pick/URL IDs, truthful source/uncertainty copy, history/reload, and narrow scoped
failure without fixture/same-name substitution. No all-feature adapter or browser
provider request is allowed.

Rollback: reverse only CP5 citywide mode/runtime hunks and retain the validated
release for diagnosis; Fixture and bounded pilot remain.

### CP6 — browser and performance evidence

Run the original seven-anchor two-tour desktop/mobile matrix, fixed search/pick
corpus, corruption matrix, history/reload, keyboard/focus/reduced-motion, network,
console, frame/cache/heap/search/pick budgets, and no external requests. Include
at least one of the 88 historical envelope omissions as a deterministic building
search/detail/pick target; search = pick = detail = URL must equal its DOITT
parent, and the UI must not describe its coordinate as a boundary error.

Rollback: reverse only the last measured performance hunk to the last passing
scoped patch. Never raise budgets, shrink Manhattan, or discard outliers.

### CP7 — final evidence and Sol High review

Run all commands and journeys in section 8, raw/normalized/release invariants,
protected hashes, scoped diff, generated-data Git exclusion, and fixed evidence.
Root Sol High reviews only the direct membership/source-drift proof, immutable
DOHMH/building evidence, citywide accounting, performance, protected hashes, and
final scoped diff. Luna owns fixes and repeats the deterministic loop until pass
or a stop condition.

Rollback: keep citywide non-default/unavailable and report the last passing
checkpoint and retained immutable evidence. No commit or push.

## 7. Observable completion conditions

All are mandatory:

1. Pre/post official layer metadata fingerprints and edit timestamps match.
   Pre-BASE, pre-MAPPLUTO, post-BASE, and post-MAPPLUTO sets are identical,
   current count 45,194 and SHA-256
   `8fb429da8b5387905bf54207af77638ed304e08df077b43f196c12f678e64f3c`.
2. Membership queries contain no geometry/envelope/spatial relation/pagination.
   Their IDs are unique integers and responses declare the expected OBJECTID
   field with no transfer-limit/error condition.
3. Historical evidence records candidate 132,410, envelope member 45,106,
   direct member 45,194, source-not-candidate 88, and the exact hashes above.
   No manifest calls the envelope a boundary/superset or requires zero delta.
4. Raw GeoJSON contains exactly 45,194 features and the exact accepted OBJECTID
   set, each once; no missing/extra/duplicate; every BBL/BIN/DOITT/schema and
   geometry invariant passes; unique DOITT parent count is 45,194 unless an
   exact observed duplicate stops the checkpoint.
5. Outside-envelope count is nonzero and reported. OBJECTID 48190 and at least
   one of the 88 omitted IDs survive raw validation and normalization without
   clipping. Coordinate containment never determines membership.
6. Raw bytes <=300 MiB, feature count <=200,000, request total <=205, retry
   total <=12, disk/projection/time gates pass, and raw/manifest checksums replay
   identically offline. Failed partials are uniquely quarantined.
7. Accepted DOHMH A/B bytes, hashes, manifest, multiset, counts, and replay are
   unchanged. No provider request is made after either raw promotion.
8. Normalized building raw = accepted parents + explicit rejects; requested =
   returned = normalized source membership; multipart parts have deterministic
   parent mapping; parent collision and unexplained remainder are zero; pilot
   identities/heights/geometry semantics replay unchanged.
9. All seven anchors have source-backed coverage/accounting; release builds are
   byte-identical; every safe ref/file/byte/SHA/count invariant passes; root,
   shard, total, and partition budgets remain exact.
10. Camera streaming never loads all Manhattan geometry. Search can resolve
    exact DOITT/BIN/BBL and fixed names citywide without geometry; search/pick/
    detail/URL parent IDs agree, including an envelope-omitted record.
11. Invalid root/tile/search/detail/release/feature fails closed without fixture
    or same-name substitution. No external runtime request occurs.
12. Desktop/mobile, keyboard/focus/screen-reader/reduced-motion, Back/Forward/
    reload, source/uncertainty copy, console/WebGL, cache/request/heap/frame/
    search/pick, bundle, and repeat-tour gates pass unchanged.
13. Full tests, typecheck, lint, build, raw/coverage/release validators,
    deterministic build diff, benchmark, diff check, protected hashes, and
    scoped Git review pass. No generated data, docs/AGENTS, lockfile, protected,
    pilot, DOHMH, Blender, or unrelated Luna change enters the diff.

## 8. Exact tests, commands, and Orca browser journeys

### 8.1 Baseline and focused implementation validation

```sh
pwd
orca status --json
orca worktree current --json
git status --short
git diff --stat
git diff --check
shasum -a 256 \
  data/raw/manhattan-citywide-20260804/dohmh-manhattan.snapshot.json \
  data/raw/manhattan-citywide-20260804/replay/dohmh-manhattan.snapshot-b.json \
  data/raw/manhattan-citywide-20260804/dohmh-citywide-acquisition.manifest.json
shasum -a 256 public/assets/landmarks/landmark-wave-20260804/*

node --experimental-strip-types --check \
  scripts/acquire-manhattan-citywide-buildings.mjs
pnpm test -- --run \
  src/ingestion/nyc-building-footprints.test.ts \
  src/release/citywide-release.test.ts
pnpm typecheck
pnpm test -- --run
pnpm lint
pnpm build
git diff --check
```

If Luna creates a dedicated acquisition test, add its exact path to the focused
test command; do not remove the two named regression tests.

### 8.2 CP2C acquisition and raw validation

The implementation must expose this command exactly; remove the old mandatory
`--candidate-envelope` parser and do not replace it with a wider guessed box:

```sh
pnpm citywide:acquire:buildings -- \
  --release manhattan-citywide-20260804 \
  --output-root data/raw/manhattan-citywide-20260804 \
  --membership-mode direct-bbl-code-1 \
  --batch-size 250 \
  --timeout-ms 30000 \
  --max-bytes 314572800 \
  --max-geometry-retries 12 \
  --max-total-requests 205

pnpm citywide:validate:raw -- \
  --root data/raw/manhattan-citywide-20260804
```

Before the live command Luna must run a fixture-only dry run that proves the
request URLs contain no `geometry`, `geometryType`, `spatialRel`, `resultOffset`,
or envelope value. After promotion, print and save:

```sh
find data/raw/manhattan-citywide-20260804/buildings -type f -print0 | \
  sort -z | xargs -0 wc -c
find data/raw/manhattan-citywide-20260804/buildings -type f -print0 | \
  sort -z | xargs -0 shasum -a 256
du -sh data/raw/manhattan-citywide-20260804/buildings
```

Never print full real feature rows into committed logs. ID/count/hash/extents are
the review evidence.

### 8.3 Normalize, build, validate, and deterministic replay

Resume the exact prior public command contract:

```sh
pnpm citywide:normalize -- \
  --release manhattan-citywide-20260804 \
  --raw-root data/raw/manhattan-citywide-20260804 \
  --output-root data/generated/manhattan-citywide-20260804

pnpm citywide:validate:coverage -- \
  --raw-root data/raw/manhattan-citywide-20260804 \
  --normalized-root data/generated/manhattan-citywide-20260804

pnpm citywide:build -- \
  --release manhattan-citywide-20260804 \
  --normalized-root data/generated/manhattan-citywide-20260804 \
  --output-root data/generated/catalog/manhattan-citywide-20260804-replay-a

pnpm citywide:build -- \
  --release manhattan-citywide-20260804 \
  --normalized-root data/generated/manhattan-citywide-20260804 \
  --output-root data/generated/catalog/manhattan-citywide-20260804-replay-b

diff -qr data/generated/catalog/manhattan-citywide-20260804-replay-a \
  data/generated/catalog/manhattan-citywide-20260804-replay-b

pnpm citywide:validate -- \
  --release-root data/generated/catalog/manhattan-citywide-20260804-replay-a \
  --raw-root data/raw/manhattan-citywide-20260804 \
  --normalized-root data/generated/manhattan-citywide-20260804

pnpm citywide:publish-local -- \
  --validated-root data/generated/catalog/manhattan-citywide-20260804-replay-a \
  --output-root public/data/manhattan-citywide-20260804

pnpm citywide:benchmark -- \
  --release-root public/data/manhattan-citywide-20260804 \
  --queries scripts/fixtures/manhattan-citywide-search-queries.json

pnpm typecheck
pnpm test -- --run
pnpm lint
pnpm build
git diff --check
git status --short
git diff --stat -- package.json scripts src
```

Also assert generated production data is ignored and protected assets retain all
manifest hashes. Do not use a blanket `|| true` around any validator.

### 8.4 Exact Orca browser journey

1. Start Vite in a visible Orca terminal and use the exact printed URL:

   ```sh
   orca terminal create --worktree active --title citywide-wave-dev \
     --command "pnpm dev -- --host 127.0.0.1" --json
   orca terminal read --terminal <server-handle> --json
   orca tab create --url <printed-vite-url> --json
   orca wait --load networkidle --json
   orca capture start --json
   orca snapshot --json
   orca console --limit 200 --json
   orca network --limit 500 --json
   ```

2. Regress Fixture and Real open-data pilot: search/select known CAMIS and
   DOITT, pick the same primitives, toggle layers/modes, reload, Back/Forward,
   and confirm bounded-pilot copy and protected landmarks.
3. Enter Manhattan citywide mode. Before moving camera, network must show only
   root manifest, needed fixed-camera local shards, and approved local landmark
   assets—never whole-city raw JSON or a provider hostname.
4. Run two identical tours, waiting 3 seconds then measuring 10 seconds at each:

   | Anchor | Longitude | Latitude | Height |
   | --- | ---: | ---: | ---: |
   | Financial/Battery | -74.012 | 40.706 | 1,200 m |
   | Chelsea/Midtown | -73.992 | 40.748 | 1,200 m |
   | Upper West | -73.975 | 40.787 | 1,200 m |
   | Upper East | -73.956 | 40.773 | 1,200 m |
   | Harlem | -73.944 | 40.817 | 1,200 m |
   | Inwood/Marble Hill | -73.922 | 40.871 | 1,200 m |
   | Roosevelt Island | -73.949 | 40.762 | 1,200 m |

   Save request count/bytes, concurrency, declared cache bytes/shards, rendered
   features, frame intervals, and `performance.memory` where supported. Run the
   exact original thresholds; the second tour must settle without growth.
5. At every anchor use generated ignored evidence to search/select one building
   and one located CAMIS. Assert search ID = pick parent ID = details ID = URL
   ID. Run 30 fixed searches and picks for cold/warm p95.
6. Add a recovery-specific target from the 88 direct-set/envelope-missing IDs.
   Search by DOITT and BBL, fly through source coordinates, pick it, reload and
   Back/Forward. It must remain one stable DOITT parent and truthful source
   geometry; no “outside Manhattan” or clipped-boundary claim appears.
7. Test one exact-duplicate DOHMH group and one unlocated CAMIS exactly as the
   DOHMH recovery plan requires.
8. In copied temporary release roots, corrupt one byte of root/tile/search/detail
   separately and request unknown release/parent. Every case fails at the narrow
   scope with no substitute. Never edit immutable accepted roots in place.
9. Repeat at 1440x900 and 390x844, keyboard Tab/Arrows/Enter/Escape, focus return,
   screen-reader status text, 200% zoom, and reduced motion.
10. Finish with:

   ```sh
   orca snapshot --json
   orca screenshot --json
   orca console --limit 500 --json
   orca network --limit 1000 --json
   ```

   Console/WebGL must have no wave-attributable error/warning and every runtime
   network hostname must be the app origin.

## 9. Report instead of guessing

Stop the affected checkpoint and report exact redacted evidence when:

1. Approval `msg_91770ac6d098`, OTI dataset/layer identity, terms/attribution,
   raw retention, derived local display, or local-only restriction is unclear.
2. The official endpoint/schema/object-ID field/spatial reference/capabilities/
   edit timestamp differs from the pinned preflight, or changes during capture.
3. Any of the four direct ID sets differs; current count is not 45,194; current
   set hash is not the observed hash; an IDs response duplicates/truncates/errors;
   or BASE/MAP source semantics cease to reconcile.
4. A member has malformed/conflicting BBL, invalid BIN, missing/duplicate DOITT,
   unexpected attributes, invalid/null/nonfinite geometry, query-extent
   inconsistency, or accounting remainder. Do not repair with coordinates.
5. A geometry is valid but surprising: record it and continue only if all
   source-identity and geometry-validity gates pass. If product truth would need
   a boundary/geocoder/manual exclusion to interpret it, stop CP3 and report;
   do not add one.
6. Any batch misses/adds/duplicates IDs, returns a partial/error body, requires
   pagination, exceeds timeout/retry/request/byte/disk/feature/projection limits,
   or would require resume/append/concatenation.
7. Raw replay/hash/manifest differs, final output exists, immutable DOHMH bytes
   changed, or any failed partial would need promotion/reuse.
8. Citywide normalization cannot avoid pilot clipping, loses a valid direct
   member, changes pilot identity/height truth, yields duplicate parent/part IDs,
   or has any unexplained remainder.
9. Release/runtime would require eager all-record JSON, monolithic Blender/
   Cesium scene, new package/storage/renderer/worker/CDN, new provider, Google
   data, public deployment, smaller geography, or relaxed budget.
10. Any root/shard/total/request/cache/render/search/pick/frame/heap/bundle,
    coverage, accessibility, history, corruption, console/WebGL, or no-external-
    request gate fails after bounded in-plan fixes.
11. Protected pilot/landmark/Blender/DOHMH hash changes, required hunk overlaps
    unexplained dirty work, rollback risks prior work, or unrelated baseline
    failure prevents attribution.

The report must state last passing checkpoint, expected/actual count/hash/time/
request evidence, affected paths, quarantine state, and the smallest decision.
If direct same-source membership ceases to be safe, the smallest human decision
would be separate approval for an authoritative borough boundary/membership
source or a changed citywide truth definition. Do not recommend that while this
safe same-provider mechanism passes.

## 10. Luna pre-exit checklist

### Goal, scope, and boundaries

- [ ] Goal remains all-Manhattan OTI buildings plus accepted DOHMH restaurants,
  snapshot-relative and only within `msg_91770ac6d098`.
- [ ] Direct no-envelope BASE/MAP sets—not the candidate envelope or coordinates—
  define OTI source membership; DOITT remains parent identity.
- [ ] Only section 5 allowed files/roots changed; no do-not-touch path changed.
- [ ] Accepted DOHMH, pilot, Fixture, landmarks, Blender, routes, and prior
  quarantine remain intact.
- [ ] No new provider/boundary/data/package/token/cost, Google data, public
  deployment, commit, or push occurred.

### CP2C proof

- [ ] Metadata pre/post schema/edit truth matches; four no-envelope sets are
  equal at 45,194 and the observed SHA; exact queries/headers/IDs evidence saved.
- [ ] Historical 132,410/45,106/88 delta and hashes are recorded truthfully; the
  envelope is never called boundary/superset or used to reject geometry.
- [ ] Exactly 45,194 requested/returned unique OBJECTIDs and required unique
  DOITT parents are accounted; every BBL/BIN/schema/geometry gate passes.
- [ ] Raw bytes/hash/manifest/request/retry/timing/bounds/outlier/accounting are
  immutable, within budgets, and replay identically offline.
- [ ] Failed attempts are uniquely quarantined, no prior partial reused, and the
  accepted DOHMH root/hash is unchanged.

### CP3-CP7 completion

- [ ] Citywide normalization does not clip; raw=parent+explicit rejection,
  accepted set exact, deterministic parts, zero collisions/remainder, pilot
  replay stable.
- [ ] DOHMH preserves every accepted occurrence/multiplicity/CAMIS/unlocated
  truth exactly as its recovery plan requires.
- [ ] Two release builds are byte-identical, safe/checksum-complete, compact,
  sharded, ignored, within every original budget, and cover all seven anchors.
- [ ] Runtime is root-first/local/lazy, camera-sharded, bounded, incremental,
  stable in search/pick/detail/URL, fail-closed, and makes no external request.
- [ ] The recovery-specific omitted-envelope building journey passes without
  clipping/mislabeling; desktop/mobile/accessibility/history/corruption and all
  performance measurements pass.

### Validation, rollback, and handoff

- [ ] Focused and full tests, typecheck, lint, build, syntax, raw/coverage/release
  validators, deterministic diff, benchmark, diff check, protected hashes, and
  scoped Git review pass without lowered criteria.
- [ ] Every checkpoint has status/diff/evidence and a non-destructive rollback
  scoped to Luna-owned hunks/new versioned roots.
- [ ] No raw/generated/public production data, docs/AGENTS, lock/dependency,
  registry approval, protected, DOHMH, pilot, Blender, or unrelated Luna change
  appears in Git status/diff.
- [ ] Every stop condition was checked; any trigger was reported rather than
  inferred around or solved by shrinking scope.
- [ ] Final handoff lists approval, source metadata/set/raw hashes and counts,
  88-ID delta, building/DOHMH/normalization/release counts, coverage/performance/
  browser artifact paths, commands, scoped diff, limitations, and whether
  citywide mode is default or held back.
- [ ] Root Sol High receives only high-risk/final review evidence; Luna retains
  implementation/fix/test-loop ownership and has not committed or pushed.

## 11. Approval conclusion

**No further user approval is required.** This recovery uses the same approved
OTI provider, dataset `jh45-qr5r`, attributes, FeatureServer endpoint, local
immutable retention, derived artifacts, and local browser display already
authorized by `msg_91770ac6d098`. It narrows the acquisition claim to a stronger
source-internal membership proof and reduces dependence on the failed envelope;
it does not add a source, license, cost, credential, provider, public deployment,
or unrelated data. A new approval gate reopens only if a stop condition requires
one of those material scope expansions.
