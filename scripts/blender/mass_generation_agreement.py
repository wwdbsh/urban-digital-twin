"""Blender re-import and measurement pass for the T004 per-wave agreement.

Same division of authority as every earlier wave's pass: Blender inspects and
measures, the Node writer owns the shipped bytes, and nothing here authors
geometry. Every asset opened is a GLB that already shipped into a retained `-c1`
payload, opened read-only.

WHAT IS MEASURED, per sampled building, at BOTH LODs:

  (a) The imported world bounds. Blender's glTF importer maps a Y-up file
      (x, y, z) to (x, -z, y); these GLBs are written (east, up, -north), so the
      imported world frame is the building-anchored ENU metre frame with no
      compensation applied. A mis-stated mapping shows up as a metres-scale
      disagreement rather than a small one, which is what makes the check worth
      running.

  (b) The GROUND-PLANE vertex bounds — every vertex within 1e-4 m of the mesh's
      own minimum z. Node applies the identical rule to the analytic
      tessellation, so the two sides select the same set by construction. This
      is what gets compared against the SOURCED footprint polygon.

  (c) Triangle, material and embedded-image counts.

  (d) The signed mesh volume by the divergence theorem. The Y-up-to-Z-up map is
      a rotation with determinant +1, so the signed volume is invariant under it
      and is compared with the writer's analytic number directly. A mesh with a
      hole, an inverted normal or a self-overlapping tier ring cannot satisfy it.

  (e) The SHA-256 of the file actually opened, computed here rather than handed
      in, so the record is provably about the bytes the payload inventory pins
      and not about whatever happened to be on disk.

Nothing is rendered. No image, screenshot or eyeball stands behind any number
this pass produces, and none is claimed.

Driven by setting `AGREEMENT_WAVES` (a list of wave ids) before exec'ing this
file; results accumulate into `inspection.json` under the work root so the pass
can be taken one wave at a time.
"""

import hashlib
import json
import os

import bpy

ROOT = "/Users/sangheonlee/orca/workspaces/urban-digital-twin/fcp-86b-blender-evidence"
WORK_ROOT = os.path.join(ROOT, "artifacts", "mass-generation-20260816", "blender")
INPUT_DIR = os.path.join(WORK_ROOT, "inputs")
REPORT_PATH = os.path.join(WORK_ROOT, "inspection.json")

GROUND_PLANE_EPSILON_METERS = 1e-4


def reset_scene():
    """Empty scene, every datablock removed.

    Materials and images are removed too: a leftover datablock would be counted
    into the NEXT sample's material or image count and would turn a clean
    measurement into a silently wrong one.
    """
    for collection in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.images,
        bpy.data.textures,
    ):
        for item in list(collection):
            collection.remove(item, do_unlink=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def measure(path, crown_meters):
    """Measure one shipped GLB.

    `crown_meters` is the ANALYTIC crown — the top of the wall massing — and it
    is handed in rather than discovered, because a triangle soup does not label
    which of its vertices belong to the massing and which to the roof cluster.
    What Blender does with it is falsifiable and is the point of handing it in:
    it reports whether a vertex plane exists there at all, how far above it
    anything rises, and whether everything above it stays inside the massing's
    own footprint. Those are the two T004 rooftop rules — cluster containment and
    the one-storey clamp — checked against imported geometry.
    """
    reset_scene()
    checksum = sha256_of(path)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
    if not imported:
        raise RuntimeError("no mesh imported from " + path)

    minimum = [float("inf")] * 3
    maximum = [float("-inf")] * 3
    triangles = 0
    vertices = 0
    materials = set()
    volume_six = 0.0
    world_points = []
    for obj in imported:
        mesh = obj.data
        matrix = obj.matrix_world
        vertices += len(mesh.vertices)
        for slot in obj.material_slots:
            if slot.material is not None:
                materials.add(slot.material.name)
        points = [matrix @ vertex.co for vertex in mesh.vertices]
        world_points.append(points)
        for point in points:
            for axis in range(3):
                if point[axis] < minimum[axis]:
                    minimum[axis] = point[axis]
                if point[axis] > maximum[axis]:
                    maximum[axis] = point[axis]
        for polygon in mesh.polygons:
            corners = [points[index] for index in polygon.vertices]
            triangles += max(0, len(corners) - 2)
            for index in range(1, len(corners) - 1):
                a, b, c = corners[0], corners[index], corners[index + 1]
                volume_six += (
                    a[0] * (b[1] * c[2] - b[2] * c[1])
                    - a[1] * (b[0] * c[2] - b[2] * c[0])
                    + a[2] * (b[0] * c[1] - b[1] * c[0])
                )

    ground_minimum = [float("inf")] * 2
    ground_maximum = [float("-inf")] * 2
    ground_count = 0
    for points in world_points:
        for point in points:
            if abs(point[2] - minimum[2]) > GROUND_PLANE_EPSILON_METERS:
                continue
            ground_count += 1
            for axis in range(2):
                if point[axis] < ground_minimum[axis]:
                    ground_minimum[axis] = point[axis]
                if point[axis] > ground_maximum[axis]:
                    ground_maximum[axis] = point[axis]

    # Crown-relative partition: the massing at or below the analytic crown, the
    # roof cluster above it, and the vertex plane at it.
    crown_plane_count = 0
    massing_minimum = [float("inf")] * 2
    massing_maximum = [float("-inf")] * 2
    above_minimum = [float("inf")] * 2
    above_maximum = [float("-inf")] * 2
    above_count = 0
    for points in world_points:
        for point in points:
            if abs(point[2] - crown_meters) <= GROUND_PLANE_EPSILON_METERS:
                crown_plane_count += 1
            if point[2] <= crown_meters + GROUND_PLANE_EPSILON_METERS:
                for axis in range(2):
                    if point[axis] < massing_minimum[axis]:
                        massing_minimum[axis] = point[axis]
                    if point[axis] > massing_maximum[axis]:
                        massing_maximum[axis] = point[axis]
            else:
                above_count += 1
                for axis in range(2):
                    if point[axis] < above_minimum[axis]:
                        above_minimum[axis] = point[axis]
                    if point[axis] > above_maximum[axis]:
                        above_maximum[axis] = point[axis]

    return {
        "checksumSha256": checksum,
        "crownReferenceMeters": crown_meters,
        "crownPlaneVertexCount": crown_plane_count,
        "massingBoundsAtOrBelowCrown": {"minimum": list(massing_minimum), "maximum": list(massing_maximum)},
        "aboveCrownVertexCount": above_count,
        "aboveCrownBounds": None if above_count == 0 else {"minimum": list(above_minimum), "maximum": list(above_maximum)},
        "objectCount": len(imported),
        "vertexCount": vertices,
        "triangleCount": triangles,
        "materialCount": len(materials),
        "imageCount": len(bpy.data.images),
        "bounds": {"minimum": list(minimum), "maximum": list(maximum)},
        "groundPlaneBounds": {"minimum": list(ground_minimum), "maximum": list(ground_maximum)},
        "groundPlaneVertexCount": ground_count,
        "signedVolumeCubicMeters": volume_six / 6.0,
    }


def run(wave_ids):
    existing = {}
    if os.path.exists(REPORT_PATH):
        with open(REPORT_PATH, "r", encoding="utf-8") as handle:
            for sample in json.load(handle).get("samples", []):
                existing[(sample["waveId"], sample["buildingId"])] = sample

    measured = 0
    for name in sorted(os.listdir(INPUT_DIR)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(INPUT_DIR, name), "r", encoding="utf-8") as handle:
            entry = json.load(handle)
        if entry["waveId"] not in wave_ids:
            continue
        levels = {}
        for lod_id in ("lod_0", "lod_1"):
            levels[lod_id] = measure(entry["levels"][lod_id]["assetPath"], entry["analytic"]["crownMeters"])
        existing[(entry["waveId"], entry["buildingId"])] = {
            "waveId": entry["waveId"],
            "buildingId": entry["buildingId"],
            "levels": levels,
        }
        measured += 1

    samples = [existing[key] for key in sorted(existing.keys())]
    report = {
        "schemaVersion": "1.0",
        "recordId": "mass-generation-20260816",
        "blender": {
            "version": bpy.app.version_string,
            "python": ".".join(str(part) for part in os.sys.version_info[:3]),
            "renderEngine": "none — this pass renders nothing",
        },
        "sampleCount": len(samples),
        "samples": samples,
    }
    with open(REPORT_PATH, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    reset_scene()
    return {"measuredThisRun": measured, "totalSamples": len(samples), "waves": sorted(wave_ids)}


RESULT = run(set(AGREEMENT_WAVES))  # noqa: F821 — set by the caller before exec
print(json.dumps(RESULT))
