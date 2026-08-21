/* global console, process */
/**
 * T006 STAGE 1 — where the camera stands, and where the target lands on screen.
 *
 * TWO THINGS HAVE TO BE TRUE AT ONCE, and they pull against each other.
 *
 *  1. THE RING. The served level flips on the CELL's distance, and that
 *     distance is NOT camera-to-building. `unitDistanceMeters` measures from
 *     the VIEWPORT FOOTPRINT'S GROUND CENTRE to the nearest edge of the cell's
 *     `renderBounds` rectangle, in a frozen planar metric, with camera height
 *     excluded entirely (src/runtime/exterior-visibility-scheduler.ts). So an
 *     arm at "399 m" means the footprint centre is 399 m from the cell edge —
 *     it does not mean the camera is 399 m from the building.
 *
 *  2. THE PIXELS. The target still has to be big enough to measure. A pose that
 *     satisfies the ring by standing far away satisfies nothing else.
 *
 * The way through is an OBLIQUE pose: a low camera close to the target, pitched
 * down, so the footprint stretches far ahead and its centre sits ~400 m beyond
 * the cell while the target itself is near and large. Both conditions are then
 * VERIFIED rather than assumed — the cell distance is read back from the app's
 * own scheduler probe, and the projected screen position is confirmed by
 * clicking it and reading which feature the app says was picked.
 *
 * THE PROJECTION IS NOT TRUSTED, IT IS TESTED. Everything here is a prediction;
 * the capture harness validates each one with a pick before any pixel is
 * measured, and a pose whose pick returns a different building is recorded as
 * occluded rather than measured.
 */

/** Local metres per degree at Manhattan's latitude, for PROJECTION only. */
export const METRES_PER_DEGREE_LATITUDE = 111132.0;
export const metresPerDegreeLongitude = (latitudeDegrees) => 111320.0 * Math.cos((latitudeDegrees * Math.PI) / 180);

/**
 * The scheduler's OWN frozen planar metric, used for the ring prediction so the
 * prediction is in the same units as the thing it predicts.
 * src/runtime/citywide-overview-cell-extents.ts
 */
export const SCHEDULER_METRIC = { metersPerDegreeLongitude: 84412.702, metersPerDegreeLatitude: 111049.654 };

/** Nearest-edge planar distance from a ground point to a rectangle. */
export function unitDistanceMeters(bounds, longitude, latitude, policy = SCHEDULER_METRIC) {
  const east = (longitude < bounds.west ? bounds.west - longitude : longitude > bounds.east ? longitude - bounds.east : 0) * policy.metersPerDegreeLongitude;
  const north = (latitude < bounds.south ? bounds.south - latitude : latitude > bounds.north ? latitude - bounds.north : 0) * policy.metersPerDegreeLatitude;
  return Math.hypot(east, north);
}

/**
 * Project a WGS84 point into device pixels for a Cesium camera pose.
 *
 * Flat-earth ENU: over the few hundred metres these poses span, the ellipsoid
 * correction is centimetres and the ROI is tens of pixels wide, so the
 * approximation is far inside the erosion margin. Heading is clockwise from
 * north, pitch is negative looking down, both as the URL grammar writes them.
 */
export function projectToDevicePixels(target, camera, optics) {
  const h = (camera.heading * Math.PI) / 180;
  const p = (camera.pitch * Math.PI) / 180;
  const direction = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
  const right = [Math.cos(h), -Math.sin(h), 0];
  const up = [
    right[1] * direction[2] - right[2] * direction[1],
    right[2] * direction[0] - right[0] * direction[2],
    right[0] * direction[1] - right[1] * direction[0],
  ];
  const mpdLon = metresPerDegreeLongitude(camera.lat);
  const v = [
    (target.lon - camera.lon) * mpdLon,
    (target.lat - camera.lat) * METRES_PER_DEGREE_LATITUDE,
    (target.height ?? 0) - camera.height,
  ];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = dot(v, direction);
  if (z <= 1) return { onScreen: false, reason: "target is behind or level with the camera plane", depthMetres: z };
  const x = dot(v, right);
  const y = dot(v, up);
  const halfW = optics.horizontalDevicePixels / 2;
  const halfH = optics.verticalDevicePixels / 2;
  const tanX = Math.tan(optics.fovxRadians / 2);
  const tanY = Math.tan(optics.fovyRadians / 2);
  const sx = halfW + (x / z / tanX) * halfW;
  const sy = halfH - (y / z / tanY) * halfH;
  return {
    onScreen: sx >= 0 && sy >= 0 && sx < optics.horizontalDevicePixels && sy < optics.verticalDevicePixels,
    devicePixelX: sx, devicePixelY: sy, depthMetres: z,
    devicePixelsPerMetreAtTarget: halfH / (z * tanY),
  };
}

/** The optics the Stage 0 budget was computed for, in both axes. */
export function opticsFor(canvasCssWidth, canvasCssHeight, devicePixelRatio, fovDegrees = 60) {
  const aspect = canvasCssWidth / canvasCssHeight;
  const fovx = (fovDegrees * Math.PI) / 180;
  const fovy = 2 * Math.atan(Math.tan(fovx / 2) / aspect);
  return {
    aspect, fovxRadians: fovx, fovyRadians: fovy,
    horizontalDevicePixels: canvasCssWidth * devicePixelRatio,
    verticalDevicePixels: canvasCssHeight * devicePixelRatio,
  };
}

/**
 * A camera placed on the bearing from the cell through the target, pulled back
 * `standoffMetres` and lifted `heightMetres`, looking back down that bearing.
 *
 * The ring is then satisfied by MOVING ALONG that bearing until the app's own
 * probe reports the wanted cell distance; this only supplies the starting point.
 */
export function poseTowards(target, standoffMetres, heightMetres, pitchDegrees, bearingDegrees) {
  const b = (bearingDegrees * Math.PI) / 180;
  const mpdLon = metresPerDegreeLongitude(target.lat);
  return {
    lon: target.lon - (Math.sin(b) * standoffMetres) / mpdLon,
    lat: target.lat - (Math.cos(b) * standoffMetres) / METRES_PER_DEGREE_LATITUDE,
    height: heightMetres,
    heading: bearingDegrees,
    pitch: pitchDegrees,
    roll: 0,
  };
}

export const poseUrl = (base, pose, extra = "") =>
  `${base}/?data=real-pilot&release=manhattan-citywide-20260804&view=free${extra}` +
  `&lon=${pose.lon.toFixed(6)}&lat=${pose.lat.toFixed(6)}&height=${pose.height.toFixed(6)}` +
  `&heading=${pose.heading.toFixed(6)}&pitch=${pose.pitch.toFixed(6)}&roll=${pose.roll.toFixed(6)}`;

if (process.argv[2] === "predict") {
  const [, , , lon, lat, hgt, standoff, camH, pitch, bearing] = process.argv;
  const target = { lon: Number(lon), lat: Number(lat), height: Number(hgt) };
  const pose = poseTowards(target, Number(standoff), Number(camH), Number(pitch), Number(bearing));
  const optics = opticsFor(1005, 790, 2);
  console.log(JSON.stringify({ pose, url: poseUrl("http://127.0.0.1:4173", pose), projection: projectToDevicePixels(target, pose, optics) }, null, 2));
}
