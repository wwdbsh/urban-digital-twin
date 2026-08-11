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


def reimport_up_axis_diff(glb_path, expected_height_meters):
    """Imports shipped bytes with NO up-axis compensation and reports what it sees.

    The shipped GLB is Y-up. Blender is Z-up. Importing with the default
    conversion and then asserting that the tall axis came back as Z is the
    assertion: if the writer had emitted Z-up bytes, the model would arrive lying
    on its side and this diff would say so instead of quietly agreeing.
    """
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=glb_path)
    imported = [bpy.data.objects[name] for name in bpy.data.objects.keys() if name not in before]
    if not imported:
        raise RuntimeError("Re-import produced no object: " + glb_path)
    xs, ys, zs = [], [], []
    for obj in imported:
        for corner in obj.bound_box:
            world = obj.matrix_world @ __import__("mathutils").Vector(corner)
            xs.append(world.x)
            ys.append(world.y)
            zs.append(world.z)
    extents = [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)]
    tall_axis = extents.index(max(extents))
    return {
        "path": os.path.relpath(glb_path, ROOT),
        "worldExtentsMeters": extents,
        "tallestAxis": ["x", "y", "z"][tall_axis],
        "expectedHeightMeters": expected_height_meters,
        "heightDeviationMeters": abs(extents[2] - expected_height_meters),
        "upAxisIsYUpInFile": tall_axis == 2,
    }


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
