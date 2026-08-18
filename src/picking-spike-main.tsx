/**
 * T003 STAGE 0 — the picking spike. Dev-only; not part of the shipped app.
 *
 * THE CONTRACT-DECIDING QUESTION. The far tier wants to replace the tan massing
 * draw with one merged per-cell tile that carries no per-building ids. The
 * massing's per-instance `show` flip controls BOTH the colour and the pick pass
 * — `Primitive._appendShowToShader` runs before `appendPickToVertexShader`, as
 * the shipped comment in `CesiumViewport.tsx` says — so hiding a building with
 * `show=false` also makes it unpickable. Doing that at far range would destroy
 * per-building picking, which the contract forbids.
 *
 * OPTION (c), UNDER TEST HERE: leave `show` TRUE and drive the per-instance
 * COLOUR alpha to zero, so the massing is invisible but still in the pick pass;
 * draw the far tile as a `Primitive` with `allowPicking: false` so it cannot
 * take the click.
 *
 * The Cesium source says this should work — `appendPickToFragmentShader` only
 * prepends `in vec4 v_pickColor;` and the pick program overwrites
 * `out_FragColor` with the pick id, so the instance colour never reaches the
 * pick output and an alpha of zero cannot discard it. That is an argument. This
 * file is the measurement.
 *
 * It reports into `#spike-results` as JSON so a harness reader does not have to
 * interpret a screenshot.
 */

import type { Cartesian2, Scene } from "cesium";
import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  ShowGeometryInstanceAttribute,
  VertexFormat,
  Viewer,
} from "cesium";

const ORIGIN = { longitude: -73.9861, latitude: 40.7484 };
const METERS_PER_DEGREE_LONGITUDE = 84_412.702;
const METERS_PER_DEGREE_LATITUDE = 111_049.654;

/** A square footprint `size` metres on a side, centred at a metre offset from ORIGIN. */
function squareRing(eastMeters: number, northMeters: number, size: number): Cartesian3[] {
  const half = size / 2;
  const corners: Array<[number, number]> = [
    [eastMeters - half, northMeters - half],
    [eastMeters + half, northMeters - half],
    [eastMeters + half, northMeters + half],
    [eastMeters - half, northMeters + half],
  ];
  return corners.map(([east, north]) =>
    Cartesian3.fromDegrees(
      ORIGIN.longitude + east / METERS_PER_DEGREE_LONGITUDE,
      ORIGIN.latitude + north / METERS_PER_DEGREE_LATITUDE,
    ),
  );
}

interface Subject { id: string; east: number; north: number; height: number }

/**
 * ONE row, widely spaced, viewed from straight overhead.
 *
 * The first attempt used two rows at an oblique pitch and its own BASELINE was
 * wrong — the near row occluded the far row, so `far:4` picked `near:4` before
 * anything was hidden. A spike whose control arm fails cannot answer anything.
 * Straight-down at 1,500 m removes inter-subject occlusion entirely, and 1,500 m
 * is inside the far tier's own envelope.
 *
 * Alternating roles put the alpha-0 subjects and their visible controls in the
 * SAME frame, so a difference cannot be a difference of frame.
 */
const SUBJECTS: Subject[] = [];
for (let index = 0; index < 6; index += 1) {
  const role = index % 2 === 0 ? "far" : "near";
  SUBJECTS.push({ id: `${role}:${index}`, east: -300 + index * 120, north: 0, height: 40 });
}

/** Byte-for-byte the shipped construction, so the spike tests the real thing. */
function massingInstance(subject: Subject, alpha: number): GeometryInstance {
  return new GeometryInstance({
    id: subject.id,
    geometry: new PolygonGeometry({
      polygonHierarchy: new PolygonHierarchy(squareRing(subject.east, subject.north, 40)),
      height: 0,
      extrudedHeight: subject.height,
      vertexFormat: VertexFormat.POSITION_ONLY,
    }),
    attributes: {
      color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString("#d7a85d").withAlpha(alpha)),
      show: new ShowGeometryInstanceAttribute(true),
    },
  });
}

/** Stand-in for the merged far-tier tile: one primitive, no per-building ids. */
function farTilePrimitive(): Primitive {
  const instances = SUBJECTS.filter((subject) => subject.id.startsWith("far:")).map((subject) =>
    new GeometryInstance({
      id: "far-tier-tile:cell",
      geometry: new PolygonGeometry({
        polygonHierarchy: new PolygonHierarchy(squareRing(subject.east, subject.north, 40)),
        height: 0,
        extrudedHeight: subject.height,
        vertexFormat: VertexFormat.POSITION_ONLY,
      }),
      attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString("#8a6b4f")) },
    }),
  );
  return new Primitive({
    geometryInstances: instances,
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: false }),
    // THE OTHER HALF OF OPTION (c): the tile must never take a click.
    allowPicking: false,
    asynchronous: false,
  });
}

function screenPositionOf(scene: Scene, subject: Subject): Cartesian2 | undefined {
  // The TOP face centre: straight down, that is what the pick ray meets first.
  const world = Cartesian3.fromDegrees(
    ORIGIN.longitude + subject.east / METERS_PER_DEGREE_LONGITUDE,
    ORIGIN.latitude + subject.north / METERS_PER_DEGREE_LATITUDE,
    subject.height,
  );
  return scene.cartesianToCanvasCoordinates(world);
}

function measureFrameMs(scene: Scene, frames: number): number {
  // Warm up so shader compilation does not land inside the measurement.
  for (let index = 0; index < 5; index += 1) scene.render();
  const started = performance.now();
  for (let index = 0; index < frames; index += 1) scene.render();
  return (performance.now() - started) / frames;
}

async function run(): Promise<void> {
  const viewer = new Viewer("cesium", {
    // Needed so the spike can read back rendered pixels and MEASURE the tint
    // rather than asserting it is imperceptible.
    contextOptions: { webgl: { preserveDrawingBuffer: true } },
    baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
    infoBox: false, selectionIndicator: false, shouldAnimate: false,
  });
  const scene = viewer.scene;
  scene.globe.show = false;
  if (scene.skyBox) scene.skyBox.show = false;
  scene.backgroundColor = Color.fromCssColorString("#0d151b");

  const massing = scene.primitives.add(new Primitive({
    geometryInstances: SUBJECTS.map((subject) => massingInstance(subject, 0.82)),
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
    asynchronous: false,
  })) as Primitive;

  // Straight down from 1,500 m: far-tier range, and no subject can occlude another.
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(ORIGIN.longitude, ORIGIN.latitude, 1_500),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
  });
  scene.render();

  const results: Record<string, unknown> = {};
  const farSubjects = SUBJECTS.filter((subject) => subject.id.startsWith("far:"));
  const controlSubjects = SUBJECTS.filter((subject) => subject.id.startsWith("near:"));

  // Baseline: everything visible, everything pickable.
  const baselineMs = measureFrameMs(scene, 60);
  const baselinePicks = SUBJECTS.map((subject) => {
    const position = screenPositionOf(scene, subject);
    const picked = position ? scene.pick(position) : undefined;
    return { subject: subject.id, pickedId: picked?.id ?? null, correct: picked?.id === subject.id };
  });
  results.baselineVisible = {
    frameMs: Number(baselineMs.toFixed(4)),
    picks: baselinePicks,
    // A spike whose control arm is wrong cannot answer anything. This gates the rest.
    baselineTrustworthy: baselinePicks.every((entry) => entry.correct),
  };

  // ARM A0 — ALPHA ALONE, no tile in the scene. Isolates the alpha effect from
  // any possibility that the tile is blocking or absorbing the pick.
  const setAlpha = (alpha: number): void => {
    for (const subject of farSubjects) {
      const attributes = massing.getGeometryInstanceAttributes(subject.id);
      attributes.color = ColorGeometryInstanceAttribute.toValue(Color.fromCssColorString("#d7a85d").withAlpha(alpha));
    }
    scene.render();
  };
  const pickAll = (): Array<{ subject: string; pickedId: string | null; correct: boolean }> =>
    farSubjects.map((subject) => {
      const position = screenPositionOf(scene, subject);
      const picked = position ? scene.pick(position) : undefined;
      const id = typeof picked?.id === "string" ? picked.id : null;
      return { subject: subject.id, pickedId: id, correct: id === subject.id };
    });

  setAlpha(0);
  results.armA0_alphaZeroNoTile = {
    note: "Alpha 0 with NO far tile present. If picking is lost here, alpha is the cause and the tile is exonerated.",
    picks: pickAll(),
  };

  // ARM A-SWEEP — is there an alpha threshold above which picking survives and
  // below which it does not? A visually negligible alpha that keeps the pick
  // pass alive would rescue option (c) in modified form.
  results.armASweep_alphaThreshold = [0, 0.002, 0.004, 0.01, 0.02, 0.05, 0.1].map((alpha) => {
    setAlpha(alpha);
    const picks = pickAll();
    return { alpha, allCorrect: picks.every((entry) => entry.correct), pickedIds: picks.map((entry) => entry.pickedId) };
  });

  // ARM A — option (c) as specified: alpha 0 plus the tile, allowPicking false.
  setAlpha(0);
  const tile = scene.primitives.add(farTilePrimitive()) as Primitive;
  scene.render();
  const alphaZeroMs = measureFrameMs(scene, 60);
  results.armA_alphaZeroWithTile = {
    frameMs: Number(alphaZeroMs.toFixed(4)),
    frameMsDeltaVsBaseline: Number((alphaZeroMs - baselineMs).toFixed(4)),
    picks: farSubjects.map((subject) => {
      const position = screenPositionOf(scene, subject);
      const picked = position ? scene.pick(position) : undefined;
      const drilled = position ? scene.drillPick(position) : [];
      return {
        subject: subject.id,
        pickedId: typeof picked?.id === "string" ? picked.id : null,
        correct: picked?.id === subject.id,
        drillIds: drilled.map((entry) => (typeof entry?.id === "string" ? entry.id : String(entry?.id ?? "?"))),
        tileInDrill: drilled.some((entry) => entry?.id === "far-tier-tile:cell"),
      };
    }),
    controlsStillPick: controlSubjects.map((subject) => {
      const position = screenPositionOf(scene, subject);
      const picked = position ? scene.pick(position) : undefined;
      return { subject: subject.id, pickedId: picked?.id ?? null, correct: picked?.id === subject.id };
    }),
  };

  // ARM B — the naive replacement the contract forbids, measured for contrast.
  for (const subject of farSubjects) {
    const attributes = massing.getGeometryInstanceAttributes(subject.id);
    attributes.show = ShowGeometryInstanceAttribute.toValue(false);
  }
  scene.render();
  const showFalseMs = measureFrameMs(scene, 60);
  results.armB_showFalse = {
    note: "The naive replacement. Recorded to show what option (c) is avoiding.",
    frameMs: Number(showFalseMs.toFixed(4)),
    picks: farSubjects.map((subject) => {
      const position = screenPositionOf(scene, subject);
      const picked = position ? scene.pick(position) : undefined;
      return { subject: subject.id, pickedId: picked?.id ?? null, correct: picked?.id === subject.id };
    }),
  };

  // ARM C — THE SHIPPING CANDIDATE: alpha at the 0.004 cutoff, tile present.
  // Answers the remaining two questions: does it still pick with the tile in
  // front, and how much does a 0.4%-opacity massing tint the tile?
  for (const subject of farSubjects) {
    const attributes = massing.getGeometryInstanceAttributes(subject.id);
    attributes.show = ShowGeometryInstanceAttribute.toValue(true);
  }
  const readPixel = (subject: Subject): number[] | null => {
    const position = screenPositionOf(scene, subject);
    if (!position) return null;
    const canvas = scene.canvas;
    const probe = document.createElement("canvas");
    probe.width = canvas.width; probe.height = canvas.height;
    const context = probe.getContext("2d");
    if (!context) return null;
    context.drawImage(canvas, 0, 0);
    const ratio = canvas.width / canvas.clientWidth;
    const data = context.getImageData(Math.round(position.x * ratio), Math.round(position.y * ratio), 1, 1).data;
    return [data[0]!, data[1]!, data[2]!];
  };

  // Tile alone: massing hidden outright, so the reference is the tile's own colour.
  for (const subject of farSubjects) {
    massing.getGeometryInstanceAttributes(subject.id).show = ShowGeometryInstanceAttribute.toValue(false);
  }
  scene.render();
  const tileOnly = farSubjects.map((subject) => readPixel(subject));

  // The shipping candidate: massing present at the cutoff alpha, over the tile.
  for (const subject of farSubjects) {
    const attributes = massing.getGeometryInstanceAttributes(subject.id);
    attributes.show = ShowGeometryInstanceAttribute.toValue(true);
    attributes.color = ColorGeometryInstanceAttribute.toValue(Color.fromCssColorString("#d7a85d").withAlpha(0.004));
  }
  scene.render();
  const withMassing = farSubjects.map((subject) => readPixel(subject));
  const candidateMs = measureFrameMs(scene, 60);

  results.armC_shippingCandidate = {
    alpha: 0.004,
    frameMs: Number(candidateMs.toFixed(4)),
    frameMsDeltaVsBaseline: Number((candidateMs - baselineMs).toFixed(4)),
    picks: farSubjects.map((subject) => {
      const position = screenPositionOf(scene, subject);
      const picked = position ? scene.pick(position) : undefined;
      const drilled = position ? scene.drillPick(position) : [];
      return {
        subject: subject.id,
        pickedId: typeof picked?.id === "string" ? picked.id : null,
        correct: picked?.id === subject.id,
        drillIds: drilled.map((entry) => (typeof entry?.id === "string" ? entry.id : String(entry?.id ?? "?"))),
        tileInDrill: drilled.some((entry) => entry?.id === "far-tier-tile:cell"),
      };
    }),
    controlsStillPick: controlSubjects.map((subject) => {
      const position = screenPositionOf(scene, subject);
      const picked = position ? scene.pick(position) : undefined;
      return { subject: subject.id, correct: picked?.id === subject.id };
    }),
    visualBleed: farSubjects.map((subject, index) => ({
      subject: subject.id,
      tileOnlyRgb: tileOnly[index],
      withMassingRgb: withMassing[index],
      maxChannelDelta: tileOnly[index] && withMassing[index]
        ? Math.max(...tileOnly[index]!.map((value, channel) => Math.abs(value - withMassing[index]![channel]!)))
        : null,
    })),
  };

  // DIAGNOSTIC — the sweep passed at alpha 0.004 with NO tile, and arm C failed
  // at the same alpha WITH the tile. Either the show attribute did not survive
  // arm B, or the tile blocks the pick despite allowPicking:false. Read the
  // attributes back and sweep again with the tile in place.
  results.diagnostic_tilePresentSweep = [0.004, 0.05, 0.5].map((alpha) => {
    for (const subject of farSubjects) {
      const attributes = massing.getGeometryInstanceAttributes(subject.id);
      attributes.show = ShowGeometryInstanceAttribute.toValue(true);
      attributes.color = ColorGeometryInstanceAttribute.toValue(Color.fromCssColorString("#d7a85d").withAlpha(alpha));
    }
    scene.render();
    const readBack = massing.getGeometryInstanceAttributes(farSubjects[0]!.id);
    return {
      alpha,
      showAttributeReadBack: Array.from(readBack.show as ArrayLike<number>),
      colorAttributeReadBack: Array.from(readBack.color as ArrayLike<number>),
      picks: pickAll().map((entry) => entry.pickedId),
    };
  });

  // And the same sweep with the tile REMOVED, to close the comparison.
  scene.primitives.remove(tile);
  scene.render();
  results.diagnostic_tileRemovedSweep = [0.004, 0.05].map((alpha) => {
    setAlpha(alpha);
    return { alpha, picks: pickAll().map((entry) => entry.pickedId) };
  });

  // ESCAPE ROUTES. Cesium pushes the tile's draw command into the PICK pass
  // regardless of `allowPicking` — that flag only clears `pickId`, so the tile
  // becomes an invisible-id occluder that writes depth (index.js:48744-48765).
  // Two ways out, both measured.
  const tileBack = scene.primitives.add(farTilePrimitive()) as Primitive;
  setAlpha(0.004);

  // ROUTE D — hide the far tier for the DURATION OF THE PICK CALL. The pick
  // renders to an offscreen framebuffer, so no presented frame ever shows the
  // massing; the user cannot see the toggle.
  results.routeD_hideTileDuringPick = {
    approach: "tile.show = false around scene.pick, restored immediately after.",
    picks: farSubjects.map((subject) => {
      const position = screenPositionOf(scene, subject);
      if (!position) return { subject: subject.id, pickedId: null, correct: false };
      tileBack.show = false;
      const picked = scene.pick(position);
      tileBack.show = true;
      const id = typeof picked?.id === "string" ? picked.id : null;
      return { subject: subject.id, pickedId: id, correct: id === subject.id };
    }),
    tileVisibleAfterwards: tileBack.show,
  };

  // ROUTE E — draw the tile TRANSLUCENT. Cesium's translucent render state does
  // not write depth, so it cannot occlude the pick pass. The cost is that a
  // merged tile then cannot self-occlude, which matters for a cell of buildings.
  scene.primitives.remove(tileBack);
  const translucentTile = scene.primitives.add(new Primitive({
    geometryInstances: (farTilePrimitive() as unknown as { geometryInstances: GeometryInstance[] }).geometryInstances,
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
    allowPicking: false,
    asynchronous: false,
  })) as Primitive;
  scene.render();
  results.routeE_translucentTile = {
    approach: "Tile drawn in the TRANSLUCENT pass, which does not write depth.",
    picks: pickAll().map((entry) => ({ subject: entry.subject, pickedId: entry.pickedId, correct: entry.correct })),
    caveat: "A translucent merged tile cannot self-occlude: buildings behind buildings inside the same tile would show through. Recorded as measured, not recommended.",
  };
  scene.primitives.remove(translucentTile);
  scene.primitives.add(farTilePrimitive());
  scene.render();

  // Leave the shipping candidate on screen for the screenshot.
  scene.render();


  const armA = results.armA_alphaZeroWithTile as { picks: Array<{ correct: boolean; tileInDrill: boolean }> };
  const sweep = results.armASweep_alphaThreshold as Array<{ alpha: number; allCorrect: boolean }>;
  const lowestSurvivingAlpha = sweep.find((entry) => entry.allCorrect)?.alpha ?? null;
  const armB = results.armB_showFalse as { picks: Array<{ correct: boolean }> };
  results.verdict = {
    baselineTrustworthy: (results.baselineVisible as { baselineTrustworthy: boolean }).baselineTrustworthy,
    optionC_pickingPreserved: armA.picks.every((entry) => entry.correct),
    optionC_tileNeverTakesAClick: armA.picks.every((entry) => !entry.tileInDrill),
    armB_pickingLost: armB.picks.every((entry) => !entry.correct),
    frameCostDeltaMs: Number((alphaZeroMs - baselineMs).toFixed(4)),
    alphaAloneLosesPicking: !(results.armA0_alphaZeroNoTile as { picks: Array<{ correct: boolean }> }).picks.every((e) => e.correct),
    lowestAlphaThatPreservesPicking: lowestSurvivingAlpha,
    routeD_works: (results.routeD_hideTileDuringPick as { picks: Array<{ correct: boolean }> }).picks.every((e) => e.correct),
    routeE_works: (results.routeE_translucentTile as { picks: Array<{ correct: boolean }> }).picks.every((e) => e.correct),
    shippingCandidate: (() => {
      const armC = results.armC_shippingCandidate as {
        picks: Array<{ correct: boolean; tileInDrill: boolean }>;
        controlsStillPick: Array<{ correct: boolean }>;
        visualBleed: Array<{ maxChannelDelta: number | null }>;
        frameMsDeltaVsBaseline: number;
      };
      return {
        pickingPreserved: armC.picks.every((entry) => entry.correct),
        tileNeverTakesAClick: armC.picks.every((entry) => !entry.tileInDrill),
        otherTiersUnaffected: armC.controlsStillPick.every((entry) => entry.correct),
        maxVisualBleedChannelDelta: Math.max(...armC.visualBleed.map((entry) => entry.maxChannelDelta ?? 0)),
        frameMsDeltaVsBaseline: armC.frameMsDeltaVsBaseline,
      };
    })(),
  };

  const output = document.querySelector("#spike-results");
  if (output) output.textContent = JSON.stringify(results, null, 1);
}

void run();
