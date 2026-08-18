/**
 * The one place this application's own code is allowed to pick.
 *
 * AND THAT IS NOT THE SAME AS "the one place a pick can happen", which is what
 * an earlier version of this header claimed. `Viewer` installs its own
 * `LEFT_DOUBLE_CLICK` handler — `pickAndTrackObject` — which calls `scene.pick`
 * directly, inside CesiumJS, where no source scan in this repository can see it
 * and no bracket can wrap it. A double click over a far-tier tile would
 * therefore pick against a scene with the tile still in the pick pass: exactly
 * the invisible-id occluder described below. `CesiumViewport` removes that
 * input action at viewer construction, and a test pins the removal. Anything
 * that re-introduces an entity-tracking double click must register it through
 * this bracket.
 *
 * WHY THIS MODULE EXISTS. The far tier draws a merged per-cell tile over the
 * massing it replaces. Two measured facts about CesiumJS make that dangerous,
 * and both were established in the T003 Stage 0 spike, recorded at
 * `data/far-tier-hlod-runtime-20260818/stage-0-picking-spike.json`
 * (sha256 a95723fd0973760ff7d539fcc3ccc851bbd0dc053bcb1cf872aebd217f73aa5b):
 *
 *  1. A per-instance colour alpha below 0.004 REMOVES the instance from the
 *     pick pass entirely — see `FAR_TIER_MASSING_PICK_ALPHA` below.
 *
 *  2. `allowPicking: false` DOES NOT remove a primitive from the pick pass. It
 *     only clears the pick id. `Primitive.updateAndQueueCommands` pushes the
 *     draw command whenever `passes.render || passes.pick` and merely chooses
 *     between `colorCommand.pickId = "v_pickColor"` and `undefined`
 *     (cesium@1.143.0 `Build/CesiumUnminified/index.js:48744-48765`). The tile
 *     therefore stays an invisible-id OCCLUDER that still writes depth, and it
 *     swallows every click on the massing behind it. The spike measured picking
 *     lost at every alpha up to 0.5 with the tile present, and restored the
 *     moment the tile was removed.
 *
 * ROUTE D, the adjudicated fix: hide the far-tier primitives for the DURATION
 * of the pick call and restore them immediately. `Scene.pick` and
 * `Scene.drillPick` render into an offscreen pick framebuffer and return
 * synchronously, so no presented frame is ever affected and the toggle cannot
 * be seen. The tile stays OPAQUE, which matters — the rejected alternative was
 * drawing it translucent so it would write no depth, but a translucent merged
 * tile cannot self-occlude, and buildings behind buildings inside one tile
 * would show through each other.
 *
 * The restore is in a `finally`. An exception thrown out of a pick must never
 * be able to leave the far tier hidden for the rest of the session.
 *
 * THE NEXT CESIUM UPGRADE SHOULD READ THIS. If a future version stops pushing
 * non-pickable commands into the pick pass, constraint 2 disappears and this
 * bracket becomes unnecessary. `far-tier-pick-bracket.test.ts` pins the
 * behaviour this module compensates for, so that upgrade will show up as a
 * test telling you the workaround can go, rather than as silence.
 */

/**
 * The lowest per-instance colour alpha that keeps a massing instance in the
 * pick pass.
 *
 * DO NOT "CLEAN THIS UP" TO ZERO. Zero destroys far-range picking. Cesium
 * discards translucent fragments below this cutoff, and the discard happens
 * inside `czm_non_pick_main()`, which the pick fragment shader calls BEFORE it
 * writes the pick id — so a fragment below the cutoff never reaches the pick
 * output at all. The T003 Stage 0 spike measured the cutoff directly and it is
 * sharp:
 *
 * | alpha | 0 | 0.002 | 0.004 | 0.01 | 0.02 | 0.05 | 0.1 |
 * |-------|---|-------|-------|------|------|------|-----|
 * | picks | ✗ | ✗     | ✓     | ✓    | ✓    | ✓    | ✓   |
 *
 * The visual cost of holding 0.004 instead of 0 is nil, and that is measured
 * too, not assumed: reading back rendered pixels over each far subject, the
 * tile alone and the tile with the massing over it were IDENTICAL at
 * [138, 107, 79] on all three subjects — a maximum channel delta of 0 8-bit
 * levels.
 */
export const FAR_TIER_MASSING_PICK_ALPHA = 0.004 as const;

/** Anything with a toggleable `show`; narrowed so tests need no Cesium scene. */
export interface FarTierHideable { show: boolean }

export interface PickableScene {
  pick(windowPosition: unknown): unknown;
  drillPick(windowPosition: unknown, limit?: number): unknown[];
}

export interface FarTierPickBracket {
  pick(windowPosition: unknown): unknown;
  drillPick(windowPosition: unknown, limit?: number): unknown[];
}

/**
 * Wrap a scene so every pick hides the far tier first and restores it after.
 *
 * `hideables` is read at call time rather than captured, because far-tier
 * primitives are added and removed as cells stream in and out; a snapshot taken
 * at construction would stop covering the tiles that arrived later, which is
 * exactly the silent regression this bracket exists to prevent.
 */
export function createFarTierPickBracket(scene: PickableScene, hideables: () => readonly FarTierHideable[]): FarTierPickBracket {
  const bracket = <T>(run: () => T): T => {
    const hidden = hideables();
    const restore = hidden.map((entry) => entry.show);
    for (const entry of hidden) entry.show = false;
    try {
      return run();
    } finally {
      // Restore whatever each primitive's show WAS, not a blanket true: a tile
      // that was already hidden for its own reason must stay hidden.
      hidden.forEach((entry, index) => { entry.show = restore[index]!; });
    }
  };
  return {
    pick: (windowPosition) => bracket(() => scene.pick(windowPosition)),
    drillPick: (windowPosition, limit) => bracket(() => scene.drillPick(windowPosition, limit)),
  };
}
