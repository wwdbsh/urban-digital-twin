# Bounded Manhattan landmark asset wave (2026-08-04)

This wave is a three-landmark, open-data-first pilot inside the published
`real-wave-20260804` Flatiron/NoMad/Union Square envelope. The GLBs are bounded
procedural exteriors, not photorealism, exact facade reconstructions, or a
citywide claim. Authoring used the pinned localhost-only Blender MCP and Blender
5.2.0 in meters, with local +X east, +Y north, +Z up and the WGS84 anchor as the
origin.

## Accepted landmarks

| Landmark and canonical feature ID | Geometry/identity evidence | Architectural/factual evidence | Rights treatment |
| --- | --- | --- | --- |
| Flatiron Building — OTI `DOITT_ID 507159`, BIN `1016278`; `udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:507159` | NYC OTI Building Footprints snapshot captured 2026-08-04, source record 507159; source URL and checksum are retained in the feature/source manifest. | NYC LPC designation report LP-0219, [PDF](https://s-media.nyc.gov/agencies/lpc/lp/0219.pdf), accessed 2026-08-04. It describes the triangular site, early steel-framed skyscraper, Renaissance Revival ornament and 1902 completion. | NYC publication-facts terms; only factual massing/material cues are derived. No photo pixels, textures, Google imagery or photogrammetry. OTI `HEIGHT_ROOF=300.29` is treated as feet-equivalent and converted exactly to 91.528392 m; the model's Blender float bound is 91.52838897705078 m. |
| Empire State Building — OTI `DOITT_ID 778052`, BIN `1015862`; `udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:778052` | NYC OTI Building Footprints snapshot captured 2026-08-04, source record 778052; source URL and checksum are retained in the feature/source manifest. | NYC DCP 15 Penn Plaza FEIS chapters 8/9, [chapter 8 PDF](https://www.nyc.gov/assets/planning/download/pdf/applicants/env-review/15_penn/08_feis.pdf), accessed 2026-08-04. It documents Art Deco form, limestone/glass, setbacks and the approximately 1,453-foot overall pinnacle. | NYC publication-facts terms; setbacks/material groups and the documented pinnacle are modeled without logos or branded detail. OTI roof value is preserved separately from the DCP overall-height evidence. |
| Theodore Roosevelt Birthplace National Historic Site — OTI `DOITT_ID 777417`, BIN `1016182`; `udt:manhattan:building:nyc%20office%20of%20technology%20and%20innovation%20(oti)%20gis:jh45-qr5r:777417` | NYC OTI Building Footprints snapshot captured 2026-08-04, source record 777417; source URL and checksum are retained in the feature/source manifest. NPS identifies the exact site at 28 East 20th Street. | U.S. National Park Service Historic Structure Report, [PDF](https://www.nps.gov/parkhistory/online_books/thrb/thrb_hsr.pdf), accessed 2026-08-04. The report describes a five-story complex with a brownstone townhouse reconstruction and adjacent museum/library. | U.S. federal factual publication; treated as public-domain factual reference with NPS attribution and no implied endorsement. No third-party embedded material is copied. |

## References reviewed but not model dependencies

The following individually verified Wikimedia Commons pages were considered
only as optional visual checks and were deliberately removed from the approved
runtime lineage. The GLBs are **not adapted works** of these photographs, ship no
photo pixels, and carry no CC BY-SA dependency. If a future wave uses one of
these images as an adapted source, it must add attribution and distribute that
adapted asset under the applicable CC BY-SA share-alike terms.

| Page | Author | License/version | Accessed | Derivative/commercial compatibility | Share-alike |
| --- | --- | --- | --- | --- | --- |
| [Flatiron building.jpg](https://commons.wikimedia.org/wiki/File:Flatiron_building.jpg) (oldid 1180887899) | Gryffindor | Public-domain dedication | 2026-08-04 | Yes, subject to the dedication and courtesy attribution | No |
| [Empire State Building.png](https://commons.wikimedia.org/wiki/File:Empire_State_Building.png) | NegweS | CC BY-SA 4.0 ([license](https://creativecommons.org/licenses/by-sa/4.0/)) | 2026-08-04 | Yes with attribution; adapted photo material must remain CC BY-SA compatible | Yes for adapted photo material |
| [Theodore Roosevelt Birthplace.jpg](https://commons.wikimedia.org/wiki/File:Theodore_Roosevelt_Birthplace.jpg) | Beyond My Ken | CC BY-SA 4.0 ([license](https://creativecommons.org/licenses/by-sa/4.0/)) | 2026-08-04 | Yes with attribution; adapted photo material must remain CC BY-SA compatible | Yes for adapted photo material |

These references remain non-approved research records in the source registry;
they do not justify a runtime visual-fidelity claim.

## Rejected identity and replacement

The OTI pilot includes `NAME="Penn Station"` for `DOITT_ID 254344`, but its
anchor is `(-73.99261286275348, 40.748991996592444)` and the pilot source did not
provide a matching authoritative address or a sufficiently clear Penn/MSG
complex identity join for this asset wave. Penn Station was therefore failed
closed: its Blender collection and all GLBs were removed, and no manifest entry
or runtime asset remains. The exact OTI/NPS identity and address evidence for
Theodore Roosevelt Birthplace (`DOITT_ID 777417`, BIN `1016182`, 28 East 20th
Street) made it the safer third candidate.

## Runtime asset package

Manifest: `public/assets/landmarks/landmark-wave-20260804/manifest.json`.
Blender source checkpoint: `artifacts/blender/landmark-wave-20260804/urban-digital-twin-landmarks.blend`.

| Asset | LOD | SHA-256 | Bytes | Triangles | Materials | Textures | World bounds (m) |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| `flatiron-building__lod_0.glb` | near | `89ea83cff781dc52bdd853fb855c7fa61c0617442429c4334e2ad5b42c602db2` | 72,692 | 1,424 | 2 | 0 | `[-20.0355,-30.5410,0]` to `[11.1812,35.5241,91.5284]` |
| `flatiron-building__lod_1.glb` | far | `7a7c2c7467966d8ca77e4fb0a7ffad73418fcd0ae19a7ea5d2e38fb6aac5e38c` | 9,324 | 188 | 1 | 0 | `[-12.4220,-18.9354,0]` to `[6.9323,22.0250,91.5284]` |
| `empire-state-building__lod_0.glb` | near | `1062622b08d456d2011b744da83dd6d6ccfda399f0a8e5635436cea6ed2a4d80` | 28,060 | 416 | 3 | 0 | `[-59.3869,-69.3036,0]` to `[97.4368,43.3166,442.6000]` |
| `empire-state-building__lod_1.glb` | far | `ccbd194969405a2bfdff734e089de8528ef7c382729c459c570e64823ba39511` | 9,048 | 132 | 3 | 0 | `[-59.3869,-69.3036,0]` to `[97.4368,43.3166,442.6000]` |
| `theodore-roosevelt-birthplace__lod_0.glb` | near | `70723b90da12a30fdbc5306897ba957ab439178a6ce51d819edf1c656422ae01` | 20,428 | 200 | 2 | 0 | `[-11.8790,-13.1496,0]` to `[12.5914,14.4367,19.1872]` |
| `theodore-roosevelt-birthplace__lod_1.glb` | far | `3d76db1a843ebf59bb62499591d86e44daa0c023e904955d118be060008f2a32` | 2,460 | 28 | 1 | 0 | `[-11.6414,-12.8866,0]` to `[12.3395,14.1479,19.1872]` |

Budgets are 6,000 triangles / 4 materials / 0 textures for Flatiron and
Empire, and 2,000 / 3 / 0 for Theodore Roosevelt Birthplace. No collision,
accessibility, or picking proxy is claimed because none was authored.

## Visual and runtime validation

The Blender MCP source scene was reopened and rendered with neutral studio
lighting at `artifacts/blender/landmark-wave-20260804/blender-overview.png`.
The comparison is limited to the licensed factual references above: the frame
checks bounded massing, setbacks and roofline groups, while intentionally
showing no photographic textures, logos, or invented facade detail. The render
is a validation artifact, not a photorealism claim.

Fresh Cesium runtime captures are in
`artifacts/browser/landmark-wave-20260804/flatiron-runtime.png` and
`artifacts/browser/landmark-wave-20260804/procedural-building-runtime.png`.
The Flatiron details panel resolved verified LOD0 at
`assets/landmarks/landmark-wave-20260804/flatiron-building__lod_0.glb`; an
ordinary building (`DOITT_ID 1001202`) reported procedural fallback and no
registered asset. The browser's exact warning/error query returned `[]`; the
focused routing test and package replay test passed, with further command
evidence recorded in the adjacent browser README.

The Empire source checkpoint was reopened after repair and audited from
transformed vertex coordinates (not cached `bound_box` values). LOD0 intervals
are `0–24`, `24–50`, `50–75`, `75–105`, `105–335`, `335–378.600006`,
`378.600006–416.600006`, and `416.600006–442.600006` m; LOD1 intervals are
`0–24`, `24–418.600006`, and `418.600006–442.600006` m. Every adjacent delta
was exactly `0.0` m, the checkpoint contained zero `UDT_QA_` objects, and
Empire source materials remained `UDT_Limestone`, `UDT_Glass_Blue`, and
`UDT_Metal`.

The final Blender comparison set is `blender-overview.png`,
`flatiron-three-quarter.png`, `empire-state-three-quarter.png`, and
`theodore-roosevelt-birthplace-three-quarter.png` in the artifact directory.
The overview contains all three assets with labels and ground contact cues;
the three close views were each inspected after rendering, use copied mesh
data in a disposable QA collection, show no cross-asset fragments, and the
Flatiron view uses a high oblique angle that exposes the wedge-like footprint.
