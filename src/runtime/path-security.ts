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
