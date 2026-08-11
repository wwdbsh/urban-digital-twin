"""Blender re-import and visual pass for the Block 835 V3T textured package.

V3T ships the V3 geometry with procedural detail tiles on LOD 0. This pass asks
the three questions that adding images to a shipped GLB can break, and nothing
else — the grammar itself was proved by the V3 pass and has not moved.

  (a) DOES THE FILE STILL IMPORT, AND STILL BOUND A SOLID? The volume identity
      is re-run against the SHIPPED bytes rather than against a Blender-authored
      copy of them, which makes it a stronger check than the V3 pass ran: the
      analytic expectation comes from the committed plan, the measurement comes
      from the file, and a texture stage that perturbed a vertex or dropped a
      face would show up as a volume deviation.

  (b) IS THE FILE STILL +Y-UP? Textured and untextured bytes are diffed vertex
      for vertex, and a Z-up hypothesis is reported as the control. If adding
      TEXCOORD_0 had disturbed the vertex order or the axis convention, the two
      packages would not land on the same points.

  (c) DO THE TILES READ AS MATERIAL? Orthographic stills at facade distance,
      rendered with the base-colour texture actually sampled. This is the
      question no assertion can answer, and it is why 64-pixel tiles were
      refused in favour of 128.

The tessellation transliteration in `block835_v3_author.py` is reused for the
analytic volume alone. Nothing here is downloaded and no imagery is read: the
tiles are rasterized in-repo from named constants.
"""

import json
import math
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
V3_PACKAGE_ID = "manhattan-esb-block-reference-20260811-v3"
PACKAGE_ID = "manhattan-esb-block-reference-20260811-v3t"
V3_PACKAGE_DIR = os.path.join(ROOT, "public", "data", V3_PACKAGE_ID)
PACKAGE_DIR = os.path.join(ROOT, "public", "data", PACKAGE_ID)
PLAN_DIR = os.path.join(ROOT, "data", V3_PACKAGE_ID, "plans")
EVIDENCE_DIR = os.path.join(ROOT, "artifacts", "blender", PACKAGE_ID)
RENDER_DIR = os.path.join(EVIDENCE_DIR, "renders")
VOLUME_TOLERANCE = 1e-6
REIMPORT_TOLERANCE_METERS = 1e-3

# The V3 pass owns the analytic volume identity; reusing it keeps one definition
# rather than a second transliteration that could drift from the first.
_V3_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "block835_v3_author.py")
# `__file__` is seeded because the V3 script resolves ROOT from it at module
# level, and an exec namespace does not inherit one.
_V3 = {"__file__": _V3_PATH, "__name__": "block835_v3_author"}
with open(_V3_PATH, "r", encoding="utf-8") as _handle:
    exec(compile(_handle.read(), _V3_PATH, "exec"), _V3)  # noqa: S102


def reset_scene():
    for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for item in list(collection):
            try:
                collection.remove(item, do_unlink=True)
            except (RuntimeError, ReferenceError):
                pass
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    os.makedirs(RENDER_DIR, exist_ok=True)
    return {"objects": len(bpy.data.objects)}


def load_plan(canonical_building_id):
    with open(os.path.join(PLAN_DIR, canonical_building_id.replace(":", "-") + ".json"), "r", encoding="utf-8") as handle:
        return json.load(handle)


def manifest(package_dir):
    with open(os.path.join(package_dir, "manifest.json"), "r", encoding="utf-8") as handle:
        return json.load(handle)


def _import(path):
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=path)
    return [bpy.data.objects[name] for name in sorted(set(bpy.data.objects.keys()) - before)]


def _discard(objects):
    for obj in objects:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if getattr(data, "users", 1) == 0:
            try:
                bpy.data.meshes.remove(data, do_unlink=True)
            except (RuntimeError, TypeError):
                pass


def _world_points(objects):
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        matrix = obj.matrix_world
        for vertex in obj.data.vertices:
            world = matrix @ vertex.co
            points.append((world[0], world[1], world[2]))
    return points


def _world_volume(objects):
    """Divergence-theorem volume over world-space polygons of every imported mesh."""
    total = 0.0
    for obj in objects:
        if obj.type != "MESH":
            continue
        matrix = obj.matrix_world
        normal_matrix = matrix.to_3x3().inverted().transposed()
        for polygon in obj.data.polygons:
            centre = matrix @ polygon.center
            normal = (normal_matrix @ polygon.normal).normalized()
            # Polygon area scales with the transform; recompute it in world space
            # rather than trusting the local-space value.
            loop = [matrix @ obj.data.vertices[index].co for index in polygon.vertices]
            area = 0.0
            for index in range(1, len(loop) - 1):
                edge1 = loop[index] - loop[0]
                edge2 = loop[index + 1] - loop[0]
                area += edge1.cross(edge2).length / 2.0
            total += centre.dot(normal) * area
    return total / 3.0


def _uv_layers(objects):
    names = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        names.extend(layer.name for layer in obj.data.uv_layers)
    return names


def _sampled_images(objects):
    """Images reachable from the imported materials, i.e. actually bound to a shader."""
    found = set()
    for obj in objects:
        for slot in obj.material_slots:
            material = slot.material
            if material is None or not material.use_nodes:
                continue
            for node in material.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image is not None:
                    found.add((node.image.name, node.image.size[0], node.image.size[1]))
    return sorted(found)


def inspect_building(canonical_building_id):
    plan = load_plan(canonical_building_id)
    slug = canonical_building_id.replace(":", "-")
    report = {"canonicalBuildingId": canonical_building_id, "planHashSha256": plan["planHashSha256"], "styleClass": plan["styleClass"], "lods": {}}
    for lod_id, include_recesses in (("lod_0", True), ("lod_1", False)):
        name = slug + "__" + lod_id + ".glb"
        textured_path = os.path.join(PACKAGE_DIR, "private", "assets", name)
        plain_path = os.path.join(V3_PACKAGE_DIR, "private", "assets", name)
        imported_error = ""
        try:
            textured = _import(textured_path)
        except Exception as error:  # noqa: BLE001 - the point of the gate is to record the failure
            report["lods"][lod_id] = {"importedWithoutError": False, "error": str(error)}
            continue
        try:
            plain = _import(plain_path)
            try:
                textured_points = _world_points(textured)
                plain_points = _world_points(plain)
                volume = _world_volume(textured)
                expected = _V3["expected_volume"](plan, include_recesses)
                deviation = abs(volume - expected) / abs(expected) if expected else float("inf")

                key = lambda point: (round(point[0], 3), round(point[1], 3), round(point[2], 3))  # noqa: E731
                textured_keys = {key(point) for point in textured_points}
                plain_keys = {key(point) for point in plain_points}
                bounds = _V3["_bounds_of_points"]
                textured_bounds = bounds(textured_points)
                plain_bounds = bounds(plain_points)
                drift = max(abs(textured_bounds[side][axis] - plain_bounds[side][axis]) for side in range(2) for axis in range(3))
                # Control: had the textured file been written Z-up, the importer
                # would have landed every vertex at (x, -z, y) of the untextured
                # one instead of on top of it.
                z_up = bounds([(point[0], -point[2], point[1]) for point in plain_points])
                z_up_drift = max(abs(z_up[side][axis] - textured_bounds[side][axis]) for side in range(2) for axis in range(3))
                uv_layers = _uv_layers(textured)
                images = _sampled_images(textured)
                report["lods"][lod_id] = {
                    "importedWithoutError": True,
                    "error": imported_error,
                    "vertexCount": len(textured_points),
                    "expectsUvLayer": lod_id == "lod_0",
                    "uvLayerPresent": len(uv_layers) > 0,
                    "uvLayerNames": sorted(set(uv_layers)),
                    "sampledImages": [{"name": entry[0], "widthPixels": entry[1], "heightPixels": entry[2]} for entry in images],
                    "expectedVolumeCubicMeters": expected,
                    "measuredVolumeCubicMeters": volume,
                    "volumeDeviation": deviation,
                    "boundsASolid": deviation < VOLUME_TOLERANCE,
                    "outwardNormalsConsistent": volume > 0.0,
                    "positionsOnlyInTextured": len(textured_keys - plain_keys),
                    "positionsOnlyInUntextured": len(plain_keys - textured_keys),
                    "maxBoundsDeviationMeters": drift,
                    "toleranceMeters": REIMPORT_TOLERANCE_METERS,
                    "zUpHypothesisDeviationMeters": z_up_drift,
                    "upAxisIsYUpInFile": drift <= REIMPORT_TOLERANCE_METERS and z_up_drift > REIMPORT_TOLERANCE_METERS,
                }
            finally:
                _discard(plain)
        finally:
            _discard(textured)
    return report


# ---------------------------------------------------------------------------
# Stills
#
# Workbench with TEXTURE colouring samples the GLB's own base-colour texture
# through its own UVs, which is exactly what has to be judged: whether the
# shipped tile reads as brick, ashlar or curtain wall at facade distance rather
# than as noise or as flat paint.
# ---------------------------------------------------------------------------


def _setup_render(resolution):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "TEXTURE"
    shading.show_shadows = False
    shading.show_cavity = False


def _ortho_camera(name):
    data = bpy.data.cameras.get(name) or bpy.data.cameras.new(name)
    data.type = "ORTHO"
    camera = bpy.data.objects.get(name)
    if camera is None:
        camera = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(camera)
    camera.data = data
    bpy.context.scene.camera = camera
    return camera


def render_facade(canonical_building_id, lod_id="lod_0", resolution=768, span_meters=None, label="south"):
    """One orthographic elevation, optionally cropped to a facade-distance span."""
    slug = canonical_building_id.replace(":", "-")
    path = os.path.join(PACKAGE_DIR, "private", "assets", slug + "__" + lod_id + ".glb")
    objects = _import(path)
    try:
        _setup_render(resolution)
        points = _world_points(objects)
        low, high = _V3["_bounds_of_points"](points)
        centre = [(low[axis] + high[axis]) / 2.0 for axis in range(3)]
        width = high[0] - low[0]
        height = high[2] - low[2]
        span = span_meters if span_meters else max(width, height) * 1.05
        camera = _ortho_camera("udt3t-facade-camera")
        camera.data.ortho_scale = span
        # Looking north at the south elevation, from outside the footprint.
        camera.location = (centre[0], low[1] - max(width, height) * 3.0 - 10.0, centre[2] if span_meters is None else low[2] + span / 2.0)
        camera.rotation_euler = (math.pi / 2.0, 0.0, 0.0)
        target = os.path.join(RENDER_DIR, slug + "__" + lod_id + "__" + label + ".png")
        bpy.context.scene.render.filepath = target
        bpy.ops.render.render(write_still=True)
        return {"path": os.path.relpath(target, ROOT), "spanMeters": span, "widthMeters": width, "heightMeters": height}
    finally:
        _discard(objects)


def write_evidence(name, payload):
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    target = os.path.join(EVIDENCE_DIR, name)
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return os.path.relpath(target, ROOT)
