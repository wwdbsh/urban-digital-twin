/**
 * The PINNED far-tier appearance instrument.
 *
 * WHY THIS FILE EXISTS. Three sessions measured the same byte-identical tile and
 * disagreed by up to 6%, and two of T002's headline verdicts failed to
 * reproduce. The instrument that produced them was specified in prose, in a
 * record field, listing seven settings. Blender exposes far more than seven
 * that move a pixel, and the ones it does not list are exactly the ones that
 * drifted. An instrument whose verdicts depend on unlisted state is not an
 * instrument; it is a mood.
 *
 * So the spec below is EXHAUSTIVE over the settings that can move a reading,
 * it is the single source of truth, and the capture harness is GENERATED from
 * it — `farTierInstrumentAssertionPython()` emits code that reads every value
 * back out of Blender and fails closed on any mismatch. Spec and harness cannot
 * drift because there is only one of them.
 *
 * WHAT IS DELIBERATELY PINNED OFF. Ray tracing and fast GI are disabled. Both
 * were measured across a full six-pose A/B and moved ratios by about 0.4% and
 * hue spreads by about 0.001 without flipping a single verdict — so nothing is
 * lost by removing them, and a whole class of screen-space, view-dependent,
 * denoiser-mediated variance goes with them.
 *
 * WHAT NOBODY PINNED BEFORE AND SHOULD HAVE. `anisotropic_filter` and
 * `gl_texture_limit` are USER PREFERENCES, not scene settings. They survive
 * file loads, they differ between machines and installs, and they act on
 * minified textures — which is precisely the far tier's condition at 1.2 km and
 * 4 km. They were never in any prior instrument description.
 */

import { sha256HexSync, stableSerialize } from "../domain/deterministic-hash.ts";

export const FAR_TIER_INSTRUMENT_SPEC = {
  specId: "far-tier-appearance-instrument-v1",

  /**
   * Blender itself. A minor version can change EEVEE's shading; the version is
   * part of the instrument, not part of the environment.
   */
  application: { versionString: "5.2.0 LTS" },

  /**
   * RECORDED, NOT PINNED. These describe the machine rather than the
   * instrument. Pinning them would make the spec unsatisfiable elsewhere; not
   * recording them would leave a reader unable to tell whether a future
   * disagreement is a settings drift or a hardware one.
   */
  recordedEnvironment: { gpuBackend: "METAL", preferencesGpuBackend: "METAL" },

  /**
   * USER PREFERENCES. Not scene state — they persist across files and sessions
   * and differ between installs, which is what makes them dangerous.
   *
   * `anisotropic_filter` is set to FILTER_0 — anisotropy off, the enum's floor;
   * there is no FILTER_1 — rather than left at whatever the
   * install carries. Anisotropy changes how a minified texture is sampled at
   * grazing angles, and every far-tier pose is oblique by design (elevation 18
   * degrees) with a heavily minified atlas. Leaving it unpinned makes the
   * reading a property of the workstation.
   *
   * `gl_texture_limit` downsamples textures wholesale when not CLAMP_OFF. On an
   * install with a limit set, the 256px atlas would be sampled at a lower
   * resolution and the tile would read differently for reasons having nothing
   * to do with the tile.
   */
  preferences: {
    "system.anisotropic_filter": "FILTER_0",
    "system.gl_texture_limit": "CLAMP_OFF",
    "system.use_gpu_subdivision": false,
  },

  render: {
    engine: "BLENDER_EEVEE",
    resolution_x: 1440,
    resolution_y: 900,
    resolution_percentage: 100,
    pixel_aspect_x: 1.0,
    pixel_aspect_y: 1.0,
    /** Reconstruction filter width in pixels. Changes edge pixels, so it is pinned. */
    filter_size: 1.5,
    film_transparent: true,
    use_motion_blur: false,
    use_border: false,
    /** Inert for float output, pinned to zero so it cannot become relevant unnoticed. */
    dither_intensity: 0.0,
    use_persistent_data: false,
  },

  imageSettings: {
    file_format: "OPEN_EXR",
    color_mode: "RGBA",
    color_depth: "32",
    exr_codec: "ZIP",
  },

  /**
   * COLOUR MANAGEMENT. T002 pinned the view transform and nothing else. `look`,
   * `exposure` and `gamma` all scale the framebuffer, and `display_device` and
   * the sequencer colour space decide how values are interpreted on the way in
   * and out.
   */
  colourManagement: {
    "view_settings.view_transform": "Standard",
    "view_settings.look": "None",
    "view_settings.exposure": 0.0,
    "view_settings.gamma": 1.0,
    "view_settings.use_curve_mapping": false,
    "display_settings.display_device": "sRGB",
    "sequencer_colorspace_settings.name": "sRGB",
  },

  eevee: {
    taa_render_samples: 64,
    /** OFF. Measured verdict-neutral, and removes screen-space and denoiser variance. */
    use_raytracing: false,
    use_fast_gi: false,
    use_shadows: true,
    shadow_ray_count: 1,
    shadow_step_count: 6,
    shadow_resolution_scale: 1.0,
    use_volumetric_shadows: false,
    use_overscan: false,
    light_threshold: 0.01,
    clamp_surface_direct: 0.0,
  },

  /**
   * SCENE-GRAPH AND PIPELINE STATE. None of these moved a reading here — every
   * one was already at its Blender default during the baseline session, which
   * is verified rather than assumed (see the spec-lineage record). They are
   * pinned because each can silently rescale or reroute the output, and the
   * whole lesson of this task is that the settings nobody lists are the ones
   * that drift.
   *
   * `use_white_balance` deserves its own note: it is a per-channel scaling
   * control, which is the exact shape of the open red-deficit hue finding. It
   * was OFF during the baseline. Had it been on, the hue result would have been
   * suspect. It is now pinned off so that can never be ambiguous again.
   */
  sceneGraph: {
    // Paths are relative to `bpy.context.scene`, which is what the generator emits against.
    "use_nodes": true,
    "frame_current": 1,
    "render.use_compositing": true,
    "render.use_sequencer": true,
    "render.use_simplify": false,
    "render.use_freestyle": false,
    "view_settings.use_white_balance": false,
    "world.use_nodes": true,
  },

  camera: {
    type: "PERSP",
    useDepthOfField: false,
    sensor_fit: "VERTICAL",
    angle_y_degrees: 60.0,
    clip_start: 1.0,
    clip_end: 60000.0,
    shift_x: 0.0,
    shift_y: 0.0,
  },

  sun: {
    type: "SUN",
    energy: 3.0,
    /** Angular diameter zero: a point sun casts a hard, sample-count-independent shadow. */
    angle: 0.0,
    rotation_euler_degrees: [50.0, 0.0, 35.0],
    color: [1.0, 1.0, 1.0],
  },

  world: {
    background_strength: 0.0,
    background_color: [0.0, 0.0, 0.0],
  },

  /** Not a Blender setting, but part of the measurement and equally able to drift. */
  maskSemantics: {
    rule: "A pixel is covered when its alpha exceeds 0.5.",
    union: "Union of the SOURCE and BAKED silhouettes, computed per pose within the same session.",
    luminance: "Rec. 709 on the linear framebuffer: 0.2126 R + 0.7152 G + 0.0722 B.",
    unPremultiply: "Per-channel ratios divide by that subject's own alpha before averaging; the union luminance ratio does not.",
  },

  poses: {
    distancesMeters: [400, 1_200, 4_000],
    azimuthsDegrees: [55, 235],
    elevationDegrees: 18,
    cameraDiscipline: "One transform per pose, computed from the SOURCE subject's bounds and reused verbatim for every other subject.",
  },

  sceneHygiene: {
    clearing: "Objects deleted and datablocks purged. bpy.ops.wm.read_factory_settings is NEVER called: it unregisters the BlenderMCP addon.",
    betweenSubjects: "Meshes, materials and images purged between subjects, so datablock accumulation cannot bind a subject to a stale material.",

    /**
     * SUBJECT ISOLATION. THIS IS THE ONE THAT CAUSED EVERYTHING.
     *
     * A subject is rendered ALONE. Every other subject is DELETED from the
     * scene, or at minimum its collection is excluded from the view layer.
     * `hide_render` is NOT sufficient and is forbidden.
     *
     * Measured, not asserted. On the prototype cell at 1,200 m / azimuth 235,
     * the same byte-identical tile reads:
     *
     *   both subjects resident, other hidden by hide_render  ratio 1.072801
     *   hidden subject additionally not casting shadows       ratio 1.088509
     *   other subject's collection excluded from view layer   ratio 1.002152
     *   other subject deleted                                 ratio 1.002152
     *
     * SCENE RESIDENCY MOVES THE READING BY +7.0%. That B (1.088509) exceeds A
     * (1.072801) shows the hidden subject was casting shadows onto the measured
     * one. Beyond that, the MECHANISM IS NOT TRACED into EEVEE's internals —
     * and with ray tracing and fast GI off and the world at strength zero there
     * is no indirect-light path that would obviously explain the remainder. The
     * effect is measured, bounded and eliminated; it is not explained.
     *
     * The first reading is T002's committed 1.072801 reproduced to six
     * decimals, which is what identifies its MISS as an artifact of the
     * arrangement rather than a property of the tile.
     */
    subjectIsolation: "A subject is rendered ALONE. Other subjects are deleted, or their collection is excluded from the view layer. `hide_render` is FORBIDDEN: scene residency moves the reading by 7.0% on the prototype cell at 1,200 m / azimuth 235, and hidden subjects demonstrably cast shadows onto the measured one. ENFORCED by the harness: no mesh in the view layer may carry hide_render, and the caller-supplied renderable-mesh count must match.",
  },
} as const;

export function farTierInstrumentSpecHash(): string {
  return sha256HexSync(stableSerialize(FAR_TIER_INSTRUMENT_SPEC));
}

/**
 * Generate the read-back-and-assert preamble the capture must run.
 *
 * GENERATED, NOT WRITTEN BESIDE THE SPEC. A hand-kept assertion list is a
 * second source of truth and would drift from the first — which is the whole
 * failure this file exists to end. Every pinned value below appears in the
 * emitted Python because it appears in the spec, and for no other reason.
 *
 * The emitted code READS every value back out of Blender and fails closed on
 * any mismatch, because setting a property Blender silently ignores or coerces
 * is indistinguishable from setting it correctly until something is measured.
 *
 * ANGULAR TOLERANCES ARE 1e-4 DEGREES, not 1e-9. Angles are stored in radians
 * and compared in degrees, so a round trip lands about 1.7e-6 degrees off 60 —
 * which the first version of this harness duly refused. 1e-4 degrees is 0.36
 * arcseconds and cannot move a pixel at any pose; everything else stays at 1e-9
 * or exact.
 */
/** Python literal for a pinned value. `JSON.stringify` emits JS booleans, which Python rejects. */
function pyLiteral(value: unknown): string {
  if (typeof value === "boolean") return value ? "True" : "False";
  return JSON.stringify(value);
}

export function farTierInstrumentAssertionPython(): string {
  const spec = FAR_TIER_INSTRUMENT_SPEC;
  const lines: string[] = [
    "import bpy, math, json",
    "_mismatch = []",
    "def _check(label, actual, expected, tol=None):",
    "    ok = (abs(actual - expected) <= tol) if (tol is not None and isinstance(actual, (int, float)) and not isinstance(actual, bool)) else (actual == expected)",
    "    if not ok: _mismatch.append({'setting': label, 'expected': expected, 'actual': actual})",
    "_scene = bpy.context.scene",
    "_prefs = bpy.context.preferences",
    "# Caller sets _EXPECTED_RENDERABLE_MESHES before exec to enforce subject isolation by count.",
    "_EXPECTED_RENDERABLE_MESHES = globals().get('_EXPECTED_RENDERABLE_MESHES', None)",
  ];

  for (const [key, value] of Object.entries(spec.preferences)) {
    lines.push(`_check(${JSON.stringify(`preferences.${key}`)}, _prefs.${key}, ${pyLiteral(value)})`);
  }
  for (const [key, value] of Object.entries(spec.render)) {
    lines.push(`_check(${JSON.stringify(`render.${key}`)}, _scene.render.${key}, ${pyLiteral(value)}${typeof value === "number" ? ", 1e-9" : ""})`);
  }
  for (const [key, value] of Object.entries(spec.imageSettings)) {
    lines.push(`_check(${JSON.stringify(`image_settings.${key}`)}, _scene.render.image_settings.${key}, ${pyLiteral(value)})`);
  }
  for (const [key, value] of Object.entries(spec.colourManagement)) {
    lines.push(`_check(${JSON.stringify(`colour.${key}`)}, _scene.${key}, ${pyLiteral(value)}${typeof value === "number" ? ", 1e-9" : ""})`);
  }
  for (const [key, value] of Object.entries(spec.eevee)) {
    lines.push(`_check(${JSON.stringify(`eevee.${key}`)}, _scene.eevee.${key}, ${pyLiteral(value)}${typeof value === "number" ? ", 1e-9" : ""})`);
  }
  lines.push(
    `_check("application.versionString", bpy.app.version_string, ${pyLiteral(spec.application.versionString)})`,
  );
  for (const [key, value] of Object.entries(spec.sceneGraph)) {
    lines.push(`_check(${JSON.stringify(`sceneGraph.${key}`)}, _scene.${key}, ${pyLiteral(value)})`);
  }
  lines.push(
    "_cam = _scene.camera.data",
    `_check("camera.type", _cam.type, ${pyLiteral(spec.camera.type)})`,
    `_check("camera.dof.use_dof", _cam.dof.use_dof, ${pyLiteral(spec.camera.useDepthOfField)})`,
    `_check("camera.sensor_fit", _cam.sensor_fit, ${pyLiteral(spec.camera.sensor_fit)})`,
    `_check("camera.angle_y_degrees", math.degrees(_cam.angle_y), ${spec.camera.angle_y_degrees}, 1e-4)`,
    `_check("camera.clip_start", _cam.clip_start, ${spec.camera.clip_start}, 1e-9)`,
    `_check("camera.clip_end", _cam.clip_end, ${spec.camera.clip_end}, 1e-9)`,
    `_check("camera.shift_x", _cam.shift_x, ${spec.camera.shift_x}, 1e-9)`,
    `_check("camera.shift_y", _cam.shift_y, ${spec.camera.shift_y}, 1e-9)`,
    "_suns = [o for o in bpy.data.objects if o.type == 'LIGHT' and o.data.type == 'SUN']",
    "if len(_suns) != 1: _mismatch.append({'setting': 'sun.count', 'expected': 1, 'actual': len(_suns)})",
    "else:",
    "    _s = _suns[0]",
    `    _check("sun.energy", _s.data.energy, ${spec.sun.energy}, 1e-9)`,
    `    _check("sun.angle", _s.data.angle, ${spec.sun.angle}, 1e-9)`,
    `    _check("sun.rotation_x_deg", math.degrees(_s.rotation_euler[0]), ${spec.sun.rotation_euler_degrees[0]}, 1e-4)`,
    `    _check("sun.rotation_y_deg", math.degrees(_s.rotation_euler[1]), ${spec.sun.rotation_euler_degrees[1]}, 1e-4)`,
    `    _check("sun.rotation_z_deg", math.degrees(_s.rotation_euler[2]), ${spec.sun.rotation_euler_degrees[2]}, 1e-4)`,
    ...spec.sun.color.map((component, index) =>
      `    _check("sun.color[${index}]", _s.data.color[${index}], ${component}, 1e-9)`),
    // A missing Background node is a mismatch to be RECORDED, not a KeyError
    // that aborts the harness before the remaining checks run.
    "_bg = _scene.world.node_tree.nodes.get('Background') if _scene.world and _scene.world.use_nodes else None",
    "if _bg is None:",
    "    _mismatch.append({'setting': 'world.background_node', 'expected': 'present', 'actual': 'absent'})",
    "else:",
    `    _check("world.background_strength", _bg.inputs[1].default_value, ${spec.world.background_strength}, 1e-9)`,
    ...spec.world.background_color.map((component, index) =>
      `    _check("world.background_color[${index}]", _bg.inputs[0].default_value[${index}], ${component}, 1e-9)`),
    "_lights = [o for o in bpy.data.objects if o.type == 'LIGHT']",
    "if len(_lights) != 1: _mismatch.append({'setting': 'lights.total', 'expected': 1, 'actual': len(_lights)})",
    // SUBJECT ISOLATION, ENFORCED. `hide_render` was the entire divergence, so
    // its absence is asserted rather than described. The caller states how many
    // renderable meshes the subject should have; a stale subject left in the
    // scene changes that count and is refused.
    "_hidden = [o.name for o in bpy.context.view_layer.objects if o.type == 'MESH' and o.hide_render]",
    "if _hidden:",
    "    _mismatch.append({'setting': 'sceneHygiene.subjectIsolation', 'expected': 'no hide_render mesh in the view layer', 'actual': _hidden[:8]})",
    "_renderable = [o for o in bpy.context.view_layer.objects if o.type == 'MESH' and not o.hide_render]",
    "if _EXPECTED_RENDERABLE_MESHES is not None and len(_renderable) != _EXPECTED_RENDERABLE_MESHES:",
    "    _mismatch.append({'setting': 'sceneHygiene.renderableMeshCount', 'expected': _EXPECTED_RENDERABLE_MESHES, 'actual': len(_renderable)})",
    "if _mismatch:",
    "    raise RuntimeError('PINNED INSTRUMENT MISMATCH: ' + json.dumps(_mismatch))",
    `_ENFORCED = ${JSON.stringify({ specId: spec.specId, specSha256: "__SPEC_HASH__" })}`,
  );
  return lines.join("\n").replace("__SPEC_HASH__", farTierInstrumentSpecHash());
}
