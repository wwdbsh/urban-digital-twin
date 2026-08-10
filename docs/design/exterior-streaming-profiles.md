# Exterior streaming and render profiles — user-facing behavior

This describes what a person actually sees. The runtime rules and their
rationale live in `docs/decisions/0023-exterior-streaming-dual-profiles.md`.

## What is actually shipped today

The only exterior-cell release this build pins is a synthetic fixture package,
`udt-fixture-exterior-cells`, served from the local data root. Its geometry is
generated placeholder massing, but it is pinned to real base building
identities and to the base releases the app actually loads, so everything
described below — profiles, canary selection, fallback notices, picking — is
genuinely exercisable in the running app. Production exterior assets are
expected from a later task.

Opening a link that names any other exterior release shows a notice naming both
the release you asked for and the one this build pins, and leaves the rest of
the view untouched.

## Where the controls are

The runtime note in the upper-left control lane gains one control group,
`Exterior streaming and render profile`:

- **Enable / Disable exterior streaming** — always available. Enabling adds
  `exteriorCells` and `exteriorProfile` to the URL.
- **Exploration profile / Inspection profile** — disabled until the exterior
  runtime is genuinely loaded, verified, and compatible with the active base
  release. Never enabled on a hopeful or loading state.
- **Try canary `<snapshotId>`** — one button per canary the release explicitly
  pins. Also disabled until the runtime is active.

## What the two profiles do

Both profiles draw only geometry the runtime has already verified.

- **Exploration** favors the coarsest verified representation that still covers
  the current camera range. Use it when moving across the city.
- **Inspection** favors the finest verified representation that covers the
  current camera range. Use it when looking closely at one building.

"Camera range" here is the camera's height above the ellipsoid, bucketed, used
as a proxy for how far away things are. It is not a measured distance to each
building.

Switching profiles changes the drawn level of detail and nothing else. The
selected feature stays selected, the details panel content and provenance are
unchanged, the release origin is unchanged, and the only URL parameter that
changes is `exteriorProfile`. A shared link therefore restores the same view
with the same profile.

If a camera distance is beyond every declared level of detail for an asset, that
asset is not drawn at all. It is never replaced by a different asset.

## Default versus canary

The app always starts on the **operator-pinned default snapshot**. It never
picks a "latest" snapshot and never promotes a canary.

Choosing a canary is an explicit action. While a canary is active:

- the runtime note reads `Canary snapshot <id> (explicitly selected)`;
- the details panel repeats the same label under **Release origin**;
- the URL carries `exteriorCanary=<id>`.

Reloading a canary URL keeps you on that canary but does not make it the
default; leaving the canary or disabling exterior streaming returns you to the
pinned default. If you open somebody else's canary link in a build that does not
pin that canary, you land on the **default** snapshot and see a notice naming
both the canary you asked for and the default you got.

## Fallback and failure notices

Fallbacks are per cell and always announced in an alert region titled
**Exterior streaming fallback**. There are exactly three outcomes for a cell
that does not render its pinned head:

1. **Predecessor shown.** The cell's checksum-pinned predecessor version is
   drawn instead. The notice names the cell and the predecessor release. The
   details panel marks the cell as `pinned predecessor fallback`.
2. **Base massing kept.** An initial cell version falls back to the pinned base
   identity set, which carries no exterior geometry, so the existing verified
   citywide/civic massing stays visible for that area. The notice says so.
3. **No exterior geometry.** Both the head and its pinned predecessor failed
   verification. That one cell shows no exterior geometry and the notice says
   so plainly.

A failure is always isolated to one cell. Neighboring cells, the base release,
the Stage 3 commercial overlay, and the Block 835 public-realm overlay are
unaffected. Nothing is ever silently replaced by a fixture or by another release
that happens to share a name.

There is a fourth, narrower notice: if a building's exterior geometry verified
successfully but its matching base building record is not loaded, there is no
verified position to draw it at. That geometry is withheld and named in the
notice, and it appears on its own once the base record loads.

If the exterior release itself cannot be loaded or verified, exterior streaming
stays off, the runtime note explains why, and the rest of the app is left
exactly as it was. An unsupported `exteriorProfile` value in a link is likewise
named in a notice rather than quietly replaced by the default.

## Selecting exterior geometry

Clicking exterior geometry selects the **same base building record** you would
have selected by clicking the base massing, with the same ID, the same deep
link, and the same details. The selection does not change when the level of
detail or the profile changes.

When several things overlap, a commercial storefront marker wins, then any
building record (including exterior geometry), then a public-realm marker.

## What this does not claim

Exterior geometry is generated, not observed. The details panel states the truth
tier, the source dates, and the explicit uncertainty for the active asset.
Verified bytes prove the geometry is exactly what the release pinned; they do
not make it a survey, a photograph, or current real-world truth.
