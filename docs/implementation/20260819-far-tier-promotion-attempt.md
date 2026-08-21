# The far-tier promotion: everything built, one pose short

Task: T005 (Goal `manhattan-hlod-far-tier`, Issue #105)
Branch: `fcp/105-promotion`
Date: 2026-08-19
Status: **SUPERSEDED BY ACTIVATION, AND LEFT STANDING.**
See `docs/implementation/20260821-far-tier-promotion-activation.md`.

> This record described the state after sweep-1: built, not activated,
> `FAR_TIER_DEFAULT_ON = false`. It is **not corrected in place**, because the
> reasoning it contains was honest about what had been measured and is the
> reason the flip was withheld. What it got wrong is stated in one place, at the
> top of the activation record: P2's failure was a **stale published reading**,
> not the unsuppressed massing this document infers. The scene was correct; the
> number was not. Read this document as a record of a decision made on the best
> evidence then available, and the activation record for what that evidence
> turned out to mean.

## What promotion needed, and what it got

840 tiles staged and digest-verified, merged into one pinned inventory, served
under ceilings derived for the island rather than for one cell. All of that
works and is committed. The default flip was made, swept, and reverted.

## The sweep found something, which is what a sweep is for

Five of six registered poses pass with every failure state at zero. **P2 — the
only oblique pose, reconstructed from the user's own session screenshot — left
11,867 of 23,959 loaded massing buildings unsuppressed under drawn far-tier
tiles**, and the count did not converge across three readings (12,485 / 26 /
11,867). Straight-down poses at 1,400 m, 1,600 m and 12 km all read exactly 0.

Those buildings cannot be exemptions by construction, so this is the
tan-massing-through-tiles condition the sweep exists to detect. Shipping the
flip would have put an intermittent double-draw into every default session.

## Two instrument defects, both found by running the sweep

1. **The member metric measured the wrong population.** It compared the full
   member list of every drawn tile against the applied-alpha set and read
   **41,405 uncovered at P1**, where the true answer is 0. Alpha can only be
   written for buildings the dense index holds; most members of the island's
   tiles have no massing primitive loaded. A building that is not drawing
   cannot show tan.
2. **The settle rule fired mid-flight.** Six stable 500 ms samples is satisfied
   by the plateau during a dense-layer rebuild. Corrected to four consecutive
   identical reads at 6 s spacing with a 48 s floor.

Both are disclosed against the registered single-attempt policy. Neither
correction moved a bar, and P2 failed under all three instruments.

## Two runtime defects the island exposed

`attempted.add` ran before the admission check, so a cell refused over-budget
was never reconsidered — the ceiling was permanent for that cell even once its
bytes were free. And the fill was a single uninterruptible chain of fetch,
verify and model build; at 840 cells a camera move waited for the whole island.
Both are fixed, and the retry test fails when the fix is reverted.

## A pose-derivation bug worth remembering

The first pose registry computed cell centres with a Web-Mercator formula. The
ledger's y is not Web-Mercator: two poses came out at **latitude 62.9**, in the
North Atlantic, beside plausible Manhattan longitudes. Nothing would have
failed — the sweep would have photographed open ocean and reported zero
uncovered buildings. Centres now come from the same two functions the runtime's
own anchor composes.

## Also seen, not diagnosed

Six repeated `Unexpected token '<', "<!doctype "... is not valid JSON` notices
in the runtime panel at every ON pose. Something fetches a path the dev server
answers with `index.html`. Recorded because it was on screen; not attributed to
the far tier.

## What is left

One thing: why the covered set does not reliably reach every loaded massing
building at an oblique pose. The instability across readings points at the
dense-layer rebuild racing the covered-set write, which the code already flags
around `denseDesiredFarTierCoveredRef`.
