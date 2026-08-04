# DOHMH citywide acquisition recovery plan

Status: Sol Medium recovery handoff for Luna Max, 2026-08-04.

Decision: **a safe same-provider recovery exists**. Use two complete, independent,
single-response SODA 2.1 JSON captures of the same explicitly selected 31-column
Manhattan query. Do not paginate, request `:id`, infer a provider observation ID,
or claim the response is transactionally atomic. Accept the capture only when
official source truth is stable before/after both responses, each response has
the exact expected row and CAMIS counts, and their order-independent canonical
row multisets—including every duplicate multiplicity—are identical.

The user's approved scope remains Orca message `msg_91770ac6d098`: NYC OTI
Building Footprints and NYC DOHMH Restaurant Inspection Results `43nn-pn8j`,
local immutable snapshots/raw retention/derived local artifacts/local browser
display only. No new provider, Google-derived data, public deployment, unrelated
dataset, paid service, credential, package, commit, or push is authorized.

This plan supersedes only the stable-pagination-key clauses listed in section 12.
Every other truth, coverage, budget, accessibility, performance, rollback,
protected-artifact, and all-Manhattan condition in
`docs/codex/MANHATTAN_CITYWIDE_WAVE_PLAN.md` remains binding.

## 1. Requirements and authoritative current evidence

### 1.1 Exact truth to preserve

1. Completion means snapshot-relative accounting for every Manhattan row returned
   by the approved DOHMH dataset, not “approximately all,” distinct-row count,
   one row per CAMIS, or the prior bbox.
2. The raw snapshot is the exact byte sequence of one successful HTTP response,
   retained immutably with SHA-256, byte size, request/query, response headers,
   source metadata, capture times, terms, and attribution.
3. Every physical JSON array element is an occurrence. If an identical canonical
   row occurs `n` times, its multiplicity is `n`; normalization must emit/account
   for `n` observations. `distinct`, set conversion, map overwrite, digest-only
   IDs, or reconciliation may not reduce it to one.
4. `CAMIS` is the provider's restaurant/permit parent identity. It is not an
   inspection-observation key. Exact duplicate observations have no declared
   provider identity that distinguishes one copy from another.
5. No `$offset`, page number, tied ordering, undocumented/guessed `:id`, array
   index, arrival order, or raw byte position may become source identity.
6. A derived occurrence ID is allowed only after capture. It must be labelled
   `derived-transport-occurrence`, carry `providerRowId: null`, be generated from
   the full canonical row digest plus an order-independent ordinal within that
   identical-row group, and never be presented as a DOHMH/Socrata identifier.
7. Source truth must agree before and after both full responses: metadata schema
   fingerprint, `rowsUpdatedAt`, `viewLastModified`, truth/secondary Last-Modified
   headers, `X-SODA2-Data-Out-Of-Date: false`, Manhattan row count, and distinct
   CAMIS count. Any change invalidates the entire capture sequence.
8. Replay stability is multiset stability, not response-order or raw-byte
   equality. The accepted raw SHA remains important, but two valid responses may
   serialize rows in different unspecified orders.
9. Retry means a new full capture sequence into a new exclusive staging path.
   Never append, resume with a range, concatenate, or promote a partial.
10. Building acquisition remains independent. Its official OTI ID completeness,
    Manhattan source-field membership, zero-unresolved requirement, 132,410
    candidate-envelope evidence, and all original stop gates are unchanged.

### 1.2 Proven repository state

- `artifacts/citywide-wave-20260804/checkpoint-2/STOP-REPORT.md` correctly stopped
  before production acquisition. Last passing implementation checkpoint is CP1.
- Official metadata exposed 31 declared columns and no publisher-declared unique
  observation row key. CAMIS describes restaurant identity, not observation-row
  identity.
- The proven Manhattan truth count is `109,386` rows and `12,439` distinct CAMIS
  groups. A grouping across all documented fields found exact duplicates; the
  report records a duplicate group with `n=2` for CAMIS `40390409` and inspection
  date `2026-02-10`.
- The existing `scripts/normalize-dohmh-pilot.mjs` hashes a stable row to only 24
  hex characters and uses `dohmh:<camis>:<digest>` as `sourceRecordId`. Exact
  duplicates therefore collide and cannot be reused unchanged for citywide.
- The pilot normalizer also rejects rows without coordinates; the citywide truth
  contract instead requires valid CAMIS parents without usable coordinates to
  remain searchable/details-only as `location unavailable`.
- `src/release/citywide-release.ts` and its test are the passing CP1 seam. It
  already enforces approval/source/coverage evidence, safe local refs, SHA-256,
  L14 geometry shards, search/detail shard budgets, seven anchors, LRU/request
  limits, stable parent pick IDs, and zero accounting/collision remainder.
- CP1 regression evidence passed 24 test files / 116 tests, typecheck, lint, and
  diff check. No citywide raw/generated/public root exists.
- OTI read-only evidence remains 132,410 candidate OBJECTIDs and an estimated
  ~107 MiB raw snapshot. It did not trip the 200,000-record or 300 MiB stop gates.
- The dirty worktree contains earlier authorized pilot, place-truth, landmark,
  Blender, app/runtime, and planning work. Recovery implementation must preserve
  it and change only section 6 allowlisted areas.

### 1.3 Current official observations (read-only, no retained production payload)

Observed 2026-08-04 at approximately 07:11 UTC:

| Evidence | Exact observation |
| --- | --- |
| Metadata `GET /api/views/43nn-pn8j` | HTTP 200; dataset `43nn-pn8j`; 31 columns; `rowsUpdatedAt=2026-08-03T22:06:07.000Z`; `viewLastModified=2026-08-03T22:01:00.000Z`; update frequency metadata says daily |
| Manhattan count | `count(*)=109386`; `count(distinct camis)=12439` for exact `boro='Manhattan'` |
| SODA 2.1 one-row CSV/HEAD probe | HTTP 200; `X-SODA2-Data-Out-Of-Date:false`; truth and secondary Last-Modified both `Mon, 03 Aug 2026 22:12:15 GMT`; official fields/types headers present; response is chunked UTF-8 |
| SODA 2.1 large-limit HEAD | HTTP 200 for the same Manhattan query with `$limit=200000`; no payload retained; `X-SODA2-Legacy-Types:true` was absent, consistent with 2.1 |
| SODA3 filtered `/export.csv` sample | Anonymous one-row POST returned HTTP 200 and the 27 user-column CSV header; official docs nevertheless require a valid app token for SODA3 requests |
| UI `/api/views/43nn-pn8j/rows.csv?accessType=DOWNLOAD` probe | Query `$where`/`$limit` parameters were ignored; it began the unfiltered all-NYC export and was stopped without saving a file. It is outside the Manhattan-only approval and unusable for this wave |

The 31 metadata columns are 27 owner/user columns—CAMIS through Location—plus
four Socrata-computed region columns. The acquisition must explicitly select all
31 by API field name so the captured row value contract matches the duplicate
proof. The four computed values remain opaque source-response attributes: they
may be retained for replay fidelity but must not drive identity, membership,
search, UI claims, or an unrelated boundary integration.

The pilot JSON ratio projects about 100,032,895 bytes (95.4 MiB) for 109,386
rows, below the still-binding 300 MiB raw-source stop. This is only a planning
estimate; the actual response byte counter is authoritative.

## 2. Ranked risks

| Rank | Risk | Severity | Likelihood | Mitigation | Hard stop |
| --- | --- | --- | --- | --- | --- |
| 1 | Source mutates while a full response is generated | Critical | Medium/High (daily source) | Stable metadata/count checks before/after each response plus a second independent identical multiset capture | Any truth token/count/schema change, or the two multisets differ |
| 2 | Silent truncation/server limit despite one response | Critical | Medium | Request `preCount + 1`, parse a complete JSON array, require parsed count exactly `preCount`, verify 200/content type and closing syntax | Fewer/more rows, incomplete JSON, 202/206, unexpected redirect/error body, or count at/above requested limit |
| 3 | Exact duplicates are deduplicated or collide | Critical | High in old normalizer | Full multiset map, count sum invariant, full SHA-256 row digest, derived group ordinals, collision check against canonical row bytes | Any multiplicity loss, duplicate output ID, digest collision, or accounting remainder |
| 4 | A system/array ID is misrepresented as provider identity | High | High without explicit schema | CAMIS parent only; `providerRowId:null`; derived occurrence identity type and UI exclusion | `:id`, array index/order, byte offset, or ordinal is labelled provider/DOHMH identity |
| 5 | Response order changes between exports | Medium | High/Unknown | Do not order or compare raw arrays; compare sorted digest->multiplicity entries | Any algorithm depends on order or raw SHA equality |
| 6 | JSON representation/schema changes | High | Medium | Explicit 31-field select and metadata fingerprint; reject unknown fields/types; canonicalize missing source nulls deterministically | Column name/type/position changes, unexpected key/type, or computed field becomes unavailable without review |
| 7 | JSON memory/response size exhausts Node/disk | High | Medium | Stream raw bytes/hash with 300 MiB cap; preflight disk >= 1 GiB; parse one response at a time; benchmark 120k-row fixture; keep replay map compact | Raw >300 MiB, free disk <1 GiB, heap >1 GiB/RSS >1.5 GiB, ENOSPC/OOM, or >15 min response |
| 8 | Retry/resume creates a plausible corrupt snapshot | Critical | Medium | `wx` staging per attempt; no append/range/resume; quarantine every partial with headers/bytes/hash/reason; bounded attempt count | Existing output path, partial promotion, range response, concatenation, or more than bounded requests |
| 9 | CSV fallback loses null/empty/type semantics | High | Medium | JSON is canonical; CSV may be diagnostic only | JSON fails and implementation attempts to silently substitute CSV/XLSX |
| 10 | Terms/provenance scope broadens | Critical | Low/Medium | Cite `msg_91770ac6d098`, DOHMH/NYC terms, request IDs, headers, query, attribution; local-only outputs | Credential/token, new provider, unfiltered all-NYC export, public deployment, or unrelated data required |
| 11 | Building CP2 is weakened to unblock DOHMH | Critical | Medium | Separate manifests/checkpoints and preserve every original building gate | Any envelope-as-boundary shortcut, unresolved Manhattan membership, or changed candidate accounting |
| 12 | Dirty/protected work is overwritten | Critical | High | Scoped status/diff every checkpoint; new immutable roots; reverse Luna hunks only | Protected hash/path changes, unexplained overlap, destructive Git/rollback, or unrelated baseline failure |

## 3. Primary-source research

Only official NYC Open Data and Socrata/Tyler documentation was used.

1. [NYC dataset metadata](https://data.cityofnewyork.us/api/views/43nn-pn8j)
   is the official machine-readable schema/update record. It supplied the exact
   31 fields and timestamps above.
2. [NYC DOHMH dataset page](https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j/about_data)
   identifies the agency/dataset and field semantics. It does not declare an
   inspection-observation primary key.
3. The official [Socrata LIMIT documentation](https://dev.socrata.com/docs/queries/limit.html)
   states that SODA 2.1 and 3.0 have no maximum `LIMIT` (2.0 is capped at 50,000)
   and warns that high-limit requests can time out or become large.
4. Official [Socrata guidance for more than 1,000 rows](https://support.socrata.com/hc/en-us/articles/202949268-How-to-query-more-than-1000-rows-of-a-dataset)
   describes offset paging or a larger limit and confirms that 2.1 has no upper
   limit. Offset paging does not solve this project: dataset metadata does not
   declare a provider observation key, exact source rows duplicate, and the
   approved plan forbids adopting an internal system ID as DOHMH truth.
5. Official [Socrata JSON format documentation](https://dev.socrata.com/docs/formats/json)
   defines one JSON response as an array of result objects and says null-valued
   fields are omitted. The canonicalizer must therefore map an absent selected
   field to source null while preserving an explicit empty string.
6. Official [Socrata API endpoint documentation](https://dev.socrata.com/docs/endpoints.html)
   distinguishes SODA 2.1 `/resource/<id>.json` from SODA3 query/export endpoints.
7. Official [SODA3 query/export documentation](https://dev.socrata.com/docs/queries/index.html)
   says `/export` provides the entire queried dataset and has no page option;
   it supports a SoQL query and a default 600-second timeout. It also says SODA3
   requests require authentication or a valid application token.
8. Official [Socrata response-header documentation](https://dev.socrata.com/docs/response-codes)
   documents HTTP 200/202/429/error behavior plus `X-Socrata-RequestId`, field/
   type headers, Last-Modified, and ETag. Only documented headers are correctness
   dependencies; observed truth/secondary headers are recorded as additional
   evidence and compared within a capture sequence.
9. Official [row identifier documentation](https://dev.socrata.com/docs/row-identifiers)
   distinguishes publisher-specified identifiers from Socrata internal IDs, and
   [system-field documentation](https://dev.socrata.com/docs/system-fields.html)
   describes `:id`. General platform availability is not a dataset-owner claim
   that `:id` is a stable DOHMH observation identifier across full replacements.
10. Official [export-format guidance](https://support.socrata.com/hc/en-us/articles/202949658-Export-Formats-for-Downloading-Data)
    says UI export order cannot be controlled while API downloads can be filtered
    and queried. The same guidance does not promise transaction isolation.
11. Official [large CSV guidance](https://support.socrata.com/hc/en-us/articles/115005306167-Limitations-of-Excel-and-CSV-Downloads)
    permits an over-generous CSV `$limit`, but CSV is not chosen as canonical due
    to null/empty/type and parsing risks.
12. Official [dataset archive documentation](https://support.socrata.com/hc/en-us/articles/9486838238743-Introducing-Dataset-Archiving)
    says archival export depends on dataset enrollment and platform-generated
    archives; enrollment is an owner/admin action. No repository or metadata
    evidence shows an accessible revision-pinned archive for `43nn-pn8j`.

No official document found promises that a SODA 2.1 high-limit query or SODA3
export is a database transaction snapshot. This plan therefore uses the narrower
claim “two complete full-response captures bounded by stable official truth and
identical multisets,” not “atomic export.”

## 4. Same-provider mechanism decisions

| Mechanism | Decision | Exact reason |
| --- | --- | --- |
| SODA 2.1 single filtered JSON response: `/resource/43nn-pn8j.json`, explicit 31-field `$select`, exact Manhattan `$where`, `$limit=count+1`, no offset/order | **Accept as primary, with dual-capture protocol** | Official 2.1 has no maximum limit; one JSON array avoids page-boundary ties; JSON preserves explicit empty strings/types while omitted selected keys deterministically mean source null. Not documented atomic, so one response alone is insufficient; both stable-truth captures and equal multisets are mandatory. |
| SODA 2.1 single filtered CSV response | **Reject as canonical; optional diagnostic only** | It also avoids pagination and physically preserves duplicate rows if parsed correctly, but CSV weakens null-vs-empty/type/location fidelity and adds quoting/newline ambiguity. It may verify count/header behavior but cannot replace JSON after a JSON failure. |
| SODA3 filtered `/api/v3/views/43nn-pn8j/export.csv` | **Defer, do not use in this wave** | Officially unpaged and queryable, and a one-row anonymous probe returned 200, but official docs require an app token/authentication. No credential is authorized, CSV remains weaker, and no atomicity guarantee improves the accepted protocol. |
| SODA3 `/query.json` with one oversized page | **Reject** | It is a page mechanism, requires a token by official docs, and adds no advantage over the unpaged 2.1 response. Do not guess a maximum page size. |
| UI `/api/views/43nn-pn8j/rows.csv?accessType=DOWNLOAD` | **Reject** | The read-only probe showed that SoQL filter/limit parameters were ignored and the unfiltered all-NYC export began. Capturing other boroughs is outside approval, and UI export order is uncontrollable. |
| Dataset archive/export job | **Reject unless NYC later publishes an accessible revision-pinned archive for this asset** | General Socrata archive functionality requires enrollment/platform generation; no accessible `43nn-pn8j` archive revision is evidenced. Creating/enrolling one requires authority this project does not have. |
| OData | **Reject** | It is another query/paging surface with no documented atomic snapshot or provider row key; it does not improve the proof. |
| SODA `:id`/`:created_at`/`:updated_at` | **Reject for observation identity and pagination recovery** | These are Socrata internal system fields, not DOHMH-declared observation IDs. Full-replace updates can churn them; the user explicitly requires no inferred source key. They may not enter canonical IDs, UI, or the acquisition query. |

## 5. Exact acquisition and normalization algorithm

### 5.1 Fixed query contract

Use only HTTPS `GET https://data.cityofnewyork.us/resource/43nn-pn8j.json` with:

- `$select=` these exact 31 API field names in this order (backtick the four
  names beginning with `:`): `camis`, `dba`, `boro`, `building`, `street`,
  `zipcode`, `phone`, `cuisine_description`, `inspection_date`, `action`,
  `violation_code`, `violation_description`, `critical_flag`, `score`, `grade`,
  `grade_date`, `record_date`, `inspection_type`, `latitude`, `longitude`,
  `community_board`, `council_district`, `census_tract`, `bin`, `bbl`, `nta`,
  `location`, `:@computed_region_f5dn_yrer`,
  `:@computed_region_yeji_bk3q`, `:@computed_region_sbqj_enih`, and
  `:@computed_region_92fq_4b7q`;
- `$where=boro='Manhattan'` exactly;
- `$limit=<preflight-count-plus-one>`;
- no `$offset`, `$order`, `distinct`, grouping, system wildcard, `:id`, app token,
  compression dependency, or additional source.

Send `Accept: application/json` and `Accept-Encoding: identity`. Record the fully
encoded URL/query separately, but never use it as a browser runtime URL. The
current expected values are 109,386 rows, 12,439 CAMIS, and limit 109,387. If the
preflight values differ, stop and report the new metadata/count; do not silently
rebaseline from this plan.

### 5.2 Preflight truth envelope

For capture candidate A:

1. Refuse any pre-existing `data/raw/manhattan-citywide-20260804` final output.
   Create an invocation-owned directory with exclusive semantics and mode 0700.
2. Require at least 1 GiB free disk. Record Node version, script SHA, release ID,
   approval message, terms/attribution, start time, and exact request budget.
3. GET metadata bytes from `/api/views/43nn-pn8j`; hash/store them in staging.
   Validate dataset ID, 31-column ordered name/field/type fingerprint, update
   frequency metadata, and expected observed timestamps.
4. GET the exact Manhattan aggregate count and distinct CAMIS count. Store raw
   response bytes/headers and parsed values. Require 109,386 and 12,439.
5. Issue a HEAD for the exact full query. Require HTTP 200, JSON-compatible
   content type for the GET contract, source not out-of-date, and matching source
   truth. A HEAD content length is not required because the endpoint may stream.

The aggregate count query is evidence only; it does not supply rows or identity.

### 5.3 Full response capture A

1. Open `dohmh-manhattan.snapshot-a.json.partial` with `wx` before the request.
   Stream response bytes directly to it while incrementally computing SHA-256 and
   byte count. Do not buffer the network body in memory.
2. Use 30-second connect/header timeout and 900-second total timeout. Abort at
   300 MiB. Accept only HTTP 200; reject 202, 206, redirects outside the exact
   host/path, 4xx/5xx, unexpected content type/charset, or content encoding not
   handled exactly.
3. Write response headers to a separate exclusive `.headers.partial` file,
   including request ID, Last-Modified/truth/secondary values, out-of-date flag,
   ETag if present, content type/encoding, date, and status. Headers do not replace
   body validation.
4. On network/parser/timeout/size failure, close both files and atomically move
   the invocation directory beneath its own `quarantine/<timestamp>-<reason>/`.
   Never append or reuse it.
5. After stream completion, parse the complete JSON array. Parsing must fail on
   trailing non-whitespace, truncation, invalid UTF-8, invalid JSON, non-array,
   non-object row, unexpected key, invalid value shape, or row count not exactly
   109,386. Every row must have `boro === "Manhattan"`.

Memory gate: parse only one completed response at a time. Luna must first prove a
120,000-row synthetic worst-case fixture stays under 1 GiB heap and 1.5 GiB RSS.
If the real parse crosses either gate, stop; do not add a package or silently use
CSV. A later implementation plan may design a dependency-free streaming JSON
parser, but that architecture expansion is not inferred here.

### 5.4 Canonical multiset

Define canonical row `C(r)` as stable JSON over all 31 selected fields in metadata
position order:

- an omitted selected key becomes JSON `null`, per official JSON null omission;
- explicit `""` remains an empty string;
- strings remain exact Unicode strings—no trim, case fold, date conversion, or
  address normalization in the raw canonical layer;
- JSON numbers remain finite JSON numbers; text-typed numeric-looking values stay
  strings; point/objects are recursively key-sorted without numeric rounding;
- no platform/system/transport field is added.

Compute full `rowDigest = SHA-256(UTF8(C(r)))`. Maintain a map from full digest to
`{canonicalRow, multiplicity}`. If one digest maps to different canonical bytes,
stop as a digest collision. Require the sum of multiplicities to be 109,386.

Define the snapshot multiset digest:

```text
SHA-256(concat over lexicographically sorted rowDigest:
  rowDigest + TAB + decimalMultiplicity + LF))
```

Also record unique canonical row count, duplicate-group count, duplicate excess
`sum(max(0, multiplicity-1))`, maximum multiplicity, CAMIS group count, rows per
CAMIS histogram, and missing/null/empty counts for every field. These metrics are
evidence, not filters.

### 5.5 Postflight A and independent capture B

1. Immediately repeat metadata, count, and HEAD checks. Require exact equality
   with preflight A and the full response's truth headers.
2. Start candidate B from a fresh preflight and fresh exclusive files. The
   required request budget is two successful full responses, with at most two
   additional failed full attempts total across the sequence. A 429 may honor one
   documented `Retry-After`; then stop. Backoff full-attempt retries by 2 seconds
   then 8 seconds, and restart all truth checks.
3. Candidate B must independently pass every byte/JSON/count/schema/borough and
   postflight check.
4. Compare A and B:
   - source metadata/schema/timestamps/count/CAMIS/truth values equal;
   - parsed row counts equal 109,386;
   - canonical row count, every digest multiplicity, and multiset digest equal;
   - duplicate metrics equal.

Raw response SHA/order may differ and is not a failure. Multiset inequality is a
hard failure; quarantine both candidates and report the first differing digest/
multiplicities without printing a real row's full personal/contact data.

### 5.6 Promotion and immutable manifest

After A and B agree:

1. Atomically rename A raw/header/metadata/count files from `.partial` to final
   immutable paths. Keep B under `replay/` with its own immutable bytes/hash and
   mark it validation evidence, not a second source.
2. Write the acquisition manifest last with `wx`, then hash it externally. It
   must include approval ID/scope/exclusions, endpoint/query/31-field fingerprint,
   no-offset/no-order/no-system-ID declaration, request IDs, timings/retries,
   pre/post truth, row/CAMIS counts, raw/replay bytes and SHA-256, multiset digest,
   duplicate metrics, parser/version/script hash, terms/attribution, and all
   invariant results.
3. Run a local offline replay twice from A bytes and once from B bytes. Require
   byte-independent identical canonical multiset metrics/derived identities.
4. No provider request occurs after promotion. Downstream steps accept only the
   manifest-pinned local path and raw SHA.

### 5.7 Deterministic derived occurrence identities

For each canonical row group sorted by full `rowDigest`, emit exactly
`multiplicity` observation occurrences with ordinals `1..multiplicity`:

```text
parentId = "dohmh:camis:" + exactCamis
observationOccurrenceId =
  "dohmh:derived-occurrence:" + rowDigest + ":" + zeroPad6(ordinal)
providerRowId = null
identityClass = "derived-transport-occurrence"
duplicateGroupMultiplicity = multiplicity
```

Do not assign an ordinal while iterating transport rows. Identical rows are
indistinguishable; only the deterministic set of `n` occurrence IDs is claimed.
The set is invariant under every permutation of the response. It remains stable
across replay while the canonical row and multiplicity remain the same. It is not
evidence that occurrence 1 corresponds to a particular DOHMH database row.

The current domain requires a non-empty `sourceRecordId`; if retained, store the
derived occurrence ID there **and** add/validate `providerRowId:null` and the
identity class so UI/reconciliation cannot mislabel it. Use the full 64-hex row
digest, not the pilot's 24-hex prefix. CAMIS remains the only parent identity.

### 5.8 Why duplicates do not block recovery

Let response array `R` contain `N` elements and canonicalization be `C`. Define
multiset `M(x) = |{i : C(R[i]) = x}|`. A single response with parsed `N` equal to
the official Manhattan count captures every occurrence without needing to name
it. A second response under identical source truth with `M_A = M_B` proves replay
of values and all multiplicities independent of order. For each `x`, emitting
the deterministic identity set `{hash(x)#1 ... hash(x)#M(x)}` preserves exactly
`M(x)` observations. Exact duplicate rows prevent attribution of distinct
provider row identities, but they do **not** prevent complete multiset capture,
accounting, deterministic normalization, or stable replay.

This is an acceptably bounded snapshot proof, not a proof of transaction
isolation. If official truth changes or replay differs, the proof fails closed.

## 6. Luna allowed files and do-not-touch areas

### Allowed

- `package.json` only to add the exact recovery/citywide scripts named below; no
  dependency or package-manager change.
- New `scripts/acquire-manhattan-citywide-dohmh-snapshot.mjs` and narrowly scoped
  dependency-free helpers/tests under `scripts/lib/` or `src/ingestion/`.
- A new citywide DOHMH normalizer script/helper and tests; narrowly scoped changes
  to `src/ingestion/poi-snapshot.ts`, `src/domain/schema.ts`, and place-truth tests
  only for derived occurrence identity, duplicate multiplicity, and unlocated
  CAMIS truth. Preserve pilot defaults/behavior through regression tests.
- The original plan's allowed building acquisition/normalization files.
- Existing CP1 `src/release/citywide-release.ts` and test, plus provider-neutral
  release/runtime/App/Cesium/search/navigation/style tests and files allowed by
  original sections 5-6 after raw acquisition passes.
- New ignored roots only:
  `data/raw/manhattan-citywide-20260804/`, corresponding new generated/public
  citywide roots, and `artifacts/citywide-wave-20260804/recovery-*` evidence.
- `src/data/source-registry.ts` only to append the already-approved exact local
  citywide scope/message ID to the two existing entries; do not broaden approval.

### Do not touch

- `AGENTS.md`, either citywide plan, this recovery plan, other `docs/**`, decisions,
  research, runbooks, `.gitignore`, lockfile, dependencies, CI/deploy/env/keys.
- Existing `data/raw/real-wave-20260804/**`, its quarantine, all pilot generated/
  public roots, or aborted artifacts.
- `artifacts/blender/**`, `public/assets/landmarks/**`, protected landmark hashes,
  Blender files, landmark runtime/manifest semantics.
- Google, OSM, Overture, MTA, other NYC datasets, borough datasets, images,
  reviews/ratings/hours, public hosting/deployment, or a credential/app token.
- Source/system `:id` as observation identity or acquisition order.
- Raw/generated citywide data in Git. No reset, clean, checkout, force operation,
  commit, push, blanket formatter, production browser provider request, or
  destructive rollback.

## 7. Ordered implementation checkpoints

### Recovery CP2A — implement acquisition proof with local fixtures

1. Re-read both plans, STOP report, CP1 evidence/code, exact dirty status, and
   approval. Record current baseline/protected hashes; do not redo CP0/CP1 work.
2. Add pure helpers for metadata fingerprint, canonical row, row/multiset digest,
   duplicate metrics, order-independent occurrence IDs, response/truth comparison,
   size/count gates, and redacted mismatch reporting.
3. Add a fetch/staging CLI implementing section 5 with injected fetch/clock for
   tests. Default must refuse any non-official host, non-HTTPS URL, unexpected
   dataset ID/filter/field list, existing output, app token, offset/order/system
   field, or more than the bounded request budget.
4. Test fixtures: exact duplicates, shuffled arrays, null versus empty, all 31
   fields, unlocated CAMIS, truncated/extra/invalid JSON, count/CAMIS/schema/truth
   mutation, different multiplicity, unknown key/type, wrong borough, digest
   collision seam, timeout/429/oversize, partial quarantine, and replay equality.
5. Run a generated 120,000-row memory fixture; enforce section 5 gates.

Evidence: focused tests, typecheck, lint, full tests, diff check, memory/RSS, and
no live production capture. Rollback: reverse only CP2A Luna hunks; move new
fixture evidence aside. CP1 files remain passing.

### Recovery CP2B — bounded dual full-response capture

1. Run preflight; require the exact observed 31-field schema, 109,386 rows,
   12,439 CAMIS, source timestamps/truth, and approval scope.
2. Execute A and B exactly as section 5. No other acquisition runs concurrently.
3. Promote only after equal multisets and all truth/count/duplicate invariants.
4. Run offline replay/manifest validation and record raw/replay sizes/hashes,
   duplicate metrics, memory, requests, duration, quarantine history.

Evidence: immutable raw/replay/manifest and zero remainder. Rollback: move the
entire new invocation-owned root into its own quarantine sibling; never delete or
reuse. If any gate fails, CP1 remains the last passing checkpoint.

### Recovery CP2C — resume unchanged building acquisition proof

Execute original CP2 building steps: candidate and source-internal Manhattan
sets, exact field/query/header/count evidence, sorted unique OBJECTID acquisition,
zero missing/duplicate requested IDs, consistent borough-code membership, raw
hash/bytes, and zero unresolved records. The envelope remains a candidate
superset, never an authoritative boundary. DOHMH recovery supplies no building
membership evidence.

Rollback: quarantine only the new building invocation root. Any unresolved
membership or size/schema/count change stops CP2C without affecting accepted
DOHMH evidence.

### Recovery CP3 — normalization and accounting

1. Normalize DOHMH from accepted local raw bytes using full multiset groups and
   derived occurrence identities. Emit all 109,386 occurrences and exactly
   12,439 CAMIS parents unless the accepted manifest says otherwise—which would
   already have stopped under current observed evidence.
2. Keep located/unlocated parent counts, source-backed conflicts, all inspection
   semantics, and no rating/status/hours inference. No duplicate disappears.
3. Normalize buildings under original stable DOITT/multipart/height/membership
   rules. Replay pilot identities/semantics.
4. Require:
   - DOHMH raw rows = normalized occurrences + explicit rejected rows;
   - every occurrence ID is unique, each group emits exact multiplicity, and
     multiset digest recomputes from normalized raw canonical fields;
   - unique CAMIS parent count and located+unlocated count agree;
   - building raw = accepted+quarantined/rejected and accepted source IDs exactly
     match the approved Manhattan set;
   - zero accounting remainder/identity collision and stable replay.

Rollback: quarantine only new normalized roots; reverse only citywide normalizer
hunks. Never alter raw snapshots or pilot outputs.

### Recovery CP4 — compact deterministic release

Resume original CP4 unchanged: new staging root, compact L14 building/restaurant
geometry, deterministic dense splitting, sharded search/details, complete safe
manifest/checksums/source/coverage/freshness, two byte-identical release builds,
budget validation, atomic local publish, and no raw inspection history in marker/
search payloads. Detail observations must carry derived identity class and may
never label occurrence IDs as provider IDs.

Rollback: quarantine only new staging/generated/public release roots and keep
citywide mode unavailable. Pilot/CP1 remain.

### Recovery CP5 — runtime, search, details, and fail-closed behavior

Resume original CP5 unchanged: root-manifest-first local loading, viewport shard
streaming, sharded search/details, stable CAMIS/DOITT parent URL/pick IDs, unlocated
details without marker/flight, bounded concurrency/cache, incremental Cesium
primitives, history/reload, source/truth copy, and scoped no-substitute failures.

Additional gate: the UI may show “source observation” and duplicate count but
must not show the derived occurrence token as a DOHMH inspection ID.

Rollback: remove only citywide mode hunks; Fixture/pilot remain active.

### Recovery CP6 — browser/performance evidence

Run the original seven-anchor two-tour desktop/mobile matrix, fixed search and
pick corpus, network/console/frame/cache/heap budgets, history/reload, keyboard/
focus/reduced-motion, corruption matrix, and no external runtime requests.
Add one details test for an exact-duplicate group and one unlocated CAMIS; the
observation count must equal normalized multiplicity and remain truthfully
labelled.

Rollback: reverse only the last measured Luna hunk to the last passing patch;
never weaken budgets/truth criteria.

### Recovery CP7 — final evidence and root review

Run all commands in section 8, protected hashes, scoped diff, generated-data Git
exclusion, raw/replay/normalized/release invariants, and fixed browser evidence.
Root Sol High reviews only the high-risk acquisition/multiset proof, building
membership, performance evidence, protected hashes, and final scoped diff. Luna
fixes and repeats loops until pass or stop.

Rollback: keep citywide non-default/unavailable and report the last passing
checkpoint. No commit/push.

## 8. Observable completion conditions and exact validation

### 8.1 Acquisition and truth completion

1. The manifest cites `msg_91770ac6d098`, only `43nn-pn8j`, exact Manhattan
   filter, explicit 31 fields, no offset/order/system ID/token, terms/attribution,
   and local-only exclusions.
2. Both accepted responses are HTTP 200 complete JSON arrays with 109,386 rows,
   12,439 CAMIS, every row Manhattan, <=300 MiB, <=15 minutes, immutable raw
   bytes/hash, headers/request IDs, and stable before/after source truth.
3. A/B multiset digest and every digest multiplicity match. Sum multiplicities is
   109,386; duplicate group/excess/max metrics are nonzero and recorded; no hash
   collision or accounting remainder exists. Raw SHA equality is not required.
4. Every derived occurrence ID is unique, order-independent, full-digest based,
   `providerRowId:null`, and labelled derived. Exactly `n` IDs exist for an
   identical-row group of multiplicity `n`; CAMIS parent count is 12,439.
5. Truncation, source mutation, replay difference, timeout, 429 exhaustion,
   oversize, wrong schema/borough, and partial response each quarantine and fail.
6. No unfiltered all-NYC data, app token, CSV fallback, `:id`, or provider request
   enters runtime/repository.

### 8.2 Still-binding citywide completion

- Building candidate/source membership/accepted accounting has zero unresolved
  records and preserves all original counts/hashes/provenance/height semantics.
- All seven Manhattan anchors have source-backed coverage; full city is not
  replaced by bbox success.
- Release manifest <=256 KiB; geometry shard <=2 MiB/2,000 features; search/detail
  shard <=1 MiB; total runtime release <=300 MiB; <=512 shards.
- First camera <=12 MiB/16 release requests, <=4 concurrent; cache <=24 shards/
  48 MiB; <=6,000 settled features; search/pick/frame/bundle/heap pass the exact
  original budgets.
- Search/pick/detail/URL agree on CAMIS/DOITT parent; missing/corrupt content never
  substitutes fixture/same-name data; unlocated CAMIS remains searchable.
- No external runtime request, console/WebGL error, accessibility/history/mobile
  regression, protected hash change, generated data in Git, or unrelated diff.

### 8.3 Exact implementation/test commands

Luna must add these package scripts exactly and record stdout/stderr/exit status:

```sh
pnpm citywide:acquire:dohmh -- \
  --release manhattan-citywide-20260804 \
  --output-root data/raw/manhattan-citywide-20260804 \
  --expected-rows 109386 \
  --expected-camis 12439 \
  --replay-count 2 \
  --timeout-ms 900000 \
  --max-bytes 314572800 \
  --max-full-attempts 4

pnpm citywide:validate:raw -- \
  --root data/raw/manhattan-citywide-20260804

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
shasum -a 256 public/assets/landmarks/landmark-wave-20260804/*
```

Focused tests must include:

```sh
pnpm test -- --run \
  src/ingestion/dohmh-citywide-snapshot.test.ts \
  src/release/citywide-release.test.ts
```

If Luna chooses a different test file path, keep the package/CLI names and update
the focused command in handoff evidence; do not change this plan.

### 8.4 Exact Orca browser evidence

1. Create an Orca-visible Vite terminal, use its printed URL, open an Orca tab,
   wait for network idle, start capture, snapshot, and record initial console/
   network. Do not guess the port.
2. Pilot regression: search/select known CAMIS and DOITT IDs; click the same
   primitives; reload/Back/Forward; toggle layers/modes; confirm bounded copy.
3. Citywide mode: initial request is root manifest plus only fixed-camera shards;
   no whole-city JSON/browser provider request.
4. Run both tours at original coordinates/heights: Financial/Battery, Chelsea/
   Midtown, Upper West, Upper East, Harlem, Inwood/Marble Hill, Roosevelt Island.
   After 3-second settle record 10 seconds frame intervals, request count/bytes,
   tile cache, rendered count, and heap if exposed. Repeat the tour.
5. At every anchor search/select one building and located CAMIS target from ignored
   generated evidence. Assert search=pick=detail=URL parent IDs; run 30 fixed
   search/picks for p95.
6. Exact-duplicate journey: select a CAMIS/details record whose canonical row
   group multiplicity is >1. The details/provenance observation count equals the
   normalized multiplicity; there is no rating or fake provider observation ID.
7. Unlocated journey: search/deep-link an unlocated CAMIS; details open with
   “location unavailable,” and no marker/camera flight occurs.
8. Corrupt copied root/tile/search/detail files one at a time and request unknown
   release/parent. Every case fails at the documented scope with no substitute.
9. Repeat desktop 1440x900 and mobile 390x844, keyboard Tab/Arrows/Enter/Escape,
   focus return, screen-reader status, 200% zoom, and reduced motion.
10. Finish with Orca snapshot/screenshot plus console limit 500 and network limit
    1000. Console has no wave error/warning; all network hosts are app-origin.

## 9. Rollback points

| Checkpoint | Safe rollback |
| --- | --- |
| CP2A | Reverse only saved Luna-owned acquisition/helper/test hunks; move new fixture evidence aside |
| CP2B | Move the whole invocation-owned raw root into a unique quarantine sibling; never delete/reuse/merge partials |
| CP2C | Quarantine only the new building acquisition root; accepted DOHMH raw remains immutable |
| CP3 | Quarantine new normalized roots and reverse only citywide normalizer hunks; raw/pilot unchanged |
| CP4 | Move only new staging/generated/public release roots aside; keep citywide unavailable |
| CP5 | Reverse only citywide mode/runtime hunks; Fixture/pilot remain active |
| CP6 | Reverse only the last measured hunk to the last passing scoped patch; never raise budgets |
| CP7 | Keep citywide non-default/unavailable and report last passing checkpoint; no destructive Git/commit/push |

At every point capture status, diff check, and a scoped Luna patch. Never restore
whole dirty files from `HEAD` or a blanket backup.

## 10. Stop and report instead of guessing

Stop the affected checkpoint and report exact redacted evidence if:

1. Metadata is not the observed dataset/31-field schema, or current row/CAMIS
   counts are not 109,386/12,439; approval/terms/local-only scope is unclear.
2. Any pre/response/post truth timestamp, schema, count, CAMIS count, out-of-date
   state, or A/B multiset/multiplicity differs.
3. The endpoint requires offset/order/system ID/token, returns fewer/more rows,
   truncates, redirects, emits non-200/JSON, exceeds 300 MiB/15 minutes, or hits
   disk/heap/RSS limits.
4. JSON canonicalization cannot distinguish null/empty/type deterministically,
   sees unknown fields/types, a non-Manhattan row, digest collision, duplicate ID,
   multiplicity loss, or accounting remainder.
5. More than four full attempts would be needed, 429 persists after one
   Retry-After, source is unavailable, or a partial would need resume/append.
6. Only CSV/UI export/SODA3 token/archive/OData/new source can proceed. Report the
   smallest required decision: authorize a Socrata app token for the existing
   dataset's filtered unpaged SODA3 export, **or** obtain from NYC/DOHMH an
   accessible revision-pinned Manhattan export/declared stable observation key.
   Do not infer either.
7. Building membership proof has an unresolved/conflicting record, unexpected
   schema/count/volume, or needs another boundary source.
8. Any original release/runtime/performance/truth/accessibility/coverage budget
   fails or would require a package, worker database, host/CDN, renderer change,
   public deployment, new provider, Google data, or smaller geography.
9. Protected pilot/landmark/Blender hash/path changes, required hunk overlaps
   unexplained dirty work, rollback risks prior work, or unrelated baseline fails.

The report states last passing checkpoint, exact expected/actual values, request
IDs/times (not private row content), affected paths, quarantine state, and the
smallest decision. Never lower criteria or shrink Manhattan.

## 11. Luna pre-exit checklist

### Goal, scope, and files

- [ ] Goal remains all-Manhattan buildings plus DOHMH restaurants from the same
  two approved sources; approval `msg_91770ac6d098` and exclusions are recorded.
- [ ] Only section 6 files/roots changed; no docs/AGENTS/lock/dependency/pilot/
  landmark/Blender/unrelated path changed.
- [ ] No token, `:id`, offset, CSV fallback, UI all-NYC export, new provider,
  Google data, public deployment, or unrelated data was used.

### Acquisition proof

- [ ] Exact 31-field query, Manhattan filter, count+1 limit, no order/page/system
  field, metadata fingerprint, terms/attribution, headers/request IDs are pinned.
- [ ] A and B each contain 109,386 rows / 12,439 CAMIS, complete JSON, <=300 MiB,
  stable pre/post truth, every row Manhattan, immutable bytes/SHA.
- [ ] Every row digest/multiplicity and multiset digest match; duplicate metrics
  are recorded/nonzero; multiplicities sum to 109,386; zero collision/remainder.
- [ ] Derived occurrence IDs are full-digest/order-independent/unique, emit exact
  multiplicity, say `providerRowId:null` and `derived-transport-occurrence`, and
  never appear as DOHMH IDs in UI.
- [ ] Failed attempts/partials are uniquely quarantined; no append/resume/merge;
  bounded request/memory/disk/time gates passed.

### Resumed citywide work

- [ ] Building source membership/acquisition proof remains independent and has
  zero unresolved records; no envelope-as-boundary shortcut.
- [ ] Normalization accounts for every DOHMH occurrence and building record,
  preserves unlocated truth/inspection semantics/pilot identity, zero collisions.
- [ ] Release builds are byte-identical, safe/checksum-complete, within all shard/
  total budgets, ignored, and contain no full history in marker/search payloads.
- [ ] Runtime is local/lazy/viewport-sharded, stable parent picking/search/details/
  URLs, bounded cache/concurrency, fail-closed, no substitute/external request.
- [ ] All seven anchors, duplicate and unlocated journeys, desktop/mobile,
  keyboard/focus/reduced-motion, history/reload, corruption matrix, network/
  console/frame/search/pick/cache/heap budgets pass.

### Validation, rollback, and handoff

- [ ] Focused tests, full tests (at least existing 24 files/116 tests plus new),
  typecheck, lint, build, memory fixture, raw/coverage/release validators,
  deterministic diff, benchmark, protected hashes, and `git diff --check` pass.
- [ ] No acceptance test/budget was removed, weakened, skipped, or silently
  rebaselined; every superseded clause is limited to section 12.
- [ ] Every checkpoint has a scoped non-destructive rollback and status/diff
  evidence; no dirty-tree work would be erased.
- [ ] Triggered stop conditions were reported rather than inferred around.
- [ ] Final handoff lists approval, exact raw/replay/count/hash/multiset/duplicate/
  CAMIS/building/coverage/release/performance evidence, commands, browser artifact
  paths, scoped diff, remaining product gaps, and default/held-back mode state.
- [ ] Luna did not commit/push. Root Sol High reviews only high-risk acquisition/
  membership/performance/protected-hash evidence and final scoped diff; Luna owns
  fixes and repeat loops.

## 12. Explicitly superseded original-plan clauses

Only these clauses in `MANHATTAN_CITYWIDE_WAVE_PLAN.md` are superseded:

1. Section 3 risk 3 and its stop condition requiring a stable unique DOHMH
   pagination key. Replacement: no pagination; dual complete-response multiset
   proof in this plan.
2. Original CP2 item 4 requiring metadata to prove a stable unique page key and
   page-key ranges without gaps/overlap. Replacement: exact single JSON array
   count/completeness plus A/B multiset equality and stable truth.
3. Original CP2 completion evidence requiring DOHMH page ranges. Replacement:
   sections 5.3-5.6 and 8.1 here.
4. Original section 7 condition 3's “stable unique page order” and “non-overlap
   page ranges.” Replacement: order independence, exact row count, duplicate
   multiplicities, multiset digest, and dual replay.
5. Original section 8.2 `--page-size 50000` command and instruction that the CLI
   refuse until a unique order key is discovered. Replacement: exact recovery
   acquisition command in section 8.3, with no page/offset/order key.
6. Original section 10 item 3 and checklist text that treat absence of a stable
   unique DOHMH page key as a terminal blocker. Replacement: absence remains true
   but is no longer relevant because the accepted mechanism is unpaged; every
   source mutation/full-response/multiset stop condition remains.
7. Any original text implying digest-only DOHMH row IDs are unique. Replacement:
   full canonical row digest plus derived occurrence ordinal/identity class.

All other original requirements—including approval limits, 31-field/source
truth, raw immutability, two-source scope, building proof, unlocated records,
citywide coverage, budgets, streaming/search/runtime/browser/accessibility,
rollback, protected assets, no external runtime requests, and final checklist—
remain binding without relaxation.
