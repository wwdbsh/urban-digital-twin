/**
 * Midtown-core canary facade path.
 *
 * Committed as SOURCE rather than under `data/` because the Midtown payload
 * directory and its committed inventory are frozen for this promotion: the
 * immutability gate requires `data/` and `public/data/` to be byte-identical
 * to the pre-promotion tree, so a new evidence file could not be added there.
 * Every pose is derived from committed base bytes, and each pose records the
 * base shard and its SHA-256 so the derivation stays checkable.
 *
 * This is a FOOTPRINT-framed path, not a facade-plan path. Block 835 ships
 * per-building tier-0 plans and its path is framed against them; the
 * Midtown-core release does not, so the framing half-extent here comes from
 * the base footprint bounding box. The perpendicular camera-to-facade
 * distance and the oblique attitude match the Block 835 oblique path so the
 * two measurements are comparable.
 */
import type { ExteriorCanaryFacadePath } from "./block835-canary-probe";

export const MIDTOWN_CORE_CANARY_FACADE_PATH: ExteriorCanaryFacadePath = {
  "schemaVersion": "1.0",
  "pathId": "midtown-core-canary-facade-v1-oblique",
  "generator": "urban-digital-twin:midtown-core-canary-facade-path",
  "minimumCameraToFacadeMeters": 10,
  "closestCameraToFacadeMeters": 13,
  "framingReference": {
    "note": "Camera is placed due south of the base building centroid at cameraToFacadeMeters plus the footprint's north-south half-extent, at the height that puts the centroid on a -30 degree view axis. Half-extents come from the citywide base footprint bounding box, not from a facade plan: the Midtown-core release ships no per-building tier-0 plan of the Block 835 kind, so this is a footprint-framed path and is labelled as one.",
    "aspect": "16:9",
    "verticalHalfAngleDegrees": 15
  },
  "poses": [
    {
      "poseId": "midtown-facade-01-oblique",
      "buildingId": "doitt:1294316",
      "facade": "south",
      "framing": "full-facade-oblique",
      "cameraToFacadeMeters": 13.0,
      "cameraToBuildingCentreMeters": 55.482,
      "tier0HalfExtentMeters": 67.708,
      "buildingHeightMeters": 194.158,
      "rooflineInFrame": false,
      "referenceVerticalExtentMeters": 29.733,
      "pose": {
        "longitude": -74.004729266,
        "latitude": 40.752741445,
        "height": 32.033,
        "heading": 0,
        "pitch": -30,
        "roll": 0
      },
      "anchor": {
        "longitude": -74.00472926569158,
        "latitude": 40.75324068896748,
        "source": {
          "releaseId": "manhattan-citywide-20260804",
          "file": "public/data/manhattan-citywide-20260804/geometry/buildings/buildings-wgs84-geodetic-14-4823-4482-000.json",
          "fileSha256": "c17fad55089609c0b88aede85f88653e5502a92495aa6ade73932e3012549c3c",
          "partId": "udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:1294316",
          "ownerCellId": "manhattan-exterior-cell-w01-000001-14-4823-4482",
          "heightMeters": 194.1576
        }
      }
    },
    {
      "poseId": "midtown-facade-02-oblique",
      "buildingId": "doitt:594251",
      "facade": "south",
      "framing": "full-facade-oblique",
      "cameraToFacadeMeters": 13.0,
      "cameraToBuildingCentreMeters": 86.144,
      "tier0HalfExtentMeters": 94.19,
      "buildingHeightMeters": 90.672,
      "rooflineInFrame": false,
      "referenceVerticalExtentMeters": 46.164,
      "pose": {
        "longitude": -74.006525972,
        "latitude": 40.75083254,
        "height": 49.735,
        "heading": 0,
        "pitch": -30,
        "roll": 0
      },
      "anchor": {
        "longitude": -74.0065259716245,
        "latitude": 40.75160768995187,
        "source": {
          "releaseId": "manhattan-citywide-20260804",
          "file": "public/data/manhattan-citywide-20260804/geometry/buildings/buildings-wgs84-geodetic-14-4823-4482-000.json",
          "fileSha256": "c17fad55089609c0b88aede85f88653e5502a92495aa6ade73932e3012549c3c",
          "partId": "udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:594251",
          "ownerCellId": "manhattan-exterior-cell-w01-000001-14-4823-4482",
          "heightMeters": 90.67190399695201
        }
      }
    },
    {
      "poseId": "midtown-facade-03-oblique",
      "buildingId": "doitt:1104532",
      "facade": "south",
      "framing": "full-facade-oblique",
      "cameraToFacadeMeters": 13.0,
      "cameraToBuildingCentreMeters": 28.177,
      "tier0HalfExtentMeters": 15.177,
      "buildingHeightMeters": 82.07,
      "rooflineInFrame": false,
      "referenceVerticalExtentMeters": 15.1,
      "pose": {
        "longitude": -74.006405184,
        "latitude": 40.748956154,
        "height": 16.268,
        "heading": 0,
        "pitch": -30,
        "roll": 0
      },
      "anchor": {
        "longitude": -74.00640518429563,
        "latitude": 40.749209699583005,
        "source": {
          "releaseId": "manhattan-citywide-20260804",
          "file": "public/data/manhattan-citywide-20260804/geometry/buildings/buildings-wgs84-geodetic-14-4823-4482-000.json",
          "fileSha256": "c17fad55089609c0b88aede85f88653e5502a92495aa6ade73932e3012549c3c",
          "partId": "udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:1104532",
          "ownerCellId": "manhattan-exterior-cell-w01-000001-14-4823-4482",
          "heightMeters": 82.070061108216
        }
      }
    },
    {
      "poseId": "midtown-facade-04-oblique",
      "buildingId": "doitt:1297513",
      "facade": "south",
      "framing": "full-facade-oblique",
      "cameraToFacadeMeters": 13.0,
      "cameraToBuildingCentreMeters": 42.237,
      "tier0HalfExtentMeters": 29.237,
      "buildingHeightMeters": 173.736,
      "rooflineInFrame": false,
      "referenceVerticalExtentMeters": 22.635,
      "pose": {
        "longitude": -73.999592885,
        "latitude": 40.758097992,
        "height": 24.386,
        "heading": 0,
        "pitch": -30,
        "roll": 0
      },
      "anchor": {
        "longitude": -73.99959288529725,
        "latitude": 40.75847805386245,
        "source": {
          "releaseId": "manhattan-citywide-20260804",
          "file": "public/data/manhattan-citywide-20260804/geometry/buildings/buildings-wgs84-geodetic-14-4824-4482-000.json",
          "fileSha256": "057064679347214aed0233c3293e056e9db696a3af018ed3554f895f668cfe00",
          "partId": "udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:1297513",
          "ownerCellId": "manhattan-exterior-cell-w01-000002-16-19296-17928",
          "heightMeters": 173.73600000000002
        }
      }
    },
    {
      "poseId": "midtown-facade-05-oblique",
      "buildingId": "doitt:1300185",
      "facade": "south",
      "framing": "full-facade-oblique",
      "cameraToFacadeMeters": 13.0,
      "cameraToBuildingCentreMeters": 36.378,
      "tier0HalfExtentMeters": 23.378,
      "buildingHeightMeters": 159.106,
      "rooflineInFrame": false,
      "referenceVerticalExtentMeters": 19.495,
      "pose": {
        "longitude": -74.000466097,
        "latitude": 40.756916706,
        "height": 21.003,
        "heading": 0,
        "pitch": -30,
        "roll": 0
      },
      "anchor": {
        "longitude": -74.00046609724498,
        "latitude": 40.75724404636291,
        "source": {
          "releaseId": "manhattan-citywide-20260804",
          "file": "public/data/manhattan-citywide-20260804/geometry/buildings/buildings-wgs84-geodetic-14-4824-4482-000.json",
          "fileSha256": "057064679347214aed0233c3293e056e9db696a3af018ed3554f895f668cfe00",
          "partId": "udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:1300185",
          "ownerCellId": "manhattan-exterior-cell-w01-000002-16-19296-17928",
          "heightMeters": 159.1056
        }
      }
    },
    {
      "poseId": "midtown-facade-06-oblique",
      "buildingId": "doitt:1264335",
      "facade": "south",
      "framing": "full-facade-oblique",
      "cameraToFacadeMeters": 13.0,
      "cameraToBuildingCentreMeters": 43.396,
      "tier0HalfExtentMeters": 30.396,
      "buildingHeightMeters": 110.642,
      "rooflineInFrame": false,
      "referenceVerticalExtentMeters": 23.256,
      "pose": {
        "longitude": -73.999024005,
        "latitude": 40.756246601,
        "height": 25.055,
        "heading": 0,
        "pitch": -30,
        "roll": 0
      },
      "anchor": {
        "longitude": -73.99902400487755,
        "latitude": 40.756637091523636,
        "source": {
          "releaseId": "manhattan-citywide-20260804",
          "file": "public/data/manhattan-citywide-20260804/geometry/buildings/buildings-wgs84-geodetic-14-4824-4482-000.json",
          "fileSha256": "057064679347214aed0233c3293e056e9db696a3af018ed3554f895f668cfe00",
          "partId": "udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:1264335",
          "ownerCellId": "manhattan-exterior-cell-w01-000002-16-19296-17928",
          "heightMeters": 110.64240000000001
        }
      }
    },
    {
      "poseId": "midtown-facade-07-oblique",
      "buildingId": "doitt:1158178",
      "facade": "south",
      "framing": "full-facade-oblique",
      "cameraToFacadeMeters": 13.0,
      "cameraToBuildingCentreMeters": 56.22,
      "tier0HalfExtentMeters": 65.493,
      "buildingHeightMeters": 185.898,
      "rooflineInFrame": false,
      "referenceVerticalExtentMeters": 30.128,
      "pose": {
        "longitude": -73.995106417,
        "latitude": 40.758559678,
        "height": 32.459,
        "heading": 0,
        "pitch": -30,
        "roll": 0
      },
      "anchor": {
        "longitude": -73.99510641694047,
        "latitude": 40.7590655626378,
        "source": {
          "releaseId": "manhattan-citywide-20260804",
          "file": "public/data/manhattan-citywide-20260804/geometry/buildings/buildings-wgs84-geodetic-14-4824-4482-000.json",
          "fileSha256": "057064679347214aed0233c3293e056e9db696a3af018ed3554f895f668cfe00",
          "partId": "udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:1158178",
          "ownerCellId": "manhattan-exterior-cell-w01-000003-16-19297-17928",
          "heightMeters": 185.89817724938402
        }
      }
    },
    {
      "poseId": "midtown-facade-08-oblique",
      "buildingId": "doitt:1272399",
      "facade": "south",
      "framing": "full-facade-oblique",
      "cameraToFacadeMeters": 13.0,
      "cameraToBuildingCentreMeters": 44.781,
      "tier0HalfExtentMeters": 31.781,
      "buildingHeightMeters": 185.623,
      "rooflineInFrame": false,
      "referenceVerticalExtentMeters": 23.998,
      "pose": {
        "longitude": -73.996504787,
        "latitude": 40.758418118,
        "height": 25.854,
        "heading": 0,
        "pitch": -30,
        "roll": 0
      },
      "anchor": {
        "longitude": -73.99650478674356,
        "latitude": 40.75882107084633,
        "source": {
          "releaseId": "manhattan-citywide-20260804",
          "file": "public/data/manhattan-citywide-20260804/geometry/buildings/buildings-wgs84-geodetic-14-4824-4482-000.json",
          "fileSha256": "057064679347214aed0233c3293e056e9db696a3af018ed3554f895f668cfe00",
          "partId": "udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:1272399",
          "ownerCellId": "manhattan-exterior-cell-w01-000003-16-19297-17928",
          "heightMeters": 185.6232
        }
      }
    }
  ]
} as const;
