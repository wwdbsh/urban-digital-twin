/* global console, process */

import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { citywideQueryTokens, isCitywideExactIdentifier, normalizeCitywideQuery, selectCitywideSearchPrefixes } from "../src/release/citywide-release.ts";

const RELEASE = "manhattan-citywide-20260804";

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (!token?.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals > 2) output[token.slice(2, equals)] = token.slice(equals + 1);
    else { output[token.slice(2)] = argv[index + 1]; index += 1; }
  }
  return output;
}

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
function percentile(values, fraction) { const sorted = [...values].sort((left, right) => left - right); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0; }

function searchKeys(query, searchShards) {
  return selectCitywideSearchPrefixes(searchShards, query);
}

function exactIdentifier(query) {
  const raw = query.trim().toLocaleLowerCase();
  return isCitywideExactIdentifier(raw) ? raw : null;
}

function matches(summary, query) {
  const tokens = citywideQueryTokens(normalizeCitywideQuery(query));
  const haystack = normalizeCitywideQuery([summary[0], summary[2], summary[3], summary[4], ...(Array.isArray(summary[5]) ? summary[5] : [])].filter(Boolean).join(" "));
  return tokens.every((token) => haystack.includes(token));
}

function addressTokens(summary) {
  return typeof summary[3] === "string" ? normalizeCitywideQuery(summary[3]).split(" ").filter((token) => token.length >= 3) : [];
}

function addressPrefix(summary) {
  return addressTokens(summary).slice(0, 2).join(" ");
}

function hasUnicode(value) { return typeof value === "string" && [...value].some((character) => (character.codePointAt(0) ?? 0) > 0x7f); }

function sourceFieldValue(summary, definition, geometryByParent) {
  const records = geometryByParent.get(summary[0]) ?? [];
  const values = [...new Set(records.map((record) => record?.[definition.field]).filter((value) => typeof value === "string" && value.length > 0))];
  return values.length === 1 ? values[0] : null;
}

function camisValue(summary) {
  const match = typeof summary[0] === "string" ? /^dohmh:camis:(\d+)$/u.exec(summary[0]) : null;
  return match?.[1] ?? null;
}

function selectorMatches(summary, definition, geometryByParent, stats) {
  if (summary[1] !== definition.entityKind) return false;
  if (definition.selector === "named" && (typeof summary[2] !== "string" || (summary[1] === "building" && /^Building \d+$/u.test(summary[2])))) return false;
  if (definition.selector === "uniqueUnicodeName" && (!hasUnicode(summary[2]) || stats.nameCounts.get(normalizeCitywideQuery(summary[2])) !== 1)) return false;
  if (definition.selector === "uniqueDiacriticName" && (typeof summary[2] !== "string" || summary[2].normalize("NFKD") === summary[2] || stats.nameCounts.get(normalizeCitywideQuery(summary[2])) !== 1)) return false;
  if (definition.selector === "unlocated" && summary[7] !== "location-unavailable") return false;
  if (definition.selector === "uniqueAddressPrefix" && (addressPrefix(summary).length === 0 || stats.addressPrefixCounts.get(addressPrefix(summary)) !== 1)) return false;
  if (definition.selector === "mapDiffers") {
    const records = geometryByParent.get(summary[0]) ?? [];
    if (!records.length || !records.every((record) => typeof record.baseBbl === "string" && typeof record.mapPlutoBbl === "string" && record.baseBbl !== record.mapPlutoBbl)) return false;
  }
  if (["bin", "baseBbl", "mapPlutoBbl"].includes(definition.field) && !sourceFieldValue(summary, definition, geometryByParent)) return false;
  if (definition.field === "camis" && !camisValue(summary)) return false;
  if (definition.field === "name" && typeof summary[2] !== "string") return false;
  if (definition.field === "cuisine" && (typeof summary[4] !== "string" || !summary[4] || definition.selector === "rareCuisine" && !stats.cuisineCounts.has(summary[4]))) return false;
  if (definition.field === "addressPrefix" && addressPrefix(summary).length === 0) return false;
  return true;
}

function definitionValue(summary, definition, geometryByParent) {
  if (definition.field === "parentId") return typeof summary[0] === "string" ? summary[0] : null;
  if (definition.field === "name") return typeof summary[2] === "string" ? summary[2] : null;
  if (definition.field === "cuisine") return typeof summary[4] === "string" ? summary[4] : null;
  if (definition.field === "addressPrefix") return addressPrefix(summary) || null;
  if (["bin", "baseBbl", "mapPlutoBbl"].includes(definition.field)) return sourceFieldValue(summary, definition, geometryByParent);
  if (definition.field === "camis") return camisValue(summary);
  throw new Error(`Unsupported citywide query definition field: ${definition.field}`);
}

function transformQuery(value, transform) {
  if (transform === "uppercase") return value.toLocaleUpperCase();
  if (transform === "lowercase") return value.toLocaleLowerCase();
  if (transform === "diacritic-fold") return value.normalize("NFKD").replace(/\p{M}/gu, "");
  return value;
}

function validateDefinitionShape(definition, index, seenIds) {
  const allowedKeys = new Set(["id", "queryKind", "entityKind", "field", "selector", "sourceIndex", "tokenIndex", "transform", "ordinal", "query", "expectedIds"]);
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error(`Citywide query definition ${index} is not an object.`);
  for (const key of Object.keys(definition)) if (!allowedKeys.has(key)) throw new Error(`Citywide query definition ${index} has unsupported field ${key}.`);
  if (typeof definition.id !== "string" || definition.id.length === 0 || seenIds.has(definition.id)) throw new Error(`Citywide query definition ${index} has a missing or duplicate id.`);
  seenIds.add(definition.id);
  if (typeof definition.queryKind !== "string") throw new Error(`Citywide query definition ${definition.id} has no queryKind.`);
  if (!["exact-id", "bin", "bbl", "camis", "name", "address-token", "cuisine", "unicode", "unlocated-camis", "no-result"].includes(definition.queryKind)) throw new Error(`Citywide query definition ${definition.id} uses an unsupported queryKind.`);
  if (definition.sourceIndex !== undefined) throw new Error(`Citywide query definition ${definition.id} may not depend on sourceIdentifiers order; use a named release field.`);
  if (definition.ordinal !== undefined && (!Number.isSafeInteger(definition.ordinal) || definition.ordinal < 0)) throw new Error(`Citywide query definition ${definition.id} has an invalid ordinal.`);
  if (definition.selector !== undefined && !["named", "uniqueUnicodeName", "uniqueDiacriticName", "unlocated", "rareCuisine", "uniqueAddressPrefix", "mapDiffers"].includes(definition.selector)) throw new Error(`Citywide query definition ${definition.id} uses an unsupported selector.`);
  if (definition.transform !== undefined && !["uppercase", "lowercase", "diacritic-fold"].includes(definition.transform)) throw new Error(`Citywide query definition ${definition.id} uses an unsupported transform.`);
  if (definition.queryKind === "no-result") {
    if (typeof definition.query !== "string" || !Array.isArray(definition.expectedIds) || definition.expectedIds.length !== 0) throw new Error(`Citywide no-result definition ${definition.id} must declare a query and exactly zero expected IDs.`);
    return;
  }
  if ((definition.entityKind !== "building" && definition.entityKind !== "restaurant") || typeof definition.field !== "string") throw new Error(`Citywide query definition ${definition.id} has an invalid entityKind/field.`);
  if (!["parentId", "name", "cuisine", "addressPrefix", "bin", "baseBbl", "mapPlutoBbl", "camis"].includes(definition.field)) throw new Error(`Citywide query definition ${definition.id} uses an unsupported named field.`);
  if (definition.tokenIndex !== undefined && (!Number.isSafeInteger(definition.tokenIndex) || definition.tokenIndex < 0)) throw new Error(`Citywide query definition ${definition.id} has an invalid tokenIndex.`);
}

function expandQueryDefinitions(fixture, summaries, geometryByParent) {
  if (fixture?.schemaVersion !== "citywide-search-query-definitions-1" || !Array.isArray(fixture.definitions) || fixture.definitions.length !== 30) throw new Error("Citywide benchmark requires exactly 30 query definitions in the committed fixture.");
  const requiredKinds = new Set(["exact-id", "bin", "bbl", "camis", "name", "address-token", "cuisine", "unicode", "unlocated-camis", "no-result"]);
  const definitions = fixture.definitions;
  const seenIds = new Set();
  definitions.forEach((definition, index) => validateDefinitionShape(definition, index, seenIds));
  const actualKinds = new Set(definitions.map((definition) => definition.queryKind));
  if (![...requiredKinds].every((kind) => actualKinds.has(kind))) throw new Error("Citywide query fixture is missing a required varied query kind.");
  const nameCounts = new Map();
  const cuisineCounts = new Map();
  const addressPrefixCounts = new Map();
  summaries.forEach((summary) => {
    if (typeof summary[2] === "string") nameCounts.set(normalizeCitywideQuery(summary[2]), (nameCounts.get(normalizeCitywideQuery(summary[2])) ?? 0) + 1);
    if (typeof summary[4] === "string" && summary[4]) cuisineCounts.set(summary[4], (cuisineCounts.get(summary[4]) ?? 0) + 1);
    if (addressPrefix(summary)) addressPrefixCounts.set(addressPrefix(summary), (addressPrefixCounts.get(addressPrefix(summary)) ?? 0) + 1);
  });
  const stats = { nameCounts, cuisineCounts, addressPrefixCounts };
  const expanded = definitions.map((definition) => {
    if (definition.queryKind === "no-result") return { ...definition, query: String(definition.query), expectedIds: Array.isArray(definition.expectedIds) ? definition.expectedIds : [], resolvedSourceValue: null };
    const candidates = summaries.filter((summary) => selectorMatches(summary, definition, geometryByParent, stats)).sort((left, right) => {
      if (definition.selector === "rareCuisine") return (cuisineCounts.get(left[4]) ?? Number.MAX_SAFE_INTEGER) - (cuisineCounts.get(right[4]) ?? Number.MAX_SAFE_INTEGER) || String(left[0]).localeCompare(String(right[0]));
      if (["named", "uniqueUnicodeName", "uniqueDiacriticName"].includes(definition.selector)) return citywideQueryTokens(String(left[2] ?? "")).length - citywideQueryTokens(String(right[2] ?? "")).length || String(left[2]).length - String(right[2]).length || String(left[0]).localeCompare(String(right[0]));
      return String(left[0]).localeCompare(String(right[0]));
    });
    const selected = candidates[Number(definition.ordinal ?? 0)];
    if (!selected) throw new Error(`Citywide query definition ${definition.id} has no matching release summary.`);
    const value = definitionValue(selected, definition, geometryByParent);
    if (!value) throw new Error(`Citywide query definition ${definition.id} resolved an empty query value.`);
    if (definition.queryKind === "unicode" && !hasUnicode(value)) throw new Error(`Citywide unicode definition ${definition.id} did not resolve an actual non-ASCII source value.`);
    return { ...definition, query: transformQuery(value, definition.transform), expectedIds: [selected[0]], resolvedSourceValue: value };
  });
  const queryKeys = new Set();
  for (const definition of expanded) {
    const key = normalizeCitywideQuery(definition.query);
    if (!key || queryKeys.has(key)) throw new Error(`Citywide query definition ${definition.id} resolves a duplicate query string.`);
    queryKeys.add(key);
  }
  return expanded;
}

async function run() {
  const values = parseArgs(process.argv.slice(2));
  const releaseRoot = resolve(String(values["release-root"] ?? `data/generated/catalog/${RELEASE}-replay-a`));
  const queryFixturePath = resolve(String(values.queries ?? "scripts/fixtures/manhattan-citywide-search-queries.json"));
  const manifest = await readJson(join(releaseRoot, "manifest.json"));
  const searchByPrefix = new Map();
  for (const shard of manifest.searchShards) searchByPrefix.set(shard.prefix, [...(searchByPrefix.get(shard.prefix) ?? []), shard.relativeContentRef]);
  const detailIndex = await readJson(join(releaseRoot, manifest.detailIndex.relativeContentRef));
  const detailByParent = new Map(detailIndex.entries);
  const sampleParents = [...detailByParent.keys()].filter((id) => id.startsWith("dohmh:")).slice(0, 15).concat([...detailByParent.keys()].filter((id) => id.startsWith("doitt:")).slice(0, 15));
  async function readShard(relative, cache) {
    if (cache.has(relative)) return cache.get(relative);
    const value = await readJson(join(releaseRoot, relative));
    cache.set(relative, value);
    return value;
  }
  // Resolve synthetic definitions against release summaries only. This keeps
  // real addresses/IDs out of the committed fixture while making expectations
  // explicit in the generated evidence.
  const discoveryCache = new Map();
  const summariesByParent = new Map();
  for (const refs of searchByPrefix.values()) for (const ref of refs) {
    const shard = await readShard(ref, discoveryCache);
    for (const summary of shard.summaries ?? []) if (Array.isArray(summary) && typeof summary[0] === "string") summariesByParent.set(summary[0], summary);
  }
  const geometryDiscoveryCache = new Map();
  const geometryByParent = new Map();
  for (const shardManifest of manifest.geometryShards) {
    const shard = await readShard(shardManifest.relativeContentRef, geometryDiscoveryCache);
    for (const record of shard.features ?? []) if (record && typeof record.parentId === "string") geometryByParent.set(record.parentId, [...(geometryByParent.get(record.parentId) ?? []), record]);
  }
  const fixture = await readJson(queryFixturePath);
  const queryDefinitions = expandQueryDefinitions(fixture, [...summariesByParent.values()], geometryByParent);
  const sampleQueries = queryDefinitions.map((definition) => definition.query);
  const shardCache = new Map();
  async function search(query, cache) {
    const results = [];
    const refs = [...new Set(searchKeys(query, manifest.searchShards).flatMap((key) => searchByPrefix.get(key) ?? []))];
    const exact = exactIdentifier(query);
    const shards = await Promise.all(refs.map((ref) => readShard(ref, cache)));
    for (const shard of shards) for (const summary of shard.summaries ?? []) {
      const sourceIdentifiers = Array.isArray(summary[5]) ? summary[5] : [];
      const match = exact ? (typeof summary[0] === "string" && summary[0].toLocaleLowerCase() === exact) || sourceIdentifiers.some((identifier) => typeof identifier === "string" && identifier.toLocaleLowerCase() === exact) : matches(summary, query);
      if (match) results.push(summary[0]);
    }
    return [...new Set(results)].sort();
  }
  const coldSearchMs = [];
  const warmSearchMs = [];
  let coldSearchShardLoads = 0;
  const querySamples = [];
  for (const definition of queryDefinitions) {
    const coldCache = new Map();
    const coldStart = performance.now();
    const coldResults = await search(definition.query, coldCache);
    const coldLatencyMs = performance.now() - coldStart;
    coldSearchMs.push(coldLatencyMs);
    coldSearchShardLoads += coldCache.size;
    const matchedExpectedIds = definition.expectedIds.filter((id) => coldResults.includes(id));
    if (definition.expectedIds.length === 0 ? coldResults.length !== 0 : matchedExpectedIds.length !== definition.expectedIds.length) throw new Error(`Citywide query definition ${definition.id} did not resolve expected release parent IDs.`);
    querySamples.push({
      id: definition.id,
      queryKind: definition.queryKind,
      entityKind: definition.entityKind ?? null,
      query: definition.query,
      queryNormalized: normalizeCitywideQuery(definition.query),
      resolvedSourceValue: definition.resolvedSourceValue,
      resolvedSourceNormalized: definition.resolvedSourceValue === null ? null : normalizeCitywideQuery(definition.resolvedSourceValue),
      expectedIds: definition.expectedIds,
      matchedExpectedIds,
      resultCount: coldResults.length,
      coldLatencyMs,
    });
  }
  for (const definition of queryDefinitions) {
    const warmStart = performance.now();
    const warmResults = await search(definition.query, shardCache);
    const warmLatencyMs = performance.now() - warmStart;
    warmSearchMs.push(warmLatencyMs);
    const matchedExpectedIds = definition.expectedIds.filter((id) => warmResults.includes(id));
    if (definition.expectedIds.length === 0 ? warmResults.length !== 0 : matchedExpectedIds.length !== definition.expectedIds.length) throw new Error(`Citywide warm query definition ${definition.id} did not resolve expected release parent IDs.`);
    querySamples.find((sample) => sample.id === definition.id).warmLatencyMs = warmLatencyMs;
  }
  const coldPickMs = [];
  const warmPickMs = [];
  const detailCache = new Map();
  async function pick(parentId, cache) {
    const relative = detailByParent.get(parentId);
    if (!relative) throw new Error(`Missing detail index entry for ${parentId}`);
    const shard = await readShard(relative, cache);
    return shard.records.find((record) => record.p === parentId) ?? null;
  }
  for (const parentId of sampleParents) {
    const coldCache = new Map();
    const coldStart = performance.now();
    const detail = await pick(parentId, coldCache);
    coldPickMs.push(performance.now() - coldStart);
    if (!detail) throw new Error(`Benchmark pick produced no detail for ${parentId}`);
  }
  for (const parentId of sampleParents) {
    const warmStart = performance.now();
    const detail = await pick(parentId, detailCache);
    warmPickMs.push(performance.now() - warmStart);
    if (!detail) throw new Error(`Benchmark warm pick produced no detail for ${parentId}`);
  }
  const result = {
    releaseRoot,
    releaseId: manifest.releaseId,
    queryFixturePath,
    queryDefinitionCount: queryDefinitions.length,
    queryKinds: Object.fromEntries(queryDefinitions.reduce((counts, definition) => counts.set(definition.queryKind, (counts.get(definition.queryKind) ?? 0) + 1), new Map())),
    querySamples,
    queryTextDistinctCount: new Set(queryDefinitions.map((definition) => normalizeCitywideQuery(definition.query))).size,
    unicodeSourceValuesAreNonAscii: queryDefinitions.filter((definition) => definition.queryKind === "unicode").every((definition) => typeof definition.resolvedSourceValue === "string" && hasUnicode(definition.resolvedSourceValue)),
    noResultSamplesAreExactlyZero: querySamples.filter((sample) => sample.queryKind === "no-result").every((sample) => sample.resultCount === 0 && sample.expectedIds.length === 0),
    searchSamples: sampleQueries.length,
    pickSamples: sampleParents.length,
    coldSearchShardLoads,
    warmSearchShardLoads: shardCache.size,
    coldDetailShardLoads: sampleParents.length,
    warmDetailShardLoads: detailCache.size,
    coldSearchP95Ms: percentile(coldSearchMs, 0.95),
    warmSearchP95Ms: percentile(warmSearchMs, 0.95),
    coldPickP95Ms: percentile(coldPickMs, 0.95),
    warmPickP95Ms: percentile(warmPickMs, 0.95),
    searchCacheEntries: shardCache.size,
    detailCacheEntries: detailCache.size,
    boundedReleaseShards: manifest.geometryShards.length + manifest.searchShards.length + manifest.detailShards.length,
    totalDeclaredBytes: manifest.totalDeclaredBytes,
  };
  if (values.evidence) await writeFile(resolve(String(values.evidence)), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
