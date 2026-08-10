"""Blender authoring, inspection and measurement pass for the Block 835 SUCCESSOR package.

Same division of authority as the 20260810 pass: Blender authors, inspects and
measures; the Node writer owns shipped bytes because Blender's glTF exporter
cannot emit the closed profile the multi-LOD validator accepts.

This module is a transliteration of `tessellateV2Plan`, so agreement with the
TypeScript writer catches transcription and transport errors but is NOT
independent verification of the grammar. The two genuinely independent checks
are (a) the analytic volume identity, which no mesh with a hole can satisfy,
and (b) the up-axis-asserting re-import diff, which compares raw imported world
coordinates with no compensation.

V2 adds stepped tiers, setback decks, balconies, fire escapes, blank sign
massing and rooftop water-tank prisms. Nothing here is downloaded.
"""

import json
import math
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PACKAGE_ID = "manhattan-esb-block-reference-20260811"
EVIDENCE_DIR = os.path.join(ROOT, "artifacts", "blender", PACKAGE_ID)
INPUT_DIR = os.path.join(EVIDENCE_DIR, "inputs")
RENDER_DIR = os.path.join(EVIDENCE_DIR, "renders")
PACKAGE_DIR = os.path.join(ROOT, "public", "data", PACKAGE_ID)
VIEWS = ("view:east", "view:north", "view:south", "view:west")
RECESS_KINDS = ("window", "entrance", "storefront")


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
    if entry["plan"]["schemaVersion"] != "2.0":
        raise RuntimeError("Successor authoring requires a V2 plan for " + canonical_building_id)
    return entry


def _sub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def _normalize(v):
    length = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    if length == 0:
        raise RuntimeError("Degenerate surface ring.")
    return [v[0] / length, v[1] / length, v[2] / length]


def _cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def roof_equipment_height_mm(plan):
    return min(1200, max(1, plan["input"]["parameters"]["roofEquipmentSizeMm"] // 4))


def placement_depth_mm(placement, parameters, equipment_mm):
    """Positive recesses into the surface, negative extrudes outward."""
    kind = placement["kind"]
    if kind in RECESS_KINDS:
        return parameters["openingInsetMm"]
    if kind == "cornice":
        return 0
    if kind == "roof-equipment":
        return -equipment_mm
    if kind == "balcony":
        return -parameters["balconyDepthMm"]
    if kind == "fire-escape":
        return -parameters["fireEscapeDepthMm"]
    if kind == "sign-band":
        return -parameters["signBandDepthMm"]
    if kind == "blade-sign":
        return -parameters["bladeSignDepthMm"]
    return 0


def _cap_quads(ring, z, upward):
    ordered = list(ring) if upward else list(reversed(ring))
    quads = []
    index = 0
    while 2 * index + 3 <= len(ordered) - 1:
        base = 2 * index
        a, b, c, d = ordered[0], ordered[base + 1], ordered[base + 2], ordered[base + 3]
        quads.append([(a[0], a[1], z), (b[0], b[1], z), (c[0], c[1], z), (d[0], d[1], z)])
        index += 1
    return quads


def tessellate(plan, include_recesses):
    """Returns [(materialId, [4 x (x, y, z) in plan-local millimetres])]."""
    parameters = plan["input"]["parameters"]
    equipment_mm = roof_equipment_height_mm(plan)
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
            if placement["surfaceId"] == surface["id"]
            and (include_recesses or placement_depth_mm(placement, parameters, equipment_mm) < 0)
        ]
        placements.sort(key=lambda item: (item["bounds"]["vMinMm"], item["bounds"]["uMinMm"], item["id"]))

        breaks = sorted({0, surface["vLengthMm"]} | {value for p in placements for value in (p["bounds"]["vMinMm"], p["bounds"]["vMaxMm"])})
        for index in range(len(breaks) - 1):
            v_min, v_max = breaks[index], breaks[index + 1]
            if v_max <= v_min:
                continue
            skips = sorted(
                ((p["bounds"]["uMinMm"], p["bounds"]["uMaxMm"]) for p in placements if p["bounds"]["vMinMm"] <= v_min and p["bounds"]["vMaxMm"] >= v_max),
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
            b = placement["bounds"]
            u0, v0, u1, v1 = b["uMinMm"], b["vMinMm"], b["uMaxMm"], b["vMaxMm"]
            material_id = placement["materialId"]
            depth = placement_depth_mm(placement, parameters, equipment_mm)
            quads.append((material_id, [point(u0, v0, depth), point(u1, v0, depth), point(u1, v1, depth), point(u0, v1, depth)]))
            if depth == 0:
                continue
            quads.append((material_id, [point(u0, v0, 0), point(u1, v0, 0), point(u1, v0, depth), point(u0, v0, depth)]))
            quads.append((material_id, [point(u0, v1, depth), point(u1, v1, depth), point(u1, v1, 0), point(u0, v1, 0)]))
            quads.append((material_id, [point(u0, v0, depth), point(u0, v1, depth), point(u0, v1, 0), point(u0, v0, 0)]))
            quads.append((material_id, [point(u1, v0, 0), point(u1, v1, 0), point(u1, v1, depth), point(u1, v0, depth)]))

    for prism in plan["prisms"]:
        ring = prism["ring"]
        base_z, top_z = prism["baseZMm"], prism["topZMm"]
        for index in range(len(ring)):
            current, nxt = ring[index], ring[(index + 1) % len(ring)]
            quads.append((prism["materialId"], [
                (current[0], current[1], base_z), (nxt[0], nxt[1], base_z),
                (nxt[0], nxt[1], top_z), (current[0], current[1], top_z),
            ]))
        for corners in _cap_quads(ring, top_z, True):
            quads.append((prism["materialId"], corners))
        for corners in _cap_quads(ring, base_z, False):
            quads.append((prism["materialId"], corners))
    return quads


def to_enu(quads, enu_frame):
    axis_x, axis_y = enu_frame["axis"]
    center_x, center_y = enu_frame["center"]

    def convert(corner):
        east = corner[0] / 1000.0
        north = corner[1] / 1000.0
        return (center_x + east * axis_x - north * axis_y, center_y + east * axis_y + north * axis_x, corner[2] / 1000.0)

    return [(material_id, [convert(c) for c in corners]) for material_id, corners in quads]


def _material(plan, material_id):
    name = "udt2:" + material_id
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    entry = next(item for item in plan["materials"] if item["id"] == material_id)
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    node = material.node_tree.nodes.get("Principled BSDF")
    if node is not None:
        colour = [channel / 255.0 for channel in entry["baseColorSrgb"]]
        node.inputs["Base Color"].default_value = (colour[0], colour[1], colour[2], colour[3])
        node.inputs["Metallic"].default_value = entry["metallicPermille"] / 1000.0
        node.inputs["Roughness"].default_value = entry["roughnessPermille"] / 1000.0
    material.diffuse_color = (
        entry["baseColorSrgb"][0] / 255.0, entry["baseColorSrgb"][1] / 255.0,
        entry["baseColorSrgb"][2] / 255.0, entry["baseColorSrgb"][3] / 255.0,
    )
    return material


def build_object(name, plan, quads):
    material_ids = []
    for material_id, _ in quads:
        if material_id not in material_ids:
            material_ids.append(material_id)
    vertices, faces, face_materials = [], [], []
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


def _bounds(mesh):
    xs = [v.co[0] for v in mesh.vertices]
    ys = [v.co[1] for v in mesh.vertices]
    zs = [v.co[2] for v in mesh.vertices]
    return {"min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]}


def _topology(mesh):
    volume = 0.0
    for polygon in mesh.polygons:
        volume += polygon.center.dot(polygon.normal) * polygon.area
    return {
        "signedVolumeCubicMeters": volume / 3.0,
        "outwardNormalsConsistent": volume > 0.0,
        "degenerateFaces": sum(1 for polygon in mesh.polygons if polygon.area <= 0.0),
    }


def _ring_area_mm2(ring):
    total = 0.0
    for index in range(len(ring)):
        x0, y0 = ring[index]
        x1, y1 = ring[(index + 1) % len(ring)]
        total += x0 * y1 - x1 * y0
    return abs(total) / 2.0


def expected_volume(plan, include_recesses):
    """Analytic solid volume: stepped tiers, minus recesses, plus protrusions and prisms.

    Coincident opposite faces (a leg bottom cap on the roof plane, a tank bottom
    cap on the leg tops) cancel exactly under the divergence theorem, so this
    closed-form total is directly comparable to the mesh integral.
    """
    parameters = plan["input"]["parameters"]
    equipment_mm = roof_equipment_height_mm(plan)
    volume = 0.0
    for tier in plan["tiers"]:
        volume += (tier["maxX"] - tier["minX"]) / 1000.0 * (tier["maxY"] - tier["minY"]) / 1000.0 * (tier["topZMm"] - tier["baseZMm"]) / 1000.0
    for placement in plan["placements"]:
        depth = placement_depth_mm(placement, parameters, equipment_mm)
        if depth == 0:
            continue
        if depth > 0 and not include_recesses:
            continue
        b = placement["bounds"]
        area = (b["uMaxMm"] - b["uMinMm"]) / 1000.0 * (b["vMaxMm"] - b["vMinMm"]) / 1000.0
        volume -= area * depth / 1000.0
    for prism in plan["prisms"]:
        volume += _ring_area_mm2(prism["ring"]) / 1e6 * (prism["topZMm"] - prism["baseZMm"]) / 1000.0
    return volume


def author_building(canonical_building_id):
    entry = load_input(canonical_building_id)
    plan = entry["plan"]
    report = {"canonicalBuildingId": canonical_building_id, "planHashSha256": plan["planHashSha256"], "tiers": len(plan["tiers"]), "prisms": len(plan["prisms"]), "lods": {}}
    for lod_id, include_recesses in (("lod_0", True), ("lod_1", False)):
        quads = to_enu(tessellate(plan, include_recesses), entry["enuFrame"])
        name = canonical_building_id.replace(":", "-") + "__" + lod_id
        obj = build_object(name, plan, quads)
        mesh = obj.data
        expected = expected_volume(plan, include_recesses)
        topology = _topology(mesh)
        report["lods"][lod_id] = {
            "object": name, "quads": len(quads), "vertices": len(mesh.vertices),
            "triangles": sum(len(p.vertices) - 2 for p in mesh.polygons),
            "materials": len(mesh.materials), "topology": topology,
            "expectedVolumeCubicMeters": expected, "bounds": _bounds(mesh),
            "volumeDeviation": abs(topology["signedVolumeCubicMeters"] - expected) / abs(expected),
        }
        report["lods"][lod_id]["watertight"] = report["lods"][lod_id]["volumeDeviation"] < 1e-6
    return report


def _setup_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    camera_data = bpy.data.cameras.get("udt2-silhouette-camera") or bpy.data.cameras.new("udt2-silhouette-camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.get("udt2-silhouette-camera")
    if camera is None:
        camera = bpy.data.objects.new("udt2-silhouette-camera", camera_data)
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
    slug = canonical_building_id.replace(":", "-")
    fine = bpy.data.objects[slug + "__lod_0"]
    coarse = bpy.data.objects[slug + "__lod_1"]
    camera = _setup_render()
    for obj in bpy.data.objects:
        obj.hide_render = obj.type == "MESH"
    bounds = _bounds(fine.data)
    ratios, pixels = {}, {}
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
    return {"canonicalBuildingId": canonical_building_id, "viewIds": list(VIEWS), "perView": ratios, "pixels": pixels, "deviationRatio": max(ratios.values())}


def reimport_diff(canonical_building_id, lod_id):
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
                # No compensation: the shipped file is +Y up (east, height, -north)
                # and Blender's importer maps (x, y, z) -> (x, -z, y), recovering
                # ENU exactly. A z-up file would import on its side and fail here.
                points.append((world[0], world[1], world[2]))
        if not points:
            raise RuntimeError("Re-imported GLB contained no mesh vertices.")
        authored_points = [tuple(v.co) for v in authored.data.vertices]
        authored_keys = {(round(p[0], 3), round(p[1], 3), round(p[2], 3)) for p in authored_points}
        imported_keys = {(round(p[0], 3), round(p[1], 3), round(p[2], 3)) for p in points}
        a_bounds = [[min(p[a] for p in authored_points) for a in range(3)], [max(p[a] for p in authored_points) for a in range(3)]]
        i_bounds = [[min(p[a] for p in points) for a in range(3)], [max(p[a] for p in points) for a in range(3)]]
        return {
            "canonicalBuildingId": canonical_building_id, "lodId": lod_id,
            "authoredVertices": len(authored_points), "importedVertices": len(points),
            "authoredUniquePositions": len(authored_keys), "importedUniquePositions": len(imported_keys),
            "positionsOnlyInAuthored": len(authored_keys - imported_keys),
            "positionsOnlyInImported": len(imported_keys - authored_keys),
            "maxBoundsDeviationMeters": max(abs(a_bounds[s][a] - i_bounds[s][a]) for s in range(2) for a in range(3)),
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
