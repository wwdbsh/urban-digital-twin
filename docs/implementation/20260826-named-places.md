# Named places: a deep-linked pose per landmark (T014, 2026-08-26)

Seven named places each get one canonical identity, one deep-linked camera pose,
and a structural evidence record. The registry is
`src/domain/named-places.ts`; the evidence is
`artifacts/named-places-20260826/named-places-evidence.json`, regenerated with
`pnpm named-places:evidence`.

## Why a registry and not a search heuristic

The ground release is content-addressed. `udt:ground:manhattan:water:96c4c6af8c1fea9b`
is the Hudson River only because the NYC hydrography row behind it says so — the
id itself says nothing. Resolving a place name against geometry at runtime would
be a guess. Pinning the id here, next to the source record it came from, is a
citable claim, and `src/release/named-places-evidence.test.ts` re-checks every
one of them against the release bytes.

Display names are read from the retained snapshot, never invented. Each entry
records `sourceDisplayName` (the literal source string), `displayNameField`
(where it was read from), and — only where the two differ — a
`displayNameNote` explaining the transformation. The only transformation in use
is title-casing the two upper-cased hydrography names.

## The Battery, not Battery Park

**NYC Parks has no property literally named "Battery Park."** The downtown
landmark is property **M005**, whose `name` is **"The Battery"**. Property
**M283** is **"Battery Park City"** — a different park further north along the
Hudson, which this registry does not ship and must not be substituted for M005.

The registry therefore offers no "Battery Park" alias in any surface: not as a
display name, not as a search alias. `named-places.test.ts` asserts all three
halves of that decision (M005 is the id, "The Battery" is the name, M283 is
absent), so the trap cannot be reopened by a later edit that looks harmless.

## Poses are derived, not eyeballed

A `CameraPose` is a **camera position** (`applyCameraPoseRequest` in
`CesiumViewport.tsx`), so a pitched camera placed at a feature's centroid looks
straight past it. Each pose was produced by reading the feature's real vertex
bounds out of the per-cell artifacts, choosing a height whose footprint covers
the larger half-extent, then walking the camera back from the frame target by
`height / tan(|pitch|)` along the heading — the inverse of `groundTargetForPose`.

Two poses were tuned away from the first draft, both because the geometry said
so:

- **Central Park** went from 1200 m to **2500 m**. Its retained extent is
  2.75 km x 3.98 km, so 1200 m framed roughly a quarter of it. Heading 35
  follows the park's long axis.
- **Times Square** went from 450 m / -60 to **700 m / -55**. The DOT plaza
  record is a 0.9 km ribbon along Broadway, not a square; 450 m cut off its
  northern third.

`named-places-evidence.test.ts` re-derives each footprint and asserts the
feature's own geometry falls inside it, so a pose that stops framing its place
fails the suite instead of shipping.

## Cell extents are plate carrée, not Web Mercator

Ground cell ids end `-<level>-<x>-<y>`. At level 14 the partition is **2^14 equal
steps of 360/2^14 in longitude and 180/2^14 in latitude**, y counting south from
the pole. Reading the same three numbers as a slippy Mercator tile lands about
20 degrees north of Manhattan — which is exactly the bug the first draft of
`groundCellBounds` had, caught because every place reported zero cells in view.
The disk half of the test now checks the derivation against the `cellBounds`
written into every per-cell artifact.

## What the evidence proves, and what it does not

Per place the record carries: canonical id, class, identity origin, the shipped
deep link, the pose, the derived ground target and footprint, the feature's
geometry bounds, the owning cells and which of them the pose looks at, a full
class census of those cells, per-cell orthoimagery status, and a provenance
summary.

**Imagery is accounted for, not claimed complete.** Every `(cell, class)` pair a
place owns is either textured or refused *with the index's own stated reason* —
`unaccounted` is zero for all seven, and the generator refuses to write the file
otherwise. Fourteen cells are refusals, concentrated at the river margins where
the retained 2024 orthoimagery footprint runs out: Hudson River 22 textured /
8 refused, East River 3 / 5, The Battery 1 / 1. Those flat polygons are the
honest edge of the imagery wave, not a rendering fault.

**No visual claim is made.** No screenshots were captured this cycle. Everything
above is structural. Visual confirmation — that each pose actually reads as its
landmark — is deferred to the P3 browser batch.

## Extent caveats carried in the registry

- **Times Square Plaza** is the DOT pedestrian-plaza programme boundary
  (Broadway, 41 St to 53 St, partner Times Square Alliance). It is not the
  colloquial extent of Times Square and not a survey of current paving.
- **East River**: the retained clip covers the upper reach beside Manhattan,
  roughly 40.7725–40.8069 N. The pose frames that reach, not the whole river.
- **Hudson River**: the retained clip runs the full 22 km west side
  (40.6928–40.8911 N), which no single pose can frame. The pose shows the
  midtown reach; 22 of its 30 cells are off-frame by design.
