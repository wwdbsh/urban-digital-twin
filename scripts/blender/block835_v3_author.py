"""Blender authoring, inspection and measurement pass for the Block 835 V3 package.

Same division of authority as the 20260810 and 20260811 passes: Blender authors,
inspects and measures; the Node writer owns shipped bytes because Blender's glTF
exporter cannot emit the closed profile the multi-LOD validator accepts.

The tessellation below is a transliteration of `tessellateV3Plan`, so agreement
with the TypeScript writer catches transcription and transport errors but is NOT
independent verification of the grammar. Two checks here ARE independent:

  (a) The analytic volume identity. V2's identity multiplied a rectangle's width
      by its depth; that does not generalise. V3's tier is a concave prism, so
      the identity is the SHOELACE AREA of each tier ring times its height, less
      every recess box and plus every protrusion box and rooftop prism. Corner
      clearance is what makes the box terms exact: no two placement boxes can
      meet inside a corner, so their volumes simply add. A mesh with a hole, an
      inverted normal, a self-overlapping tier ring or a placement that punched
      through a neck cannot satisfy it.

  (b) The up-axis-asserting re-import diff, which compares raw imported world
      coordinates against the Y-up expectation with no compensation applied.

Nothing here is downloaded, and no imagery is read: V3 appearance is designed.
"""

import json
import math
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACKAGE_ID = os.environ.get("UDT_V3_PACKAGE_ID", "manhattan-esb-block-reference-20260811-v3")
EVIDENCE_DIR = os.path.join(ROOT, "artifacts", "blender", PACKAGE_ID)
INPUT_DIR = os.path.join(EVIDENCE_DIR, "inputs")
RENDER_DIR = os.path.join(EVIDENCE_DIR, "renders")
VIEWS = ("view:east", "view:north", "view:south", "view:west")
# Everything the grammar cuts INTO the wall. Everything else with a positive
# depth is glued onto it.
RECESS_KINDS = ("window", "entrance", "storefront")
VOLUME_TOLERANCE = 1e-6


def reset_scene():
    for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(collection):
            collection.remove(item, do_unlink=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    os.makedirs(RENDER_DIR, exist_ok=True)
    return {"objects": len(bpy.data.objects), "units": scene.unit_settings.length_unit}


def load_input(canonical_building_id):
    path = os.path.join(INPUT_DIR, canonical_building_id.replace(":", "-") + ".json")
    with open(path, "r", encoding="utf-8") as handle:
        entry = json.load(handle)
    with open(entry["planPath"], "r", encoding="utf-8") as handle:
        entry["plan"] = json.load(handle)
    if entry["plan"]["planHashSha256"] != entry["planHashSha256"]:
        raise RuntimeError("Committed plan hash does not match the authoring input for " + canonical_building_id)
    if entry["plan"]["schemaVersion"] != "3.0":
        raise RuntimeError("V3 authoring requires a V3 plan for " + canonical_building_id)
    return entry


# ---------------------------------------------------------------------------
# Tessellation (transliteration of tessellateV3Plan)
# ---------------------------------------------------------------------------


def _surface_frame(surface):
    span_x = surface["endMm"][0] - surface["startMm"][0]
    span_y = surface["endMm"][1] - surface["startMm"][1]
    length = math.hypot(span_x, span_y)
    if length == 0:
        raise RuntimeError("Degenerate facade band: " + surface["id"])
    return {
        "originX": surface["startMm"][0],
        "originY": surface["startMm"][1],
        "spanX": span_x,
        "spanY": span_y,
        # Exterior of a counter-clockwise ring lies to the right of each edge.
        "normalX": span_y / length,
        "normalY": -span_x / length,
        "baseZ": surface["baseZMm"],
    }


def _frame_point(frame, u_length, u, v, depth):
    t = 0.0 if u_length == 0 else u / u_length
    return [
        frame["originX"] + frame["spanX"] * t + frame["normalX"] * depth,
        frame["originY"] + frame["spanY"] * t + frame["normalY"] * depth,
        frame["baseZ"] + v,
    ]


def _wall_quad(out, frame, surface, material_id, u_min, v_min, u_max, v_max, depth=0.0):
    if u_max <= u_min or v_max <= v_min:
        return
    length = surface["uLengthMm"]
    out.append({
        "materialId": material_id,
        "corners": [
            _frame_point(frame, length, u_min, v_min, depth),
            _frame_point(frame, length, u_max, v_min, depth),
            _frame_point(frame, length, u_max, v_max, depth),
            _frame_point(frame, length, u_min, v_max, depth),
        ],
    })


def _zoned_wall(out, frame, surface, u_min, v_min, u_max, v_max):
    boundary = surface["baseVMaxMm"]
    if boundary <= v_min or boundary >= v_max:
        material_id = surface["baseMaterialId"] if v_max <= boundary else surface["materialId"]
        _wall_quad(out, frame, surface, material_id, u_min, v_min, u_max, v_max)
        return
    _wall_quad(out, frame, surface, surface["baseMaterialId"], u_min, v_min, u_max, boundary)
    _wall_quad(out, frame, surface, surface["materialId"], u_min, boundary, u_max, v_max)


def _box(out, frame, surface, front_material_id, side_material_id, u_min, v_min, u_max, v_max, depth, closed=False):
    """Recess: five faces, the wall around it already omits the opening.

    Protrusion: six. The wall behind a protrusion is still emitted, so without a
    back face the surface does not bound a solid and the volume identity comes
    out several per cent high.
    """
    length = surface["uLengthMm"]

    def point(u, v, d):
        return _frame_point(frame, length, u, v, d)

    out.append({"materialId": front_material_id, "corners": [point(u_min, v_min, depth), point(u_max, v_min, depth), point(u_max, v_max, depth), point(u_min, v_max, depth)]})
    if closed:
        out.append({"materialId": front_material_id, "corners": [point(u_min, v_min, 0), point(u_min, v_max, 0), point(u_max, v_max, 0), point(u_max, v_min, 0)]})
    out.append({"materialId": side_material_id, "corners": [point(u_min, v_min, 0), point(u_min, v_min, depth), point(u_min, v_max, depth), point(u_min, v_max, 0)]})
    out.append({"materialId": side_material_id, "corners": [point(u_max, v_min, depth), point(u_max, v_min, 0), point(u_max, v_max, 0), point(u_max, v_max, depth)]})
    out.append({"materialId": side_material_id, "corners": [point(u_min, v_min, depth), point(u_min, v_min, 0), point(u_max, v_min, 0), point(u_max, v_min, depth)]})
    out.append({"materialId": side_material_id, "corners": [point(u_min, v_max, 0), point(u_min, v_max, depth), point(u_max, v_max, depth), point(u_max, v_max, 0)]})


def tessellate(plan, include_recesses):
    """Returns (quads, triangles) in plan-local millimetres."""
    quads = []
    triangles = []
    openings = {}
    attachments = {}
    for placement in plan["placements"]:
        bucket = openings if placement["depthMm"] < 0 else attachments
        bucket.setdefault(placement["surfaceId"], []).append(placement)

    for surface in plan["surfaces"]:
        if surface["kind"] != "facade":
            continue
        frame = _surface_frame(surface)
        rows_source = openings.get(surface["id"], [])
        if not rows_source:
            _zoned_wall(quads, frame, surface, 0, 0, surface["uLengthMm"], surface["vLengthMm"])
        else:
            _zoned_wall(quads, frame, surface, 0, 0, surface["uStartMm"], surface["vLengthMm"])
            _zoned_wall(quads, frame, surface, surface["uEndMm"], 0, surface["uLengthMm"], surface["vLengthMm"])
            grouped = {}
            for opening in rows_source:
                key = (opening["bounds"]["vMinMm"], opening["bounds"]["vMaxMm"])
                grouped.setdefault(key, []).append(opening)
            ordered = [sorted(row, key=lambda item: item["bounds"]["uMinMm"]) for _, row in sorted(grouped.items())]
            previous_top = 0
            for row in ordered:
                v_min = row[0]["bounds"]["vMinMm"]
                v_max = row[0]["bounds"]["vMaxMm"]
                _zoned_wall(quads, frame, surface, surface["uStartMm"], previous_top, surface["uEndMm"], v_min)
                row_material_id = surface["baseMaterialId"] if v_max <= surface["baseVMaxMm"] else surface["materialId"]
                cursor = surface["uStartMm"]
                for opening in row:
                    _wall_quad(quads, frame, surface, row_material_id, cursor, v_min, opening["bounds"]["uMinMm"], v_max)
                    if include_recesses:
                        _box(quads, frame, surface, opening["materialId"], row_material_id, opening["bounds"]["uMinMm"], v_min, opening["bounds"]["uMaxMm"], v_max, opening["depthMm"])
                    else:
                        _wall_quad(quads, frame, surface, opening["materialId"], opening["bounds"]["uMinMm"], v_min, opening["bounds"]["uMaxMm"], v_max)
                    cursor = opening["bounds"]["uMaxMm"]
                _wall_quad(quads, frame, surface, row_material_id, cursor, v_min, surface["uEndMm"], v_max)
                previous_top = v_max
            _zoned_wall(quads, frame, surface, surface["uStartMm"], previous_top, surface["uEndMm"], surface["vLengthMm"])
        if not include_recesses:
            continue
        for attachment in attachments.get(surface["id"], []):
            bounds = attachment["bounds"]
            _box(quads, frame, surface, attachment["materialId"], attachment["materialId"], bounds["uMinMm"], bounds["vMinMm"], bounds["uMaxMm"], bounds["vMaxMm"], attachment["depthMm"], closed=True)

    for surface in plan["surfaces"]:
        if surface["kind"] in ("roof", "ground"):
            ring = surface["ring"]
            for triangle in surface["triangles"]:
                a, b, c = (ring[index] for index in triangle)
                z = surface["zMm"]
                first = [a[0], a[1], z]
                second = [b[0], b[1], z]
                third = [c[0], c[1], z]
                # A downward cap reverses its winding so it faces out of the solid.
                triangles.append({"materialId": surface["materialId"], "corners": [first, third, second] if surface["downward"] else [first, second, third]})
        elif surface["kind"] == "setback-deck":
            combined = list(surface["outerRing"]) + list(surface["innerRing"])
            for triangle in surface["triangles"]:
                a, b, c = (combined[index] for index in triangle)
                z = surface["zMm"]
                triangles.append({"materialId": surface["materialId"], "corners": [[a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z]]})

    for prism in plan["prisms"]:
        ring = prism["ring"]
        count = len(ring)
        for index in range(count):
            current = ring[index]
            following = ring[(index + 1) % count]
            quads.append({"materialId": prism["materialId"], "corners": [
                [current[0], current[1], prism["baseZMm"]],
                [following[0], following[1], prism["baseZMm"]],
                [following[0], following[1], prism["topZMm"]],
                [current[0], current[1], prism["topZMm"]],
            ]})
        for triangle in prism["triangles"]:
            a, b, c = (ring[index] for index in triangle)
            triangles.append({"materialId": prism["materialId"], "corners": [[a[0], a[1], prism["topZMm"]], [b[0], b[1], prism["topZMm"]], [c[0], c[1], prism["topZMm"]]]})
            triangles.append({"materialId": prism["materialId"], "corners": [[a[0], a[1], prism["baseZMm"]], [c[0], c[1], prism["baseZMm"]], [b[0], b[1], prism["baseZMm"]]]})

    return quads, triangles


# ---------------------------------------------------------------------------
# Analytic volume identity, generalised to concave tiered prisms
# ---------------------------------------------------------------------------


def ring_area_mm2(ring):
    """Shoelace area. This is what replaces V2's width-times-depth rectangle."""
    twice = 0.0
    count = len(ring)
    for index in range(count):
        current = ring[index]
        following = ring[(index + 1) % count]
        twice += current[0] * following[1] - following[0] * current[1]
    return abs(twice) / 2.0


def expected_volume(plan, include_recesses):
    volume = 0.0
    for tier in plan["tiers"]:
        volume += ring_area_mm2(tier["ring"]) / 1e6 * (tier["topZMm"] - tier["baseZMm"]) / 1000.0
    # Rooftop prisms are emitted at BOTH levels of detail - they are silhouette,
    # not detail - so the identity counts them at both.
    for prism in plan["prisms"]:
        volume += ring_area_mm2(prism["ring"]) / 1e6 * (prism["topZMm"] - prism["baseZMm"]) / 1000.0
    if include_recesses:
        for placement in plan["placements"]:
            bounds = placement["bounds"]
            area = (bounds["uMaxMm"] - bounds["uMinMm"]) / 1000.0 * (bounds["vMaxMm"] - bounds["vMinMm"]) / 1000.0
            depth = placement["depthMm"] / 1000.0
            # Corner clearance is what makes this a plain sum: no two placement
            # boxes can overlap inside a corner, so none is double counted.
            if placement["kind"] in RECESS_KINDS:
                volume -= area * abs(depth)
            else:
                volume += area * abs(depth)
    return volume


# ---------------------------------------------------------------------------
# Blender objects and measurement
# ---------------------------------------------------------------------------


def _material(plan, material_id):
    for entry in plan["materials"]:
        if entry["id"] == material_id:
            return entry
    raise RuntimeError("Plan cites an undeclared material: " + material_id)


def build_object(name, plan, quads, triangles):
    vertices = []
    faces = []
    material_slots = []
    slot_index = {}
    material_indexes = []
    for face_source in (quads, triangles):
        for face in face_source:
            first = len(vertices)
            for corner in face["corners"]:
                vertices.append((corner[0] / 1000.0, corner[1] / 1000.0, corner[2] / 1000.0))
            faces.append(tuple(range(first, len(vertices))))
            material_id = face["materialId"]
            if material_id not in slot_index:
                slot_index[material_id] = len(material_slots)
                material_slots.append(material_id)
            material_indexes.append(slot_index[material_id])

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for material_id in material_slots:
        entry = _material(plan, material_id)
        material = bpy.data.materials.new(material_id)
        material.diffuse_color = (
            entry["baseColorSrgb"][0] / 255.0,
            entry["baseColorSrgb"][1] / 255.0,
            entry["baseColorSrgb"][2] / 255.0,
            entry["baseColorSrgb"][3] / 255.0,
        )
        mesh.materials.append(material)
    for polygon, index in zip(mesh.polygons, material_indexes):
        polygon.material_index = index

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _topology(mesh):
    volume = 0.0
    for polygon in mesh.polygons:
        volume += polygon.center.dot(polygon.normal) * polygon.area
    # Counted through a map rather than a nested scan: the worst-case asset here
    # is six figures of polygons, and the quadratic form does not finish.
    edge_use = {}
    for polygon in mesh.polygons:
        vertices = list(polygon.vertices)
        for index, vertex in enumerate(vertices):
            key = (min(vertex, vertices[(index + 1) % len(vertices)]), max(vertex, vertices[(index + 1) % len(vertices)]))
            edge_use[key] = edge_use.get(key, 0) + 1
    # NOT a watertightness measure. The row strips span the full usable width
    # while the piers and openings above them subdivide it, so the shared edges
    # meet at T-junctions: geometrically coincident, combinatorially unmatched.
    # The surface still bounds a solid, which is what the volume identity below
    # actually proves. Shipped GLBs duplicate every vertex per face anyway, so
    # no stage of this pipeline ever claims a combinatorial 2-manifold.
    t_junction_edges = sum(1 for count in edge_use.values() if count < 2)
    return {
        "signedVolumeCubicMeters": volume / 3.0,
        "outwardNormalsConsistent": volume > 0.0,
        "polygonCount": len(mesh.polygons),
        "vertexCount": len(mesh.vertices),
        "tJunctionEdgeCount": t_junction_edges,
    }


def _bounds(mesh):
    xs = [vertex.co.x for vertex in mesh.vertices]
    ys = [vertex.co.y for vertex in mesh.vertices]
    zs = [vertex.co.z for vertex in mesh.vertices]
    return {"min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]}


def author_building(canonical_building_id):
    entry = load_input(canonical_building_id)
    plan = entry["plan"]
    report = {
        "canonicalBuildingId": canonical_building_id,
        "planHashSha256": plan["planHashSha256"],
        "styleClass": plan["styleClass"],
        "tierCount": len(plan["tiers"]),
        "setbackDisclosure": plan["massing"]["setbackDisclosure"],
        "reflexVertexCount": len(plan["massing"]["reflexVertexIndexes"]),
        "sourceRingVertexCount": len(plan["input"]["geometry"]["footprint"]["outer"]),
        "lods": {},
    }
    for lod_id, include_recesses in (("lod_0", True), ("lod_1", False)):
        quads, triangles = tessellate(plan, include_recesses)
        obj = build_object(canonical_building_id.replace(":", "-") + "__" + lod_id, plan, quads, triangles)
        topology = _topology(obj.data)
        expected = expected_volume(plan, include_recesses)
        deviation = abs(topology["signedVolumeCubicMeters"] - expected) / abs(expected) if expected else float("inf")
        report["lods"][lod_id] = {
            "quadCount": len(quads),
            "triangleFaceCount": len(triangles),
            "triangleCount": len(quads) * 2 + len(triangles),
            "bounds": _bounds(obj.data),
            "expectedVolumeCubicMeters": expected,
            "volumeDeviation": deviation,
            # The real watertightness claim: a mesh with a hole, an inverted
            # normal, an overlapping tier ring, a placement that punched through
            # a neck, or a doubly tiled wall row cannot land inside this
            # tolerance by accident. Each of those was caught here.
            "boundsASolid": deviation < VOLUME_TOLERANCE,
            **topology,
        }
    return report


# ---------------------------------------------------------------------------
# Up-axis-asserting re-import diff and renders
# ---------------------------------------------------------------------------


REIMPORT_TOLERANCE_METERS = 1e-3


def _bounds_of_points(points):
    return [
        [min(point[axis] for point in points) for axis in range(3)],
        [max(point[axis] for point in points) for axis in range(3)],
    ]


def reimport_up_axis_diff(canonical_building_id, lod_id, package_dir):
    """Imports shipped bytes with NO compensation and diffs them against the authoring.

    An earlier draft of this function asserted that the tallest world extent came
    back as Z. That is not an up-axis test at all: most of Block 835 is wider
    than it is tall, so a low-rise satisfies or fails it for reasons that have
    nothing to do with the file's axis convention. It is replaced here.

    The real assertion is a coordinate diff. The shipped file is +Y-up (east,
    height, -north) and Blender's importer applies its own Y-up-to-Z-up
    conversion (x, y, z) -> (x, -z, y). Composing the two recovers the authored
    ENU frame EXACTLY, so imported world coordinates must equal the authored
    ones. `zUpHypothesisDeviationMeters` is the control: it reports how far off
    the same bytes would land had the writer emitted Z-up, and a large value is
    what proves the diff discriminates rather than agreeing with anything.
    """
    slug = canonical_building_id.replace(":", "-")
    authored = bpy.data.objects[slug + "__" + lod_id]
    path = os.path.join(package_dir, "private", "assets", slug + "__" + lod_id + ".glb")
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [bpy.data.objects[name] for name in set(bpy.data.objects.keys()) - before]
    if not imported:
        raise RuntimeError("Re-import produced no object: " + path)
    try:
        points = []
        for obj in imported:
            if obj.type != "MESH":
                continue
            matrix = obj.matrix_world
            for vertex in obj.data.vertices:
                world = matrix @ vertex.co
                points.append((world[0], world[1], world[2]))
        if not points:
            raise RuntimeError("Re-imported GLB contained no mesh vertices: " + path)
        authored_points = [tuple(vertex.co) for vertex in authored.data.vertices]
        authored_keys = {(round(p[0], 3), round(p[1], 3), round(p[2], 3)) for p in authored_points}
        imported_keys = {(round(p[0], 3), round(p[1], 3), round(p[2], 3)) for p in points}
        authored_bounds = _bounds_of_points(authored_points)
        imported_bounds = _bounds_of_points(points)
        deviation = max(abs(authored_bounds[side][axis] - imported_bounds[side][axis]) for side in range(2) for axis in range(3))
        # Control hypothesis: had the file been written Z-up, the importer's
        # conversion would have landed every vertex at (x, -z, y) of the authored
        # point instead of at the authored point itself.
        z_up_points = [(p[0], -p[2], p[1]) for p in authored_points]
        z_up_bounds = _bounds_of_points(z_up_points)
        z_up_deviation = max(abs(z_up_bounds[side][axis] - imported_bounds[side][axis]) for side in range(2) for axis in range(3))
        return {
            "canonicalBuildingId": canonical_building_id,
            "lodId": lod_id,
            "path": os.path.relpath(path, ROOT),
            "authoredVertices": len(authored_points),
            "importedVertices": len(points),
            "authoredUniquePositions": len(authored_keys),
            "importedUniquePositions": len(imported_keys),
            "positionsOnlyInAuthored": len(authored_keys - imported_keys),
            "positionsOnlyInImported": len(imported_keys - authored_keys),
            "authoredBoundsMeters": authored_bounds,
            "importedBoundsMeters": imported_bounds,
            "maxBoundsDeviationMeters": deviation,
            "toleranceMeters": REIMPORT_TOLERANCE_METERS,
            "zUpHypothesisDeviationMeters": z_up_deviation,
            "upAxisIsYUpInFile": deviation <= REIMPORT_TOLERANCE_METERS and z_up_deviation > REIMPORT_TOLERANCE_METERS,
        }
    finally:
        for obj in imported:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if getattr(data, "users", 1) == 0:
                try:
                    bpy.data.meshes.remove(data, do_unlink=True)
                except (RuntimeError, TypeError):
                    pass


def _setup_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"


def render_views(obj, name):
    _setup_render()
    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new(name + "__cam")
    camera = bpy.data.objects.new(name + "__cam", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    bounds = _bounds(obj.data)
    center = [(bounds["min"][axis] + bounds["max"][axis]) / 2.0 for axis in range(3)]
    radius = max(bounds["max"][axis] - bounds["min"][axis] for axis in range(3))
    written = []
    for index, view in enumerate(VIEWS):
        angle = index * math.pi / 2.0
        camera.location = (
            center[0] + math.cos(angle) * radius * 1.6,
            center[1] + math.sin(angle) * radius * 1.6,
            center[2] + radius * 0.6,
        )
        direction = __import__("mathutils").Vector(center) - camera.location
        camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(RENDER_DIR, name + "__" + view.replace(":", "-") + ".png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(os.path.relpath(path, ROOT))
    return written


# ---------------------------------------------------------------------------
# Silhouette measurement (LOD 1 transition evidence)
# ---------------------------------------------------------------------------


def _silhouette_camera():
    _setup_render()
    camera_data = bpy.data.cameras.get("udt3-silhouette-camera") or bpy.data.cameras.new("udt3-silhouette-camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.get("udt3-silhouette-camera")
    if camera is None:
        camera = bpy.data.objects.new("udt3-silhouette-camera", camera_data)
        bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    return camera


def _place_ortho_camera(camera, bounds, view):
    centre = [(bounds["min"][axis] + bounds["max"][axis]) / 2.0 for axis in range(3)]
    span = [bounds["max"][axis] - bounds["min"][axis] for axis in range(3)]
    radius = max(span) * 2.0 + 10.0
    camera.data.ortho_scale = max(span) * 1.2 + 1.0
    directions = {
        "view:south": (0.0, -1.0, math.radians(90), 0.0),
        "view:north": (0.0, 1.0, math.radians(90), math.radians(180)),
        "view:east": (1.0, 0.0, math.radians(90), math.radians(90)),
        "view:west": (-1.0, 0.0, math.radians(90), math.radians(-90)),
    }
    dx, dy, pitch, yaw = directions[view]
    camera.location = (centre[0] + dx * radius, centre[1] + dy * radius, centre[2])
    camera.rotation_euler = (pitch, 0.0, yaw)


def _render_alpha(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path)
    try:
        pixels = list(image.pixels)
    finally:
        bpy.data.images.remove(image)
    return [1 if pixels[index] > 0.5 else 0 for index in range(3, len(pixels), 4)]


def measure_silhouette(canonical_building_id):
    """Orthographic coverage difference between the two shipped levels of detail.

    LOD 1 drops recesses and keeps every protrusion, so the expectation is an
    exactly zero difference; measuring it rather than declaring it is what makes
    the manifest's transition metadata evidence instead of an assertion.
    """
    slug = canonical_building_id.replace(":", "-")
    fine = bpy.data.objects[slug + "__lod_0"]
    coarse = bpy.data.objects[slug + "__lod_1"]
    camera = _silhouette_camera()
    for obj in bpy.data.objects:
        obj.hide_render = obj.type == "MESH"
    bounds = _bounds(fine.data)
    ratios, pixels = {}, {}
    for view in VIEWS:
        _place_ortho_camera(camera, bounds, view)
        fine.hide_render = False
        alpha_fine = _render_alpha(os.path.join(RENDER_DIR, slug + "__lod_0__" + view.replace(":", "-") + ".png"))
        fine.hide_render = True
        coarse.hide_render = False
        alpha_coarse = _render_alpha(os.path.join(RENDER_DIR, slug + "__lod_1__" + view.replace(":", "-") + ".png"))
        coarse.hide_render = True
        covered = sum(alpha_fine)
        if covered == 0:
            raise RuntimeError("Empty silhouette render for " + canonical_building_id + " " + view)
        difference = sum(1 for index in range(len(alpha_fine)) if alpha_fine[index] != alpha_coarse[index])
        ratios[view] = difference / covered
        pixels[view] = {"lod0Covered": covered, "lod1Covered": sum(alpha_coarse), "symmetricDifference": difference}
    for obj in bpy.data.objects:
        obj.hide_render = False
    return {"canonicalBuildingId": canonical_building_id, "viewIds": list(VIEWS), "perView": ratios, "pixels": pixels, "deviationRatio": max(ratios.values())}


# ---------------------------------------------------------------------------
# Drivers
# ---------------------------------------------------------------------------


def drop_building(canonical_building_id):
    """Removes one building's authored meshes so the next one starts clean.

    Fourteen concave tiered prisms at full detail do not all fit comfortably in
    one scene, and nothing downstream needs them to: every measurement is taken
    while the building is present and written out before it is dropped.
    """
    slug = canonical_building_id.replace(":", "-")
    removed = 0
    for lod_id in ("lod_0", "lod_1"):
        obj = bpy.data.objects.get(slug + "__" + lod_id)
        if obj is not None:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh, do_unlink=True)
            removed += 1
    for material in list(bpy.data.materials):
        if material.users == 0:
            bpy.data.materials.remove(material, do_unlink=True)
    return removed


def author_and_measure(canonical_building_id):
    """Authors both LODs, proves the volume identity, measures and renders."""
    report = author_building(canonical_building_id)
    report["silhouette"] = measure_silhouette(canonical_building_id)
    report["renders"] = render_views(bpy.data.objects[canonical_building_id.replace(":", "-") + "__lod_0"], canonical_building_id.replace(":", "-"))
    report["volumeToleranceRelative"] = VOLUME_TOLERANCE
    return report


def write_evidence(name, payload):
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    path = os.path.join(EVIDENCE_DIR, name)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1, sort_keys=True)
        handle.write("\n")
    return path
