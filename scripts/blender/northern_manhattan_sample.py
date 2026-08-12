"""Blender re-import, measurement and render pass for the Northern-Manhattan sample.

A sibling of `central_upper_manhattan_sample.py`, which stays exactly as it is
and keeps measuring the byte-frozen wave-w04 canary and its promoted successor.
Same division of authority: Blender inspects and measures, the Node writer owns
shipped bytes. Nothing here authors geometry — every asset measured is a GLB that
already shipped, opened read-only.

This wave is textured, so the pass carries the whole class of check the
untextured waves had no use for:

  (d) every asset's measured image count equals its declared texture count, and
      at least one image is present on a wave whose whole premise is that tiles
      ship;
  (e) the imported mesh carries a UV layer and the imported materials reference
      the imported images. An asset can embed a perfectly good PNG, declare it,
      pass every byte gate, and still render flat if nothing samples it — that is
      a defect no checksum can see, and it is exactly what a re-import can.

The other three checks are unchanged from the Midtown-core pass:

  (a) The up-axis-asserting re-import diff, with its Z-up control hypothesis.
  (b) The analytic volume identity, recomputed from the IMPORTED mesh.
  (c) Declared-versus-measured triangle and material counts.

CHECK (b) MATTERS MORE FOR THIS WAVE THAN FOR ANY BEFORE IT, INCLUDING w04. That
wave's census recorded a worst accepted volume deviation of 0.988 of the writer's
tolerance and rejected nothing. This wave's sits HIGHER STILL, and 16 buildings
landed on the other side of the line and were refused outright. A margin that
narrow is exactly where a systematic writer-side error would hide, because the
writer would then be grading its own arithmetic. This pass recomputes the
identity from an INDEPENDENTLY imported mesh, so such an error shows up here as a
disagreement instead of being confirmed by the thing that caused it.

TWO OF THE SAMPLED CELL'S BUILDINGS ARE NOT HERE, AND THAT IS THE SAME FINDING.
The renderable cell owns 86 buildings; 8 were refused at the plan stage and 2 by
the writer's volume check, so 76 shipped and the sample is drawn from those. The
Node sampler records the two writer-refused ids explicitly rather than letting
them vanish, because a sample silently smaller than the shipped set is a sample
nobody can reconcile.

Renders use the same fixed view and camera convention as every pass before it, so
the waves' renders stay comparable by eye.

Nothing here is downloaded and no imagery is read: the tiles are generated from
named constants in this repository, and this pass only ever opens what shipped.

TWO RELEASES OF WAVE w05 TRAVEL THIS PASS. `UDT_W05_VARIANT` selects between the
T021 canary and the T022 promoted P1 successor, and it selects the release id
written into the report as well as the work root the inputs are read from. The
seam was carried forward from the w04 pass with only the canary defined; the p1
variant is what makes it load-bearing. A report that measured one release's assets
while naming another would defeat the Node writer's cross-check against the
committed inventory — the check that makes this pass about shipped bytes at all —
so the two travel together rather than being set independently.

THE p1 SAMPLE IS ALL 24 SHIPPED ASSETS, not a sample of them. The curated cell
owns 24 buildings and the grammar refused none, so the deterministic strata select
every one and the "sample" and the shipped set coincide. That is stated rather
than implied: the paragraph above about two unsampled writer-refused ids is a fact
about the CANARY variant and is not true of p1, which has no refusals at all.
"""


import json
import math
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# WHICH release of wave w05 this pass measures. The release id is written into
# the report and the Node writer cross-checks every measured checksum against
# THAT release's committed payload inventory, so a report naming the wrong
# release fails there rather than being quietly recorded.
VARIANT = os.environ.get("UDT_W05_VARIANT", "canary")
if VARIANT not in ("canary", "p1"):
    raise SystemExit("UDT_W05_VARIANT must be 'canary' or 'p1'")
# The work root and the release id move TOGETHER. Selecting one without the other
# would produce a report about one release's bytes carrying another's name, which
# the Node writer's inventory cross-check would then reject — correctly, and after
# a whole Blender pass had already run.
WORK_DIRECTORY = "northern-manhattan-20260812" if VARIANT == "canary" else "northern-manhattan-20260812-p1"
RELEASE_ID = "manhattan-northern-manhattan-cells-20260812" if VARIANT == "canary" else "manhattan-northern-manhattan-cells-20260812-p1"
WORK_ROOT = os.path.join(ROOT, "artifacts", WORK_DIRECTORY, "blender")
INPUT_DIR = os.path.join(WORK_ROOT, "inputs")
RENDER_DIR = os.path.join(WORK_ROOT, "renders")
REPORT_PATH = os.path.join(WORK_ROOT, "inspection.json")

CAMERA_DIRECTION = (0.78, -0.58, 0.24)
CAMERA_RADIUS_SCALE = 2.6
BOUNDS_TOLERANCE_METERS = 1e-3


def reset_scene():
    for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for item in list(collection):
            collection.remove(item, do_unlink=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0


def _bounds(points):
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return {"min": minimum, "max": maximum}


def signed_volume(mesh):
    """Divergence theorem over the imported triangulated faces.

    Positive means outward-consistent normals; agreement with the analytic
    volume means the surface is closed.
    """
    total = 0.0
    for polygon in mesh.polygons:
        vertices = [mesh.vertices[index].co for index in polygon.vertices]
        for index in range(1, len(vertices) - 1):
            a, b, c = vertices[0], vertices[index], vertices[index + 1]
            total += (
                a[0] * (b[1] * c[2] - b[2] * c[1])
                - a[1] * (b[0] * c[2] - b[2] * c[0])
                + a[2] * (b[0] * c[1] - b[1] * c[0])
            )
    return total / 6.0


def triangle_count(mesh):
    return sum(max(0, len(polygon.vertices) - 2) for polygon in mesh.polygons)


def setup_render():
    scene = bpy.context.scene
    # Engine identifiers moved across Blender versions, so the first available
    # real-time engine is selected rather than one being hard-coded.
    available = {item.identifier for item in type(scene.render).bl_rna.properties["engine"].enum_items}
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        if candidate in available:
            scene.render.engine = candidate
            break
    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("udt_northern_manhattan_sample_world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.68, 0.76, 1.0)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 1.4


def place_camera_and_light(bounds, name):
    center = [(bounds["min"][axis] + bounds["max"][axis]) / 2.0 for axis in range(3)]
    radius = max(
        math.sqrt(sum(((bounds["max"][axis] - bounds["min"][axis]) / 2.0) ** 2 for axis in range(3))),
        1.0,
    )
    length = math.sqrt(sum(component * component for component in CAMERA_DIRECTION))
    direction = [component / length for component in CAMERA_DIRECTION]
    # T013's scale, plus a floor that guarantees the whole bounding sphere is in
    # frame. The scale alone crops a 200 m tower whose diagonal exceeds the
    # frustum width at 2.6x its own radius, and a cropped render is weaker
    # evidence than a smaller one. The floor only ever pushes the camera BACK,
    # so every sample T013's scale already framed keeps that framing exactly.
    scene = bpy.context.scene
    camera_data_probe = bpy.data.cameras.new(name + "_probe")
    half_fov = math.atan(camera_data_probe.sensor_width / (2.0 * camera_data_probe.lens))
    aspect = scene.render.resolution_y / scene.render.resolution_x
    half_fov = min(half_fov, math.atan(math.tan(half_fov) * aspect)) if aspect < 1.0 else half_fov
    bpy.data.cameras.remove(camera_data_probe, do_unlink=True)
    fit_distance = radius / math.sin(half_fov)
    distance = max(radius * CAMERA_RADIUS_SCALE, fit_distance)

    camera_data = bpy.data.cameras.new(name + "_camera")
    camera = bpy.data.objects.new(name + "_camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = tuple(center[axis] + direction[axis] * distance for axis in range(3))

    target = bpy.data.objects.new(name + "_target", None)
    bpy.context.scene.collection.objects.link(target)
    target.location = tuple(center)
    track = camera.constraints.new(type="TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    light_data = bpy.data.lights.new(name + "_sun", type="SUN")
    light_data.energy = 3.0
    light = bpy.data.objects.new(name + "_sun", light_data)
    bpy.context.scene.collection.objects.link(light)
    light.location = tuple(center[axis] + direction[axis] * distance for axis in range(3))
    light.rotation_euler = (math.radians(52.0), 0.0, math.radians(38.0))

    bpy.context.scene.camera = camera
    return center, radius


def inspect(entry):
    reset_scene()
    setup_render()
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=entry["assetPath"])
    imported = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
    if not imported:
        raise RuntimeError("No mesh imported for " + entry["buildingId"])

    world_points = []
    triangles = 0
    materials = set()
    uv_layer_count = 0
    image_bound_materials = set()
    referenced_images = set()
    volume = 0.0
    for obj in imported:
        mesh = obj.data
        triangles += triangle_count(mesh)
        uv_layer_count = max(uv_layer_count, len(mesh.uv_layers))
        for slot in obj.material_slots:
            if slot.material is None:
                continue
            materials.add(slot.material.name)
            # A material that samples nothing renders flat however good the
            # embedded PNG is, so the binding is walked rather than assumed.
            if not slot.material.use_nodes:
                continue
            for node in slot.material.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image is not None:
                    image_bound_materials.add(slot.material.name)
                    referenced_images.add(node.image.name)
        # Volume is taken in the imported frame. The Y-up-to-Z-up map is a
        # rotation with determinant +1, so the signed volume is invariant under
        # it and can be compared with the writer's number directly.
        volume += signed_volume(mesh)
        for vertex in mesh.vertices:
            world_points.append(obj.matrix_world @ vertex.co)

    # Counted HERE, before rendering: `bpy.ops.render.render` adds a "Render
    # Result" datablock to `bpy.data.images`, and counting afterwards would
    # report one embedded image per sample for assets that embed none.
    embedded_images = len(bpy.data.images)

    imported_bounds = _bounds(world_points)
    # Imported (X, Y, Z) came from file (x, y, z) as (x, -z, y), so the inverse
    # map back into the shipped Y-up frame is (X, Z, -Y).
    y_up_points = [(point[0], point[2], -point[1]) for point in world_points]
    y_up_bounds = _bounds(y_up_points)
    declared = entry["declaredBoundsYUp"]
    deviation = max(
        abs(y_up_bounds["min"][axis] - declared["minimum"][axis]) for axis in range(3)
    )
    deviation = max(deviation, max(abs(y_up_bounds["max"][axis] - declared["maximum"][axis]) for axis in range(3)))
    # Control hypothesis: pretend the file was authored Z-up and no remap is
    # needed. If this were also ~0 the diff would be measuring nothing.
    z_up_bounds = _bounds(world_points)
    control = max(abs(z_up_bounds["min"][axis] - declared["minimum"][axis]) for axis in range(3))
    control = max(control, max(abs(z_up_bounds["max"][axis] - declared["maximum"][axis]) for axis in range(3)))

    analytic = entry["analyticVolumeCubicMeters"]
    volume_deviation = abs(volume - analytic) / abs(analytic) if analytic else float("inf")

    center, radius = place_camera_and_light(imported_bounds, entry["buildingId"].replace(":", "-"))
    render_name = entry["buildingId"].replace(":", "-") + ".png"
    bpy.context.scene.render.filepath = os.path.join(RENDER_DIR, render_name)
    bpy.ops.render.render(write_still=True)

    return {
        "buildingId": entry["buildingId"],
        "stratum": entry["stratum"],
        "planHashSha256": entry["planHashSha256"],
        "checksumSha256": entry["checksumSha256"],
        "importedObjects": len(imported),
        "declaredTriangleCount": entry["declared"]["triangleCount"],
        "measuredTriangleCount": triangles,
        "triangleDelta": triangles - entry["declared"]["triangleCount"],
        "declaredMaterialCount": entry["declared"]["materialCount"],
        "measuredMaterialCount": len(materials),
        "declaredTextureCount": entry["declared"]["textureCount"],
        "measuredImageCount": embedded_images,
        "imageCountMatchesDeclared": embedded_images == entry["declared"]["textureCount"],
        "uvLayerCount": uv_layer_count,
        "imageBoundMaterialCount": len(image_bound_materials),
        "referencedImageCount": len(referenced_images),
        # The whole point of the wave: an embedded tile that is actually sampled.
        "texturesReachable": (
            entry["declared"]["textureCount"] == 0
            or (uv_layer_count > 0 and len(image_bound_materials) > 0 and len(referenced_images) == embedded_images)
        ),
        "boundsDeviationMeters": deviation,
        "zUpControlDeviationMeters": control,
        "boundsWithinTolerance": deviation <= BOUNDS_TOLERANCE_METERS,
        "measuredVolumeCubicMeters": volume,
        "analyticVolumeCubicMeters": analytic,
        "volumeDeviation": volume_deviation,
        "boundsASolid": volume_deviation < entry["volumeTolerance"] and volume > 0.0,
        "setbacksAbsent": entry["setbacksAbsent"],
        "effectiveTierCount": entry["effectiveTierCount"],
        "renderRelativeRef": "renders/" + render_name,
        "renderBoundingSphereRadiusMeters": radius,
        "renderCenter": center,
    }


def run():
    os.makedirs(RENDER_DIR, exist_ok=True)
    entries = []
    for name in sorted(os.listdir(INPUT_DIR)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(INPUT_DIR, name), "r", encoding="utf-8") as handle:
            entries.append(json.load(handle))

    samples = [inspect(entry) for entry in entries]
    report = {
        "schemaVersion": "1.0",
        "releaseId": RELEASE_ID,
        "scene": "udt_t021_northern_manhattan_sample",
        "sampleCount": len(samples),
        "tierCollapseSampleCount": sum(1 for sample in samples if sample["setbacksAbsent"]),
        "maximumTriangleDelta": max((abs(sample["triangleDelta"]) for sample in samples), default=0),
        "materialMismatchCount": sum(1 for sample in samples if sample["measuredMaterialCount"] != sample["declaredMaterialCount"]),
        "maximumBoundsDeviationMeters": max((sample["boundsDeviationMeters"] for sample in samples), default=0.0),
        "minimumZUpControlDeviationMeters": min((sample["zUpControlDeviationMeters"] for sample in samples), default=0.0),
        "maximumVolumeDeviation": max((sample["volumeDeviation"] for sample in samples), default=0.0),
        "notSolidCount": sum(1 for sample in samples if not sample["boundsASolid"]),
        "embeddedImageCount": sum(sample["measuredImageCount"] for sample in samples),
        "texturedSampleCount": sum(1 for sample in samples if sample["measuredImageCount"] > 0),
        "imageCountMismatchCount": sum(1 for sample in samples if not sample["imageCountMatchesDeclared"]),
        "texturesUnreachableCount": sum(1 for sample in samples if not sample["texturesReachable"]),
        "minimumUvLayerCount": min((sample["uvLayerCount"] for sample in samples), default=0),
        "boundsWithinToleranceCount": sum(1 for sample in samples if sample["boundsWithinTolerance"]),
        "totalReimportedTriangles": sum(sample["measuredTriangleCount"] for sample in samples),
        "samples": samples,
    }
    with open(REPORT_PATH, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    return report


RESULT = run()
print(json.dumps({key: value for key, value in RESULT.items() if key != "samples"}, indent=2))
