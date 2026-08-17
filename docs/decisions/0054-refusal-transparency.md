# ADR 0054 — Refusal transparency: telling a user why a building was refused

Status: accepted.
Date: 2026-08-17
Task: T007
Relates to: ADR 0048 (grammar-extension recovery, which produced the stop-code
vocabulary), ADR 0052 (the full-city serving shape), ADR 0053 (the acceptance
campaign). **Amends nothing.**

## Context

Goal criterion #9 has two halves:

> a tombstoned parent's details panel surfaces its stop code and a plain-language
> reason; **and** the fallback notice reflects the new coverage reality without
> false claims in any streaming arm.

The first half was simply absent. 205 buildings across the island were refused by
the V3 exterior grammar, each with a generator-written sentence naming a stop
code and the measured gate value that tripped it — and the app could not show any
of it. Selecting a refused building produced one sentence:

> No verified exterior representation is active for this record.

That sentence is *true*. It is also true of a building whose cell has not
streamed yet, and of a building no exterior release owns. Collapsing three
situations into one sentence is not a wording problem; it is a **usability and
honesty** problem, because it does not separate the permanent from the
recoverable. A user told this about a refused building will move closer forever.
A user told it about a not-yet-resident building will conclude the city is
missing a building that is actually shipping.

## Decision

### D-1 — The data path is the already-resident release graph

No new asset, no lookup table, no release re-emission, and no new request.

`release-graph.json` is fetched **whole** at boot, once per wave, and every `-s1`
graph already carries its refusals as `buildingDetails` rows with
`status: "unavailable"`, a `tombstoneId`, and the census `reason` **verbatim**,
including the bracketed stop code and any measured gate values. The refusal panel
is therefore an *indexing* change, not a data change: one memoized synchronous
accessor, `ExteriorCellRuntime.refusedBuildings()`, over rows that are already in
memory and already verified.

It sits beside `declaredNotShippedCellCount()` and `promotedBuildingIds()`, which
read the same rows for different questions, and it carries the same "costs no
request" property for the same reason. Only `unavailable` rows are indexed —
roughly 205 island-wide against 44,989 available — so the map is small even
though the graph is not.

**Rejected: a refusal manifest.** Emitting a `refusals.json` per release would
have added an artifact, a checksum, a validator and a release re-emission to
surface data the client had already downloaded and parsed. The cheapest correct
change was to read what was there.

### D-2 — The row splits three ways, by marker

| Case | Marker | What it says |
| --- | --- | --- |
| Refused | `data-exterior-refusal` | Permanent. Names the release, the tombstone id, the stop code, and the reason. |
| Not resident | `data-exterior-not-resident` | Recoverable. "An asset ships for this building… Move closer to load it." |
| Not owned | `data-exterior-not-owned` | Unchanged wording: no exterior release claims it. |

The three markers are mutually exclusive by construction, which is what lets J7
detect a **mis-classification** rather than merely a missing string.

Refused/not-resident are distinguished by membership in
`promotedBuildingIds()`, which is already sorted for the identity digest, so the
check is a binary search — no second accessor and no second copy of 45,000 ids.

**The lookup runs directly over the active wave runtimes, not through
`exteriorWaveForSelection`.** That helper attributes by *rendered* outcome, and a
refused building appears in no wave's rendered set — so attribution returns
`null` for precisely the selections this row exists to explain, and with six
waves streaming there is no single wave to fall back to. This is the detail that
decides whether the feature works at all at full scale.

### D-3 (H1) — The app quotes the arm-dependent clause; it never asserts it

Every shipped reason ends:

> …; base massing from the pinned citywide release is what remains on screen.

That clause is **true in the default arm and false under
`?exteriorScheduler=off`**, where there is no overview tier drawing base massing.
The release is not wrong to say it — it describes the arrangement the release was
cut for — but the app cannot repeat it as a live claim, because the reason string
carries no information about which arm the session is in.

So the row does both:

- `exteriorRefusalStatement()` truncates at the semicolon that introduces the
  clause, and that truncated sentence is what the app **asserts**
  (`data-exterior-refusal-statement`). It is a strict prefix of the release's own
  wording — truncation only, never paraphrase.
- The **full, untouched** sentence is rendered beside it as an explicitly
  attributed quotation (`data-exterior-refusal-quotation`): *"Recorded by the
  release, verbatim: …"*.

Nothing is hidden and nothing arm-dependent is asserted. J7 captures the same
building in both arms and checks the asserted sentence is byte-identical between
them while the quotation still carries the clause.

The doubled period some reasons contain (`…area floor.. No geometry…`) is
upstream, produced by the generator joining a detail that already ends in a full
stop to the following sentence; it is deliberately **not** cleaned up here,
because the panel's contract is that the quotation is byte-identical to what the
release recorded, and silently tidying punctuation is the first step toward
tidying wording.

### D-4 — The notice half of criterion #9 needs no change, and here is why

Measured, not assumed: **zero of the 883 cells across all six serving waves is
fully tombstoned.**

| Wave | Fully-tombstoned cells |
| --- | --- |
| all six `-s1` releases | 0 |

`exteriorNotShippedSummary` / `NOT_SHIPPED_PATTERN` count cells whose
`buildingDetails` are *entirely* unavailable. On the shipped default that
numerator is structurally 0, so the coverage sentence **is never produced**. No
coverage string is currently false because none is currently emitted; the
not-shipped notice path is exercised today only by fixtures and by the
documentation that describes it.

The 205 refusals are scattered *within* cells that ship geometry, which is
exactly why they needed a per-building surface rather than a per-cell notice.

This ADR therefore **does not** touch `exteriorNotShippedSummary`,
`NOT_SHIPPED_PATTERN`, the three population sentences, or the dismissal-key
inputs. The refusal row is details-panel-only and deliberately does **not**
participate in the notice digest: a refusal is a property of a selection, not a
session-level condition, and feeding it into the dismissal key would make an
unrelated notice reappear whenever a user clicked a refused building.

### D-5 — Rollback

Resolved in both directions, and both are already true:

- **Both URL arms stay truthful.** The default arm and `?exteriorScheduler=off`
  render the same asserted sentence (J7-d, measured), so a rollback of the
  scheduler flag cannot make the panel say something false.
- **The record-swap machinery is untouched.** No promotion record, activation
  pin, or release artifact changes, so rolling back to a prior release swaps the
  graph and the refusal panel simply reports whatever that graph declares. There
  is no separate refusal artifact that could fall out of step with the release it
  describes — which is the main reason D-1 rejected a manifest.

## Consequences

- A refused parent now explains itself, in the release's own words, with the
  measured gate value that tripped the grammar.
- The stop-code vocabulary is **closed** at four codes
  (`ring-area-below-floor` 114, `ring-neck-below-grammar-minimum` 44,
  `volume-identity-failed` 43, `ring-not-simple` 4 — 205 total). An unrecognized
  code renders as `unrecognized` and says so, rather than echoing an unknown
  token as though it were understood.
- Criterion #9's first half is discharged for the four codes J7 selected. It is
  **not** discharged for the 201 refused parents J7 did not select; the accessor
  is population-wide and tested over all 205 through the real graphs, but only
  four were seen in a browser.

## What this does not claim

- No visual or geographic acceptance. The J7 stills are evidence that pixels were
  produced, not evidence of likeness.
- No canvas pick. Every J7 selection is a `?feature=` deep link, not a mouse
  click on geometry — the same gap ADR 0053 carries.
- Nothing about refusals in the `-c1` retention packages, which the app does not
  stream.
