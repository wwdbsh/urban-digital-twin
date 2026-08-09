/** Strict normalized relative POSIX references used by local release packages. */
export function normalizeLocalReleaseReference(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\") || value.includes("://")) return null;
  if (value.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return null;
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return null;
  const normalized = segments.join("/");
  return normalized === value ? normalized : null;
}

export function isSafeLocalReleaseReference(value: unknown): value is string {
  return normalizeLocalReleaseReference(value) !== null;
}

/**
 * Canonical immutable-release artifact reference. This is intentionally
 * stricter than the legacy local-reference helper above: release manifests
 * must not rely on URL decoding or platform-specific path normalization.
 */
export function normalizeReleaseArtifactReference(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if ([...value].some((character) => character.charCodeAt(0) <= 0x20 || character.charCodeAt(0) === 0x7f) || /[%?#\\]/u.test(value)) return null;
  if (value.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return null;
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment),
    )
  ) return null;
  return segments.join("/") === value ? value : null;
}

export function isSafeReleaseArtifactReference(value: unknown): value is string {
  return normalizeReleaseArtifactReference(value) !== null;
}
