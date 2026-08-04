# Decision 0010: place truth contract and approval gates

Date: 2026-08-04

Status: accepted for local synthetic fixtures; real-source ingestion and paid
provider augmentation remain pending approval.

> **Implementation-status note (2026-08-04):** The provider-neutral place-truth
> contract remains fixture-backed for general place fields. The approved
> citywide OTI/DOHMH release exposes only source-backed buildings and restaurant
> inspection history, with CAMIS identity, lineage, and unknown states; grades
> are not ratings and no complete directory is claimed. Future providers and
> paid augmentation remain gated. See [Decision 0013](0013-manhattan-citywide-foundation-delivery.md).

## Decision

Place truth is a provider-neutral, multi-city record layered above the existing
`Feature`, `PlaceRecord`, `SourceRef`, and reversible reconciliation models. A
record keeps canonical identity and coordinates separate from source
observations; localized names, aliases, categories/facets, structured address,
entrances, brand/operator, opening hours, contacts, amenities, accessibility,
business status, commercial facts, imagery references, validity, confidence,
uncertainty, conflicts, and field-level lineage are explicit. Every field has a
truth state (`known`, `unknown`, `absent`, `stale`, or `conflict`), so an absent
or stale provider value cannot become a fabricated fact during reconciliation.

The fixture slice uses only invented records and labels. The UI calls them
fixture-only, displays source/lineage and missing data, and evaluates hours with
an IANA timezone-aware deterministic function that handles overnight periods,
special closures, and DST. It does not add Google Places/Street View/Map Tiles,
OSM requests, Overture downloads, NYC downloads, MTA feeds, new packages, or
Blender MCP.

## Consequences

- Open baseline releases can be persisted only after a source-specific terms,
  attribution, retention, CRS, and derivative review. NYC data is preferred for
  civic geometry/facilities; Overture and OSM remain per-source/per-release
  license mixtures; MTA static data is scheduled, not live.
- Google content is optional request-time augmentation. Place IDs are the
  durable identifier exception documented by Google; names, addresses, hours,
  reviews, photos, and popularity are not stored in the open canonical catalog.
  Places/tiles imagery also requires Google attribution and a compatible Google
  map display; this Cesium/non-Google baseline cannot assume compatibility.
- A source conflict is visible and reversible. Inspection grades do not become
  ratings, static amenity fields do not become current accessibility, and a
  source record from one provider never supplies another provider's licence.
- Real-time traffic, arrivals, closures, and operational business status stay
  unsupported until their own key, billing, retention, short-TTL, and terms
  review is approved.

## Google visual-reference and facade-reconstruction decision

### User-facing conclusion

Looking at Google Maps or Street View to orient oneself or gather casual visual
inspiration is not the same act as publishing a copy, but it is not blanket
legal clearance for this project. The current Google Maps Platform Terms of
Service expressly prohibit exporting/extracting/scraping Google Maps Content,
creating content based on that Content (including creating 3D building models
from Maps JavaScript API 45-degree imagery), and using Google Maps Core Services
with or near a non-Google map. The safer first version therefore will not use
Google Maps or Street View as a reference source for a near-identical facade,
will not capture or retain Google imagery, and will not train an ML/AI system on
Google Maps Content.

This is a product and risk decision, not legal advice. Whether a particular
building design, photograph, facade detail, model, or use is protected or
licensed depends on facts, jurisdiction, source terms, and permissions; obtain
qualified counsel or written authorization when a release depends on a close
reconstruction.

### Scenario matrix

| Activity | Policy/copyright reading | Project decision |
| --- | --- | --- |
| Casual visual inspiration or personal orientation | Merely viewing is not the same as distributing a screenshot or model, but Google’s service terms still govern the use and do not grant a right to make project content from Maps Content. | Allowed only as incidental private inspiration with no capture, copying, measurement, transcription, systematic comparison, or project asset derived from it; do not treat it as evidence or provenance. |
| Systematic reference-led reconstruction of a facade or building | Repeatedly consulting Street View/Maps to infer dimensions, window layouts, materials, or ornament is a reference-led extraction/reconstruction workflow. It risks falling within the Terms’ “create content based on Google Maps Content” restriction; the 45-degree 3D-model example is an explicit red flag. | Not allowed for this project without written Google permission and a separate legal review. Use independently licensed or owner-authorized references instead. |
| Screenshots, screen recording, downloads, local caching, or a reference archive | Current Terms prohibit export/extraction/scraping, pre-fetch/index/store outside the Services, and bulk downloading; Google’s FAQ also says Maps Platform images/content cannot be included in generated documents. | Do not take, save, attach, publish, or retain Google Maps/Street View screenshots, recordings, downloaded images, tiles, URLs-as-assets, or local caches. A transient browser view is not a provenance record. |
| Texture extraction, image tracing, masks, decals, or photometric sampling | These are copying or extracting source imagery and/or creating derivative content, not just looking. Attribution alone does not cure a prohibited use. | Prohibited. Never crop, trace, project, unwrap, sample, or bake Google imagery into textures, materials, geometry, or training data. |
| Photogrammetry or multi-view reconstruction | Photogrammetry from Google panoramas/tiles is automated or systematic extraction and a derived 3D asset; it is not made safe by manual cleanup or by making the result low-poly. | Prohibited from Google imagery. Photogrammetry may be considered only for photographs whose photographer/owner granted the required commercial and derivative rights, with a written release and per-asset provenance. |
| Automated capture, scraping, crawling, or bulk reference collection | The Terms explicitly prohibit scraping/export and bulk downloads; automation magnifies both policy and privacy risks. | Prohibited, including browser automation, unofficial endpoints, screenshot loops, panorama harvesting, tile harvesting, and third-party scrapers. No provider call is enabled by this decision. |
| ML/AI training, testing, validation, fine-tuning, or embedding generation | Current Terms explicitly prohibit using Google Maps Content to improve ML/AI models, including training, testing, validation, and fine-tuning. The U.S. Copyright Office separately describes AI copyrightability as fact-specific and rapidly evolving. | Prohibited for Google Maps Content, including screenshots, images, derived geometry, captions, labels, embeddings, and synthetic pairs. No Google-derived data enters prompts, datasets, evaluation sets, or model weights. |

### Copyright boundary and uncertainty

The U.S. Copyright Office says an original architectural work can include the
overall form and exterior elevations, while excluding individual standard
features and purely functional elements; 17 U.S.C. § 120(a) permits certain
pictorial representations of a constructed building visible from a public
place. Those provisions do not automatically authorize making a near-identical
3D facade model, copying a particular photograph, using a landmark’s protected
artwork/signage, or disregarding contract/terms-of-service restrictions. A
photograph has its own author and licence questions, and trademark, privacy,
publicity, landmark, and contractual issues can remain even where a particular
architectural element is not copyrightable. The project will fail closed where
the rights status, source licence, permission scope, or similarity analysis is
unclear.

### Safer first-version workflow

1. Use NYC open data, NYC Landmarks Preservation Commission/public records,
   and other approved civic datasets for location, footprint, address, height,
   landmark status, and documented architectural facts; preserve source
   licence, release, CRS, capture date, and uncertainty.
2. Prefer public-domain or clearly CC-licensed photographs whose licence permits
   the intended commercial/derivative use, or obtain a signed release from the
   photographer/rightsholder and, where relevant, the owner/architect. For
   on-site photographs, follow applicable trespass, privacy, signage, and
   landmark restrictions; do not photograph restricted areas.
3. Model only what is supported by the approved references, keep a human-authored
   interpretation record, avoid copying a single composition or distinctive
   expressive detail, and label approximations/unknowns. Do not claim a
   facade is a verified replica.
4. Store a per-asset provenance record: source ID/URL, photographer or owner,
   rights/permission text, attribution, capture date, permitted uses,
   modifications/derivatives, model author, review decision, and takedown or
   expiry condition. Do not mix Google-derived observations into that record.
5. Before publishing a close reconstruction of a named or landmark building,
   obtain a rights review and document the decision. Until then, use generic
   synthetic fixtures or materially abstracted, source-backed geometry.

### Explicit project policy

This project will use Google documentation for policy research only. It will
not use Google Maps/Street View imagery, screenshots, downloaded tiles,
automated captures, scraped place content, extracted textures, photogrammetry,
Google-derived facade measurements, or Google Maps Content for ML/AI training.
It will build its first real-source visual layer from approved NYC/LPC/public-
domain/CC/owner-authorized/on-site photographs and documented civic geometry,
with per-asset provenance and an explicit rights review. Any future Google
integration requires a separate paid/terms/compatibility gate, current legal
review, and written approval; this decision does not provide that approval.

## Exact approval checklist

### A. Bulk immutable open-data wave

- [ ] Approve the first NYC datasets and exact release IDs: building footprints,
  address/centerline, PLUTO/land-use context, parks/POPS/facilities, and
  restaurant inspection history; document the NYC terms/disclaimer and whether
  redistribution, derived indexes, and public tiles are allowed.
- [ ] Approve an immutable local snapshot layout with SHA-256, capture/release
  timestamp, source registry manifest, CRS/vertical datum, rejection report,
  retention deadline, and per-record source IDs/attribution.
- [ ] Approve OSM/Overpass/planet or named extract provider, ODbL attribution,
  database/Produced Work treatment, share-alike obligations, API/extract rate
  limits, and the rule forbidding Google-derived content in OSM data.
- [ ] Approve Overture release(s) and the per-record licence manifest (CDLA,
  ODbL, Apache, CC0, and any source-specific requirements), 60-day public
  release retention stated in current release docs, GERS/source IDs, and the
  derivative database policy.
- [ ] Approve MTA static GTFS and station/entrance/amenity releases, exact
  feed version, source dates, attribution, unspecified-licence resolution,
  timezone handling, and the statement that static data is not real time.
- [ ] Approve conflation rules, source precedence by field, quarantine rules,
  canonical ID policy, privacy/PII review, and a Manhattan pilot boundary.
- [ ] Confirm that no Google Maps content, scraping, screenshots, tiles, place
  payloads, reviews, photos, or IDs are copied into the open snapshot.

### B. Optional Google Maps Platform augmentation

- [ ] Approve a Google Cloud project, billing account, budget/quotas, API keys
  or OAuth, key restrictions, monitoring, and the exact products: Places API,
  Place IDs, Street View, and/or Map Tiles Photorealistic 3D Tiles.
- [ ] Complete current Google Maps Platform Terms, service-specific terms,
  Places policies, Map Tiles policies, Street View policies, privacy/terms of
  use, and regional/EEA applicability review.
- [ ] Decide whether Places results are request-time only; retain only allowed
  Place IDs, and document refresh behavior for IDs older than 12 months.
- [ ] Implement required Google logo/data/provider/photo/review attribution,
  author/source links, `googleMapsUri` access, Street View report link, and
  per-tile Photorealistic 3D attribution aggregation.
- [ ] Resolve whether the requested Google content can be shown beside this
  Cesium/non-Google basemap. Do not enable the product while the terms' map
  compatibility, caching, listings, or no-scraping restrictions are ambiguous.
- [ ] Establish a no-bulk-download/no-offline-cache/no-cross-source-laundering
  test and a cost kill switch before any request is enabled.
- [ ] Explicitly decide whether any proposed visual workflow is merely incidental
  private inspiration or instead systematic reference/reconstruction; reject
  screenshots, downloads, texture extraction, photogrammetry, automation,
  scraping, and ML/AI training on Google Maps Content unless Google gives
  written permission and counsel confirms the complete workflow.
- [ ] If a facade asset is needed, document an independent NYC/LPC,
  public-domain/CC, owner-authorized, or on-site-photo source and its per-asset
  commercial/derivative rights before modeling or publishing it.

### C. Blender MCP authoring

- [ ] Approve installation and exact pinned server/revision.
- [ ] Approve arbitrary Blender Python execution, local filesystem/network
  scope, credential isolation, and generated-script review.
- [ ] Approve offline-only GLB/3D Tiles authoring, source rights, export QA,
  provenance manifests, and a non-monolithic city delivery plan.
- [ ] Connect and validate Blender MCP before any procedural 3D task; until
  then, do not substitute desktop automation or claim generated city fidelity.

## Evidence boundary

Official source documentation was reviewed on 2026-08-04 (UTC); no provider
payloads were called or stored. The RoundtableSpace X post is retained only as
an inspiration note in the project brief and does not prove coverage, identity,
architecture, licensing, or performance. Google policy evidence includes the
[current Maps Platform Terms](https://cloud.google.com/maps-platform/terms),
[current Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms),
[Places policies](https://developers.google.com/maps/documentation/places/web-service/policies),
[Street View policies](https://developers.google.com/maps/documentation/streetview/policies),
and [Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies).
Separate authoritative U.S. copyright references are the [Copyright Office
architectural-works guidance](https://www.copyright.gov/register/va-architecture.html),
[17 U.S.C. § 120](https://www.copyright.gov/title17/92chap1.html), and the
[Copyright Office AI initiative](https://www.copyright.gov/ai/); these are not
legal clearance. See the companion
[`PLACE_TRUTH_SOURCE_MATRIX.md`](../research/PLACE_TRUTH_SOURCE_MATRIX.md) for
the direct links and layer-by-layer decisions.
