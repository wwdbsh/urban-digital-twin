"""Blender authoring, inspection and measurement pass for the Block 835 reference assets.

Blender is the authoring and visual-inspection authority for this package; the
Node writer in `src/release/canonical-glb.ts` is the shipped-byte authority,
because Blender's own glTF exporter cannot emit the closed profile the T004
validator accepts (it writes `asset.generator`, object names and an
unreferenced BIN tail). The two are reconciled by the re-import diff below.

The tessellation here is an independent Python port of the same committed
facade-plan rules, not a replay of the TypeScript output, so a disagreement
between the authored scene and the shipped GLB is a real signal.

Everything this module creates is disposable: the scene is rebuilt from the
committed plans on every run and nothing is imported from the network.
"""

import json
import math
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACKAGE_ID = "manhattan-esb-block-reference-20260810"
EVIDENCE_DIR = os.path.join(ROOT, "artifacts", "blender", PACKAGE_ID)
INPUT_DIR = os.path.join(EVIDENCE_DIR, "inputs")
RENDER_DIR = os.path.join(EVIDENCE_DIR, "renders")
PACKAGE_DIR = os.path.join(ROOT, "public", "data", PACKAGE_ID)
VIEWS = ("view:east", "view:north", "view:south", "view:west")
RECESS_KINDS = ("window", "entrance", "storefront")


# ---------------------------------------------------------------------------
# Scene lifecycle
# ---------------------------------------------------------------------------

def reset_scene():
    """Removes every default and previously authored datablock; metric Z-up ENU."""
    for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(collection):
            collection.remove(item, do_unlink=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    os.makedirs(RENDER_DIR, exist_ok=True)
    return {"objects": len(bpy.data.objects), "meshes": len(bpy.data.meshes), "units": scene.unit_settings.length_unit}


def load_input(canonical_building_id):
    path = os.path.join(INPUT_DIR, canonical_building_id.replace(":", "-") + ".json")
    with open(path, "r", encoding="utf-8") as handle:
        entry = json.load(handle)
    with open(entry["planPath"], "r", encoding="utf-8") as handle:
        entry["plan"] = json.load(handle)
    if entry["plan"]["planHashSha256"] != entry["planHashSha256"]:
        raise RuntimeError("Committed plan hash does not match the authoring input for " + canonical_building_id)
    return entry


# ---------------------------------------------------------------------------
# Tessellation (independent port of the committed plan rules)
# ---------------------------------------------------------------------------

def _sub(left, right):
    return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]


def _normalize(value):
    length = math.sqrt(value[0] ** 2 + value[1] ** 2 + value[2] ** 2)
    if length == 0:
        raise RuntimeError("Degenerate surface ring.")
    return [value[0] / length, value[1] / length, value[2] / length]


def _cross(left, right):
    return [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ]


def _depth_mm(placement, inset_mm, equipment_mm):
    if placement["kind"] in RECESS_KINDS:
        return inset_mm
    if placement["kind"] == "roof-equipment":
        return -equipment_mm
    return 0


def tessellate(plan, tessellation, include_facade_detail):
    """Returns [(materialId, [4 x (x, y, z) in plan-local millimetres])]."""
    inset_mm = tessellation["openingInsetMm"]
    equipment_mm = tessellation["roofEquipmentHeightMm"]
    quads = []
    for surface in plan["surfaces"]:
        ring = surface["ring"]
        origin = ring[0]
        u_dir = _normalize(_sub(ring[1], origin))
        v_dir = _normalize(_sub(ring[3], origin))
        normal = _cross(u_dir, v_dir)

        def point(u, v, depth, _o=origin, _u=u_dir, _v=v_dir, _n=normal):
            return (
                _o[0] + _u[0] * u + _v[0] * v - _n[0] * depth,
                _o[1] + _u[1] * u + _v[1] * v - _n[1] * depth,
                _o[2] + _u[2] * u + _v[2] * v - _n[2] * depth,
            )

        placements = [
            placement for placement in plan["placements"]
            if placement["surfaceId"] == surface["id"] and (include_facade_detail or placement["kind"] == "roof-equipment")
        ]
        placements.sort(key=lambda item: (item["bounds"]["vMinMm"], item["bounds"]["uMinMm"], item["id"]))

        breaks = sorted({0, surface["vLengthMm"]} | {value for placement in placements for value in (placement["bounds"]["vMinMm"], placement["bounds"]["vMaxMm"])})
        for index in range(len(breaks) - 1):
            v_min, v_max = breaks[index], breaks[index + 1]
            if v_max <= v_min:
                continue
            skips = sorted(
                (
                    (placement["bounds"]["uMinMm"], placement["bounds"]["uMaxMm"])
                    for placement in placements
                    if placement["bounds"]["vMinMm"] <= v_min and placement["bounds"]["vMaxMm"] >= v_max
                ),
                key=lambda item: item[0],
            )
            cursor = 0
            for skip_min, skip_max in skips:
                if skip_min > cursor:
                    quads.append((surface["materialId"], [point(cursor, v_min, 0), point(skip_min, v_min, 0), point(skip_min, v_max, 0), point(cursor, v_max, 0)]))
                cursor = max(cursor, skip_max)
            if cursor < surface["uLengthMm"]:
                quads.append((surface["materialId"], [point(cursor, v_min, 0), point(surface["uLengthMm"], v_min, 0), point(surface["uLengthMm"], v_max, 0), point(cursor, v_max, 0)]))

        for placement in placements:
            bounds = placement["bounds"]
            u0, v0, u1, v1 = bounds["uMinMm"], bounds["vMinMm"], bounds["uMaxMm"], bounds["vMaxMm"]
            material_id = placement["materialId"]
            depth = _depth_mm(placement, inset_mm, equipment_mm)
            quads.append((material_id, [point(u0, v0, depth), point(u1, v0, depth), point(u1, v1, depth), point(u0, v1, depth)]))
            if depth == 0:
                continue
            quads.append((material_id, [point(u0, v0, 0), point(u1, v0, 0), point(u1, v0, depth), point(u0, v0, depth)]))
            quads.append((material_id, [point(u0, v1, depth), point(u1, v1, depth), point(u1, v1, 0), point(u0, v1, 0)]))
            quads.append((material_id, [point(u0, v0, depth), point(u0, v1, depth), point(u0, v1, 0), point(u0, v0, 0)]))
            quads.append((material_id, [point(u1, v0, 0), point(u1, v1, 0), point(u1, v1, depth), point(u1, v0, depth)]))
    return quads


def to_enu(quads, enu_frame):
    """Rigid plan-local millimetre -> building-anchored ENU metre transform."""
    axis_x, axis_y = enu_frame["axis"]
    center_x, center_y = enu_frame["center"]

    def convert(corner):
        east = corner[0] / 1000.0
        north = corner[1] / 1000.0
        return (center_x + east * axis_x - north * axis_y, center_y + east * axis_y + north * axis_x, corner[2] / 1000.0)

    return [(material_id, [convert(corner) for corner in corners]) for material_id, corners in quads]


# ---------------------------------------------------------------------------
# Object construction
# ---------------------------------------------------------------------------

def _material(plan, material_id):
    name = "udt:" + material_id
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    entry = next(item for item in plan["materials"] if item["id"] == material_id)
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is not None:
        colour = [channel / 255.0 for channel in entry["baseColorSrgb"]]
        principled.inputs["Base Color"].default_value = (colour[0], colour[1], colour[2], colour[3])
        principled.inputs["Metallic"].default_value = entry["metallicPermille"] / 1000.0
        principled.inputs["Roughness"].default_value = entry["roughnessPermille"] / 1000.0
    return material


def build_object(name, plan, quads):
    material_ids = []
    for material_id, _ in quads:
        if material_id not in material_ids:
            material_ids.append(material_id)
    vertices = []
    faces = []
    face_materials = []
    for material_id, corners in quads:
        base = len(vertices)
        vertices.extend(corners)
        faces.append((base, base + 1, base + 2, base + 3))
        face_materials.append(material_ids.index(material_id))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    for material_id in material_ids:
        mesh.materials.append(_material(plan, material_id))
    for polygon, material_index in zip(mesh.polygons, face_materials):
        polygon.material_index = material_index
    bpy.context.scene.collection.objects.link(obj)
    return obj


def author_building(canonical_building_id):
    entry = load_input(canonical_building_id)
    plan = entry["plan"]
    report = {"canonicalBuildingId": canonical_building_id, "planHashSha256": plan["planHashSha256"], "lods": {}}
    for lod_id, include_detail in (("lod_0", True), ("lod_1", False)):
        quads = to_enu(tessellate(plan, entry["tessellation"], include_detail), entry["enuFrame"])
        name = canonical_building_id.replace(":", "-") + "__" + lod_id
        obj = build_object(name, plan, quads)
        mesh = obj.data
        report["lods"][lod_id] = {
            "object": name,
            "quads": len(quads),
            "vertices": len(mesh.vertices),
            "polygons": len(mesh.polygons),
            "triangles": sum(len(polygon.vertices) - 2 for polygon in mesh.polygons),
            "materials": len(mesh.materials),
            "topology": _topology(mesh),
            "expectedVolumeCubicMeters": _expected_volume(plan, entry["tessellation"], include_detail),
            "bounds": _bounds(mesh),
        }
        lod = report["lods"][lod_id]
        lod["volumeDeviation"] = abs(lod["topology"]["signedVolumeCubicMeters"] - lod["expectedVolumeCubicMeters"]) / lod["expectedVolumeCubicMeters"]
        lod["watertight"] = lod["volumeDeviation"] < 1e-6
    return report


def _expected_volume(plan, tessellation, include_facade_detail):
    """Analytic solid volume of the authored massing.

    A mesh with any hole cannot reproduce this number through the divergence
    theorem, so agreement is a direct watertightness proof independent of the
    edge-adjacency count (the tessellation intentionally leaves T-junctions
    where a subdivided surface meets an unsubdivided neighbour).
    """
    geometry = plan["input"]["geometry"]
    outer = geometry["footprint"]["outer"]
    width = (outer[1][0] - outer[0][0]) / 1000.0
    depth = (outer[3][1] - outer[0][1]) / 1000.0
    volume = width * depth * geometry["heightMm"] / 1000.0
    inset = tessellation["openingInsetMm"] / 1000.0
    equipment = tessellation["roofEquipmentHeightMm"] / 1000.0
    for placement in plan["placements"]:
        bounds = placement["bounds"]
        area = (bounds["uMaxMm"] - bounds["uMinMm"]) / 1000.0 * (bounds["vMaxMm"] - bounds["vMinMm"]) / 1000.0
        if placement["kind"] == "roof-equipment":
            volume += area * equipment
        elif include_facade_detail and placement["kind"] in RECESS_KINDS:
            volume -= area * inset
    return volume


def _bounds(mesh):
    xs = [vertex.co[0] for vertex in mesh.vertices]
    ys = [vertex.co[1] for vertex in mesh.vertices]
    zs = [vertex.co[2] for vertex in mesh.vertices]
    return {"min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]}


def _topology(mesh):
    """Divergence-theorem volume: positive only when every face normal points outward.

    Also counts boundary edges, which must be zero for the closed massing the
    plan declares (`topology.closedManifold`).
    """
    volume = 0.0
    for polygon in mesh.polygons:
        volume += polygon.center.dot(polygon.normal) * polygon.area
    volume /= 3.0
    edge_use = {}
    for polygon in mesh.polygons:
        keys = list(polygon.vertices)
        for index in range(len(keys)):
            a = tuple(round(value, 4) for value in mesh.vertices[keys[index]].co)
            b = tuple(round(value, 4) for value in mesh.vertices[keys[(index + 1) % len(keys)]].co)
            key = (a, b) if a <= b else (b, a)
            edge_use[key] = edge_use.get(key, 0) + 1
    return {
        "signedVolumeCubicMeters": volume,
        "outwardNormalsConsistent": volume > 0.0,
        "boundaryEdges": sum(1 for count in edge_use.values() if count != 2),
        "degenerateFaces": sum(1 for polygon in mesh.polygons if polygon.area <= 0.0),
    }


# ---------------------------------------------------------------------------
# Fixed-view silhouette measurement
# ---------------------------------------------------------------------------

def _setup_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    camera_data = bpy.data.cameras.get("udt-silhouette-camera") or bpy.data.cameras.new("udt-silhouette-camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.get("udt-silhouette-camera")
    if camera is None:
        camera = bpy.data.objects.new("udt-silhouette-camera", camera_data)
        bpy.context.scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def _place_camera(camera, bounds, view):
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
    """Symmetric-difference-over-LOD0 silhouette ratio from fixed orthographic views."""
    slug = canonical_building_id.replace(":", "-")
    fine = bpy.data.objects[slug + "__lod_0"]
    coarse = bpy.data.objects[slug + "__lod_1"]
    camera = _setup_render()
    for obj in bpy.data.objects:
        obj.hide_render = obj.type == "MESH"
    bounds = _bounds(fine.data)
    ratios = {}
    pixels = {}
    for view in VIEWS:
        _place_camera(camera, bounds, view)
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
    return {
        "canonicalBuildingId": canonical_building_id,
        "viewIds": list(VIEWS),
        "perView": ratios,
        "pixels": pixels,
        "deviationRatio": max(ratios.values()),
    }


# ---------------------------------------------------------------------------
# Shipped-byte re-import diff
# ---------------------------------------------------------------------------

def reimport_diff(canonical_building_id, lod_id):
    """Imports the shipped GLB and compares its vertex cloud with the authored mesh."""
    slug = canonical_building_id.replace(":", "-")
    authored = bpy.data.objects[slug + "__" + lod_id]
    path = os.path.join(PACKAGE_DIR, "private", "assets", slug + "__" + lod_id + ".glb")
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [bpy.data.objects[name] for name in set(bpy.data.objects.keys()) - before]
    try:
        points = []
        for obj in imported:
            if obj.type != "MESH":
                continue
            matrix = obj.matrix_world
            for vertex in obj.data.vertices:
                world = matrix @ vertex.co
                # glTF ships Y-up; Blender's importer maps (x, y, z) -> (x, -z, y).
                points.append((world[0], world[2], -world[1]))
        authored_points = [tuple(vertex.co) for vertex in authored.data.vertices]
        if not points:
            raise RuntimeError("Re-imported GLB contained no mesh vertices.")
        authored_keys = {(round(p[0], 3), round(p[1], 3), round(p[2], 3)) for p in authored_points}
        imported_keys = {(round(p[0], 3), round(p[1], 3), round(p[2], 3)) for p in points}
        authored_bounds = [[min(p[axis] for p in authored_points) for axis in range(3)], [max(p[axis] for p in authored_points) for axis in range(3)]]
        imported_bounds = [[min(p[axis] for p in points) for axis in range(3)], [max(p[axis] for p in points) for axis in range(3)]]
        return {
            "canonicalBuildingId": canonical_building_id,
            "lodId": lod_id,
            "authoredVertices": len(authored_points),
            "importedVertices": len(points),
            "authoredUniquePositions": len(authored_keys),
            "importedUniquePositions": len(imported_keys),
            "positionsOnlyInAuthored": len(authored_keys - imported_keys),
            "positionsOnlyInImported": len(imported_keys - authored_keys),
            "maxBoundsDeviationMeters": max(
                abs(authored_bounds[side][axis] - imported_bounds[side][axis])
                for side in range(2) for axis in range(3)
            ),
        }
    finally:
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)


def write_evidence(name, payload):
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    path = os.path.join(EVIDENCE_DIR, name)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=1, sort_keys=True)
        handle.write("\n")
    return path
