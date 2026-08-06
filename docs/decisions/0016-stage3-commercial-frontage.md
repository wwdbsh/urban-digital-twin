# Decision 0016: Stage 3 block 835 exterior and commercial frontage overlay

Date: 2026-08-05 (Asia/Seoul)
Status: local-runtime Stage 3 implementation validated; private-repository commit/push authorized (public deployment/conveyance excluded)
Baseline: `2822468fdc7e49b1d3b6197029164916688ce2e3`

## Decision

Deliver `manhattan-esb-block-exterior-pilot-20260805` as an explicit additive
overlay over the immutable citywide release, with civic mode retaining its
canonical URL and composing over that same base. Membership is the retained OTI
snapshot `jh45-qr5r`, `BASE_BBL[0] == "1" && BASE_BBL[1:6] == "00835"`, yielding
exactly 14 parents and 14 parts. DOITT IDs remain the identity authority even
when BBLs repeat (`1008350056` has three parents; `1008350063` has two).

The claim ceiling is intentionally two-tiered: ESB `doitt:778052` and Herald
Towers `doitt:131170` may say `licensed-near-real` only for cited visible
evidence; the other twelve say `source-constrained-massing` with
`estimated-residential-general-facade`/storefront geometry. OTI roof height,
including the ESB 377.583 m roof, remains separate from the independently
evidenced approximately 442.6 m ESB pinnacle. No source photo pixels, logos,
trade dress, external fonts, or invented occupants are shipped.

## Approval and source boundary

The implementation records these user approvals and their non-overlapping
scope:

| Approval | Scope recorded |
| --- | --- |
| `codex-user-turn:2026-08-05:block-835-commercial-frontage-revision` | Amendment claim ceiling and approved NYC/OSM source families |
| `codex-user-turn:2026-08-05:bounded-overpass-single-query-approval` | First bounded Overpass route; preserved HTTP 504 evidence |
| `codex-user-turn:2026-08-05:overpass-identical-single-retry-approval` | One byte-identical retry; preserved response-size-limit evidence |
| `codex-user-turn:2026-08-05:overpass-commercial-poi-single-query-approval` | One and only one commercial-POI Overpass request; no further OSM requests |
| `codex-user-turn:2026-08-06:stage3-private-repo-commit-push-approval` | Commit/push of this work unit to the existing private GitHub repository only; public deployment and public conveyance remain excluded |

The 2026-08-06 approval is a separate repository-history authorization. It
does not expand the 2026-08-05 acquisition scope, and the original acquisition
approval may retain its commit/push exclusions as the boundary of that request.
It authorizes private-repository commit/push only; public deployment, hosting,
redistribution, and other public conveyance remain excluded and require a
separate approval.

The final Overpass request used the exact OTI-union-plus-25 m bbox
`40.747707022744,-73.988192784289,40.749842609665,-73.984526949948`, the
identified client `UrbanDigitalTwin-Stage3Commercial/2026.08`, timeout 45 s,
and 25 MiB response limit. Its query SHA is
`ce61419f88fe87c2344cf45ecf1766a5a3d404c15f30c8903ea65a2dc28056e7`; the
cached HTTP 200 response is 64,249 bytes with SHA
`ed7acab3fd48105e718b1a6e734a3c3ac31320a62bff6b229c5c0691f0f7219e` and 100
elements. The first request's query SHA is
`5ba65d622b8c8165d31d805d90fae3a00ab1e5f919282fdc4c7c6c56de135c62`; its
HTTP 504 and the identical retry's size-limit result are immutable evidence.
There are no runtime Overpass/OSM/provider requests.

Approved source partitions:

| Partition/source | Use | Raw SHA-256 or file-level evidence |
| --- | --- | --- |
| NYC OTI `jh45-qr5r` | Exact footprint, DOITT/BIN/BBL, roof height, year | `52c841e388f8e56e6e3666d2ce8b6436ec10f9eeb2bbcad2b2452b51d58dafc7` |
| NYC DOHMH `43nn-pn8j` | Snapshot-relative inspection observations | `cb4cb6fce7a3744672882e63f2d3542674d7f76334d1a8aa2a7bfa76bd48b627` |
| NYC AddressPoint `uf93-f8nk` | BIN/address/frontage crosswalk, not exact tenant doors | `b7840d8bb62b594c869ba84d943113c8ad4f066bc92419f65b2efd1f1f26d866` |
| NYC DCWP `w7w3-xahh` | Premises/organization name and licence observations | `4be7aa893c98ae485e219f09f79664b53d76fd06df4e483885fb86f311cbc53e` |
| OSM bounded extract | Mapping observations and OSM-derived association edges only | ODbL partition; response `ed7acab3fd48105e718b1a6e734a3c3ac31320a62bff6b229c5c0691f0f7219e` |
| ESB Commons reference | Visible evidence observations only; CC BY-SA 4.0, no pixels | `4ca0596e84e4fd1fa49aad8cc2a879d2a7a18589` (reviewed file SHA-1) |
| Herald Towers Commons reference | Visible evidence observations only; CC BY-SA 4.0, no pixels | `52dfa12284ce257332b7b3b45af51d58cafa2825` (reviewed file SHA-1) |

The NYC sources are independently attributable under NYC Open Data terms. The
OSM raw/normalized/association material is the `odbl-derived` partition with
`Map data © OpenStreetMap contributors.`, the ODbL link, and the retained exact
query/response plus reproducible-build recipe. This is a local-only release;
future public conveyance requires the recorded database-offer/share-alike
review. Wikimedia source pages and exact revisions remain provenance only;
derived geometry uses no image pixels.

## Commercial policy

The three-stage pipeline keeps observation identity, tenant-to-building match,
and building-to-storefront placement separate. A neutral text sign is emitted
only after the approved source name and ground-floor/frontage/separation gates
pass. The eight accepted placements are:

| Sign text | Building | Decision | Evidence |
| --- | --- | --- | --- |
| Nonstop Style | `doitt:982383` | storefront-exact | `osm:node:10908810995@1` |
| Inhale Cannabis Club | `doitt:584049` | storefront-exact | `osm:node:10908811000@2` |
| Smoke Shop | `doitt:147902` | storefront-exact | `osm:node:11110373959@1` |
| STATE Grill and Bar | `doitt:778052` | storefront-exact | `osm:node:13007235601@1` |
| Timberland | `doitt:39969` | storefront-exact | `osm:node:2709306607@9` |
| Build-A-Bear Workshop | `doitt:147902` | storefront-exact | `osm:node:3927150551@4` |
| I Love NY Gifts & Luggage | `doitt:262867` | storefront-high (0.90) | `osm:node:4593432890@3` |
| Dim Sum Palace | `doitt:812702` | storefront-exact | `osm:node:9091328243@3` |

The normalized packet accounts for 236 observations, 164 accepted building
links, 0 metadata-only links, 0 ambiguous links, 72 rejected links, 8
accepted storefronts, 144 metadata-only storefronts, 12 ambiguous storefronts,
72 unknown storefronts, and 72 rejected/unmatched links. The unknown,
ambiguous, historical, upper-floor, and unresolved candidates remain visible
in accounting and do not receive a sign or proxy. Source status is
snapshot-relative; DCWP `Active`, DOHMH action, and OSM presence are never
collapsed into “open now.”

## Rejected alternatives and limits

Google products/data/imagery, OSM main API, tiles, Nominatim, Overpass Turbo,
Geofabrik, third-party extracts, paid/credentialed sources, optional asset/AI
providers, external fonts/logos/images, Three.js, 3D Tiles migration, runtime
network, public deployment, and dependency changes are outside this decision.
The overlay is not a claim of complete storefront occupancy, current status,
photorealism, public redistribution, or city-scale 3D Tiles delivery.

See the implementation record for measured Blender/browser evidence and the
explicit final-gate status.
